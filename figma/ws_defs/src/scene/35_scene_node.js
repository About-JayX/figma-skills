async function serializeSceneNode(node, variableCache, collector, depth, childIndex) {
  registerNodeType(collector, node.type);

  const sceneNode = {
    id: node.id,
    name: typeof node.name === 'string' ? node.name : '',
    type: node.type,
    depth: depth,
    childIndex: childIndex,
    visible: node.visible !== false,
  };

  if (hasNodeProperty(node, 'locked') && typeof node.locked === 'boolean') {
    sceneNode.locked = node.locked;
  }
  if (hasNodeProperty(node, 'rotation') && typeof node.rotation === 'number') {
    sceneNode.rotation = roundNumber(node.rotation);
  }
  if (hasNodeProperty(node, 'isMask') && typeof node.isMask === 'boolean') {
    sceneNode.isMask = node.isMask;
  }
  if (hasNodeProperty(node, 'maskType') && typeof node.maskType === 'string') {
    sceneNode.maskType = node.maskType;
  }

  const layout = serializeNodeLayout(node);
  if (countKeys(layout) > 0) {
    sceneNode.layout = layout;
  }

  const style = serializeNodeStyle(node, variableCache);
  if (countKeys(style) > 0) {
    sceneNode.style = style;
    registerImagePaints(collector, style.fills);
    registerImagePaints(collector, style.strokes);
    registerImagePaints(collector, style.backgrounds);
    registerEffects(collector, style.effects);
  }

  const text = serializeTextNode(node, collector, variableCache);
  if (text) {
    sceneNode.text = text;
    registerImagePaints(collector, text.fills);
  }

  const component = await serializeComponentInfo(node, variableCache);
  if (component) {
    sceneNode.component = component;
    registerComponentUsage(collector, component);
  }

  const vector = serializeVectorInfo(node);
  if (vector) {
    sceneNode.vector = vector;
  }

  const boundVariables = serializeVariableBindingTree(node.boundVariables, variableCache);
  const inferredVariables = serializeVariableBindingTree(node.inferredVariables, variableCache);
  const resolvedModes = serializeResolvedModes(node.resolvedVariableModes);
  if (boundVariables || inferredVariables || resolvedModes) {
    sceneNode.variables = {
      bound: boundVariables,
      inferred: inferredVariables,
    };
    if (resolvedModes) {
      sceneNode.variables.resolvedModes = resolvedModes;
    }
  }

  const replay = buildReplayMetadata(sceneNode);
  if (replay) {
    sceneNode.replay = replay;
    registerReplayMetadata(collector, replay);
  }

  const children = getNodeChildren(node);
  if (children.length > 0) {
    sceneNode.children = [];
    for (let i = 0; i < children.length; i += 1) {
      sceneNode.children.push(
        await serializeSceneNode(children[i], variableCache, collector, depth + 1, i)
      );
    }
  }

  return sceneNode;
}


