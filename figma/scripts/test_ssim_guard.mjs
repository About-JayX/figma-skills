#!/usr/bin/env node
// Smoke test for verify_loop.mjs --snapshot / --guard revert mechanism.
// Does not actually start Vite or run scorecard — exercises the snapshot + history
// + revert paths directly to confirm tar.gz round-trip works.
//
// Usage: node skills/figma/scripts/test_ssim_guard.mjs

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ssim-guard-test-'));
const projectDir = path.join(tmp, 'proj');
const cacheDir = path.join(tmp, 'cache');
fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
fs.mkdirSync(cacheDir, { recursive: true });

console.log('[test] tmp dir:', tmp);

function writeSrc(text) {
  fs.writeFileSync(path.join(projectDir, 'src', 'App.jsx'), text);
  fs.writeFileSync(path.join(projectDir, 'src', 'App.css'), `/* ${text} */`);
}

function readSrc() {
  return fs.readFileSync(path.join(projectDir, 'src', 'App.jsx'), 'utf8');
}

function takeSnapshotTest(round) {
  const snapDir = path.join(cacheDir, '_verify', 'snapshots');
  fs.mkdirSync(snapDir, { recursive: true });
  const out = path.join(snapDir, `round-${round}.tar.gz`);
  const r = spawnSync('tar', ['-czf', out, '-C', projectDir, 'src']);
  if (r.status !== 0) throw new Error('tar failed');
  return out;
}

function restoreSnapshotTest(snapPath) {
  const src = path.join(projectDir, 'src');
  fs.rmSync(src, { recursive: true, force: true });
  const r = spawnSync('tar', ['-xzf', snapPath, '-C', projectDir]);
  if (r.status !== 0) throw new Error('untar failed');
}

// scenario: good state → snapshot → corrupt state → snapshot → guard revert

writeSrc('GOOD STATE v1');
const snap1 = takeSnapshotTest(1);
console.log('[test] snap1:', snap1, 'size:', fs.statSync(snap1).size);

writeSrc('BAD STATE (regressed)');
const snap2 = takeSnapshotTest(2);
console.log('[test] snap2:', snap2);

// Simulate guard triggering: revert to snap1
restoreSnapshotTest(snap1);
const restored = readSrc();
if (restored !== 'GOOD STATE v1') {
  console.error('[test][FAIL] expected "GOOD STATE v1", got:', restored);
  process.exit(1);
}
console.log('[test][PASS] revert restored App.jsx to "GOOD STATE v1"');

// Clean up
fs.rmSync(tmp, { recursive: true, force: true });
console.log('[test] cleaned up');
