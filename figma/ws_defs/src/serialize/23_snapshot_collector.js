function createSnapshotCollector(paintDiagnostics) {
  return {
    nodeTypes: {},
    fonts: {},
    effects: {},
    images: {},
    components: {},
    routes: {},
    hardSignals: {},
    paintDiagnostics: paintDiagnostics,
  };
}

function registerNodeType(collector, type) {
  if (!type) {
    return;
  }

  collector.nodeTypes[type] = (collector.nodeTypes[type] || 0) + 1;
}

function registerFontUsage(collector, fontName) {
  if (!fontName || fontName.mixed) {
    return;
  }

  const family = fontName.family || 'Unknown';
  const style = fontName.style || 'Regular';
  const key = family + '|' + style;

  if (!collector.fonts[key]) {
    collector.fonts[key] = {
      family: family,
      style: style,
      count: 0,
    };
  }

  collector.fonts[key].count += 1;
}

function registerImagePaints(collector, paints) {
  if (!Array.isArray(paints)) {
    return;
  }

  for (let i = 0; i < paints.length; i += 1) {
    const paint = paints[i];
    if (paint && typeof paint.imageHash === 'string' && paint.imageHash) {
      if (!collector.images[paint.imageHash]) {
        collector.images[paint.imageHash] = {
          imageHash: paint.imageHash,
          count: 0,
          imageRef: typeof paint.imageRef === 'string' ? paint.imageRef : null,
          gifRef: typeof paint.gifRef === 'string' ? paint.gifRef : null,
        };
      }

      if (
        !collector.images[paint.imageHash].imageRef &&
        typeof paint.imageRef === 'string' &&
        paint.imageRef
      ) {
        collector.images[paint.imageHash].imageRef = paint.imageRef;
      }

      if (
        !collector.images[paint.imageHash].gifRef &&
        typeof paint.gifRef === 'string' &&
        paint.gifRef
      ) {
        collector.images[paint.imageHash].gifRef = paint.gifRef;
      }

      collector.images[paint.imageHash].count += 1;
    }
  }
}

function registerEffects(collector, effects) {
  if (!Array.isArray(effects)) {
    return;
  }

  for (let i = 0; i < effects.length; i += 1) {
    const effect = effects[i];
    if (!effect) {
      continue;
    }

    const key =
      String(effect.type || 'UNKNOWN') +
      '|' +
      String(effect.radius || 0) +
      '|' +
      String(effect.spread || 0);

    if (!collector.effects[key]) {
      collector.effects[key] = {
        key: key,
        type: effect.type || null,
        radius: typeof effect.radius === 'number' ? roundNumber(effect.radius) : null,
        spread: typeof effect.spread === 'number' ? roundNumber(effect.spread) : null,
        count: 0,
      };
    }

    collector.effects[key].count += 1;
  }
}

function registerComponentUsage(collector, componentInfo) {
  if (!componentInfo || !componentInfo.key) {
    return;
  }

  if (!collector.components[componentInfo.key]) {
    collector.components[componentInfo.key] = {
      key: componentInfo.key,
      name: componentInfo.name || null,
      count: 0,
    };
  }

  collector.components[componentInfo.key].count += 1;
}
