export function storePendingAsset(state, jobId, assetData) {
  if (!state.pendingAssets.has(jobId)) {
    state.pendingAssets.set(jobId, []);
  }

  state.pendingAssets.get(jobId).push(assetData);
  return assetData;
}
