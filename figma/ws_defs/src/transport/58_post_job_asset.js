async function postJobAsset(jobId, asset, reportStage) {
  if (!asset || !asset.bytes || typeof asset.bytes.length !== 'number') {
    throw createPluginError('IMAGE_BYTES_EMPTY', 'Missing image bytes to upload');
  }

  if (reportStage) {
    reportStage.loading('asset.transport.start', 'Posting image asset back to Bridge', {
      imageHash: asset.imageHash,
      byteLength: asset.byteLength,
      format: asset.format,
    });
  }

  var assetParams = [
    'hash=' + encodeURIComponent(asset.imageHash || ''),
    'format=' + encodeURIComponent(asset.format || 'bin'),
    'w=' + (asset.width == null ? '' : asset.width),
    'h=' + (asset.height == null ? '' : asset.height),
    'len=' + (asset.byteLength == null ? asset.bytes.length : asset.byteLength),
  ].join('&');
  const response = await fetch(
    BRIDGE_BASE_URL + '/jobs/' + encodeURIComponent(jobId) + '/asset?' + assetParams,
    {
      method: 'POST',
      body: asset.bytes,
    }
  );
  const result = await response.json();

  if (reportStage) {
    reportStage.ok('asset.transport.done', 'Image asset upload complete', {
      imageHash: asset.imageHash,
      status: response.status,
      bridgeOk: !!(result && result.ok),
    });
  }

  if (!response.ok || !result.ok) {
    throw new Error(result && result.error ? result.error : 'Bridge image asset upload failed');
  }

  return result;
}
