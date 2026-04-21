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
      error: 'Request body is not valid JSON',
      errorCode: 'INVALID_JSON',
    });
    return;
  }

  const target = parseTarget(body && body.input);
  if (!target) {
    writeJson(res, 400, {
      ok: false,
      error: 'Could not parse the input. Pass a Figma URL or node id',
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
      error: `No plugin connection matches fileKey "${effectiveFileKey}". Current fileKeys: ${Array.from(state.pluginClients.values()).map(c => c.fileKey || '(unregistered)').join(', ')}`,
      errorCode: 'FILEKEY_MISMATCH',
    });
    return;
  }
  if (ambiguous) {
    writeJson(res, 409, {
      ok: false,
      target,
      error: `Routing is ambiguous in a multi-plugin session without a fileKey. Current fileKeys: ${Array.from(state.pluginClients.values()).map(c => c.fileKey || '(unregistered)').join(', ')}. Pass a Figma URL or body.fileKey.`,
      errorCode: 'AMBIGUOUS_ROUTING',
    });
    return;
  }
  if (!pluginClient) {
    writeJson(res, 409, {
      ok: false,
      target,
      error: 'No active ws_defs plugin connection was detected',
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
      error: errorMessageOf(error, 'Bridge request failed'),
      errorCode: errorCodeOf(error, 'PLUGIN_TIMEOUT'),
    });
  }
}
