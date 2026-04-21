#!/usr/bin/env node
// Smoke tests for mechanical layout semantics:
//   L1: buildReset should not center the whole page with body flex
//   L2: SPACE_BETWEEN auto-layout rows should not also emit a fixed gap
//   L3: Column-parent FILL child with centered fixed geometry should emit align-self:center
//   L4: Text nodes with explicit minWidth should preserve that width in CSS
//   L5: Row fill children with fully resolved geometry should emit fixed width instead of flex redistribution
//   L6: ELLIPSE nodes should emit circular border radius
//   L7: VECTOR nodes should not re-emit borders already baked into SVG

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mechanical-layout-semantics-'));

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

const rrPath = path.join(tmp, 'rr.json');
const cssOut = path.join(tmp, 'App.css');

fs.writeFileSync(
  rrPath,
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
          box: { width: 1280, height: 480, absX: 0, absY: 0 },
          flex: null,
          positioning: 'AUTO',
          clipsContent: false,
          style: { bg: '#ffffff' },
          text: null,
          image: null,
          vector: null,
        },
        {
          id: '1:2',
          className: 'n-1-2',
          parentId: '1:1',
          type: 'FRAME',
          role: 'container',
          rendered: true,
          childrenOrder: ['1:3', '1:4'],
          box: { width: 1240, height: 80, absX: 20, absY: 20 },
          flex: {
            direction: 'row',
            wrap: false,
            effectiveGap: 640,
            gapUniform: true,
            padding: [0, 0, 0, 0],
            justify: 'SPACE_BETWEEN',
            align: 'CENTER',
            children: [],
          },
          positioning: 'AUTO',
          clipsContent: false,
          style: {},
          text: null,
          image: null,
          vector: null,
        },
        {
          id: '1:5',
          className: 'n-1-5',
          parentId: '1:1',
          type: 'FRAME',
          role: 'container',
          rendered: true,
          childrenOrder: ['1:6'],
          box: { width: 1280, height: 480, absX: 0, absY: 100 },
          flex: {
            direction: 'column',
            wrap: false,
            effectiveGap: null,
            gapUniform: true,
            padding: [102, 70, 102, 70],
            justify: 'CENTER',
            align: 'CENTER',
            children: [
              {
                id: '1:6',
                positioning: 'AUTO',
                flexGrow: 0,
                flexBasis: 0,
                sizingH: 'FILL',
                sizingV: 'HUG',
              },
            ],
          },
          positioning: 'AUTO',
          clipsContent: false,
          style: { bg: '#808cfd' },
          text: null,
          image: null,
          vector: null,
        },
        {
          id: '1:6',
          className: 'n-1-6',
          parentId: '1:5',
          type: 'FRAME',
          role: 'container',
          rendered: true,
          childrenOrder: [],
          box: { width: 780, height: 156, absX: 250, absY: 262 },
          flex: {
            direction: 'column',
            wrap: false,
            effectiveGap: 18,
            gapUniform: true,
            padding: [0, 0, 0, 0],
            justify: 'MIN',
            align: 'CENTER',
            children: [],
          },
          positioning: 'AUTO',
          sizingH: 'FILL',
          sizingV: 'HUG',
          clipsContent: false,
          style: {},
          text: null,
          image: null,
          vector: null,
        },
        {
          id: '1:7',
          className: 'n-1-7',
          parentId: '1:1',
          type: 'FRAME',
          role: 'container',
          rendered: true,
          childrenOrder: ['1:8', '1:9', '1:10'],
          box: { width: 1280, height: 480, absX: 0, absY: 700 },
          flex: {
            direction: 'row',
            wrap: false,
            effectiveGap: 0,
            gapUniform: true,
            padding: [0, 0, 0, 0],
            justify: 'MIN',
            align: 'CENTER',
            children: [
              { id: '1:8', positioning: 'AUTO', flexGrow: 1, flexBasis: 0, sizingH: 'FILL', sizingV: 'FILL' },
              { id: '1:9', positioning: 'AUTO', flexGrow: 1, flexBasis: 0, sizingH: 'FILL', sizingV: 'FILL' },
              { id: '1:10', positioning: 'AUTO', flexGrow: 1, flexBasis: 0, sizingH: 'FILL', sizingV: 'FIXED' },
            ],
          },
          positioning: 'AUTO',
          clipsContent: false,
          style: {},
          text: null,
          image: null,
          vector: null,
        },
        {
          id: '1:8',
          className: 'n-1-8',
          parentId: '1:7',
          type: 'FRAME',
          role: 'container',
          rendered: true,
          childrenOrder: [],
          box: { width: 426.667, height: 479, absX: 0, absY: 700 },
          flex: {
            direction: 'column',
            wrap: false,
            effectiveGap: 0,
            gapUniform: true,
            padding: [20, 20, 66, 20],
            justify: 'SPACE_BETWEEN',
            align: 'MIN',
            children: [],
          },
          positioning: 'AUTO',
          sizingH: 'FILL',
          sizingV: 'FILL',
          clipsContent: false,
          style: {},
          text: null,
          image: null,
          vector: null,
        },
        {
          id: '1:9',
          className: 'n-1-9',
          parentId: '1:7',
          type: 'FRAME',
          role: 'container',
          rendered: true,
          childrenOrder: [],
          box: { width: 426.667, height: 479, absX: 426.667, absY: 700 },
          flex: {
            direction: 'column',
            wrap: false,
            effectiveGap: 0,
            gapUniform: true,
            padding: [20, 20, 66, 20],
            justify: 'SPACE_BETWEEN',
            align: 'MIN',
            children: [],
          },
          positioning: 'AUTO',
          sizingH: 'FILL',
          sizingV: 'FILL',
          clipsContent: false,
          style: {},
          text: null,
          image: null,
          vector: null,
        },
        {
          id: '1:10',
          className: 'n-1-10',
          parentId: '1:7',
          type: 'FRAME',
          role: 'image',
          rendered: true,
          childrenOrder: [],
          box: { width: 426.667, height: 479, absX: 853.334, absY: 700 },
          flex: {
            direction: 'row',
            wrap: false,
            effectiveGap: null,
            gapUniform: true,
            padding: [0, 0, 0, 0],
            justify: 'MIN',
            align: 'MIN',
            children: [],
          },
          positioning: 'AUTO',
          sizingH: 'FILL',
          sizingV: 'FIXED',
          clipsContent: false,
          style: {},
          text: null,
          image: { path: './assets/example.jpg', hash: 'abc123', scaleMode: 'FILL' },
          vector: null,
        },
        {
          id: '1:11',
          className: 'n-1-11',
          parentId: '1:1',
          type: 'ELLIPSE',
          role: 'container',
          rendered: true,
          childrenOrder: [],
          box: { width: 85, height: 85, absX: 0, absY: 1300 },
          flex: null,
          positioning: 'AUTO',
          clipsContent: false,
          style: { bg: '#ffffff', borderRadius: '50%' },
          text: null,
          image: null,
          vector: null,
        },
        {
          id: '1:12',
          className: 'n-1-12',
          parentId: '1:1',
          type: 'VECTOR',
          role: 'vector',
          rendered: true,
          childrenOrder: [],
          box: { width: 343, height: 52, absX: 16, absY: 529 },
          flex: null,
          positioning: 'AUTO',
          clipsContent: false,
          style: { bg: '#ffffff', borderColor: '#dedede', borderWidth: 0.5, borderRadius: 10 },
          text: null,
          image: null,
          vector: { svgPath: './svg/input-box.svg', fill: '#ffffff' },
        },
        {
          id: '1:3',
          className: 'n-1-3',
          parentId: '1:2',
          type: 'TEXT',
          role: 'text',
          rendered: true,
          childrenOrder: [],
          box: { width: 120, height: 20, absX: 20, absY: 20 },
          flex: null,
          positioning: 'AUTO',
          minWidth: 120,
          clipsContent: false,
          style: {},
          text: {
            content: 'Left',
            fontFamily: 'Geist',
            fontSize: 14,
            fontWeight: '400',
            lineHeight: '120%',
            letterSpacing: null,
            color: '#000000',
            textAlign: 'left',
            textTransform: null,
            runs: null,
          },
          image: null,
          vector: null,
        },
        {
          id: '1:4',
          className: 'n-1-4',
          parentId: '1:2',
          type: 'TEXT',
          role: 'text',
          rendered: true,
          childrenOrder: [],
          box: { width: 92, height: 20, absX: 165, absY: 20 },
          flex: null,
          positioning: 'AUTO',
          clipsContent: false,
          style: {},
          text: {
            content: 'Right',
            fontFamily: 'Geist',
            fontSize: 14,
            fontWeight: '400',
            lineHeight: '120%',
            letterSpacing: null,
            color: '#000000',
            textAlign: 'left',
            textTransform: null,
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

const emitRes = spawnSync(process.execPath, [path.join(__dirname, 'emit_css.mjs'), rrPath, cssOut], {
  encoding: 'utf8',
});
if (emitRes.status !== 0) {
  console.error('emit_css failed:', emitRes.stderr);
  process.exit(1);
}

const css = fs.readFileSync(cssOut, 'utf8');

console.log('\n[L1] reset should avoid body flex centering');
assert(!css.includes('body { display: flex; justify-content: center; }'), 'L1: body is not hard-coded to flex center');

console.log('\n[L2] SPACE_BETWEEN rows should not emit fixed gap');
assert(css.includes('justify-content: space-between;'), 'L2: space-between semantics preserved');
const rowRule = css.match(/\.n-1-2 \{[\s\S]*?\n\}/)?.[0] || '';
assert(!rowRule.includes('gap:'), 'L2: no fixed gap emitted for space-between row');
const leftTextRule = css.match(/\.n-1-3 \{[\s\S]*?\n\}/)?.[0] || '';
assert(leftTextRule.includes('min-width: 120px;'), 'L4: text min-width emitted for explicit layout width');

console.log('\n[L3] centered fixed-width fill child should not be forced to stretch');
const centeredRule = css.match(/\.n-1-6 \{[\s\S]*?\n\}/)?.[0] || '';
assert(centeredRule.includes('align-self: center;'), 'L3: emit align-self:center from geometry');
assert(!centeredRule.includes('align-self: stretch;'), 'L3: do not force stretch when geometry is centered');

console.log('\n[L5] resolved fill geometry should preserve fixed width');
const resolvedImageRule = css.match(/\.n-1-10 \{[\s\S]*?\n\}/)?.[0] || '';
assert(resolvedImageRule.includes('width: 426.67px;'), 'L5: fixed width emitted from resolved geometry');
assert(!resolvedImageRule.includes('flex: 1 1 0;'), 'L5: do not redistribute already-resolved fill width');

console.log('\n[L6] ellipse nodes should emit circular radius');
const ellipseRule = css.match(/\.n-1-11 \{[\s\S]*?\n\}/)?.[0] || '';
assert(ellipseRule.includes('border-radius: 50%;'), 'L6: ellipse emits circular border radius');

console.log('\n[L7] vector nodes should not duplicate SVG borders');
const vectorRule = css.match(/\.n-1-12 \{[\s\S]*?\n\}/)?.[0] || '';
assert(!vectorRule.includes('border:'), 'L7: no CSS border for vector node');
assert(!vectorRule.includes('border-radius:'), 'L7: no CSS border-radius for vector node');
assert(!vectorRule.includes('background-color:'), 'L7: no CSS background-color for vector node');

console.log(`\n── Total: ${passed} passed, ${failed} failed ──`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
