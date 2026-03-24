# Review Checklist — Figma Plugin TS Migration

## Automated Verification (`npm run verify`)

| # | Check | Command | Status |
|---|-------|---------|--------|
| 1 | TypeScript type check | `npm run typecheck` | |
| 2 | ESLint (TS files) | `npm run lint` | |
| 3 | Config sync + UI build + legacy bundle | `npm run build:legacy` | |
| 4 | Generated artifacts consistency | `npm run verify:artifacts` | |
| 5 | Bridge server startup + /health + client | `npm run verify:bridge` | |
| 6 | Result chunk limits + UTF-8 round-trip | `npm run verify:chunks` | |
| 7 | extract-image-asset route error paths | `npm run verify:asset-route` | |

Run all at once: `npm run verify`

## Manual Verification (requires Figma Desktop)

### Prerequisites

```bash
# 1. Ensure artifacts are fresh
npm run build:legacy

# 2. Start bridge server (keep running in a separate terminal)
node ./skills/figma/scripts/bridge_server.mjs

# 3. Optional: confirm bridge is healthy
node ./skills/figma/scripts/bridge_client.mjs health
```

### Smoke Checks

| # | Check | Expected outcome |
|---|-------|-----------------|
| 1 | Plugin UI loads | Import `ws_defs/manifest.json`, run plugin → no white screen; status area shows "已就绪" or equivalent ready text |
| 2 | SSE connects | Plugin status changes from "连接中" → "已连接"; `bridge_client.mjs health` shows `pluginConnections > 0` |
| 3 | SSE reconnect button | Click "重新连接 SSE" → status briefly shows "连接中", recovers to "已连接"; health still `pluginConnections > 0` |
| 4 | Node ID button | Select a canvas node, click "获取选中节点 ID" → node ID or Figma URL appears and is copyable |
| 5 | extract-node-defs | `node ./skills/figma/scripts/bridge_client.mjs agent "<figma-node-url>"` → `ok: true`, defs returned, cache populated |
| 6 | extract-image-asset (small) | `node ./skills/figma/scripts/bridge_client.mjs asset "<figma-node-url>" "<hash>"` → `ok: true`, file written to `assets/`, `byteLength` present |
| 7 | oversized image preflight | Same command with an image clearly > 3200×3200 → `ok: false`, `status: 413`, `errorCode: "IMAGE_TOO_LARGE_ESTIMATED"`, `details.pixelCount` and `details.assetMaxPixels` present; plugin UI does not freeze |

**Pass criteria:** checks 1–6 all pass. Check 7 is best-effort (record `not tested` if no oversized image is available, but complete it at next opportunity).

If checks 1–4 fail, do not proceed to Phase 3 — diagnose the runtime issue first.

### Results Record

```
Figma Desktop Smoke Result — (date: YYYY-MM-DD)
- UI load:                          pass / fail
- SSE connect:                      pass / fail
- SSE reconnect button:             pass / fail
- Node ID button:                   pass / fail
- extract-node-defs:                pass / fail
- extract-image-asset small image:  pass / fail
- oversized image preflight:        pass / fail / not tested

Notes
- Figma version:
- Test file:
- Any CLI error/status/errorCode:
- Any UI anomalies:
```

## Migration Summary

### What changed
1. **TS infrastructure**: `package.json`, `tsconfig.json`, `.eslintrc.cjs`, Figma typings
2. **Bridge config consolidation**: Single source `bridge_config.mjs` feeds Node server, Node client, plugin main thread, plugin UI, and `manifest.json`
3. **Server-side split**: `bridge_server.mjs` (546 lines) split into 11 modules (max 120 lines each)
4. **Plugin-side split**: 7 source files (3700+ lines total) split into 40 files across 8 subdirectories (all ≤ 200 lines)
5. **UI TypeScript migration**: Inline JS removed from `ui.html`, 5 typed TS modules compiled via esbuild
6. **Verification pipeline**: `npm run verify` covers typecheck + lint + build + artifact checks + bridge smoke test

### What did NOT change
- Wire protocol between plugin and bridge server
- SSE event types and message format
- Plugin manifest capabilities, permissions, or editor types
- Bridge client CLI interface
- Cache directory structure and format
- Any Python scripts or YAML configs

## Known Limitations
- No automated test for real Figma plugin ↔ bridge SSE flow (requires Figma Desktop)
- No automated test for `extract-node-defs` / `extract-image-asset` end-to-end
- ESLint currently only covers `.ts` files; existing `.js`/`.mjs` files are not linted
- `bridge_client.mjs` internal structure not yet refactored (deferred to future step)

## Remaining Risks
- `ui.html` loads `<script src="./generated/runtime-config.js">` and `<script src="./generated/ui.js">` — Figma Desktop resolves these relative to the plugin directory. If Figma changes how UI HTML is loaded (e.g., string injection instead of file-based iframe), these references would break.
- `allowedDomains: ["none"]` means the plugin only works in development mode. Production deployment would require configuring allowed domains.
- Result chunk transport now enforces single-chunk, cumulative, and count limits (413 rejection). Multi-byte characters use UTF-8 byte-based chunking.
- Asset extraction now performs a dimension-based preflight (`assetMaxPixels`) before `getBytesAsync()`, but peak memory protection remains best-effort: if `getSizeAsync()` is unavailable or fails, or a moderate-dimension image has a very large encoded payload, the plugin can still hit the byte-size failure only after reading bytes.
- Figma Desktop smoke test (7 checks above) not yet executed; results pending. Do not enter Phase 3 until checks 1–6 pass.
