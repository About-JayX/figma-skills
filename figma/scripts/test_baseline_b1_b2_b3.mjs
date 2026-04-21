#!/usr/bin/env node
// Smoke tests for B1 / B2 / B3 baseline-raising features.
//   B1: render_ready reads computedCss.full for TEXT typography fallback
//   B2: emit_css auto-emits @import url(...google fonts...)
//   B3: render_ready reads border-radius from computedCss when Figma scalar is null
//
// No external dependencies. Constructs minimal renderReady inputs and verifies output.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b1-b2-b3-test-'));

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

// ─── TEST 1: render_ready B1 + B3 (computedCss fallback) ───
console.log('\n[B1 + B3] render_ready computedCss fallback for INSTANCE TEXT + border-radius');

const bridgePayload = {
  meta: {},
  defs: {},
  designSnapshot: {
    root: {
      id: '1:1',
      name: 'Root',
      type: 'FRAME',
      visible: true,
      layout: { width: 100, height: 100, absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 }, layoutMode: 'NONE' },
      style: { fills: [], strokes: [] },
      children: [
        {
          // TEXT node with empty textSegments but rich computedCss (COMPONENT INSTANCE case)
          id: 'I1:1;2:3',
          name: 'Text',
          type: 'TEXT',
          visible: true,
          layout: { x: 10, y: 10, width: 80, height: 24, absoluteBoundingBox: { x: 10, y: 10, width: 80, height: 24 } },
          style: { fills: [], strokes: [], textSegments: null },
          computedHtml: '<span>Learn More</span>',
          computedCss: {
            full: "font-family: 'DM Sans'; font-size: 14px; font-weight: 700; line-height: 140%; letter-spacing: -0.35px; color: #ffffff; text-align: center",
          },
        },
        {
          // Container with border-radius only exposed via computedCss (no cornerRadius scalar)
          id: '1:2',
          name: 'Pill',
          type: 'FRAME',
          visible: true,
          layout: { x: 0, y: 50, width: 100, height: 30, absoluteBoundingBox: { x: 0, y: 50, width: 100, height: 30 }, layoutMode: 'HORIZONTAL' },
          style: { fills: [{ type: 'SOLID', visible: true, color: { r: 0.3, g: 0.5, b: 0.1, a: 1 } }], strokes: [] },
          computedCss: {
            full: 'display: flex; border-radius: 1000px',
          },
        },
      ],
    },
    resources: { imageResources: [], svgBlobs: [] },
  },
};

const cacheDir = path.join(tmp, 'cache');
fs.mkdirSync(cacheDir, { recursive: true });
fs.writeFileSync(path.join(cacheDir, 'bridge-agent-payload.json'), JSON.stringify(bridgePayload, null, 2));

const renderReadyRes = spawnSync(process.execPath, [path.join(__dirname, 'render_ready.mjs'), cacheDir], { encoding: 'utf8' });
if (renderReadyRes.status !== 0) {
  console.error('render_ready failed:', renderReadyRes.stderr);
  process.exit(1);
}
const rr = JSON.parse(fs.readFileSync(path.join(cacheDir, 'render-ready.json'), 'utf8'));
const textNode = rr.nodes.find((n) => n.id === 'I1:1;2:3');
const pillNode = rr.nodes.find((n) => n.id === '1:2');

assert(textNode !== undefined, 'INSTANCE TEXT survives walk');
assert(textNode?.text?.content === 'Learn More', 'B1: content from computedHtml');
assert(textNode?.text?.fontFamily === 'DM Sans', 'B1: fontFamily from computedCss');
assert(textNode?.text?.fontSize === 14, 'B1: fontSize from computedCss');
assert(textNode?.text?.fontWeight === '700', 'B1: fontWeight from computedCss');
assert(textNode?.text?.lineHeight === '140%', 'B1: lineHeight from computedCss');
assert(textNode?.text?.letterSpacing === '-0.35px', 'B1: letterSpacing from computedCss');
assert(textNode?.text?.color === '#ffffff', 'B1: color from computedCss');
assert(textNode?.text?.textAlign === 'center', 'B1: text-align from computedCss');

assert(pillNode !== undefined, 'Pill container survives walk');
assert(pillNode?.style?.borderRadius === 1000, 'B3: border-radius 1000px parsed from computedCss');

// ─── TEST 2: emit_css B2 Google Fonts @import ───
console.log('\n[B2] emit_css auto @import Google Fonts');

const rr2Path = path.join(tmp, 'rr2.json');
fs.writeFileSync(rr2Path, JSON.stringify({
  schemaVersion: 1,
  rootId: '1:1',
  rootClass: 'n-1-1',
  palette: [],
  assetsManifest: [],
  svgManifest: [],
  nodes: [
    { id: '1:1', className: 'n-1-1', parentId: null, type: 'FRAME', role: 'container', rendered: true, childrenOrder: ['1:2','1:3'], box: { width: 100, height: 100, absX: 0, absY: 0 }, flex: { direction: 'column', wrap: false, effectiveGap: 0, gapUniform: true, padding: [0,0,0,0], children: [] }, positioning: 'AUTO', clipsContent: false, style: {}, text: null, image: null, vector: null },
    { id: '1:2', className: 'n-1-2', parentId: '1:1', type: 'TEXT', role: 'text', rendered: true, childrenOrder: [], box: { width: 80, height: 20, absX: 0, absY: 0 }, flex: null, positioning: 'AUTO', clipsContent: false, style: {}, text: { content: 'Hi', fontFamily: 'DM Sans', fontSize: 14, fontWeight: 700, lineHeight: null, letterSpacing: null, color: null, textAlign: null }, image: null, vector: null },
    { id: '1:3', className: 'n-1-3', parentId: '1:1', type: 'TEXT', role: 'text', rendered: true, childrenOrder: [], box: { width: 80, height: 20, absX: 0, absY: 0 }, flex: null, positioning: 'AUTO', clipsContent: false, style: {}, text: { content: 'World', fontFamily: 'Crimson Text', fontSize: 18, fontWeight: 400, lineHeight: null, letterSpacing: null, color: null, textAlign: null }, image: null, vector: null },
  ],
  skipped: [],
  stats: {},
}));
const cssOut = path.join(tmp, 'App.css');
const emitRes = spawnSync(process.execPath, [path.join(__dirname, 'emit_css.mjs'), rr2Path, cssOut], { encoding: 'utf8' });
if (emitRes.status !== 0) {
  console.error('emit_css failed:', emitRes.stderr);
  process.exit(1);
}
const css = fs.readFileSync(cssOut, 'utf8');
assert(css.includes("@import url('https://fonts.googleapis.com/css2?"), 'B2: @import line emitted');
assert(css.includes('family=DM+Sans'), 'B2: DM Sans family in @import');
assert(css.includes('family=Crimson+Text'), 'B2: Crimson Text family in @import');
assert(/wght@(400|700)/.test(css), 'B2: weight spec included');
assert(css.indexOf('@import') < css.indexOf('/* reset */'), 'B2: @import placed before reset');

// ─── TEST 3: emit_css does NOT gate unknown families behind an allowlist ───
console.log('\n[B2 no-allowlist] emit_css still requests unknown font families');
const rr3Path = path.join(tmp, 'rr3.json');
fs.writeFileSync(rr3Path, JSON.stringify({
  schemaVersion: 1, rootId: '1:1', rootClass: 'n-1-1', palette: [], assetsManifest: [], svgManifest: [],
  nodes: [
    { id: '1:1', className: 'n-1-1', parentId: null, type: 'FRAME', role: 'container', rendered: true, childrenOrder: [], box: { width: 100, height: 100, absX: 0, absY: 0 }, flex: null, positioning: 'AUTO', clipsContent: false, style: {}, text: null, image: null, vector: null },
    { id: '1:2', className: 'n-1-2', parentId: '1:1', type: 'TEXT', role: 'text', rendered: true, childrenOrder: [], box: { width: 80, height: 20, absX: 0, absY: 0 }, flex: null, positioning: 'AUTO', clipsContent: false, style: {}, text: { content: 'Hi', fontFamily: 'WeirdCustomFont', fontSize: 14, fontWeight: 400, lineHeight: null, letterSpacing: null, color: null, textAlign: null }, image: null, vector: null },
  ],
  skipped: [], stats: {},
}));
const cssOut3 = path.join(tmp, 'App3.css');
spawnSync(process.execPath, [path.join(__dirname, 'emit_css.mjs'), rr3Path, cssOut3], { encoding: 'utf8' });
const css3 = fs.readFileSync(cssOut3, 'utf8');
assert(css3.includes("@import url('https://fonts.googleapis.com/css2?"), 'B2 no-allowlist: unknown font still emits @import');
assert(css3.includes('family=WeirdCustomFont'), 'B2 no-allowlist: unknown family preserved in request');

// ─── Summary ───
console.log(`\n── Total: ${passed} passed, ${failed} failed ──`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
