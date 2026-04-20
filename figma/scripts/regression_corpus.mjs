#!/usr/bin/env node
// Run codegen + verify against every sample in test_corpus/.
// Compare resulting SSIM against spec.json's baselineSsimFloor.mechanical.
// Any sample that drops below floor → exit 1 (CI fails).
//
// Usage: node skills/figma/scripts/regression_corpus.mjs [--verbose]

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');
const CORPUS_ROOT = path.join(SKILL_ROOT, 'test_corpus');
const REPO_ROOT = path.resolve(SKILL_ROOT, '..', '..');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'output', '_regression');

const REGRESSION_TOLERANCE = 0.002;

function findSamples() {
  if (!fs.existsSync(CORPUS_ROOT)) return [];
  return fs
    .readdirSync(CORPUS_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((label) => fs.existsSync(path.join(CORPUS_ROOT, label, 'spec.json')));
}

function runOne(label, verbose) {
  const spec = JSON.parse(fs.readFileSync(path.join(CORPUS_ROOT, label, 'spec.json'), 'utf8'));
  const cache = path.join(CORPUS_ROOT, label, 'cache');
  const out = path.join(OUTPUT_ROOT, label);
  const floor = spec?.baselineSsimFloor?.mechanical;

  console.log(`\n── ${label} ──`);
  console.log(`  floor: ${floor ?? '(unset)'}`);

  // codegen
  const codegenRes = spawnSync(
    process.execPath,
    [
      path.join(__dirname, 'codegen_pipeline.mjs'),
      cache,
      out,
      '--project-name',
      `regression-${label}`,
    ],
    { stdio: verbose ? 'inherit' : 'pipe' }
  );
  if (codegenRes.status !== 0) return { label, status: 'codegen_failed' };

  // verify (with install on first run, cache reused across samples if any overlap)
  const verifyRes = spawnSync(
    process.execPath,
    [
      path.join(__dirname, 'verify_loop.mjs'),
      '--cache',
      cache,
      '--project',
      out,
      '--install',
    ],
    { stdio: verbose ? 'inherit' : 'pipe' }
  );

  // read score
  const scorePath = path.join(cache, '_verify', 'scorecard.json');
  if (!fs.existsSync(scorePath)) return { label, status: 'no_scorecard', floor };
  const score = JSON.parse(fs.readFileSync(scorePath, 'utf8'));
  const ssim = score?.metrics?.ssim ?? null;
  if (ssim == null) return { label, status: 'no_ssim', floor };

  const delta = floor != null ? ssim - floor : null;
  const passed = floor == null || delta >= -REGRESSION_TOLERANCE;
  console.log(
    `  ssim: ${ssim.toFixed(4)}  floor: ${floor?.toFixed(4) ?? '-'}  Δ: ${delta?.toFixed(4) ?? '-'}  ${passed ? '✓' : '✗'}`
  );
  return { label, status: passed ? 'pass' : 'regression', ssim, floor, delta };
}

function main() {
  const verbose = process.argv.includes('--verbose');
  const samples = findSamples();
  if (samples.length === 0) {
    console.log('No samples in test_corpus/. Add some with ingest_corpus_sample.mjs.');
    process.exit(0);
  }
  console.log(`Running regression against ${samples.length} sample(s)…`);
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

  const results = [];
  for (const label of samples) {
    results.push(runOne(label, verbose));
  }

  console.log('\n── Summary ──');
  const regressions = results.filter((r) => r.status === 'regression');
  const failures = results.filter((r) => r.status !== 'pass' && r.status !== 'regression');
  for (const r of results) {
    const icon = r.status === 'pass' ? '✓' : r.status === 'regression' ? '✗' : '?';
    console.log(`  ${icon} ${r.label}: ${r.status}${r.ssim != null ? `  ssim=${r.ssim.toFixed(4)}` : ''}`);
  }

  if (regressions.length || failures.length) {
    console.error(`\n${regressions.length} regressions, ${failures.length} other failures`);
    process.exit(1);
  }
  console.log(`\n✓ all ${samples.length} samples pass`);
}

main();
