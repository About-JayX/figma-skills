# 06 — Paint, Stroke, Mask, and Effects Mapping

This file maps fill, stroke, gradient, image, mask, shadow, and blur fields into reproducible web output. If `computedCss.background` or `computedCss.appearance` exists, those pipeline-produced values win.

## Fill Layers (`style.fills[]`)

Fills are ordered arrays. Multiple fill layers stack from top to bottom, with index `0` visually on top. In the browser, reproduce this either as layered backgrounds or as stacked positioned elements.

### SOLID

```css
background-color: <color.hex>;
```

When alpha is present:

```css
rgba(<r>, <g>, <b>, <color.a * fill.opacity>)
```

### `GRADIENT_LINEAR` / `GRADIENT_RADIAL` / `GRADIENT_ANGULAR` / `GRADIENT_DIAMOND`

Do **not** hand-compute these. Use `node.computedCss.background`.

```html
<div style="background: <computedCss.background>"></div>
```

If the pipeline did not emit `computedCss.background` (rare failure path), then and only then fall back to:

- `style.fills[].gradientStops[]`
- `style.fills[].gradientTransform`
- `layout.absoluteBoundingBox`

and route the calculation through `scripts/lib/gradient_to_css.mjs`.

### IMAGE

```css
background-image: url('./assets/<imageHash>.<format>');
background-size: <mapped scaleMode>;
background-position: <mapped imageTransform>;
background-repeat: no-repeat;
```

| `scaleMode` | CSS `background-size` |
|---|---|
| `FILL` | `cover` |
| `FIT` | `contain` |
| `CROP` | `100% 100%` |
| `TILE` | repeat plus explicit size derived from tiling metadata |

### VIDEO / PATTERN

- VIDEO -> `<video autoplay muted loop>` or a pipeline-provided placeholder
- PATTERN -> usually better handled through `SVG_ISLAND`

## Stroke Layers (`style.strokes[]`)

The structure mirrors fills, but the output targets borders or SVG strokes.

### SOLID stroke

```css
border-width: <strokeWeight>px;
border-style: solid;
border-color: <color.hex>;
```

Use per-side widths when the bridge exposes them.

### GRADIENT stroke

`node.css.border` often degrades gradient strokes to solid borders. That is not acceptable for fidelity.

#### Option A — `mask-composite`

```css
.box {
  position: relative;
}

.box::before {
  content: '';
  position: absolute;
  inset: 0;
  padding: <strokeWeight>px;
  background: <computedCss.background>;
  -webkit-mask: linear-gradient(#000 0 0) content-box,
                linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
}
```

#### Option B — Gradient background + padding + inner layer

```css
.box {
  background: <gradient>;
  padding: <strokeWeight>px;
  border-radius: <radius>;
}

.box > .inner {
  background: <inner-bg>;
  border-radius: <radius - strokeWeight>;
}
```

If these are not stable enough, escalate the route to SVG.

### `strokeAlign`

See `05-layout-modes.md` for the box-model implications of:

- `INSIDE`
- `CENTER`
- `OUTSIDE`

## Effects (`style.effects[]`)

Map effects in order. If the same element has both `filter` and `mix-blend-mode`, split it into parent/child layers because CSS creates an isolated compositing context.

### `LAYER_BLUR`

```css
filter: blur(<radius>px);
```

Always use the original bridge radius value, not a lossy CSS export hint.

### `BACKGROUND_BLUR`

```css
backdrop-filter: blur(<radius>px);
-webkit-backdrop-filter: blur(<radius>px);
```

If `blurType: PROGRESSIVE` appears, plain CSS is not a true match; use masking approximations or escalate.

### `DROP_SHADOW`

```css
box-shadow: <offset.x>px <offset.y>px <radius>px <spread>px <color>;
```

### `INNER_SHADOW`

```css
box-shadow: inset <offset.x>px <offset.y>px <radius>px <spread>px <color>;
```

## Mask (`node.isMask`)

| `maskType` | Suggested web mapping |
|---|---|
| `ALPHA` | `mask-image` / `-webkit-mask-image` |
| `VECTOR` | `clip-path: path(...)` or SVG `<clipPath>` |
| `LUMINANCE` | `mask-mode: luminance` or SVG filter fallback |

Mask-heavy cases are usually better routed to `SVG_ISLAND`.

## Blend Modes

| Figma mode | CSS |
|---|---|
| `PASS_THROUGH` | omit |
| `NORMAL` | `mix-blend-mode: normal` |
| `MULTIPLY` | `mix-blend-mode: multiply` |
| `SCREEN` | `mix-blend-mode: screen` |
| `OVERLAY` | `mix-blend-mode: overlay` |
| `DARKEN`, `LIGHTEN`, `COLOR_DODGE`, `COLOR_BURN`, `HARD_LIGHT`, `SOFT_LIGHT`, `DIFFERENCE`, `EXCLUSION`, `HUE`, `SATURATION`, `COLOR`, `LUMINOSITY` | same-name `mix-blend-mode` |

## Corner Radius

The bridge may serialize either:

- `style.cornerRadius` — uniform radius
- `style.cornerRadii.{topLeft, topRight, bottomRight, bottomLeft}` — per-corner values

```css
border-radius: <cornerRadius>px;
```

or:

```css
border-top-left-radius: <topLeft>px;
border-top-right-radius: <topRight>px;
border-bottom-right-radius: <bottomRight>px;
border-bottom-left-radius: <bottomLeft>px;
```

Do not rely on flattened pseudo-fields such as `style.topLeftRadius`; they are not authoritative.

## Opacity

| Source | CSS use |
|---|---|
| `style.opacity` | node-level `opacity` |
| `style.fills[].opacity` | multiply into the fill color alpha |
| `style.effects[].color.a` | shadow alpha |

## z-order and Stroke-over-Fill

Figma renders stroke above fill by default. CSS borders naturally render above background. If you simulate a stroke with extra DOM layers, preserve that ordering explicitly through DOM order or `z-index`.

## Self-Check

- [ ] Gradient fills use `computedCss.background`
- [ ] Gradient strokes were not degraded to solid borders
- [ ] Blur uses the bridge radius value
- [ ] Filter and blend are not incorrectly combined on the same element
- [ ] Multi-fill / multi-effect ordering matches Figma
- [ ] Image fill `scaleMode` is mapped correctly
- [ ] z-order preserves stroke above fill
