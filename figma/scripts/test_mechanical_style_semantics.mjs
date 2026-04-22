#!/usr/bin/env node
// Smoke tests for mechanical style semantics:
//   S1: render_ready + emit_css preserve fill opacity and gradient stroke for containers
//   S2: render_ready + emit_css use the top-most visible text fill color
//   S3: text gradient fills become background-clip:text in mechanical CSS

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mechanical-style-semantics-'));

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

console.log('\n[S1] mechanical CSS preserves fill opacity and gradient stroke');
{
  const cacheDir = path.join(tmp, 's1-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const payload = {
    meta: {},
    defs: {},
    designSnapshot: {
      root: {
        id: '1:1',
        name: 'Root',
        type: 'FRAME',
        visible: true,
        layout: {
          width: 300,
          height: 120,
          absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 120 },
          layoutMode: 'NONE',
        },
        style: { fills: [], strokes: [] },
        children: [
          {
            id: '1:2',
            name: 'Selected Tab',
            type: 'FRAME',
            visible: true,
            layout: {
              width: 164,
              height: 40,
              absoluteBoundingBox: { x: 20, y: 20, width: 164, height: 40 },
              layoutMode: 'HORIZONTAL',
              itemSpacing: 10,
              paddingTop: 0,
              paddingRight: 16,
              paddingBottom: 0,
              paddingLeft: 16,
            },
            style: {
              fills: [
                {
                  type: 'SOLID',
                  visible: true,
                  opacity: 0.05,
                  color: { r: 1, g: 1, b: 1, a: 1 },
                },
              ],
              backgrounds: [
                {
                  type: 'SOLID',
                  visible: true,
                  opacity: 0.05,
                  color: { r: 1, g: 1, b: 1, a: 1 },
                },
              ],
              strokes: [
                {
                  type: 'GRADIENT_LINEAR',
                  visible: true,
                  opacity: 1,
                  gradientStops: [
                    { position: 0, color: { r: 0.792, g: 0.247, b: 0.914, a: 1 } },
                    { position: 1, color: { r: 0.592, g: 0.337, b: 0.89, a: 1 } },
                  ],
                  gradientTransform: [
                    [0.766, 0.115, 0.102],
                    [-1.928, 0.766, 1.18],
                  ],
                },
              ],
              strokeWeight: 1,
              strokeWeights: { top: 1, right: 1, bottom: 1, left: 1 },
              cornerRadius: 4,
              cornerRadii: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 },
            },
            children: [],
          },
        ],
      },
      resources: { imageResources: [], svgBlobs: [] },
    },
  };
  fs.writeFileSync(path.join(cacheDir, 'bridge-agent-payload.json'), JSON.stringify(payload, null, 2));

  const rrRes = spawnSync(process.execPath, [path.join(__dirname, 'render_ready.mjs'), cacheDir], { encoding: 'utf8' });
  if (rrRes.status !== 0) {
    console.error('render_ready S1 failed:', rrRes.stderr || rrRes.stdout);
    process.exit(1);
  }
  const rrPath = path.join(cacheDir, 'render-ready.json');
  const cssOut = path.join(tmp, 'S1.css');
  const cssRes = spawnSync(process.execPath, [path.join(__dirname, 'emit_css.mjs'), rrPath, cssOut], { encoding: 'utf8' });
  if (cssRes.status !== 0) {
    console.error('emit_css S1 failed:', cssRes.stderr || cssRes.stdout);
    process.exit(1);
  }
  const css = fs.readFileSync(cssOut, 'utf8');
  assert(css.includes('border: 1px solid transparent;'), 'S1: gradient stroke emits transparent border shell');
  assert(css.includes('padding-box, linear-gradient('), 'S1: gradient stroke emits layered background for border-box');
  assert(css.includes('rgba(255, 255, 255, 0.05)'), 'S1: fill opacity preserved as rgba in mechanical CSS');
}

console.log('\n[S2] mechanical text color uses top-most visible fill');
{
  const cacheDir = path.join(tmp, 's2-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const payload = {
    meta: {},
    defs: {},
    designSnapshot: {
      root: {
        id: '1:1',
        name: 'Root',
        type: 'FRAME',
        visible: true,
        layout: {
          width: 300,
          height: 120,
          absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 120 },
          layoutMode: 'NONE',
        },
        style: { fills: [], strokes: [] },
        children: [
          {
            id: '1:2',
            name: 'Author',
            type: 'TEXT',
            visible: true,
            layout: {
              width: 58,
              height: 22,
              absoluteBoundingBox: { x: 20, y: 20, width: 58, height: 22 },
            },
            text: {
              characters: 'by：牧野',
              fontName: { family: 'PingFang SC', style: 'Regular' },
              fontSize: 14,
              fontWeight: 400,
            },
            style: {
              fills: [
                { type: 'SOLID', visible: true, opacity: 1, color: { r: 0.851, g: 0.851, b: 0.851, a: 1 } },
                { type: 'SOLID', visible: true, opacity: 1, color: { r: 0.89, g: 0.392, b: 1, a: 1 } },
              ],
              strokes: [],
              textSegments: [
                {
                  characters: 'by：牧野',
                  fontName: { family: 'PingFang SC', style: 'Regular' },
                  fontSize: 14,
                  fontWeight: 400,
                  fills: [
                    { type: 'SOLID', visible: true, opacity: 1, color: { r: 0.851, g: 0.851, b: 0.851, a: 1 } },
                    { type: 'SOLID', visible: true, opacity: 1, color: { r: 0.89, g: 0.392, b: 1, a: 1 } },
                  ],
                },
              ],
            },
          },
        ],
      },
      resources: { imageResources: [], svgBlobs: [] },
    },
  };
  fs.writeFileSync(path.join(cacheDir, 'bridge-agent-payload.json'), JSON.stringify(payload, null, 2));

  const rrRes = spawnSync(process.execPath, [path.join(__dirname, 'render_ready.mjs'), cacheDir], { encoding: 'utf8' });
  if (rrRes.status !== 0) {
    console.error('render_ready S2 failed:', rrRes.stderr || rrRes.stdout);
    process.exit(1);
  }
  const rrPath = path.join(cacheDir, 'render-ready.json');
  const rr = JSON.parse(fs.readFileSync(rrPath, 'utf8'));
  const textNode = rr.nodes.find((n) => n.id === '1:2');
  assert(textNode?.text?.color === '#e364ff', 'S2: render_ready keeps the top-most visible fill for text color');

  const cssOut = path.join(tmp, 'S2.css');
  const cssRes = spawnSync(process.execPath, [path.join(__dirname, 'emit_css.mjs'), rrPath, cssOut], { encoding: 'utf8' });
  if (cssRes.status !== 0) {
    console.error('emit_css S2 failed:', cssRes.stderr || cssRes.stdout);
    process.exit(1);
  }
  const css = fs.readFileSync(cssOut, 'utf8');
  assert(css.includes('color: #e364ff;'), 'S2: emit_css uses the top-most visible fill color');
}

console.log('\n[S3] mechanical CSS preserves text gradients');
{
  const cacheDir = path.join(tmp, 's3-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const payload = {
    meta: {},
    defs: {},
    designSnapshot: {
      root: {
        id: '1:1',
        name: 'Root',
        type: 'FRAME',
        visible: true,
        layout: {
          width: 300,
          height: 120,
          absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 120 },
          layoutMode: 'NONE',
        },
        style: { fills: [], strokes: [] },
        children: [
          {
            id: '1:2',
            name: 'Gradient Label',
            type: 'TEXT',
            visible: true,
            layout: {
              width: 36,
              height: 18,
              absoluteBoundingBox: { x: 20, y: 20, width: 36, height: 18 },
            },
            text: {
              characters: '推荐榜',
              fontName: { family: 'PingFang SC', style: 'Bold' },
              fontSize: 12,
              fontWeight: 400,
            },
            style: {
              fills: [
                { type: 'SOLID', visible: true, opacity: 1, color: { r: 0.851, g: 0.851, b: 0.851, a: 1 } },
                {
                  type: 'GRADIENT_LINEAR',
                  visible: true,
                  opacity: 1,
                  gradientStops: [
                    { position: 0, color: { r: 0.792, g: 0.247, b: 0.914, a: 1 } },
                    { position: 1, color: { r: 0.592, g: 0.337, b: 0.89, a: 1 } },
                  ],
                  gradientTransform: [
                    [0.657, 0.237, 0.064],
                    [-0.949, 0.657, 0.712],
                  ],
                },
              ],
              strokes: [],
              textSegments: [
                {
                  characters: '推荐榜',
                  fontName: { family: 'PingFang SC', style: 'Bold' },
                  fontSize: 12,
                  fontWeight: 400,
                  fills: [
                    { type: 'SOLID', visible: true, opacity: 1, color: { r: 0.851, g: 0.851, b: 0.851, a: 1 } },
                    {
                      type: 'GRADIENT_LINEAR',
                      visible: true,
                      opacity: 1,
                      gradientStops: [
                        { position: 0, color: { r: 0.792, g: 0.247, b: 0.914, a: 1 } },
                        { position: 1, color: { r: 0.592, g: 0.337, b: 0.89, a: 1 } },
                      ],
                      gradientTransform: [
                        [0.657, 0.237, 0.064],
                        [-0.949, 0.657, 0.712],
                      ],
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
      resources: { imageResources: [], svgBlobs: [] },
    },
  };
  fs.writeFileSync(path.join(cacheDir, 'bridge-agent-payload.json'), JSON.stringify(payload, null, 2));

  const rrRes = spawnSync(process.execPath, [path.join(__dirname, 'render_ready.mjs'), cacheDir], { encoding: 'utf8' });
  if (rrRes.status !== 0) {
    console.error('render_ready S3 failed:', rrRes.stderr || rrRes.stdout);
    process.exit(1);
  }
  const rrPath = path.join(cacheDir, 'render-ready.json');
  const rr = JSON.parse(fs.readFileSync(rrPath, 'utf8'));
  const textNode = rr.nodes.find((n) => n.id === '1:2');
  assert(textNode?.style?.bgGradient?.includes('linear-gradient'), 'S3: render_ready stores text gradient fill');

  const cssOut = path.join(tmp, 'S3.css');
  const cssRes = spawnSync(process.execPath, [path.join(__dirname, 'emit_css.mjs'), rrPath, cssOut], { encoding: 'utf8' });
  if (cssRes.status !== 0) {
    console.error('emit_css S3 failed:', cssRes.stderr || cssRes.stdout);
    process.exit(1);
  }
  const css = fs.readFileSync(cssOut, 'utf8');
  assert(css.includes('background-clip: text;'), 'S3: emit_css uses text background clipping for gradient text');
  assert(css.includes('-webkit-text-fill-color: transparent;'), 'S3: emit_css makes glyph fill transparent for gradient text');
}

console.log(`\n── Total: ${passed} passed, ${failed} failed ──`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
