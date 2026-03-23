function getDefaultModeName(collection, allModes) {
  if (collection && collection.defaultModeId) {
    for (let i = 0; i < collection.modes.length; i += 1) {
      if (collection.modes[i].modeId === collection.defaultModeId) {
        return collection.modes[i].name;
      }
    }
  }

  const modeNames = Object.keys(allModes);
  return modeNames.length > 0 ? modeNames[0] : null;
}

function formatColorRgba(raw) {
  const alpha = raw.a == null ? 1 : raw.a;

  return (
    'rgba(' +
    Math.round(raw.r * 255) +
    ',' +
    Math.round(raw.g * 255) +
    ',' +
    Math.round(raw.b * 255) +
    ',' +
    (+alpha.toFixed(2)) +
    ')'
  );
}

async function resolveVariableById(variableId, variableCache) {
  if (Object.prototype.hasOwnProperty.call(variableCache, variableId)) {
    return variableCache[variableId];
  }

  const variable = await figma.variables.getVariableByIdAsync(variableId);
  variableCache[variableId] = variable;
  return variable;
}

async function resolveCollectionById(collectionId, collectionCache) {
  if (!collectionId) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(collectionCache, collectionId)) {
    return collectionCache[collectionId];
  }

  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  collectionCache[collectionId] = collection;
  return collection;
}

async function formatModeValue(variable, rawValue, variableCache) {
  if (rawValue && rawValue.type === 'VARIABLE_ALIAS') {
    const aliasVariable = await resolveVariableById(rawValue.id, variableCache);
    return {
      alias: aliasVariable ? aliasVariable.name : rawValue.id,
      aliasId: rawValue.id,
    };
  }

  if (variable.resolvedType === 'COLOR' && rawValue) {
    return {
      hex: rgbToHex(rawValue),
      rgba: formatColorRgba(rawValue),
    };
  }

  return rawValue;
}

function assignFlatValue(flat, variableType, variableKey, value) {
  if (value == null) {
    return;
  }

  if (variableType === 'COLOR') {
    flat.colors[variableKey] = value && value.hex ? value.hex : value;
    return;
  }

  if (variableType === 'FLOAT') {
    flat.numbers[variableKey] = value;
    return;
  }

  if (variableType === 'STRING') {
    flat.strings[variableKey] = value;
    return;
  }

  if (variableType === 'BOOLEAN') {
    flat.booleans[variableKey] = value;
  }
}
