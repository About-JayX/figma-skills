#!/usr/bin/env node
// Ingest a freshly-extracted Figma cache as a test_corpus sample.
//   1. Copy <source-cache>/ into test_corpus/<label>/cache/
//   2. Extract current SSIM (if scorecard exists) as `baselineSsimFloor.mechanical`
//   3. Write spec.json with label, url, nodeId, floor, and user-provided description
//
// Usage:
//   node skills/figma/scripts/ingest_corpus_sample.mjs \
//     --source-cache skills/figma/cache/<file>/<node> \
//     --label marketing-long-page \
//     [--description "..."]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');
const CORPUS_ROOT = path.join(SKILL_ROOT, 'test_corpus');

function parseArgs(argv) {
  const a = { sourceCache: null, label: null, description: null };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--source-cache') a.sourceCache = argv[++i];
    else if (k === '--label') a.label = argv[++i];
    else if (k === '--description') a.description = argv[++i];
  }
  if (!a.sourceCache || !a.label) {
    console.error('Usage: ingest_corpus_sample.mjs --source-cache <dir> --label <name> [--description <text>]');
    process.exit(2);
  }
  return a;
}

function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('_verify')) continue; // skip runtime verification artifacts
    if (entry.name.startsWith('.')) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function readSsimFloor(sourceCache) {
  const scorePath = path.join(sourceCache, '_verify', 'scorecard.json');
  if (!fs.existsSync(scorePath)) return null;
  try {
    const r = JSON.parse(fs.readFileSync(scorePath, 'utf8'));
    return r?.metrics?.ssim ?? null;
  } catch {
    return null;
  }
}

function extractBridgeMeta(sourceCache) {
  const metaPath = path.join(sourceCache, 'bridge-response.json');
  if (!fs.existsSync(metaPath)) return {};
  try {
    const j = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return {
      figmaUrl: j?.figmaUrl || null,
      nodeId: j?.nodeId || null,
      nodeName: j?.node?.name || null,
      nodeType: j?.node?.type || null,
    };
  } catch {
    return {};
  }
}

function main() {
  const args = parseArgs(process.argv);
  const sourceCache = path.resolve(args.sourceCache);
  if (!fs.existsSync(sourceCache)) {
    console.error(`Source cache not found: ${sourceCache}`);
    process.exit(2);
  }
  const sampleDir = path.join(CORPUS_ROOT, args.label);
  if (fs.existsSync(sampleDir)) {
    console.error(`Sample already exists: ${sampleDir}. Remove it first if you want to overwrite.`);
    process.exit(1);
  }

  const cacheDst = path.join(sampleDir, 'cache');
  console.log(`[ingest] copying cache → ${cacheDst}`);
  copyDirRecursive(sourceCache, cacheDst);

  const ssim = readSsimFloor(sourceCache);
  const meta = extractBridgeMeta(sourceCache);
  const spec = {
    label: args.label,
    description: args.description || '',
    capturedAt: new Date().toISOString().slice(0, 10),
    ...meta,
    baselineSsimFloor: {
      mechanical: ssim != null ? +(ssim - 0.002).toFixed(4) : null,
    },
    knownPatterns: [],
  };
  fs.writeFileSync(path.join(sampleDir, 'spec.json'), JSON.stringify(spec, null, 2) + '\n');

  console.log('[ingest] spec.json written');
  console.log(JSON.stringify(spec, null, 2));
  console.log(`\nnext: describe the sample in spec.json "description" and list patterns in "knownPatterns".`);
  console.log(`commit spec.json only — cache/ is gitignored.`);
}

main();
