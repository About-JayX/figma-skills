import { createBridgeConnection } from './bridge_sse';
import { createUiDomController } from './dom';
import { forwardBridgeCommand, readPluginMessage, requestSelectedNodeIds } from './plugin_api';

function boot(): void {
  const config = window.__WS_DEFS_CONFIG__;
  if (!config) {
    throw new Error('window.__WS_DEFS_CONFIG__ is not defined');
  }

  const dom = createUiDomController();

  const bridge = createBridgeConnection({
    eventsUrl: config.eventsUrl,
    onBridgeStatus: dom.setBridgeStatus,
    forwardBridgeCommand,
  });

  // Button bindings
  dom.reconnectButton.addEventListener('click', () => {
    bridge.reconnect();
  });

  dom.nodeIdButton.addEventListener('click', () => {
    requestSelectedNodeIds();
  });

  dom.nodeIdEl.addEventListener('click', () => {
    void dom.copyNodeIdText();
  });

  // Plugin message handler
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    const msg = readPluginMessage(event);
    if (!msg) {
      return;
    }

    if (msg.type === 'status') {
      dom.setStatus(msg.text, msg.state);
    }

    if (msg.type === 'node-id-result') {
      dom.renderNodeIdResult(msg.ids, msg.fileKey);
    }
  });

  // Start SSE connection
  bridge.connect();
}

boot();
