function rgbToHex(color) {
  const alpha = color.a == null ? 1 : color.a;

  function toHex(value) {
    return Math.round(value * 255).toString(16).padStart(2, '0');
  }

  if (alpha < 1) {
    return '#' + toHex(color.r) + toHex(color.g) + toHex(color.b) + toHex(alpha);
  }

  return '#' + toHex(color.r) + toHex(color.g) + toHex(color.b);
}

function sanitizeVariableKey(name) {
  return '--' + String(name).replace(/\//g, '-').replace(/\s+/g, '-').toLowerCase();
}

function countKeys(input) {
  return Object.keys(input || {}).length;
}

function buildSummary(
  flat,
  scannedNodeCount,
  referencedVariableCount,
  unresolvedAliasCount,
  paintDiagnostics
) {
  const colors = countKeys(flat.colors);
  const numbers = countKeys(flat.numbers);
  const strings = countKeys(flat.strings);
  const booleans = countKeys(flat.booleans);
  const paintColorCount =
    paintDiagnostics && paintDiagnostics.palette
      ? countKeys(paintDiagnostics.palette)
      : 0;
  const gradientCount =
    paintDiagnostics && paintDiagnostics.gradients
      ? paintDiagnostics.gradients.length
      : 0;

  return {
    colors: colors,
    numbers: numbers,
    strings: strings,
    booleans: booleans,
    total: colors + numbers + strings + booleans,
    scannedNodeCount: scannedNodeCount,
    referencedVariableCount: referencedVariableCount,
    unresolvedAliasCount: unresolvedAliasCount,
    collectionCount: 0,
    paintColorCount: paintColorCount,
    gradientCount: gradientCount,
  };
}

function createPluginError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details || null;
  return error;
}
