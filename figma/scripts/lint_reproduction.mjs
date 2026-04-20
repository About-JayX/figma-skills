#!/usr/bin/env node
// Reproduction lint — static checks on Figma-to-React output against the bridge payload.
// Catches the common fidelity bugs before we spend agent time fixing them in a visual loop.
//
// Usage:
//   node lint_reproduction.mjs --bridge <bridge-agent-payload.json> --jsx <App.jsx> --css <App.css> [--out <report.json>]
//
// Exit code: 0 if no block violations, 1 otherwise.

import fs from 'fs';
import path from 'path';
import { parse as parseJs } from '@babel/parser';
import _traverse from '@babel/traverse';
import postcss from 'postcss';

const traverse = _traverse.default || _traverse;

const GEOMETRY_TOL = 0.5; // px; strict tolerance for geometry sum checks (L1)
const GAP_TOL = 1.0;      // px; loosened tolerance for gap value checks (L4) — ignore sub-px rounding
const COLOR_HEX_RE = /#([0-9a-fA-F]{3,8})\b/g;

function parseArgs(argv) {
  const args = { bridge: null, jsx: null, css: null, out: null, format: 'text' };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--bridge') { args.bridge = v; i++; }
    else if (k === '--jsx') { args.jsx = v; i++; }
    else if (k === '--css') { args.css = v; i++; }
    else if (k === '--out') { args.out = v; i++; }
    else if (k === '--format') { args.format = v; i++; }
    else if (k === '--help' || k === '-h') {
      console.log('Usage: lint_reproduction.mjs --bridge <json> --jsx <file> --css <file> [--out <json>] [--format text|json]');
      process.exit(0);
    }
  }
  for (const req of ['bridge', 'jsx', 'css']) {
    if (!args[req]) {
      console.error(`Missing required --${req}`);
      process.exit(2);
    }
  }
  return args;
}

function flattenTree(root) {
  const out = [];
  (function walk(n, parentId) {
    out.push({ node: n, parentId });
    for (const c of n.children || []) walk(c, n.id);
  })(root, null);
  return out;
}

function computeEffectiveGap(node, children) {
  if (!children || children.length < 2) return null;
  const isH = node.layout?.layoutMode === 'HORIZONTAL';
  const gaps = [];
  for (let i = 0; i < children.length - 1; i++) {
    const a = children[i].layout?.absoluteBoundingBox;
    const b = children[i + 1].layout?.absoluteBoundingBox;
    if (!a || !b) return null;
    gaps.push(isH ? b.x - (a.x + a.width) : b.y - (a.y + a.height));
  }
  const first = gaps[0];
  const uniform = gaps.every((g) => Math.abs(g - first) < GEOMETRY_TOL);
  return { value: first, uniform, samples: gaps };
}

function sanitizeId(s) {
  return String(s).replace(/[:;]/g, '-');
}

function nodeClassCandidates(node) {
  // The generator may use id or a sanitized name as class. Collect all reasonable strings.
  const ids = new Set();
  if (node.id) {
    ids.add(node.id);
    ids.add(sanitizeId(node.id));
    ids.add(`n-${sanitizeId(node.id)}`);
  }
  if (node.name) {
    const slug = node.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    if (slug) ids.add(slug);
  }
  return ids;
}

function parseJsxFile(src) {
  const ast = parseJs(src, {
    sourceType: 'module',
    plugins: ['jsx'],
    errorRecovery: true,
  });
  const elements = [];
  const textNodes = [];
  traverse(ast, {
    JSXOpeningElement(p) {
      const attrs = {};
      for (const a of p.node.attributes) {
        if (a.type === 'JSXAttribute' && a.value) {
          if (a.value.type === 'StringLiteral') attrs[a.name.name] = a.value.value;
          else if (a.value.type === 'JSXExpressionContainer' && a.value.expression?.type === 'StringLiteral') {
            attrs[a.name.name] = a.value.expression.value;
          }
        }
      }
      elements.push({ tag: p.node.name?.name ?? null, attrs, loc: p.node.loc });
    },
    JSXText(p) {
      const txt = p.node.value;
      if (txt && txt.trim()) textNodes.push({ text: txt.trim(), loc: p.node.loc });
    },
  });
  return { elements, textNodes };
}

function parseCssFile(src) {
  const root = postcss.parse(src);
  const rules = []; // { selector, decls: {prop: value}, source }
  root.walkRules((r) => {
    const decls = {};
    r.walkDecls((d) => {
      decls[d.prop] = d.value;
    });
    rules.push({ selector: r.selector.trim(), decls, source: r.source });
  });
  return rules;
}

function findRuleForNode(rules, node) {
  const candidates = nodeClassCandidates(node);
  for (const r of rules) {
    const sels = r.selector.split(',').map((s) => s.trim());
    for (const sel of sels) {
      const m = sel.match(/\.([A-Za-z0-9_-]+)/);
      if (!m) continue;
      if (candidates.has(m[1])) return r;
    }
  }
  return null;
}

function pxNum(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^([-+]?\d+(?:\.\d+)?)(px)?$/);
  return m ? Number(m[1]) : null;
}

// ────────────────── Checks ──────────────────

// L1: Σ child main-axis + gap·(n-1) + padding ≤ parent main-axis
function checkL1Geometry(nodes, renderReadyIndex) {
  const violations = [];
  for (const { node: n } of nodes) {
    const l = n.layout;
    if (!l || !['HORIZONTAL', 'VERTICAL'].includes(l.layoutMode)) continue;
    if (l.layoutWrap === 'WRAP') continue; // flex-wrap distributes across rows; Σwidth > parent is expected
    const kids = (n.children || []).filter(
      (c) => c.visible !== false && c.layout?.layoutPositioning !== 'ABSOLUTE'
    );
    if (kids.length < 2) continue;
    const isH = l.layoutMode === 'HORIZONTAL';
    const sum = kids.reduce((s, c) => s + (isH ? c.layout?.width ?? 0 : c.layout?.height ?? 0), 0);
    const rawGapTotal = (l.itemSpacing || 0) * (kids.length - 1);
    const pad = isH
      ? (l.paddingLeft || 0) + (l.paddingRight || 0)
      : (l.paddingTop || 0) + (l.paddingBottom || 0);
    const parentDim = isH ? l.width : l.height;
    const rawTotal = sum + rawGapTotal + pad;

    // If downstream consumer already trusts renderReady (effectiveGap), the conflict may be resolved.
    // Re-run the check with effectiveGap and downgrade/skip when it fits.
    const rr = renderReadyIndex?.get(n.id);
    if (rr?.flex?.gapUniform && rr.flex.effectiveGap != null) {
      const effTotal = sum + rr.flex.effectiveGap * (kids.length - 1) + pad;
      if (effTotal <= parentDim + GEOMETRY_TOL) {
        // effectiveGap path resolves it — no violation
        continue;
      }
    }

    if (rawTotal > parentDim + GEOMETRY_TOL) {
      const overflow = +(rawTotal - parentDim).toFixed(2);
      violations.push({
        id: 'L1',
        severity: 'block',
        nodeId: n.id,
        nodeName: n.name,
        detail: `${isH ? 'HORIZONTAL' : 'VERTICAL'}: Σ${isH ? 'width' : 'height'}(${sum}) + gap·(n-1)(${rawGapTotal}) + padding(${pad}) = ${rawTotal} > parent(${parentDim}) · overflow ${overflow}px`,
        hint: `Likely FILL+grow children absorbing itemSpacing. Use effectiveGap from absoluteBoundingBox instead of ${l.itemSpacing}.`,
      });
    }
  }
  return violations;
}

// L4: CSS gap should equal effectiveGap (from abs coords), NOT raw itemSpacing
function checkL4EffectiveGap(nodes, rules) {
  const violations = [];
  for (const { node: n } of nodes) {
    const l = n.layout;
    if (!l || !['HORIZONTAL', 'VERTICAL'].includes(l.layoutMode)) continue;
    const kids = (n.children || []).filter((c) => c.visible !== false);
    if (kids.length < 2) continue;
    const eff = computeEffectiveGap(n, kids);
    if (!eff || !eff.uniform) continue;
    const rule = findRuleForNode(rules, n);
    if (!rule) continue;
    const cssGap = pxNum(rule.decls.gap ?? rule.decls['row-gap'] ?? rule.decls['column-gap']);
    if (cssGap == null) continue;
    const diff = Math.abs(cssGap - eff.value);
    if (diff > GAP_TOL) {
      const severity = diff > 10 ? 'block' : 'warn';
      violations.push({
        id: 'L4',
        severity,
        nodeId: n.id,
        nodeName: n.name,
        selector: rule.selector,
        detail: `CSS gap=${cssGap}px but effectiveGap from abs coords=${+eff.value.toFixed(2)}px (bridge itemSpacing=${l.itemSpacing}px — not authoritative when children are FILL+grow)`,
        hint: `Replace gap:${cssGap}px with gap:${+eff.value.toFixed(2)}px`,
      });
    }
  }
  return violations;
}

// L2: layoutMode ↔ flex-direction match (HORIZONTAL → row, VERTICAL → column)
function checkL2FlexDirection(nodes, rules) {
  const violations = [];
  const expected = { HORIZONTAL: 'row', VERTICAL: 'column' };
  for (const { node: n } of nodes) {
    const mode = n.layout?.layoutMode;
    if (!expected[mode]) continue;
    const kids = (n.children || []).filter((c) => c.visible !== false);
    if (kids.length < 2) continue; // single child: direction doesn't matter visually
    const rule = findRuleForNode(rules, n);
    if (!rule) continue;
    const display = rule.decls.display;
    const dir = rule.decls['flex-direction'];
    if (display !== 'flex' && display !== 'inline-flex') continue; // only check flex containers
    if (!dir || !dir.startsWith(expected[mode])) {
      violations.push({
        id: 'L2',
        severity: 'block',
        nodeId: n.id,
        nodeName: n.name,
        selector: rule.selector,
        detail: `layoutMode=${mode} but flex-direction=${dir ?? '(missing)'} — expected '${expected[mode]}'`,
      });
    }
  }
  return violations;
}

// L3: Every bridge FRAME/INSTANCE/COMPONENT node must have a corresponding JSX element
// (match by id attribute — the generator should emit id="<node.id>" on every div)
function checkL3FramePreservation(nodes, jsxElements) {
  // Accept both `43:1048` and `43-1048` forms — HTML id cannot contain colons/semicolons,
  // so the generator is expected to emit a sanitized id attribute.
  const jsxIds = new Set();
  for (const el of jsxElements) {
    if (el.attrs.id) {
      jsxIds.add(el.attrs.id);
      jsxIds.add(sanitizeId(el.attrs.id));
    }
  }
  const structural = new Set(['FRAME', 'INSTANCE', 'COMPONENT', 'COMPONENT_SET', 'GROUP']);
  const violations = [];
  for (const { node: n } of nodes) {
    if (!structural.has(n.type)) continue;
    if (n.visible === false) continue;
    if ((n.style?.opacity ?? 1) === 0) continue;
    if (jsxIds.has(n.id) || jsxIds.has(sanitizeId(n.id))) continue;
    violations.push({
      id: 'L3',
      severity: 'warn', // warn because id attr naming is an implicit contract; can be upgraded to block once renderReady enforces it
      nodeId: n.id,
      nodeName: n.name,
      detail: `Bridge ${n.type} ${n.id} "${n.name}" has no JSX element with id="${n.id}" — likely skipped/collapsed.`,
    });
  }
  return violations;
}

// L5: Every CSS color hex must appear in bridge paintDiagnostics.palette
function checkL5ColorPalette(payload, paletteExtra, cssSrc, rules) {
  const palette = {
    ...(payload?.defs?.paintDiagnostics?.palette ?? {}),
    ...(paletteExtra ?? {}),
  };
  const allowHex = new Set();
  for (const key of Object.keys(palette)) {
    const m = String(key).match(/^#([0-9a-fA-F]+)/);
    if (m) allowHex.add(normalizeHex(m[1]));
  }
  // Also allow pure white / black / transparent (common resets)
  ['ffffff', '000000'].forEach((h) => allowHex.add(h));

  // If the palette is effectively empty (<= our 2 defaults), skip the check —
  // we have nothing to check against and would otherwise spam warnings.
  if (allowHex.size <= 2) return [];

  const violations = [];
  // Collect hex tokens with their CSS rule for better messages
  for (const rule of rules) {
    for (const [prop, val] of Object.entries(rule.decls)) {
      if (!/color|background|border|fill|stroke|shadow/i.test(prop)) continue;
      const matches = [...String(val).matchAll(COLOR_HEX_RE)];
      for (const m of matches) {
        const hex = normalizeHex(m[1]);
        if (!allowHex.has(hex)) {
          violations.push({
            id: 'L5',
            severity: 'warn',
            selector: rule.selector,
            detail: `Color #${hex} in ${prop}:${val} not found in bridge palette (keys: ${allowHex.size}).`,
          });
        }
      }
    }
  }
  return violations;
}

function normalizeHex(h) {
  h = h.toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6); // drop alpha for set-match; bridge palette may or may not include alpha
  return h;
}

// L7: Every CSS font-family must match a font used in bridge text nodes
function checkL7FontFamily(nodes, rules) {
  const allowed = new Set();
  for (const { node: n } of nodes) {
    if (n.type !== 'TEXT') continue;
    const segs = n.style?.textSegments || [];
    for (const s of segs) {
      const f = s?.fontName?.family;
      if (f) allowed.add(f.toLowerCase());
    }
  }
  // Common generic fallbacks are always ok
  ['serif', 'sans-serif', 'monospace', 'inherit', 'system-ui'].forEach((f) => allowed.add(f));

  const violations = [];
  for (const rule of rules) {
    const v = rule.decls['font-family'];
    if (!v) continue;
    const families = v
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
      .filter(Boolean);
    const ok = families.some((f) => allowed.has(f));
    if (!ok) {
      violations.push({
        id: 'L7',
        severity: 'warn',
        selector: rule.selector,
        detail: `font-family:${v} — none of ${families.join(' / ')} appear in bridge text nodes`,
      });
    }
  }
  return violations;
}

// L8: Image references (CSS url() and JSX img src) must resolve to a file OR have a "missing" marker
function checkL8ImageReferences(cssSrc, elements, assetsDir, cssPath, jsxPath) {
  const violations = [];
  const cssDir = path.dirname(cssPath);
  const jsxDir = path.dirname(jsxPath);

  // CSS url(...)
  const urlRe = /url\(\s*['"]?([^'")]+?)['"]?\s*\)/g;
  for (const m of cssSrc.matchAll(urlRe)) {
    const ref = m[1];
    if (ref.startsWith('data:') || ref.startsWith('http')) continue;
    const abs = path.resolve(cssDir, ref);
    if (fs.existsSync(abs)) continue;
    // Allow if there's an explicit `/* missing */` hint on the same line / nearby
    const startIdx = m.index ?? 0;
    const context = cssSrc.slice(Math.max(0, startIdx - 100), startIdx + 100);
    if (/\/\*\s*missing/i.test(context)) continue;
    violations.push({
      id: 'L8',
      severity: 'warn',
      detail: `CSS url(${ref}) does not resolve to a file and has no /* missing */ marker.`,
    });
  }

  // JSX <img src="..."> / <source src="...">
  for (const el of elements) {
    const src = el.attrs?.src;
    if (!src) continue;
    if (src.startsWith('data:') || src.startsWith('http')) continue;
    const abs = path.resolve(jsxDir, src);
    if (fs.existsSync(abs)) continue;
    violations.push({
      id: 'L8',
      severity: 'warn',
      detail: `JSX <${el.tag} src="${src}"> does not resolve to a file.`,
      line: el.loc?.start?.line,
    });
  }
  return violations;
}

// L6: All JSX visible text must come from bridge textSegments or TEXT-node names
function checkL6TextContent(nodes, jsxTexts) {
  const bank = new Set();
  for (const { node: n } of nodes) {
    if (n.type === 'TEXT') {
      if (n.name) bank.add(n.name.trim());
      const segs = n.style?.textSegments || [];
      for (const s of segs) if (s?.characters) bank.add(s.characters.trim());
    }
  }
  // Add every node name as a weak candidate (covers cases where agent uses node name as label)
  for (const { node: n } of nodes) if (n.name) bank.add(n.name.trim());

  const normalized = [...bank].map((t) => t.toLowerCase());
  const violations = [];
  for (const { text, loc } of jsxTexts) {
    const needle = text.toLowerCase();
    if (needle.length < 3) continue; // skip separators/punctuation
    const ok = normalized.some((t) => t.includes(needle) || needle.includes(t));
    if (!ok) {
      violations.push({
        id: 'L6',
        severity: 'block',
        jsxText: text.slice(0, 80),
        line: loc?.start?.line,
        detail: `Text not found in bridge textSegments or node names — likely fabricated.`,
      });
    }
  }
  return violations;
}

// ────────────────── Main ──────────────────

function formatText(report) {
  const lines = [];
  const icon = (sev) => (sev === 'block' ? '✖' : '⚠');
  lines.push(`Reproduction lint — ${report.summary.blocks} block, ${report.summary.warns} warn`);
  lines.push('');
  if (report.violations.length === 0) {
    lines.push('✓ No violations.');
    return lines.join('\n');
  }
  const byCheck = {};
  for (const v of report.violations) (byCheck[v.id] ||= []).push(v);
  for (const id of Object.keys(byCheck).sort()) {
    lines.push(`── ${id} (${byCheck[id].length}) ──`);
    for (const v of byCheck[id]) {
      lines.push(`${icon(v.severity)} ${v.nodeId ?? v.jsxText ?? ''} ${v.nodeName ? `"${v.nodeName}"` : ''}`);
      lines.push(`    ${v.detail}`);
      if (v.hint) lines.push(`    → ${v.hint}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function tryReadPaletteFromNeighbor(bridgePath) {
  // If the caller pointed at bridge-agent-payload.json, look for bridge-response.json next to it;
  // the agent-payload strips heavy diagnostic data like the full color palette.
  try {
    const dir = path.dirname(bridgePath);
    const candidates = ['bridge-response.json', 'bridge-full.json'];
    for (const c of candidates) {
      const p = path.join(dir, c);
      if (p === bridgePath) continue;
      if (!fs.existsSync(p)) continue;
      const full = JSON.parse(fs.readFileSync(p, 'utf8'));
      const pal = full?.defs?.paintDiagnostics?.palette;
      if (pal && Object.keys(pal).length > 0) return pal;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function tryReadRenderReadyFromNeighbor(bridgePath) {
  try {
    const dir = path.dirname(bridgePath);
    const p = path.join(dir, 'render-ready.json');
    if (!fs.existsSync(p)) return null;
    const rr = JSON.parse(fs.readFileSync(p, 'utf8'));
    const idx = new Map();
    for (const n of rr.nodes || []) idx.set(n.id, n);
    return idx;
  } catch {
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv);
  const payload = JSON.parse(fs.readFileSync(args.bridge, 'utf8'));
  const jsxSrc = fs.readFileSync(args.jsx, 'utf8');
  const cssSrc = fs.readFileSync(args.css, 'utf8');
  const paletteExtra = tryReadPaletteFromNeighbor(args.bridge);
  const renderReadyIndex = tryReadRenderReadyFromNeighbor(args.bridge);

  const root = payload?.designSnapshot?.root;
  if (!root) {
    console.error('No designSnapshot.root in bridge payload');
    process.exit(2);
  }
  const nodes = flattenTree(root);

  const { elements, textNodes } = parseJsxFile(jsxSrc);
  const rules = parseCssFile(cssSrc);

  const violations = [
    ...checkL1Geometry(nodes, renderReadyIndex),
    ...checkL2FlexDirection(nodes, rules),
    ...checkL3FramePreservation(nodes, elements),
    ...checkL4EffectiveGap(nodes, rules),
    ...checkL5ColorPalette(payload, paletteExtra, cssSrc, rules),
    ...checkL6TextContent(nodes, textNodes),
    ...checkL7FontFamily(nodes, rules),
    ...checkL8ImageReferences(cssSrc, elements, null, args.css, args.jsx),
  ];

  const summary = {
    total: violations.length,
    blocks: violations.filter((v) => v.severity === 'block').length,
    warns: violations.filter((v) => v.severity === 'warn').length,
    nodes: nodes.length,
    jsxElements: elements.length,
    cssRules: rules.length,
  };
  const report = { summary, violations, inputs: { bridge: args.bridge, jsx: args.jsx, css: args.css } };

  if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
  console.log(args.format === 'json' ? JSON.stringify(report, null, 2) : formatText(report));

  process.exit(summary.blocks > 0 ? 1 : 0);
}

main();
