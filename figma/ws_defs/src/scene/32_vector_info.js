function serializeVectorInfo(node) {
  const vector = {};

  if (hasNodeProperty(node, 'fillGeometry') && Array.isArray(node.fillGeometry)) {
    vector.fillGeometryCount = node.fillGeometry.length;
    if (node.fillGeometry.length > 0 && node.fillGeometry.length <= 8) {
      vector.fillGeometry = node.fillGeometry;
    }
  }

  if (hasNodeProperty(node, 'strokeGeometry') && Array.isArray(node.strokeGeometry)) {
    vector.strokeGeometryCount = node.strokeGeometry.length;
    if (node.strokeGeometry.length > 0 && node.strokeGeometry.length <= 8) {
      vector.strokeGeometry = node.strokeGeometry;
    }
  }

  if (hasNodeProperty(node, 'vectorPaths') && Array.isArray(node.vectorPaths)) {
    vector.vectorPathCount = node.vectorPaths.length;
    if (node.vectorPaths.length > 0 && node.vectorPaths.length <= 8) {
      vector.vectorPaths = node.vectorPaths;
    }
  }

  if (
    hasNodeProperty(node, 'vectorNetwork') &&
    node.vectorNetwork &&
    typeof node.vectorNetwork === 'object'
  ) {
    vector.vectorNetwork = {
      vertices: Array.isArray(node.vectorNetwork.vertices)
        ? node.vectorNetwork.vertices.length
        : 0,
      segments: Array.isArray(node.vectorNetwork.segments)
        ? node.vectorNetwork.segments.length
        : 0,
      regions: Array.isArray(node.vectorNetwork.regions)
        ? node.vectorNetwork.regions.length
        : 0,
    };
  }

  const textPathStartDataResult = safeReadNodeProperty(node, 'textPathStartData');
  if (!textPathStartDataResult.error && textPathStartDataResult.value) {
    vector.textPathStartData = serializeStructuredValue(textPathStartDataResult.value, null);
  }

  const transformModifiersResult = safeReadNodeProperty(node, 'transformModifiers');
  if (!transformModifiersResult.error && transformModifiersResult.value) {
    vector.transformModifiers = serializeStructuredValue(transformModifiersResult.value, null);
  }

  return countKeys(vector) > 0 ? vector : null;
}
