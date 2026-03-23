import type {
  BridgeCommandPayload,
  BridgeCommandType,
  PluginMessage,
} from './types';

export function postPluginMessage(message: unknown): void {
  parent.postMessage({ pluginMessage: message }, '*');
}

export function requestSelectedNodeIds(): void {
  postPluginMessage({ type: 'get-node-id' });
}

export function forwardBridgeCommand(
  type: BridgeCommandType,
  payload: BridgeCommandPayload
): void {
  postPluginMessage({
    type,
    payload,
  });
}

export function readPluginMessage(
  event: MessageEvent<unknown>
): PluginMessage | null {
  const data = event.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') {
    return null;
  }

  const msg = data.pluginMessage as Record<string, unknown> | undefined;
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    return null;
  }

  return msg as unknown as PluginMessage;
}
