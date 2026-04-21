# 08 — Route Escalation: DOM -> SVG -> Canvas -> Raster

Not every node should be reproduced as plain DOM/CSS. This file defines the route ladder, escalation triggers, implementation rules, and self-checks for hard nodes.

## Route Ladder

```text
DOM_NATIVE -> DOM_INFERRED -> DOM_GRID -> SVG_ISLAND -> CANVAS_ISLAND -> RASTER_LOCK
```

## Route Types

| Route | Best for |
|---|---|
| `DOM_NATIVE` | ordinary frames, groups, text, images, and stable design-system components |
| `DOM_INFERRED` | `layoutMode: NONE` nodes whose `inferredAutoLayout` has been visually validated |
| `DOM_GRID` | explicit grid metadata with trustworthy tracks/spans |
| `SVG_ISLAND` | masks, boolean ops, complex vectors, text paths, patterns, complex gradients, variable-width strokes |
| `CANVAS_ISLAND` | blur/glass/noise/texture cases where SVG compositing is still insufficient |
| `RASTER_LOCK` | last-resort visual lock with an explicit recorded reason |

## Escalation Granularity

Escalation may happen at:

| Level | Meaning |
|---|---|
| node-level | a single hard node |
| subtree-level | a visual unit such as a hero, pricing block, or decorative group |
| page-level | the root or a page-wide decorative layer |

Priority:

1. node-level first
2. subtree-level when neighboring nodes share the same drift category
3. page-level only when interaction is weak and the page-wide decorative layer dominates the remaining error

## Trigger Conditions for Each Arrow

### `DOM_NATIVE -> DOM_INFERRED`

Allow this only when:

- `layout.layoutMode === 'NONE'`
- `layout.inferredAutoLayout` exists
- visual verification confirms the inferred interpretation is trustworthy

### `DOM_INFERRED -> DOM_GRID`

If `gridRowCount` or `gridColumnCount` exists, switch to grid.

### `DOM_GRID -> SVG_ISLAND`

Escalate when any hard signal is present:

| Hard signal | Field / condition |
|---|---|
| mask usage | `node.isMask === true` |
| boolean operation | `node.type === 'BOOLEAN_OPERATION'` |
| pattern fill | `fills[].type === 'PATTERN'` |
| video paint with filters | `fills[].type === 'VIDEO'` plus filters |
| complex stroke | `complexStrokeProperties.type !== 'BASIC'` |
| variable-width stroke | `variableWidthStrokeProperties.variableWidthPoints.length > 0` |
| text path | `node.textPathStartData` |
| many vector paths | `vectorPaths.length > 1` |
| noise / texture / glass-like material | filter-rich fills |
| progressive blur | `effects[].blurType === 'PROGRESSIVE'` |

If any of these are present, plain DOM is no longer the safe default.

### Page-Level `SVG_ISLAND`

Page-level `SVG_ISLAND` is allowed only when:

- the page is primarily decorative / marketing-driven
- scorecard drift covers large decorative regions
- the root or a major visual unit already has `svgRef` or `svgString`
- the report explicitly declares a delivery mode like `Hybrid-SVG` or `Visual-lock`

Interactive controls must be lifted above the overlay or excluded from the locked region.

### `SVG_ISLAND -> CANVAS_ISLAND`

Use this when:

- SVG filter chains cannot represent the compositing order faithfully
- blur or effect behavior requires pixel-level control
- the SVG path payload becomes too heavy for the target experience

### `CANVAS_ISLAND -> RASTER_LOCK`

This is the final fallback. Record the reason explicitly, for example:

```json
{
  "nodeId": "20:532:insert-x",
  "route": "RASTER_LOCK",
  "reason": "Canvas still could not satisfy the hard-node threshold",
  "baselineSrc": "plugin-exportAsync-2x"
}
```

## `SVG_ISLAND` Implementation Rules

### Prefer Bridge Paths

- VECTOR / BOOLEAN_OPERATION nodes should read path data from bridge geometry
- do not invent placeholder paths
- do not simplify geometry by guesswork
- fill colors should come from bridge style data

### Prefer Full `svgRef` / `svgString`

If a full SVG blob exists, use it directly instead of reconstructing piecewise geometry.

### Preserve `viewBox`

Keep the original `viewBox`. Let the wrapper control final display size through CSS.

### Overlay Rules

When a locked island is implemented as an overlay:

- mark the overlay `aria-hidden="true"`
- keep wrapper `id` / `className` when useful for audits and future refactors
- avoid introducing new geometry changes in the overlay container
- keep true interactive elements above the overlay

## `CANVAS_ISLAND`

Typical implementation guidance:

- use `useEffect + useRef` in React
- use `OffscreenCanvas` when helpful
- throttle expensive animation work
- always keep a fallback path

## `RASTER_LOCK`

Typical implementation guidance:

- source image from plugin `exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } })`
- record the reason for locking
- scale it back to the intended display size in CSS
- add `alt` / `aria-label` when the image carries meaningful user-facing content

## DOM Traps That Should Escalate

Even if a node looks like `DOM_NATIVE`, escalate when:

- `filter: blur()` and `mix-blend-mode` share the same element
- the stroke is gradient-based
- a rotated radial gradient depends on an unrotated coordinate space

## Component Awareness

Read component contract fields before flattening instance structure:

- `componentPropertyDefinitions`
- `componentPropertyReferences`
- `variantProperties`
- `resolvedVariableModes`

If the component contract is unclear, do not overfit a local adapter too early. In some cases the correct answer is route escalation or a more careful `DOM_INFERRED` interpretation, not naïve instance expansion.

## Acceptance and Rerender Loop

After each scorecard pass, escalate along the route ladder when a node still fails its threshold. The rerender loop should converge monotonically or stop and surface the problem.

## Self-Check

- [ ] every hard-signal node uses SVG / Canvas / Raster as required
- [ ] SVG path data comes from bridge output, not guesswork
- [ ] filter + blend conflicts were split or escalated
- [ ] gradient strokes were not reduced to plain `border`
- [ ] `RASTER_LOCK` reasons are explicitly recorded
