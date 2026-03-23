async function buildNodeExtraction(rootNode, options, reportStage) {
  const extractionOptions =
    options && typeof options === 'object'
      ? Object.assign({}, DEFAULT_EXTRACTION_OPTIONS, options)
      : DEFAULT_EXTRACTION_OPTIONS;
  const aliasIds = new Set();
  const subtreeNodes = collectSubtreeNodes(rootNode);
  const variableCache = {};
  const collectionCache = {};
  const flat = { colors: {}, numbers: {}, strings: {}, booleans: {} };
  const full = {};
  const unresolvedAliasIds = [];
  const paintDiagnostics = createPaintDiagnostics();

  if (reportStage) {
    reportStage.loading('extract.preflight', '扫描节点与变量引用', {
      rootNodeId: rootNode && rootNode.id ? rootNode.id : null,
      rootNodeType: rootNode && rootNode.type ? rootNode.type : null,
      subtreeNodes: subtreeNodes.length,
    });
  }

  for (let i = 0; i < subtreeNodes.length; i += 1) {
    collectNodeAliasIds(subtreeNodes[i], aliasIds);
    collectNodePaintDiagnostics(subtreeNodes[i], paintDiagnostics);
  }

  const variableIds = Array.from(aliasIds);

  if (reportStage) {
    reportStage.ok('extract.preflight.done', '节点扫描完成', {
      subtreeNodes: subtreeNodes.length,
      variableIds: variableIds.length,
    });
    reportStage.loading('extract.variables.start', '变量解析中', {
      variables: variableIds.length,
    });
  }

  for (let i = 0; i < variableIds.length; i += 1) {
    const variableId = variableIds[i];
    const variable = await resolveVariableById(variableId, variableCache);

    if (!variable) {
      unresolvedAliasIds.push(variableId);
      continue;
    }

    const collectionId = variable.variableCollectionId || null;
    const collection = await resolveCollectionById(collectionId, collectionCache);
    const collectionName = collection && collection.name ? collection.name : 'Unknown Collection';

    if (!full[collectionName]) {
      full[collectionName] = {
        collectionId: collection ? collection.id : collectionId,
        defaultModeId: collection ? collection.defaultModeId : null,
        modes: collection ? collection.modes : [],
        variables: {},
      };
    }

    const values = {};
    if (collection && collection.modes && collection.modes.length > 0) {
      for (let j = 0; j < collection.modes.length; j += 1) {
        const mode = collection.modes[j];
        const rawValue =
          variable.valuesByMode && mode ? variable.valuesByMode[mode.modeId] : null;
        values[mode.name] = await formatModeValue(variable, rawValue, variableCache);
      }
    } else if (variable.valuesByMode) {
      for (const modeId in variable.valuesByMode) {
        values[modeId] = await formatModeValue(
          variable,
          variable.valuesByMode[modeId],
          variableCache
        );
      }
    }

    full[collectionName].variables[variable.name] = {
      id: variable.id,
      key: typeof variable.key === 'string' ? variable.key : null,
      remote: !!variable.remote,
      type: variable.resolvedType,
      scopes: variable.scopes || [],
      values: values,
    };

    const defaultModeName = getDefaultModeName(collection, values);
    const variableKey = sanitizeVariableKey(variable.name);
    const defaultValue =
      defaultModeName && Object.prototype.hasOwnProperty.call(values, defaultModeName)
        ? values[defaultModeName]
        : null;

    assignFlatValue(flat, variable.resolvedType, variableKey, defaultValue);
  }

  if (reportStage) {
    reportStage.ok('extract.variables.done', '变量解析完成', {
      variables: variableIds.length,
      unresolvedAliasIds: unresolvedAliasIds.length,
    });
    reportStage.loading('extract.snapshot.start', '结构化场景序列化中', {
      subtreeNodes: subtreeNodes.length,
    });
  }

  const summary = buildSummary(
    flat,
    subtreeNodes.length,
    variableIds.length,
    unresolvedAliasIds.length,
    paintDiagnostics
  );
  summary.collectionCount = countKeys(full);

  const gradients = paintDiagnostics.gradients;
  delete paintDiagnostics.gradientMap;

  const normalizedPaintDiagnostics = {
    palette: paintDiagnostics.palette,
    gradients: gradients,
  };

  const designSnapshot = await buildDesignSnapshot(
    rootNode,
    variableIds,
    variableCache,
    normalizedPaintDiagnostics
  );

  if (reportStage) {
    reportStage.ok('extract.snapshot.done', '结构化场景序列化完成', {
      imageResources:
        designSnapshot &&
        designSnapshot.resources &&
        Array.isArray(designSnapshot.resources.images)
          ? designSnapshot.resources.images.length
          : 0,
    });
  }

  const enrichmentDiagnostics = await enrichDesignSnapshotAsync(
    rootNode,
    designSnapshot,
    subtreeNodes,
    extractionOptions,
    reportStage
  );
  var restSnapshotResult;
  try {
    restSnapshotResult = await exportRestSnapshot(rootNode, extractionOptions, reportStage);
  } catch (restError) {
    restSnapshotResult = {
      snapshot: null,
      diagnostics: { included: false, truncated: false, bytes: 0, error: 'REST_EXPORT_FAILED' },
    };
  }

  return {
    defs: {
      flat: flat,
      full: full,
      summary: summary,
      unresolvedAliasIds: unresolvedAliasIds,
      paintDiagnostics: normalizedPaintDiagnostics,
    },
    designSnapshot: designSnapshot,
    restSnapshot: restSnapshotResult.snapshot,
    diagnostics: {
      designSnapshot: enrichmentDiagnostics,
      restSnapshot: restSnapshotResult.diagnostics,
    },
  };
}
