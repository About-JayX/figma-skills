async function findNodeByIdAcrossLoadedPages(nodeId) {
  const initial = await figma.getNodeByIdAsync(nodeId);
  if (initial) {
    return initial;
  }

  const pages = Array.isArray(figma.root.children) ? figma.root.children : [];
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    if (!page || page.type !== 'PAGE') {
      continue;
    }

    try {
      if (typeof page.loadAsync === 'function') {
        await page.loadAsync();
      }
    } catch (error) {
      continue;
    }

    const node = await figma.getNodeByIdAsync(nodeId);
    if (node) {
      return node;
    }
  }

  return null;
}

async function findNodeByIdWithLazyPageLoading(nodeId, options) {
  const initial = await findNodeByIdAcrossLoadedPages(nodeId);
  if (initial) {
    return initial;
  }

  const shouldIncludeInvisible = !!(
    options && options.includeInvisibleInstanceChildren === true
  );
  if (
    !shouldIncludeInvisible ||
    typeof figma.skipInvisibleInstanceChildren !== 'boolean' ||
    figma.skipInvisibleInstanceChildren === false
  ) {
    return initial;
  }

  const previous = figma.skipInvisibleInstanceChildren;
  figma.skipInvisibleInstanceChildren = false;
  try {
    return await findNodeByIdAcrossLoadedPages(nodeId);
  } finally {
    figma.skipInvisibleInstanceChildren = previous;
  }
}
