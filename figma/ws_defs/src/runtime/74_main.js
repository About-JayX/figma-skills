async function main() {
  if (typeof figma.skipInvisibleInstanceChildren === 'boolean') {
    figma.skipInvisibleInstanceChildren = true;
  }

  figma.ui.postMessage({
    type: 'status',
    text: '已就绪，等待 Bridge 下发 extract-node-defs / extract-image-asset 指令',
    state: 'ok',
  });
}

const startupPromise = main();

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'get-node-id') {
    const selection = figma.currentPage.selection;
    const ids = selection.map(function (node) { return node.id; });
    const fk = null;
    figma.ui.postMessage({ type: 'node-id-result', ids: ids, fileKey: fk });
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
        text: '初始化失败: ' + (error instanceof Error ? error.message : String(error)),
        state: 'error',
      });
    }
  }
};

startupPromise.catch((error) => {
  figma.ui.postMessage({
    type: 'status',
    text: '初始化失败: ' + (error instanceof Error ? error.message : String(error)),
    state: 'error',
  });
});

