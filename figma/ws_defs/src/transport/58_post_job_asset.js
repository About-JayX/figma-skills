async function postJobAsset(jobId, asset, reportStage) {
  if (!asset || !asset.bytes || typeof asset.bytes.length !== 'number') {
    throw createPluginError('IMAGE_BYTES_EMPTY', '缺少可回传的图片字节');
  }

  if (reportStage) {
    reportStage.loading('asset.transport.start', '图片资产回传 bridge 中', {
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
    reportStage.ok('asset.transport.done', '图片资产回传完成', {
      imageHash: asset.imageHash,
      status: response.status,
      bridgeOk: !!(result && result.ok),
    });
  }

  if (!response.ok || !result.ok) {
    throw new Error(result && result.error ? result.error : 'Bridge 图片资产回传失败');
  }

  return result;
}
