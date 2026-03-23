import type { BridgeCommandPayload, BridgeCommandType, UiStatusState } from './types';

interface BridgeConnectionOptions {
  eventsUrl: string;
  onBridgeStatus: (text: string, state: UiStatusState) => void;
  forwardBridgeCommand: (
    type: BridgeCommandType,
    payload: BridgeCommandPayload
  ) => void;
}

export function createBridgeConnection(options: BridgeConnectionOptions) {
  const { eventsUrl, onBridgeStatus, forwardBridgeCommand } = options;
  let eventSource: EventSource | null = null;

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

    onBridgeStatus('Bridge SSE 连接中...', 'loading');
    eventSource = new EventSource(eventsUrl);

    eventSource.addEventListener('ready', () => {
      onBridgeStatus('Bridge SSE 已连接', 'ok');
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
    };
  }

  function disconnect(): void {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  function reconnect(): void {
    connect();
  }

  return {
    connect,
    disconnect,
    reconnect,
  };
}
