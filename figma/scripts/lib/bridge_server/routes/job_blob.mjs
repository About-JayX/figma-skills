import {
  BLOB_CHUNK_MAX_COUNT,
  BLOB_CHUNK_MAX_TOTAL_BYTES,
  RESULT_CHUNK_MAX_BYTES,
  RESULT_CHUNK_SIZE_BYTES,
} from '../../bridge_config.mjs';
import { readBinaryBody, writeJson } from '../../bridge_http.mjs';
import { storePendingBlob } from '../blob_store.mjs';
import { appendChunkedBody } from '../chunk_store.mjs';
import { getPendingJob } from '../job_store.mjs';

function buildBlobKey(jobId, blobId) {
  return `blob:${jobId}:${blobId}`;
}

export async function handleJobBlobRequest(state, req, res, jobId) {
  const job = getPendingJob(state, jobId);
  if (!job) {
    req.resume();
    writeJson(res, 404, {
      ok: false,
      error: `未找到待处理 job ${jobId}，blob 上传被拒绝`,
      errorCode: 'JOB_NOT_FOUND',
    });
    return;
  }

  const url = new URL(req.url || '/', `http://${state.host}:${state.port}`);
  const kind = url.searchParams.get('kind') || 'blob';
  const nodeId = url.searchParams.get('nodeId') || '';
  const ext = url.searchParams.get('ext') || 'bin';
  const blobId = url.searchParams.get('blobId') || `${kind}:${nodeId || 'unknown'}`;

  const chunkIndex = req.headers['x-chunk-index'];
  const chunkTotal = req.headers['x-chunk-total'];

  if (chunkIndex !== undefined && chunkTotal !== undefined) {
    let rawBody;
    try {
      rawBody = await readBinaryBody(req, {
        maxBytes: RESULT_CHUNK_MAX_BYTES,
        errorCode: 'BLOB_CHUNK_TOO_LARGE',
        label: 'blob chunk',
      });
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : 'blob 分块读取失败',
        errorCode: error && error.code ? error.code : 'BLOB_READ_FAILED',
      });
      return;
    }

    const chunkState = appendChunkedBody(
      state,
      buildBlobKey(jobId, blobId),
      chunkIndex,
      chunkTotal,
      rawBody,
      {
        maxChunkBytes: RESULT_CHUNK_MAX_BYTES,
        maxChunkCount: BLOB_CHUNK_MAX_COUNT,
        maxTotalBytes: BLOB_CHUNK_MAX_TOTAL_BYTES,
        invalidHeadersCode: 'INVALID_BLOB_CHUNK_HEADERS',
        chunkCountExceededCode: 'BLOB_CHUNK_COUNT_EXCEEDED',
        chunkTooLargeCode: 'BLOB_CHUNK_TOO_LARGE',
        totalTooLargeCode: 'BLOB_TOTAL_TOO_LARGE',
        chunkTotalMismatchCode: 'BLOB_CHUNK_TOTAL_MISMATCH',
        missingChunkCode: 'MISSING_BLOB_CHUNK',
      }
    );

    if (!chunkState.ok) {
      writeJson(res, chunkState.statusCode, {
        ok: false,
        error: chunkState.error,
        errorCode: chunkState.errorCode,
      });
      return;
    }

    if (!chunkState.complete) {
      writeJson(res, 200, {
        ok: true,
        jobId,
        blobId,
        chunk: chunkState.chunkIndex,
        pending: chunkState.pending,
      });
      return;
    }

    const metadata = storePendingBlob(state, jobId, {
      kind,
      blobId,
      nodeId: nodeId || null,
      ext,
      bytes: chunkState.body,
      receivedAt: new Date().toISOString(),
    });

    writeJson(res, 200, {
      ok: true,
      jobId,
      blobId,
      byteLength: metadata.byteLength,
      chunked: true,
      chunkSizeBytes: RESULT_CHUNK_SIZE_BYTES,
    });
    return;
  }

  let body;
  try {
    body = await readBinaryBody(req, BLOB_CHUNK_MAX_TOTAL_BYTES);
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : 'blob 读取失败',
      errorCode: error && error.code ? error.code : 'BLOB_READ_FAILED',
    });
    return;
  }

  const metadata = storePendingBlob(state, jobId, {
    kind,
    blobId,
    nodeId: nodeId || null,
    ext,
    bytes: body,
    receivedAt: new Date().toISOString(),
  });

  writeJson(res, 200, {
    ok: true,
    jobId,
    blobId,
    byteLength: metadata.byteLength,
  });
}
