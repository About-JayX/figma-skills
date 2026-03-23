#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { build } from 'esbuild';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, '..');
const UI_ENTRY = path.join(SKILL_ROOT, 'ws_defs', 'ui', 'main.ts');
const GENERATED_DIR = path.join(SKILL_ROOT, 'ws_defs', 'generated');
const UI_OUTFILE = path.join(GENERATED_DIR, 'ui.js');

async function main() {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });

  await build({
    entryPoints: [UI_ENTRY],
    outfile: UI_OUTFILE,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    sourcemap: false,
    minify: false,
    charset: 'utf8',
    logLevel: 'info',
    banner: {
      js: '// AUTO-GENERATED FILE. DO NOT EDIT.\n// Run: npm run build:ws-defs-ui',
    },
  });

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        entry: UI_ENTRY,
        outfile: UI_OUTFILE,
      },
      null,
      2
    ) + '\n'
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
