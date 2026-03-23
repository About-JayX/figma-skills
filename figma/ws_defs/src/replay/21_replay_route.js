function classifyReplayRoute(sceneNode, hardSignals) {
  const signalSet = new Set(Array.isArray(hardSignals) ? hardSignals : []);
  const hasCanvasSignals =
    signalSet.has('ADVANCED_EFFECT') || signalSet.has('FILTERED_MEDIA');
  const hasSvgSignals =
    signalSet.has('BOOLEAN_OPERATION') ||
    signalSet.has('MASK') ||
    signalSet.has('TEXT_PATH') ||
    signalSet.has('PATTERN_PAINT') ||
    signalSet.has('COMPLEX_GRADIENT') ||
    signalSet.has('COMPLEX_STROKE') ||
    signalSet.has('VARIABLE_WIDTH_STROKE') ||
    signalSet.has('VECTOR_GEOMETRY');

  if (hasCanvasSignals && hasSvgSignals) {
    return 'RASTER_LOCK';
  }

  if (hasCanvasSignals) {
    return 'CANVAS_ISLAND';
  }

  if (hasSvgSignals) {
    return 'SVG_ISLAND';
  }

  if (signalSet.has('GRID_LAYOUT')) {
    return 'DOM_GRID';
  }

  if (signalSet.has('INFERRED_AUTO_LAYOUT')) {
    return 'DOM_INFERRED';
  }

  return 'DOM_NATIVE';
}

function buildReplayMetadata(sceneNode) {
  const hardSignals = collectReplayHardSignals(sceneNode);
  const routeHint = classifyReplayRoute(sceneNode, hardSignals);
  const verificationTier =
    routeHint === 'DOM_NATIVE' || routeHint === 'DOM_GRID' || routeHint === 'DOM_INFERRED'
      ? 'region'
      : 'hard-node';

  return {
    routeHint: routeHint,
    hardSignals: hardSignals,
    verificationTier: verificationTier,
    requiresVisualVerification: true,
  };
}

function registerReplayMetadata(collector, replay) {
  if (!collector || !replay) {
    return;
  }

  if (replay.routeHint) {
    collector.routes[replay.routeHint] = (collector.routes[replay.routeHint] || 0) + 1;
  }

  if (Array.isArray(replay.hardSignals)) {
    for (let i = 0; i < replay.hardSignals.length; i += 1) {
      const signal = replay.hardSignals[i];
      if (!signal) {
        continue;
      }
      collector.hardSignals[signal] = (collector.hardSignals[signal] || 0) + 1;
    }
  }
}
