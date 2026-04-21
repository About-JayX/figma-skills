# 01 — Data Sources: Authoritative Field Map for the Agent Payload

All fields in this guide come from `bridge-agent-payload.json`, which is the enriched, post-pipeline working payload. Do **not** default to `bridge-response.json` for normal work; it is larger, noisier, and only needed for exceptional drill-down.

Field availability is type-sensitive:

- FRAME-like nodes carry layout and appearance fields
- TEXT nodes add a text layer
- VECTOR-like nodes add geometry/SVG-related fields
- INSTANCE / COMPONENT nodes add component contract fields

## Required Read Order

Consume node data in this order. Do not reorder it.

1. `node.id` / `node.type` / `node.name` / `node.visible` / `node.style.opacity`
2. `node.layout.*`
3. `node.style.*`
4. `node.text.*` (TEXT only)
5. `node.vector.*` (VECTOR / BOOLEAN_OPERATION / STAR / POLYGON / LINE only)
6. `node.component.*` (INSTANCE / COMPONENT only)
7. `node.variables.bound` / `node.computedCss.tokens`
8. `node.computedCss.*`
9. `node.children[]`

If `node.computedCss.*` exists, it is a pipeline-produced final value. Use it directly instead of recomputing it.

## Layout Layer

| Field | Meaning | Typical CSS use | Notes |
|---|---|---|---|
| `layout.absoluteBoundingBox.{x,y,width,height}` | Authoritative absolute box including stroke | size / absolute positioning | More trustworthy than `layout.width/height` in nested FILL cases |
| `layout.absoluteRenderBounds.{x,y,width,height}` | Actual painted bounds including effect overflow | overflow and visual alignment | Use when effects extend outside the layout box |
| `layout.layoutMode` | `VERTICAL`, `HORIZONTAL`, `NONE` | flex / absolute / grid decision | `NONE` means free positioning, not ordinary flow |
| `layout.itemSpacing` | primary-axis spacing | `gap` | |
| `layout.counterAxisSpacing` | wrapped secondary-axis spacing | `row-gap` / `column-gap` | |
| `layout.paddingTop/Right/Bottom/Left` | internal padding | `padding` | |
| `layout.layoutSizingHorizontal/Vertical` | `FIXED`, `FILL`, `HUG` | width / height / stretch / flex | |
| `layout.layoutAlign` / `layoutGrow` | child alignment and growth inside parent | `align-self`, `flex-grow` | |
| `layout.clipsContent` | clipping behavior | `overflow` | |
| `layout.relativeTransform` | 2x3 affine transform in parent space | `transform` / rotation handling | Be careful with rotated gradients |
| `layout.gridRowCount` / `gridColumnCount` / `gridRowSizes` / `gridColumnSizes` / `gridRowGap` / `gridColumnGap` | grid container definition | CSS grid | Presence means the grid route is available |
| `layout.gridRowSpan` / `gridColumnSpan` / `gridRowAnchorIndex` / `gridColumnAnchorIndex` | grid child positioning | `grid-row`, `grid-column`, `span` | |
| `layout.gridChildHorizontalAlign` / `gridChildVerticalAlign` | per-child alignment in grid | `justify-self`, `align-self` | |
| `layout.minWidth` / `layout.maxWidth` / `layout.minHeight` / `layout.maxHeight` | size constraints | same-named CSS properties | |
| `layout.constraints.horizontal/vertical` | Figma constraint system | responsive absolute anchoring | Mainly relevant when `layoutMode: NONE` |
| `layout.strokeTopWeight` / `strokeRightWeight` / `strokeBottomWeight` / `strokeLeftWeight` | per-side stroke widths | `border-*-width` | Prefer these over a single uniform width when present |
| `layout.inferredAutoLayout` | Figma-inferred auto-layout | possible `DOM_INFERRED` escalation | Use only when route logic explicitly allows it |

## Style Layer

| Field | Meaning | Typical CSS use | Notes |
|---|---|---|---|
| `style.opacity` | whole-node opacity | `opacity` | Separate from fill opacity |
| `style.blendMode` | blend mode | `mix-blend-mode` | Skip `PASS_THROUGH` |
| `style.fills[]` | fill stack | background / text color / images | Multi-layer capable |
| `style.fills[].type` | `SOLID`, gradient types, `IMAGE`, `VIDEO`, `PATTERN` | route-specific mapping | |
| `style.fills[].visible` | layer visibility | skip that layer | |
| `style.fills[].opacity` | fill-layer opacity | alpha multiplication | |
| `style.fills[].color.hex` | solid color | `background-color` / `color` | Prefer `hex` when present |
| `style.fills[].gradientStops[].{position,color}` | gradient stop list | gradient generation | Usually replaced by `computedCss.background` |
| `style.fills[].gradientTransform` | 2x3 transform for the gradient | advanced gradient mapping | Prefer `computedCss.background` when available |
| `style.fills[].imageHash` | image asset key | `background-image` / asset lookup | Resolved through cache assets |
| `style.fills[].scaleMode` | `FILL`, `FIT`, `CROP`, `TILE` | `cover`, `contain`, stretch, repeat | |
| `style.fills[].imageTransform` | 2x3 image transform | `background-position` / `background-size` | |
| `style.strokes[]` | stroke stack | border / outline / SVG stroke | Gradient strokes must not be silently downgraded |
| `style.strokeAlign` | `INSIDE`, `CENTER`, `OUTSIDE` | border / outline / wrapper strategies | |
| `style.effects[]` | effects list | blur / shadow / backdrop-filter | |
| `style.effects[].type` | `LAYER_BLUR`, `BACKGROUND_BLUR`, `DROP_SHADOW`, `INNER_SHADOW` | effect mapping | |
| `style.effects[].radius` | blur/shadow radius | `blur(...)`, shadow radius | Use the raw bridge value, not downgraded CSS hints |
| `style.effects[].offset.{x,y}` | shadow offset | `box-shadow` offsets | |
| `style.effects[].spread` | shadow spread | `box-shadow` spread | |
| `style.effects[].color` | shadow color | `box-shadow` color | |
| `style.cornerRadius` | uniform radius | `border-radius` | Present only when all corners are equal |
| `style.cornerRadii.{topLeft,topRight,bottomRight,bottomLeft}` | per-corner radii | per-corner radius props | Present only when corners differ |
| `style.strokeWeight` / `style.strokeWeights.{top,right,bottom,left}` | uniform/per-side stroke widths | border widths | |
| `style.dashPattern` | dash pattern | dashed border / SVG stroke | |

## Text Layer (TEXT Only)

| Field | Meaning | HTML / CSS use | Notes |
|---|---|---|---|
| `text.characters` | full text content | fallback text content | If segments exist, segments win |
| `text.segments[]` | style runs | split spans / links | Required when multiple runs exist |
| `text.fontName.family/style` | typeface metadata | `font-family`, `font-weight`, `font-style` | |
| `text.fontSize` | font size | `font-size` | |
| `text.lineHeight.{unit,value}` | line-height metadata | `line-height` | Preserve pixel / percent / auto meaning |
| `text.letterSpacing.{unit,value}` | tracking metadata | `letter-spacing` | |
| `text.textAlignHorizontal` | horizontal alignment | `text-align` | |
| `text.textAlignVertical` | vertical alignment | flex parent alignment | Important in some text wrappers |
| `text.textCase` | casing rule | `text-transform` / small caps | |
| `text.textDecoration` | underline / strike | `text-decoration` | |
| `text.segments[].fills[0].color.hex` | per-segment color | span-level `color` | |
| `text.segments[].hyperlink.url` | link target | `<a href>` | |
| `text.paragraphSpacing` | paragraph spacing | `margin-bottom` / gap | |
| `text.paragraphIndent` | paragraph indent | `text-indent` | |
| `text.listSpacing` / `text.listOptions` | list formatting | list spacing / list markup | |

## Vector Layer (Vector-Like Nodes Only)

| Field | Meaning | Use |
|---|---|---|
| `vector.fillGeometry[].path` | SVG fill path data | inline SVG or route escalation |
| `vector.strokeGeometry[].path` | SVG stroke path data | inline SVG or route escalation |
| `vector.vectorPaths[]` | raw vector paths | fallback geometry source |
| `vector.vectorNetwork` | vector network description | advanced reconstruction / diagnostics |
| `vector.handleMirroring` | Bezier handle mirroring behavior | curve reconstruction reference |
| `node.svgRef` / `node.svgString` | full SVG blob/string | preferred for `SVG_ISLAND` |

## Computed CSS Layer (Highest Priority)

These are final, pipeline-enriched values. If they exist, use them directly.

| Field | Meaning | Use |
|---|---|---|
| `node.computedCss.background` | final gradient/background expression | use directly |
| `node.computedCss.tokens` | token binding map by CSS property | emit `var(--token)` where appropriate |
| `node.computedCss.box` | size / gap / padding / min/max values | direct CSS mapping |
| `node.computedCss.positioning` | layout mode / flex / absolute / grid metadata | direct CSS mapping |
| `node.computedCss.appearance` | colors / borders / radius / effects | direct CSS mapping |
| `node.computedCss.full` | full style string | highest-priority drop-in style |
| `node.computedCss.withTokens` | token-preserving style string | use when theme-aware output matters |
| `node.computedHtml` | prebuilt HTML fragment | especially valuable for TEXT and inline SVG |

## Variable Binding Sources

| Source | Meaning |
|---|---|
| `node.variables.bound.<prop>` | explicit binding that should usually become a CSS variable |
| `node.variables.inferred.<prop>` | informational inferred suggestion; not a forced binding |
| `variables-substitution-map.json` | variable-name -> CSS variable map with per-mode values |

See `07-tokens-and-vars.md` for detailed token output rules.

## Cross-Validation Artifact

| File | Meaning |
|---|---|
| `cross-validation-report.json` | pipeline-generated HIGH / MEDIUM / INFO warning list |

Any `HIGH` warning must be handled before writing reproduction code.

## Cache Root Sidecars

Each `cache/<fileKey>/<nodeId>/` directory may also contain:

| File | Purpose | When to read |
|---|---|---|
| `bridge-agent-payload.json` | full enriched payload | field-level drill-down |
| `render-ready.json` | flattened, ready-for-emission structure | emitters and codegen |
| `outline.json` | sparse planning tree | planning pass before deep reads |
| `globals.json` | deduplicated fills / strokes / effects by content hash | palette reasoning and shared-style analysis |
| `variables-inferred.json` | externalized variable suggestions | optional design-system backfill only |
| `variables-substitution-map.json` | token alias / resolved variable map | token-aware output |
| `cross-validation-report.json` | validation warnings | mandatory before coding |
| `cache-manifest.json` | resource path index | imageHash / svgRef resolution |
| `baseline/baseline.png` + preview sidecars | verification baseline | pixel comparison |
| `blobs/svg-*.svg` | SVG blobs | vector routes |
| `assets/<hash>.<ext>` | image assets | image fills |

### `outline.json` Rules

- emitted from both bridge extraction and `render_ready`
- contains all nodes, even if visibility is false
- used for planning, not as a substitute for field-level truth

### `globals.json` Rules

- emitted after enrichment
- `fills` / `strokes` / `effects` are hashed into stable IDs
- `style.fillId` / `strokeId` / `effectId` are additive; inline arrays remain available for backwards compatibility

### `variables-inferred.json` Rules

- produced by `externalizeInferredVariables()`
- keyed by node ID
- not read by the main reproduction pipeline
- exists to reduce payload weight while preserving informational suggestions

## High-Severity Rule

If `cross-validation-report.json` contains `HIGH` warnings, they must be resolved before writing reproduction code.
