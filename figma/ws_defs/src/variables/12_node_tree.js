function getNodeChildren(node) {
  if (!node || !node.children || !Array.isArray(node.children)) {
    return [];
  }

  return node.children;
}

function collectSubtreeNodes(rootNode) {
  const stack = [rootNode];
  const nodes = [];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }

    nodes.push(node);

    const children = getNodeChildren(node);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]);
    }
  }

  return nodes;
}

function findPageNode(node) {
  let current = node;

  while (current && current.type !== 'PAGE') {
    current = current.parent;
  }

  return current && current.type === 'PAGE' ? current : null;
}

function serializeNodeInfo(node) {
  const page = findPageNode(node);

  return {
    id: node.id,
    name: typeof node.name === 'string' ? node.name : '',
    type: node.type,
    pageId: page ? page.id : null,
    pageName: page ? page.name : null,
  };
}
