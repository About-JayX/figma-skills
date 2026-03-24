import {
  RESULT_CHUNK_MAX_BYTES,
  RESULT_CHUNK_MAX_COUNT,
  RESULT_CHUNK_MAX_TOTAL_BYTES,
} from '../bridge_config.mjs';

function parseChunkHeader(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

export function appendJobResultChunk(
  state,
  jobId,
  chunkIndexHeader,
  chunkTotalHeader,
  rawBody
) {
  const chunkIndex = parseChunkHeader(chunkIndexHeader);
  const chunkTotal = parseChunkHeader(chunkTotalHeader);

  if (
    chunkIndex == null ||
    chunkTotal == null ||
    chunkIndex < 0 ||
    chunkTotal <= 0 ||
    chunkIndex >= chunkTotal
  ) {
    return {
      ok: false,
      statusCode: 400,
      error: '分块头不合法',
      errorCode: 'INVALID_CHUNK_HEADERS',
    };
  }

  if (chunkTotal > RESULT_CHUNK_MAX_COUNT) {
    return {
      ok: false,
      statusCode: 413,
      error: '结果分块数超出上限',
      errorCode: 'RESULT_CHUNK_COUNT_EXCEEDED',
    };
  }

  if (rawBody.length > RESULT_CHUNK_MAX_BYTES) {
    return {
      ok: false,
      statusCode: 413,
      error: '结果单块超出上限',
      errorCode: 'RESULT_CHUNK_TOO_LARGE',
    };
  }

  let entry = state.pendingChunks.get(jobId);
  if (!entry) {
    entry = {
      total: chunkTotal,
      totalBytes: 0,
      received: new Map(),
    };
    state.pendingChunks.set(jobId, entry);
  }

  if (entry.total !== chunkTotal) {
    state.pendingChunks.delete(jobId);
    return {
      ok: false,
      statusCode: 409,
      error: '分块总数不一致',
      errorCode: 'CHUNK_TOTAL_MISMATCH',
    };
  }

  const previous = entry.received.get(chunkIndex);
  if (previous) {
    entry.totalBytes -= previous.length;
  }

  entry.received.set(chunkIndex, rawBody);
  entry.totalBytes += rawBody.length;

  if (entry.totalBytes > RESULT_CHUNK_MAX_TOTAL_BYTES) {
    state.pendingChunks.delete(jobId);
    return {
      ok: false,
      statusCode: 413,
      error: '结果累计字节超出上限',
      errorCode: 'RESULT_CHUNK_TOTAL_TOO_LARGE',
    };
  }

  if (entry.received.size < chunkTotal) {
    return {
      ok: true,
      complete: false,
      chunkIndex,
      pending: chunkTotal - entry.received.size,
      receivedBytes: entry.totalBytes,
    };
  }

  const parts = [];
  for (let index = 0; index < chunkTotal; index += 1) {
    const part = entry.received.get(index);
    if (!part) {
      state.pendingChunks.delete(jobId);
      return {
        ok: false,
        statusCode: 400,
        error: '分块不完整',
        errorCode: 'MISSING_CHUNK',
      };
    }
    parts.push(part);
  }

  state.pendingChunks.delete(jobId);

  return {
    ok: true,
    complete: true,
    totalChunks: chunkTotal,
    body: Buffer.concat(parts),
  };
}
