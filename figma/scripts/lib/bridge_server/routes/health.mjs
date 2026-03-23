import { writeJson } from '../../bridge_http.mjs';

export function handleHealthRequest(state, res) {
  writeJson(res, 200, {
    ok: true,
    startedAt: state.startedAt,
    port: state.port,
    host: state.host,
    hasPluginConnection: state.pluginClients.size > 0,
    pluginConnections: state.pluginClients.size,
    pendingJobs: state.pendingJobs.size,
  });
}
