# Review Checklist — Figma Plugin TS Migration

## Automated Verification (`npm run verify`)

| # | Check | Command | Status |
|---|-------|---------|--------|
| 1 | TypeScript type check | `npm run typecheck` | |
| 2 | ESLint (TS files) | `npm run lint` | |
| 3 | Config sync + UI build + legacy bundle | `npm run build:legacy` | |
| 4 | Generated artifacts consistency | `npm run verify:artifacts` | |
| 5 | Bridge server startup + /health + client | `npm run verify:bridge` | |

Run all at once: `npm run verify`

## Manual Verification (requires Figma Desktop)

| # | Check | Steps |
|---|-------|-------|
| 1 | Plugin UI loads | Import `ws_defs/manifest.json` in Figma Desktop, run plugin, confirm no white screen or script errors |
| 2 | SSE reconnect button | Click "重新连接 SSE", confirm bridge status toggles |
| 3 | Node ID button | Select a node, click "获取选中节点 ID", confirm ID appears and is copyable |
| 4 | Plugin connection | With bridge running, confirm `/health` shows `pluginConnections > 0` |
| 5 | extract-node-defs | Run `node scripts/bridge_client.mjs agent <figma-url>`, confirm defs returned |
| 6 | extract-image-asset | If design has images, run `node scripts/bridge_client.mjs asset <figma-url> <hash>` |

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
