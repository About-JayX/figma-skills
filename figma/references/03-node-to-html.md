# 03 — Deterministic Node-to-HTML/CSS Algorithm

This is the core consumption algorithm for turning a bridge node into HTML/CSS (or equivalent JSX / Vue / DOM output). Any model, including a weak model, should be able to follow this step-by-step without relying on guesswork.

## Inputs and Outputs

- **Input**: a subtree rooted at `designSnapshot.root` inside `bridge-agent-payload.json`
- **Output**: HTML / JSX / equivalent DOM structure plus a stylesheet
- **Precondition**: the reset from `02-css-reset.md` is already at the top of the stylesheet
- **Precondition**: the required Google Font or local font is already loaded

## Node Processing Flow

For each node `N`, run Steps 1–7 in order. Do not skip or reorder steps.

### Step 1 — Visibility Gate

```text
if N.visible === false -> return nothing
if N.style.opacity === 0 -> return nothing
for each fill in N.style.fills:
  if fill.visible === false -> skip only that fill layer
for each stroke in N.style.strokes:
  if stroke.visible === false -> skip only that stroke layer
```

### Step 2 — Choose the Element Tag

| Node | Tag |
|---|---|
| TEXT (single run) | `<p>` or `<span>` |
| TEXT with hyperlink | `<a>` |
| Title-like TEXT | semantic heading (`<h1>`…`<h3>`) when the page structure justifies it |
| FRAME / SECTION / GROUP / COMPONENT / INSTANCE | `<div>` or semantic container (`header`, `nav`, `main`, `section`, `footer`) |
| VECTOR / BOOLEAN_OPERATION / STAR / POLYGON / LINE | inline SVG or route escalation |
| RECTANGLE / ELLIPSE without text | `<div>` + background or inline SVG |

Semantic tag hints are encouraged, not mandatory, during manual refinement:

- if `node.name` contains `Nav`, `Header`, or `Footer`, prefer the matching semantic tag
- the largest title-like TEXT on the page may justify `<h1>`

### Step 3 — If `computedCss.full` Exists, Use It and Jump to Step 7

```html
<div style="<node.computedCss.full>">
  <!-- if TEXT: inject node.computedHtml directly -->
  <!-- otherwise recurse into children -->
</div>
```

This is the pipeline’s final-state output. If it exists, use it directly instead of rebuilding layout and appearance.

### Step 4 — Build Box + Positioning (Fallback Path)

When `computedCss.full` is absent:

1. Prefer `layout.absoluteBoundingBox.width/height` over `layout.width/height`
2. Map padding from the four padding fields
3. Map `itemSpacing` to `gap`
4. Map `clipsContent` to `overflow`
5. Resolve the layout route using `05-layout-modes.md`

### Step 5 — Build Appearance (Fallback Path)

When `computedCss.full` is absent:

1. SOLID fill -> `background-color`
2. GRADIENT fill -> use `node.computedCss.background`; do not hand-build
3. IMAGE fill -> `background-image: url(./assets/<imageHash>.<format>)`
4. strokes -> border / outline / SVG path strategy depending on the case
5. effects -> map `style.effects[]`, always using the raw bridge radius
6. radius -> emit uniform or per-corner radius values

### Step 6 — TEXT Content

If `node.text.segments.length >= 2`, split the output into spans. Do not flatten it into one plain string.

Pseudo-process:

```text
html = ''
for each segment in node.text.segments:
  style = {
    color,
    fontWeight,
    fontSize,
    textDecoration,
    fontStyle,
    letterSpacing,
    lineHeight
  }
  if segment.hyperlink exists:
    emit <a href="...">...</a>
  else:
    emit <span>...</span>
```

If `node.computedHtml` exists, inject it directly instead of reconstructing spans manually.

`text.textCase: UPPER` should normally be reproduced with CSS `text-transform`, not by mutating the source string.

### Step 7 — Recurse Into Children

For each child:

1. If the parent uses `layoutMode: NONE`, sort children by `absoluteBoundingBox.x/y` before recursion
2. Re-run Steps 1–7 on the child

This matters because `children[]` order is layer order, not always visual reading order.

## Common Trap List

| Trap | Correct handling |
|---|---|
| Rendering `text.characters` and ignoring segments | split spans when segments exist |
| Letting flex auto-size without explicit fixed dimensions | emit explicit width/height for FIXED sizing |
| Treating `layoutMode: NONE` as ordinary flow | use absolute positioning |
| Using raw `children[]` order for visual groups | sort by visual `x/y` when needed |
| Forgetting reset margins on headings/paragraphs | apply `02-css-reset.md` first |
| Forgetting `text-decoration: none` on links | the reset should already cover it |
| Using `node.css.filter` radius values | use `style.effects[].radius` |
| Hand-building gradients | use `computedCss.background` |
| Hard-coding token-bound values | emit `var(--...)` when token bindings exist |
| Dropping intermediate wrapper FRAMEs | preserve wrappers when they affect layout, clipping, or spacing |

## Pre-Render Checklist

- [ ] Reset is at the top of the stylesheet
- [ ] All multi-run TEXT nodes are split into spans or links
- [ ] All `layoutMode: NONE` FRAMEs use absolute positioning with a positioned parent
- [ ] All gradient fills use `computedCss.background`
- [ ] Token-bound properties emit `var(--...)`
- [ ] Intermediate FRAME wrappers are preserved when they affect fidelity
- [ ] Every vector-heavy node uses inline SVG or route escalation
- [ ] Required fonts are loaded
- [ ] Asset paths `./assets/<hash>.<format>` actually exist

If this checklist passes, render once and then run the scorecard workflow from `09-verification.md`. A first-pass scorecard below the expected waterline usually means one or more steps above were skipped or weakened.
