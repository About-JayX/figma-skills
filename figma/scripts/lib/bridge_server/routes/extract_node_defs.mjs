import { readJsonBody, writeJson, writeSseEvent } from '../../bridge_http.mjs';
import { parseTarget } from '../../bridge_target.mjs';
import {
  createPendingJob,
  getPrimaryPluginClient,
} from '../job_store.mjs';

function errorCodeOf(error, fallback) {
  return error && error.code ? error.code : fallback;
}

function errorMessageOf(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

export async function handleExtractNodeDefsRequest(state, req, res) {
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
  if (!target) {
    writeJson(res, 400, {
      ok: false,
      error: '无法解析输入，请传入 Figma link 或 node id',
      errorCode: 'INVALID_TARGET',
    });
    return;
  }

  // Allow caller to provide fileKey explicitly for bare node-id inputs
  const effectiveFileKey = target.fileKey
    || (body && typeof body.fileKey === 'string' ? body.fileKey : null);

  const { client: pluginClient, ambiguous, mismatch } = getPrimaryPluginClient(state, effectiveFileKey);
  if (mismatch) {
    writeJson(res, 409, {
      ok: false,
      target,
      error: `没有匹配 fileKey "${effectiveFileKey}" 的插件连接。当前连接的 fileKey: ${Array.from(state.pluginClients.values()).map(c => c.fileKey || '(未注册)').join(', ')}`,
      errorCode: 'FILEKEY_MISMATCH',
    });
    return;
  }
  if (ambiguous) {
    writeJson(res, 409, {
      ok: false,
      target,
      error: `多插件场景下无 fileKey，无法确定路由。当前连接的 fileKey: ${Array.from(state.pluginClients.values()).map(c => c.fileKey || '(未注册)').join(', ')}。请传 Figma URL 或 body.fileKey。`,
      errorCode: 'AMBIGUOUS_ROUTING',
    });
    return;
  }
  if (!pluginClient) {
    writeJson(res, 409, {
      ok: false,
      target,
      error: '未检测到活动的 ws_defs 插件连接',
      errorCode: 'NO_PLUGIN_CONNECTION',
    });
    return;
  }

  const job = createPendingJob(state, {
    target,
    clientId: pluginClient.clientId,
  });

  writeSseEvent(pluginClient.res, 'extract-node-defs', {
    jobId: job.jobId,
    target,
  });

  try {
    const result = await job.promise;
    writeJson(res, 200, result);
  } catch (error) {
    writeJson(res, 504, {
      ok: false,
      target,
      jobId: job.jobId,
      error: errorMessageOf(error, 'Bridge 请求失败'),
      errorCode: errorCodeOf(error, 'PLUGIN_TIMEOUT'),
    });
  }
}
