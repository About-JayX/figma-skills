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
Figma URL / node ID -> bridge -> mechanical baseline -> AI implementation -> verify -> repair
```

workflow, not as a one-off case note.

## Workflow Authority

`SKILL.md` is the single source of truth for reproduction workflow and execution order.

Rules:

- If any supporting doc in `docs/` or elsewhere appears to describe a different order, follow `SKILL.md`.
- Architecture / review docs may explain rationale, module boundaries, and implementation plans, but they must not redefine the canonical operator workflow.
- Verification policy still lives in `references/09-verification.md`, but the surrounding execution sequence lives here.

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

The first mechanical output is a starting point, not the final implementation.

### Workflow 2 — Read Diagnostics Before Choosing a Delivery Mode

Read first:

- `_verify/verify-report.json`
- `_verify/scorecard-heatmap.png`
- `lint-report.json`
- and, when needed, `render-ready.json` / `bridge-agent-payload.json`

Only then decide:

- whether the DOM structure is already viable or which DOM/layout/text issues need correction
- whether the gap is layout drift, text drift, color drift, or hard-node drift
- which elements are true SVG/vector elements and may stay SVG

Do not choose an overlay or lock strategy before reading the actual diff evidence.

### Workflow 3 — AI Implementation Pass in the Main Session

In an interactive agent session, AI implementation is a required stage for repository code output. Start from the current generated output, but do not treat the mechanical JSX/CSS as final unless the verification evidence already shows it is acceptable.

In autonomous CLI mode, the helper pipeline can only run this stage when an AI command is configured via `--ai-implement-cmd` or `FIGMA_AI_IMPLEMENT_CMD`. If neither is configured, the CLI path stops at mechanical output + verify and the implementation pass must happen in the interactive agent session instead.

Build the implementation pass from structured context in this order:

- `implementation-context.json` when present
- otherwise `render-ready.json`, `bridge-agent-payload.json`, first `_verify/verify-report.json`, first `scorecard*.json`, `lint-report.json`, token/variable sidecars, and asset manifests

Change only the current generated output:

- preserve `className (n-<id>)` and `id`, or keep an explicit traceability wrapper when swapping in an existing repo component
- prefer the smallest effective change set
- Prefer existing repo components, tokens, and semantic structure over raw `div` recreation
- adapt the result to the repo's file structure, layout primitives, and naming conventions
- if staying on a DOM route, fix structure, typography, spacing, alignment, and semantics
- only emit SVG when the element itself is a true SVG/vector element from Figma data
- do not turn ordinary DOM containers, text blocks, or image sections into SVG islands as a fidelity shortcut

Do not:

- treat the mechanical starter as the final implementation by default
- turn an unverified guess into final structure
- optimize for screenshot parity by silently sacrificing real DOM, semantics, or interaction
- use `SVG_ISLAND`, page-level image overlays, or full-page SVG/image cover layers unless the user explicitly approves an exception
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

1. Mechanical baseline + first verify
2. First AI implementation pass
3. Second AI / text / layout / DOM convergence pass
4. If still not converging, stop and diagnose the mechanical starter, typography, layout, or source design data instead of introducing overlay shortcuts

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
baseline first -> diagnostics second -> routing decision third -> AI implementation fourth -> re-verify -> claim alignment last
```

## Delivery Modes

Three delivery modes are supported for web reproduction:

| Mode | Best for | Primary goal |
|---|---|---|
| `DOM-first` | Product pages, design-system pages, interaction-heavy surfaces | Preserve true DOM structure and maintainability |
| `Hybrid-SVG` | Pages with local hard nodes but still meaningful live DOM, text, and buttons | Keep interactive DOM while locking difficult regions to SVG/Canvas |
| `Visual-lock` | Marketing pages, campaign pages, heavily decorative surfaces, or designs that remain hard-node limited after DOM/Hybrid passes | Maximize visual parity, accept stronger graphic locking |

Rules:

- Start with `DOM-first` by default and keep it as the active workflow unless the user explicitly requests an exception.
- For the current workflow, do not use `Hybrid-SVG` or `Visual-lock` as automatic fallback strategies.
- Do not use page-level image overlays or full-page SVG/image cover layers unless the user explicitly approves that trade-off.
- Only actual SVG/vector elements may be emitted as SVG.
- Do not escalate ordinary text, ordinary auto-layout containers, or ordinary image content to `SVG_ISLAND` just because they are visually difficult.
- If you use `Hybrid-SVG` or `Visual-lock`, the final report must explicitly state the delivery mode and the locked regions.
- Higher visual parity under `Visual-lock` is not a higher real DOM fidelity result.

### Locked Regions

A locked region is a node, subtree, or page surface whose final pixels come from SVG, Canvas, or Raster instead of pure DOM/CSS reconstruction.

Locked regions may still keep:

- original `id`
- original `className`
- semantic wrappers
- minimal interactive escape hatches

for traceability, audits, and later refactors.

## Overlay / Island Constraints

When using any allowed overlay or island exception:

- Prefer subtree-level locking before page-level locking.
- Only use page-level locking when most remaining drift comes from page-wide decorative surfaces and interaction is weak.
- Preserve original `id` and `className`.
- Overlay layers must default to `aria-hidden="true"`.
- Elements that need real click, hover, or focus must remain above the overlay, or be removed from the locked region.
- A full-page image-style cover layer is forbidden unless the user explicitly asks for or approves it.
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

### Step 3 — Write Mechanical Starter, Then AI Implementation

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

The AI implementation pass after generation must:

1. Build or consume structured implementation context from the generated artifacts
2. Replace raw structural output with existing repo components where mappings or strong heuristics exist
3. Swap in semantic tags where appropriate
4. Add interactivity or state
5. Wire `RESET_CSS` / `FONTS_HREF` in skeleton mode
6. Copy or symlink assets in skeleton mode
7. Preserve traceability (`id`, `className`, wrappers, or an explicit mapping) for later verification

Autonomous CLI note:

- `codegen_pipeline.mjs` writes `implementation-context.json`
- `figma_pipeline.mjs --auto` only runs the AI implementation stage automatically when `--ai-implement-cmd` or `FIGMA_AI_IMPLEMENT_CMD` is configured
- the AI command template must consume the structured context and diagnostics, not just the project directory

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
