#!/usr/bin/env node
import http from 'http';

import {
  BRIDGE_BIND_HOST,
  BRIDGE_PORT,
} from './lib/bridge_config.mjs';
import { createBridgeServerRequestHandler } from './lib/bridge_server/router.mjs';
import { createBridgeServerState } from './lib/bridge_server/state.mjs';

const HOST = BRIDGE_BIND_HOST;
const PORT = BRIDGE_PORT;

const state = createBridgeServerState({
  host: HOST,
  port: PORT,
  startedAt: new Date().toISOString(),
});

const server = http.createServer(createBridgeServerRequestHandler(state));

server.listen(PORT, HOST, () => {
  process.stdout.write(
    JSON.stringify({
      ok: true,
      startedAt: state.startedAt,
      host: HOST,
      port: PORT,
    }) + '\n'
  );
});
