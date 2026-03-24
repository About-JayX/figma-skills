import fs from 'fs';
import path from 'path';

import { CACHE_ROOT } from '../bridge_config.mjs';
import { sanitizePathPart } from '../bridge_cache.mjs';

function ensurePendingBlobDir(jobId) {
  const dir = path.join(CACHE_ROOT, '_pending', sanitizePathPart(jobId), 'blobs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function storePendingBlob(state, jobId, blobData) {
  if (!state.pendingBlobs.has(jobId)) {
    state.pendingBlobs.set(jobId, []);
  }

  const dir = ensurePendingBlobDir(jobId);
  const ext = sanitizePathPart(blobData.ext || 'bin');
  const fileName = `${sanitizePathPart(blobData.kind || 'blob')}-${sanitizePathPart(blobData.nodeId || blobData.blobId || 'unknown')}.${ext}`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, blobData.bytes);

  const metadata = {
    kind: blobData.kind || 'blob',
    blobId: blobData.blobId || null,
    nodeId: blobData.nodeId || null,
    ext,
    fileName,
    localPath: filePath,
    byteLength: blobData.bytes.length,
    receivedAt: blobData.receivedAt || new Date().toISOString(),
  };

  state.pendingBlobs.get(jobId).push(metadata);
  return metadata;
}

export function getPendingBlobs(state, jobId) {
  return state.pendingBlobs.get(jobId) || [];
}
