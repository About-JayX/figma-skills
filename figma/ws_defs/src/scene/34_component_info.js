async function resolveMainComponentInfo(node) {
  if (!node) {
    return {
      value: null,
      error: null,
    };
  }

  if (node.type === 'INSTANCE' && typeof node.getMainComponentAsync === 'function') {
    try {
      return {
        value: await node.getMainComponentAsync(),
        error: null,
      };
    } catch (error) {
      return {
        value: null,
        error: error,
      };
    }
  }

  const mainComponentResult = safeReadNodeProperty(node, 'mainComponent');
  return {
    value: mainComponentResult.value,
    error: mainComponentResult.error,
  };
}

async function serializeComponentInfo(node, variableCache) {
  const component = {};
  const readErrors = [];

  const componentDefinitionsResult = safeReadNodeProperty(node, 'componentPropertyDefinitions');
  if (componentDefinitionsResult.error) {
    readErrors.push(
      serializeReadError('componentPropertyDefinitions', componentDefinitionsResult.error)
    );
  } else if (componentDefinitionsResult.value) {
    component.componentPropertyDefinitions = serializeComponentPropertyDefinitions(
      componentDefinitionsResult.value,
      variableCache
    );
  }

  const componentPropertiesResult = safeReadNodeProperty(node, 'componentProperties');
  if (componentPropertiesResult.error) {
    readErrors.push(serializeReadError('componentProperties', componentPropertiesResult.error));
  } else if (componentPropertiesResult.value) {
    component.componentProperties = serializeComponentProperties(
      componentPropertiesResult.value,
      variableCache
    );
  }

  const componentPropertyReferencesResult = safeReadNodeProperty(node, 'componentPropertyReferences');
  if (componentPropertyReferencesResult.error) {
    readErrors.push(
      serializeReadError(
        'componentPropertyReferences',
        componentPropertyReferencesResult.error
      )
    );
  } else if (componentPropertyReferencesResult.value) {
    component.componentPropertyReferences = serializeStructuredValue(
      componentPropertyReferencesResult.value,
      variableCache
    );
  }

  const variantPropertiesResult = safeReadNodeProperty(node, 'variantProperties');
  if (variantPropertiesResult.error) {
    readErrors.push(serializeReadError('variantProperties', variantPropertiesResult.error));
  } else if (variantPropertiesResult.value) {
    component.variantProperties = serializeStructuredValue(
      variantPropertiesResult.value,
      variableCache
    );
  }

  const mainComponentResult = await resolveMainComponentInfo(node);
  if (mainComponentResult.error) {
    readErrors.push(serializeReadError('mainComponent', mainComponentResult.error));
  } else if (mainComponentResult.value) {
    component.key =
      typeof mainComponentResult.value.key === 'string' ? mainComponentResult.value.key : null;
    component.name =
      typeof mainComponentResult.value.name === 'string' ? mainComponentResult.value.name : null;
    component.id =
      typeof mainComponentResult.value.id === 'string' ? mainComponentResult.value.id : null;
  } else if (hasNodeProperty(node, 'key') && typeof node.key === 'string') {
    component.key = node.key;
    component.name = typeof node.name === 'string' ? node.name : null;
    component.id = typeof node.id === 'string' ? node.id : null;
  }

  if (readErrors.length > 0) {
    component.readErrors = readErrors.filter(Boolean);
  }

  return countKeys(component) > 0 ? component : null;
}
