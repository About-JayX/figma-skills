function effectListHasAdvancedEffect(effects) {
  if (!Array.isArray(effects)) {
    return false;
  }

  for (let i = 0; i < effects.length; i += 1) {
    const effect = effects[i];
    if (!effect) {
      continue;
    }

    if (effect.type === 'NOISE' || effect.type === 'TEXTURE' || effect.type === 'GLASS') {
      return true;
    }

    if (
      (effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR') &&
      effect.blurType === 'PROGRESSIVE'
    ) {
      return true;
    }
  }

  return false;
}

function collectReplayHardSignals(sceneNode) {
  const signals = [];
  const style = sceneNode && sceneNode.style ? sceneNode.style : null;
  const layout = sceneNode && sceneNode.layout ? sceneNode.layout : null;
  const vector = sceneNode && sceneNode.vector ? sceneNode.vector : null;

  if (!sceneNode) {
    return signals;
  }

  if (sceneNode.type === 'BOOLEAN_OPERATION') {
    signals.push('BOOLEAN_OPERATION');
  }

  if (sceneNode.isMask) {
    signals.push('MASK');
    if (sceneNode.maskType) {
      signals.push('MASK_' + sceneNode.maskType);
    }
  }

  if (sceneNode.type === 'TEXT_PATH') {
    signals.push('TEXT_PATH');
  }

  if (
    paintListHasTypes(style && style.fills, { PATTERN: true }) ||
    paintListHasTypes(style && style.strokes, { PATTERN: true }) ||
    paintListHasTypes(style && style.backgrounds, { PATTERN: true })
  ) {
    signals.push('PATTERN_PAINT');
  }

  if (
    paintListHasTypes(style && style.fills, {
      GRADIENT_RADIAL: true,
      GRADIENT_ANGULAR: true,
      GRADIENT_DIAMOND: true,
    }) ||
    paintListHasTypes(style && style.strokes, {
      GRADIENT_RADIAL: true,
      GRADIENT_ANGULAR: true,
      GRADIENT_DIAMOND: true,
    }) ||
    paintListHasTypes(style && style.backgrounds, {
      GRADIENT_RADIAL: true,
      GRADIENT_ANGULAR: true,
      GRADIENT_DIAMOND: true,
    })
  ) {
    signals.push('COMPLEX_GRADIENT');
  }

  if (
    style &&
    style.complexStrokeProperties &&
    style.complexStrokeProperties.type &&
    style.complexStrokeProperties.type !== 'BASIC'
  ) {
    signals.push('COMPLEX_STROKE');
  }

  if (
    style &&
    style.variableWidthStrokeProperties &&
    countKeys(style.variableWidthStrokeProperties) > 0
  ) {
    signals.push('VARIABLE_WIDTH_STROKE');
  }

  if (
    vector &&
    (
      (typeof vector.fillGeometryCount === 'number' && vector.fillGeometryCount > 0) ||
      (typeof vector.strokeGeometryCount === 'number' && vector.strokeGeometryCount > 0) ||
      (typeof vector.vectorPathCount === 'number' && vector.vectorPathCount > 0) ||
      (vector.vectorNetwork && vector.vectorNetwork.segments > 0)
    )
  ) {
    signals.push('VECTOR_GEOMETRY');
  }

  if (effectListHasAdvancedEffect(style && style.effects)) {
    signals.push('ADVANCED_EFFECT');
  }

  if (
    paintListHasFilters(style && style.fills) ||
    paintListHasFilters(style && style.strokes) ||
    paintListHasFilters(style && style.backgrounds)
  ) {
    signals.push('FILTERED_MEDIA');
  }

  if (layout && layout.layoutMode === 'GRID') {
    signals.push('GRID_LAYOUT');
  }

  if (
    layout &&
    layout.layoutMode === 'NONE' &&
    layout.inferredAutoLayout &&
    layout.inferredAutoLayout.layoutMode &&
    layout.inferredAutoLayout.layoutMode !== 'NONE'
  ) {
    signals.push('INFERRED_AUTO_LAYOUT');
  }

  return Array.from(new Set(signals));
}
