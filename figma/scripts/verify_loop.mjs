#!/usr/bin/env node
// Stage 4 — Verify loop (MVP single-shot, no model fix-in-loop yet).
// Given a runnable Vite project + bridge cache, this:
//   1. (optionally) npm install
//   2. Starts vite dev server (random port)
//   3. Headless-Chrome screenshot at 2x DPR
//   4. Runs lint_reproduction.mjs against the output
//   5. Runs fidelity_scorecard.py against the cached baseline
//   6. Emits a unified JSON report + exits
//   7. Tears down the dev server
//
// The model fix-in-loop step (feed worst regions back to Haiku) is a separate enhancement —
// out of scope for MVP. This script produces the data needed to drive that loop later.
//
// Usage:
//   node skills/figma/scripts/verify_loop.mjs \
//     --cache <cache-dir> --project <output-dir> [--install] [--report <report.json>]

import fs from 'fs';
import path from 'path';
import { spawn, spawnSync, execSync } from 'child_process';
import net from 'net';
import { fileURLToPath } from 'url';
import { makePreview } from './lib/preview_image.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    cache: null,
    project: null,
    install: false,
    report: null,
    snapshot: false,   // create pre-run snapshot of src/ for potential revert
    guard: false,      // enable SSIM monotonicity guard (compare vs last run, revert if dropped)
    guardThreshold: 0.005, // drop tolerance
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--cache') args.cache = argv[++i];
    else if (k === '--project') args.project = argv[++i];
    else if (k === '--install') args.install = true;
    else if (k === '--report') args.report = argv[++i];
    else if (k === '--snapshot') args.snapshot = true;
    else if (k === '--guard') args.guard = true;
    else if (k === '--guard-threshold') args.guardThreshold = parseFloat(argv[++i]);
  }
  if (!args.cache || !args.project) {
    console.error('Usage: verify_loop.mjs --cache <cache-dir> --project <project-dir> [--install] [--snapshot] [--guard] [--guard-threshold 0.005] [--report <path>]');
    process.exit(2);
  }
  return args;
}

// ───── SSIM history + snapshot/revert helpers ─────

function readHistory(cacheDir) {
  const p = path.join(cacheDir, '_verify', 'history.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

function appendHistory(cacheDir, entry) {
  const p = path.join(cacheDir, '_verify', 'history.jsonl');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(entry) + '\n');
}

function takeSnapshot(cacheDir, projectDir) {
  // Tar src/ into _verify/snapshots/round-<N>.tar.gz. N = history length + 1.
  const history = readHistory(cacheDir);
  const round = history.length + 1;
  const snapDir = path.join(cacheDir, '_verify', 'snapshots');
  fs.mkdirSync(snapDir, { recursive: true });
  const out = path.join(snapDir, `round-${round}.tar.gz`);
  const src = path.join(projectDir, 'src');
  if (!fs.existsSync(src)) return null;
  const r = spawnSync('tar', ['-czf', out, '-C', projectDir, 'src'], { stdio: 'inherit' });
  return r.status === 0 ? { round, path: out } : null;
}

function restoreSnapshot(snapshotPath, projectDir) {
  if (!snapshotPath || !fs.existsSync(snapshotPath)) return false;
  const src = path.join(projectDir, 'src');
  if (fs.existsSync(src)) fs.rmSync(src, { recursive: true, force: true });
  const r = spawnSync('tar', ['-xzf', snapshotPath, '-C', projectDir], { stdio: 'inherit' });
  return r.status === 0;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(url, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url).catch(() => null);
      if (res && res.status < 500) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function runCmd(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

async function main() {
  const t0 = Date.now();
  const args = parseArgs(process.argv);
  const projectDir = path.resolve(args.project);
  const cacheDir = path.resolve(args.cache);
  const baseline = path.join(cacheDir, 'baseline', 'baseline.png');

  const phases = {};

  // ───── Pre-run snapshot + history read ─────
  const prevHistory = readHistory(cacheDir);
  const prevSsim = prevHistory.length ? prevHistory[prevHistory.length - 1].ssim : null;
  let snapshot = null;
  if (args.snapshot || args.guard) {
    snapshot = takeSnapshot(cacheDir, projectDir);
    if (snapshot) console.log(`[verify] snapshot round-${snapshot.round} saved`);
  }

  // 1. Optional install
  if (args.install) {
    const t = Date.now();
    console.log('[verify] npm install…');
    const r = runCmd('npm', ['install', '--silent', '--no-audit'], { cwd: projectDir, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('[verify] npm install failed');
      process.exit(1);
    }
    phases.install = ((Date.now() - t) / 1000).toFixed(2);
  }

  // 2. Start dev server on a free port
  const port = await freePort();
  console.log(`[verify] starting vite on port ${port}…`);
  const t1 = Date.now();
  const dev = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: projectDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  let devLog = '';
  dev.stdout.on('data', (d) => {
    devLog += d;
  });
  dev.stderr.on('data', (d) => {
    devLog += d;
  });

  const up = await waitFor(`http://localhost:${port}/`, 20000);
  phases.devBoot = ((Date.now() - t1) / 1000).toFixed(2);
  if (!up) {
    dev.kill();
    console.error('[verify] dev server failed to start\n' + devLog.slice(-2000));
    process.exit(1);
  }

  let scoreReport = null;
  let lintReport = null;
  try {
    // 3. Screenshot at 2x DPR — derive viewport from renderReady root box
    const t2 = Date.now();
    const shotDir = path.join(cacheDir, '_verify');
    fs.mkdirSync(shotDir, { recursive: true });
    const shotPath = path.join(shotDir, 'candidate-2x.png');
    let winW = 1280;
    let winH = 5412;
    try {
      const rr = JSON.parse(fs.readFileSync(path.join(cacheDir, 'render-ready.json'), 'utf8'));
      const rootNode = rr.nodes.find((n) => n.id === rr.rootId);
      if (rootNode?.box?.width) winW = Math.ceil(rootNode.box.width);
      if (rootNode?.box?.height) winH = Math.ceil(rootNode.box.height);
    } catch {
      /* fall back to defaults */
    }
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    // Chrome --headless=new produces a screenshot at exactly window-size × DPR
    // with no browser-chrome overhead — request the design's CSS viewport
    // directly so the resulting PNG is already the desired (winW × winH × DPR)
    // and no post-crop is needed. Earlier versions added vertical padding and
    // tried to trim with `sips -c … --cropOffset`, but sips's negative Y offset
    // pads the top with black instead of anchoring the crop at the top, which
    // baked a ~90 px black band into every candidate screenshot and tanked SSIM.
    const chromeRes = runCmd(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        `--screenshot=${shotPath}`,
        `--window-size=${winW},${winH}`,
        '--force-device-scale-factor=2',
        '--hide-scrollbars',
        // 10s matches references/09-verification.md. Google Fonts can take
        // 1–3s to fetch + swap; 5s was too tight and caused intermittent
        // FOUC-like screenshots where text was captured pre-swap, inflating
        // pixel diff. Bumping is cheap (only when verify runs).
        '--virtual-time-budget=10000',
        `http://localhost:${port}/`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    // Emit a ≤1800px preview + sidecar meta for Claude Read. Original is kept
    // at 2x DPR for SSIM/pixel-diff scoring. Preview consumers MUST read the
    // sidecar `.meta.json` to recover the scale before quoting any pixel coord.
    try {
      const prevRes = makePreview(shotPath);
      if (prevRes && !prevRes.skipped) {
        console.log(`[verify] candidate preview: ${prevRes.preview}`);
      }
    } catch (e) {
      console.warn('[verify] candidate preview failed:', e.message);
    }
    phases.screenshot = ((Date.now() - t2) / 1000).toFixed(2);
    phases.viewport = `${winW}x${winH}`;

    // 4. Lint
    const t3 = Date.now();
    const lintPath = path.join(shotDir, 'lint-report.json');
    const lintRes = runCmd(
      process.execPath,
      [
        path.join(__dirname, 'lint_reproduction.mjs'),
        '--bridge',
        path.join(cacheDir, 'bridge-agent-payload.json'),
        '--jsx',
        path.join(projectDir, 'src', 'App.jsx'),
        '--css',
        path.join(projectDir, 'src', 'App.css'),
        '--out',
        lintPath,
        '--format',
        'text',
      ]
    );
    phases.lint = ((Date.now() - t3) / 1000).toFixed(2);
    if (fs.existsSync(lintPath)) lintReport = JSON.parse(fs.readFileSync(lintPath, 'utf8'));

    // 5. Scorecard
    const t4 = Date.now();
    const scoreJson = path.join(shotDir, 'scorecard.json');
    const scoreHeat = path.join(shotDir, 'scorecard-heatmap.png');
    const py = '/usr/bin/python3';
    const scoreRes = runCmd(
      py,
      [
        path.join(__dirname, 'fidelity_scorecard.py'),
        '--baseline',
        baseline,
        '--candidate',
        shotPath,
        '--mode',
        'page',
        '--max-pixels',
        '80000000',
        '--report',
        scoreJson,
        '--heatmap',
        scoreHeat,
      ]
    );
    phases.scorecard = ((Date.now() - t4) / 1000).toFixed(2);
    if (fs.existsSync(scoreJson)) scoreReport = JSON.parse(fs.readFileSync(scoreJson, 'utf8'));
  } finally {
    // 7. Teardown
    try {
      dev.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  const currentSsim = scoreReport?.metrics.ssim ?? null;
  const passed = lintReport?.summary.blocks === 0 && (currentSsim ?? 0) >= 0.95;

  // ───── SSIM monotonicity guard ─────
  let guardAction = null;
  if (args.guard && prevSsim != null && currentSsim != null) {
    const drop = prevSsim - currentSsim;
    if (drop > args.guardThreshold) {
      guardAction = {
        triggered: true,
        prevSsim,
        currentSsim,
        drop: +drop.toFixed(4),
        threshold: args.guardThreshold,
      };
      // Try to restore the previous-round snapshot
      // prevHistory entries record `snapshotPath`; last entry is the "good" state we want to return to
      const prevSnap = prevHistory[prevHistory.length - 1]?.snapshotPath;
      if (prevSnap && restoreSnapshot(prevSnap, projectDir)) {
        guardAction.reverted = true;
        guardAction.restoredFrom = prevSnap;
        console.error(
          `[verify][GUARD] SSIM dropped ${drop.toFixed(4)} (> ${args.guardThreshold}). Reverted to ${path.basename(prevSnap)}.`
        );
      } else {
        guardAction.reverted = false;
        console.error(
          `[verify][GUARD] SSIM dropped ${drop.toFixed(4)} but no prior snapshot to revert to (previous run had --snapshot?).`
        );
      }
    }
  }

  const summary = {
    ok: !!scoreReport,
    passed,
    elapsedSec: +elapsed,
    phases,
    ssim: currentSsim,
    prevSsim,
    pixelDiffRatio: scoreReport?.metrics.pixel_diff_ratio,
    deltaE00: scoreReport?.metrics.delta_e00,
    lint: lintReport?.summary,
    guard: guardAction,
    artifacts: {
      candidate: path.join(cacheDir, '_verify', 'candidate-2x.png'),
      candidatePreview: path.join(cacheDir, '_verify', 'candidate-2x-preview.png'),
      candidatePreviewMeta: path.join(cacheDir, '_verify', 'candidate-2x-preview.meta.json'),
      heatmap: path.join(cacheDir, '_verify', 'scorecard-heatmap.png'),
      scoreReport: path.join(cacheDir, '_verify', 'scorecard.json'),
      lintReport: path.join(cacheDir, '_verify', 'lint-report.json'),
    },
  };

  // Append to history (record this round + its snapshot path so next run can revert here)
  appendHistory(cacheDir, {
    at: new Date().toISOString(),
    ssim: currentSsim,
    pixelDiffRatio: scoreReport?.metrics.pixel_diff_ratio,
    lintBlocks: lintReport?.summary?.blocks ?? null,
    snapshotPath: snapshot?.path ?? null,
    guardAction,
  });

  const reportPath = args.report || path.join(cacheDir, '_verify', 'verify-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  // Exit non-zero on guard revert too — caller (e.g. codegen_pipeline) should not keep iterating
  if (guardAction?.triggered) process.exit(2);
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error('[verify] fatal:', e);
  process.exit(1);
});
