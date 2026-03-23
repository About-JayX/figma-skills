#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

import {
  SKILL_ROOT,
  getBridgeRuntimeConfig,
  getWsDefsManifestNetworkAccess,
} from './lib/bridge_config.mjs';

const WS_DEFS_ROOT = path.join(SKILL_ROOT, 'ws_defs');
const GENERATED_DIR = path.join(WS_DEFS_ROOT, 'generated');
const MANIFEST_TEMPLATE_FILE = path.join(WS_DEFS_ROOT, 'manifest.template.json');
const MANIFEST_FILE = path.join(WS_DEFS_ROOT, 'manifest.json');
const RUNTIME_CONFIG_FILE = path.join(GENERATED_DIR, 'runtime-config.js');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function indentBlock(text, spaces = 2) {
  const prefix = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function buildRuntimeConfigSource(runtimeConfig) {
  const serialized = indentBlock(JSON.stringify(runtimeConfig, null, 2), 4);

  return [
    '// AUTO-GENERATED FILE. DO NOT EDIT.',
    '// Run: node ./skills/figma/scripts/sync_ws_defs_config.mjs',
    '(function initWsDefsConfig(globalObject) {',
    '  var config = Object.freeze(',
    serialized,
    '  );',
    '  globalObject.__WS_DEFS_CONFIG__ = config;',
    '  globalObject.WS_DEFS_CONFIG = config;',
    '  globalObject.BRIDGE_BASE_URL = config.origin;',
    '  globalObject.BRIDGE_EVENTS_URL = config.eventsUrl;',
    "})(typeof globalThis !== 'undefined' ? globalThis : window);",
    '',
    'var WS_DEFS_CONFIG = globalThis.__WS_DEFS_CONFIG__;',
    'var BRIDGE_BASE_URL = globalThis.BRIDGE_BASE_URL;',
    'var BRIDGE_EVENTS_URL = globalThis.BRIDGE_EVENTS_URL;',
    '',
  ].join('\n');
}

function syncManifest() {
  const manifest = readJson(MANIFEST_TEMPLATE_FILE);
  manifest.networkAccess = getWsDefsManifestNetworkAccess();
  writeJson(MANIFEST_FILE, manifest);
  return manifest;
}

function syncRuntimeConfig() {
  const runtimeConfig = getBridgeRuntimeConfig();
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  fs.writeFileSync(RUNTIME_CONFIG_FILE, buildRuntimeConfigSource(runtimeConfig));
  return runtimeConfig;
}

function main() {
  const manifest = syncManifest();
  const runtimeConfig = syncRuntimeConfig();

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        manifestFile: MANIFEST_FILE,
        runtimeConfigFile: RUNTIME_CONFIG_FILE,
        bridgeOrigin: runtimeConfig.origin,
        devAllowedDomains: manifest.networkAccess.devAllowedDomains,
      },
      null,
      2
    ) + '\n'
  );
}

main();
