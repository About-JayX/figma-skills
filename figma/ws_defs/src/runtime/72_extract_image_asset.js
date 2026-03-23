async function handleExtractImageAsset(command) {
  const target = command && command.target ? command.target : {};
  const jobId = command && command.jobId ? command.jobId : '';
  const imageHash =
    command && typeof command.imageHash === 'string' ? command.imageHash.trim() : '';
  const extractionOptions =
    command && command.options && typeof command.options === 'object'
      ? command.options
      : null;
  const reportStage = createJobStatusReporter(jobId, command);

  if (!jobId) {
    throw createPluginError('INVALID_TARGET', '缺少 jobId');
  }

  if (!imageHash) {
    throw createPluginError('INVALID_IMAGE_HASH', '缺少 imageHash');
  }

  reportStage.loading('asset.job.start', '图片资产 job ' + jobId + ' 启动', {
    imageHash: imageHash,
  });
  const asset = await extractImageAssetByHash(imageHash, extractionOptions, reportStage);
  await postJobAsset(jobId, asset, reportStage);
  reportStage.ok('asset.job.done', '图片资产 job ' + jobId + ' 已回传', {
    imageHash: imageHash,
    byteLength: asset.byteLength,
    format: asset.format,
  });
}
