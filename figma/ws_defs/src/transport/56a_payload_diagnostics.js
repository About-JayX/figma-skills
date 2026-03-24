function getPayloadValueBytes(value) {
  if (value == null) {
    return 0;
  }

  if (typeof value === 'string') {
    return getUtf8ByteLength(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return getUtf8ByteLength(value);
  }

  var estimated = estimateJsonBytes(value);
  return typeof estimated === 'number' ? estimated : 0;
}

function updateLargestNodeMetric(current, candidate) {
  if (!candidate || typeof candidate.estimatedBytes !== 'number') {
    return current;
  }

  if (!current || candidate.estimatedBytes > current.estimatedBytes) {
    return candidate;
  }

  return current;
}

function createRootSizeStats() {
  return {
    nodeCount: 0,
    textNodeCount: 0,
    textCharactersBytes: 0,
    textSegmentCount: 0,
    textSegmentCharactersBytes: 0,
    textSegmentsBytes: 0,
    cssNodeCount: 0,
    cssBytes: 0,
    svgNodeCount: 0,
    svgBytes: 0,
    maxDepth: 0,
    largestTextNode: null,
    largestCssNode: null,
    largestSvgNode: null,
  };
}

function collectRootSizeStats(node, stats, depth) {
  if (!node || typeof node !== 'object' || !stats) {
    return;
  }

  stats.nodeCount += 1;
  if (depth > stats.maxDepth) {
    stats.maxDepth = depth;
  }

  if (node.text && typeof node.text === 'object') {
    stats.textNodeCount += 1;

    var textCharactersBytes =
      typeof node.text.characters === 'string' ? getUtf8ByteLength(node.text.characters) : 0;
    stats.textCharactersBytes += textCharactersBytes;

    var segments = Array.isArray(node.text.segments) ? node.text.segments : [];
    stats.textSegmentCount += segments.length;

    var segmentCharactersBytes = 0;
    for (var i = 0; i < segments.length; i += 1) {
      var segment = segments[i];
      if (segment && typeof segment.characters === 'string') {
        segmentCharactersBytes += getUtf8ByteLength(segment.characters);
      }
    }

    stats.textSegmentCharactersBytes += segmentCharactersBytes;
    var textBytes = getPayloadValueBytes(node.text);
    stats.textSegmentsBytes += getPayloadValueBytes(segments);
    stats.largestTextNode = updateLargestNodeMetric(stats.largestTextNode, {
      id: node.id || null,
      name: typeof node.name === 'string' ? node.name : null,
      estimatedBytes: textBytes,
      charactersBytes: textCharactersBytes,
      segmentCount: segments.length,
      segmentCharacterBytes: segmentCharactersBytes,
    });
  }

  if (node.css && typeof node.css === 'object') {
    var cssBytes = getPayloadValueBytes(node.css);
    stats.cssNodeCount += 1;
    stats.cssBytes += cssBytes;
    stats.largestCssNode = updateLargestNodeMetric(stats.largestCssNode, {
      id: node.id || null,
      name: typeof node.name === 'string' ? node.name : null,
      estimatedBytes: cssBytes,
    });
  }

  if (typeof node.svgString === 'string' && node.svgString) {
    var svgBytes = getUtf8ByteLength(node.svgString);
    stats.svgNodeCount += 1;
    stats.svgBytes += svgBytes;
    stats.largestSvgNode = updateLargestNodeMetric(stats.largestSvgNode, {
      id: node.id || null,
      name: typeof node.name === 'string' ? node.name : null,
      estimatedBytes: svgBytes,
    });
  }

  var children = Array.isArray(node.children) ? node.children : [];
  for (var j = 0; j < children.length; j += 1) {
    collectRootSizeStats(children[j], stats, depth + 1);
  }
}

function buildTopLevelBytes(payload) {
  var topLevelBytes = {};
  if (!payload || typeof payload !== 'object') {
    return topLevelBytes;
  }

  for (var key in payload) {
    topLevelBytes[key] = getPayloadValueBytes(payload[key]);
  }

  return topLevelBytes;
}

function buildPayloadSizeDiagnostics(payload) {
  var diagnostics = {
    totalPayloadBytes: getPayloadValueBytes(payload),
    topLevelBytes: buildTopLevelBytes(payload),
    designSnapshot: null,
  };

  var designSnapshot = payload && payload.designSnapshot;
  if (!designSnapshot || typeof designSnapshot !== 'object') {
    return diagnostics;
  }

  var rootStats = createRootSizeStats();
  if (designSnapshot.root && typeof designSnapshot.root === 'object') {
    collectRootSizeStats(designSnapshot.root, rootStats, 0);
  }

  diagnostics.designSnapshot = {
    rootBytes: getPayloadValueBytes(designSnapshot.root),
    resourcesBytes: getPayloadValueBytes(designSnapshot.resources),
    rootStats: rootStats,
  };

  return diagnostics;
}
