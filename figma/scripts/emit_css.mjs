#!/usr/bin/env node
// Stage 3 — Mechanical CSS emitter.
// Reads render-ready.json and produces a "毛坯" App.css: one rule per node (by className).
// Uses renderReady's pre-computed effectiveGap (so the 3.9 geometric bug is fixed by design).
//
// Usage: emit_css.mjs <render-ready.json> <out.css>

import fs from 'fs';
import path from 'path';

const RESET = `/* reset */
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; color: #000; font-family: system-ui, sans-serif; }
img { display: block; }

`;

function px(v) {
  return v == null ? null : `${+v.toFixed(2)}px`.replace('.00px', 'px');
}

function formatRadii(r) {
  if (!r) return null;
  if (typeof r === 'number') return px(r);
  if (Array.isArray(r) && r.length === 4) return r.map(px).join(' ');
  return null;
}

function emitRule(node, parentNode) {
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
  if (emitWidth && node.box.width != null) decls.push(['width', px(node.box.width)]);
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
  if (node.style.bg && node.role !== 'vector') decls.push(['background-color', node.style.bg]);
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
  const shadows = node.style.effects.filter((e) => e.kind === 'box-shadow').map((e) => e.value);
  if (shadows.length) decls.push(['box-shadow', shadows.join(', ')]);
  const filters = node.style.effects.filter((e) => e.kind === 'filter').map((e) => e.value);
  if (filters.length) decls.push(['filter', filters.join(' ')]);
  const backdrops = node.style.effects.filter((e) => e.kind === 'backdrop-filter').map((e) => e.value);
  if (backdrops.length) decls.push(['backdrop-filter', backdrops.join(' ')]);

  // Text
  if (node.role === 'text' && node.text) {
    if (node.text.fontFamily) decls.push(['font-family', `'${node.text.fontFamily}', sans-serif`]);
    if (node.text.fontSize) decls.push(['font-size', px(node.text.fontSize)]);
    if (node.text.fontWeight) decls.push(['font-weight', node.text.fontWeight]);
    if (node.text.lineHeight) decls.push(['line-height', node.text.lineHeight]);
    if (node.text.letterSpacing) decls.push(['letter-spacing', node.text.letterSpacing]);
    if (node.text.color) decls.push(['color', node.text.color]);
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
    let rule = emitRule(node, parent);
    if (needsRelative.has(node.id) && !rule.includes('position:')) {
      rule = rule.replace(/\n\}$/, '\n  position: relative;\n}');
    }
    rules.push(rule);
  }
  return RESET + rules.join('\n\n') + '\n';
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
