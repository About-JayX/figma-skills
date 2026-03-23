function serializeVariableRefById(variableId, variableCache) {
  if (typeof variableId !== 'string' || !variableId) {
    return null;
  }

  const variable = variableCache[variableId];
  return {
    id: variableId,
    name: variable && typeof variable.name === 'string' ? variable.name : null,
    key: variable && typeof variable.key === 'string' ? variable.key : null,
    type: variable ? variable.resolvedType : null,
    collectionId: variable ? variable.variableCollectionId || null : null,
    remote: variable ? !!variable.remote : null,
  };
}

function serializeVariableBindingTree(value, variableCache) {
  if (value == null) {
    return null;
  }

  if (Array.isArray(value)) {
    const output = [];
    for (let i = 0; i < value.length; i += 1) {
      output.push(serializeVariableBindingTree(value[i], variableCache));
    }
    return output;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  if (value.type === 'VARIABLE_ALIAS' && typeof value.id === 'string') {
    return serializeVariableRefById(value.id, variableCache);
  }

  const output = {};
  for (const key in value) {
    output[key] = serializeVariableBindingTree(value[key], variableCache);
  }
  return output;
}


function serializeStructuredValue(value, variableCache) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'number') {
    return roundNumber(value);
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const output = [];
    for (let i = 0; i < value.length; i += 1) {
      output.push(serializeStructuredValue(value[i], variableCache));
    }
    return output;
  }

  if (isColorObject(value)) {
    return serializeColorValue(value);
  }

  if (value.type === 'VARIABLE_ALIAS' && typeof value.id === 'string') {
    return serializeVariableRefById(value.id, variableCache);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const output = {};
  for (const key in value) {
    output[key] = serializeStructuredValue(value[key], variableCache);
  }
  return output;
}

function serializeGridTrackSize(track, variableCache) {
  if (!track || typeof track !== 'object') {
    return null;
  }

  return serializeStructuredValue(track, variableCache);
}

function serializeGridTrackSizes(tracks, variableCache) {
  if (!Array.isArray(tracks)) {
    return [];
  }

  const output = [];
  for (let i = 0; i < tracks.length; i += 1) {
    const serialized = serializeGridTrackSize(tracks[i], variableCache);
    if (serialized) {
      output.push(serialized);
    }
  }
  return output;
}

function serializeInferredAutoLayout(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const layout = {};

  if (typeof value.layoutMode === 'string') {
    layout.layoutMode = value.layoutMode;
  }
  if (typeof value.layoutWrap === 'string') {
    layout.layoutWrap = value.layoutWrap;
  }
  if (typeof value.primaryAxisSizingMode === 'string') {
    layout.primaryAxisSizingMode = value.primaryAxisSizingMode;
  }
  if (typeof value.counterAxisSizingMode === 'string') {
    layout.counterAxisSizingMode = value.counterAxisSizingMode;
  }
  if (typeof value.primaryAxisAlignItems === 'string') {
    layout.primaryAxisAlignItems = value.primaryAxisAlignItems;
  }
  if (typeof value.counterAxisAlignItems === 'string') {
    layout.counterAxisAlignItems = value.counterAxisAlignItems;
  }
  if (typeof value.counterAxisAlignContent === 'string') {
    layout.counterAxisAlignContent = value.counterAxisAlignContent;
  }
  if (typeof value.itemSpacing === 'number') {
    layout.itemSpacing = roundNumber(value.itemSpacing);
  }
  if (typeof value.counterAxisSpacing === 'number') {
    layout.counterAxisSpacing = roundNumber(value.counterAxisSpacing);
  }
  if (typeof value.paddingTop === 'number') {
    layout.paddingTop = roundNumber(value.paddingTop);
  }
  if (typeof value.paddingRight === 'number') {
    layout.paddingRight = roundNumber(value.paddingRight);
  }
  if (typeof value.paddingBottom === 'number') {
    layout.paddingBottom = roundNumber(value.paddingBottom);
  }
  if (typeof value.paddingLeft === 'number') {
    layout.paddingLeft = roundNumber(value.paddingLeft);
  }
  if (typeof value.layoutAlign === 'string') {
    layout.layoutAlign = value.layoutAlign;
  }
  if (typeof value.layoutGrow === 'number') {
    layout.layoutGrow = roundNumber(value.layoutGrow);
  }
  if (typeof value.layoutPositioning === 'string') {
    layout.layoutPositioning = value.layoutPositioning;
  }
  if (typeof value.itemReverseZIndex === 'boolean') {
    layout.itemReverseZIndex = value.itemReverseZIndex;
  }
  if (typeof value.strokesIncludedInLayout === 'boolean') {
    layout.strokesIncludedInLayout = value.strokesIncludedInLayout;
  }

  return countKeys(layout) > 0 ? layout : null;
}

function serializeComponentPropertyDefinitions(definitions, variableCache) {
  if (!definitions || typeof definitions !== 'object') {
    return null;
  }

  const output = {};
  for (const key in definitions) {
    output[key] = serializeStructuredValue(definitions[key], variableCache);
  }
  return countKeys(output) > 0 ? output : null;
}
