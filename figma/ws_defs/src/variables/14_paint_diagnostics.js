function createPaintDiagnostics() {
  return {
    palette: {},
    gradients: [],
    gradientMap: {},
  };
}

function addPaletteColor(paintDiagnostics, rawColor, sourceType) {
  if (!isColorObject(rawColor)) {
    return;
  }

  const hex = rgbToHex(rawColor);
  if (!paintDiagnostics.palette[hex]) {
    paintDiagnostics.palette[hex] = {
      hex: hex,
      rgba: formatColorRgba(rawColor),
      count: 0,
      sources: {},
    };
  }

  paintDiagnostics.palette[hex].count += 1;
  paintDiagnostics.palette[hex].sources[sourceType] =
    (paintDiagnostics.palette[hex].sources[sourceType] || 0) + 1;
}

function addGradient(paintDiagnostics, value, sourceType) {
  if (!value || !Array.isArray(value.gradientStops) || !value.type) {
    return;
  }

  const stopColors = [];
  for (let i = 0; i < value.gradientStops.length; i += 1) {
    const stop = value.gradientStops[i];
    if (stop && stop.color) {
      stopColors.push(rgbToHex(stop.color));
    }
  }

  if (stopColors.length === 0) {
    return;
  }

  const key = value.type + '|' + stopColors.join('|');
  if (!paintDiagnostics.gradientMap[key]) {
    paintDiagnostics.gradientMap[key] = {
      key: key,
      type: value.type,
      count: 0,
      sources: {},
      stopColors: stopColors,
    };
    paintDiagnostics.gradients.push(paintDiagnostics.gradientMap[key]);
  }

  paintDiagnostics.gradientMap[key].count += 1;
  paintDiagnostics.gradientMap[key].sources[sourceType] =
    (paintDiagnostics.gradientMap[key].sources[sourceType] || 0) + 1;
}

function collectPaintDiagnosticsFromValue(value, paintDiagnostics, sourceType) {
  if (value == null) {
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      collectPaintDiagnosticsFromValue(value[i], paintDiagnostics, sourceType);
    }
    return;
  }

  if (isColorObject(value)) {
    addPaletteColor(paintDiagnostics, value, sourceType);
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  if (value.type && String(value.type).indexOf('GRADIENT_') === 0) {
    addGradient(paintDiagnostics, value, sourceType);
  }

  for (const key in value) {
    collectPaintDiagnosticsFromValue(value[key], paintDiagnostics, sourceType);
  }
}

function collectNodePaintDiagnostics(node, paintDiagnostics) {
  collectPaintDiagnosticsFromValue(node.fills, paintDiagnostics, 'fills');
  collectPaintDiagnosticsFromValue(node.strokes, paintDiagnostics, 'strokes');
  collectPaintDiagnosticsFromValue(node.effects, paintDiagnostics, 'effects');
  collectPaintDiagnosticsFromValue(node.layoutGrids, paintDiagnostics, 'layoutGrids');
  collectPaintDiagnosticsFromValue(node.backgrounds, paintDiagnostics, 'backgrounds');
}
