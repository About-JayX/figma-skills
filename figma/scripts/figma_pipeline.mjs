#!/usr/bin/env node
/**
 * Figma one-shot reproduction pipeline
 *
 * Usage:
 *   node ./scripts/figma_pipeline.mjs "<figma-url>"
 *
 * Automatically runs:
 *   1. bridge ensure + extract
 *   2. MCP merge (if cache is available)
 *   3. Cross-validation (gradient stroke downgrades, effect omissions, gradientTransform checks)
 *   4. Generate a baseline PNG
 *   5. Emit verification artifacts
 */

import { execSync, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { gradientPaintToCss } from './lib/gradient_to_css.mjs';
import { enrichNodeTokens, buildSubstitutionMap } from './lib/variable_substitution.mjs';
import { enrichComputedCss as enrichFullComputedCss } from './lib/computed_css.mjs';
import { makePreview } from './lib/preview_image.mjs';
import { buildOutline } from './lib/outline.mjs';
import { externalizeInferredVariables, externalizeVectorGeometry } from './lib/sidecar_externalize.mjs';
import { buildGlobals } from './lib/globals_dedup.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPTS = __dirname;
const SKILL_ROOT = path.resolve(__dirname, '..');

function run(cmd, opts = {}) {
  try {
    // maxBuffer: large Figma files can yield 100MB+ bridge JSON; 500MB gives headroom.
    return execSync(cmd, { encoding: 'utf-8', timeout: 600000, maxBuffer: 500 * 1024 * 1024, cwd: path.resolve(SKILL_ROOT, '../..'), ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function parseJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

// === Step 1: Bridge extract ===
function bridgeExtract(url) {
  console.log('\n[1/5] Bridge ensure + extract...');
  const ensureResult = parseJson(run(`node ${SCRIPTS}/bridge_client.mjs ensure`));
  if (!ensureResult?.ok) {
    console.error('  ✗ Bridge failed to start');
    return null;
  }
  console.log(`  ✓ Bridge is online (plugin connections: ${ensureResult.health?.pluginConnections || 0})`);

  const agentResult = parseJson(run(`node ${SCRIPTS}/bridge_client.mjs agent "${url}"`));
  if (!agentResult?.ok) {
    const errCode = agentResult?.errorCode || agentResult?.bridge?.errorCode || '';
    console.error(`  ✗ Node extraction failed${errCode ? ` [${errCode}]` : ''}: ${agentResult?.error || 'unknown'}`);
    return null;
  }
  console.log(`  ✓ Node extracted: ${agentResult.bridge?.node?.name || ''} (${agentResult.bridge?.diagnostics?.designSnapshot?.css?.attached || 0} CSS)`);
  return agentResult;
}

// === Step 1.5: Fetch deferred image assets ===
function fetchDeferredAssets(url, data) {
  if (!data) return;

  const imageAssets = data?.designSnapshot?.resources?.imageAssets;
  if (!imageAssets || typeof imageAssets !== 'object') return;

  const deferred = Object.entries(imageAssets).filter(
    ([, a]) => a && a.deferredBinary === true
  );
  if (deferred.length === 0) return;

  console.log(`\n[1.5/5] Fetching deferred image assets (${deferred.length})...`);

  let ok = 0;
  let fail = 0;
  for (const [hash] of deferred) {
    const result = parseJson(run(`node ${SCRIPTS}/bridge_client.mjs asset "${url}" "${hash}"`));
    if (result?.ok && result.filePath) {
      console.log(`  ✓ ${hash.slice(0, 12)}... → ${result.fileName} (${(result.byteLength / 1024).toFixed(0)}KB)`);
      ok++;
    } else {
      console.log(`  ✗ ${hash.slice(0, 12)}... failed: ${result?.error || 'unknown'}`);
      fail++;
    }
  }
  console.log(`  Totals: success ${ok}, failed ${fail}`);
}

// === Step 1.8: Inject computed gradient CSS per node ===
function enrichComputedCss(data, cacheDir, payloadPath) {
  const root = data?.designSnapshot?.root;
  if (!root) return 0;

  let enriched = 0;

  function walk(node) {
    const fills = node?.style?.fills;
    if (Array.isArray(fills) && fills.some((f) => f?.type?.startsWith('GRADIENT_'))) {
      const box = node?.layout?.absoluteBoundingBox || null;
      const gradientPaints = fills.filter((f) => f?.type?.startsWith('GRADIENT_') && f.visible !== false);
      const layers = [];
      for (let i = gradientPaints.length - 1; i >= 0; i -= 1) {
        const css = gradientPaintToCss(gradientPaints[i], box);
        if (css) layers.push(css);
      }
      if (layers.length > 0) {
        node.computedCss = node.computedCss || {};
        node.computedCss.background = layers.join(', ');
        enriched += 1;
      }
    }
    for (const child of node.children || []) walk(child);
  }

  walk(root);

  if (enriched > 0) {
    fs.writeFileSync(payloadPath, JSON.stringify(data, null, 2));
  }
  return enriched;
}

// === Step 1.9: Inject token refs + write substitution map ===
//
// defs.full (with per-mode resolved values) is intentionally stripped from
// bridge-agent-payload.json to keep that file small. Read it from the larger
// bridge-response.json for the substitution map — we do not carry the giant
// file into agent context afterwards.
function readDefsFullFromResponse(cacheDir) {
  const responsePath = path.join(cacheDir, 'bridge-response.json');
  if (!fs.existsSync(responsePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(responsePath, 'utf-8'));
    return raw?.defs?.full || null;
  } catch {
    return null;
  }
}

function enrichTokens(data, cacheDir, payloadPath) {
  const root = data?.designSnapshot?.root;
  if (!root) return { nodesEnriched: 0, variablesMapped: 0 };

  const nodesEnriched = enrichNodeTokens(root);

  const defsFull = readDefsFullFromResponse(cacheDir);
  const substitution = buildSubstitutionMap(defsFull);
  const variablesMapped = Object.keys(substitution).length;

  if (variablesMapped > 0) {
    fs.writeFileSync(
      path.join(cacheDir, 'variables-substitution-map.json'),
      JSON.stringify(substitution, null, 2)
    );
  }

  if (nodesEnriched > 0) {
    fs.writeFileSync(payloadPath, JSON.stringify(data, null, 2));
  }

  return { nodesEnriched, variablesMapped };
}

// === Step 2: Merge cache ===
function mergeCache(url) {
  console.log('\n[2/5] Merge cache...');
  const result = parseJson(run(`node ${SCRIPTS}/merge_cache.mjs "${url}"`));
  if (!result?.ok) {
    console.log('  ⚠ Merge skipped (no MCP cache was available or parsing failed)');
    return null;
  }
  console.log(`  ✓ Merge complete: ${result.mergedAgentPayload || ''}`);
  return result;
}

// === Step 3: cross-validation ===
function crossValidate(cacheDir, data) {
  console.log('\n[3/5] Cross-validating style.* vs node.css...');

  if (!data) {
    console.log('  ⚠ No agent payload was found; skipping validation');
    return [];
  }

  const root = data?.designSnapshot?.root;
  if (!root) {
    console.log('  ⚠ No designSnapshot was found; skipping validation');
    return [];
  }

  const warnings = [];

  function walk(node, depth = 0) {
    const nid = node.id || '';
    const name = node.name || '';
    const style = node.style || {};
    const css = node.css || {};

    // Check 1: gradient strokes were downgraded to solid borders in node.css
    const strokes = style.strokes || [];
    for (const stroke of strokes) {
      if (stroke.type?.startsWith('GRADIENT_') && stroke.visible !== false) {
        const cssBorder = css.border || '';
        if (cssBorder.includes('solid')) {
          warnings.push({
            level: 'HIGH',
            node: `${nid} (${name})`,
            issue: `Gradient stroke ${stroke.type} was downgraded to a solid border in node.css`,
            action: 'Use mask-composite or a gradient background plus padding. Do not trust node.css.border here.',
          });
        }
      }
    }

    // Check 2: effects exist but the expected node.css properties are missing
    const effects = style.effects || [];
    for (const effect of effects) {
      if (effect.visible === false) continue;
      if (effect.type === 'LAYER_BLUR') {
        if (!css.filter?.includes('blur')) {
          warnings.push({
            level: 'MEDIUM',
            node: `${nid} (${name})`,
            issue: `LAYER_BLUR radius=${effect.radius} did not appear in node.css.filter`,
            action: 'Check whether it was dropped. If blur and blend share the same element, split layers.',
          });
        }
        if (css['mix-blend-mode'] && css.filter?.includes('blur')) {
          warnings.push({
            level: 'HIGH',
            node: `${nid} (${name})`,
            issue: `node.css contains both filter: blur and mix-blend-mode, which creates an isolated compositing context`,
            action: 'Split this into parent/child DOM layers: outer blend, inner blur.',
          });
        }
      }
      if (effect.type === 'BACKGROUND_BLUR' && effect.blurType === 'PROGRESSIVE') {
        warnings.push({
          level: 'INFO',
          node: `${nid} (${name})`,
          issue: `Progressive BACKGROUND_BLUR (radius=${effect.radius}, start=${JSON.stringify(effect.startOffset)})`,
          action: 'CSS has no native progressive blur. Approximate with a masked blur region or escalate the route.',
        });
      }
    }

    // Check 3: gradientTransform means the original stop positions are not the rendered positions
    const fills = style.fills || [];
    for (const fill of fills) {
      if (fill.visible === false) continue;
      if (fill.gradientStops && fill.type?.startsWith('GRADIENT_')) {
        // Check if there's a non-identity gradientTransform
        const gt = fill.gradientTransform;
        if (gt && Array.isArray(gt) && gt.length === 2) {
          const isIdentity = Math.abs(gt[0][0] - 1) < 0.01 && Math.abs(gt[0][1]) < 0.01
            && Math.abs(gt[1][0]) < 0.01 && Math.abs(gt[1][1] - 1) < 0.01;
          if (!isIdentity) {
            warnings.push({
              level: 'MEDIUM',
              node: `${nid} (${name})`,
              issue: `The gradient has a gradientTransform, so the raw stop positions do not match the rendered positions`,
              action: 'Cross-check node.css percentage output or compute the actual positions from the transform matrix.',
            });
          }
        }
      }
    }

    // Check 4: when relativeTransform rotates the node, radial-gradient parameters cannot be applied naively to absoluteBoundingBox dimensions
    const layout = node.layout || {};
    const rt = layout.relativeTransform;
    if (rt && Array.isArray(rt) && rt.length === 2) {
      const a = rt[0][0], c = rt[1][0];
      const det = Math.abs(a * rt[1][1] - rt[0][1] * c);
      const isRotated = det > 0.99 && (Math.abs(a) < 0.99 || Math.abs(rt[1][1]) < 0.99);
      if (isRotated && fills.some(f => f.type?.includes('RADIAL'))) {
        const origW = layout.width;
        const absW = layout.absoluteBoundingBox?.width;
        if (origW && absW && Math.abs(origW - absW) > 1) {
          warnings.push({
            level: 'HIGH',
            node: `${nid} (${name})`,
            issue: `The node is rotated (raw ${origW.toFixed(0)} -> abs ${absW.toFixed(0)}), but node.css radial-gradient parameters are still based on the unrotated coordinate system`,
            action: 'Use absoluteBoundingBox for size/position and map the gradient center through relativeTransform.',
          });
        }
      }
    }

    for (const child of node.children || []) {
      walk(child, depth + 1);
    }
  }

  walk(root);

  if (warnings.length === 0) {
    console.log('  ✓ No validation warnings');
  } else {
    const high = warnings.filter(w => w.level === 'HIGH').length;
    const medium = warnings.filter(w => w.level === 'MEDIUM').length;
    const info = warnings.filter(w => w.level === 'INFO').length;
    console.log(`  ⚠ ${warnings.length} warnings (HIGH:${high} MEDIUM:${medium} INFO:${info})`);
    for (const w of warnings) {
      console.log(`  [${w.level}] ${w.node}: ${w.issue}`);
      console.log(`         → ${w.action}`);
    }
  }

  // Write validation report
  const reportPath = path.join(cacheDir, 'cross-validation-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ warnings, generatedAt: new Date().toISOString() }, null, 2));
  console.log(`  → Report: ${reportPath}`);

  return warnings;
}

// === Step 4: generate baseline ===
function externalizeSvgImages(svg, assetsDir) {
  if (!fs.existsSync(assetsDir)) return svg;

  return svg.replace(/href="data:image\/[^;]+;base64,([^"]+)"/g, (match, b64) => {
    try {
      const buf = Buffer.from(b64, 'base64');
      const hash = crypto.createHash('sha1').update(buf).digest('hex');
      // find matching asset file
      const candidates = fs.readdirSync(assetsDir).filter(f => f.startsWith(hash));
      if (candidates.length > 0) {
        const absPath = path.resolve(assetsDir, candidates[0]);
        return `href="file://${absPath}"`;
      }
    } catch (e) { /* keep original */ }
    return match;
  });
}

function generateBaseline(cacheDir, data) {
  console.log('\n[4/5] Generating baseline PNG...');

  if (!data) {
    console.log('  ⚠ No agent payload was found; skipping');
    return null;
  }

  // Emit a ≤1800px preview + sidecar meta so Claude can Read the baseline
  // without hitting the 2000px many-image limit. Original is left untouched
  // for SSIM/pixel-diff scoring. Consumers reading the preview MUST load
  // the meta sidecar to recover the scale ratio.
  const emitPreview = (pngPath) => {
    try {
      const res = makePreview(pngPath);
      if (res && !res.skipped) {
        console.log(`  ✓ Baseline preview created: ${res.preview} (scale recorded in ${path.basename(res.meta)})`);
      }
    } catch (e) {
      console.log(`  ⚠ Baseline preview failed: ${e.message}`);
    }
  };

  // A8 path: plugin may have uploaded a frame PNG baseline as
  // assets/_baseline_<node-id>.png. If present, promote it to baseline/baseline.png
  // and return directly.
  const baselineDir = path.join(cacheDir, 'baseline');
  const assetsDir = path.join(cacheDir, 'assets');
  if (fs.existsSync(assetsDir)) {
    const baselineAsset = fs.readdirSync(assetsDir).find(
      (f) => f.startsWith('_baseline_') && f.endsWith('.png')
    );
    if (baselineAsset) {
      fs.mkdirSync(baselineDir, { recursive: true });
      const src = path.join(assetsDir, baselineAsset);
      const dst = path.join(baselineDir, 'baseline.png');
      fs.copyFileSync(src, dst);
      const size = fs.statSync(dst).size;
      console.log(`  ✓ Baseline generated (plugin A8): ${dst} (${(size / 1024).toFixed(0)}KB)`);
      emitPreview(dst);
      return dst;
    }
  }

  const svg = data?.designSnapshot?.root?.svgString;
  if (!svg) {
    console.log('  ⚠ The node has no svgString and the plugin did not upload a baseline; skipping');
    return null;
  }

  fs.mkdirSync(baselineDir, { recursive: true });

  const svgExternalized = externalizeSvgImages(svg, assetsDir);
  const reduced = svgExternalized.length < svg.length;
  if (reduced) {
    console.log(`  ✓ Externalized SVG image references: ${(svg.length / 1024 / 1024).toFixed(1)}MB -> ${(svgExternalized.length / 1024 / 1024).toFixed(1)}MB`);
  }

  // Add a dark background
  const svgWithBg = svgExternalized.replace(/(<svg[^>]*>)/, '$1<rect width="100%" height="100%" fill="#000"/>');
  const svgPath = path.join(cacheDir, 'baseline-source.svg');
  fs.writeFileSync(svgPath, svgWithBg);

  // Try rsvg-convert first
  const hasRsvg = run('which rsvg-convert');
  const pngPath = path.join(baselineDir, 'baseline.png');

  if (hasRsvg) {
    const result = run(`rsvg-convert -z 2 -o "${pngPath}" "${svgPath}"`);
    if (result !== null || fs.existsSync(pngPath)) {
      const size = fs.statSync(pngPath).size;
      console.log(`  ✓ Baseline generated (rsvg): ${pngPath} (${(size / 1024).toFixed(0)}KB)`);
      emitPreview(pngPath);
      return pngPath;
    }
    console.log('  ⚠ rsvg-convert failed; trying the Chrome fallback...');
  }

  // fallback: headless Chrome
  const chrome = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'google-chrome',
    'chromium',
  ].find(c => run(`which "${c}"`) || fs.existsSync(c));

  if (!chrome) {
    console.log('  ✗ No usable renderer is available (requires rsvg-convert or Chrome)');
    return null;
  }

  // Window-size is in CSS px; --force-device-scale-factor=2 multiplies the
  // raster output. Earlier this passed `--window-size=2880,2048 --DPR=2`,
  // which double-scaled to a 5760x4096 PNG and broke baseline-vs-candidate
  // pixel alignment. Derive the design size from data.designSnapshot.root,
  // fall back to 1440x900 if missing. Use --headless=new (modern, no chrome
  // overhead — same reasoning as verify_loop's screenshot path).
  const rootBox = data?.designSnapshot?.root?.layout?.absoluteBoundingBox || {};
  const cssW = Math.ceil(rootBox.width || 1440);
  const cssH = Math.ceil(rootBox.height || 900);
  const chromeResult = run(`"${chrome}" --headless=new --disable-gpu --no-sandbox --screenshot="${pngPath}" --window-size=${cssW},${cssH} --force-device-scale-factor=2 --hide-scrollbars "file://${path.resolve(svgPath)}"`);
  if (fs.existsSync(pngPath)) {
    const size = fs.statSync(pngPath).size;
    console.log(`  ✓ Baseline generated (Chrome): ${pngPath} (${(size / 1024).toFixed(0)}KB)`);
    emitPreview(pngPath);
    return pngPath;
  }

  console.log('  ✗ Failed to generate a baseline');
  return null;
}

// === Step 5: summary ===
function summary(agentResult, warnings, baselinePath) {
  console.log('\n[5/5] Summary');
  console.log('─'.repeat(50));

  const node = agentResult?.bridge?.node;
  const target = agentResult?.bridge?.target;
  console.log(`  Node: ${node?.name || 'unknown'} (${node?.id || ''})`);
  console.log(`  Type: ${node?.type || ''}`);
  if (target?.url) {
    console.log(`  Link: ${target.url}`);
  }

  const diag = agentResult?.bridge?.diagnostics?.designSnapshot;
  if (diag) {
    console.log(`  CSS: ${diag.css?.attached || 0}/${diag.css?.requested || 0}`);
    console.log(`  SVG: ${diag.svg?.attached || 0}/${diag.svg?.requested || 0}`);
    console.log(`  Images: ${diag.imageAssets?.resolved || 0}/${diag.imageAssets?.requested || 0}`);
  }

  const high = warnings.filter(w => w.level === 'HIGH');
  if (high.length > 0) {
    console.log(`\n  ⚠ ${high.length} HIGH-severity warnings must be handled before writing code:`);
    for (const w of high) {
      console.log(`    - ${w.node}: ${w.issue}`);
    }
  }

  if (baselinePath) {
    console.log(`\n  baseline: ${baselinePath}`);
  console.log(`  Acceptance: python3 ./scripts/fidelity_scorecard.py --baseline ${baselinePath} --candidate <screenshot> --mode region`);
  }

  console.log('─'.repeat(50));
}

// === Main ===
async function runDownstream(cacheDir) {
  const out = path.join(SKILL_ROOT, '..', '..', 'output', path.basename(cacheDir));
  console.log(`\n[6/7] codegen (render-ready → mechanical React project)…`);
  const codegenRes = spawnSync(process.execPath, [
    path.join(SCRIPTS, 'codegen_pipeline.mjs'),
    cacheDir,
    out,
    '--project-name',
    `gen-${path.basename(cacheDir)}`,
  ], { stdio: 'inherit' });
  if (codegenRes.status !== 0) {
    console.error('  ✗ codegen failed');
    return;
  }
  console.log(`\n[7/7] verify_loop (vite + screenshot + lint + scorecard)…`);
  const verifyRes = spawnSync(process.execPath, [
    path.join(SCRIPTS, 'verify_loop.mjs'),
    '--cache',
    cacheDir,
    '--project',
    out,
    '--install',
  ], { stdio: 'inherit' });
  if (verifyRes.status !== 0) {
    console.log('  ⚠ verify reported issues — see _verify/ under cache dir');
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const url = argv.filter((a) => !a.startsWith('--')).join(' ').trim();
  const auto = flags.has('--auto') || flags.has('--codegen');
  if (!url) {
    console.log('Usage: node ./scripts/figma_pipeline.mjs [--auto] "<figma-url-or-node-id>"');
    console.log('  --auto   run extract + render_ready + codegen + verify_loop end-to-end');
    process.exit(1);
  }

  console.log(`Figma Pipeline: ${url}`);

  const agentResult = bridgeExtract(url);
  if (!agentResult) process.exit(1);

  const resolvedUrl = agentResult.bridge?.target?.url || url;
  if (resolvedUrl !== url) {
    console.log(`  → Resolved full URL: ${resolvedUrl}`);
  }

  const cacheDir = agentResult.bridge?.cacheDir
    || agentResult.cacheDir;

  if (!cacheDir) {
    console.error('Could not determine the cache directory');
    process.exit(1);
  }

  const payloadPath = path.join(cacheDir, 'bridge-agent-payload.json');
  let agentPayload = fs.existsSync(payloadPath)
    ? JSON.parse(fs.readFileSync(payloadPath, 'utf-8'))
    : null;

  fetchDeferredAssets(resolvedUrl, agentPayload);
  if (agentPayload) {
    const enriched = enrichComputedCss(agentPayload, cacheDir, payloadPath);
    if (enriched > 0) {
      console.log(`\n[1.8/5] Gradient CSS computed: ${enriched} nodes now carry computedCss.background`);
    }
    const tokens = enrichTokens(agentPayload, cacheDir, payloadPath);
    if (tokens.nodesEnriched > 0 || tokens.variablesMapped > 0) {
      console.log(
        `\n[1.9/5] Variable bindings: ${tokens.nodesEnriched} nodes now carry computedCss.tokens, ` +
          `and variables-substitution-map.json contains ${tokens.variablesMapped} entries`
      );
    }
    // Step 1.10: aggregate full computedCss + computedHtml per node so the
    // agent can consume values directly without re-deriving layout/appearance.
    // Pass cache-manifest assetFiles so IMAGE fills resolve to real fileName
    // (correct sniffed extension) instead of guessing .png.
    const manifestPath = path.join(cacheDir, 'cache-manifest.json');
    let assetFiles = {};
    if (fs.existsSync(manifestPath)) {
      try {
        const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        assetFiles = mf.assetFiles || {};
      } catch {}
    }
    const ccCtx = { assetFiles };
    const fullEnriched = enrichFullComputedCss(agentPayload?.designSnapshot?.root, ccCtx);
    if (fullEnriched > 0) {
      const inlined = ccCtx.inlinedSvgs || 0;
      console.log(
        `\n[1.10/5] Full computedCss: ${fullEnriched} nodes now carry computedCss.full / computedHtml` +
        (inlined > 0 ? ` (${inlined} SVGs were inlined)` : '')
      );
    }

    // Sidecar externalization (MCP-style progressive disclosure) — run AFTER
    // all enrichments so the main bridge-agent-payload shrinks before the
    // single re-save below. All helpers are idempotent (return nodes: 0 if
    // already processed on a previous run).
    const root = agentPayload?.designSnapshot?.root;
    const extInf = root ? externalizeInferredVariables(root, cacheDir) : null;
    const extGeo = root ? externalizeVectorGeometry(root, cacheDir) : null;
    const extInfMb = extInf ? (extInf.bytesRemoved / 1024 / 1024).toFixed(2) : '0.00';
    const extGeoMb = extGeo ? (extGeo.bytesRemoved / 1024 / 1024).toFixed(2) : '0.00';
    if (extInf?.nodes || extGeo?.nodes) {
      console.log(
        `\n[1.11/5] Externalized sidecars:` +
        (extInf?.nodes ? ` variables.inferred (${extInf.nodes} nodes, -${extInfMb}MB) -> variables-inferred.json;` : '') +
        (extGeo?.nodes ? ` vector.geometry (${extGeo.nodes} nodes, -${extGeoMb}MB) -> blobs/geom-*.json` : '')
      );
    }

    // Globals dedup (MCP-style — one canonical copy per unique paint / stroke
    // / effect bundle, referenced by stable hash from each node). Additive:
    // inline `style.fills/strokes/effects` stay; we attach `style.fillId`
    // etc. next to them. globals.json written to cache root.
    let globalsStats = null;
    if (root) {
      const { globals, stats } = buildGlobals(root);
      if (stats.hits.fills || stats.hits.strokes || stats.hits.effects) {
        const globalsPath = path.join(cacheDir, 'globals.json');
        fs.writeFileSync(
          globalsPath,
          JSON.stringify(
            {
              schemaVersion: 1,
              generatedAt: new Date().toISOString(),
              note: 'Content-hashed paint/stroke/effect bundles, referenced per-node via style.fillId / strokeId / effectId. Inline style.fills[]/strokes[]/effects[] on each node are STILL present in bridge-agent-payload.json for backward compat.',
              stats,
              ...globals,
            },
            null,
            2
          )
        );
        globalsStats = stats;
        console.log(
          `\n[1.12/5] globals.json: ${stats.hits.fills} fills → ${stats.uniqueFills} unique; ` +
          `${stats.hits.strokes} strokes → ${stats.uniqueStrokes}; ` +
          `${stats.hits.effects} effects → ${stats.uniqueEffects}`
        );
      }
    }

    // Single re-save after all enrichment + externalization + globals id refs.
    if (fullEnriched > 0 || extInf?.nodes || extGeo?.nodes || globalsStats) {
      fs.writeFileSync(payloadPath, JSON.stringify(agentPayload, null, 2));
    }
  }
  mergeCache(resolvedUrl);
  const warnings = crossValidate(cacheDir, agentPayload);
  const baselinePath = generateBaseline(cacheDir, agentPayload);

  // Sparse outline sidecar — always emitted after bridge extract so LLMs /
  // tooling can plan against cheap node metadata without reading the 9MB
  // payload. Written to <cacheDir>/outline.json. render_ready.mjs also emits
  // this when it runs (e.g. via --auto codegen); emitting here too means
  // non-auto runs still get the artifact.
  try {
    const outlineRoot = agentPayload?.designSnapshot?.root;
    if (outlineRoot) {
      const outline = buildOutline(outlineRoot);
      const outlinePath = path.join(cacheDir, 'outline.json');
      fs.writeFileSync(outlinePath, JSON.stringify(outline, null, 2));
      const sizeKb = (fs.statSync(outlinePath).size / 1024).toFixed(1);
      console.log(`\n[artifact] outline.json (${outline.totalNodes} nodes, ${sizeKb}KB): ${outlinePath}`);
    }
  } catch (e) {
    console.log(`\n[artifact] outline.json generation failed: ${e.message}`);
  }

  summary(agentResult, warnings, baselinePath);
  agentPayload = null; // release for GC

  if (auto) {
    await runDownstream(cacheDir);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
