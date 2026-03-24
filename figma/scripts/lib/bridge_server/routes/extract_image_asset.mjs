import {
  readJsonBody,
  setCorsHeaders,
  writeJson,
  writeSseEvent,
} from '../../bridge_http.mjs';
import { parseTarget } from '../../bridge_target.mjs';
import {
  attachAssetWaiter,
  createPendingJob,
  getPrimaryPluginClient,
} from '../job_store.mjs';

function errorCodeOf(error, fallback) {
  return error && error.code ? error.code : fallback;
}

function errorMessageOf(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

export async function handleExtractImageAssetRequest(state, req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: '请求体不是合法 JSON',
      errorCode: 'INVALID_JSON',
    });
    return;
  }

  const target = parseTarget(body && body.input);
  const imageHash =
    body && typeof body.imageHash === 'string' ? body.imageHash.trim() : '';

  if (!imageHash) {
    writeJson(res, 400, {
      ok: false,
      error: '缺少 imageHash',
      errorCode: 'INVALID_IMAGE_HASH',
    });
    return;
  }

  const effectiveFileKey = (target && target.fileKey)
    || (body && typeof body.fileKey === 'string' ? body.fileKey : null);
  const { client: pluginClient, ambiguous, mismatch } = getPrimaryPluginClient(state, effectiveFileKey);
  if (mismatch) {
    writeJson(res, 409, {
      ok: false,
      error: `没有匹配 fileKey "${effectiveFileKey}" 的插件连接`,
      errorCode: 'FILEKEY_MISMATCH',
    });
    return;
  }
  if (ambiguous) {
    writeJson(res, 409, {
      ok: false,
      error: '多插件场景下无 fileKey，无法确定路由。请传 Figma URL 或 body.fileKey。',
      errorCode: 'AMBIGUOUS_ROUTING',
    });
    return;
  }
  if (!pluginClient) {
    writeJson(res, 409, {
      ok: false,
      error: '未检测到活动的 ws_defs 插件连接',
      errorCode: 'NO_PLUGIN_CONNECTION',
    });
    return;
  }

  const job = createPendingJob(state, {
    target,
    clientId: pluginClient.clientId,
  });

  const assetPromise = attachAssetWaiter(job);

  writeSseEvent(pluginClient.res, 'extract-image-asset', {
    jobId: job.jobId,
    target: target || {},
    imageHash,
  });

  try {
    const assetData = await Promise.race([
      assetPromise,
      job.promise.then((result) => {
        if (result && result.ok === false) {
          return {
            _pluginError: {
              error: result.error || result.errorCode || 'plugin error',
              errorCode: result.errorCode || 'PLUGIN_ERROR',
              details: result.details || null,
            },
          };
        }
        return null;
      }),
    ]);

    if (assetData && assetData._pluginError) {
      const pluginError = assetData._pluginError;
      const statusCode =
        pluginError.errorCode === 'IMAGE_TOO_LARGE' ||
        pluginError.errorCode === 'IMAGE_TOO_LARGE_ESTIMATED'
          ? 413
          : 502;

      writeJson(res, statusCode, {
        ok: false,
        error: pluginError.error,
        errorCode: pluginError.errorCode,
        details: pluginError.details,
      });
      return;
    }

    if (!assetData || !assetData.bytes) {
      writeJson(res, 404, {
        ok: false,
        error: '未收到图片二进制数据',
        errorCode: 'ASSET_NOT_RECEIVED',
      });
      return;
    }

    setCorsHeaders(res);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Image-Hash', imageHash);
    res.setHeader('X-Image-Format', assetData.format || 'png');
    res.setHeader('Content-Length', assetData.bytes.length);
    res.end(assetData.bytes);

    if (state.pendingJobs.has(job.jobId)) {
      job.resolve({ ok: true, assetDelivered: true });
    }
  } catch (error) {
    writeJson(res, 504, {
      ok: false,
      error: errorMessageOf(error, '图片资产请求失败'),
      errorCode: errorCodeOf(error, 'PLUGIN_TIMEOUT'),
    });
  }
}
