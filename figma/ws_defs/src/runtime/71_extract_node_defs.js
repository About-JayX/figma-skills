async function handleExtractNodeDefs(command) {
  const target = command && command.target ? command.target : {};
  const jobId = command && command.jobId ? command.jobId : '';
  const extractionOptions =
    command && command.options && typeof command.options === 'object'
      ? Object.assign({ jobId: jobId }, command.options)
      : { jobId: jobId };
  const reportStage = createJobStatusReporter(jobId, command);

  if (!jobId) {
    throw createPluginError('INVALID_TARGET', '缺少 jobId');
  }

  if (!target || !target.nodeId) {
    throw createPluginError('INVALID_TARGET', '缺少 nodeId');
  }

  var effectiveIncludeInvisible = extractionOptions && typeof extractionOptions.includeInvisibleInstanceChildren === 'boolean'
    ? extractionOptions.includeInvisibleInstanceChildren
    : DEFAULT_EXTRACTION_OPTIONS.includeInvisibleInstanceChildren;
  reportStage.loading('job.start', 'job ' + jobId + ' 启动', {
    nodeId: target && target.nodeId ? target.nodeId : null,
    includeInvisibleInstanceChildren: effectiveIncludeInvisible,
  });

  reportStage.loading('job.resolve-node.start', '定位目标节点中', {
    nodeId: target.nodeId,
  });
  const node = await findNodeByIdWithLazyPageLoading(target.nodeId, extractionOptions);
  if (!node) {
    throw createPluginError(
      'NODE_NOT_FOUND',
      '未找到 nodeId ' + target.nodeId + '，请确认当前打开的是正确的 Figma 文件'
    );
  }

  reportStage.ok('job.resolve-node.done', '目标节点定位完成', {
    nodeId: node.id,
    nodeType: node.type,
    nodeName: node.name || null,
  });

  const extraction = await buildNodeExtraction(node, extractionOptions, reportStage);
  const defs = extraction.defs;
  reportStage.ok('job.extract.done', '提取阶段完成，准备回传', {
    defsTotal: defs && defs.summary ? defs.summary.total : null,
    imageAssets:
      extraction &&
      extraction.diagnostics &&
      extraction.diagnostics.designSnapshot &&
      extraction.diagnostics.designSnapshot.imageAssets
        ? extraction.diagnostics.designSnapshot.imageAssets.resolved
        : null,
  });
  var resolvedFileKey = target.fileKey || null;
  try {
    if (!resolvedFileKey && typeof figma !== 'undefined' && figma.fileKey) {
      resolvedFileKey = figma.fileKey;
    }
  } catch (_) {}
  // Always generate a figmaUrl; use DRAFT placeholder when fileKey is unavailable
  var urlFileKey = resolvedFileKey || 'DRAFT';
  var figmaUrl = target.nodeId
    ? 'https://www.figma.com/design/' + urlFileKey + '/?node-id=' + encodeURIComponent(target.nodeId)
    : null;
  const payload = {
    ok: true,
    jobId: jobId,
    fileKey: resolvedFileKey,
    figmaUrl: figmaUrl,
    nodeId: target.nodeId,
    node: serializeNodeInfo(node),
    defs: defs,
    designSnapshot: extraction.designSnapshot,
    restSnapshot: extraction.restSnapshot,
    diagnostics: extraction.diagnostics,
    extractedAt: new Date().toISOString(),
  };

  await postJobResult(jobId, payload, reportStage);
  reportStage.ok('job.done', 'job ' + jobId + ' 已回传 ' + defs.summary.total + ' 个 defs', {
    defsTotal: defs.summary.total,
  });
  figma.notify('job ' + jobId + ' 已回传 defs', { timeout: 1500 });
}
