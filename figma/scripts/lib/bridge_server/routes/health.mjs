import { writeJson } from '../../bridge_http.mjs';

export function handleHealthRequest(state, res) {
  const clients = Array.from(state.pluginClients.values());
  const pluginFileKeys = clients
    .filter((c) => typeof c.fileKey === 'string')
    .map((c) => c.fileKey);
  const uniqueFileKeys = [...new Set(pluginFileKeys)];
  const unregisteredCount = clients.length - pluginFileKeys.length;
  const pluginDocumentNames = clients
    .filter((c) => typeof c.documentName === 'string')
    .map((c) => c.documentName);

  writeJson(res, 200, {
    ok: true,
    startedAt: state.startedAt,
    port: state.port,
    host: state.host,
    hasPluginConnection: state.pluginClients.size > 0,
    pluginConnections: state.pluginClients.size,
    pluginFileKeys: uniqueFileKeys,
    pluginDocumentNames: [...new Set(pluginDocumentNames)],
    unregisteredConnections: unregisteredCount,
    pendingJobs: state.pendingJobs.size,
  });
}
