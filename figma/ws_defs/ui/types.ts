export type UiStatusState = 'loading' | 'ok' | 'error' | '';

export interface WsDefsRuntimeConfig {
  bindHost: string;
  publicHost: string;
  port: number;
  origin: string;
  eventsUrl: string;
  extractNodeDefsUrl: string;
  extractImageAssetUrl: string;
}

export interface StatusPluginMessage {
  type: 'status';
  text: string;
  state?: UiStatusState;
  stage?: string;
  details?: Record<string, unknown> | null;
}

export interface NodeIdResultPluginMessage {
  type: 'node-id-result';
  ids: string[];
  fileKey: string | null;
}

export type PluginMessage = StatusPluginMessage | NodeIdResultPluginMessage;

export type BridgeCommandType = 'extract-node-defs' | 'extract-image-asset';

export interface BridgeCommandPayload {
  jobId?: string;
  target?: Record<string, unknown>;
  imageHash?: string;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __WS_DEFS_CONFIG__?: WsDefsRuntimeConfig;
  }
}
