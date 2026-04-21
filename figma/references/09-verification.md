# 09 — Verification: Scorecard, Manifest, Done Gate

This is the detailed single source of truth for acceptance. `SKILL.md` Step 4 points here.

## Fidelity Metrics

### Required

- pixel diff ratio
- SSIM
- DeltaE00 (`p50`, `p95`, `max`)
- key text wrapping consistency
- route-escalation traceability

### Threshold Tiers

| Tier | SSIM | pixel_diff | DeltaE00 p95 | DeltaE00 max |
|---|---|---|---|---|
| page | `>= 0.98` | `<= 0.5%` | `<= 1.5` | `<= 3.0` |
| region | `>= 0.985` | `<= 0.2%` | `<= 1.0` | `<= 2.0` |
| hard-node | `>= 0.99` | `<= 0.1%` | `<= 0.8` | `<= 1.5` |
| text | key line breaks must match | baseline shift `<= 1px` | text width error `<= 1%` | |

Silent mis-routing is not allowed. Any node above threshold must be escalated or explicitly waived.

## Performance Hard Gates

If any of these are violated, acceptance must stop:

1. **Region first**: run `--crop` + `--mode region` before full-page scoring
2. **Large-image guard**: if baseline/candidate exceed ~25M pixels, full-page scorecard is forbidden
3. **Early exit**: use `--early-exit` when pixel diff is already far above threshold
4. **Concurrency guard**: large-image acceptance / rerender / baseline generation must not fan out blindly
5. **Large-object read guard**: default to `bridge-agent-payload.json`, `cross-validation-report.json`, and `merge-summary.md`; do not load full `bridge-response.json` or `restSnapshot` unless the bug specifically requires it

## Baseline Sources

Priority order:

1. **Plugin `exportAsync` PNG** (A8) — `cache/.../baseline/baseline.png`
2. **Bridge SVG -> `rsvg-convert`** when a node has `svgString`
3. **MCP screenshot** when the above are unavailable
4. **Manual Figma export** as a final fallback

## Candidate Rendering

Use headless Chrome and preserve these rules:

- `--window-size=<design-w>,<design-h>` uses **CSS pixels**, not pre-multiplied DPR
- `--force-device-scale-factor=2` produces a 2x raster output
- `--headless=new` is required
- `--virtual-time-budget=10000` gives fonts time to load
- `--hide-scrollbars`

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 \
  --virtual-time-budget=10000 \
  --screenshot=./output/render-2x.png \
  --window-size=<design-w>,<design-h> \
  "http://localhost:<port>/index.html"
```

### Screenshot Post-Processing Warning

Do **not** use `sips --cropOffset` or other fragile post-crop tricks on candidate screenshots. Earlier versions introduced top black bands that destroyed SSIM while the DOM itself was fine.

Rules:

- capture the correct window size directly
- do not add fake padding before capture
- if cropping is truly required, use deterministic image tooling and verify the final dimensions

Dimension sanity check:

```bash
python3 -c "from PIL import Image; print(Image.open('candidate.png').size)"
```

The result must match `(W*2, H*2)`.

## Scorecard Commands

```bash
# region-first
python3 ./scripts/fidelity_scorecard.py \
  --baseline <baseline.png> --candidate <render.png> \
  --mode region \
  --crop 0,<section_y>,<width>,<section_height> \
  --report ./output/sc-<section>.json \
  --heatmap ./output/heatmap-<section>.png

# region debugging with early exit
python3 ./scripts/fidelity_scorecard.py \
  --baseline <baseline.png> --candidate <render.png> \
  --mode region --crop ... --early-exit

# page after region convergence
python3 ./scripts/fidelity_scorecard.py \
  --baseline <baseline.png> --candidate <render.png> \
  --mode page --max-pixels 30000000
```

Important flags:

| Flag | Meaning |
|---|---|
| `--mode` | page / region / hard-node |
| `--crop x,y,w,h` | crop both images before comparison |
| `--early-exit` | skip expensive metrics when pixel diff is already far too high |
| `--max-pixels N` | forbid very large full-page runs |
| `--lpips` | optional LPIPS |
| `--fail-on-thresholds` | CI-style non-zero exit on threshold failure |

## Acceptance Manifest

Multi-entry acceptance uses a manifest:

```json
{
  "version": 1,
  "task": { "name": "reproduce-desktop-20-532" },
  "entries": [{
    "id": "hero-headline",
    "mode": "region",
    "surface": "page",
    "baseline": "baseline.png",
    "candidate": "render-2x.png",
    "crop": "0,0,2560,498",
    "route": "DOM_NATIVE",
    "nodeId": "20:533",
    "signals": { "hasGradientText": true }
  }]
}
```

Run the acceptance pipeline:

```bash
python3 ./scripts/acceptance_pipeline.py \
  --manifest acceptance-manifest.json \
  --render-plan render.plan.json \
  --apply-route-escalation \
  --max-iterations 3 \
  --workers 2
```

## Three Diff Classes

- **render diff** -> locate mismatches
- **perceptual diff** -> judge threshold status
- **plan diff** -> choose the repair action from route, signals, delivery mode, locked regions, and mismatch type

## Diagnosis Order for Unexpectedly Low SSIM (< 0.7)

When SSIM is abnormally low even though the page “looks close”, do **not** start by blaming CSS. Diagnose the capture first:

1. verify screenshot size equals design size times DPR
2. verify there are no unexpected black/white bands at the top or bottom
3. compare rough row-by-row brightness profiles
4. avoid tiny-point sampling on decorative surfaces
5. inspect a raw screenshot without post-crop

Only after those checks pass should you blame CSS, fonts, or layout.

## Repair Plan Rules

| Diff type | Action |
|---|---|
| size mismatch | `ENFORCE_ABSOLUTE_BOUNDS` / `DOM_INFERRED` route upgrade |
| layout drift | `FIX_LAYOUT_METRICS` / route escalation |
| color drift | `SYNC_COLOR_AND_EFFECTS` / color profile fix |
| hard-node drift | `FORCE_PRECISE_VECTOR_EXPORT` / escalate SVG -> CANVAS -> RASTER |
| text drift | `FIX_TEXT_METRICS` / inspect font loading, wrapping, baseline, OpenType |
| interaction hidden by overlay | shrink the locked region, move interactive nodes above it, or fall back from `Visual-lock` to `Hybrid-SVG` |

## Delivery Modes and Locked Regions

Acceptance must state whether the delivery mode is:

- `DOM-first`
- `Hybrid-SVG`
- `Visual-lock`

A locked region is a node, subtree, or page area whose final pixels come from SVG, Canvas, or Raster instead of pure DOM reconstruction.

If `Hybrid-SVG` or `Visual-lock` is used:

- the report must state the delivery mode
- the report must list locked regions
- each locked region must include at least node ID / region name / route / reason
- the report must say whether interaction is preserved or bypassed there

## Output Artifacts

Each acceptance round should produce:

- `acceptance-manifest.json`
- `acceptance.plan.json`
- `acceptance.summary.md`
- `diff-report.json`
- `diagnostics.json`
- baseline / candidate / heatmap artifacts
- optional zip bundles

## Done Gate

- [ ] the manifest is complete and all important entries have scorecard results
- [ ] route upgrades required by the plan were applied
- [ ] the rerender loop converged or hit the explicit maximum
- [ ] if `Hybrid-SVG` / `Visual-lock` was used, delivery mode and locked regions are documented
- [ ] the final bundle is packaged when relevant
- [ ] the result summary lists passes, failures, unverified areas, and known deviations

## Final Report Shape

The final user-facing report must include:

- baseline source and candidate source
- delivery mode
- locked regions and why they were escalated
- accepted surfaces
- checked dimensions
- threshold results
- unverified areas
- known deviations

Without a baseline and explicit checked dimensions, do not claim final alignment.

## Manual Review Conditions

- even `RASTER_LOCK` still fails
- fonts or runtime capabilities are missing
- the baseline is unstable because of animation or dynamic content
- strong interactivity is part of the design requirement

Mark these as `MANUAL_REVIEW`, not as silent success.

## Fixed Verification Environment

- browser version + OS
- font file version / WOFF2 fingerprint
- screenshot size + DPR
- sRGB color space
- no animation / cursor / time-dependent artifacts

## Six-Dimension Acceptance Checklist

| Dimension | Focus |
|---|---|
| geometry & layout | size, padding, gap, margin, alignment, radius, border width/color, icon touch target, anchors, absoluteRenderBounds, grid track/span/anchor |
| text & hierarchy | family, size, weight, line height, truncation, mixed-language runs, key line breaks, baseline offset, list spacing, decoration |
| visual layer | foreground/background color, dividers, gradient stop placement, blur/shadow/mask, pattern, opacity, object-fit, texture/noise/progressive blur |
| states & behavior | hover, active, disabled, visibility conditions, truncation/overflow, async layout shifts, variant / prop / mode assumptions |
| route & renderer | whether hard nodes were classified and escalated correctly |
| diff evidence | pixel diff ratio, SSIM, DeltaE00 (`p95` + `max`), baseline source, optional LPIPS |
