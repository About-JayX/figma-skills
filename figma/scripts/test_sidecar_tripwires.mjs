#!/usr/bin/env node
// Tripwire tests for sidecar-externalized fields (MCP-inspired progressive
// disclosure). If any downstream consumer re-introduces a read of an
// externalized field, this test fails — fail fast in CI before a silent
// accuracy regression.
//
// Guarded fields:
//   - `vector.fillGeometry` / `vector.vectorPaths` / `vector.vectorNetwork`
//     (moved to `blobs/geom-<id>.json` under cache dirs — see
//     `lib/sidecar_externalize.mjs:externalizeVectorGeometry`)
//   - `variables.inferred` (moved to `variables-inferred.json` — see
//     `externalizeInferredVariables`)
//
// The cached `bridge-agent-payload.json` and `render-ready.json` keep every
// field a CURRENT consumer reads (`variables.bound`, `vector.svgRef`, etc),
// so removal of inferred/geometry is lossless for the active pipeline.
//
// Usage: node skills/figma/scripts/test_sidecar_tripwires.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPTS_DIR = __dirname;

// Tripwires flag ACTUAL property access — matches `\.vector\.fillGeometry`
// patterns, i.e. something like `node.vector.fillGeometry` or
// `this.vector.fillGeometry`. String literals (e.g. console.log messages
// mentioning the field name) are NOT matched because they lack the leading
// property-access dot. `figma_pipeline.mjs` is allowlisted for `variables.inferred`
// because it invokes the externalizer and logs about the operation.
const BANNED_PATTERNS = [
  { regex: /\.vector\.fillGeometry\b/,  allowlist: ['lib/sidecar_externalize.mjs'], hint: 'blobs/geom-<id>.json via vector.geomRef' },
  { regex: /\.vector\.vectorPaths\b/,   allowlist: ['lib/sidecar_externalize.mjs'], hint: 'blobs/geom-<id>.json via vector.geomRef' },
  { regex: /\.vector\.vectorNetwork\b/, allowlist: ['lib/sidecar_externalize.mjs'], hint: 'blobs/geom-<id>.json via vector.geomRef' },
  { regex: /\.variables\.inferred\b/,   allowlist: ['lib/sidecar_externalize.mjs', 'figma_pipeline.mjs'], hint: 'variables-inferred.json (sidecar)' },
];

function walkScripts(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkScripts(p));
    } else if (entry.isFile() && (entry.name.endsWith('.mjs') || entry.name.endsWith('.js'))) {
      // Skip test files and node_modules
      if (entry.name.startsWith('test_') || p.includes('/node_modules/')) continue;
      out.push(p);
    }
  }
  return out;
}

function main() {
  const files = walkScripts(SCRIPTS_DIR);
  const violations = [];
  for (const file of files) {
    const rel = path.relative(SCRIPTS_DIR, file);
    if (BANNED_PATTERNS.some((p) => p.allowlist.includes(rel))) {
      // This file is the externalizer itself; skip entirely.
      continue;
    }
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (const { regex, allowlist, hint } of BANNED_PATTERNS) {
      if (allowlist.includes(rel)) continue;
      for (let i = 0; i < lines.length; i += 1) {
        if (regex.test(lines[i])) {
          violations.push({ file: rel, line: i + 1, text: lines[i].trim(), hint });
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log(`[tripwire] OK — ${files.length} files scanned, no externalized field re-introduced`);
    process.exit(0);
  }
  console.error(`[tripwire] FAIL — ${violations.length} violation(s):`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error(`    → field now lives in ${v.hint}`);
  }
  console.error('\nIf you actually need this field in a consumer, load the sidecar file explicitly instead of expecting it inline on the node.');
  process.exit(1);
}

main();
