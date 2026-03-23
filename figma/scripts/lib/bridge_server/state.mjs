export function createBridgeServerState({ host, port, startedAt }) {
  return {
    host,
    port,
    startedAt,
    pluginClients: new Map(),
    pendingJobs: new Map(),
    pendingChunks: new Map(),
    pendingAssets: new Map(),
  };
}
