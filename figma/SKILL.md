---
name: figma
description: >-
  Use when reproducing a Figma design from a URL or node ID, handling bridge or
  plugin setup, running visual diff loops, applying route escalation for hard
  nodes, or syncing Figma-driven UI changes. Use the local bridge as the
  primary fidelity source; use MCP only as a supplement for screenshots, assets,
  and code-connect hints.
---

# Figma High-Fidelity Reproduction

This skill is a high-fidelity Figma-to-frontend reproduction workflow. The primary source of truth is the bridge-extracted `style.*` data plus pipeline-enriched `computedCss.*`. `node.css` is only a fallback hint and must not replace verified bridge fields.

## Command Convention

Unless stated otherwise, commands in this skill are run from the skill root:

```bash
skills/figma/
```

## Generic Template Constraints

This skill is a reusable template for many different designs. It must not be treated as a recipe for one specific page, one specific node tree, or one visual style.

- Every `<figma-url>`, `<cache-dir>`, `<output-dir>`, and `<nodeId>` placeholder must be replaced with the current task’s real target.
- Do not turn page-specific component names, colors, typography, or structure from one reproduction into global rules.
- Semantic component boundaries must come from the current design’s structure and responsibilities.
- Output paths, verification screenshots, baselines, and heatmaps must always come from the current cache directory.
- If the current design differs significantly from earlier examples, preserve the workflow and verification gates instead of forcing an old component pattern onto it.

Treat this skill as a generic:

```text
Figma URL / node ID -> bridge -> codegen -> refactor -> verify
```

workflow, not as a one-off case note.

## References

Read these in order, based on the task stage:

| No. | File | When to read |
|---|---|---|
| 01 | `references/01-data-sources.md` | Before writing code. Canonical field map for the enriched agent payload, including `computedCss.*`. |
| 02 | `references/02-css-reset.md` | Before writing code. Required CSS reset template. |
| 03 | `references/03-node-to-html.md` | While mapping each node. Deterministic node consumption algorithm. |
| 04 | `references/04-text-rendering.md` | When handling TEXT nodes. |
| 05 | `references/05-layout-modes.md` | When handling FRAME / SECTION / INSTANCE layout. |
| 06 | `references/06-paint-effects.md` | When handling gradients, masks, shadows, blur, and appearance mapping. |
| 07 | `references/07-tokens-and-vars.md` | When variables or token bindings are involved. |
| 08 | `references/08-route-escalation.md` | When hard nodes appear or scorecard results require route upgrades. |
| 09 | `references/09-verification.md` | For acceptance. This is the single source of truth for verification. |
| 10 | `references/10-bridge-env.md` | When bridge, plugin, or cache environment issues appear. |

## Standard Workflow (No Skipping)

When a user gives a Figma URL or node ID and asks for a React/web reproduction, follow this workflow in order. The purpose is to stop step-skipping from degrading fidelity.

### Workflow 0 — Resolve Inputs

- Resolve the task into `<figma-url>`, `<cache-dir>`, and `<output-dir>`.
- If the user does not specify an output path, use `output/gen-<nodeId>/` or the agreed task path.
- Never reuse another task’s generated artifacts for a different node.

### Workflow 1 — Extract and Generate the Mechanical Baseline First

```bash
node skills/figma/scripts/figma_pipeline.mjs --auto "<figma-url>"
```

Do not edit JSX/CSS before you have:

- `bridge-agent-payload.json`
- `render-ready.json`
- `baseline/baseline.png`
- the first `_verify/verify-report.json`
- the first `lint-report.json`
- the first `scorecard*.json`
- the mechanical output project

Skipping the first verification pass is forbidden.

### Workflow 2 — Read Diagnostics Before Choosing a Delivery Mode

Read first:

- `_verify/verify-report.json`
- `_verify/scorecard-heatmap.png`
- `lint-report.json`
- and, when needed, `render-ready.json` / `bridge-agent-payload.json`

Only then decide:

- whether the delivery mode should be `DOM-first`, `Hybrid-SVG`, or `Visual-lock`
- whether the gap is layout drift, text drift, color drift, or hard-node drift
- whether route escalation is required

Do not choose an overlay or lock strategy before reading the actual diff evidence.

### Workflow 3 — Refactor in the Main Session Only

Change only the current generated output:

- preserve `className (n-<id>)` and `id`
- prefer the smallest effective change set
- if staying on a DOM route, fix structure, typography, spacing, alignment, and semantics
- if the node is hard-route driven, escalate with `SVG_ISLAND`, `CANVAS_ISLAND`, or `RASTER_LOCK`

Do not:

- turn an unverified guess into final structure
- start with broad cleanup or beautification before fidelity is under control

### Workflow 4 — Re-Verify After Every Meaningful Change

After each meaningful round, rerun:

- `lint_reproduction`
- scorecard / `verify_loop`

Use that evidence to decide:

- whether the result improved
- whether the current delivery mode is still appropriate
- whether the locked region should expand, shrink, or release interactive elements

Do not stack multiple major structure changes and verify only once at the end.

### Workflow 5 — Maximum Three Iterations

Recommended cadence:

1. Mechanical baseline
2. First targeted fix
3. Second route / text / layout convergence pass
4. If still not converging, manually decide whether to enter `Visual-lock` or `RASTER_LOCK`

If three rounds do not clearly converge:

- stop “tuning by feel”
- return to route, screenshot, font-loading, or baseline-stability diagnosis

### Workflow 6 — Report Explicitly

Every final report must include:

- final delivery mode
- locked regions
- SSIM / pixel diff / DeltaE00 changes
- lint block / warn counts
- remaining gaps or declared deviations

## Step-Skipping Risks

These shortcuts directly reduce reproduction quality:

- skipping the first verify pass
- skipping delivery-mode selection
- skipping per-round re-verification
- skipping locked-region reporting
- skipping lint reproduction

The rule is:

```text
baseline first -> diagnostics second -> routing decision third -> minimal fix -> re-verify -> claim alignment last
```

## Delivery Modes

Three delivery modes are supported for web reproduction:

| Mode | Best for | Primary goal |
|---|---|---|
| `DOM-first` | Product pages, design-system pages, interaction-heavy surfaces | Preserve true DOM structure and maintainability |
| `Hybrid-SVG` | Pages with local hard nodes but still meaningful live DOM, text, and buttons | Keep interactive DOM while locking difficult regions to SVG/Canvas |
| `Visual-lock` | Marketing pages, campaign pages, heavily decorative surfaces, or designs that remain hard-node limited after DOM/Hybrid passes | Maximize visual parity, accept stronger graphic locking |

Rules:

- Start with `DOM-first` by default.
- Escalate to `Hybrid-SVG` when a subtree is hard-node dominated or scorecard results repeatedly indicate hard-node drift.
- Escalate to `Visual-lock` only when most remaining error comes from hard/decorative surfaces and the page has weak interaction requirements.
- If you use `Hybrid-SVG` or `Visual-lock`, the final report must explicitly state the delivery mode and the locked regions.

### Locked Regions

A locked region is a node, subtree, or page surface whose final pixels come from SVG, Canvas, or Raster instead of pure DOM/CSS reconstruction.

Locked regions may still keep:

- original `id`
- original `className`
- semantic wrappers
- minimal interactive escape hatches

for traceability, audits, and later refactors.

## Overlay / Island Constraints

When using `SVG_ISLAND`, `CANVAS_ISLAND`, or `RASTER_LOCK` overlays:

- Prefer subtree-level locking before page-level locking.
- Only use page-level locking when most remaining drift comes from page-wide decorative surfaces and interaction is weak.
- Preserve original `id` and `className`.
- Overlay layers must default to `aria-hidden="true"`.
- Elements that need real click, hover, or focus must remain above the overlay, or be removed from the locked region.
- If the whole page is overlay-locked, the report must say this is `Visual-lock`, not pure DOM fidelity.
- `SVG_ISLAND` internals are not judged by ordinary flex-box decomposition; they are judged by route correctness plus visual verification.

## Mandatory Five-Step Process

### Step 1 — Bridge Extraction

```bash
node ./scripts/figma_pipeline.mjs "<figma-url>"
```

Artifacts in `cache/<fileKey>/<nodeId>/`:

- `bridge-agent-payload.json` — enriched payload, canonical field source
- `outline.json` — sparse planning tree, MCP-like metadata view
- `baseline/baseline.png` — plugin-exported 2x PNG
- `cross-validation-report.json` — bridge-vs-css validation report

Rules:

- `NO_PLUGIN_CONNECTION` means stop and read `10-bridge-env.md`. Do not silently fall back to MCP-only.
- Any `HIGH` cross-validation warning must be resolved before Step 3.
- Use `outline.json` for cheap tree reasoning; use `bridge-agent-payload.json` only for field-level drill-down.
- For vector-dense designs, `render_ready.mjs --collapse-vector-groups` may be used, but only after confirming it does not reduce fidelity.

### Step 2 — Node Audit

Produce a render audit table from `designSnapshot.root`, for example:

```text
Node ID   Name          visible  opacity  Render decision
xxxx      Play button   true     0        Skip [OPACITY=0]
xxxx      Category tag  false    1        Skip [HIDDEN]
xxxx      Title         true     1        Render
```

Rules:

- `node.visible === false` -> do not render
- `node.style.opacity === 0` -> do not render
- `fills[].visible === false` -> skip that fill layer only

### Step 3 — Write Code

#### Step 3a — Direct Generation (Preferred)

Two options:

**A. Full Vite project**

```bash
node ./scripts/codegen_pipeline.mjs <cache-dir> <output-dir>
```

This outputs a runnable React + Vite project:

- `src/App.jsx`
- `src/App.css`
- `index.html`
- `vite.config.js`
- `package.json`

The generated `index.html` already injects exact Google Fonts requests derived from bridge font data. SVG blobs go to `public/svg`. Image assets go to `src/assets`.

**B. Single-file React component**

```bash
node ./scripts/generate_skeleton.mjs <cache-dir> --target react --out output/skeleton.jsx
```

This outputs a single React component plus:

- `RESET_CSS`
- `FONTS_HREF`

for consumers who want to embed the result into an existing project.

The agent’s job after generation is limited to:

1. Renaming the component if needed
2. Swapping in semantic tags where appropriate
3. Adding interactivity or state
4. Wiring `RESET_CSS` / `FONTS_HREF` in skeleton mode
5. Copying or symlinking assets in skeleton mode

Do not re-translate bridge fields or recompute CSS that the generator already emitted.

#### Step 3b — Manual Fallback

For non-web targets such as iOS, Flutter, or mini-programs, follow `references/03-node-to-html.md`.

Preconditions:

1. Read `02-css-reset.md` if the target is web
2. Read `03-node-to-html.md`
3. Read references 04–08 as needed

Field precedence:

1. `node.computedCss.full` / `node.computedHtml`
2. `node.computedCss.<field>`
3. raw `node.style.*` / `node.layout.*` / `node.text.*`
4. `node.css.*` only when the authoritative fields are absent and the case is not a known downgrade

No guessing from screenshots. No component-name assumptions. No manual recomputation of gradients, token mappings, or layout that the pipeline already resolved.

## Acceptance

Read `09-verification.md` in full. Summary:

- region-first verification
- large-image guards
- `--headless=new --window-size=W,H --force-device-scale-factor=2`
- diagnose screenshot issues before blaming CSS
- preview sidecars for very large images
- page / region / hard-node thresholds

Without a baseline, you cannot claim alignment.

Without scorecard or explicit visual evidence, you cannot claim acceptance.

## Hard Gates

Any unchecked item means the reproduction is incomplete:

- [ ] Bridge extraction succeeded without silent fallback
- [ ] Node audit table exists and hidden / opacity-zero nodes were not rendered
- [ ] All `HIGH` cross-validation warnings were handled
- [ ] Web generation started from `generate_skeleton.mjs` or `codegen_pipeline.mjs`
- [ ] The reset block from `02-css-reset.md` is present
- [ ] All available `computedCss.full` / `computedHtml` values were used directly
- [ ] `layoutMode: NONE` frames use absolute positioning and visual-order sorting
- [ ] Multi-segment text is split into spans
- [ ] Gradient fills use `computedCss.background`
- [ ] Token bindings emit `var(--xxx)` where applicable
- [ ] Hard nodes were escalated to SVG / Canvas / Raster when required
- [ ] If `Hybrid-SVG` or `Visual-lock` was used, the delivery mode and locked regions are declared
- [ ] Overlay-based regions do not silently kill required interactivity
- [ ] Scorecard has been run according to `09-verification.md`
- [ ] The final report lists passes, failures, unverified areas, and known deviations
- [ ] Full-page scorecard was not run on oversized images
- [ ] `bridge-response.json` / full `restSnapshot` were not blindly loaded into context

## Environment

See `references/10-bridge-env.md` for dependency installation, bridge ports, plugin import instructions, and cache layout.
