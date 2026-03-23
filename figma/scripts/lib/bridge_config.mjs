import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LEGACY_HOST = process.env.FIGMA_BRIDGE_HOST || '127.0.0.1';

function parsePositiveInteger(rawValue, fallbackValue, name) {
  const value = Number(rawValue ?? fallbackValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer. Received: ${rawValue}`);
  }
  return value;
}

export const SKILL_ROOT = path.resolve(__dirname, '..', '..');

export const BRIDGE_BIND_HOST =
  process.env.FIGMA_BRIDGE_BIND_HOST || LEGACY_HOST;

export const BRIDGE_PUBLIC_HOST =
  process.env.FIGMA_BRIDGE_PUBLIC_HOST || LEGACY_HOST;

export const BRIDGE_PORT = parsePositiveInteger(
  process.env.FIGMA_BRIDGE_PORT,
  3333,
  'FIGMA_BRIDGE_PORT'
);

export const BRIDGE_ORIGIN = `http://${BRIDGE_PUBLIC_HOST}:${BRIDGE_PORT}`;
export const BRIDGE_BASE_URL = BRIDGE_ORIGIN;
export const BRIDGE_EVENTS_URL = `${BRIDGE_ORIGIN}/events`;
export const BRIDGE_SERVER_FILE = path.join(SKILL_ROOT, 'scripts', 'bridge_server.mjs');
export const CACHE_ROOT = path.join(SKILL_ROOT, 'cache');

export const STARTUP_RETRIES = parsePositiveInteger(
  process.env.FIGMA_BRIDGE_STARTUP_RETRIES,
  12,
  'FIGMA_BRIDGE_STARTUP_RETRIES'
);

export const STARTUP_WAIT_MS = parsePositiveInteger(
  process.env.FIGMA_BRIDGE_STARTUP_WAIT_MS,
  500,
  'FIGMA_BRIDGE_STARTUP_WAIT_MS'
);

export const REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.FIGMA_BRIDGE_REQUEST_TIMEOUT_MS,
  3000,
  'FIGMA_BRIDGE_REQUEST_TIMEOUT_MS'
);

export const EXTRACT_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.FIGMA_BRIDGE_EXTRACT_TIMEOUT_MS,
  180000,
  'FIGMA_BRIDGE_EXTRACT_TIMEOUT_MS'
);

export const ASSET_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.FIGMA_BRIDGE_ASSET_TIMEOUT_MS,
  120000,
  'FIGMA_BRIDGE_ASSET_TIMEOUT_MS'
);

export const JOB_TIMEOUT_MS = parsePositiveInteger(
  process.env.FIGMA_BRIDGE_JOB_TIMEOUT_MS,
  180000,
  'FIGMA_BRIDGE_JOB_TIMEOUT_MS'
);

export const ASSET_MAX_BYTES = parsePositiveInteger(
  process.env.FIGMA_BRIDGE_ASSET_MAX_BYTES,
  32 * 1024 * 1024,
  'FIGMA_BRIDGE_ASSET_MAX_BYTES'
);

export const JSON_BODY_MAX_BYTES = parsePositiveInteger(
  process.env.FIGMA_BRIDGE_JSON_BODY_MAX_BYTES,
  128 * 1024 * 1024,
  'FIGMA_BRIDGE_JSON_BODY_MAX_BYTES'
);

export const RESULT_CHUNK_SIZE_BYTES = parsePositiveInteger(
  process.env.FIGMA_BRIDGE_RESULT_CHUNK_SIZE_BYTES,
  512 * 1024,
  'FIGMA_BRIDGE_RESULT_CHUNK_SIZE_BYTES'
);

export const RESULT_CHUNK_MAX_BYTES = parsePositiveInteger(
  process.env.FIGMA_BRIDGE_RESULT_CHUNK_MAX_BYTES,
  RESULT_CHUNK_SIZE_BYTES,
  'FIGMA_BRIDGE_RESULT_CHUNK_MAX_BYTES'
);

export const RESULT_CHUNK_MAX_TOTAL_BYTES = parsePositiveInteger(
  process.env.FIGMA_BRIDGE_RESULT_CHUNK_MAX_TOTAL_BYTES,
  24 * 1024 * 1024,
  'FIGMA_BRIDGE_RESULT_CHUNK_MAX_TOTAL_BYTES'
);

export const RESULT_CHUNK_MAX_COUNT = parsePositiveInteger(
  process.env.FIGMA_BRIDGE_RESULT_CHUNK_MAX_COUNT,
  Math.ceil(RESULT_CHUNK_MAX_TOTAL_BYTES / RESULT_CHUNK_SIZE_BYTES),
  'FIGMA_BRIDGE_RESULT_CHUNK_MAX_COUNT'
);

export function getBridgeRuntimeConfig() {
  return {
    bindHost: BRIDGE_BIND_HOST,
    publicHost: BRIDGE_PUBLIC_HOST,
    port: BRIDGE_PORT,
    origin: BRIDGE_ORIGIN,
    eventsUrl: BRIDGE_EVENTS_URL,
    extractNodeDefsUrl: `${BRIDGE_ORIGIN}/extract-node-defs`,
    extractImageAssetUrl: `${BRIDGE_ORIGIN}/extract-image-asset`,
    resultTransport: {
      chunkSizeBytes: RESULT_CHUNK_SIZE_BYTES,
      maxChunkBytes: RESULT_CHUNK_MAX_BYTES,
      maxTotalBytes: RESULT_CHUNK_MAX_TOTAL_BYTES,
      maxChunkCount: RESULT_CHUNK_MAX_COUNT,
    },
  };
}

export function getWsDefsManifestNetworkAccess() {
  return {
    allowedDomains: ['none'],
    devAllowedDomains: [BRIDGE_ORIGIN],
  };
}
