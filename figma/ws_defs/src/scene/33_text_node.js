function serializeTextNode(node, collector, variableCache) {
  if (!node || node.type !== 'TEXT' && node.type !== 'TEXT_PATH') {
    return null;
  }

  const text = {
    characters: typeof node.characters === 'string' ? node.characters : '',
    fontName: serializeFontName(node.fontName),
    fontSize: typeof node.fontSize === 'number' ? roundNumber(node.fontSize) : null,
    lineHeight: serializeLineHeight(node.lineHeight),
    letterSpacing: serializeLetterSpacing(node.letterSpacing),
    textAlignHorizontal: node.textAlignHorizontal || null,
    textAlignVertical: node.textAlignVertical || null,
    textAutoResize: node.textAutoResize || null,
    paragraphSpacing:
      typeof node.paragraphSpacing === 'number' ? roundNumber(node.paragraphSpacing) : null,
    paragraphIndent:
      typeof node.paragraphIndent === 'number' ? roundNumber(node.paragraphIndent) : null,
    listSpacing: typeof node.listSpacing === 'number' ? roundNumber(node.listSpacing) : null,
    textCase: node.textCase || null,
    textDecoration: node.textDecoration || null,
    fills: serializePaintList(node.fills, variableCache),
    textStyleId: typeof node.textStyleId === 'string' ? node.textStyleId : null,
    fillStyleId: typeof node.fillStyleId === 'string' ? node.fillStyleId : null,
    segments: serializeTextSegments(node, variableCache),
  };

  const nodeProperties = [
    'textDecorationStyle',
    'textDecorationOffset',
    'textDecorationThickness',
    'textDecorationColor',
    'textDecorationSkipInk',
    'leadingTrim',
    'hangingPunctuation',
    'hangingList',
    'openTypeFeatures',
    'hyperlink',
  ];

  for (let i = 0; i < nodeProperties.length; i += 1) {
    const key = nodeProperties[i];
    const result = safeReadNodeProperty(node, key);
    if (result.error || result.value == null) {
      continue;
    }

    if (key === 'textDecorationColor' && isColorObject(result.value)) {
      text[key] = serializeColorValue(result.value);
      continue;
    }

    if (key === 'hyperlink') {
      text[key] = serializeHyperlink(result.value);
      continue;
    }

    text[key] = serializeStructuredValue(result.value, variableCache);
  }

  registerFontUsage(collector, text.fontName);
  for (let i = 0; i < text.segments.length; i += 1) {
    registerFontUsage(collector, text.segments[i].fontName);
  }

  return text;
}
