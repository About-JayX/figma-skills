/**
 * preview_image.mjs
 *
 * Generate a size-capped PNG preview alongside a full-resolution image so it
 * can be Read by Claude without tripping the 2000px many-image limit. The
 * original file is left untouched (SSIM/pixel-diff scoring depends on it).
 *
 * A sidecar `<basename>-preview.meta.json` records the scale ratio so any
 * coordinate or measurement taken from the preview can be mapped back to the
 * original. Consumers that inspect the preview MUST read this meta before
 * quoting pixel values.
 *
 * Shape of the meta file:
 *   {
 *     "original": { "width": 2880, "height": 1572, "path": "..." },
 *     "preview":  { "width": 1800, "height":  982, "path": "..." },
 *     "scale":    0.625,               // preview / original
 *     "maxDim":   1800,
 *     "createdAt": "2026-04-20T..."
 *   }
 *
 * To map a preview (px, py) back to original: (px / scale, py / scale).
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const DEFAULT_MAX_DIM = 1800;

function getImageDims(filePath) {
  const res = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  const w = /pixelWidth:\s*(\d+)/.exec(res.stdout)?.[1];
  const h = /pixelHeight:\s*(\d+)/.exec(res.stdout)?.[1];
  if (!w || !h) return null;
  return { width: Number(w), height: Number(h) };
}

function previewPathsFor(originalPath) {
  const dir = path.dirname(originalPath);
  const ext = path.extname(originalPath);
  const base = path.basename(originalPath, ext);
  return {
    preview: path.join(dir, `${base}-preview${ext}`),
    meta: path.join(dir, `${base}-preview.meta.json`),
  };
}

/**
 * Produce a size-capped preview + sidecar meta for `originalPath`.
 * Returns { preview, meta, skipped } where skipped=true means the original
 * was already within maxDim and no resize was needed (preview === original).
 */
export function makePreview(originalPath, { maxDim = DEFAULT_MAX_DIM } = {}) {
  if (!fs.existsSync(originalPath)) return null;

  const dims = getImageDims(originalPath);
  if (!dims) return null;

  const { preview: previewPath, meta: metaPath } = previewPathsFor(originalPath);
  const longest = Math.max(dims.width, dims.height);

  if (longest <= maxDim) {
    const meta = {
      original: { width: dims.width, height: dims.height, path: originalPath },
      preview: { width: dims.width, height: dims.height, path: originalPath },
      scale: 1,
      maxDim,
      skipped: true,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    return { preview: originalPath, meta: metaPath, skipped: true };
  }

  const res = spawnSync('sips', ['-Z', String(maxDim), originalPath, '--out', previewPath], { encoding: 'utf8' });
  if (res.status !== 0) {
    return null;
  }

  const previewDims = getImageDims(previewPath) || { width: 0, height: 0 };
  const scale = previewDims.width / dims.width;

  const meta = {
    original: { width: dims.width, height: dims.height, path: originalPath },
    preview: { width: previewDims.width, height: previewDims.height, path: previewPath },
    scale,
    maxDim,
    skipped: false,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  return { preview: previewPath, meta: metaPath, skipped: false };
}
