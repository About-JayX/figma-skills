import { readJsonBody, setCorsHeaders, writeJson } from '../bridge_http.mjs';
import { handleEventsRequest } from './routes/events.mjs';
import { handleExtractImageAssetRequest } from './routes/extract_image_asset.mjs';
import { handleExtractNodeDefsRequest } from './routes/extract_node_defs.mjs';
import { handleHealthRequest } from './routes/health.mjs';
import { handleJobAssetRequest } from './routes/job_asset.mjs';
import { handleJobResultRequest } from './routes/job_result.mjs';

export function createBridgeServerRequestHandler(state) {
  return async function handleBridgeRequest(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${state.host}:${state.port}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      handleHealthRequest(state, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      handleEventsRequest(state, req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/register') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        writeJson(res, 400, { ok: false, error: 'Invalid JSON', errorCode: 'INVALID_JSON' });
        return;
      }
      const clientId = body && typeof body.clientId === 'string' ? body.clientId : '';
      const fileKey = body && typeof body.fileKey === 'string' ? body.fileKey : null;
      const client = state.pluginClients.get(clientId);
      if (!client) {
        writeJson(res, 404, { ok: false, error: '未找到该 clientId', errorCode: 'CLIENT_NOT_FOUND' });
        return;
      }
      client.fileKey = fileKey || null;
      writeJson(res, 200, { ok: true, clientId, fileKey: client.fileKey });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/extract-node-defs') {
      await handleExtractNodeDefsRequest(state, req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/extract-image-asset') {
      await handleExtractImageAssetRequest(state, req, res);
      return;
    }

    const jobResultMatch = url.pathname.match(/^\/jobs\/([^/]+)\/result$/);
    if (req.method === 'POST' && jobResultMatch) {
      await handleJobResultRequest(
        state,
        req,
        res,
        decodeURIComponent(jobResultMatch[1])
      );
      return;
    }

    const assetMatch = url.pathname.match(/^\/jobs\/([^/]+)\/asset$/);
    if ((req.method === 'PUT' || req.method === 'POST') && assetMatch) {
      await handleJobAssetRequest(
        state,
        req,
        res,
        decodeURIComponent(assetMatch[1])
      );
      return;
    }

    writeJson(res, 404, {
      ok: false,
      error: 'Not Found',
    });
  };
}
