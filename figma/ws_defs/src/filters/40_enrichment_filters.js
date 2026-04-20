function hasPaintOfTypes(paints, typeMap) {
  if (!Array.isArray(paints)) {
    return false;
  }

  for (let i = 0; i < paints.length; i += 1) {
    const paint = paints[i];
    if (paint && typeMap[paint.type]) {
      return true;
    }
  }

  return false;
}

function shouldCollectCssForNode(node) {
  if (!node || typeof node.getCSSAsync !== 'function') {
    return false;
  }

  if (node.type === 'DOCUMENT' || node.type === 'PAGE') {
    return false;
  }

  if (node.type === 'TEXT' || node.type === 'BOOLEAN_OPERATION') {
    return true;
  }

  return (
    (Array.isArray(node.fills) && node.fills.length > 0) ||
    (Array.isArray(node.strokes) && node.strokes.length > 0) ||
    (Array.isArray(node.backgrounds) && node.backgrounds.length > 0) ||
    (Array.isArray(node.effects) && node.effects.length > 0)
  );
}

// L1.4: pure-container types are positioned with DOM/CSS via their children's
// own SVG/CSS treatment. Exporting SVG for them produces a flattened raster
// of the entire subtree (including base64-embedded raster fills) — wasted
// 7MB+ blobs that no consumer reads (skeleton generator routes children-first).
const SVG_EXPORT_EXCLUDE_CONTAINER_TYPES = {
  FRAME: true,
  SECTION: true,
  GROUP: true,
  COMPONENT: true,
  COMPONENT_SET: true,
  INSTANCE: true,
};

function shouldExportSvgForNode(node) {
  if (!node || typeof node.exportAsync !== 'function') {
    return false;
  }

  // Hard-signal short-circuit: these REQUIRE SVG regardless of container status.
  if (node.type === 'BOOLEAN_OPERATION' || node.type === 'TEXT_PATH') {
    return true;
  }

  if (hasNodeProperty(node, 'isMask') && node.isMask === true) {
    return true;
  }

  const complexStrokePropertiesResult = safeReadNodeProperty(node, 'complexStrokeProperties');
  if (
    !complexStrokePropertiesResult.error &&
    complexStrokePropertiesResult.value &&
    complexStrokePropertiesResult.value.type &&
    complexStrokePropertiesResult.value.type !== 'BASIC'
  ) {
    return true;
  }

  const variableWidthStrokePropertiesResult = safeReadNodeProperty(
    node,
    'variableWidthStrokeProperties'
  );
  if (
    !variableWidthStrokePropertiesResult.error &&
    variableWidthStrokePropertiesResult.value
  ) {
    return true;
  }

  if (hasNodeProperty(node, 'vectorPaths') && Array.isArray(node.vectorPaths)) {
    if (node.vectorPaths.length > 1) {
      return true;
    }
  }

  // L1.4: pure containers fall through unless they hit a hard signal above.
  if (SVG_EXPORT_EXCLUDE_CONTAINER_TYPES[node.type]) {
    return false;
  }

  return (
    hasPaintOfTypes(node.fills, SVG_FALLBACK_PAINT_TYPES) ||
    hasPaintOfTypes(node.strokes, SVG_FALLBACK_PAINT_TYPES) ||
    hasPaintOfTypes(node.backgrounds, SVG_FALLBACK_PAINT_TYPES)
  );
}

function buildSerializedNodeIndex(node, index) {
  if (!node || !index) {
    return index;
  }

  index[node.id] = node;
  if (Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i += 1) {
      buildSerializedNodeIndex(node.children[i], index);
    }
  }

  return index;
}

function buildResourceArrayFromMap(map) {
  var values = Object.values(map);
  return values.sort(function (a, b) {
    var keyA = a.name || a.key || a.family || a.imageHash || '';
    var keyB = b.name || b.key || b.family || b.imageHash || '';
    if (keyA < keyB) {
      return -1;
    }
    if (keyA > keyB) {
      return 1;
    }
    return 0;
  });
}

function buildVariableResourceList(variableIds, variableCache) {
  const output = [];
  for (let i = 0; i < variableIds.length; i += 1) {
    const variable = variableCache[variableIds[i]];
    if (!variable) {
      continue;
    }

    output.push({
      id: variable.id,
      key: typeof variable.key === 'string' ? variable.key : null,
      name: variable.name,
      type: variable.resolvedType,
      collectionId: variable.variableCollectionId || null,
      remote: !!variable.remote,
      scopes: variable.scopes || [],
    });
  }

  output.sort(function (a, b) {
    if (a.name < b.name) {
      return -1;
    }
    if (a.name > b.name) {
      return 1;
    }
    return 0;
  });
  return output;
}
