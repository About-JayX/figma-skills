import {
  RESULT_CHUNK_MAX_BYTES,
  RESULT_CHUNK_MAX_COUNT,
  RESULT_CHUNK_MAX_TOTAL_BYTES,
} from '../bridge_config.mjs';

function parseChunkHeader(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

export function appendChunkedBody(state, key, chunkIndexHeader, chunkTotalHeader, rawBody, limits) {
  const normalized = Object.assign(
    {
      maxChunkBytes: RESULT_CHUNK_MAX_BYTES,
      maxChunkCount: RESULT_CHUNK_MAX_COUNT,
      maxTotalBytes: RESULT_CHUNK_MAX_TOTAL_BYTES,
      invalidHeadersCode: 'INVALID_CHUNK_HEADERS',
      chunkCountExceededCode: 'RESULT_CHUNK_COUNT_EXCEEDED',
      chunkTooLargeCode: 'RESULT_CHUNK_TOO_LARGE',
      totalTooLargeCode: 'RESULT_CHUNK_TOTAL_TOO_LARGE',
      chunkTotalMismatchCode: 'CHUNK_TOTAL_MISMATCH',
      missingChunkCode: 'MISSING_CHUNK',
      invalidHeadersMessage: '分块头不合法',
      chunkCountExceededMessage: '结果分块数超出上限',
      chunkTooLargeMessage: '结果单块超出上限',
      totalTooLargeMessage: '结果累计字节超出上限',
      chunkTotalMismatchMessage: '分块总数不一致',
      missingChunkMessage: '分块不完整',
    },
    limits || {}
  );
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
      error: normalized.invalidHeadersMessage,
      errorCode: normalized.invalidHeadersCode,
    };
  }

  if (chunkTotal > normalized.maxChunkCount) {
    return {
      ok: false,
      statusCode: 413,
      error: normalized.chunkCountExceededMessage,
      errorCode: normalized.chunkCountExceededCode,
    };
  }

  if (rawBody.length > normalized.maxChunkBytes) {
    return {
      ok: false,
      statusCode: 413,
      error: normalized.chunkTooLargeMessage,
      errorCode: normalized.chunkTooLargeCode,
    };
  }

  let entry = state.pendingChunks.get(key);
  if (!entry) {
    entry = {
      total: chunkTotal,
      totalBytes: 0,
      received: new Map(),
    };
    state.pendingChunks.set(key, entry);
  }

  if (entry.total !== chunkTotal) {
    state.pendingChunks.delete(key);
    return {
      ok: false,
      statusCode: 409,
      error: normalized.chunkTotalMismatchMessage,
      errorCode: normalized.chunkTotalMismatchCode,
    };
  }

  const previous = entry.received.get(chunkIndex);
  if (previous) {
    entry.totalBytes -= previous.length;
  }

  entry.received.set(chunkIndex, rawBody);
  entry.totalBytes += rawBody.length;

  if (entry.totalBytes > normalized.maxTotalBytes) {
    state.pendingChunks.delete(key);
    return {
      ok: false,
      statusCode: 413,
      error: normalized.totalTooLargeMessage,
      errorCode: normalized.totalTooLargeCode,
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
      error: normalized.missingChunkMessage,
      errorCode: normalized.missingChunkCode,
    };
  }
    parts.push(part);
  }

  state.pendingChunks.delete(key);

  return {
    ok: true,
    complete: true,
    totalChunks: chunkTotal,
    body: Buffer.concat(parts),
  };
}

export function appendJobResultChunk(
  state,
  jobId,
  chunkIndexHeader,
  chunkTotalHeader,
  rawBody
) {
  return appendChunkedBody(state, jobId, chunkIndexHeader, chunkTotalHeader, rawBody);
}
