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
    throw createPluginError('INVALID_TARGET', 'Missing jobId');
  }

  if (!imageHash) {
    throw createPluginError('INVALID_IMAGE_HASH', 'Missing imageHash');
  }

  reportStage.loading('asset.job.start', 'Image asset job ' + jobId + ' started', {
    imageHash: imageHash,
  });
  const asset = await extractImageAssetByHash(imageHash, extractionOptions, reportStage);
  await postJobAsset(jobId, asset, reportStage);
  reportStage.ok('asset.job.done', 'Image asset job ' + jobId + ' returned', {
    imageHash: imageHash,
    byteLength: asset.byteLength,
    format: asset.format,
  });
}
