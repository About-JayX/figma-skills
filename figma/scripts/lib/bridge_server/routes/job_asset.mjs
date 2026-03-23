import { ASSET_MAX_BYTES } from '../../bridge_config.mjs';
import { readBinaryBody, writeJson } from '../../bridge_http.mjs';
import { storePendingAsset } from '../asset_store.mjs';
import { getPendingJob } from '../job_store.mjs';

export async function handleJobAssetRequest(state, req, res, jobId) {
  let body;
  try {
    body = await readBinaryBody(req, ASSET_MAX_BYTES);
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : '图片资产读取失败',
      errorCode: error && error.code ? error.code : 'ASSET_READ_FAILED',
    });
    return;
  }

  const url = new URL(req.url || '/', `http://${state.host}:${state.port}`);
  const hash =
    url.searchParams.get('hash') || req.headers['x-figma-image-hash'] || 'unknown';
  const format =
    url.searchParams.get('format') ||
    req.headers['x-figma-image-format'] ||
    'png';

  const assetData = storePendingAsset(state, jobId, {
    hash,
    format,
    bytes: body,
    receivedAt: new Date().toISOString(),
  });

  const job = getPendingJob(state, jobId);
  if (job && typeof job.assetResolve === 'function') {
    job.assetResolve(assetData);
  }

  writeJson(res, 200, {
    ok: true,
    jobId,
    hash,
    size: body.length,
  });
}
