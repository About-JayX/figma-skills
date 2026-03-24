#!/usr/bin/env node
/**
 * Assembles the final self-contained ui.html for the Figma plugin.
 *
 * figma.showUI(__html__) injects the HTML string into an iframe — it does NOT
 * resolve <script src="..."> relative to the plugin directory. This script
 * reads ui.template.html and inlines both generated scripts so the output
 * ui.html works correctly in all Figma Desktop environments.
 *
 * Build order (enforced by build:legacy in package.json):
 *   1. sync:bridge-config   → generates generated/runtime-config.js
 *   2. build:ws-defs-ui     → generates generated/ui.js (esbuild TS bundle)
 *   3. build:ws-defs-ui-html (this script) → produces final ui.html
 *   4. build_ws_defs_bundle → produces code.js (plugin main thread)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, '..');

const WS_DEFS_ROOT = path.join(SKILL_ROOT, 'ws_defs');
const TEMPLATE_FILE = path.join(WS_DEFS_ROOT, 'ui.template.html');
const RUNTIME_CONFIG_FILE = path.join(WS_DEFS_ROOT, 'generated', 'runtime-config.js');
const UI_BUNDLE_FILE = path.join(WS_DEFS_ROOT, 'generated', 'ui.js');
const UI_HTML_FILE = path.join(WS_DEFS_ROOT, 'ui.html');

/**
 * Escape inline script content so the <script> tag cannot be prematurely
 * terminated by a literal </script> or <!-- inside the bundle.
 */
function escapeInlineScript(text) {
  return String(text)
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--');
}

function inlineScript(text) {
  return `<script>\n${escapeInlineScript(text).trimEnd()}\n</script>`;
}

function main() {
  if (!fs.existsSync(TEMPLATE_FILE)) {
    throw new Error(`Template not found: ${TEMPLATE_FILE}`);
  }
  if (!fs.existsSync(RUNTIME_CONFIG_FILE)) {
    throw new Error(
      `runtime-config.js not found: ${RUNTIME_CONFIG_FILE}\nRun npm run sync:bridge-config first.`
    );
  }
  if (!fs.existsSync(UI_BUNDLE_FILE)) {
    throw new Error(
      `ui.js bundle not found: ${UI_BUNDLE_FILE}\nRun npm run build:ws-defs-ui first.`
    );
  }

  const template = fs.readFileSync(TEMPLATE_FILE, 'utf8');
  const runtimeConfig = fs.readFileSync(RUNTIME_CONFIG_FILE, 'utf8');
  const uiBundle = fs.readFileSync(UI_BUNDLE_FILE, 'utf8');

  if (!template.includes('<!-- WS_DEFS_RUNTIME_CONFIG_SCRIPT -->')) {
    throw new Error('Template missing placeholder: WS_DEFS_RUNTIME_CONFIG_SCRIPT');
  }
  if (!template.includes('<!-- WS_DEFS_UI_BUNDLE_SCRIPT -->')) {
    throw new Error('Template missing placeholder: WS_DEFS_UI_BUNDLE_SCRIPT');
  }

  const html = template
    .replace('<!-- WS_DEFS_RUNTIME_CONFIG_SCRIPT -->', inlineScript(runtimeConfig))
    .replace('<!-- WS_DEFS_UI_BUNDLE_SCRIPT -->', inlineScript(uiBundle));

  fs.writeFileSync(UI_HTML_FILE, html);

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        template: TEMPLATE_FILE,
        runtimeConfig: RUNTIME_CONFIG_FILE,
        uiBundle: UI_BUNDLE_FILE,
        output: UI_HTML_FILE,
        outputBytes: Buffer.byteLength(html),
      },
      null,
      2
    ) + '\n'
  );
}

main();
