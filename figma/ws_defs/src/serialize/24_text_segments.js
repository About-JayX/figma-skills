function serializeTextSegments(node, variableCache) {
  if (!node || typeof node.getStyledTextSegments !== 'function') {
    return [];
  }

  const preferredFields = [
    'fontName',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'fills',
    'textStyleId',
    'fillStyleId',
    'lineHeight',
    'letterSpacing',
    'textDecoration',
    'textDecorationStyle',
    'textDecorationOffset',
    'textDecorationThickness',
    'textDecorationColor',
    'textDecorationSkipInk',
    'textCase',
    'listOptions',
    'listSpacing',
    'indentation',
    'paragraphIndent',
    'paragraphSpacing',
    'hyperlink',
    'boundVariables',
    'textStyleOverrides',
    'openTypeFeatures',
  ];
  const variableFallbackFields = [
    'fontName',
    'fontSize',
    'fills',
    'textStyleId',
    'fillStyleId',
    'lineHeight',
    'letterSpacing',
    'textDecoration',
    'textCase',
    'listOptions',
    'listSpacing',
    'paragraphIndent',
    'paragraphSpacing',
    'hyperlink',
    'boundVariables',
    'openTypeFeatures',
  ];
  const fallbackFields = ['fontName', 'fontSize', 'fills', 'lineHeight', 'letterSpacing'];
  let segments = [];

  try {
    segments = node.getStyledTextSegments(preferredFields);
  } catch (error) {
    try {
      segments = node.getStyledTextSegments(variableFallbackFields);
    } catch (innerError) {
      try {
        segments = node.getStyledTextSegments(fallbackFields);
      } catch (finalError) {
        return [];
      }
    }
  }

  if (!Array.isArray(segments)) {
    return [];
  }

  const output = [];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (!segment) {
      continue;
    }

    const serializedSegment = {
      characters: typeof segment.characters === 'string' ? segment.characters : '',
      start: typeof segment.start === 'number' ? segment.start : null,
      end: typeof segment.end === 'number' ? segment.end : null,
      fontName: serializeFontName(segment.fontName),
      fontSize: typeof segment.fontSize === 'number' ? roundNumber(segment.fontSize) : null,
      fills: serializePaintList(segment.fills, variableCache),
      lineHeight: serializeLineHeight(segment.lineHeight),
      letterSpacing: serializeLetterSpacing(segment.letterSpacing),
      textDecoration: segment.textDecoration || null,
      textCase: segment.textCase || null,
      textStyleId: typeof segment.textStyleId === 'string' ? segment.textStyleId : null,
      fillStyleId: typeof segment.fillStyleId === 'string' ? segment.fillStyleId : null,
      hyperlink: serializeHyperlink(segment.hyperlink),
      fontWeight: typeof segment.fontWeight === 'number' ? segment.fontWeight : null,
      fontStyle: typeof segment.fontStyle === 'string' ? segment.fontStyle : null,
      openTypeFeatures: isPlainObject(segment.openTypeFeatures)
        ? serializeStructuredValue(segment.openTypeFeatures, variableCache)
        : null,
      textStyleOverrides: segment.textStyleOverrides
        ? serializeStructuredValue(segment.textStyleOverrides, variableCache)
        : null,
      textDecorationStyle: segment.textDecorationStyle || null,
      textDecorationOffset: serializeStructuredValue(segment.textDecorationOffset, variableCache),
      textDecorationThickness: serializeStructuredValue(
        segment.textDecorationThickness,
        variableCache
      ),
      textDecorationColor: isColorObject(segment.textDecorationColor)
        ? serializeColorValue(segment.textDecorationColor)
        : null,
      textDecorationSkipInk: serializeStructuredValue(
        segment.textDecorationSkipInk,
        variableCache
      ),
      listOptions: serializeStructuredValue(segment.listOptions, variableCache),
      listSpacing: serializeStructuredValue(segment.listSpacing, variableCache),
      indentation: serializeStructuredValue(segment.indentation, variableCache),
      paragraphIndent: serializeStructuredValue(segment.paragraphIndent, variableCache),
      paragraphSpacing: serializeStructuredValue(segment.paragraphSpacing, variableCache),
    };

    if (segment.boundVariables) {
      serializedSegment.boundVariables = serializeVariableBindingTree(
        segment.boundVariables,
        variableCache
      );
    }

    output.push(serializedSegment);
  }

  return output;
}

