// Compute CSS per-node from bridge designSnapshot fields.
//
// Goal: make the agent's job pure translation from data to markup. Any
// judgement call about layoutMode / box model / positioning / fills / effects
// is resolved here once, not re-derived at prompt time.
//
// Exports:
//   buildNodeBox(layout)         → { width, height, padding, gap, rowGap, minWidth, ... }
//   buildNodePositioning(layout, parentBox)
//                                → { mode, flexDirection?, justifyContent?,
//                                    alignItems?, flexWrap?, position?, left?,
//                                    top?, transform? }
//   buildNodeAppearance(node, precomputedGradient)
//                                → { background?, borderRadius?, opacity?,
//                                    filter?, backdropFilter?, boxShadow?, ... }
//   buildFullCss(node, ...)      → one inline CSS string
//   buildTextHtml(node)          → '<span>...</span><span style="color:#...">...' or null
//   enrichComputedCss(root)      → walks tree, mutates nodes with computedCss / computedHtml

const FLEX_ALIGN_PRIMARY = {
  MIN: 'flex-start',
  CENTER: 'center',
  MAX: 'flex-end',
  SPACE_BETWEEN: 'space-between',
  SPACE_AROUND: 'space-around',
  SPACE_EVENLY: 'space-evenly',
};

const FLEX_ALIGN_COUNTER = {
  MIN: 'flex-start',
  CENTER: 'center',
  MAX: 'flex-end',
  BASELINE: 'baseline',
};

const LAYOUT_WRAP_MAP = { NO_WRAP: null, WRAP: 'wrap' };

const TEXT_ALIGN_H = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' };
const TEXT_ALIGN_V = { TOP: 'flex-start', CENTER: 'center', BOTTOM: 'flex-end' };
const TEXT_CASE = {
  UPPER: 'uppercase',
  LOWER: 'lowercase',
  TITLE: 'capitalize',
  SMALL_CAPS: null,
  SMALL_CAPS_FORCED: null,
  ORIGINAL: null,
};

const FONT_STYLE_TO_WEIGHT = {
  Thin: 100,
  ExtraLight: 200,
  UltraLight: 200,
  Light: 300,
  Regular: 400,
  Normal: 400,
  Medium: 500,
  SemiBold: 600,
  DemiBold: 600,
  Bold: 700,
  ExtraBold: 800,
  Heavy: 800,
  UltraBold: 800,
  Black: 900,
};

function px(n) {
  if (typeof n !== 'number' || !isFinite(n)) return null;
  // Preserve sub-pixel precision up to 3 decimals; strip trailing zeros.
  const rounded = Math.round(n * 1000) / 1000;
  return `${rounded}px`;
}

function pctOrPx(unit, value) {
  if (typeof value !== 'number' || !isFinite(value)) return null;
  if (unit === 'PIXELS') return `${Math.round(value * 100) / 100}px`;
  if (unit === 'PERCENT') return `${Math.round(value * 100) / 100}%`;
  return null;
}

function hexToRgba(color, extraAlpha = 1) {
  if (!color || typeof color !== 'object') return null;
  const r = Math.round((color.r ?? 0) * 255);
  const g = Math.round((color.g ?? 0) * 255);
  const b = Math.round((color.b ?? 0) * 255);
  const a = Math.max(0, Math.min(1, (color.a ?? 1) * extraAlpha));
  if (a >= 0.999) return color.hex || `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 10000) / 10000})`;
}

// ===== Box =====

export function buildNodeBox(layout) {
  if (!layout) return null;
  const box = {};
  const w = layout.absoluteBoundingBox?.width ?? layout.width;
  const h = layout.absoluteBoundingBox?.height ?? layout.height;
  if (typeof w === 'number') box.width = px(w);
  if (typeof h === 'number') box.height = px(h);

  if (typeof layout.minWidth === 'number') box.minWidth = px(layout.minWidth);
  if (typeof layout.maxWidth === 'number') box.maxWidth = px(layout.maxWidth);
  if (typeof layout.minHeight === 'number') box.minHeight = px(layout.minHeight);
  if (typeof layout.maxHeight === 'number') box.maxHeight = px(layout.maxHeight);

  const { paddingTop: pt, paddingRight: pr, paddingBottom: pb, paddingLeft: pl } = layout;
  if ([pt, pr, pb, pl].some((v) => typeof v === 'number' && v !== 0)) {
    box.padding = `${px(pt || 0)} ${px(pr || 0)} ${px(pb || 0)} ${px(pl || 0)}`;
  }

  if (typeof layout.itemSpacing === 'number' && layout.itemSpacing !== 0) {
    box.gap = px(layout.itemSpacing);
  }
  if (typeof layout.counterAxisSpacing === 'number' && layout.counterAxisSpacing !== 0) {
    box.rowGap = px(layout.counterAxisSpacing);
  }

  if (layout.clipsContent === true) box.overflow = 'hidden';
  else if (layout.clipsContent === false) box.overflow = 'visible';

  return Object.keys(box).length > 0 ? box : null;
}

// ===== Positioning =====

export function buildNodePositioning(layout, parentLayout) {
  if (!layout) return null;
  const mode = resolvePositioningMode(layout, parentLayout);
  const p = { mode };

  if (mode === 'flex-row' || mode === 'flex-column') {
    p.display = 'flex';
    p.flexDirection = mode === 'flex-row' ? 'row' : 'column';
    if (layout.primaryAxisAlignItems && FLEX_ALIGN_PRIMARY[layout.primaryAxisAlignItems]) {
      p.justifyContent = FLEX_ALIGN_PRIMARY[layout.primaryAxisAlignItems];
    }
    if (layout.counterAxisAlignItems && FLEX_ALIGN_COUNTER[layout.counterAxisAlignItems]) {
      p.alignItems = FLEX_ALIGN_COUNTER[layout.counterAxisAlignItems];
    }
    if (layout.layoutWrap && LAYOUT_WRAP_MAP[layout.layoutWrap]) {
      p.flexWrap = LAYOUT_WRAP_MAP[layout.layoutWrap];
    }
  } else if (mode === 'grid') {
    p.display = 'grid';
    // Track template synthesis is left to consumer; box already carries gap/rowGap.
  } else if (mode === 'absolute-child') {
    const p0 = parentLayout?.absoluteBoundingBox;
    const s0 = layout.absoluteBoundingBox;
    if (p0 && s0) {
      p.position = 'absolute';
      p.left = px(s0.x - p0.x);
      p.top = px(s0.y - p0.y);
    }
  }

  if (layout.rotation && Math.abs(layout.rotation) > 0.001) {
    p.transform = `rotate(${Math.round(layout.rotation * 1000) / 1000}deg)`;
  }

  if (layout.layoutGrow && layout.layoutGrow > 0) {
    p.flexGrow = String(layout.layoutGrow);
  }

  if (layout.layoutSizingHorizontal === 'FILL' || layout.layoutSizingVertical === 'FILL') {
    p.alignSelf = 'stretch';
  }

  return p;
}

function resolvePositioningMode(layout, parentLayout) {
  if (layout.gridRowCount || layout.gridColumnCount) return 'grid';
  if (layout.layoutMode === 'VERTICAL') return 'flex-column';
  if (layout.layoutMode === 'HORIZONTAL') return 'flex-row';
  // Child of a parent whose layoutMode is NONE → absolute-positioned relative to parent.
  if (parentLayout && parentLayout.layoutMode === 'NONE') return 'absolute-child';
  // Root or unknown parent: treat as block flow.
  return 'block';
}

// ===== Appearance =====

export function buildNodeAppearance(node, precomputedGradient) {
  if (!node) return null;
  const style = node.style || {};
  const a = {};

  // Background: first priority precomputed gradient; then first visible solid / image fill.
  if (precomputedGradient) {
    a.background = precomputedGradient;
  } else if (Array.isArray(style.fills)) {
    const bg = firstFillToBackground(style.fills);
    if (bg) Object.assign(a, bg);
  }

  // Opacity (node-level; fill-layer opacity is folded into the color/gradient)
  if (typeof style.opacity === 'number' && style.opacity < 1) {
    a.opacity = String(Math.round(style.opacity * 1000) / 1000);
  }

  // Border-radius (per corner, collapse when all equal)
  const radii = [style.topLeftRadius, style.topRightRadius, style.bottomRightRadius, style.bottomLeftRadius];
  if (radii.every((r) => typeof r === 'number')) {
    const allEqual = radii.every((r) => Math.abs(r - radii[0]) < 0.01);
    if (allEqual) {
      if (radii[0] > 0) a.borderRadius = px(radii[0]);
    } else {
      a.borderTopLeftRadius = px(radii[0]);
      a.borderTopRightRadius = px(radii[1]);
      a.borderBottomRightRadius = px(radii[2]);
      a.borderBottomLeftRadius = px(radii[3]);
    }
  }

  // Strokes — solid only; gradient stroke left to route escalation (SVG).
  if (Array.isArray(style.strokes) && style.strokes.length > 0) {
    const solid = style.strokes.find((s) => s && s.visible !== false && s.type === 'SOLID');
    if (solid) {
      const weight = style.strokeWeight ?? 1;
      const color = hexToRgba(solid.color, solid.opacity ?? 1);
      a.border = `${px(weight)} solid ${color}`;
    }
  }

  // Effects — filter / backdrop-filter / box-shadow
  if (Array.isArray(style.effects) && style.effects.length > 0) {
    const shadows = [];
    for (const eff of style.effects) {
      if (!eff || eff.visible === false) continue;
      if (eff.type === 'LAYER_BLUR') {
        a.filter = [a.filter, `blur(${px(eff.radius)})`].filter(Boolean).join(' ');
      } else if (eff.type === 'BACKGROUND_BLUR') {
        const val = `blur(${px(eff.radius)})`;
        a.backdropFilter = val;
        a.webkitBackdropFilter = val;
      } else if (eff.type === 'DROP_SHADOW' || eff.type === 'INNER_SHADOW') {
        const ox = px(eff.offset?.x || 0);
        const oy = px(eff.offset?.y || 0);
        const blur = px(eff.radius || 0);
        const spread = px(eff.spread || 0);
        const col = hexToRgba(eff.color, 1);
        const prefix = eff.type === 'INNER_SHADOW' ? 'inset ' : '';
        shadows.push(`${prefix}${ox} ${oy} ${blur} ${spread} ${col}`);
      }
    }
    if (shadows.length > 0) a.boxShadow = shadows.join(', ');
  }

  return Object.keys(a).length > 0 ? a : null;
}

function firstFillToBackground(fills) {
  for (const fill of fills) {
    if (!fill || fill.visible === false) continue;
    if (fill.type === 'SOLID') {
      return { backgroundColor: hexToRgba(fill.color, fill.opacity ?? 1) };
    }
    if (fill.type === 'IMAGE' && fill.imageHash) {
      const ext = fill.format || 'png';
      const scaleMode = fill.scaleMode || 'FILL';
      const sizeMap = { FILL: 'cover', FIT: 'contain', CROP: '100% 100%', TILE: 'auto' };
      return {
        backgroundImage: `url('./assets/${fill.imageHash}.${ext}')`,
        backgroundSize: sizeMap[scaleMode] || 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: scaleMode === 'TILE' ? 'repeat' : 'no-repeat',
      };
    }
    // Gradient / video / pattern: skip here — caller passes precomputedGradient for gradients.
  }
  return null;
}

// ===== Text (node.computedHtml) =====

export function buildTextHtml(node) {
  if (!node || node.type !== 'TEXT') return null;
  const text = node.text;
  if (!text) return null;
  const segments = Array.isArray(text.segments) ? text.segments : [];
  if (segments.length === 0) return escapeHtml(text.characters || '');

  // Reduce: compute node-level "default" style (from the first segment) then
  // emit per-segment spans that only override the delta.
  const base = segments[0];
  const parts = [];
  for (const seg of segments) {
    const overrides = segmentOverrides(seg, base);
    const content = escapeHtml(seg.characters || '');
    const styleAttr = overrides
      ? ` style="${Object.entries(overrides).map(([k, v]) => `${kebab(k)}: ${v}`).join('; ')}"`
      : '';
    if (seg.hyperlink && seg.hyperlink.url) {
      parts.push(`<a href="${escapeAttr(seg.hyperlink.url)}"${styleAttr}>${content}</a>`);
    } else {
      parts.push(`<span${styleAttr}>${content}</span>`);
    }
  }
  return parts.join('');
}

function segmentOverrides(seg, base) {
  const o = {};
  const segColor = seg.fills?.[0]?.color;
  const baseColor = base.fills?.[0]?.color;
  if (segColor && (!baseColor || segColor.hex !== baseColor.hex)) o.color = hexToRgba(segColor, seg.fills?.[0]?.opacity ?? 1);
  if (seg.fontName?.family && seg.fontName.family !== base.fontName?.family) o.fontFamily = `'${seg.fontName.family}'`;
  const segWeight = seg.fontWeight ?? FONT_STYLE_TO_WEIGHT[seg.fontName?.style];
  const baseWeight = base.fontWeight ?? FONT_STYLE_TO_WEIGHT[base.fontName?.style];
  if (segWeight && segWeight !== baseWeight) o.fontWeight = String(segWeight);
  if (seg.fontSize && seg.fontSize !== base.fontSize) o.fontSize = px(seg.fontSize);
  if (seg.textDecoration && seg.textDecoration !== base.textDecoration && seg.textDecoration !== 'NONE') {
    o.textDecoration = seg.textDecoration === 'UNDERLINE' ? 'underline' : seg.textDecoration === 'STRIKETHROUGH' ? 'line-through' : null;
  }
  return Object.keys(o).filter((k) => o[k] != null).reduce((acc, k) => ({ ...acc, [k]: o[k] }), null);
}

function kebab(s) {
  return s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function escapeAttr(s) {
  return escapeHtml(s);
}

// ===== Text default CSS (for TEXT node container) =====

export function buildTextDefaults(node) {
  if (!node || node.type !== 'TEXT') return null;
  const t = node.text;
  if (!t) return null;
  const d = {};
  if (t.fontName?.family) d.fontFamily = `'${t.fontName.family}'`;
  const weight = t.segments?.[0]?.fontWeight ?? FONT_STYLE_TO_WEIGHT[t.fontName?.style];
  if (weight) d.fontWeight = String(weight);
  if (t.fontSize) d.fontSize = px(t.fontSize);
  if (t.lineHeight) {
    const lh = pctOrPx(t.lineHeight.unit, t.lineHeight.value);
    if (lh) d.lineHeight = lh;
  }
  if (t.letterSpacing) {
    if (t.letterSpacing.unit === 'PERCENT') d.letterSpacing = `${Math.round(t.letterSpacing.value) / 100}em`;
    else if (t.letterSpacing.unit === 'PIXELS') d.letterSpacing = px(t.letterSpacing.value);
  }
  if (t.textAlignHorizontal && TEXT_ALIGN_H[t.textAlignHorizontal]) d.textAlign = TEXT_ALIGN_H[t.textAlignHorizontal];
  if (t.textCase && TEXT_CASE[t.textCase]) d.textTransform = TEXT_CASE[t.textCase];
  if (t.textDecoration && t.textDecoration !== 'NONE') {
    d.textDecoration = t.textDecoration === 'UNDERLINE' ? 'underline' : t.textDecoration === 'STRIKETHROUGH' ? 'line-through' : null;
  }
  // Segment-0 color becomes the node-level default so per-segment overrides can skip it.
  const c = t.segments?.[0]?.fills?.[0]?.color;
  if (c) d.color = hexToRgba(c, t.segments?.[0]?.fills?.[0]?.opacity ?? 1);
  return d;
}

// ===== Full CSS (aggregated inline style string) =====

export function buildFullCss(node, parentLayout, precomputedGradient) {
  const parts = {};
  const box = buildNodeBox(node.layout);
  const pos = buildNodePositioning(node.layout, parentLayout);
  const app = buildNodeAppearance(node, precomputedGradient);
  const textDef = buildTextDefaults(node);

  if (pos) {
    if (pos.display) parts.display = pos.display;
    if (pos.flexDirection) parts.flexDirection = pos.flexDirection;
    if (pos.justifyContent) parts.justifyContent = pos.justifyContent;
    if (pos.alignItems) parts.alignItems = pos.alignItems;
    if (pos.flexWrap) parts.flexWrap = pos.flexWrap;
    if (pos.alignSelf) parts.alignSelf = pos.alignSelf;
    if (pos.flexGrow) parts.flexGrow = pos.flexGrow;
    if (pos.position) parts.position = pos.position;
    if (pos.left) parts.left = pos.left;
    if (pos.top) parts.top = pos.top;
    if (pos.transform) parts.transform = pos.transform;
  }
  // Parent must be position:relative when it has absolute children — consumer handles.
  if (node.layout?.layoutMode === 'NONE' && Array.isArray(node.children) && node.children.length > 0) {
    parts.position = parts.position || 'relative';
  }
  if (box) {
    for (const k of ['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'padding', 'gap', 'rowGap', 'overflow']) {
      if (box[k]) parts[k] = box[k];
    }
  }
  if (app) {
    for (const k of Object.keys(app)) parts[k] = app[k];
  }
  if (textDef) {
    for (const k of Object.keys(textDef)) parts[k] = textDef[k];
  }
  if (Object.keys(parts).length === 0) return null;
  return Object.entries(parts).map(([k, v]) => `${kebab(k)}: ${v}`).join('; ');
}

// ===== Tree walker =====

export function enrichComputedCss(root) {
  if (!root) return 0;
  let count = 0;
  function walk(node, parentLayout) {
    node.computedCss = node.computedCss || {};
    const preGradient = node.computedCss.background || null;

    const box = buildNodeBox(node.layout);
    if (box) node.computedCss.box = box;
    const pos = buildNodePositioning(node.layout, parentLayout);
    if (pos) node.computedCss.positioning = pos;
    const app = buildNodeAppearance(node, preGradient);
    if (app) node.computedCss.appearance = app;
    const full = buildFullCss(node, parentLayout, preGradient);
    if (full) {
      node.computedCss.full = full;
      count += 1;
    }

    if (node.type === 'TEXT') {
      const html = buildTextHtml(node);
      if (html) node.computedHtml = html;
    }

    if (Object.keys(node.computedCss).length === 0) delete node.computedCss;

    for (const child of node.children || []) walk(child, node.layout);
  }
  walk(root, null);
  return count;
}
