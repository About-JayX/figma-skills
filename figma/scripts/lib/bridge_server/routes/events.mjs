import crypto from 'crypto';

import { setCorsHeaders, writeSseEvent } from '../../bridge_http.mjs';
import { rejectJobsForClient } from '../job_store.mjs';

const HEARTBEAT_INTERVAL_MS = 15000;

function createDisconnectError() {
  return Object.assign(new Error('The plugin SSE connection was closed'), {
    code: 'PLUGIN_DISCONNECTED',
  });
}

export function handleEventsRequest(state, req, res) {
  const clientId = crypto.randomUUID();
  const connectedAt = new Date().toISOString();

  setCorsHeaders(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, HEARTBEAT_INTERVAL_MS);

  state.pluginClients.set(clientId, {
    clientId,
    connectedAt,
    fileKey: null,
    res,
    heartbeat,
  });

  writeSseEvent(res, 'ready', {
    ok: true,
    clientId,
    connectedAt,
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    state.pluginClients.delete(clientId);
    rejectJobsForClient(state, clientId, createDisconnectError);
  });
}
