function serializeNumberMap(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const output = {};
  for (const key in value) {
    const entry = value[key];
    output[key] = typeof entry === 'number' ? roundNumber(entry) : entry;
  }
  return output;
}

function serializeResolvedModes(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const output = {};
  for (const key in value) {
    if (typeof value[key] === 'string' && value[key]) {
      output[key] = value[key];
    }
  }
  return countKeys(output) > 0 ? output : null;
}

function serializeReadError(property, error) {
  if (!error) {
    return null;
  }

  return {
    property: property,
    code: error && error.code ? error.code : null,
    message: error instanceof Error ? error.message : String(error),
  };
}

function serializeColorValue(rawColor) {
  if (!isColorObject(rawColor)) {
    return null;
  }

  const alpha = rawColor.a == null ? 1 : rawColor.a;
  return {
    hex: rgbToHex(rawColor),
    rgba: formatColorRgba(rawColor),
    r: roundNumber(rawColor.r),
    g: roundNumber(rawColor.g),
    b: roundNumber(rawColor.b),
    a: roundNumber(alpha),
  };
}

function serializeLetterSpacing(value) {
  if (value == null) {
    return null;
  }

  if (isMixed(value)) {
    return { mixed: true };
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return {
    unit: value.unit || null,
    value: roundNumber(value.value),
  };
}

function serializeLineHeight(value) {
  if (value == null) {
    return null;
  }

  if (isMixed(value)) {
    return { mixed: true };
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return {
    unit: value.unit || null,
    value: roundNumber(value.value),
  };
}

function serializeFontName(value) {
  if (value == null) {
    return null;
  }

  if (isMixed(value)) {
    return { mixed: true };
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return {
    family: value.family || null,
    style: value.style || null,
  };
}

function serializeHyperlink(value) {
  if (value == null) {
    return null;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return {
    type: value.type || null,
    value: typeof value.value === 'string' ? value.value : null,
  };
}
