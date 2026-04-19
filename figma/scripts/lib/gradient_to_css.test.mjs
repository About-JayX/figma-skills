import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradientPaintToCss, __test } from './gradient_to_css.mjs';

const { invertAffine, applyAffine, vectorToCssAngle } = __test;

const box = { width: 100, height: 200 };

test('invertAffine: identity round-trip', () => {
  const I = [[1, 0, 0], [0, 1, 0]];
  const inv = invertAffine(I);
  const p = applyAffine(inv, 0.5, 0.7);
  assert.equal(p.x, 0.5);
  assert.equal(p.y, 0.7);
});

test('invertAffine: singular returns null', () => {
  const S = [[1, 2, 0], [2, 4, 0]];
  assert.equal(invertAffine(S), null);
});

test('vectorToCssAngle: cardinal directions', () => {
  assert.equal(vectorToCssAngle(0, 1), 180); // down = 180deg in CSS
  assert.equal(vectorToCssAngle(1, 0), 90); // right = 90deg
  assert.equal(vectorToCssAngle(0, -1), 0); // up = 0deg
  assert.equal(vectorToCssAngle(-1, 0), 270); // left = 270deg
});

test('LINEAR identity matrix => left-to-right (90deg)', () => {
  const paint = {
    type: 'GRADIENT_LINEAR',
    gradientTransform: [[1, 0, 0], [0, 1, 0]],
    gradientStops: [
      { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
    ],
  };
  const css = gradientPaintToCss(paint, box);
  assert.match(css, /^linear-gradient\(90deg,/);
  assert.match(css, /rgb\(0, 0, 0\) 0%/);
  assert.match(css, /rgb\(255, 255, 255\) 100%/);
});

test('LINEAR top-to-bottom matrix => 180deg', () => {
  // Figma's "top to bottom" matrix rotates the axis by 90° CW.
  // Matrix [[0, 1, 0], [-1, 0, 1]] maps paint (0.5, 0) -> gradient (0, 0.5)
  // and paint (0.5, 1) -> gradient (1, 0.5).
  const paint = {
    type: 'GRADIENT_LINEAR',
    gradientTransform: [[0, 1, 0], [-1, 0, 1]],
    gradientStops: [
      { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
    ],
  };
  const css = gradientPaintToCss(paint, box);
  assert.match(css, /^linear-gradient\(180deg,/);
});

test('LINEAR bottom-to-top matrix => 0deg', () => {
  // Start handle at bottom (0.5, 1), end at top (0.5, 0)
  // gradient(0, 0.5) -> paint(0.5, 1): requires inv such that
  // inv * (0, 0.5) = (0.5, 1). Try matrix [[0, -1, 1], [1, 0, 0]] inverted:
  // det = 0*0 - (-1)*1 = 1; inv = [[0, 1, 0], [-1, 0, 1]]
  // inv * (0, 0.5) = (0.5, 0)... that's top.
  // The actual forward matrix whose inv maps (0,0.5)->(0.5,1): use [[0, -1, 1], [1, 0, 0]]
  const paint = {
    type: 'GRADIENT_LINEAR',
    gradientTransform: [[0, -1, 1], [1, 0, 0]],
    gradientStops: [
      { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
    ],
  };
  const css = gradientPaintToCss(paint, box);
  assert.match(css, /^linear-gradient\(0deg,/);
});

test('LINEAR respects paint.opacity on stops', () => {
  const paint = {
    type: 'GRADIENT_LINEAR',
    opacity: 0.5,
    gradientTransform: [[1, 0, 0], [0, 1, 0]],
    gradientStops: [
      { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 1, g: 1, b: 1, a: 0.8 } },
    ],
  };
  const css = gradientPaintToCss(paint, box);
  assert.match(css, /rgba\(0, 0, 0, 0\.5\) 0%/);
  assert.match(css, /rgba\(255, 255, 255, 0\.4\) 100%/);
});

test('RADIAL identity => ellipse centered at (50,100) with rx=50 ry=100', () => {
  const paint = {
    type: 'GRADIENT_RADIAL',
    gradientTransform: [[1, 0, 0], [0, 1, 0]],
    gradientStops: [
      { position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
    ],
  };
  const css = gradientPaintToCss(paint, box);
  assert.match(css, /^radial-gradient\(ellipse 50px 100px at 50px 100px,/);
});

test('ANGULAR identity => conic starting at 90deg (axis pointing right)', () => {
  const paint = {
    type: 'GRADIENT_ANGULAR',
    gradientTransform: [[1, 0, 0], [0, 1, 0]],
    gradientStops: [
      { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
    ],
  };
  const css = gradientPaintToCss(paint, box);
  assert.match(css, /^conic-gradient\(from 90deg at 50% 50%,/);
});

test('hidden paint returns null', () => {
  const paint = {
    type: 'GRADIENT_LINEAR',
    visible: false,
    gradientStops: [
      { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
    ],
  };
  assert.equal(gradientPaintToCss(paint, box), null);
});

test('unknown type returns null', () => {
  assert.equal(gradientPaintToCss({ type: 'SOLID' }, box), null);
});
