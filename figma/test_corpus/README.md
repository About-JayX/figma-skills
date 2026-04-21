# Figma Regression Corpus

This directory stores representative Figma samples used to regression-test the reproduction pipeline. The goal is not just broad visual variety, but stable, reusable coverage for `render_ready`, `emit_css`, `emit_jsx`, lint checks, and verification behavior.

## Directory Convention

```text
test_corpus/
├── README.md
├── marketing-long-page/
│   ├── spec.json
│   ├── cache/
│   └── expected/
├── dashboard-dense/
├── component-library/
├── icon-gallery/
└── long-article/
```

## What Each Sample Type Should Cover

| Directory | Scenarios that should be covered |
|---|---|
| `marketing-long-page` | `layoutWrap`, many image fills, flex-wrap grids, large decorative surfaces |
| `dashboard-dense` | absolute-positioned tooltips, table borders, form-heavy UI |
| `component-library` | many `INSTANCE`s, variants, shared tokens, boolean/vector composition |
| `icon-gallery` | 100+ VECTOR nodes, multiple `strokeAlign` combinations, wide fill/stroke distribution |
| `long-article` | multi-segment TEXT, line wrapping, line-height variants, mixed font families |

## Example `spec.json`

```json
{
  "label": "marketing-long-page",
  "figmaUrl": "https://www.figma.com/design/XXX?node-id=N%3AM",
  "nodeId": "1:118",
  "description": "Area landing page · 233 nodes · 11 images · 233 SVG blobs",
  "capturedAt": "2026-04-20",
  "baselineSsimFloor": {
    "mechanical": 0.8200,
    "after_refactor": 0.9300
  },
  "knownPatterns": [
    "layoutWrap:WRAP on product grid",
    "layoutMode:NONE on tablet component",
    "per-side stroke dividers on list items"
  ]
}
```

### Meaning of `baselineSsimFloor`

`baselineSsimFloor` records the currently accepted SSIM waterline for that sample. Regression runs compare the newly produced result against that floor, usually with a small tolerance. If the sample falls below that floor, the pipeline should treat it as a fidelity regression.

## How to Add a New Sample

1. Select the target node in Figma and copy its URL.
2. Extract a fresh cache:

   ```bash
   node skills/figma/scripts/figma_pipeline.mjs --auto "<url>"
   ```

3. Verify that the current SSIM / pixel diff behavior is acceptable.
4. Ingest the sample:

   ```bash
   node skills/figma/scripts/ingest_corpus_sample.mjs \
     --source-cache skills/figma/cache/<file>/<node> \
     --label <descriptive-name>
   ```

5. Commit only the intended sample metadata and expected outputs.

## Running Regression

```bash
npm run regression:corpus
```

The intended behavior is:

- run codegen + verification across all registered samples
- compare each sample against its accepted floor
- exit non-zero if any sample regresses beyond tolerance

## Why This Corpus Does Not Use Git LFS by Default

Caches can be large. In practice, a single sample cache may range from a few megabytes to hundreds of megabytes. For that reason, corpus caches are usually treated as synced developer data rather than repository-first source of truth.

The intended policy is:

- keep `spec.json`
- keep human-readable corpus documentation
- keep only the exact expected artifacts that are intentionally versioned
- avoid blindly checking in all extracted cache contents

If the team later decides to formalize large sample storage, that should be an explicit decision rather than an accidental byproduct of committing local caches.
