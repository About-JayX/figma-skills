import {
  RESULT_CHUNK_MAX_BYTES,
  RESULT_CHUNK_MAX_TOTAL_BYTES,
} from '../../bridge_config.mjs';
import {
  readBinaryBody,
  readJsonBody,
  writeJson,
} from '../../bridge_http.mjs';
import { appendJobResultChunk } from '../chunk_store.mjs';
import { getPendingJob } from '../job_store.mjs';

function normalizeJobResult(job, payload) {
  const result =
    payload && typeof payload === 'object'
      ? Object.assign({}, payload)
      : {
          ok: false,
          error: '插件回传结果格式不正确',
          errorCode: 'INVALID_RESULT',
        };

  result.jobId = job.jobId;
  result.target = job.target;
  result.returnedAt = new Date().toISOString();
  return result;
}

export async function handleJobResultRequest(state, req, res, jobId) {
  const job = getPendingJob(state, jobId);
  if (!job) {
    writeJson(res, 404, {
      ok: false,
      error: `未找到待处理 job ${jobId}`,
      errorCode: 'JOB_NOT_FOUND',
    });
    return;
  }

  const chunkIndex = req.headers['x-chunk-index'];
  const chunkTotal = req.headers['x-chunk-total'];

  if (chunkIndex !== undefined && chunkTotal !== undefined) {
    let rawBody;
    try {
      rawBody = await readBinaryBody(req, {
        maxBytes: RESULT_CHUNK_MAX_BYTES,
        errorCode: 'RESULT_CHUNK_TOO_LARGE',
        label: 'result chunk',
      });
    } catch (error) {
      const errorCode = error && error.code ? error.code : 'INVALID_CHUNK_BODY';
      const statusCode = errorCode === 'RESULT_CHUNK_TOO_LARGE' ? 413 : 400;

      writeJson(res, statusCode, {
        ok: false,
        error: '分块请求体读取失败',
        errorCode,
      });
      return;
    }

    const chunkState = appendJobResultChunk(
      state,
      jobId,
      chunkIndex,
      chunkTotal,
      rawBody
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
        chunk: chunkState.chunkIndex,
        pending: chunkState.pending,
      });
      return;
    }

    let payload;
    try {
      payload = JSON.parse(chunkState.body);
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: '分块重组后 JSON 解析失败',
        errorCode: 'INVALID_JSON',
      });
      return;
    }

    job.resolve(normalizeJobResult(job, payload));

    writeJson(res, 200, {
      ok: true,
      jobId: job.jobId,
      chunked: true,
      totalChunks: chunkState.totalChunks,
    });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req, RESULT_CHUNK_MAX_TOTAL_BYTES);
  } catch (error) {
    const errorCode = error && error.code ? error.code : 'INVALID_JSON';
    const statusCode = errorCode === 'JSON_BODY_TOO_LARGE' ? 413 : 400;

    writeJson(res, statusCode, {
      ok: false,
      error: '结果回传不是合法 JSON',
      errorCode,
    });
    return;
  }

  job.resolve(normalizeJobResult(job, payload));

  writeJson(res, 200, {
    ok: true,
    jobId: job.jobId,
  });
}
