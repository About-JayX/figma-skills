async function enrichDesignSnapshotAsync(rootNode, designSnapshot, subtreeNodes, options, reportStage) {
  const mergedOptions = Object.assign({}, DEFAULT_EXTRACTION_OPTIONS, options || {});
  const serializedById = buildSerializedNodeIndex(designSnapshot.root, {});
  const diagnostics = {
    css: {
      requested: 0,
      attached: 0,
      errors: 0,
    },
    svg: {
      requested: 0,
      attached: 0,
      errors: 0,
    },
    imageAssets: {
      requested: 0,
      resolved: 0,
      errors: 0,
    },
  };

  if (reportStage) {
    reportStage.loading('extract.css.start', 'Extracting CSS', {
      nodes: subtreeNodes.length,
    });
  }

  const cssLimit = createLimiter(mergedOptions.cssConcurrency);
  await Promise.all(
    subtreeNodes.map((node) =>
      cssLimit(async () => {
        if (!shouldCollectCssForNode(node)) {
          return;
        }

        const serializedNode = serializedById[node.id];
        if (!serializedNode) {
          return;
        }

        diagnostics.css.requested += 1;
        try {
          const css = await withTimeout(node.getCSSAsync(), mergedOptions.cssTimeoutMs, 'getCSSAsync');
          if (css && typeof css === 'object' && Object.keys(css).length > 0) {
            serializedNode.css = css;
            diagnostics.css.attached += 1;
          }
        } catch (error) {
          diagnostics.css.errors += 1;
        }
      })
    )
  );

  if (reportStage) {
    reportStage.ok('extract.css.done', 'CSS extraction complete', diagnostics.css);
    reportStage.loading('extract.svg.start', 'Extracting SVG fallback data', {
      nodes: subtreeNodes.length,
    });
  }

  const svgLimit = createLimiter(mergedOptions.svgConcurrency);
  await Promise.all(
    subtreeNodes.map((node) =>
      svgLimit(async () => {
        if (!shouldExportSvgForNode(node)) {
          return;
        }

        const serializedNode = serializedById[node.id];
        if (!serializedNode) {
          return;
        }

        diagnostics.svg.requested += 1;
        try {
          const svgString = await withTimeout(
            node.exportAsync({
              format: 'SVG_STRING',
              svgOutlineText: true,
              svgSimplifyStroke: false,
              useAbsoluteBounds: true,
              colorProfile: 'DOCUMENT',
            }),
            mergedOptions.svgTimeoutMs,
            'SVG_STRING'
          );
          if (typeof svgString === 'string' && svgString.trim()) {
            if (mergedOptions.uploadSvgBlobs !== false && mergedOptions.jobId) {
              serializedNode.svgRef = await postJobBlob(
                mergedOptions.jobId,
                {
                  kind: 'svg',
                  nodeId: node.id,
                  ext: 'svg',
                  text: svgString,
                },
                reportStage
              );
            } else {
              serializedNode.svgString = svgString;
            }
            diagnostics.svg.attached += 1;
          }
        } catch (error) {
          diagnostics.svg.errors += 1;
        }
      })
    )
  );

  if (reportStage) {
    reportStage.ok('extract.svg.done', 'SVG fallback extraction complete', diagnostics.svg);
  }

  const imageAssetResult = await resolveImageAssets(
    designSnapshot && designSnapshot.resources ? designSnapshot.resources.images : [],
    mergedOptions,
    reportStage
  );

  diagnostics.imageAssets = imageAssetResult.diagnostics;
  if (designSnapshot && designSnapshot.resources) {
    designSnapshot.resources.imageAssets = imageAssetResult.assets;
  }

  return diagnostics;
}
