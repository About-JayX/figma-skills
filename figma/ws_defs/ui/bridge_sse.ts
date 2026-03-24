import type { BridgeCommandPayload, BridgeCommandType, UiStatusState } from './types';

interface BridgeConnectionOptions {
  eventsUrl: string;
  originUrl: string;
  onBridgeStatus: (text: string, state: UiStatusState) => void;
  forwardBridgeCommand: (
    type: BridgeCommandType,
    payload: BridgeCommandPayload
  ) => void;
}

export function createBridgeConnection(options: BridgeConnectionOptions) {
  const { eventsUrl, originUrl, onBridgeStatus, forwardBridgeCommand } = options;
  let eventSource: EventSource | null = null;
  let currentClientId: string | null = null;
  let currentFileKey: string | null = null;
  let currentDocumentName: string | null = null;

  function doRegister(clientId: string, fileKey: string | null, documentName: string | null): void {
    const body: Record<string, unknown> = { clientId, fileKey };
    if (documentName) { body.documentName = documentName; }
    fetch(originUrl + '/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((res) => {
      if (res.ok) {
        const label = fileKey || documentName || '(unknown)';
        onBridgeStatus('Bridge SSE 已连接 (fileKey: ' + label + ')', 'ok');
      }
    }).catch(() => {
      // registration is best-effort
    });
  }

  function tryRegister(): void {
    if (currentClientId && (currentFileKey || currentDocumentName)) {
      doRegister(currentClientId, currentFileKey, currentDocumentName);
    }
  }

  /** Called by main when plugin sends filekey-info. */
  function registerFileKey(fileKey: string | null, documentName?: string | null): void {
    currentFileKey = fileKey;
    if (documentName !== undefined) { currentDocumentName = documentName; }
    tryRegister();
  }

  function handleBridgeJob(
    eventName: string,
    event: MessageEvent<string>,
    forwardType: BridgeCommandType
  ): void {
    try {
      const payload = JSON.parse(event.data || '{}') as BridgeCommandPayload;
      if (!payload.jobId) {
        onBridgeStatus('收到无效 job，已忽略', 'error');
        return;
      }

      onBridgeStatus('收到 ' + eventName + ' job ' + payload.jobId, 'ok');
      forwardBridgeCommand(forwardType, payload);
    } catch {
      onBridgeStatus('Bridge 事件解析失败', 'error');
    }
  }

  function connect(): void {
    if (eventSource) {
      eventSource.close();
    }

    currentClientId = null;
    onBridgeStatus('Bridge SSE 连接中...', 'loading');
    eventSource = new EventSource(eventsUrl);

    eventSource.addEventListener('ready', (event) => {
      onBridgeStatus('Bridge SSE 已连接', 'ok');
      try {
        const data = JSON.parse((event as MessageEvent<string>).data || '{}');
        if (data.clientId) {
          currentClientId = data.clientId;
          // Auto-register if fileKey already known (covers reconnect & early filekey-info)
          tryRegister();
        }
      } catch {
        // ready event data parse failure is non-fatal
      }
    });

    eventSource.addEventListener('extract-node-defs', (event) => {
      handleBridgeJob(
        'extract-node-defs',
        event as MessageEvent<string>,
        'extract-node-defs'
      );
    });

    eventSource.addEventListener('extract-image-asset', (event) => {
      handleBridgeJob(
        'extract-image-asset',
        event as MessageEvent<string>,
        'extract-image-asset'
      );
    });

    eventSource.onerror = () => {
      onBridgeStatus('Bridge SSE 已断开，等待重连...', 'error');
      // EventSource auto-reconnects; on next ready event, currentClientId will update
      // and tryRegister() will fire with the cached currentFileKey.
      currentClientId = null;
    };
  }

  function disconnect(): void {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    currentClientId = null;
  }

  function reconnect(): void {
    connect();
  }

  return {
    connect,
    disconnect,
    reconnect,
    registerFileKey,
  };
}
