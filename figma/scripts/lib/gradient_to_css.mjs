// Convert a Figma gradient paint (serialized snapshot form) into a CSS gradient string.
//
// Figma semantics:
//   gradientTransform is a 2x3 affine matrix [[a, b, tx], [c, d, ty]] that maps
//   paint-local space (the node's padding box, normalized to [0,1]) INTO gradient
//   unit space, where the gradient axis runs from (0, 0.5) to (1, 0.5) for linear,
//   and the unit circle centered at (0.5, 0.5) defines radial handles.
//
//   To recover handles in paint-local coordinates, apply inv(gradientTransform)
//   to the canonical unit handles, then scale by the node's width/height.

const EPS = 1e-9;

function invertAffine(m) {
  if (!Array.isArray(m) || m.length < 2) return null;
  const [a, b, tx] = m[0];
  const [c, d, ty] = m[1];
  const det = a * d - b * c;
  if (Math.abs(det) < EPS) return null;
  const inv = 1 / det;
  return [
    [d * inv, -b * inv, (b * ty - d * tx) * inv],
    [-c * inv, a * inv, (c * tx - a * ty) * inv],
  ];
}

function applyAffine(m, x, y) {
  const [a, b, tx] = m[0];
  const [c, d, ty] = m[1];
  return { x: a * x + b * y + tx, y: c * x + d * y + ty };
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function roundTo(n, digits = 3) {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

function formatColor(color, paintOpacity = 1) {
  if (!color || typeof color !== 'object') return 'transparent';
  const r = Math.round(clamp01(color.r ?? 0) * 255);
  const g = Math.round(clamp01(color.g ?? 0) * 255);
  const b = Math.round(clamp01(color.b ?? 0) * 255);
  const a = clamp01((color.a ?? 1) * paintOpacity);
  if (a >= 0.999) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${roundTo(a, 4)})`;
}

function formatStops(stops, paintOpacity) {
  return stops
    .map((s) => `${formatColor(s.color, paintOpacity)} ${roundTo((s.position ?? 0) * 100, 2)}%`)
    .join(', ');
}

// CSS linear-gradient angle convention: 0deg points UP (decreasing y), clockwise.
// Given a start→end vector (dx, dy) in pixel space (y-down), angle = atan2(dx, -dy).
function vectorToCssAngle(dx, dy) {
  const rad = Math.atan2(dx, -dy);
  let deg = (rad * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return roundTo(deg, 2);
}

function linearToCss(paint, width, height) {
  const stops = Array.isArray(paint.gradientStops) ? paint.gradientStops : [];
  if (stops.length < 2) return null;

  const gt = paint.gradientTransform;
  const inv = gt ? invertAffine(gt) : null;
  if (!inv) {
    return `linear-gradient(180deg, ${formatStops(stops, paint.opacity ?? 1)})`;
  }

  const start = applyAffine(inv, 0, 0.5);
  const end = applyAffine(inv, 1, 0.5);
  const dx = (end.x - start.x) * width;
  const dy = (end.y - start.y) * height;
  const angle = vectorToCssAngle(dx, dy);

  return `linear-gradient(${angle}deg, ${formatStops(stops, paint.opacity ?? 1)})`;
}

function radialToCss(paint, width, height) {
  const stops = Array.isArray(paint.gradientStops) ? paint.gradientStops : [];
  if (stops.length < 2) return null;

  const gt = paint.gradientTransform;
  const inv = gt ? invertAffine(gt) : null;
  if (!inv) {
    return `radial-gradient(ellipse at center, ${formatStops(stops, paint.opacity ?? 1)})`;
  }

  const center = applyAffine(inv, 0.5, 0.5);
  const rxEnd = applyAffine(inv, 1, 0.5);
  const ryEnd = applyAffine(inv, 0.5, 1);

  const cx = roundTo(center.x * width, 2);
  const cy = roundTo(center.y * height, 2);
  const rx = roundTo(Math.hypot((rxEnd.x - center.x) * width, (rxEnd.y - center.y) * height), 2);
  const ry = roundTo(Math.hypot((ryEnd.x - center.x) * width, (ryEnd.y - center.y) * height), 2);

  return `radial-gradient(ellipse ${rx}px ${ry}px at ${cx}px ${cy}px, ${formatStops(stops, paint.opacity ?? 1)})`;
}

function conicToCss(paint, width, height) {
  const stops = Array.isArray(paint.gradientStops) ? paint.gradientStops : [];
  if (stops.length < 2) return null;

  const gt = paint.gradientTransform;
  const inv = gt ? invertAffine(gt) : null;
  if (!inv) {
    return `conic-gradient(from 0deg at 50% 50%, ${formatStops(stops, paint.opacity ?? 1)})`;
  }

  const center = applyAffine(inv, 0.5, 0.5);
  const axis = applyAffine(inv, 1, 0.5);
  const dx = (axis.x - center.x) * width;
  const dy = (axis.y - center.y) * height;
  const fromDeg = vectorToCssAngle(dx, dy);

  const cx = roundTo(center.x * 100, 2);
  const cy = roundTo(center.y * 100, 2);

  return `conic-gradient(from ${fromDeg}deg at ${cx}% ${cy}%, ${formatStops(stops, paint.opacity ?? 1)})`;
}

function diamondToCss(paint, width, height) {
  // No native CSS equivalent. Approximate with a conic-gradient whose handles match
  // the diamond axes. Downstream code should render via SVG/canvas for hard-node
  // accuracy; this returns a reasonable visual fallback.
  const stops = Array.isArray(paint.gradientStops) ? paint.gradientStops : [];
  if (stops.length < 2) return null;
  return conicToCss(paint, width, height);
}

export function gradientPaintToCss(paint, box) {
  if (!paint || typeof paint !== 'object') return null;
  if (paint.visible === false) return null;
  const width = box && Number.isFinite(box.width) && box.width > 0 ? box.width : 1;
  const height = box && Number.isFinite(box.height) && box.height > 0 ? box.height : 1;

  switch (paint.type) {
    case 'GRADIENT_LINEAR': return linearToCss(paint, width, height);
    case 'GRADIENT_RADIAL': return radialToCss(paint, width, height);
    case 'GRADIENT_ANGULAR': return conicToCss(paint, width, height);
    case 'GRADIENT_DIAMOND': return diamondToCss(paint, width, height);
    default: return null;
  }
}

export function gradientListToCss(paints, box) {
  if (!Array.isArray(paints)) return null;
  const layers = [];
  for (let i = paints.length - 1; i >= 0; i -= 1) {
    const css = gradientPaintToCss(paints[i], box);
    if (css) layers.push(css);
  }
  return layers.length > 0 ? layers.join(', ') : null;
}

export const __test = {
  invertAffine,
  applyAffine,
  vectorToCssAngle,
  formatColor,
};
