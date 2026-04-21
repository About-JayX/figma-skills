# 05 — Layout Modes: Deterministic Decision Tree

Figma nodes expose four layout modes that map to different CSS implementations. You must not guess “row vs column” by eye. Always read `layout.layoutMode` and grid fields first, then follow the decision tree.

## Decision Tree

```text
if layout.gridRowCount OR layout.gridColumnCount:
  -> GRID route
elif layout.layoutMode === 'VERTICAL':
  -> FLEX_COLUMN route
elif layout.layoutMode === 'HORIZONTAL':
  -> FLEX_ROW route
elif layout.layoutMode === 'NONE':
  if layout.inferredAutoLayout exists AND route escalation allows it:
    -> FLEX_INFERRED route
  else:
    -> ABSOLUTE route
else:
  -> the node does not participate in layout (for example TEXT or VECTOR leaves)
```

## FLEX_ROW / FLEX_COLUMN

```css
.node {
  display: flex;
  flex-direction: row | column;            /* from layoutMode */
  gap: <itemSpacing>px;                    /* primary-axis gap */
  row-gap: <counterAxisSpacing>px;         /* optional wrapped secondary-axis gap */
  padding: <top>px <right>px <bottom>px <left>px;
  justify-content: <mapped primaryAxisAlignItems>;
  align-items: <mapped counterAxisAlignItems>;
  flex-wrap: <mapped layoutWrap>;
}
```

### Axis Alignment Mapping

| Figma `primaryAxisAlignItems` | CSS `justify-content` |
|---|---|
| `MIN` | `flex-start` |
| `CENTER` | `center` |
| `MAX` | `flex-end` |
| `SPACE_BETWEEN` | `space-between` |

| Figma `counterAxisAlignItems` | CSS `align-items` |
|---|---|
| `MIN` | `flex-start` |
| `CENTER` | `center` |
| `MAX` | `flex-end` |
| `BASELINE` | `baseline` |

| Figma `layoutWrap` | CSS `flex-wrap` |
|---|---|
| `NO_WRAP` | `nowrap` (default) |
| `WRAP` | `wrap` |

### Child Sizing Strategy

For each child:

| Figma `layoutSizingHorizontal / Vertical` | CSS |
|---|---|
| `FIXED` | explicit `width` / `height` using `absoluteBoundingBox.width/height` |
| `FILL` | on the primary axis: `flex: 1 0 0`; on the cross axis: `align-self: stretch` |
| `HUG` | omit width/height and let content size the node |

Legacy / related fields:

- `layoutAlign: STRETCH` -> cross-axis `align-self: stretch`
- `layoutGrow > 0` -> `flex-grow: <value>`

## ABSOLUTE Route (`layoutMode: NONE`)

The parent has no auto-layout. Children must be positioned using their absolute bounds.

```css
.parent {
  position: relative;
  width: <parent.width>px;
  height: <parent.height>px;
  overflow: <clipsContent ? 'hidden' : 'visible'>;
}

.child {
  position: absolute;
  left: <child.absX - parent.absX>px;
  top: <child.absY - parent.absY>px;
  width: <child.width>px;
  height: <child.height>px;
  transform: rotate(<child.rotation>deg); /* when relativeTransform is non-identity */
}
```

### Constraint Mapping (Only Relevant Under ABSOLUTE)

Child `layout.constraints` determines how it follows a resizing parent:

| `constraints.horizontal` | CSS equivalent |
|---|---|
| `MIN` | only `left` |
| `MAX` | only `right` |
| `CENTER` | `left: 50%` + `transform: translateX(-50%)` |
| `STRETCH` | bind both `left` and `right` |
| `SCALE` | express `left` and `width` proportionally |

### Visual Order Trap

`node.children[]` follows layer z-order, not visual reading order. When visual order matters:

```js
const visualChildren = [...children].sort((a, b) => {
  const dy = a.absoluteBoundingBox.y - b.absoluteBoundingBox.y;
  if (Math.abs(dy) > 1) return dy;
  return a.absoluteBoundingBox.x - b.absoluteBoundingBox.x;
});
```

This is especially important for headers, nav items, and left-to-right visual groups.

## FLEX_INFERRED

Some `layoutMode: NONE` nodes also carry `layout.inferredAutoLayout`. Use it only when route escalation explicitly allows the upgrade:

```text
if layout.inferredAutoLayout exists AND replay.routeHint === 'DOM_INFERRED':
  consume inferred direction/spacing/padding as flex
else:
  keep the ABSOLUTE route
```

## GRID Route

When `gridRowCount` / `gridColumnCount` exist:

```css
.grid {
  display: grid;
  grid-template-columns: <mapped gridColumnSizes>;
  grid-template-rows: <mapped gridRowSizes>;
  column-gap: <gridColumnGap>px;
  row-gap: <gridRowGap>px;
}

.grid-child {
  grid-column: <gridColumnAnchorIndex + 1> / span <gridColumnSpan>;
  grid-row:    <gridRowAnchorIndex + 1>    / span <gridRowSpan>;
  justify-self: <mapped gridChildHorizontalAlign>;
  align-self:   <mapped gridChildVerticalAlign>;
}
```

### `gridRowSizes` / `gridColumnSizes` Mapping

Each track definition maps as follows:

| Figma track type | CSS |
|---|---|
| `FIXED` (`value = N`) | `Npx` |
| `FIT` | `fit-content(...)` |
| `FILL` (`value = N`) | `Nfr` |

## Box Model and Stroke Alignment

| Figma `strokeAlign` | Recommended CSS |
|---|---|
| `INSIDE` | `box-sizing: border-box` + `border-*` |
| `CENTER` | similar visual approximation to `INSIDE`, but SVG is safer for pixel precision |
| `OUTSIDE` | `outline` or a wrapper-based construction |

When per-side stroke widths exist, emit `border-top-width`, `border-right-width`, etc.

## `clipsContent`

| `layout.clipsContent` | CSS |
|---|---|
| `true` | `overflow: hidden` |
| `false` | `overflow: visible` |
| missing | default by container type, usually `visible` |

## Self-Check

- [ ] `layout.layoutMode` drove the decision tree
- [ ] `layoutMode: NONE` parents use `position: relative` and children use `position: absolute`
- [ ] ABSOLUTE children derive `left/top` from `absoluteBoundingBox`
- [ ] Visual-order-sensitive groups are sorted before recursion
- [ ] `FIXED` emits explicit width/height; `FILL` uses flex-grow/stretch; `HUG` does not force fixed dimensions
- [ ] `clipsContent` is mapped correctly
