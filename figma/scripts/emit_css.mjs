#!/usr/bin/env node
// Stage 3 — Mechanical CSS emitter.
// Reads render-ready.json and produces a mechanical App.css: one rule per node (by className).
// Uses renderReady's pre-computed effectiveGap (so the 3.9 geometric bug is fixed by design).
//
// Usage: emit_css.mjs <render-ready.json> <out.css>

import fs from 'fs';
import path from 'path';
import { collectFontFamilyWeightsFromRenderReady, buildGoogleFontsHref } from './lib/render_node.mjs';

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
body { overflow-x: auto; }
img { display: block; }

`;
}

// Emit a single @import for every non-generic font family the design actually
// uses (with the exact weights observed). No allowlist: a hardcoded list of
// "approved Google Fonts" used to live here and silently dropped any family
// not in the list, which let the browser fall back to system fonts and made
// fidelity impossible to debug. If a family isn't on Google Fonts the @import
// will 404 — surface that to the user; do NOT silently swallow it.
function buildFontImports(renderReady) {
  const familyWeights = collectFontFamilyWeightsFromRenderReady(renderReady.nodes);
  const href = buildGoogleFontsHref(familyWeights);
  return href ? `@import url('${href}');\n\n` : '';
}

function px(v) {
  return v == null ? null : `${+v.toFixed(2)}px`.replace('.00px', 'px');
}

function formatRadii(r) {
  if (!r) return null;
  if (typeof r === 'string') return r;
  if (typeof r === 'number') return px(r);
  if (Array.isArray(r) && r.length === 4) return r.map(px).join(' ');
  return null;
}

function fontFamilyStack(fontFamily) {
  const family = String(fontFamily || '').trim();
  if (!family) return null;
  if (family === 'MiSans VF' || family === 'MiSans') {
    // 'MiSans' is the family the misans-vf CDN stylesheet registers. Keep the
    // designer-declared 'MiSans VF' first so when a local copy is installed it
    // still wins; the CDN form is a second-chance match.
    return `'MiSans VF', 'MiSans', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`;
  }
  if (family === 'SF Pro') {
    return `'SF Pro', 'SF Pro Text', 'PingFang SC', 'Hiragino Sans GB', sans-serif`;
  }
  return `'${family}', sans-serif`;
}

// CJK blocks covering Chinese (Unified + Ext-A), halfwidth/fullwidth forms,
// Japanese hiragana/katakana, and Korean hangul syllables.
const CJK_RE = /[\u3400-\u9fff\uff00-\uffef\u3040-\u30ff\uac00-\ud7af]/;
function hasCJK(s) {
  return CJK_RE.test(String(s || ''));
}

// Quantize Figma's variable-font weights (e.g. 380, 450, 330) to the nearest
// 100-step. Fallback fonts (PingFang SC, system-ui) only ship static cuts, so a
// raw `font-weight: 450` collapses to 400 and makes headings look unbold.
// Rounds to nearest 100 and clamps to [100, 900]. String keywords like "bold"
// pass through unchanged so browsers apply their built-in mapping.
function quantizeFontWeight(w) {
  if (w == null) return null;
  const n = typeof w === 'number' ? w : parseInt(w, 10);
  if (!Number.isFinite(n)) return w;
  const step = Math.round(n / 100) * 100;
  return Math.max(100, Math.min(900, step));
}

function inferCrossAxisAlign(node, parentNode) {
  if (!node?.box || !parentNode?.box || !parentNode?.flex) return null;
  const isParentRow = parentNode.flex.direction === 'row';
  const [pt, pr, pb, pl] = parentNode.flex.padding || [0, 0, 0, 0];
  const parentCrossStart = isParentRow ? parentNode.box.absY + pt : parentNode.box.absX + pl;
  const parentCrossSize = isParentRow
    ? parentNode.box.height - pt - pb
    : parentNode.box.width - pl - pr;
  const childCrossStart = isParentRow ? node.box.absY : node.box.absX;
  const childCrossSize = isParentRow ? node.box.height : node.box.width;
  if (
    parentCrossStart == null ||
    parentCrossSize == null ||
    childCrossStart == null ||
    childCrossSize == null
  ) {
    return null;
  }

  const tol = 1;
  const startGap = childCrossStart - parentCrossStart;
  const endGap = parentCrossSize - childCrossSize - startGap;

  if (Math.abs(startGap) <= tol && Math.abs(endGap) <= tol) return 'stretch';
  if (Math.abs(startGap - endGap) <= tol) return 'center';
  if (Math.abs(startGap) <= tol) return 'flex-start';
  if (Math.abs(endGap) <= tol) return 'flex-end';
  return null;
}

function hasResolvedMainAxisGeometry(node, parentNode, indexById) {
  if (!node?.box || !parentNode?.box || !parentNode?.flex) return false;
  const isParentRow = parentNode.flex.direction === 'row';
  const [pt, pr, pb, pl] = parentNode.flex.padding || [0, 0, 0, 0];
  const parentMainSize = isParentRow
    ? parentNode.box.width - pl - pr
    : parentNode.box.height - pt - pb;
  if (parentMainSize == null) return false;

  const flowChildren = (parentNode.childrenOrder || [])
    .map((id) => indexById.get(id))
    .filter((child) => child && child.positioning !== 'ABSOLUTE' && child.box);
  if (flowChildren.length === 0) return false;

  const gap = parentNode.flex.justify === 'SPACE_BETWEEN' ? 0 : parentNode.flex.effectiveGap || 0;
  const summedMain = flowChildren.reduce((sum, child) => {
    const size = isParentRow ? child.box.width : child.box.height;
    return sum + (size || 0);
  }, 0);
  const total = summedMain + gap * Math.max(0, flowChildren.length - 1);
  return Math.abs(total - parentMainSize) <= 1;
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
    if (flexMainFill && hasResolvedMainAxisGeometry(node, parentNode, indexById)) {
      flexMainFill = false;
    }
    crossStretch = (isParentRow && fillV) || (!isParentRow && fillH);
    if (flexMainFill) {
      decls.push(['flex', '1 1 0']);
      decls.push([isParentRow ? 'min-width' : 'min-height', '0']);
    }
    if (crossStretch) {
      const inferredAlign = inferCrossAxisAlign(node, parentNode);
      decls.push(['align-self', inferredAlign || 'stretch']);
    }
  }

  // ───── Dimensions ─────
  // Only emit the main-axis dimension when NOT using flex-fill on that axis.
  // Cross-axis dimension is always fine to emit; with align-self:stretch it'll be ignored.
  const isParentRow = parentNode?.flex?.direction === 'row';
  const emitWidth = !(flexMainFill && isParentRow);
  const emitHeight = !(flexMainFill && !isParentRow);
  // Width strategy
  //   - TEXT: don't emit width. Let the inline span size to its natural content;
  //     the flex-row parent arranges siblings.
  //   - sizingH='HUG': use min-width so the container grows for text descendants.
  //   - Everyone else: fixed width.
  //
  // Also: FIXED-width flex containers must clip overflow. Otherwise HUG-chain
  // descendants (whose text rendered wider than Figma's measure) spill past the
  // FIXED boundary and into sibling gaps.
  if (emitWidth && node.box.width != null) {
    if (node.role === 'text') {
      // skip — natural sizing
    } else if (node.sizingH === 'HUG') {
      decls.push(['min-width', px(node.box.width)]);
    } else {
      decls.push(['width', px(node.box.width)]);
      // Only row-flex containers need clipping: overflow from a row child lands
      // in the sibling gap (or next sibling). Column flex's cross-axis overflow
      // combined with align-items:flex-end would clip the WRONG side — skip.
      if (node.flex && node.flex.direction === 'row') {
        decls.push(['overflow', 'hidden']);
      }
    }
  }
  if (emitHeight && node.box.height != null) decls.push(['height', px(node.box.height)]);
  if (node.minWidth != null) decls.push(['min-width', px(node.minWidth)]);
  if (node.maxWidth != null) decls.push(['max-width', px(node.maxWidth)]);
  if (node.minHeight != null) decls.push(['min-height', px(node.minHeight)]);
  if (node.maxHeight != null) decls.push(['max-height', px(node.maxHeight)]);

  // Flex container
  if (node.flex) {
    decls.push(['display', 'flex']);
    decls.push(['flex-direction', node.flex.direction]);
    if (node.flex.wrap) decls.push(['flex-wrap', 'wrap']);
    const [pt, pr, pb, pl] = node.flex.padding;
    if (pt || pr || pb || pl) decls.push(['padding', [pt, pr, pb, pl].map(px).join(' ')]);
    if (node.flex.effectiveGap != null && node.flex.effectiveGap > 0 && node.flex.justify !== 'SPACE_BETWEEN') {
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
  if (node.style.borderColor && node.role !== 'vector') {
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
  const radius = node.role === 'vector' ? null : formatRadii(node.style.borderRadii || node.style.borderRadius);
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
    if (node.text.fontFamily) decls.push(['font-family', fontFamilyStack(node.text.fontFamily)]);
    if (node.text.fontSize) decls.push(['font-size', px(node.text.fontSize)]);
    if (node.text.fontWeight) {
      const qw = quantizeFontWeight(node.text.fontWeight);
      if (qw != null) decls.push(['font-weight', qw]);
    }
    if (node.text.lineHeight) decls.push(['line-height', node.text.lineHeight]);
    if (node.text.letterSpacing) decls.push(['letter-spacing', node.text.letterSpacing]);
    // Skip emitting #000 color so text inherits from body (which can be #fff on dark designs).
    // Figma sometimes exports "color: #000000" for text that visually renders white due to
    // component-instance inversion or parent blend modes — inheriting is safer than hard-setting black.
    if (node.text.color && node.text.color.toLowerCase() !== '#000000' && node.text.color !== '#000') {
      decls.push(['color', node.text.color]);
    }
    if (node.text.textAlign) decls.push(['text-align', node.text.textAlign]);
    if (node.text.textTransform) decls.push(['text-transform', node.text.textTransform]);
    if (node.text.textDecoration) decls.push(['text-decoration', node.text.textDecoration]);
    // CJK line-breaking: by default browsers break between any two CJK chars,
    // which splits words like "手机号" down the middle when the container is
    // narrow. keep-all forbids breaking inside CJK; break-word keeps long
    // Latin strings from overflowing.
    const cjkText = hasCJK(node.text.content || '') || (node.text.runs || []).some((r) => hasCJK(r.content));
    if (cjkText) {
      decls.push(['word-break', 'keep-all']);
      decls.push(['overflow-wrap', 'break-word']);
    }
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
