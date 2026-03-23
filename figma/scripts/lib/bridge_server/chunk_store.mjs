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

  let entry = state.pendingChunks.get(jobId);
  if (!entry) {
    entry = {
      total: chunkTotal,
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

  entry.received.set(chunkIndex, rawBody);

  if (entry.received.size < chunkTotal) {
    return {
      ok: true,
      complete: false,
      chunkIndex,
      pending: chunkTotal - entry.received.size,
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
    body: Buffer.concat(parts).toString('utf8'),
  };
}
