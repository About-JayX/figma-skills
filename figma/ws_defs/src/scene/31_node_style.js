function serializeNodeStyle(node, variableCache) {
  const style = {};

  if (hasNodeProperty(node, 'fills')) {
    style.fills = serializePaintList(node.fills, variableCache);
  }
  if (hasNodeProperty(node, 'strokes')) {
    style.strokes = serializePaintList(node.strokes, variableCache);
  }
  if (hasNodeProperty(node, 'effects')) {
    style.effects = serializeEffectList(node.effects, variableCache);
  }
  if (hasNodeProperty(node, 'backgrounds')) {
    style.backgrounds = serializePaintList(node.backgrounds, variableCache);
  }
  if (hasNodeProperty(node, 'layoutGrids')) {
    style.layoutGrids = serializeLayoutGrids(node.layoutGrids);
  }
  if (hasNodeProperty(node, 'fillStyleId') && typeof node.fillStyleId === 'string') {
    style.fillStyleId = node.fillStyleId;
  }
  if (hasNodeProperty(node, 'strokeStyleId') && typeof node.strokeStyleId === 'string') {
    style.strokeStyleId = node.strokeStyleId;
  }
  if (hasNodeProperty(node, 'effectStyleId') && typeof node.effectStyleId === 'string') {
    style.effectStyleId = node.effectStyleId;
  }
  if (hasNodeProperty(node, 'gridStyleId') && typeof node.gridStyleId === 'string') {
    style.gridStyleId = node.gridStyleId;
  }
  if (hasNodeProperty(node, 'backgroundStyleId') && typeof node.backgroundStyleId === 'string') {
    style.backgroundStyleId = node.backgroundStyleId;
  }
  if (hasNodeProperty(node, 'opacity') && typeof node.opacity === 'number') {
    style.opacity = roundNumber(node.opacity);
  }
  if (hasNodeProperty(node, 'blendMode') && typeof node.blendMode === 'string') {
    style.blendMode = node.blendMode;
  }
  if (hasNodeProperty(node, 'strokeWeight') && typeof node.strokeWeight === 'number') {
    style.strokeWeight = roundNumber(node.strokeWeight);
  }
  if (hasNodeProperty(node, 'strokeTopWeight') && typeof node.strokeTopWeight === 'number') {
    style.strokeWeights = {
      top: roundNumber(node.strokeTopWeight),
      right: roundNumber(node.strokeRightWeight),
      bottom: roundNumber(node.strokeBottomWeight),
      left: roundNumber(node.strokeLeftWeight),
    };
  }
  if (hasNodeProperty(node, 'strokeAlign') && typeof node.strokeAlign === 'string') {
    style.strokeAlign = node.strokeAlign;
  }
  if (hasNodeProperty(node, 'strokeCap') && typeof node.strokeCap === 'string') {
    style.strokeCap = node.strokeCap;
  }
  if (hasNodeProperty(node, 'strokeJoin') && typeof node.strokeJoin === 'string') {
    style.strokeJoin = node.strokeJoin;
  }
  if (hasNodeProperty(node, 'strokeMiterLimit') && typeof node.strokeMiterLimit === 'number') {
    style.strokeMiterLimit = roundNumber(node.strokeMiterLimit);
  }
  if (hasNodeProperty(node, 'dashPattern') && Array.isArray(node.dashPattern)) {
    style.dashPattern = node.dashPattern.map((value) => roundNumber(value));
  }
  if (hasNodeProperty(node, 'cornerRadius') && typeof node.cornerRadius === 'number') {
    style.cornerRadius = roundNumber(node.cornerRadius);
  }
  if (
    hasNodeProperty(node, 'cornerSmoothing') &&
    typeof node.cornerSmoothing === 'number'
  ) {
    style.cornerSmoothing = roundNumber(node.cornerSmoothing);
  }
  if (hasNodeProperty(node, 'topLeftRadius') && typeof node.topLeftRadius === 'number') {
    style.cornerRadii = {
      topLeft: roundNumber(node.topLeftRadius),
      topRight: roundNumber(node.topRightRadius),
      bottomRight: roundNumber(node.bottomRightRadius),
      bottomLeft: roundNumber(node.bottomLeftRadius),
    };
  }

  const complexStrokePropertiesResult = safeReadNodeProperty(node, 'complexStrokeProperties');
  if (!complexStrokePropertiesResult.error && complexStrokePropertiesResult.value) {
    style.complexStrokeProperties = serializeStructuredValue(
      complexStrokePropertiesResult.value,
      variableCache
    );
  }

  const variableWidthStrokePropertiesResult = safeReadNodeProperty(
    node,
    'variableWidthStrokeProperties'
  );
  if (
    !variableWidthStrokePropertiesResult.error &&
    variableWidthStrokePropertiesResult.value
  ) {
    style.variableWidthStrokeProperties = serializeStructuredValue(
      variableWidthStrokePropertiesResult.value,
      variableCache
    );
  }

  return style;
}
