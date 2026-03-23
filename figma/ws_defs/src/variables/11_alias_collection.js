function collectAliasIdsFromValue(value, aliasIds) {
  if (value == null) {
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      collectAliasIdsFromValue(value[i], aliasIds);
    }
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  if (value.type === 'VARIABLE_ALIAS' && typeof value.id === 'string') {
    aliasIds.add(value.id);
    return;
  }

  for (const key in value) {
    collectAliasIdsFromValue(value[key], aliasIds);
  }
}

function collectNodeAliasIds(node, aliasIds) {
  collectAliasIdsFromValue(node.boundVariables, aliasIds);
  collectAliasIdsFromValue(node.inferredVariables, aliasIds);
  collectAliasIdsFromValue(node.fills, aliasIds);
  collectAliasIdsFromValue(node.strokes, aliasIds);
  collectAliasIdsFromValue(node.effects, aliasIds);
  collectAliasIdsFromValue(node.layoutGrids, aliasIds);
  collectAliasIdsFromValue(node.backgrounds, aliasIds);

  const componentPropertiesResult = safeReadNodeProperty(node, 'componentProperties');
  if (!componentPropertiesResult.error && componentPropertiesResult.value) {
    collectAliasIdsFromValue(componentPropertiesResult.value, aliasIds);
  }

  const componentPropertyDefinitionsResult = safeReadNodeProperty(
    node,
    'componentPropertyDefinitions'
  );
  if (!componentPropertyDefinitionsResult.error && componentPropertyDefinitionsResult.value) {
    collectAliasIdsFromValue(componentPropertyDefinitionsResult.value, aliasIds);
  }

  if (node && node.type === 'TEXT' && typeof node.getStyledTextSegments === 'function') {
    try {
      const segments = node.getStyledTextSegments(['boundVariables']);
      if (Array.isArray(segments)) {
        for (let i = 0; i < segments.length; i += 1) {
          const segment = segments[i];
          if (!segment) {
            continue;
          }
          collectAliasIdsFromValue(segment.boundVariables, aliasIds);
        }
      }
    } catch (error) {
      // ignore best-effort text segment alias probing
    }
  }
}
