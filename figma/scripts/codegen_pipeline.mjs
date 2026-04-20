#!/usr/bin/env node
// Stage 3 — Codegen pipeline (MVP without model refactor).
// Takes a bridge cache dir and produces a runnable React project:
//   1. render_ready preprocessing (if render-ready.json stale)
//   2. emit_jsx + emit_css (mechanical)
//   3. Copy assets + svg blobs
//   4. Scaffold Vite shell (index.html, main.jsx, vite.config.js, package.json)
//
// The model-refactor step is a separate optional stage invoked by the Claude Code agent,
// because driving a headless model inference from here would require the Anthropic SDK + an
// API key, which is out of scope for this pipeline-runner script.
//
// Usage:
//   node skills/figma/scripts/codegen_pipeline.mjs <cache-dir> <output-dir> [--project-name <name>]

import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function runNode(script, args) {
  const res = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    stdio: 'inherit',
  });
  if (res.status !== 0) throw new Error(`${script} exited ${res.status}`);
}

function parseArgs(argv) {
  const args = { cache: argv[2], out: argv[3], projectName: null };
  for (let i = 4; i < argv.length; i++) {
    if (argv[i] === '--project-name') args.projectName = argv[++i];
  }
  if (!args.cache || !args.out) {
    console.error('Usage: codegen_pipeline.mjs <cache-dir> <output-dir> [--project-name <name>]');
    process.exit(2);
  }
  return args;
}

function ensureRenderReady(cache) {
  const rrPath = path.join(cache, 'render-ready.json');
  const payloadPath = path.join(cache, 'bridge-agent-payload.json');
  const needs =
    !fs.existsSync(rrPath) ||
    (fs.existsSync(payloadPath) && fs.statSync(payloadPath).mtimeMs > fs.statSync(rrPath).mtimeMs);
  if (needs) {
    console.log('[1/4] render-ready preprocessing…');
    runNode('render_ready.mjs', [cache]);
  } else {
    console.log('[1/4] render-ready up-to-date, skipped');
  }
}

function emit(cache, outSrc) {
  const rr = path.join(cache, 'render-ready.json');
  console.log('[2/4] emit mechanical JSX + CSS…');
  runNode('emit_jsx.mjs', [rr, path.join(outSrc, 'App.jsx')]);
  runNode('emit_css.mjs', [rr, path.join(outSrc, 'App.css')]);
}

// VIDEO-fill placeholders: Figma exports no video frame; we crop the corresponding
// region from baseline.png and use that as a static placeholder. Pure best-effort —
// writes a PNG per video node into src/assets and patches renderReady's image.path.
function cropVideoPlaceholders(cache, outSrc) {
  const rrPath = path.join(cache, 'render-ready.json');
  const baselinePath = path.join(cache, 'baseline', 'baseline.png');
  if (!fs.existsSync(rrPath) || !fs.existsSync(baselinePath)) return 0;
  const rr = JSON.parse(fs.readFileSync(rrPath, 'utf8'));
  const videos = rr.nodes.filter((n) => n.image?.kind === 'video');
  if (videos.length === 0) return 0;
  const root = rr.nodes.find((n) => n.id === rr.rootId);
  if (!root) return 0;
  const rootAbsX = root.box?.absX ?? 0;
  const rootAbsY = root.box?.absY ?? 0;
  const assetsDir = path.join(outSrc, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  // Use python+PIL — cheap, no extra JS deps.
  const script = `
import sys, json
from PIL import Image
base = Image.open(${JSON.stringify(baselinePath)})
videos = ${JSON.stringify(
    videos.map((n) => ({
      id: n.id,
      dx: (n.box.absX ?? 0) - rootAbsX,
      dy: (n.box.absY ?? 0) - rootAbsY,
      w: n.box.width,
      h: n.box.height,
    }))
  )}
for v in videos:
    x0, y0 = int(v['dx']*2), int(v['dy']*2)
    x1, y1 = int((v['dx']+v['w'])*2), int((v['dy']+v['h'])*2)
    out = f'${assetsDir}/videoframe_' + v['id'].replace(':','-').replace(';','-') + '.png'
    base.crop((x0, y0, x1, y1)).save(out)
    print(v['id'], out)
`;
  const res = spawnSync('/usr/bin/python3', ['-c', script], { encoding: 'utf8' });
  if (res.status !== 0) {
    console.warn('[codegen] video placeholder crop failed:', res.stderr);
    return 0;
  }
  // Patch renderReady image paths for video nodes
  for (const v of videos) {
    const outName = `videoframe_${v.id.replace(/:/g, '-').replace(/;/g, '-')}.png`;
    v.image.path = `./assets/${outName}`;
    v.image.fallbackColor = null;
  }
  fs.writeFileSync(rrPath, JSON.stringify(rr, null, 2));
  console.log(`[codegen] ${videos.length} video placeholders cropped from baseline`);
  return videos.length;
}

function copyAssets(cache, outSrc, outRoot) {
  console.log('[3/4] copy assets + svgs…');
  // Images go to src/assets (imported via ES modules, bundled by Vite).
  // SVG blobs go to public/svg so they're served at /svg/* (referenced via <img src="/svg/...">
  // with absolute paths — cleaner than 233 ES imports).
  const publicSvg = path.join(outRoot, 'public', 'svg');
  const pairs = [
    [path.join(cache, 'assets'), path.join(outSrc, 'assets')],
    [path.join(cache, 'blobs'), publicSvg],
  ];
  for (const [src, dst] of pairs) {
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      if (f.startsWith('_')) continue; // skip _baseline etc
      fs.copyFileSync(path.join(src, f), path.join(dst, f));
    }
  }
}

function scaffoldVite(out, projectName) {
  console.log('[4/4] scaffold Vite shell…');
  const name = projectName || `gen-${path.basename(out)}`;
  fs.writeFileSync(
    path.join(out, 'package.json'),
    JSON.stringify(
      {
        name,
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
        devDependencies: {
          '@vitejs/plugin-react': '^4.3.4',
          vite: '^5.4.10',
        },
      },
      null,
      2
    ) + '\n'
  );
  fs.writeFileSync(
    path.join(out, 'vite.config.js'),
    `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: false, open: false },
});
`
  );
  fs.writeFileSync(
    path.join(out, 'index.html'),
    `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`
  );
  fs.writeFileSync(
    path.join(out, 'src', 'main.jsx'),
    `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`
  );
}

function main() {
  const t0 = Date.now();
  const args = parseArgs(process.argv);
  const outSrc = path.join(args.out, 'src');
  fs.mkdirSync(outSrc, { recursive: true });

  ensureRenderReady(args.cache);
  cropVideoPlaceholders(args.cache, outSrc);
  emit(args.cache, outSrc);
  copyAssets(args.cache, outSrc, args.out);
  scaffoldVite(args.out, args.projectName);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(
    JSON.stringify(
      {
        ok: true,
        elapsedSec: +elapsed,
        out: args.out,
        entry: path.join(outSrc, 'App.jsx'),
      },
      null,
      2
    )
  );
}

main();
