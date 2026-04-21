#!/usr/bin/env node
// Tests for the font-hosting split + L9 lint rule:
//   P1: partitionFontsByHost separates MiSans VF → external, keeps Inter → google
//   P2: codegen_pipeline emits an external <link> for MiSans VF's CDN
//   L9: lint warns when CJK content is assigned a Latin-only font

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  partitionFontsByHost,
  EXTERNAL_FONT_STYLESHEETS,
} from './lib/render_node.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'font-partition-'));

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

// ─── P1: partitionFontsByHost ───
console.log('\n[P1] partitionFontsByHost splits Google-hosted vs external-CDN families');
{
  const fw = new Map([
    ['MiSans VF', { weights: new Set([400, 500]), italic: false }],
    ['Inter',     { weights: new Set([400, 700]), italic: false }],
    ['MiSans',    { weights: new Set([400]),      italic: false }],
  ]);
  const { google, externalHrefs } = partitionFontsByHost(fw);
  assert(!google.has('MiSans VF'), 'P1: MiSans VF removed from google map');
  assert(!google.has('MiSans'),    'P1: MiSans removed from google map');
  assert(google.has('Inter'),      'P1: Inter kept in google map');
  assert(externalHrefs.size === 1, 'P1: MiSans + MiSans VF collapse to one external href');
  assert(
    [...externalHrefs][0] === EXTERNAL_FONT_STYLESHEETS['MiSans VF'].href,
    'P1: external href matches the registry entry'
  );
}

// ─── P2: codegen_pipeline injects external stylesheet ───
console.log('\n[P2] codegen_pipeline emits both Google and external font <link>s');
{
  const projectDir = path.join(tmp, 'proj');
  const cacheDir = path.join(tmp, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  // Minimal bridge-agent-payload.json with one MiSans VF text node and one Inter text node
  const payload = {
    meta: {},
    defs: {},
    designSnapshot: {
      root: {
        id: '1:1', name: 'Root', type: 'FRAME', visible: true,
        layout: { width: 400, height: 200, absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 200 }, layoutMode: 'NONE' },
        style: { fills: [], strokes: [] },
        children: [
          {
            id: '1:2', name: 'cn', type: 'TEXT', visible: true,
            layout: { x: 0, y: 0, width: 100, height: 20, absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 } },
            characters: '你好',
            // Bridge exposes font on node.text (consumed by collectFontFamilyWeights) AND on
            // style.textSegments (consumed by render_ready); populate both so this fixture
            // round-trips through the full pipeline.
            text: { characters: '你好', fontName: { family: 'MiSans VF', style: 'Medium' } },
            style: { fills: [], strokes: [],
              textSegments: [{ characters: '你好', fontName: { family: 'MiSans VF', style: 'Medium' } }] },
          },
          {
            id: '1:3', name: 'en', type: 'TEXT', visible: true,
            layout: { x: 0, y: 30, width: 100, height: 20, absoluteBoundingBox: { x: 0, y: 30, width: 100, height: 20 } },
            characters: 'Hello',
            text: { characters: 'Hello', fontName: { family: 'Inter', style: 'Regular' } },
            style: { fills: [], strokes: [],
              textSegments: [{ characters: 'Hello', fontName: { family: 'Inter', style: 'Regular' } }] },
          },
        ],
      },
      resources: { imageResources: [], svgBlobs: [] },
    },
  };
  fs.writeFileSync(path.join(cacheDir, 'bridge-agent-payload.json'), JSON.stringify(payload));

  // codegen_pipeline expects render-ready.json; generate it first
  const rrRes = spawnSync(process.execPath, [path.join(__dirname, 'render_ready.mjs'), cacheDir], { encoding: 'utf8' });
  if (rrRes.status !== 0) {
    console.error('render_ready failed:', rrRes.stderr);
    process.exit(1);
  }

  const cgRes = spawnSync(
    process.execPath,
    [path.join(__dirname, 'codegen_pipeline.mjs'), cacheDir, projectDir, '--project-name', 'fonts-test'],
    { encoding: 'utf8' }
  );
  if (cgRes.status !== 0) {
    console.error('codegen_pipeline failed:', cgRes.stderr);
    process.exit(1);
  }
  const indexHtml = fs.readFileSync(path.join(projectDir, 'index.html'), 'utf8');
  assert(/fonts\.googleapis\.com\/css2\?family=Inter/.test(indexHtml), 'P2: Inter injected as Google Fonts link');
  assert(indexHtml.includes(EXTERNAL_FONT_STYLESHEETS['MiSans VF'].href), 'P2: MiSans VF CDN stylesheet injected');
  assert(!/fonts\.googleapis\.com\/css2\?[^"]*MiSans/.test(indexHtml), 'P2: MiSans not sent through Google Fonts');
}

// ─── L9: lint warns on CJK + Latin-only font ───
console.log('\n[L9] lint warns when CJK content is assigned a Latin-only font');
{
  const projectDir = path.join(tmp, 'l9-proj');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'App.jsx'),
    `export default function App() {
  return (
    <div className="n-1-1" id="1-1">
      <span className="n-1-2" id="1-2">邀请码（可选）</span>
      <span className="n-1-3" id="1-3">Invite code</span>
    </div>
  );
}
`);
  fs.writeFileSync(path.join(projectDir, 'App.css'),
    `.n-1-1 { width: 300px; }
.n-1-2 { font-family: 'Prompt', sans-serif; font-size: 12px; color: #000; }
.n-1-3 { font-family: 'Prompt', sans-serif; font-size: 12px; color: #000; }
`);
  const bridge = {
    meta: {}, defs: {},
    designSnapshot: {
      root: {
        id: '1:1', name: 'Root', type: 'FRAME', visible: true,
        layout: { width: 300, height: 100, absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 100 }, layoutMode: 'NONE' },
        style: { fills: [], strokes: [] },
        children: [
          {
            id: '1:2', name: 'cn', type: 'TEXT', visible: true,
            layout: { x: 0, y: 0, width: 100, height: 20, absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 } },
            characters: '邀请码（可选）',
            style: { fills: [], strokes: [],
              textSegments: [{ characters: '邀请码（可选）', fontName: { family: 'Prompt', style: 'Regular' } }] },
          },
          {
            id: '1:3', name: 'en', type: 'TEXT', visible: true,
            layout: { x: 0, y: 30, width: 100, height: 20, absoluteBoundingBox: { x: 0, y: 30, width: 100, height: 20 } },
            characters: 'Invite code',
            style: { fills: [], strokes: [],
              textSegments: [{ characters: 'Invite code', fontName: { family: 'Prompt', style: 'Regular' } }] },
          },
        ],
      },
      resources: { imageResources: [], svgBlobs: [] },
    },
  };
  const bridgePath = path.join(projectDir, 'bridge.json');
  fs.writeFileSync(bridgePath, JSON.stringify(bridge));

  const out = path.join(projectDir, 'lint.json');
  spawnSync(process.execPath, [
    path.join(__dirname, 'lint_reproduction.mjs'),
    '--bridge', bridgePath,
    '--jsx', path.join(projectDir, 'App.jsx'),
    '--css', path.join(projectDir, 'App.css'),
    '--out', out,
    '--format', 'json',
  ], { encoding: 'utf8' });
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  const l9s = report.violations.filter((v) => v.id === 'L9');
  assert(l9s.length === 1, 'L9: exactly one warning (CJK node flagged, Latin-only node ignored)');
  assert(l9s[0]?.nodeId === '1:2', 'L9: flags the Chinese node');
  assert(/Prompt/.test(l9s[0]?.detail || ''), 'L9: detail mentions the offending font');
  assert(l9s[0]?.severity === 'warn', 'L9: severity is warn (not block)');
}

console.log(`\n── Total: ${passed} passed, ${failed} failed ──`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
