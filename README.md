# figma-skills

High-fidelity Figma reproduction skills and pipeline tooling for turning a Figma node into a runnable web output with explicit verification.

This repository is optimized for one job:

- extract the real node payload from Figma
- build a replay-first bundle
- generate mechanical React/HTML output
- refactor only after a measured baseline exists
- verify fidelity with lint + scorecard instead of eyeballing

## What This Repo Is Good At

`figma/` is designed for reproduction fidelity, not just fast scaffolding.

Key strengths:

- Local bridge first. The workflow prefers the local `ws_defs` bridge/plugin so it can read raw geometry, layout, fills, strokes, effects, SVG blobs, deferred image assets, and baseline PNG export.
- Replay-first architecture. The pipeline builds a cache bundle around the target node, so every decision is grounded in extracted data rather than naming guesses.
- Mechanical codegen before model edits. You always start from a deterministic baseline (`render_ready -> emit_jsx / emit_css -> codegen_pipeline`) before any semantic cleanup.
- Route escalation for hard nodes. When plain DOM is not faithful enough, the workflow can escalate to `SVG_ISLAND`, `CANVAS_ISLAND`, or `RASTER_LOCK`.
- Verification as a first-class step. The workflow ships `verify_loop`, `lint_reproduction`, `fidelity_scorecard.py`, heatmaps, and report artifacts so fidelity claims are evidence-backed.
- Long-page and large-image awareness. The docs and scripts explicitly handle region-first verification, image previews, screenshot sizing, and large-page constraints.
- No-skip workflow. The skill now encodes a strict order: extract, baseline, first verify, diagnose, choose delivery mode, refactor, re-verify.

## Why It Is More Accurate Than MCP-Only Reproduction

This repo does not treat Figma MCP as the main source of truth for reproduction. MCP is useful, but mainly as a supplement for screenshots, metadata, or Code Connect style hints.

Compared with a typical MCP-only workflow, this repo is stronger on fidelity because it has richer primary inputs and stricter verification.

### Architecture Comparison

| Dimension | This repo (`figma-skills`) | Figma MCP-only flow |
|---|---|---|
| Primary source of truth | Local bridge payload + plugin baseline PNG + SVG/image blobs | MCP metadata / screenshots / code hints |
| Layout fidelity | Uses extracted layout, geometry, effective gaps, raw bounds | Often inferred from metadata or screenshot interpretation |
| Hard node handling | Explicit route escalation: DOM -> SVG -> Canvas -> Raster | Usually weaker for complex vector/filter/mask-heavy surfaces |
| Image/video assets | Deferred binary asset fetch and baseline-backed placeholders | Depends on MCP exposure and screenshot quality |
| Verification | Built-in lint + SSIM / pixel diff / DeltaE + heatmaps | Usually ad hoc or external |
| Long page support | Region-first workflow, large image guardrails, preview sidecars | Easier to drift when screenshots or manual inspection are the main loop |
| Workflow discipline | No-skip reproduction workflow in the skill | Often more manual and easier to skip baseline/verification steps |

### Practical Accuracy Difference

In practice, this repo is usually better than MCP-only reproduction when the target has:

- complex vectors or decorative borders
- heavy marketing-page styling
- large/long page layouts
- subtle typography dependence
- filtered media or image-backed sections
- nodes that need route escalation instead of forced DOM reconstruction

That does not mean MCP is useless. It means:

- use the local bridge as the fidelity source
- use MCP as a supplement

This is also why the default agent prompt in this repo says:

- bridge first
- MCP second
- verify before claiming high fidelity

## Delivery Modes

The current workflow supports three delivery modes:

- `DOM-first`: prefer real DOM structure and maintainability
- `Hybrid-SVG`: keep DOM where it matters, lock only the hard regions
- `Visual-lock`: prioritize visual parity when the page is mostly decorative and hard-node heavy

The important point is that the delivery mode must be chosen after the first verification pass, not before.

## Main Workflow

The intended flow is:

1. Run `figma/scripts/figma_pipeline.mjs --auto "<figma-url>"`
2. Get the first mechanical baseline and verify artifacts
3. Read heatmap / lint / scorecard before editing
4. Choose delivery mode and route escalation based on evidence
5. Refactor in the main session
6. Re-run verification after each meaningful round
7. Report fidelity numbers and locked regions explicitly

This workflow exists to prevent a common failure mode: skipping extraction or verification steps, then overfitting the DOM to guesses and losing fidelity.

## Important Scripts

Core pipeline:

- `figma/scripts/figma_pipeline.mjs`
- `figma/scripts/render_ready.mjs`
- `figma/scripts/emit_jsx.mjs`
- `figma/scripts/emit_css.mjs`
- `figma/scripts/codegen_pipeline.mjs`
- `figma/scripts/generate_skeleton.mjs`

Verification:

- `figma/scripts/verify_loop.mjs`
- `figma/scripts/lint_reproduction.mjs`
- `figma/scripts/fidelity_scorecard.py`

Supporting references:

- `figma/SKILL.md`
- `figma/references/08-route-escalation.md`
- `figma/references/09-verification.md`

## Notes

- This repo is intentionally opinionated toward reproduction accuracy.
- It is not a generic MCP wrapper.
- It is not trying to produce the prettiest semantic React tree first.
- It is trying to produce the most trustworthy reproduction workflow first.

If your goal is pixel-faithful reproduction from a Figma node, this repo is built for that job.
