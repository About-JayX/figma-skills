import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('lint_reproduction: skips L1/L4 for SVG_ISLAND nodes with svgRef', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-repro-'));
  const bridgePath = path.join(tmp, 'bridge-agent-payload.json');
  const renderReadyPath = path.join(tmp, 'render-ready.json');
  const jsxPath = path.join(tmp, 'App.jsx');
  const cssPath = path.join(tmp, 'App.css');

  const bridgePayload = {
    designSnapshot: {
      root: {
        id: '1:1',
        name: 'Island Row',
        type: 'FRAME',
        visible: true,
        layout: {
          layoutMode: 'HORIZONTAL',
          layoutWrap: 'NO_WRAP',
          layoutPositioning: 'AUTO',
          width: 100,
          height: 20,
          itemSpacing: 12,
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
        },
        replay: {
          routeHint: 'SVG_ISLAND',
          verificationTier: 'hard-node',
        },
        svgRef: {
          kind: 'svg',
          fileName: 'svg-1-1.svg',
        },
        children: [
          {
            id: '1:2',
            name: 'Left',
            type: 'FRAME',
            visible: true,
            layout: {
              layoutPositioning: 'AUTO',
              width: 60,
              height: 20,
              absoluteBoundingBox: { x: 0, y: 0, width: 60, height: 20 },
            },
            children: [],
          },
          {
            id: '1:3',
            name: 'Right',
            type: 'FRAME',
            visible: true,
            layout: {
              layoutPositioning: 'AUTO',
              width: 52,
              height: 20,
              absoluteBoundingBox: { x: 72, y: 0, width: 52, height: 20 },
            },
            children: [],
          },
        ],
      },
    },
  };

  const renderReady = {
    rootId: '1:1',
    nodes: [
      {
        id: '1:1',
        className: 'n-1-1',
        flex: {
          direction: 'row',
          effectiveGap: 12,
          gapUniform: true,
        },
      },
    ],
  };

  fs.writeFileSync(bridgePath, JSON.stringify(bridgePayload, null, 2));
  fs.writeFileSync(renderReadyPath, JSON.stringify(renderReady, null, 2));
  fs.writeFileSync(
    jsxPath,
    [
      'export default function App() {',
      '  return (',
      '    <div className="n-1-1" id="1:1">',
      '      <div className="n-1-2" id="1:2" />',
      '      <div className="n-1-3" id="1:3" />',
      '    </div>',
      '  );',
      '}',
      '',
    ].join('\n')
  );
  fs.writeFileSync(
    cssPath,
    [
      '.n-1-1 { display: flex; flex-direction: row; gap: 12px; }',
      '.n-1-2 { width: 60px; height: 20px; }',
      '.n-1-3 { width: 52px; height: 20px; }',
      '',
    ].join('\n')
  );

  const scriptPath = path.resolve('skills/figma/scripts/lint_reproduction.mjs');
  const res = spawnSync(
    process.execPath,
    [scriptPath, '--bridge', bridgePath, '--jsx', jsxPath, '--css', cssPath, '--format', 'json'],
    { encoding: 'utf8' }
  );

  assert.equal(res.status, 0, res.stdout || res.stderr);
  const report = JSON.parse(res.stdout);
  assert.equal(report.summary.blocks, 0);
  assert.equal(report.summary.warns, 0);
});
