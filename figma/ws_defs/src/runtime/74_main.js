async function main() {
  if (typeof figma.skipInvisibleInstanceChildren === 'boolean') {
    figma.skipInvisibleInstanceChildren = false;
  }

  // Send fileKey to UI for bridge registration.
  // For local drafts figma.fileKey may be undefined; use root name as stable fallback.
  var fk = typeof figma.fileKey === 'string' ? figma.fileKey : null;
  var docName = figma.root && typeof figma.root.name === 'string' ? figma.root.name : null;
  figma.ui.postMessage({ type: 'filekey-info', fileKey: fk, documentName: docName });

  figma.ui.postMessage({
    type: 'status',
    text: 'Ready and waiting for Bridge commands: extract-node-defs / extract-image-asset',
    state: 'ok',
  });
}

const startupPromise = main();

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'get-node-id') {
    const selection = figma.currentPage.selection;
    const ids = selection.map(function (node) { return node.id; });
    var nodeFk = typeof figma.fileKey === 'string' ? figma.fileKey : null;
    var nodeDocName = figma.root && typeof figma.root.name === 'string' ? figma.root.name : null;
    figma.ui.postMessage({ type: 'node-id-result', ids: ids, fileKey: nodeFk, documentName: nodeDocName });
    return;
  }

  if (msg.type === 'extract-node-defs' || msg.type === 'extract-image-asset') {
    try {
      await startupPromise;
      enqueueJob(
        Object.assign({}, msg.payload || {}, {
          __commandType: msg.type,
        })
      );
    } catch (error) {
      figma.ui.postMessage({
        type: 'status',
        text: 'Initialization failed: ' + (error instanceof Error ? error.message : String(error)),
        state: 'error',
      });
    }
  }
};

startupPromise.catch((error) => {
  figma.ui.postMessage({
    type: 'status',
    text: 'Initialization failed: ' + (error instanceof Error ? error.message : String(error)),
    state: 'error',
  });
});
