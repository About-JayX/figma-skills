function roundNumber(value) {
  if (typeof value !== 'number' || !isFinite(value)) {
    return value;
  }

  return Number(value.toFixed(3));
}

function serializePoint(point) {
  if (!point || typeof point !== 'object') {
    return null;
  }

  return {
    x: roundNumber(point.x),
    y: roundNumber(point.y),
  };
}

function serializeRect(rect) {
  if (!rect || typeof rect !== 'object') {
    return null;
  }

  return {
    x: roundNumber(rect.x),
    y: roundNumber(rect.y),
    width: roundNumber(rect.width),
    height: roundNumber(rect.height),
  };
}

function serializeMatrix(matrix) {
  if (!Array.isArray(matrix)) {
    return null;
  }

  const output = [];
  for (let i = 0; i < matrix.length; i += 1) {
    if (!Array.isArray(matrix[i])) {
      return null;
    }

    const row = [];
    for (let j = 0; j < matrix[i].length; j += 1) {
      row.push(roundNumber(matrix[i][j]));
    }
    output.push(row);
  }

  return output;
}

function isMixed(value) {
  return value === figma.mixed;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isColorObject(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.r === 'number' &&
    typeof value.g === 'number' &&
    typeof value.b === 'number'
  );
}

function hasNodeProperty(node, key) {
  return !!node && key in node;
}

function safeReadNodeProperty(node, key) {
  if (!hasNodeProperty(node, key)) {
    return {
      exists: false,
      value: null,
      error: null,
    };
  }

  try {
    return {
      exists: true,
      value: node[key],
      error: null,
    };
  } catch (error) {
    return {
      exists: true,
      value: null,
      error: error,
    };
  }
}
