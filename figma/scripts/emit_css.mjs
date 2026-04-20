#!/usr/bin/env node
// Stage 3 — Mechanical CSS emitter.
// Reads render-ready.json and produces a "毛坯" App.css: one rule per node (by className).
// Uses renderReady's pre-computed effectiveGap (so the 3.9 geometric bug is fixed by design).
//
// Usage: emit_css.mjs <render-ready.json> <out.css>

import fs from 'fs';
import path from 'path';

function detectThemeFromRoot(renderReady) {
  const root = renderReady.nodes.find((n) => n.id === renderReady.rootId);
  if (!root) return { dark: false, bg: '#fff', color: '#000' };
  // Root explicit bg takes priority
  if (root.style?.bg) {
    const h = root.style.bg.toLowerCase().replace('#', '');
    if (h.length >= 6) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const brightness = (r + g + b) / 3;
      return brightness < 128
        ? { dark: true, bg: root.style.bg, color: '#fff' }
        : { dark: false, bg: root.style.bg, color: '#000' };
    }
  }
  // Heuristic — sample first 5 descendants with bg and see if most are dark
  let dark = 0, light = 0;
  for (const n of renderReady.nodes) {
    const bg = n.style?.bg;
    if (!bg) continue;
    const h = bg.toLowerCase().replace('#', '');
    if (h.length < 6) continue;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (Number.isNaN(r)) continue;
    const brightness = (r + g + b) / 3;
    if (brightness < 128) dark++;
    else light++;
    if (dark + light >= 10) break;
  }
  return dark > light
    ? { dark: true, bg: '#000', color: '#fff' }
    : { dark: false, bg: '#fff', color: '#000' };
}

function buildReset(theme) {
  return `/* reset */
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: ${theme.bg}; color: ${theme.color}; font-family: system-ui, sans-serif; }
body { display: flex; justify-content: center; }
img { display: block; }

`;
}

// B2 — Google Fonts allowlist. Families here get an @import at the top of App.css.
// Expand this set as new designs introduce new families (safe — unknown families simply
// won't generate @import, browser falls back to system fonts).
const GOOGLE_FONT_FAMILIES = new Set([
  'Inter', 'Roboto', 'Open Sans', 'Poppins', 'Lato', 'Montserrat', 'Noto Sans',
  'Source Sans 3', 'Work Sans', 'Rubik', 'Nunito', 'Nunito Sans',
  'DM Sans', 'DM Serif Display', 'DM Mono',
  'Roboto Mono', 'Roboto Slab', 'Roboto Condensed',
  'Crimson Text', 'Crimson Pro',
  'Staatliches', 'Jaro', 'Geist', 'Geist Mono',
  'Reddit Mono', 'Reddit Sans',
  'Rethink Sans',
  'Playfair Display', 'Merriweather', 'EB Garamond',
  'Space Grotesk', 'Space Mono',
  'Bebas Neue', 'Oswald', 'Anton',
  'Archivo', 'Archivo Narrow',
  'Manrope', 'Outfit', 'Plus Jakarta Sans',
  'IBM Plex Sans', 'IBM Plex Mono', 'IBM Plex Serif',
]);

function buildFontImports(renderReady) {
  // Collect { family -> Set of weights } from all TEXT nodes
  const familyWeights = new Map();
  const normalizeWeight = (w) => {
    if (w == null) return null;
    if (typeof w === 'number') return w;
    const s = String(w).trim().toLowerCase();
    const map = { thin: 100, light: 300, regular: 400, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
    if (map[s]) return map[s];
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  };
  for (const n of renderReady.nodes) {
    if (n.role !== 'text' || !n.text) continue;
    const fam = n.text.fontFamily;
    if (!fam || !GOOGLE_FONT_FAMILIES.has(fam)) continue;
    if (!familyWeights.has(fam)) familyWeights.set(fam, new Set());
    const w = normalizeWeight(n.text.fontWeight) ?? 400;
    familyWeights.get(fam).add(w);
  }
  if (familyWeights.size === 0) return '';
  // Build single @import covering all families
  const parts = [];
  for (const [fam, weights] of familyWeights) {
    const sorted = [...weights].sort((a, b) => a - b);
    const weightSpec = sorted.length ? `:wght@${sorted.join(';')}` : '';
    parts.push(`family=${fam.replace(/\s+/g, '+')}${weightSpec}`);
  }
  return `@import url('https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap');\n\n`;
}

function px(v) {
  return v == null ? null : `${+v.toFixed(2)}px`.replace('.00px', 'px');
}

function formatRadii(r) {
  if (!r) return null;
  if (typeof r === 'number') return px(r);
  if (Array.isArray(r) && r.length === 4) return r.map(px).join(' ');
  return null;
}

function emitRule(node, parentNode, indexById) {
  const decls = [];

  // ───── Positioning & sizing contract with parent ─────
  let flexMainFill = false;   // child fills parent's primary axis → flex: 1 1 0
  let crossStretch = false;   // child fills parent's cross axis   → align-self: stretch
  const positioning = node.positioning === 'ABSOLUTE' ? 'absolute' : null;

  if (positioning) {
    decls.push(['position', 'absolute']);
    if (node.box.absX != null && parentNode?.box.absX != null) {
      decls.push(['left', px(node.box.absX - parentNode.box.absX)]);
    }
    if (node.box.absY != null && parentNode?.box.absY != null) {
      decls.push(['top', px(node.box.absY - parentNode.box.absY)]);
    }
  } else if (parentNode && parentNode.flex === null) {
    // Parent is NOT an auto-layout container (Figma layoutMode=NONE). In Figma children
    // are positioned freely via their relative x/y; CSS default block flow puts them at
    // top-left, which is wrong. Anchor them explicitly — the parent gets position:relative
    // via collectContainersWithAbsChildren.
    if (node.box.absX != null && parentNode.box.absX != null) {
      decls.push(['position', 'absolute']);
      decls.push(['left', px(node.box.absX - parentNode.box.absX)]);
      if (node.box.absY != null && parentNode.box.absY != null) {
        decls.push(['top', px(node.box.absY - parentNode.box.absY)]);
      }
    }
  } else if (parentNode?.flex) {
    const childInfo = parentNode.flex.children.find((c) => c.id === node.id);
    const isParentRow = parentNode.flex.direction === 'row';
    const fillH = childInfo?.sizingH === 'FILL';
    const fillV = childInfo?.sizingV === 'FILL';
    // Figma FILL semantics: FILL along primary axis ⇒ share remaining main-axis space.
    // FILL along cross axis ⇒ stretch to parent cross-axis length.
    flexMainFill = (isParentRow && fillH) || (!isParentRow && fillV) || childInfo?.flexGrow === 1;
    crossStretch = (isParentRow && fillV) || (!isParentRow && fillH);
    if (flexMainFill) {
      decls.push(['flex', '1 1 0']);
      decls.push([isParentRow ? 'min-width' : 'min-height', '0']);
    }
    if (crossStretch) decls.push(['align-self', 'stretch']);
  }

  // ───── Dimensions ─────
  // Only emit the main-axis dimension when NOT using flex-fill on that axis.
  // Cross-axis dimension is always fine to emit; with align-self:stretch it'll be ignored.
  const isParentRow = parentNode?.flex?.direction === 'row';
  const emitWidth = !(flexMainFill && isParentRow);
  const emitHeight = !(flexMainFill && !isParentRow);
  // For TEXT nodes: Figma pre-measures text in its own font engine and stores the
  // resulting width as node.box.width. Browsers with the same font family+size
  // produce slightly different metrics — setting an explicit CSS width causes the
  // last few characters to be clipped by parent overflow (common: buttons losing
  // trailing letters). Use min-width instead so text drives the final size naturally.
  //
  // Same treatment for containers marked sizingH='HUG' in Figma — these are meant
  // to auto-size to fit their content, not be constrained. If we emit fixed width
  // they cascade-clip whatever expands inside (usually text).
  const isHugWidth = node.role === 'text' || node.sizingH === 'HUG';
  if (emitWidth && node.box.width != null) {
    if (isHugWidth) decls.push(['min-width', px(node.box.width)]);
    else decls.push(['width', px(node.box.width)]);
  }
  if (emitHeight && node.box.height != null) decls.push(['height', px(node.box.height)]);

  // Flex container
  if (node.flex) {
    decls.push(['display', 'flex']);
    decls.push(['flex-direction', node.flex.direction]);
    if (node.flex.wrap) decls.push(['flex-wrap', 'wrap']);
    const [pt, pr, pb, pl] = node.flex.padding;
    if (pt || pr || pb || pl) decls.push(['padding', [pt, pr, pb, pl].map(px).join(' ')]);
    if (node.flex.effectiveGap != null && node.flex.effectiveGap > 0) {
      decls.push(['gap', px(node.flex.effectiveGap)]);
    }
    const justifyMap = { MIN: 'flex-start', MAX: 'flex-end', CENTER: 'center', SPACE_BETWEEN: 'space-between' };
    const alignMap = { MIN: 'flex-start', MAX: 'flex-end', CENTER: 'center', BASELINE: 'baseline' };
    if (node.flex.justify && justifyMap[node.flex.justify]) decls.push(['justify-content', justifyMap[node.flex.justify]]);
    if (node.flex.align && alignMap[node.flex.align]) decls.push(['align-items', alignMap[node.flex.align]]);
  }

  // Colors / border / radius / shadow
  // Skip bg for vector role — the SVG <img> has its own fill baked in; a bg color
  // only bleeds through transparent areas of the SVG and gives the "black square" artifact.
  //
  // Skip bg for text role — render_ready puts fills color into style.bg, but TEXT fills
  // are the *foreground* text color (handled below via node.text.color). Emitting it as
  // background-color makes every text span render as a colored rectangle.
  if (node.style.bg && node.role !== 'vector' && node.role !== 'text') {
    decls.push(['background-color', node.style.bg]);
  }
  // Image role with no resolvable path (VIDEO fills, or missing image asset):
  // emit fallbackColor so the area isn't blank/default white.
  if (node.role === 'image' && !node.image?.path && node.image?.fallbackColor) {
    decls.push(['background-color', node.image.fallbackColor]);
  }
  if (node.style.borderColor) {
    const perSide = node.style.borderWidths;
    if (perSide) {
      const sides = ['top', 'right', 'bottom', 'left'];
      const nonZero = sides.filter((s) => perSide[s]);
      // Divider pattern: exactly one side, ≤ 2px. Emit as border-<side>.
      // Other asymmetric patterns (e.g. 3-sided, >2px) are usually Figma design-system
      // metadata that doesn't render visibly at 2x DPR — skip to avoid artifact noise.
      if (nonZero.length === 1 && perSide[nonZero[0]] <= 2) {
        const s = nonZero[0];
        decls.push([`border-${s}`, `${px(perSide[s])} solid ${node.style.borderColor}`]);
      } else if (nonZero.length === 4 && perSide.top === perSide.right && perSide.right === perSide.bottom && perSide.bottom === perSide.left && node.style.borderWidth) {
        decls.push(['border', `${px(node.style.borderWidth)} solid ${node.style.borderColor}`]);
      }
    } else if (node.style.borderWidth) {
      decls.push(['border', `${px(node.style.borderWidth)} solid ${node.style.borderColor}`]);
    }
  }
  const radius = formatRadii(node.style.borderRadii || node.style.borderRadius);
  if (radius) decls.push(['border-radius', radius]);
  if (node.style.opacity != null) decls.push(['opacity', node.style.opacity]);

  // Effects
  const effects = node.style.effects || [];
  const shadows = effects.filter((e) => e.kind === 'box-shadow').map((e) => e.value);
  if (shadows.length) decls.push(['box-shadow', shadows.join(', ')]);
  const filters = effects.filter((e) => e.kind === 'filter').map((e) => e.value);
  if (filters.length) decls.push(['filter', filters.join(' ')]);
  const backdrops = effects.filter((e) => e.kind === 'backdrop-filter').map((e) => e.value);
  if (backdrops.length) decls.push(['backdrop-filter', backdrops.join(' ')]);

  // Text
  if (node.role === 'text' && node.text) {
    if (node.text.fontFamily) decls.push(['font-family', `'${node.text.fontFamily}', sans-serif`]);
    if (node.text.fontSize) decls.push(['font-size', px(node.text.fontSize)]);
    if (node.text.fontWeight) decls.push(['font-weight', node.text.fontWeight]);
    if (node.text.lineHeight) decls.push(['line-height', node.text.lineHeight]);
    if (node.text.letterSpacing) decls.push(['letter-spacing', node.text.letterSpacing]);
    // Skip emitting #000 color so text inherits from body (which can be #fff on dark designs).
    // Figma sometimes exports "color: #000000" for text that visually renders white due to
    // component-instance inversion or parent blend modes — inheriting is safer than hard-setting black.
    if (node.text.color && node.text.color.toLowerCase() !== '#000000' && node.text.color !== '#000') {
      decls.push(['color', node.text.color]);
    }
    if (node.text.textAlign) decls.push(['text-align', node.text.textAlign]);
    // Single-line heuristic: Figma stores width exactly fitting one line; browser font
    // metrics diverge slightly, so text can wrap unexpectedly (e.g. "How-to" at the hyphen).
    // fontSize may be null for text inside COMPONENT INSTANCES (bridge doesn't expose segments
    // there), so fall back to a raw height threshold — 30px covers any realistic body-text
    // line height. Multi-line text has height ≥ ~2× line-height, well above this threshold.
    const fs = typeof node.text.fontSize === 'number' ? node.text.fontSize : 0;
    const h = node.box?.height ?? null;
    const singleLine = h != null && (fs ? h <= fs * 1.5 + 0.5 : h <= 30);
    if (singleLine) decls.push(['white-space', 'nowrap']);
  }

  // clipsContent
  if (node.clipsContent) decls.push(['overflow', 'hidden']);

  const body = decls.map(([k, v]) => `  ${k}: ${v};`).join('\n');
  return `.${node.className} {\n${body}\n}`;
}

function collectContainersWithAbsChildren(renderReady) {
  // A node needs position:relative if any of its children is positioned absolutely.
  // This covers two cases:
  //   1. Child has positioning=ABSOLUTE (explicitly positioned in Figma)
  //   2. Parent has no auto-layout (flex=null) — all children anchored via left/top
  const needsRelative = new Set();
  const indexById = new Map(renderReady.nodes.map((n) => [n.id, n]));
  for (const n of renderReady.nodes) {
    if (n.positioning === 'ABSOLUTE' && n.parentId) needsRelative.add(n.parentId);
    if (n.parentId) {
      const parent = indexById.get(n.parentId);
      if (parent && parent.flex === null) needsRelative.add(parent.id);
    }
  }
  return needsRelative;
}

function emitCss(renderReady) {
  const indexById = new Map(renderReady.nodes.map((n) => [n.id, n]));
  const needsRelative = collectContainersWithAbsChildren(renderReady);
  const rules = [];
  for (const node of renderReady.nodes) {
    const parent = node.parentId ? indexById.get(node.parentId) : null;
    let rule = emitRule(node, parent, indexById);
    if (needsRelative.has(node.id) && !rule.includes('position:')) {
      rule = rule.replace(/\n\}$/, '\n  position: relative;\n}');
    }
    rules.push(rule);
  }
  const fontImports = buildFontImports(renderReady);
  const theme = detectThemeFromRoot(renderReady);
  return fontImports + buildReset(theme) + rules.join('\n\n') + '\n';
}

function main() {
  const rrPath = process.argv[2];
  const outPath = process.argv[3];
  if (!rrPath || !outPath) {
    console.error('Usage: emit_css.mjs <render-ready.json> <out.css>');
    process.exit(2);
  }
  const rr = JSON.parse(fs.readFileSync(rrPath, 'utf8'));
  const css = emitCss(rr);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, css);
  console.log(JSON.stringify({ ok: true, out: outPath, chars: css.length, rules: rr.nodes.length }, null, 2));
}

main();
