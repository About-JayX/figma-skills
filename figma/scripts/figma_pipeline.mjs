#!/usr/bin/env node
/**
 * Figma 一键还原 Pipeline
 *
 * 用法:
 *   node ./scripts/figma_pipeline.mjs "<figma-url>"
 *
 * 自动执行:
 *   1. bridge ensure + extract
 *   2. MCP merge (如果有缓存)
 *   3. 交叉校验 (style.strokes 渐变降级、effects 跳过、gradientTransform 检查)
 *   4. 生成 baseline PNG (rsvg-convert)
 *   5. 输出校验报告
 */

import { execSync, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { gradientPaintToCss } from './lib/gradient_to_css.mjs';
import { enrichNodeTokens, buildSubstitutionMap } from './lib/variable_substitution.mjs';
import { enrichComputedCss as enrichFullComputedCss } from './lib/computed_css.mjs';

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
    console.error('  ✗ Bridge 启动失败');
    return null;
  }
  console.log(`  ✓ Bridge 在线 (plugin connections: ${ensureResult.health?.pluginConnections || 0})`);

  const agentResult = parseJson(run(`node ${SCRIPTS}/bridge_client.mjs agent "${url}"`));
  if (!agentResult?.ok) {
    const errCode = agentResult?.errorCode || agentResult?.bridge?.errorCode || '';
    console.error(`  ✗ 节点提取失败${errCode ? ` [${errCode}]` : ''}: ${agentResult?.error || 'unknown'}`);
    return null;
  }
  console.log(`  ✓ 节点提取成功: ${agentResult.bridge?.node?.name || ''} (${agentResult.bridge?.diagnostics?.designSnapshot?.css?.attached || 0} CSS)`);
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

  console.log(`\n[1.5/5] 拉取延迟图片资源 (${deferred.length} 张)...`);

  let ok = 0;
  let fail = 0;
  for (const [hash] of deferred) {
    const result = parseJson(run(`node ${SCRIPTS}/bridge_client.mjs asset "${url}" "${hash}"`));
    if (result?.ok && result.filePath) {
      console.log(`  ✓ ${hash.slice(0, 12)}... → ${result.fileName} (${(result.byteLength / 1024).toFixed(0)}KB)`);
      ok++;
    } else {
      console.log(`  ✗ ${hash.slice(0, 12)}... 失败: ${result?.error || 'unknown'}`);
      fail++;
    }
  }
  console.log(`  合计: 成功 ${ok}, 失败 ${fail}`);
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
    console.log('  ⚠ Merge 跳过 (无 MCP 缓存或解析失败)');
    return null;
  }
  console.log(`  ✓ 合并完成: ${result.mergedAgentPayload || ''}`);
  return result;
}

// === Step 3: 交叉校验 ===
function crossValidate(cacheDir, data) {
  console.log('\n[3/5] 交叉校验 style.* vs node.css...');

  if (!data) {
    console.log('  ⚠ 无 agent payload，跳过校验');
    return [];
  }

  const root = data?.designSnapshot?.root;
  if (!root) {
    console.log('  ⚠ 无 designSnapshot，跳过校验');
    return [];
  }

  const warnings = [];

  function walk(node, depth = 0) {
    const nid = node.id || '';
    const name = node.name || '';
    const style = node.style || {};
    const css = node.css || {};

    // Check 1: 渐变描边被 node.css 降级为 solid
    const strokes = style.strokes || [];
    for (const stroke of strokes) {
      if (stroke.type?.startsWith('GRADIENT_') && stroke.visible !== false) {
        const cssBorder = css.border || '';
        if (cssBorder.includes('solid')) {
          warnings.push({
            level: 'HIGH',
            node: `${nid} (${name})`,
            issue: `渐变描边 ${stroke.type} 被 node.css 降级为 solid border`,
            action: '必须用 mask-composite 或渐变背景+padding 实现，不能信 node.css.border',
          });
        }
      }
    }

    // Check 2: effects 是否存在但 node.css 中缺少对应属性
    const effects = style.effects || [];
    for (const effect of effects) {
      if (effect.visible === false) continue;
      if (effect.type === 'LAYER_BLUR') {
        if (!css.filter?.includes('blur')) {
          warnings.push({
            level: 'MEDIUM',
            node: `${nid} (${name})`,
            issue: `LAYER_BLUR radius=${effect.radius} 未出现在 node.css.filter 中`,
            action: '检查是否被省略，如果 blur+blend 同元素需要拆层',
          });
        }
        if (css['mix-blend-mode'] && css.filter?.includes('blur')) {
          warnings.push({
            level: 'HIGH',
            node: `${nid} (${name})`,
            issue: `node.css 同时有 filter:blur 和 mix-blend-mode，CSS 会创建隔离上下文`,
            action: '拆成父子两层 DOM：外层 blend，内层 blur',
          });
        }
      }
      if (effect.type === 'BACKGROUND_BLUR' && effect.blurType === 'PROGRESSIVE') {
        warnings.push({
          level: 'INFO',
          node: `${nid} (${name})`,
          issue: `Progressive BACKGROUND_BLUR (radius=${effect.radius}, start=${JSON.stringify(effect.startOffset)})`,
          action: 'CSS 无原生 progressive blur，用 mask-image 限制 blur 区域近似',
        });
      }
    }

    // Check 3: fills 有 gradientTransform 时 stop 位置 ≠ 渲染位置
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
              issue: `渐变有 gradientTransform，原始 stop 位置 ≠ 渲染位置`,
              action: '交叉参考 node.css 中的百分比值，或通过矩阵计算实际位置',
            });
          }
        }
      }
    }

    // Check 4: 有 relativeTransform 旋转时 node.css 的 radial-gradient 参数不可直接用于 absoluteBoundingBox 尺寸
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
            issue: `节点有旋转 (原始${origW.toFixed(0)} → abs${absW.toFixed(0)})，node.css radial-gradient 参数基于未旋转坐标系`,
            action: '用 absoluteBoundingBox 位置+尺寸，渐变中心通过 relativeTransform 矩阵映射',
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
    console.log('  ✓ 无校验警告');
  } else {
    const high = warnings.filter(w => w.level === 'HIGH').length;
    const medium = warnings.filter(w => w.level === 'MEDIUM').length;
    const info = warnings.filter(w => w.level === 'INFO').length;
    console.log(`  ⚠ ${warnings.length} 条警告 (HIGH:${high} MEDIUM:${medium} INFO:${info})`);
    for (const w of warnings) {
      console.log(`  [${w.level}] ${w.node}: ${w.issue}`);
      console.log(`         → ${w.action}`);
    }
  }

  // 写入校验报告
  const reportPath = path.join(cacheDir, 'cross-validation-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ warnings, generatedAt: new Date().toISOString() }, null, 2));
  console.log(`  → 报告: ${reportPath}`);

  return warnings;
}

// === Step 4: 生成 baseline ===
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
  console.log('\n[4/5] 生成 baseline PNG...');

  if (!data) {
    console.log('  ⚠ 无 agent payload，跳过');
    return null;
  }

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
      console.log(`  ✓ baseline 生成 (plugin A8): ${dst} (${(size / 1024).toFixed(0)}KB)`);
      return dst;
    }
  }

  const svg = data?.designSnapshot?.root?.svgString;
  if (!svg) {
    console.log('  ⚠ 节点无 svgString 且 plugin 未上传 baseline，跳过');
    return null;
  }

  fs.mkdirSync(baselineDir, { recursive: true });

  const svgExternalized = externalizeSvgImages(svg, assetsDir);
  const reduced = svgExternalized.length < svg.length;
  if (reduced) {
    console.log(`  ✓ SVG 图片外部化: ${(svg.length / 1024 / 1024).toFixed(1)}MB → ${(svgExternalized.length / 1024 / 1024).toFixed(1)}MB`);
  }

  // 加深色背景
  const svgWithBg = svgExternalized.replace(/(<svg[^>]*>)/, '$1<rect width="100%" height="100%" fill="#000"/>');
  const svgPath = path.join(cacheDir, 'baseline-source.svg');
  fs.writeFileSync(svgPath, svgWithBg);

  // 尝试 rsvg-convert
  const hasRsvg = run('which rsvg-convert');
  const pngPath = path.join(baselineDir, 'baseline.png');

  if (hasRsvg) {
    const result = run(`rsvg-convert -z 2 -o "${pngPath}" "${svgPath}"`);
    if (result !== null || fs.existsSync(pngPath)) {
      const size = fs.statSync(pngPath).size;
      console.log(`  ✓ baseline 生成 (rsvg): ${pngPath} (${(size / 1024).toFixed(0)}KB)`);
      return pngPath;
    }
    console.log('  ⚠ rsvg-convert 失败，尝试 Chrome fallback...');
  }

  // fallback: headless Chrome
  const chrome = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'google-chrome',
    'chromium',
  ].find(c => run(`which "${c}"`) || fs.existsSync(c));

  if (!chrome) {
    console.log('  ✗ 无可用渲染器 (需要 rsvg-convert 或 Chrome)');
    return null;
  }

  const chromeResult = run(`"${chrome}" --headless --disable-gpu --screenshot="${pngPath}" --window-size=2880,2048 --force-device-scale-factor=2 "file://${path.resolve(svgPath)}"`);
  if (fs.existsSync(pngPath)) {
    const size = fs.statSync(pngPath).size;
    console.log(`  ✓ baseline 生成 (chrome): ${pngPath} (${(size / 1024).toFixed(0)}KB)`);
    return pngPath;
  }

  console.log('  ✗ baseline 生成失败');
  return null;
}

// === Step 5: 汇总 ===
function summary(agentResult, warnings, baselinePath) {
  console.log('\n[5/5] 汇总');
  console.log('─'.repeat(50));

  const node = agentResult?.bridge?.node;
  const target = agentResult?.bridge?.target;
  console.log(`  节点: ${node?.name || 'unknown'} (${node?.id || ''})`);
  console.log(`  类型: ${node?.type || ''}`);
  if (target?.url) {
    console.log(`  链接: ${target.url}`);
  }

  const diag = agentResult?.bridge?.diagnostics?.designSnapshot;
  if (diag) {
    console.log(`  CSS: ${diag.css?.attached || 0}/${diag.css?.requested || 0}`);
    console.log(`  SVG: ${diag.svg?.attached || 0}/${diag.svg?.requested || 0}`);
    console.log(`  图片: ${diag.imageAssets?.resolved || 0}/${diag.imageAssets?.requested || 0}`);
  }

  const high = warnings.filter(w => w.level === 'HIGH');
  if (high.length > 0) {
    console.log(`\n  ⚠ ${high.length} 条 HIGH 级警告，写代码前必须处理:`);
    for (const w of high) {
      console.log(`    - ${w.node}: ${w.issue}`);
    }
  }

  if (baselinePath) {
    console.log(`\n  baseline: ${baselinePath}`);
    console.log(`  验收: python3 ./scripts/fidelity_scorecard.py --baseline ${baselinePath} --candidate <截图> --mode region`);
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
    console.log('用法: node ./scripts/figma_pipeline.mjs [--auto] "<figma-url-or-node-id>"');
    console.log('  --auto   extract + render_ready + codegen + verify_loop 一条龙');
    process.exit(1);
  }

  console.log(`Figma Pipeline: ${url}`);

  const agentResult = bridgeExtract(url);
  if (!agentResult) process.exit(1);

  const resolvedUrl = agentResult.bridge?.target?.url || url;
  if (resolvedUrl !== url) {
    console.log(`  → 解析到完整链接: ${resolvedUrl}`);
  }

  const cacheDir = agentResult.bridge?.cacheDir
    || agentResult.cacheDir;

  if (!cacheDir) {
    console.error('无法确定 cache 目录');
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
      console.log(`\n[1.8/5] 渐变 CSS 已计算: ${enriched} 个节点挂载 computedCss.background`);
    }
    const tokens = enrichTokens(agentPayload, cacheDir, payloadPath);
    if (tokens.nodesEnriched > 0 || tokens.variablesMapped > 0) {
      console.log(
        `\n[1.9/5] 变量绑定: ${tokens.nodesEnriched} 个节点挂载 computedCss.tokens，` +
          `variables-substitution-map.json 含 ${tokens.variablesMapped} 条`
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
      fs.writeFileSync(payloadPath, JSON.stringify(agentPayload, null, 2));
      const inlined = ccCtx.inlinedSvgs || 0;
      console.log(
        `\n[1.10/5] computedCss 全量: ${fullEnriched} 个节点挂载 computedCss.full / computedHtml` +
        (inlined > 0 ? `（其中 ${inlined} 个 SVG 已 inline）` : '')
      );
    }
  }
  mergeCache(resolvedUrl);
  const warnings = crossValidate(cacheDir, agentPayload);
  const baselinePath = generateBaseline(cacheDir, agentPayload);
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
