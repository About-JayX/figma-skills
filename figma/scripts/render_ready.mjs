#!/usr/bin/env node
// Stage 1 — renderReady preprocessor.
// Post-processes a Figma bridge cache into a flat, "render-ready" structure:
//   * hidden / opacity=0 nodes filtered out
//   * effectiveGap computed from absoluteBoundingBox (resolves FILL+grow swallowing itemSpacing)
//   * CSS variables resolved to hex
//   * IMAGE paint → assets/<hash>.<ext> path (or fallbackColor when missing)
//   * className contract: `n-<id with : and ; → ->` (for parallel JSX/CSS codegen)
//
// Usage:
//   node skills/figma/scripts/render_ready.mjs <cache-dir>
//   -> writes <cache-dir>/render-ready.json

import fs from 'fs';
import path from 'path';

const GEOMETRY_TOL = 0.5;

// ────────────── utilities ──────────────

function sanitizeId(s) {
  return String(s).replace(/[:;]/g, '-');
}

function classNameFor(node) {
  return `n-${sanitizeId(node.id)}`;
}

function rgba(c) {
  if (!c) return null;
  const r = Math.round((c.r ?? 0) * 255);
  const g = Math.round((c.g ?? 0) * 255);
  const b = Math.round((c.b ?? 0) * 255);
  const a = c.a ?? 1;
  if (a >= 0.999) return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  return `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})`;
}

function effectiveGapFromAbs(children, isH) {
  if (!children || children.length < 2) return { value: null, uniform: true };
  const gaps = [];
  for (let i = 0; i < children.length - 1; i++) {
    const a = children[i].layout?.absoluteBoundingBox;
    const b = children[i + 1].layout?.absoluteBoundingBox;
    if (!a || !b) return { value: null, uniform: true };
    gaps.push(isH ? b.x - (a.x + a.width) : b.y - (a.y + a.height));
  }
  const first = gaps[0];
  const uniform = gaps.every((g) => Math.abs(g - first) < GEOMETRY_TOL);
  return { value: first, uniform, samples: gaps };
}

// ────────────── resolve per-node style ──────────────

function resolveSolidPaint(paints) {
  if (!Array.isArray(paints)) return null;
  for (const p of paints) {
    if (p?.visible === false) continue;
    if (p?.type === 'SOLID') return rgba(p.color);
  }
  return null;
}

function extractImagePaint(paints, assetsIndex) {
  if (!Array.isArray(paints)) return null;
  for (const p of paints) {
    if (p?.visible === false) continue;
    if (p?.type === 'IMAGE' && p.imageHash) {
      const asset = assetsIndex.get(p.imageHash);
      return {
        hash: p.imageHash,
        path: asset ? `./assets/${asset.file}` : null,
        fallbackColor: null,
        scaleMode: p.scaleMode || 'FILL',
        opacity: p.opacity ?? 1,
        kind: 'image',
      };
    }
    if (p?.type === 'VIDEO' && p.videoHash) {
      // Figma VIDEO fills can't be reproduced in static HTML without exporting a still
      // frame. Record it so downstream knows to render a dark placeholder (similar tone
      // to the video's first frame — chosen empirically dark since most videos in dark
      // designs start with dark content).
      return {
        hash: p.videoHash,
        path: null,
        fallbackColor: '#1a1a1a',
        scaleMode: p.scaleMode || 'CROP',
        opacity: p.opacity ?? 1,
        kind: 'video',
      };
    }
  }
  return null;
}

function extractEffects(effects) {
  if (!Array.isArray(effects)) return [];
  const out = [];
  for (const e of effects) {
    if (!e || e.visible === false) continue;
    const type = e.type;
    const radius = e.radius;
    const color = rgba(e.color);
    const off = e.offset || { x: 0, y: 0 };
    if (type === 'DROP_SHADOW') {
      out.push({ kind: 'box-shadow', value: `${off.x}px ${off.y}px ${radius}px ${e.spread || 0}px ${color || 'rgba(0,0,0,0.25)'}` });
    } else if (type === 'INNER_SHADOW') {
      out.push({ kind: 'box-shadow', value: `inset ${off.x}px ${off.y}px ${radius}px ${e.spread || 0}px ${color || 'rgba(0,0,0,0.25)'}` });
    } else if (type === 'LAYER_BLUR') {
      out.push({ kind: 'filter', value: `blur(${radius}px)` });
    } else if (type === 'BACKGROUND_BLUR') {
      out.push({ kind: 'backdrop-filter', value: `blur(${radius}px)` });
    }
  }
  return out;
}

function extractTextFromComputedHtml(html) {
  if (!html || typeof html !== 'string') return null;
  // Strip all tags, decode a few common entities
  const stripped = html.replace(/<[^>]+>/g, '').trim();
  if (!stripped) return null;
  return stripped
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Bridge's computedCss.full is a CSS declaration string like
//   "display: flex; font-family: 'DM Sans'; font-size: 14px; ..."
// Parse it into a plain object. Declarations with complex values (e.g. url(), gradient())
// are kept verbatim; simple value types are returned as-is strings.
function parseComputedCss(full) {
  if (!full || typeof full !== 'string') return {};
  const out = {};
  // Split on `;` but respect parens (url(a;b) shouldn't split there). Simple state machine:
  let depth = 0;
  let current = '';
  const parts = [];
  for (const ch of full) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ';' && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  for (const p of parts) {
    const idx = p.indexOf(':');
    if (idx < 0) continue;
    const k = p.slice(0, idx).trim().toLowerCase();
    const v = p.slice(idx + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

function unquoteFontFamily(v) {
  if (!v) return null;
  // Take first family only — Figma typically emits a single quoted name, we add fallback later
  const first = v.split(',')[0].trim();
  return first.replace(/^['"]|['"]$/g, '') || null;
}

function parsePx(v) {
  if (!v || typeof v !== 'string') return null;
  const m = v.trim().match(/^(-?\d+(?:\.\d+)?)(px)?$/);
  return m ? Number(m[1]) : null;
}

// border-radius can be "30px" or "30px 16px 16px 30px" or "30px 16px" (shorthand 2-value).
function parseBorderRadius(v) {
  if (!v || typeof v !== 'string') return null;
  const nums = v.trim().split(/\s+/).map((p) => parsePx(p)).filter((n) => n != null);
  if (nums.length === 0) return null;
  if (nums.length === 1) return nums[0];
  if (nums.length === 2) return [nums[0], nums[1], nums[0], nums[1]]; // top|bottom, left|right
  if (nums.length === 3) return [nums[0], nums[1], nums[2], nums[1]];
  return [nums[0], nums[1], nums[2], nums[3]];
}

function buildTextRun(node, parsedCss) {
  const segs = node.style?.textSegments || [];
  // Content extraction — always prefer computedHtml first (Figma's rendered text
  // supports component-instance overrides, multi-run merges, and inline edits that
  // textSegments may miss). Fall back chain: computedHtml → segments concat → characters → name.
  const fromHtml = extractTextFromComputedHtml(node.computedHtml);
  const fromSegs = segs.length ? segs.map((x) => x.characters).join('') : null;
  const content = fromHtml || fromSegs || node.characters || node.name || '';

  // B1 — When textSegments is empty (typically COMPONENT INSTANCE), fall back to parsed
  // computedCss.full to pull typography. Bridge's computed CSS is the closest thing to
  // "what Figma actually rendered".
  if (segs.length === 0) {
    // fontSize fallback — computedCss.full sometimes omits it; derive from box.height
    // assuming single-line (height ≈ lineHeight ≈ 1.4 × fontSize) when height is small.
    let fontSize = parsePx(parsedCss['font-size']) || null;
    if (!fontSize && typeof node.layout?.height === 'number') {
      const h = node.layout.height;
      // Only derive for plausibly single-line text; multi-line boxes usually have correct font-size.
      if (h >= 10 && h <= 200) fontSize = Math.round(h / 1.2);
    }
    return {
      content,
      fontFamily: unquoteFontFamily(parsedCss['font-family']) || null,
      fontSize,
      fontWeight: parsedCss['font-weight'] || null,
      lineHeight: parsedCss['line-height'] || null,
      letterSpacing: parsedCss['letter-spacing'] || null,
      color: parsedCss['color'] || null,
      textAlign: parsedCss['text-align'] || null,
    };
  }
  const s = segs[0];
  return {
    content,
    // Prefer segment data (more structured), but fall back to parsed CSS when a field
    // is missing — covers partial/incomplete segment data.
    fontFamily: s.fontName?.family || unquoteFontFamily(parsedCss['font-family']) || null,
    fontSize: s.fontSize || parsePx(parsedCss['font-size']) || null,
    fontWeight: s.fontWeight || s.fontName?.style || parsedCss['font-weight'] || null,
    lineHeight: (() => {
      const lh = s.lineHeight;
      if (lh?.unit === 'PIXELS') return `${lh.value}px`;
      if (lh?.unit === 'PERCENT') return `${lh.value}%`;
      return parsedCss['line-height'] || null;
    })(),
    letterSpacing: (() => {
      const ls = s.letterSpacing;
      if (ls?.unit === 'PIXELS') return `${ls.value}px`;
      if (ls?.unit === 'PERCENT') return `${+((ls.value ?? 0) / 100).toFixed(4)}em`;
      return parsedCss['letter-spacing'] || null;
    })(),
    color: resolveSolidPaint(s.fills) || parsedCss['color'] || null,
    textAlign: parsedCss['text-align'] || null,
  };
}

// ────────────── walk ──────────────

function indexAssets(cacheDir) {
  const dir = path.join(cacheDir, 'assets');
  const idx = new Map();
  if (!fs.existsSync(dir)) return idx;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith('_baseline')) continue;
    const m = f.match(/^([0-9a-f]{40})\.([a-z]+)$/i);
    if (!m) continue;
    idx.set(m[1], { file: f, ext: m[2] });
  }
  return idx;
}

function indexSvgs(cacheDir) {
  const dir = path.join(cacheDir, 'blobs');
  const idx = new Map();
  if (!fs.existsSync(dir)) return idx;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.svg')) continue;
    // svg-<sanitized-nodeId>.svg → map sanitized-id to filename
    const m = f.match(/^svg-(.+)\.svg$/);
    if (!m) continue;
    idx.set(m[1], f);
  }
  return idx;
}

function buildRenderReady(root, assetsIndex, svgIndex) {
  const flat = [];
  const skipped = [];

  (function visit(node, parentId) {
    // Skip hidden / zero-opacity subtrees entirely
    if (node.visible === false) {
      skipped.push({ id: node.id, reason: 'visible=false' });
      return;
    }
    const opacity = node.style?.opacity ?? 1;
    if (opacity === 0) {
      skipped.push({ id: node.id, reason: 'opacity=0' });
      return;
    }

    const layout = node.layout || {};
    const style = node.style || {};
    const kids = (node.children || []).filter(
      (c) => c.visible !== false && (c.style?.opacity ?? 1) !== 0
    );
    // Parse bridge's computedCss.full once per node (used by B1 text fallback, B3 radius fallback)
    const parsedCss = parseComputedCss(node.computedCss?.full);

    const role = (() => {
      if (node.type === 'TEXT') return 'text';
      if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') return 'vector';
      const hasImg = (style.fills || []).some((p) => p?.visible !== false && p?.type === 'IMAGE');
      if (hasImg) return 'image';
      return 'container';
    })();

    const isH = layout.layoutMode === 'HORIZONTAL';
    const isV = layout.layoutMode === 'VERTICAL';
    const autoLayout = isH || isV;

    // Only compute effectiveGap for children that participate in the flow
    const flowKids = kids.filter((c) => c.layout?.layoutPositioning !== 'ABSOLUTE');
    const eff = autoLayout ? effectiveGapFromAbs(flowKids, isH) : { value: null, uniform: true };

    const record = {
      id: node.id,
      className: classNameFor(node),
      parentId,
      type: node.type,
      role,
      name: node.name,
      childrenOrder: kids.map((c) => c.id),
      box: {
        width: layout.width,
        height: layout.height,
        absX: layout.absoluteBoundingBox?.x,
        absY: layout.absoluteBoundingBox?.y,
      },
      flex: autoLayout
        ? {
            direction: isH ? 'row' : 'column',
            wrap: layout.layoutWrap === 'WRAP',
            effectiveGap: eff.value,
            gapUniform: eff.uniform,
            padding: [layout.paddingTop || 0, layout.paddingRight || 0, layout.paddingBottom || 0, layout.paddingLeft || 0],
            justify: layout.primaryAxisAlignItems,
            align: layout.counterAxisAlignItems,
            children: kids.map((c) => ({
              id: c.id,
              positioning: c.layout?.layoutPositioning || 'AUTO',
              flexGrow: c.layout?.layoutGrow === 1 ? 1 : 0,
              flexBasis: c.layout?.layoutSizingHorizontal === 'FILL' || c.layout?.layoutSizingVertical === 'FILL' ? 0 : 'auto',
              sizingH: c.layout?.layoutSizingHorizontal,
              sizingV: c.layout?.layoutSizingVertical,
            })),
          }
        : null,
      positioning: layout.layoutPositioning || 'AUTO',
      clipsContent: !!layout.clipsContent,
      style: {
        bg: resolveSolidPaint(style.fills) ?? resolveSolidPaint(style.backgrounds) ?? null,
        borderColor: resolveSolidPaint(style.strokes),
        borderWidth: style.strokeWeight || null,
        // Per-side stroke weights (Figma stores asymmetric borders here, e.g. list-item
        // dividers with only top:1 / other:0). If omitted, all sides use borderWidth.
        borderWidths: style.strokeWeights
          ? {
              top: style.strokeWeights.top || 0,
              right: style.strokeWeights.right || 0,
              bottom: style.strokeWeights.bottom || 0,
              left: style.strokeWeights.left || 0,
            }
          : null,
        // B3 — border-radius: prefer Figma scalar/array; fall back to computedCss parse
        // (covers nodes where Figma only exposes radius via computed CSS, e.g. some INSTANCE)
        borderRadius: (() => {
          if (node.cornerRadius != null) return node.cornerRadius;
          const parsed = parseBorderRadius(parsedCss['border-radius']);
          return typeof parsed === 'number' ? parsed : null;
        })(),
        borderRadii: (() => {
          if (node.cornerRadii != null) return node.cornerRadii;
          const parsed = parseBorderRadius(parsedCss['border-radius']);
          return Array.isArray(parsed) ? parsed : null;
        })(),
        opacity: opacity < 1 ? opacity : null,
        effects: extractEffects(style.effects),
      },
      text: node.type === 'TEXT' ? buildTextRun(node, parsedCss) : null,
      image: extractImagePaint(style.fills, assetsIndex),
      vector: (() => {
        if (node.type !== 'VECTOR' && node.type !== 'BOOLEAN_OPERATION') return null;
        const sanitized = sanitizeId(node.id);
        const svg = svgIndex.get(sanitized);
        return { svgPath: svg ? `./svg/${svg}` : null, fill: resolveSolidPaint(style.fills) };
      })(),
    };

    flat.push(record);
    for (const c of kids) visit(c, node.id);
  })(root, null);

  return { flat, skipped };
}

// ────────────── main ──────────────

function main() {
  const cacheDir = process.argv[2];
  if (!cacheDir) {
    console.error('Usage: render_ready.mjs <cache-dir>');
    process.exit(2);
  }
  const payloadPath = path.join(cacheDir, 'bridge-agent-payload.json');
  const responsePath = path.join(cacheDir, 'bridge-response.json');
  const src = fs.existsSync(payloadPath) ? payloadPath : responsePath;
  if (!fs.existsSync(src)) {
    console.error(`Bridge payload not found in ${cacheDir}`);
    process.exit(2);
  }
  const payload = JSON.parse(fs.readFileSync(src, 'utf8'));
  const root = payload?.designSnapshot?.root;
  if (!root) {
    console.error('No designSnapshot.root in payload');
    process.exit(2);
  }

  const assetsIndex = indexAssets(cacheDir);
  const svgIndex = indexSvgs(cacheDir);

  const { flat, skipped } = buildRenderReady(root, assetsIndex, svgIndex);

  // Palette for downstream color validation — merge agent-payload + response (response has more)
  const palette = (() => {
    const out = {};
    for (const p of [payloadPath, responsePath]) {
      if (!fs.existsSync(p)) continue;
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        const pal = j?.defs?.paintDiagnostics?.palette;
        if (pal) for (const k of Object.keys(pal)) out[k.toLowerCase()] = true;
      } catch {
        /* ignore */
      }
    }
    return Object.keys(out);
  })();

  const out = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rootId: root.id,
    rootClass: classNameFor(root),
    palette,
    assetsManifest: [...assetsIndex.entries()].map(([hash, v]) => ({ hash, file: v.file, ext: v.ext })),
    svgManifest: [...svgIndex.entries()].map(([k, v]) => ({ sanitizedId: k, file: v })),
    nodes: flat,
    skipped,
    stats: {
      totalNodes: flat.length,
      skippedNodes: skipped.length,
      assetCount: assetsIndex.size,
      svgCount: svgIndex.size,
      paletteSize: palette.length,
    },
  };

  const outPath = path.join(cacheDir, 'render-ready.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: true,
        out: outPath,
        stats: out.stats,
      },
      null,
      2
    )
  );
}

main();
