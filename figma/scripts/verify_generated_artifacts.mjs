#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, '..');
const WS_DEFS_ROOT = path.join(SKILL_ROOT, 'ws_defs');

const REQUIRED_FILES = [
  'manifest.json',
  'generated/runtime-config.js',
  'generated/ui.js',
  'code.js',
  'ui.html',
];

const errors = [];

function fail(message) {
  errors.push(message);
}

function assertFileExists(relativePath) {
  const full = path.join(WS_DEFS_ROOT, relativePath);
  if (!fs.existsSync(full)) {
    fail(`Missing file: ${relativePath}`);
    return null;
  }
  const content = fs.readFileSync(full, 'utf8');
  if (!content.trim()) {
    fail(`Empty file: ${relativePath}`);
    return null;
  }
  return content;
}

function main() {
  // 1. Check all required files exist and are non-empty
  const fileContents = {};
  for (const file of REQUIRED_FILES) {
    fileContents[file] = assertFileExists(file);
  }

  if (errors.length > 0) {
    reportAndExit();
    return;
  }

  // 2. Check manifest.json devAllowedDomains matches runtime-config origin
  const manifest = JSON.parse(fileContents['manifest.json']);
  const runtimeConfigContent = fileContents['generated/runtime-config.js'];

  const devDomains = manifest?.networkAccess?.devAllowedDomains;
  if (!Array.isArray(devDomains) || devDomains.length === 0) {
    fail('manifest.json: networkAccess.devAllowedDomains is empty or missing');
  }

  const originMatch = runtimeConfigContent.match(/"origin":\s*"([^"]+)"/);
  if (!originMatch) {
    fail('runtime-config.js: cannot find "origin" value');
  }

  if (originMatch && devDomains && devDomains[0] !== originMatch[1]) {
    fail(
      `Origin mismatch: manifest devAllowedDomains[0]="${devDomains[0]}" vs runtime-config origin="${originMatch[1]}"`
    );
  }

  // 3. Check code.js contains BRIDGE_BASE_URL and BRIDGE_EVENTS_URL
  const codeJs = fileContents['code.js'];
  if (!codeJs.includes('BRIDGE_BASE_URL')) {
    fail('code.js: missing BRIDGE_BASE_URL');
  }
  if (!codeJs.includes('BRIDGE_EVENTS_URL')) {
    fail('code.js: missing BRIDGE_EVENTS_URL');
  }

  // 4. Check ui.html only references expected scripts
  const uiHtml = fileContents['ui.html'];
  const scriptSrcPattern = /src="([^"]+)"/g;
  const allowedSources = new Set([
    './generated/runtime-config.js',
    './generated/ui.js',
  ]);
  let scriptMatch;
  while ((scriptMatch = scriptSrcPattern.exec(uiHtml)) !== null) {
    if (!allowedSources.has(scriptMatch[1])) {
      fail(`ui.html: unexpected script src="${scriptMatch[1]}"`);
    }
  }

  // Check no inline script content
  const inlineScriptPattern = /<script>[\s\S]*?<\/script>/gi;
  const inlineScripts = uiHtml.match(inlineScriptPattern);
  if (inlineScripts && inlineScripts.length > 0) {
    fail('ui.html: contains inline <script> content (should only have src= references)');
  }

  reportAndExit();
}

function reportAndExit() {
  if (errors.length === 0) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          checks: REQUIRED_FILES.length + 4,
          message: 'All generated artifact checks passed',
        },
        null,
        2
      ) + '\n'
    );
    return;
  }

  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        errors,
      },
      null,
      2
    ) + '\n'
  );
  process.exitCode = 1;
}

main();
