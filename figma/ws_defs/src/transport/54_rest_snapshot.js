async function exportRestSnapshot(rootNode, options, reportStage) {
  const mergedOptions = Object.assign({}, DEFAULT_EXTRACTION_OPTIONS, options || {});
  const diagnostics = {
    included: false,
    truncated: false,
    bytes: 0,
    error: null,
  };

  if (reportStage) {
    reportStage.loading('extract.rest.start', 'REST 快照提取中', null);
  }

  if (!rootNode || typeof rootNode.exportAsync !== 'function') {
    diagnostics.error = 'EXPORT_UNSUPPORTED';
    if (reportStage) {
      reportStage.error('extract.rest.unsupported', 'REST 快照不支持', diagnostics);
    }
    return {
      snapshot: null,
      diagnostics: diagnostics,
    };
  }

  try {
    if (rootNode.type === 'PAGE' && typeof rootNode.loadAsync === 'function') {
      await rootNode.loadAsync();
    }

    const snapshot = await withTimeout(
      rootNode.exportAsync({ format: 'JSON_REST_V1' }),
      mergedOptions.restTimeoutMs,
      'JSON_REST_V1'
    );
    diagnostics.included = true;
    var snapshotBytes = estimateJsonBytes(snapshot);
    diagnostics.bytes = snapshotBytes != null ? snapshotBytes : JSON.stringify(snapshot).length;

    if (mergedOptions.restMaxBytes && diagnostics.bytes > mergedOptions.restMaxBytes) {
      diagnostics.truncated = true;
      if (reportStage) {
        reportStage.ok('extract.rest.done', 'REST 快照提取完成', diagnostics);
      }
      return {
        snapshot: {
          truncated: true,
          bytes: diagnostics.bytes,
          reason: 'OVER_LIMIT',
          document: snapshot && snapshot.document && snapshot.document.id ? snapshot.document.id : null,
        },
        diagnostics: diagnostics,
      };
    }

    if (reportStage) {
      reportStage.ok('extract.rest.done', 'REST 快照提取完成', diagnostics);
    }
    return {
      snapshot: snapshot,
      diagnostics: diagnostics,
    };
  } catch (error) {
    diagnostics.error = error instanceof Error ? error.message : String(error);
    if (reportStage) {
      reportStage.error('extract.rest.failed', 'REST 快照提取失败', diagnostics);
    }
    return {
      snapshot: null,
      diagnostics: diagnostics,
    };
  }
}
