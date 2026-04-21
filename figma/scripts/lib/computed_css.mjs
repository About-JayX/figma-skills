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
//   buildNodeAppearance(node, precomputedGradient, ctx)
//                                → { background?, borderRadius?, opacity?,
//                                    filter?, backdropFilter?, boxShadow?, ... }
//   buildFullCss(node, ...)      → one inline CSS string
//   buildTextHtml(node)          → '<span>...</span><span style="color:#...">...' or null
//   maybeInlineSvgRef(node, ctx) → reads small svgRef blob from disk and
//                                  attaches to node.computedHtml; large
//                                  blobs left as svgRef for downstream
//   enrichComputedCss(root, ctx) → walks tree, mutates nodes with computedCss / computedHtml

import fs from 'fs';

// L1.2: blobs below this size go inline as computedHtml so the agent never
// needs a separate file read. Above this, svgRef is preserved and consumers
// reference via <img> / <object> / fetch. 4KB chosen as the elbow on
// distribution measured on real designs (small icons cluster well below 4KB,
// rasterized vectors live well above).
const SVG_INLINE_MAX_BYTES = 4 * 1024;

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
  // Figma's per-child opt-out of auto-layout: child becomes absolute
  // regardless of parent's layoutMode (think of an overlay nav inside a
  // VERTICAL flex). This MUST be checked before flex-row/column dispatch
  // because the layoutMode field on the node itself is for ITS children,
  // not for how IT is positioned in its parent.
  if (layout.layoutPositioning === 'ABSOLUTE') return 'absolute-child';
  if (layout.gridRowCount || layout.gridColumnCount) return 'grid';
  if (layout.layoutMode === 'VERTICAL') return 'flex-column';
  if (layout.layoutMode === 'HORIZONTAL') return 'flex-row';
  // Child of a parent whose layoutMode is NONE → absolute-positioned relative to parent.
  if (parentLayout && parentLayout.layoutMode === 'NONE') return 'absolute-child';
  // Root or unknown parent: treat as block flow.
  return 'block';
}

// ===== Appearance =====

export function buildNodeAppearance(node, precomputedGradient, ctx) {
  if (!node) return null;
  const style = node.style || {};
  const a = {};

  // Background: first priority precomputed gradient; then first visible solid / image fill.
  // Several types are NOT containers — their style.fills means something else:
  //   TEXT      → text color (handled by buildTextDefaults as `color`)
  //   VECTOR/BOOLEAN_OPERATION/STAR/POLYGON/LINE → SVG path fill (already
  //              painted inside the inline <svg>; emitting backgroundColor
  //              on the wrapper would create a redundant colored rect)
  // Skip background emission for these node types.
  const skipFillAsBackground = (
    node.type === 'TEXT' ||
    node.type === 'VECTOR' ||
    node.type === 'BOOLEAN_OPERATION' ||
    node.type === 'STAR' ||
    node.type === 'POLYGON' ||
    node.type === 'LINE'
  );
  if (precomputedGradient) {
    a.background = precomputedGradient;
  } else if (!skipFillAsBackground && Array.isArray(style.fills)) {
    const bg = firstFillToBackground(style.fills, ctx);
    if (bg) Object.assign(a, bg);
  }

  // Opacity (node-level; fill-layer opacity is folded into the color/gradient)
  if (typeof style.opacity === 'number' && style.opacity < 1) {
    a.opacity = String(Math.round(style.opacity * 1000) / 1000);
  }

  // Border-radius — bridge serializes either style.cornerRadius (uniform, scalar)
  // OR style.cornerRadii (per-corner object), never flat style.topLeftRadius.
  if (typeof style.cornerRadius === 'number' && style.cornerRadius > 0) {
    a.borderRadius = px(style.cornerRadius);
  } else if (style.cornerRadii && typeof style.cornerRadii === 'object') {
    const { topLeft = 0, topRight = 0, bottomRight = 0, bottomLeft = 0 } = style.cornerRadii;
    const radii = [topLeft, topRight, bottomRight, bottomLeft];
    const allEqual = radii.every((r) => Math.abs(r - topLeft) < 0.01);
    if (allEqual) {
      if (topLeft > 0) a.borderRadius = px(topLeft);
    } else {
      a.borderTopLeftRadius = px(topLeft);
      a.borderTopRightRadius = px(topRight);
      a.borderBottomRightRadius = px(bottomRight);
      a.borderBottomLeftRadius = px(bottomLeft);
    }
  }

  // Strokes — solid only; gradient stroke left to route escalation (SVG).
  if (Array.isArray(style.strokes) && style.strokes.length > 0) {
    const solid = style.strokes.find((s) => s && s.visible !== false && s.type === 'SOLID');
    if (solid) {
      const color = hexToRgba(solid.color, solid.opacity ?? 1);
      const isDashed = Array.isArray(style.dashPattern) && style.dashPattern.length > 0;
      const styleName = isDashed ? 'dashed' : 'solid';
      // INSIDE/CENTER → border (works with box-sizing: border-box)
      // OUTSIDE → outline (doesn't reduce content area, matches Figma)
      const prop = style.strokeAlign === 'OUTSIDE' ? 'outline' : 'border';
      const w = style.strokeWeights;
      if (w && typeof w === 'object' && [w.top, w.right, w.bottom, w.left].some((v) => typeof v === 'number')) {
        // Per-side weights → border-*-width (outline has no per-side support, fallback to border)
        if (typeof w.top === 'number') a.borderTopWidth = px(w.top);
        if (typeof w.right === 'number') a.borderRightWidth = px(w.right);
        if (typeof w.bottom === 'number') a.borderBottomWidth = px(w.bottom);
        if (typeof w.left === 'number') a.borderLeftWidth = px(w.left);
        a.borderStyle = styleName;
        a.borderColor = color;
      } else {
        const weight = style.strokeWeight ?? 1;
        if (prop === 'outline') {
          a.outline = `${px(weight)} ${styleName} ${color}`;
          a.outlineOffset = '0';
        } else {
          a.border = `${px(weight)} ${styleName} ${color}`;
        }
      }
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

function firstFillToBackground(fills, ctx) {
  for (const fill of fills) {
    if (!fill || fill.visible === false) continue;
    if (fill.type === 'SOLID') {
      return { backgroundColor: hexToRgba(fill.color, fill.opacity ?? 1) };
    }
    if (fill.type === 'IMAGE' && fill.imageHash) {
      // L1.1: prefer the real fileName from cache-manifest (sniffed format),
      // fall back to fill.format / 'png' only if manifest lookup misses.
      const manifestEntry = ctx?.assetFiles?.[fill.imageHash];
      const fileName = manifestEntry?.fileName
        || `${fill.imageHash}.${fill.format || 'png'}`;
      const scaleMode = fill.scaleMode || 'FILL';
      const sizeMap = { FILL: 'cover', FIT: 'contain', CROP: '100% 100%', TILE: 'auto' };
      return {
        backgroundImage: `url('./assets/${fileName}')`,
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

// Internal: build the parts object (camelCase keys → CSS values). The public
// buildFullCss serialises it; buildFullCssWithTokens also serialises it but
// replaces values where a Figma variable binding exists.
function buildFullCssParts(node, parentLayout, precomputedGradient, ctx) {
  const parts = {};
  const box = buildNodeBox(node.layout);
  const pos = buildNodePositioning(node.layout, parentLayout);
  const app = buildNodeAppearance(node, precomputedGradient, ctx);
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
  // Parent must be position:relative when ANY child opts out of auto-layout
  // (layoutPositioning: ABSOLUTE) OR when this node uses NONE layoutMode
  // (so its children are positioned by absoluteBoundingBox deltas).
  const hasAbsoluteChild = Array.isArray(node.children) &&
    node.children.some((c) => c?.layout?.layoutPositioning === 'ABSOLUTE');
  if ((node.layout?.layoutMode === 'NONE' || hasAbsoluteChild) &&
      Array.isArray(node.children) && node.children.length > 0) {
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
  return parts;
}

export function buildFullCss(node, parentLayout, precomputedGradient, ctx) {
  const parts = buildFullCssParts(node, parentLayout, precomputedGradient, ctx);
  if (Object.keys(parts).length === 0) return null;
  return Object.entries(parts).map(([k, v]) => `${kebab(k)}: ${v}`).join('; ');
}

// Emit the same `parts` object but with any property whose token binding is
// present in `tokens` (from variable_substitution.buildNodeTokens) replaced
// with `var(--figma-var-slug)`. Matches MCP's get_code / get_variable_defs
// split: bit-faithful resolved values stay on `full`, theme-ready var()
// references go on `withTokens`.
//
// Returns null when no substitution fires, so callers don't emit a
// redundant duplicate of buildFullCss output.
//
// Two wrinkles the naive "replace by key" approach misses:
//   1. `fills` binding maps (per FIGMA_PROP_TO_CSS) to `color`, but on
//      container nodes the actual CSS property is `background-color`. We
//      accept the `color` token for either.
//   2. `buildFullCss` collapses `padding-top/right/bottom/left` into the
//      `padding` shorthand. If any padding-* binding exists, we split back
//      into the four long-hands so the var() substitution is faithful.
export function buildFullCssWithTokens(node, parentLayout, precomputedGradient, ctx, tokens) {
  if (!tokens || typeof tokens !== 'object' || Object.keys(tokens).length === 0) return null;
  const parts = buildFullCssParts(node, parentLayout, precomputedGradient, ctx);
  if (Object.keys(parts).length === 0) return null;

  // Expand padding shorthand back into long-hand if any padding-* token exists.
  const paddingTokens = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].some((k) => tokens[k]);
  if (paddingTokens && parts.padding) {
    // Padding shorthand format from buildNodeBox: "top right bottom left" (space-separated).
    const p = String(parts.padding).trim().split(/\s+/);
    if (p.length === 4) {
      parts.paddingTop = p[0];
      parts.paddingRight = p[1];
      parts.paddingBottom = p[2];
      parts.paddingLeft = p[3];
      delete parts.padding;
    }
  }

  let hits = 0;
  const serialized = [];
  for (const [k, v] of Object.entries(parts)) {
    const kebabKey = kebab(k);
    // Accept `color` token for a container's `background-color` too — the
    // fills→color mapping in variable_substitution doesn't distinguish
    // TEXT vs container.
    const tok = tokens[kebabKey] || (kebabKey === 'background-color' ? tokens['color'] : null);
    if (tok && tok.cssVar) {
      serialized.push(`${kebabKey}: var(${tok.cssVar})`);
      hits += 1;
    } else {
      serialized.push(`${kebabKey}: ${v}`);
    }
  }
  if (hits === 0) return null;
  return serialized.join('; ');
}

// ===== Tree walker =====

// L1.2: small SVG blobs get pulled into computedHtml so consumers never
// need a separate file read. The svgRef field is removed for inlined blobs.
// Returns true if inlined.
export function maybeInlineSvgRef(node, ctx) {
  const ref = node?.svgRef;
  if (!ref || !ref.localPath) return false;
  const limit = ctx?.svgInlineMaxBytes ?? SVG_INLINE_MAX_BYTES;
  // Trust the metadata's byteLength when present to avoid an extra stat();
  // fall back to fs.statSync only when missing.
  let bytes = typeof ref.byteLength === 'number' ? ref.byteLength : null;
  if (bytes == null) {
    try { bytes = fs.statSync(ref.localPath).size; }
    catch { return false; }
  }
  if (bytes >= limit) return false;
  let svgString;
  try { svgString = fs.readFileSync(ref.localPath, 'utf-8'); }
  catch { return false; }
  if (!svgString || svgString.length === 0) return false;
  node.computedHtml = svgString;
  delete node.svgRef;
  return true;
}

export function enrichComputedCss(root, ctx) {
  if (!root) return 0;
  let count = 0;
  let inlinedSvgs = 0;
  function walk(node, parentLayout) {
    node.computedCss = node.computedCss || {};
    const preGradient = node.computedCss.background || null;

    const box = buildNodeBox(node.layout);
    if (box) node.computedCss.box = box;
    const pos = buildNodePositioning(node.layout, parentLayout);
    if (pos) node.computedCss.positioning = pos;
    const app = buildNodeAppearance(node, preGradient, ctx);
    if (app) node.computedCss.appearance = app;
    const full = buildFullCss(node, parentLayout, preGradient, ctx);
    if (full) {
      node.computedCss.full = full;
      count += 1;
    }
    // MCP-style token preservation: when this node has variable bindings
    // (enriched earlier by variable_substitution.enrichNodeTokens), also
    // emit a parallel `computedCss.withTokens` where bound properties use
    // `var(--token)` instead of the resolved hex/px value. Consumers can
    // pick: `full` for bit-faithful output, `withTokens` for theme-ready CSS.
    const tokens = node.computedCss?.tokens;
    if (full && tokens) {
      const withTokens = buildFullCssWithTokens(node, parentLayout, preGradient, ctx, tokens);
      if (withTokens) node.computedCss.withTokens = withTokens;
    }

    if (node.type === 'TEXT') {
      const html = buildTextHtml(node);
      if (html) node.computedHtml = html;
      // TEXT nodes occasionally carry an svgRef (Figma exports a glyph-outline
      // SVG for some text). Agent should consume segments via computedHtml; the
      // SVG would not be selectable text. Drop the svgRef to remove the
      // redundant signal so consumers don't get confused.
      if (node.svgRef) delete node.svgRef;
    } else if (node.svgRef) {
      // Vector / boolean-op / etc — try inline if small enough.
      if (maybeInlineSvgRef(node, ctx)) inlinedSvgs += 1;
    }

    if (Object.keys(node.computedCss).length === 0) delete node.computedCss;

    for (const child of node.children || []) walk(child, node.layout);
  }
  walk(root, null);
  if (ctx) ctx.inlinedSvgs = inlinedSvgs;
  return count;
}
