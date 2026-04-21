async function handleExtractNodeDefs(command) {
  const target = command && command.target ? command.target : {};
  const jobId = command && command.jobId ? command.jobId : '';
  const extractionOptions =
    command && command.options && typeof command.options === 'object'
      ? Object.assign({ jobId: jobId }, command.options)
      : { jobId: jobId };
  const reportStage = createJobStatusReporter(jobId, command);

  if (!jobId) {
    throw createPluginError('INVALID_TARGET', 'Missing jobId');
  }

  if (!target || !target.nodeId) {
    throw createPluginError('INVALID_TARGET', 'Missing nodeId');
  }

  var effectiveIncludeInvisible = extractionOptions && typeof extractionOptions.includeInvisibleInstanceChildren === 'boolean'
    ? extractionOptions.includeInvisibleInstanceChildren
    : DEFAULT_EXTRACTION_OPTIONS.includeInvisibleInstanceChildren;
  reportStage.loading('job.start', 'job ' + jobId + ' started', {
    nodeId: target && target.nodeId ? target.nodeId : null,
    includeInvisibleInstanceChildren: effectiveIncludeInvisible,
  });

  reportStage.loading('job.resolve-node.start', 'Resolving target node', {
    nodeId: target.nodeId,
  });
  const node = await findNodeByIdWithLazyPageLoading(target.nodeId, extractionOptions);
  if (!node) {
    throw createPluginError(
      'NODE_NOT_FOUND',
      'Could not find nodeId ' + target.nodeId + '. Confirm that the correct Figma file is open.'
    );
  }

  reportStage.ok('job.resolve-node.done', 'Target node resolved', {
    nodeId: node.id,
    nodeType: node.type,
    nodeName: node.name || null,
  });

  const extraction = await buildNodeExtraction(node, extractionOptions, reportStage);
  const defs = extraction.defs;

  // A8 (scoped): export the target node as a PNG baseline for scorecard runs.
  // Runs for frame-like containers only (TEXT/VECTOR already render as-is via
  // their own SVG path). Non-fatal: if exportAsync fails, skip quietly so the
  // main extraction still succeeds.
  const BASELINE_EXPORTABLE_TYPES = {
    FRAME: true,
    SECTION: true,
    COMPONENT: true,
    COMPONENT_SET: true,
    INSTANCE: true,
    GROUP: true,
  };
  if (BASELINE_EXPORTABLE_TYPES[node.type] && typeof node.exportAsync === 'function') {
    try {
      reportStage.loading('baseline.export.start', 'Exporting baseline PNG', {
        nodeId: node.id,
        nodeType: node.type,
      });
      const pngBytes = await node.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: 2 },
        useAbsoluteBounds: true,
      });
      if (pngBytes && pngBytes.length > 0) {
        await postJobAsset(
          jobId,
          {
            imageHash: '_baseline_' + node.id.replace(/[^A-Za-z0-9_-]/g, '-'),
            format: 'png',
            bytes: pngBytes,
            byteLength: pngBytes.length,
            width: Math.round((node.width || 0) * 2),
            height: Math.round((node.height || 0) * 2),
          },
          reportStage
        );
        reportStage.ok('baseline.export.done', 'Baseline PNG uploaded', {
          nodeId: node.id,
          byteLength: pngBytes.length,
        });
      }
    } catch (baselineError) {
      reportStage.ok('baseline.export.skipped', 'Baseline PNG export failed and was skipped', {
        nodeId: node.id,
        error: baselineError && baselineError.message ? baselineError.message : String(baselineError),
      });
    }
  }

  reportStage.ok('job.extract.done', 'Extraction completed; preparing result upload', {
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
  reportStage.ok('job.done', 'job ' + jobId + ' returned ' + defs.summary.total + ' defs', {
    defsTotal: defs.summary.total,
  });
  figma.notify('job ' + jobId + ' returned defs', { timeout: 1500 });
}
