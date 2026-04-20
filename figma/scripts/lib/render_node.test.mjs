import { test } from 'node:test';
import assert from 'node:assert/strict';
import { raw, jsxReact } from './skeleton_template.mjs';
import { renderNode, tagForNode, collectFontFamilies } from './render_node.mjs';

// Minimal stub emitter for unit tests — exposes the contract used by renderNode
// without depending on any real react/html emitter implementation.
function makeStubEmitter() {
  return {
    tag: jsxReact,
    cssStringToTarget(s) { return s; },
    styleAttr(target) { return target ? raw(` style="${target}"`) : raw(''); },
    dataAttrs({ figId, figName }) {
      let out = '';
      if (figId) out += ` data-fig-id="${figId}"`;
      if (figName) out += ` data-fig-name="${figName}"`;
      return raw(out);
    },
    svgRefAttr(svgRef) {
      return raw(`<img src="${svgRef.relativePath || svgRef.localPath}"/>`);
    },
  };
}

test('tagForNode: known + unknown', () => {
  assert.equal(tagForNode({ type: 'FRAME' }), 'div');
  assert.equal(tagForNode({ type: 'TEXT' }), 'span');
  assert.equal(tagForNode({ type: 'SECTION' }), 'section');
  assert.equal(tagForNode({ type: 'VECTOR' }), 'div');
  assert.equal(tagForNode({ type: 'UNKNOWN_TYPE' }), 'div');
  assert.equal(tagForNode(null), 'div');
});

test('renderNode: hidden node returns empty', () => {
  const node = { id: 'a', type: 'FRAME', visible: false };
  assert.equal(renderNode(node, makeStubEmitter()).value, '');
});

test('renderNode: opacity=0 returns empty', () => {
  const node = { id: 'a', type: 'FRAME', style: { opacity: 0 } };
  assert.equal(renderNode(node, makeStubEmitter()).value, '');
});

test('renderNode: leaf with computedCss.full + dataAttrs', () => {
  const node = {
    id: '1:1',
    name: 'Box',
    type: 'FRAME',
    computedCss: { full: 'width:10px;height:10px' },
  };
  const out = renderNode(node, makeStubEmitter()).value;
  assert.equal(out, '<div data-fig-id="1:1" data-fig-name="Box" style="width:10px;height:10px"></div>');
});

test('renderNode: TEXT with computedHtml emits span chain inside <span>', () => {
  const node = {
    id: 't',
    name: 'Title',
    type: 'TEXT',
    computedCss: { full: 'font-size:16px' },
    computedHtml: '<span>hello</span>',
  };
  const out = renderNode(node, makeStubEmitter()).value;
  assert.equal(out, '<span data-fig-id="t" data-fig-name="Title" style="font-size:16px"><span>hello</span></span>');
});

test('renderNode: VECTOR with computedHtml inline svg', () => {
  const node = {
    id: 'v',
    name: 'Mark',
    type: 'VECTOR',
    computedCss: { full: 'width:43px;height:26px' },
    computedHtml: '<svg viewBox="0 0 44 26"><path/></svg>',
  };
  const out = renderNode(node, makeStubEmitter()).value;
  assert.equal(out, '<div data-fig-id="v" data-fig-name="Mark" style="width:43px;height:26px"><svg viewBox="0 0 44 26"><path/></svg></div>');
});

test('renderNode: large svgRef → emitter.svgRefAttr', () => {
  const node = {
    id: 'v',
    type: 'VECTOR',
    computedCss: { full: '' },
    svgRef: { relativePath: 'blobs/svg-v.svg' },
  };
  const out = renderNode(node, makeStubEmitter()).value;
  assert.match(out, /<img src="blobs\/svg-v\.svg"\/>/);
});

test('renderNode: FRAME with children recurses', () => {
  const root = {
    id: 'r',
    type: 'FRAME',
    computedCss: { full: 'display:flex' },
    children: [
      { id: 'c1', type: 'TEXT', computedCss: { full: '' }, computedHtml: '<span>A</span>' },
      { id: 'c2', type: 'TEXT', computedCss: { full: '' }, computedHtml: '<span>B</span>' },
    ],
  };
  const out = renderNode(root, makeStubEmitter()).value;
  assert.match(out, /^<div data-fig-id="r" style="display:flex">/);
  assert.match(out, /<span data-fig-id="c1"[^>]*><span>A<\/span><\/span>/);
  assert.match(out, /<span data-fig-id="c2"[^>]*><span>B<\/span><\/span>/);
});

test('renderNode: NONE-layout parent sorts children by visual order (x then y)', () => {
  // children[] is z-order = [text-at-x52, mark-at-x4]; visual order is mark first
  const parent = {
    id: 'logo',
    type: 'FRAME',
    layout: { layoutMode: 'NONE' },
    computedCss: { full: '' },
    children: [
      {
        id: 'text', type: 'TEXT',
        layout: { absoluteBoundingBox: { x: 52, y: 0, width: 128, height: 22 } },
        computedCss: { full: '' }, computedHtml: '<span>BrandText</span>',
      },
      {
        id: 'mark', type: 'VECTOR',
        layout: { absoluteBoundingBox: { x: 4, y: 0, width: 43, height: 26 } },
        computedCss: { full: '' }, computedHtml: '<svg/>',
      },
    ],
  };
  const out = renderNode(parent, makeStubEmitter()).value;
  // mark should appear before text since x=4 < x=52
  const markIdx = out.indexOf('id="mark"');
  const textIdx = out.indexOf('id="text"');
  assert.ok(markIdx > -1 && textIdx > -1, 'both children should render');
  assert.ok(markIdx < textIdx, 'mark (x=4) must render before text (x=52)');
});

test('renderNode: empty children array → empty body', () => {
  const node = {
    id: 'e', type: 'FRAME', computedCss: { full: '' }, children: [],
  };
  const out = renderNode(node, makeStubEmitter()).value;
  assert.equal(out, '<div data-fig-id="e"></div>');
});

test('renderNode: missing computedCss → no style attr', () => {
  const node = { id: 'x', type: 'FRAME' };
  const out = renderNode(node, makeStubEmitter()).value;
  assert.equal(out, '<div data-fig-id="x"></div>');
});

test('collectFontFamilies: dedupes and preserves first-seen order', () => {
  const root = {
    id: 'r', type: 'FRAME',
    children: [
      { type: 'TEXT', text: { fontName: { family: 'Inter' }, segments: [] } },
      { type: 'TEXT', text: { fontName: { family: 'Inter' }, segments: [] } },
      { type: 'TEXT', text: { fontName: { family: 'Roboto' }, segments: [{ fontName: { family: 'Geist Mono' } }] } },
    ],
  };
  const fams = collectFontFamilies(root);
  assert.deepEqual(fams, ['Inter', 'Roboto', 'Geist Mono']);
});

test('collectFontFamilies: empty / no-text tree → []', () => {
  assert.deepEqual(collectFontFamilies({ type: 'FRAME', children: [] }), []);
  assert.deepEqual(collectFontFamilies(null), []);
});
