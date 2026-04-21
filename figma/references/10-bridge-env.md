# 10 — Bridge Environment / Plugin / Commands

The bridge is a three-part chain:

```text
Figma plugin -> Node bridge service -> pipeline
```

This file covers installation, environment variables, common commands, cache paths, and troubleshooting.

## When to Read This

- first-time local bridge setup
- `NO_PLUGIN_CONNECTION`
- host / port / timeout changes
- missing dependencies for baseline export or scorecard
- finding generated cache artifacts

## Command Convention

Unless explicitly stated otherwise, commands are run from:

```bash
skills/figma/
```

## System Dependencies

```bash
pip3 install numpy Pillow
brew install librsvg
```

Notes:

- `fidelity_scorecard.py` and `acceptance_pipeline.py` require Python + Pillow + NumPy
- `rsvg-convert` is mostly a fallback renderer; plugin A8 already provides PNG baselines for the main container types
- Node-side scripts use native `fetch`, so Node 18+ is required

## Bridge Environment Variables

| Variable | Default | Meaning |
|---|---|---|
| `FIGMA_BRIDGE_HOST` | `127.0.0.1` | bridge host |
| `FIGMA_BRIDGE_PORT` | `3333` | bridge port |
| `FIGMA_BRIDGE_EXTRACT_TIMEOUT_MS` | `180000` | extraction timeout |

## `ws_defs` Plugin Installation

1. Open Figma Desktop
2. Open `Plugins -> Development -> Import plugin from manifest...`
3. Select `./ws_defs/manifest.json`
4. Manually run `ws_defs` inside the target design file
5. Confirm the plugin UI shows a connected state before running Node commands

`manifest.json` should currently expose:

```text
name: ws_defs (C5+A8)
```

That version name indicates SVG transport plus FRAME baseline PNG export. If plugin code changes, re-import the manifest so Figma refreshes the bundle.

The current dev allowlist should include `http://localhost:3333`. If you change the port, update `manifest.networkAccess.devAllowedDomains` accordingly.

## Local Workflow

### 1. One-shot extract + enrichment + validation

```bash
node ./scripts/figma_pipeline.mjs "<figma-url>"
```

This performs:

- bridge ensure + extract
- deferred image asset fetch
- gradient CSS enrichment
- token enrichment
- full computed CSS enrichment
- optional MCP merge
- cross-validation
- baseline PNG generation
- summary output

### 2. Manual bridge debugging

```bash
node ./scripts/bridge_client.mjs health
node ./scripts/bridge_client.mjs ensure
node ./scripts/bridge_client.mjs agent "<figma-url>"
node ./scripts/bridge_client.mjs asset "<figma-url>" "<hash>"
```

### 3. Merge MCP cache (optional)

```bash
node ./scripts/merge_cache.mjs "<figma-url|cache-dir>"
```

### 4. Rebuild the plugin bundle

```bash
node ./scripts/build_ws_defs_bundle.mjs
```

### 5. Run acceptance rerender loops

```bash
python3 ./scripts/acceptance_pipeline.py \
  --manifest acceptance-manifest.json \
  --render-plan render.plan.json \
  --apply-route-escalation \
  --max-iterations 3 \
  --workers 2
```

See `09-verification.md` for acceptance details.

## Cache Artifact Location

Target cache directory:

```text
./cache/<fileKey|unknown-file>/<nodeId>/
```

Common artifacts:

| File | Meaning |
|---|---|
| `bridge-response.json` | full raw bridge output (can be very large) |
| `bridge-agent-payload.json` | enriched working payload used by the reproduction pipeline |
| `cache-manifest.json` | path / resource index |
| `cross-validation-report.json` | bridge-vs-css validation report |
| `variables-substitution-map.json` | global variable name -> CSS variable map |
| `assets/` | image assets (`<imageHash>.<format>`) |
| `assets/_baseline_<nodeId>.png` | raw A8 plugin baseline PNG |
| `baseline/baseline.png` | lifted acceptance baseline |
| `baseline/baseline.png.lab.npy` | Lab cache for scorecard acceleration |
| `blobs/svg-*.svg` | complex vector SVG blobs |
| `merged-agent-payload.json` | merged bridge + MCP working view |
| `merge-summary.md` | merged guidance summary |

## Troubleshooting

### `NO_PLUGIN_CONNECTION`

This means the bridge service is running but the plugin is not connected.

Check:

1. Figma Desktop is running
2. the plugin is running in the currently open file
3. the plugin UI shows **Connected**, not a transient loading state

If everything looks correct but the error persists, restart the bridge server and rerun the plugin.

### `/health` is unreachable

```bash
node ./scripts/bridge_client.mjs ensure
```

If startup still fails, inspect stderr for port conflicts.

### Baseline export failure

- For FRAME / SECTION / INSTANCE cases, confirm the plugin version includes A8 support (`ws_defs (C5+A8)`)
- For VECTOR-only fallback paths, confirm `rsvg-convert` is installed

### Missing image assets

```bash
node ./scripts/bridge_client.mjs asset "<figma-url>" "<image-hash>"
```

If this keeps failing, inspect plugin memory pressure. Very large images can approach sandbox limits.

### Missing `fileKey` in local drafts

Local drafts may not expose `figma.fileKey`. The bridge has a fallback path when there is only one unregistered client, so this does not automatically block reproduction.

## Cross-Platform Notes

- macOS: `rsvg-convert` via `brew install librsvg`; Chrome usually lives in `/Applications/Google Chrome.app`
- Linux: `apt install librsvg2-bin`; Chrome is usually `google-chrome` or `chromium`
- Windows: WSL is recommended; native Windows may require adapting renderer lookup logic

`generateBaseline()` currently auto-detects renderers in this order:

1. A8 plugin PNG baseline
2. `rsvg-convert`
3. headless Chrome

Any one of them is enough to produce a baseline.

## Migration / Protocol Rules

- If the bridge wire protocol changes, update `manifest.name` and force a re-import
- If only plugin implementation changes, rebuild the bundle and rerun the plugin
- If bridge server routes change, restart the bridge service; route changes are not hot-reloaded
