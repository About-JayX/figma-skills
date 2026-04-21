#!/usr/bin/env node
// Smoke tests for mechanical text semantics:
//   M1: render_ready preserves text-transform from computedCss.full
//   M2: render_ready preserves multi-run computedHtml as structured text runs
//   M3: emit_jsx emits nested spans for styled text runs
//   M4: emit_css emits text-transform for TEXT nodes
//   M5: emit_css emits text-decoration for TEXT nodes
//   M6: emit_css emits richer fallback stacks for app fonts

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mechanical-text-semantics-'));

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}

console.log('\n[M1 + M2] render_ready preserves text-transform and rich text runs');

const bridgePayload = {
  meta: {},
  defs: {},
  designSnapshot: {
    root: {
      id: '1:1',
      name: 'Root',
      type: 'FRAME',
      visible: true,
      layout: {
        width: 400,
        height: 120,
        absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 120 },
        layoutMode: 'NONE',
      },
      style: { fills: [], strokes: [] },
      children: [
        {
          id: '1:2',
          name: 'Headline',
          type: 'TEXT',
          visible: true,
          layout: {
            x: 20,
            y: 20,
            width: 320,
            height: 48,
            absoluteBoundingBox: { x: 20, y: 20, width: 320, height: 48 },
          },
          style: { fills: [], strokes: [], textSegments: null },
          computedHtml: '<span>Train Hard. </span><span style="color: #808dfd">Live Better</span>',
          computedCss: {
            full: "font-family: 'Anek Tamil'; font-size: 40px; font-weight: 800; line-height: 110%; letter-spacing: -0.05em; text-align: left; text-transform: uppercase; color: #000000",
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

const renderReadyRes = spawnSync(process.execPath, [path.join(__dirname, 'render_ready.mjs'), cacheDir], {
  encoding: 'utf8',
});
if (renderReadyRes.status !== 0) {
  console.error('render_ready failed:', renderReadyRes.stderr);
  process.exit(1);
}

const rrPath = path.join(cacheDir, 'render-ready.json');
const rr = JSON.parse(fs.readFileSync(rrPath, 'utf8'));
const textNode = rr.nodes.find((n) => n.id === '1:2');

assert(textNode !== undefined, 'TEXT node survives render_ready');
assert(textNode?.text?.content === 'Train Hard. Live Better', 'content is flattened text from computedHtml');
assert(textNode?.text?.textTransform === 'uppercase', 'M1: text-transform preserved from computedCss');
assert(Array.isArray(textNode?.text?.runs), 'M2: rich text runs array emitted');
assert(textNode?.text?.runs?.length === 2, 'M2: two text runs preserved');
assert(textNode?.text?.runs?.[0]?.content === 'Train Hard. ', 'M2: first text run content preserved');
assert(textNode?.text?.runs?.[1]?.content === 'Live Better', 'M2: second text run content preserved');
assert(textNode?.text?.runs?.[1]?.style?.color === '#808dfd', 'M2: second text run color preserved');

console.log('\n[M3] emit_jsx emits nested spans for styled text runs');
const jsxOut = path.join(tmp, 'App.jsx');
const emitJsxRes = spawnSync(process.execPath, [path.join(__dirname, 'emit_jsx.mjs'), rrPath, jsxOut], {
  encoding: 'utf8',
});
if (emitJsxRes.status !== 0) {
  console.error('emit_jsx failed:', emitJsxRes.stderr);
  process.exit(1);
}
const jsx = fs.readFileSync(jsxOut, 'utf8');
assert(
  /<span className="n-1-2" id="1-2"><span>Train Hard\. <\/span><span style=\{\{ color: ["']#808dfd["'] \}\}>Live Better<\/span><\/span>/.test(jsx),
  'M3: nested rich text spans emitted into JSX'
);

console.log('\n[M4] emit_css emits text-transform for TEXT nodes');
const cssOut = path.join(tmp, 'App.css');
const emitCssRes = spawnSync(process.execPath, [path.join(__dirname, 'emit_css.mjs'), rrPath, cssOut], {
  encoding: 'utf8',
});
if (emitCssRes.status !== 0) {
  console.error('emit_css failed:', emitCssRes.stderr);
  process.exit(1);
}
const css = fs.readFileSync(cssOut, 'utf8');
assert(css.includes('text-transform: uppercase;'), 'M4: text-transform emitted into CSS');

console.log('\n[M5] emit_css emits text-decoration for TEXT nodes');
const rrDecorPath = path.join(tmp, 'rr-decoration.json');
fs.writeFileSync(
  rrDecorPath,
  JSON.stringify(
    {
      schemaVersion: 1,
      rootId: '1:1',
      rootClass: 'n-1-1',
      palette: [],
      assetsManifest: [],
      svgManifest: [],
      nodes: [
        {
          id: '1:1',
          className: 'n-1-1',
          parentId: null,
          type: 'FRAME',
          role: 'container',
          rendered: true,
          childrenOrder: ['1:2'],
          box: { width: 200, height: 100, absX: 0, absY: 0 },
          flex: null,
          positioning: 'AUTO',
          clipsContent: false,
          style: {},
          text: null,
          image: null,
          vector: null,
        },
        {
          id: '1:2',
          className: 'n-1-2',
          parentId: '1:1',
          type: 'TEXT',
          role: 'text',
          rendered: true,
          childrenOrder: [],
          box: { width: 89, height: 18, absX: 10, absY: 10 },
          flex: null,
          positioning: 'AUTO',
          clipsContent: false,
          style: {},
          text: {
            content: 'Instagram',
            fontFamily: 'Geist',
            fontSize: 14,
            fontWeight: '700',
            lineHeight: '131%',
            letterSpacing: '0.01em',
            color: '#000000',
            textAlign: 'left',
            textTransform: null,
            textDecoration: 'underline',
            runs: null,
          },
          image: null,
          vector: null,
        },
      ],
      skipped: [],
      stats: {},
    },
    null,
    2
  )
);
const cssDecorOut = path.join(tmp, 'App-decoration.css');
const emitCssDecorRes = spawnSync(process.execPath, [path.join(__dirname, 'emit_css.mjs'), rrDecorPath, cssDecorOut], {
  encoding: 'utf8',
});
if (emitCssDecorRes.status !== 0) {
  console.error('emit_css (decoration) failed:', emitCssDecorRes.stderr);
  process.exit(1);
}
const cssDecor = fs.readFileSync(cssDecorOut, 'utf8');
assert(cssDecor.includes('text-decoration: underline;'), 'M5: text-decoration emitted into CSS');

console.log('\n[M6] emit_css emits richer fallback stacks for app fonts');
const rrFontPath = path.join(tmp, 'rr-font.css.json');
fs.writeFileSync(
  rrFontPath,
  JSON.stringify(
    {
      schemaVersion: 1,
      rootId: '1:1',
      rootClass: 'n-1-1',
      palette: [],
      assetsManifest: [],
      svgManifest: [],
      nodes: [
        {
          id: '1:1',
          className: 'n-1-1',
          parentId: null,
          type: 'FRAME',
          role: 'container',
          rendered: true,
          childrenOrder: ['1:2'],
          box: { width: 375, height: 812, absX: 0, absY: 0 },
          flex: null,
          positioning: 'AUTO',
          clipsContent: false,
          style: {},
          text: null,
          image: null,
          vector: null,
        },
        {
          id: '1:2',
          className: 'n-1-2',
          parentId: '1:1',
          type: 'TEXT',
          role: 'text',
          rendered: true,
          childrenOrder: [],
          box: { width: 179, height: 76, absX: 16, absY: 413 },
          flex: null,
          positioning: 'AUTO',
          clipsContent: false,
          style: {},
          text: {
            content: '使用您的手机号/邮箱注册',
            fontFamily: 'MiSans VF',
            fontSize: 24,
            fontWeight: '450',
            lineHeight: '160%',
            letterSpacing: '0px',
            color: '#000000',
            textAlign: 'left',
            textTransform: null,
            textDecoration: null,
            runs: null,
          },
          image: null,
          vector: null,
        },
      ],
      skipped: [],
      stats: {},
    },
    null,
    2
  )
);
const cssFontOut = path.join(tmp, 'App-font.css');
const emitCssFontRes = spawnSync(process.execPath, [path.join(__dirname, 'emit_css.mjs'), rrFontPath, cssFontOut], {
  encoding: 'utf8',
});
if (emitCssFontRes.status !== 0) {
  console.error('emit_css (font stack) failed:', emitCssFontRes.stderr);
  process.exit(1);
}
const cssFont = fs.readFileSync(cssFontOut, 'utf8');
assert(
  cssFont.includes("font-family: 'MiSans VF', 'MiSans', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;"),
  'M6: MiSans VF stack includes both the Figma name and the CDN-registered name'
);

// M7: font-weight quantized to nearest 100 (450 → 500). Fallback fonts (PingFang
// SC etc.) only ship static cuts; a raw 450 collapses to 400 in browsers and
// makes headings look unbold.
assert(
  /\.n-1-2\s*\{[^}]*font-weight:\s*500;/.test(cssFont),
  'M7: font-weight 450 quantized to 500'
);

// M8: CJK content gets word-break:keep-all + overflow-wrap:break-word so
// "使用您的 手机号/邮箱注册" doesn't split "手机号" down the middle when the
// container is narrow.
assert(
  /\.n-1-2\s*\{[^}]*word-break:\s*keep-all;/.test(cssFont),
  'M8: CJK text gets word-break: keep-all'
);
assert(
  /\.n-1-2\s*\{[^}]*overflow-wrap:\s*break-word;/.test(cssFont),
  'M8: CJK text gets overflow-wrap: break-word'
);

// M9: weight quantization boundary checks (regression guard for the rounding
// table). 380→400, 330→300, 750→800, "bold" keyword passes through.
const rrWeightPath = path.join(tmp, 'rr-weight.json');
fs.writeFileSync(
  rrWeightPath,
  JSON.stringify({
    schemaVersion: 1,
    rootId: '1:1',
    rootClass: 'n-1-1',
    palette: [],
    assetsManifest: [],
    svgManifest: [],
    nodes: [
      { id: '1:1', className: 'n-1-1', parentId: null, type: 'FRAME', role: 'container', rendered: true,
        childrenOrder: ['1:a','1:b','1:c','1:d','1:e'], box: { width: 400, height: 400, absX: 0, absY: 0 },
        flex: null, positioning: 'AUTO', clipsContent: false, style: {}, text: null, image: null, vector: null },
      ...[
        { id: '1:a', weight: '380', expect: '400' },
        { id: '1:b', weight: '330', expect: '300' },
        { id: '1:c', weight: '450', expect: '500' },
        { id: '1:d', weight: '750', expect: '800' },
        { id: '1:e', weight: 'bold', expect: 'bold' },
      ].map(({ id, weight }) => ({
        id, className: `n-${id.replace(':','-')}`, parentId: '1:1', type: 'TEXT', role: 'text',
        rendered: true, childrenOrder: [], box: { width: 100, height: 20, absX: 0, absY: 0 }, flex: null,
        positioning: 'AUTO', clipsContent: false, style: {}, image: null, vector: null,
        text: { content: 'sample', fontFamily: 'Inter', fontSize: 14, fontWeight: weight,
                lineHeight: null, letterSpacing: null, color: '#000000', textAlign: 'left',
                textTransform: null, textDecoration: null, runs: null },
      })),
    ], skipped: [], stats: {},
  }, null, 2)
);
const cssWeightOut = path.join(tmp, 'App-weight.css');
spawnSync(process.execPath, [path.join(__dirname, 'emit_css.mjs'), rrWeightPath, cssWeightOut], { encoding: 'utf8' });
const cssWeight = fs.readFileSync(cssWeightOut, 'utf8');
for (const { id, expect } of [
  { id: '1-a', expect: '400' },
  { id: '1-b', expect: '300' },
  { id: '1-c', expect: '500' },
  { id: '1-d', expect: '800' },
  { id: '1-e', expect: 'bold' },
]) {
  const re = new RegExp(`\\.n-${id}\\s*\\{[^}]*font-weight:\\s*${expect};`);
  assert(re.test(cssWeight), `M9: weight for .n-${id} quantized to ${expect}`);
}

console.log(`\n── Total: ${passed} passed, ${failed} failed ──`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
