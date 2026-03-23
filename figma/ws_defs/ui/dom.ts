import type { UiStatusState } from './types';

function getElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing DOM element: #${id}`);
  }
  return el as T;
}

export function createUiDomController() {
  const bridgeEl = getElement<HTMLDivElement>('bridge');
  const statusEl = getElement<HTMLDivElement>('status');
  const nodeIdEl = getElement<HTMLDivElement>('node-id');
  const logEl = getElement<HTMLDivElement>('log');
  const reconnectButton = getElement<HTMLButtonElement>('reconnect-button');
  const nodeIdButton = getElement<HTMLButtonElement>('get-node-id-button');

  let lastBridgeStatus = '';

  function appendLog(text: string): void {
    logEl.innerHTML =
      new Date().toLocaleTimeString() + ' ' + text + '<br>' + logEl.innerHTML;
  }

  function setStatus(text: string, state?: UiStatusState): void {
    statusEl.textContent = text;
    statusEl.className = state || '';
    appendLog(text);
  }

  function setBridgeStatus(text: string, state?: UiStatusState): void {
    bridgeEl.textContent = text;
    bridgeEl.className = state || '';

    const key = text + '|' + (state || '');
    if (lastBridgeStatus !== key) {
      lastBridgeStatus = key;
      appendLog(text);
    }
  }

  function renderNodeIdResult(ids: string[], fileKey: string | null): void {
    nodeIdEl.style.display = 'block';

    if (ids && ids.length > 0) {
      const lines = ids.map((id) => {
        if (fileKey) {
          return (
            'https://www.figma.com/design/' +
            fileKey +
            '?node-id=' +
            encodeURIComponent(id)
          );
        }
        return id;
      });
      nodeIdEl.textContent = lines.join('\n');
      nodeIdEl.style.background = '#e3f9e5';
      nodeIdEl.style.whiteSpace = 'pre-wrap';
      appendLog('选中节点: ' + lines.join(', '));
    } else {
      nodeIdEl.textContent = '未选中任何节点';
      nodeIdEl.style.background = '#ffeef0';
    }
  }

  async function copyNodeIdText(): Promise<void> {
    if (nodeIdEl.textContent) {
      await navigator.clipboard.writeText(nodeIdEl.textContent);
      appendLog('已复制: ' + nodeIdEl.textContent);
    }
  }

  return {
    appendLog,
    setStatus,
    setBridgeStatus,
    renderNodeIdResult,
    copyNodeIdText,
    reconnectButton,
    nodeIdButton,
    nodeIdEl,
  };
}
