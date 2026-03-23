#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(SKILL_ROOT, 'ws_defs', 'src');
const GENERATED_RUNTIME_FILE = path.join(
  SKILL_ROOT,
  'ws_defs',
  'generated',
  'runtime-config.js'
);
const OUT_FILE = path.join(SKILL_ROOT, 'ws_defs', 'code.js');

const MODULE_PATHS = [
  'generated/runtime-config.js',
  'src/core/00_bootstrap.js',
  'src/core/01_shared_constants.js',
  'src/core/02_summary_and_errors.js',
  'src/core/03_binary_utils.js',
  'src/variables/10_node_value_utils.js',
  'src/variables/11_alias_collection.js',
  'src/variables/12_node_tree.js',
  'src/variables/13_variable_lookup.js',
  'src/variables/14_paint_diagnostics.js',
  'src/variables/15_basic_value_serializers.js',
  'src/variables/16_variable_binding_serializers.js',
  'src/variables/17_paint_predicates.js',
  'src/replay/20_hard_signals.js',
  'src/replay/21_replay_route.js',
  'src/serialize/21_paint_serializers.js',
  'src/serialize/22_effect_and_layout_serializers.js',
  'src/serialize/23_snapshot_collector.js',
  'src/serialize/24_text_segments.js',
  'src/scene/30_node_layout.js',
  'src/scene/31_node_style.js',
  'src/scene/32_vector_info.js',
  'src/scene/33_text_node.js',
  'src/scene/34_component_info.js',
  'src/scene/35_scene_node.js',
  'src/filters/40_enrichment_filters.js',
  'src/transport/50_async_utils.js',
  'src/transport/51_status_reporter.js',
  'src/transport/52_image_assets.js',
  'src/transport/53_snapshot_enrichment.js',
  'src/transport/54_rest_snapshot.js',
  'src/transport/55_design_snapshot.js',
  'src/transport/56_node_extraction.js',
  'src/transport/57_transport_payload.js',
  'src/transport/58_post_job_asset.js',
  'src/transport/59_plugin_error.js',
  'src/runtime/70_node_lookup.js',
  'src/runtime/71_extract_node_defs.js',
  'src/runtime/72_extract_image_asset.js',
  'src/runtime/73_execute_queue.js',
  'src/runtime/74_main.js',
];

const WS_DEFS_DIR = path.join(SKILL_ROOT, 'ws_defs');
const MODULES = MODULE_PATHS.map((relativePath) => ({
  label: relativePath,
  full: path.join(WS_DEFS_DIR, relativePath),
}));

function main() {
  const parts = MODULES.map(({ full }) => {
    if (!fs.existsSync(full)) {
      throw new Error(
        `Missing source module: ${full}. Run node ./skills/figma/scripts/sync_ws_defs_config.mjs first.`
      );
    }
    return fs.readFileSync(full, 'utf8').trimEnd() + '\n';
  });

  const banner = [
    '// AUTO-GENERATED FILE. EDIT ws_defs/src/* AND REBUILD WITH:',
    '// npm run build:legacy',
    '',
  ].join('\n');

  fs.writeFileSync(OUT_FILE, banner + parts.join('\n'));
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        outFile: OUT_FILE,
        modules: MODULES.map((module) => module.label),
      }
    ) + '\n'
  );
}

main();
