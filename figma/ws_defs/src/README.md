# ws_defs Source Layout

Commands below assume the current working directory is the `skills/figma/` root.

Edit files in this directory when changing the Figma plugin runtime. After editing plugin source, rebuild the bundled plugin code:

```bash
node ./scripts/build_ws_defs_bundle.mjs
```

This regenerates:

- `ws_defs/code.js`

from the ordered source modules below.

## Module Groups

1. `00_bootstrap_and_core.js`
   Core bootstrap, constants, helpers, and low-level serialization utilities.
2. `10_variables_and_primitives.js`
   Variable collection, paint diagnostics, and primitive serializers.
3. `20_routing_and_text.js`
   Replay routing, hard-signal classification, paint/effect serialization, collectors, and text serialization.
4. `30_scene_snapshot.js`
   Scene-node serialization, including layout, style, vector, component, and tree walking.
5. `35_enrichment_filters.js`
   CSS/SVG filtering logic, node indexing, and resource-list construction.
6. `40_extraction_transport.js`
   Concurrency control, enrichment, REST snapshot export, and transport.
7. `50_job_runtime.js`
   Job execution, node lookup, queue handling, and main runtime flow.

## Practical Rule

If you change the plugin runtime under `ws_defs/src/`, rebuilding `ws_defs/code.js` is not optional. Do not treat the source edits as complete until the bundle has been regenerated.
