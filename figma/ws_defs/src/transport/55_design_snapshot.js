async function buildDesignSnapshot(rootNode, variableIds, variableCache, paintDiagnostics) {
  const collector = createSnapshotCollector(paintDiagnostics);
  const root = await serializeSceneNode(rootNode, variableCache, collector, 0, 0);

  return {
    schemaVersion: 3,
    root: root,
    resources: {
      nodeTypes: collector.nodeTypes,
      fonts: buildResourceArrayFromMap(collector.fonts),
      effects: buildResourceArrayFromMap(collector.effects),
      images: buildResourceArrayFromMap(collector.images),
      imageAssets: {},
      components: buildResourceArrayFromMap(collector.components),
      variables: buildVariableResourceList(variableIds, variableCache),
      colors: buildResourceArrayFromMap(paintDiagnostics.palette),
      gradients: paintDiagnostics.gradients,
      replay: {
        routeCounts: collector.routes,
        hardSignalCounts: collector.hardSignals,
      },
    },
  };
}
