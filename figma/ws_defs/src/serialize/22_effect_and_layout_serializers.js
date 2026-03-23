function serializeEffect(effect, variableCache) {
  if (!effect || typeof effect !== 'object') {
    return null;
  }

  const output = {
    type: effect.type || null,
    visible: effect.visible !== false,
  };

  if (typeof effect.radius === 'number') {
    output.radius = roundNumber(effect.radius);
  }

  if (typeof effect.spread === 'number') {
    output.spread = roundNumber(effect.spread);
  }

  if (typeof effect.blendMode === 'string') {
    output.blendMode = effect.blendMode;
  }

  if (effect.offset) {
    output.offset = serializePoint(effect.offset);
  }

  if (isColorObject(effect.color)) {
    output.color = serializeColorValue(effect.color);
  }

  if (typeof effect.showShadowBehindNode === 'boolean') {
    output.showShadowBehindNode = effect.showShadowBehindNode;
  }

  if (effect.boundVariables) {
    output.boundVariables = serializeVariableBindingTree(effect.boundVariables, variableCache);
  }

  if (typeof effect.blurType === 'string') {
    output.blurType = effect.blurType;
  }
  if (typeof effect.startRadius === 'number') {
    output.startRadius = roundNumber(effect.startRadius);
  }
  if (effect.startOffset) {
    output.startOffset = serializePoint(effect.startOffset);
  }
  if (effect.endOffset) {
    output.endOffset = serializePoint(effect.endOffset);
  }
  if (typeof effect.noiseType === 'string') {
    output.noiseType = effect.noiseType;
  }
  if (typeof effect.noiseSize === 'number') {
    output.noiseSize = roundNumber(effect.noiseSize);
  }
  if (typeof effect.density === 'number') {
    output.density = roundNumber(effect.density);
  }
  if (isColorObject(effect.secondaryColor)) {
    output.secondaryColor = serializeColorValue(effect.secondaryColor);
  }
  if (typeof effect.opacity === 'number') {
    output.opacity = roundNumber(effect.opacity);
  }
  if (typeof effect.clipToShape === 'boolean') {
    output.clipToShape = effect.clipToShape;
  }
  if (typeof effect.lightIntensity === 'number') {
    output.lightIntensity = roundNumber(effect.lightIntensity);
  }
  if (typeof effect.lightAngle === 'number') {
    output.lightAngle = roundNumber(effect.lightAngle);
  }
  if (typeof effect.refraction === 'number') {
    output.refraction = roundNumber(effect.refraction);
  }
  if (typeof effect.depth === 'number') {
    output.depth = roundNumber(effect.depth);
  }
  if (typeof effect.dispersion === 'number') {
    output.dispersion = roundNumber(effect.dispersion);
  }

  return output;
}

function serializeEffectList(effects, variableCache) {
  if (!Array.isArray(effects)) {
    return [];
  }

  const output = [];
  for (let i = 0; i < effects.length; i += 1) {
    const serialized = serializeEffect(effects[i], variableCache);
    if (serialized) {
      output.push(serialized);
    }
  }
  return output;
}

function serializeConstraints(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    horizontal: value.horizontal || null,
    vertical: value.vertical || null,
  };
}

function serializeLayoutGrids(grids) {
  if (!Array.isArray(grids)) {
    return [];
  }

  const output = [];
  for (let i = 0; i < grids.length; i += 1) {
    const grid = grids[i];
    if (!grid || typeof grid !== 'object') {
      continue;
    }

    output.push({
      pattern: grid.pattern || null,
      sectionSize: roundNumber(grid.sectionSize),
      visible: grid.visible !== false,
      alignment: grid.alignment || null,
      gutterSize: roundNumber(grid.gutterSize),
      offset: roundNumber(grid.offset),
      count: typeof grid.count === 'number' ? grid.count : null,
      color: serializeColorValue(grid.color),
    });
  }
  return output;
}

function serializeComponentProperties(componentProperties, variableCache) {
  if (!componentProperties || typeof componentProperties !== 'object') {
    return null;
  }

  const output = {};
  for (const key in componentProperties) {
    const value = componentProperties[key];
    if (!value || typeof value !== 'object') {
      output[key] = value;
      continue;
    }

    output[key] = {
      type: value.type || null,
      value: Object.prototype.hasOwnProperty.call(value, 'value') ? value.value : null,
      preferredValues: Array.isArray(value.preferredValues) ? value.preferredValues : null,
      boundVariables: value.boundVariables
        ? serializeVariableBindingTree(value.boundVariables, variableCache)
        : null,
    };
  }

  return output;
}
