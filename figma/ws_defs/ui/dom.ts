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
        // Always output a full Figma URL, even if fileKey is unknown.
        // Use placeholder so downstream tools get a parseable URL rather than a bare node-id.
        const key = fileKey || 'DRAFT';
        return (
          'https://www.figma.com/design/' +
          key +
          '?node-id=' +
          encodeURIComponent(id)
        );
      });
      nodeIdEl.textContent = lines.join('\n');
      nodeIdEl.style.background = '#e3f9e5';
      nodeIdEl.style.whiteSpace = 'pre-wrap';
      appendLog('Selected nodes: ' + lines.join(', '));
    } else {
      nodeIdEl.textContent = 'No nodes are currently selected';
      nodeIdEl.style.background = '#ffeef0';
    }
  }

  async function copyNodeIdText(): Promise<void> {
    if (nodeIdEl.textContent) {
      await navigator.clipboard.writeText(nodeIdEl.textContent);
      appendLog('Copied: ' + nodeIdEl.textContent);
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
