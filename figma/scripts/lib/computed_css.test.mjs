import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNodeBox,
  buildNodePositioning,
  buildNodeAppearance,
  buildFullCss,
  buildTextHtml,
  buildTextDefaults,
  enrichComputedCss,
} from './computed_css.mjs';

test('buildNodeBox: flex row with padding + gap', () => {
  const layout = {
    absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 81 },
    paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20,
    itemSpacing: 30,
    layoutMode: 'HORIZONTAL',
  };
  const box = buildNodeBox(layout);
  assert.equal(box.width, '1280px');
  assert.equal(box.height, '81px');
  assert.equal(box.padding, '20px 20px 20px 20px');
  assert.equal(box.gap, '30px');
});

test('buildNodePositioning: VERTICAL flex', () => {
  const p = buildNodePositioning({
    layoutMode: 'VERTICAL',
    primaryAxisAlignItems: 'CENTER',
    counterAxisAlignItems: 'MIN',
  }, null);
  assert.equal(p.mode, 'flex-column');
  assert.equal(p.display, 'flex');
  assert.equal(p.flexDirection, 'column');
  assert.equal(p.justifyContent, 'center');
  assert.equal(p.alignItems, 'flex-start');
});

test('buildNodePositioning: absolute child of NONE parent', () => {
  const parent = {
    layoutMode: 'NONE',
    absoluteBoundingBox: { x: 439, y: -3774, width: 180, height: 26 },
  };
  const child = {
    absoluteBoundingBox: { x: 443, y: -3775, width: 43, height: 26 },
  };
  const p = buildNodePositioning(child, parent);
  assert.equal(p.mode, 'absolute-child');
  assert.equal(p.position, 'absolute');
  assert.equal(p.left, '4px');
  assert.equal(p.top, '-1px');
});

test('buildNodeAppearance: solid fill', () => {
  const node = { style: { fills: [{ type: 'SOLID', visible: true, color: { r: 0.914, g: 0.925, b: 1, a: 1, hex: '#e9ecff' } }] } };
  const a = buildNodeAppearance(node, null);
  assert.equal(a.backgroundColor, '#e9ecff');
});

test('buildNodeAppearance: image fill with hash', () => {
  const node = { style: { fills: [{ type: 'IMAGE', visible: true, imageHash: 'abc123', scaleMode: 'FILL', format: 'png' }] } };
  const a = buildNodeAppearance(node, null);
  assert.equal(a.backgroundImage, "url('./assets/abc123.png')");
  assert.equal(a.backgroundSize, 'cover');
});

test('buildNodeAppearance: precomputedGradient wins', () => {
  const node = { style: { fills: [{ type: 'SOLID', visible: true, color: { hex: '#000' } }] } };
  const a = buildNodeAppearance(node, 'linear-gradient(139deg, #000, #fff)');
  assert.equal(a.background, 'linear-gradient(139deg, #000, #fff)');
  // Solid fallback NOT used when gradient precomputed
  assert.equal(a.backgroundColor, undefined);
});

test('buildNodeAppearance: per-corner radius', () => {
  const node = { style: { topLeftRadius: 7.246, topRightRadius: 7.246, bottomLeftRadius: 7.246, bottomRightRadius: 7.246 } };
  const a = buildNodeAppearance(node, null);
  assert.equal(a.borderRadius, '7.246px');
});

test('buildNodeAppearance: drop shadow', () => {
  const node = {
    style: {
      effects: [{ type: 'DROP_SHADOW', visible: true, offset: { x: 0, y: 4 }, radius: 8, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.25 } }],
    },
  };
  const a = buildNodeAppearance(node, null);
  assert.match(a.boxShadow, /0px 4px 8px 0px rgba\(0, 0, 0, 0\.25\)/);
});

test('buildNodeAppearance: blur effect uses raw radius', () => {
  const node = { style: { effects: [{ type: 'LAYER_BLUR', visible: true, radius: 8 }] } };
  const a = buildNodeAppearance(node, null);
  assert.equal(a.filter, 'blur(8px)');
});

test('buildTextDefaults: font family + weight + lineHeight + case', () => {
  const node = {
    type: 'TEXT',
    text: {
      fontName: { family: 'Anek Tamil', style: 'ExtraBold' },
      fontSize: 116,
      lineHeight: { unit: 'PERCENT', value: 110 },
      letterSpacing: { unit: 'PERCENT', value: -5 },
      textCase: 'UPPER',
      textAlignHorizontal: 'LEFT',
      segments: [{ fills: [{ color: { r: 0, g: 0, b: 0, a: 1, hex: '#000000' } }] }],
    },
  };
  const d = buildTextDefaults(node);
  assert.equal(d.fontFamily, "'Anek Tamil'");
  assert.equal(d.fontWeight, '800');
  assert.equal(d.fontSize, '116px');
  assert.equal(d.lineHeight, '110%');
  assert.equal(d.letterSpacing, '-0.05em');
  assert.equal(d.textTransform, 'uppercase');
  assert.equal(d.textAlign, 'left');
  assert.equal(d.color, '#000000');
});

test('buildTextHtml: multi-segment with color override', () => {
  const node = {
    type: 'TEXT',
    text: {
      characters: 'Train Hard. Live Better',
      segments: [
        { characters: 'Train Hard. ', fills: [{ color: { r: 0, g: 0, b: 0, a: 1, hex: '#000000' } }], fontName: { style: 'ExtraBold' }, fontWeight: 800, fontSize: 116 },
        { characters: 'Live Better', fills: [{ color: { r: 0.5, g: 0.55, b: 0.99, a: 1, hex: '#808dfd' } }], fontName: { style: 'ExtraBold' }, fontWeight: 800, fontSize: 116 },
      ],
    },
  };
  const html = buildTextHtml(node);
  assert.match(html, /<span>Train Hard\. <\/span>/);
  assert.match(html, /<span style="color: #808dfd">Live Better<\/span>/);
});

test('buildTextHtml: single-segment returns text only', () => {
  const node = {
    type: 'TEXT',
    text: {
      characters: 'Home',
      segments: [{ characters: 'Home', fills: [{ color: { hex: '#000' } }] }],
    },
  };
  const html = buildTextHtml(node);
  assert.equal(html, '<span>Home</span>');
});

test('buildTextHtml: hyperlink segment wraps in <a>', () => {
  const node = {
    type: 'TEXT',
    text: {
      segments: [
        { characters: 'click ', fills: [{ color: { hex: '#000' } }] },
        { characters: 'here', fills: [{ color: { hex: '#0066ff' } }], hyperlink: { url: 'https://example.com' } },
      ],
    },
  };
  const html = buildTextHtml(node);
  assert.match(html, /<a href="https:\/\/example\.com"/);
});

test('buildFullCss: integrates box + positioning + appearance', () => {
  const node = {
    layout: {
      absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 81 },
      layoutMode: 'HORIZONTAL',
      paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20,
      itemSpacing: 30,
    },
    style: { fills: [{ type: 'SOLID', visible: true, color: { hex: '#e9ecff' } }] },
  };
  const css = buildFullCss(node, null, null);
  assert.match(css, /display: flex/);
  assert.match(css, /flex-direction: row/);
  assert.match(css, /padding: 20px 20px 20px 20px/);
  assert.match(css, /gap: 30px/);
  assert.match(css, /width: 1280px/);
  assert.match(css, /background-color: #e9ecff/);
});

test('enrichComputedCss: walks tree, attaches computedCss + computedHtml', () => {
  const root = {
    id: 'root',
    type: 'FRAME',
    layout: { absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 }, layoutMode: 'HORIZONTAL', itemSpacing: 5 },
    style: {},
    children: [
      {
        id: 'text1',
        type: 'TEXT',
        layout: { absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 } },
        style: {},
        text: { characters: 'Hi', fontSize: 20, segments: [{ characters: 'Hi', fills: [{ color: { hex: '#000' } }] }] },
      },
    ],
  };
  const count = enrichComputedCss(root);
  assert.ok(count >= 2);
  assert.ok(root.computedCss.full.includes('display: flex'));
  assert.equal(root.children[0].computedHtml, '<span>Hi</span>');
});

test('enrichComputedCss: NONE parent → child gets absolute positioning', () => {
  const root = {
    id: 'logo',
    type: 'FRAME',
    layout: { absoluteBoundingBox: { x: 100, y: 100, width: 180, height: 26 }, layoutMode: 'NONE' },
    style: {},
    children: [
      { id: 'mark', type: 'VECTOR', layout: { absoluteBoundingBox: { x: 104, y: 100, width: 43, height: 26 } }, style: {} },
      { id: 'text', type: 'TEXT', layout: { absoluteBoundingBox: { x: 152, y: 102, width: 128, height: 22 } }, style: {}, text: { segments: [{ characters: 'Brand', fills: [{ color: { hex: '#000' } }] }] } },
    ],
  };
  enrichComputedCss(root);
  assert.match(root.computedCss.full, /position: relative/);
  assert.equal(root.children[0].computedCss.positioning.position, 'absolute');
  assert.equal(root.children[0].computedCss.positioning.left, '4px');
  assert.equal(root.children[1].computedCss.positioning.left, '52px');
});
