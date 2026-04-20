import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reactEmitter, __test } from './react.mjs';

const { cssStringToObject, kebabToCamel } = __test;

test('cssStringToObject: simple decls', () => {
  assert.deepEqual(
    cssStringToObject('padding: 12px; gap: 7.246px; background-color: #e9ecff'),
    { padding: '12px', gap: '7.246px', backgroundColor: '#e9ecff' }
  );
});

test('cssStringToObject: empty / null → {}', () => {
  assert.deepEqual(cssStringToObject(''), {});
  assert.deepEqual(cssStringToObject(null), {});
  assert.deepEqual(cssStringToObject(undefined), {});
});

test('cssStringToObject: handles url() with internal commas', () => {
  const css = "background-image: url('./assets/foo.png'); background-size: cover";
  assert.deepEqual(cssStringToObject(css), {
    backgroundImage: "url('./assets/foo.png')",
    backgroundSize: 'cover',
  });
});

test('cssStringToObject: gradient with internal commas/parens preserved', () => {
  const css = 'background: linear-gradient(180deg, rgb(255,0,0) 0%, rgb(0,0,255) 100%); width: 100px';
  const obj = cssStringToObject(css);
  assert.equal(obj.background, 'linear-gradient(180deg, rgb(255,0,0) 0%, rgb(0,0,255) 100%)');
  assert.equal(obj.width, '100px');
});

test('cssStringToObject: vendor prefixes', () => {
  const obj = cssStringToObject('-webkit-mask-image: url(x); -moz-foo: 1; -ms-bar: 2');
  assert.ok('WebkitMaskImage' in obj);
  assert.ok('MozFoo' in obj);
  assert.ok('msBar' in obj);
});

test('cssStringToObject: CSS custom properties preserved', () => {
  const obj = cssStringToObject('--brand: #ff0000; color: var(--brand)');
  assert.equal(obj['--brand'], '#ff0000');
  assert.equal(obj.color, 'var(--brand)');
});

test('cssStringToObject: malformed decls skipped', () => {
  const obj = cssStringToObject('padding: 12px; nokey; ; only-key:');
  assert.equal(obj.padding, '12px');
  assert.equal(Object.keys(obj).length, 1);
});

test('kebabToCamel: basic + edges', () => {
  assert.equal(kebabToCamel('background-color'), 'backgroundColor');
  assert.equal(kebabToCamel('width'), 'width');
  assert.equal(kebabToCamel('-webkit-foo-bar'), 'WebkitFooBar');
  assert.equal(kebabToCamel('--my-var'), '--my-var');  // custom prop unchanged
});

test('reactEmitter.styleAttr: empty object → empty raw', () => {
  assert.equal(reactEmitter.styleAttr({}).value, '');
  assert.equal(reactEmitter.styleAttr(null).value, '');
});

test('reactEmitter.styleAttr: emits JSX style={{...}}', () => {
  const out = reactEmitter.styleAttr({ padding: '12px', backgroundColor: '#e9ecff' });
  assert.equal(out.value, ' style={{ padding: "12px", backgroundColor: "#e9ecff" }}');
});

test('reactEmitter.styleAttr: quotes special-key (custom property)', () => {
  const out = reactEmitter.styleAttr({ '--brand': '#ff0' });
  assert.match(out.value, /"--brand": "#ff0"/);
});

test('reactEmitter.dataAttrs: emits both attrs, escapes quotes', () => {
  const out = reactEmitter.dataAttrs({ figId: '1:2', figName: 'My "Node"' });
  assert.equal(out.value, ' data-fig-id="1:2" data-fig-name="My &quot;Node&quot;"');
});

test('reactEmitter.dataAttrs: missing figName drops cleanly', () => {
  const out = reactEmitter.dataAttrs({ figId: '1:2' });
  assert.equal(out.value, ' data-fig-id="1:2"');
});

test('reactEmitter.svgRefAttr: emits <img src=... alt="" />', () => {
  const out = reactEmitter.svgRefAttr({ relativePath: 'blobs/svg-x.svg' });
  assert.equal(out.value, '<img src="blobs/svg-x.svg" alt="" />');
});

test('reactEmitter.svgRefAttr: null svgRef → empty', () => {
  assert.equal(reactEmitter.svgRefAttr(null).value, '');
});

test('reactEmitter.svgRefAttr: falls back to localPath', () => {
  const out = reactEmitter.svgRefAttr({ localPath: '/abs/path.svg' });
  assert.equal(out.value, '<img src="/abs/path.svg" alt="" />');
});
