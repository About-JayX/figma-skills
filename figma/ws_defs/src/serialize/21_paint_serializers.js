function serializePaint(paint, variableCache) {
  if (!paint || typeof paint !== 'object') {
    return null;
  }

  const output = {
    type: paint.type || null,
    visible: paint.visible !== false,
  };

  if (typeof paint.opacity === 'number') {
    output.opacity = roundNumber(paint.opacity);
  }

  if (typeof paint.blendMode === 'string') {
    output.blendMode = paint.blendMode;
  }

  if (isColorObject(paint.color)) {
    output.color = serializeColorValue(paint.color);
  }

  if (isPlainObject(paint.boundVariables)) {
    output.boundVariables = serializeVariableBindingTree(paint.boundVariables, variableCache);
  }

  if (Array.isArray(paint.gradientStops)) {
    output.gradientStops = [];
    for (let i = 0; i < paint.gradientStops.length; i += 1) {
      const stop = paint.gradientStops[i];
      if (!stop) {
        continue;
      }

      const serializedStop = {
        position: roundNumber(stop.position),
        color: serializeColorValue(stop.color),
      };

      if (isPlainObject(stop.boundVariables)) {
        serializedStop.boundVariables = serializeVariableBindingTree(
          stop.boundVariables,
          variableCache
        );
      }

      output.gradientStops.push(serializedStop);
    }
  }

  if (paint.gradientTransform) {
    output.gradientTransform = serializeMatrix(paint.gradientTransform);
  }

  if (typeof paint.scaleMode === 'string') {
    output.scaleMode = paint.scaleMode;
  }

  if (typeof paint.imageHash === 'string') {
    output.imageHash = paint.imageHash;
  }

  if (typeof paint.imageRef === 'string') {
    output.imageRef = paint.imageRef;
  }

  if (typeof paint.gifRef === 'string') {
    output.gifRef = paint.gifRef;
  }

  if (paint.imageTransform) {
    output.imageTransform = serializeMatrix(paint.imageTransform);
  }

  if (typeof paint.rotation === 'number') {
    output.rotation = roundNumber(paint.rotation);
  }

  if (typeof paint.scalingFactor === 'number') {
    output.scalingFactor = roundNumber(paint.scalingFactor);
  }

  if (isPlainObject(paint.filters)) {
    output.filters = serializeNumberMap(paint.filters);
  }

  if (typeof paint.videoHash === 'string') {
    output.videoHash = paint.videoHash;
  }

  if (paint.videoTransform) {
    output.videoTransform = serializeMatrix(paint.videoTransform);
  }

  if (typeof paint.sourceNodeId === 'string') {
    output.sourceNodeId = paint.sourceNodeId;
  }

  if (typeof paint.tileType === 'string') {
    output.tileType = paint.tileType;
  }

  if (paint.spacing && typeof paint.spacing === 'object') {
    output.spacing = serializePoint(paint.spacing);
  }

  if (typeof paint.horizontalAlignment === 'string') {
    output.horizontalAlignment = paint.horizontalAlignment;
  }

  return output;
}

function serializePaintList(paints, variableCache) {
  if (!Array.isArray(paints)) {
    return [];
  }

  const output = [];
  for (let i = 0; i < paints.length; i += 1) {
    const serialized = serializePaint(paints[i], variableCache);
    if (serialized) {
      output.push(serialized);
    }
  }
  return output;
}
