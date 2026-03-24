import crypto from 'crypto';

import { JOB_TIMEOUT_MS } from '../bridge_config.mjs';

function createTimeoutError() {
  return Object.assign(new Error('插件未在预期时间内返回提取结果'), {
    code: 'PLUGIN_TIMEOUT',
  });
}

function clearJobState(state, jobId, timeout) {
  clearTimeout(timeout);
  state.pendingJobs.delete(jobId);
  state.pendingChunks.delete(jobId);
  state.pendingAssets.delete(jobId);
  state.pendingBlobs.delete(jobId);
}

export function createPendingJob(state, { target, clientId }) {
  const random = crypto.randomBytes(4).toString('hex');
  const jobId = `job_${Date.now().toString(36)}_${random}`;
  const createdAt = new Date().toISOString();

  let settled = false;
  let resolveJob;
  let rejectJob;

  const promise = new Promise((resolve, reject) => {
    resolveJob = resolve;
    rejectJob = reject;
  });

  const timeout = setTimeout(() => {
    if (settled) {
      return;
    }
    settled = true;
    clearJobState(state, jobId, timeout);
    rejectJob(createTimeoutError());
  }, JOB_TIMEOUT_MS);

  const job = {
    jobId,
    target,
    clientId,
    createdAt,
    promise,
    assetPromise: null,
    assetResolve: null,
    resolve(result) {
      if (settled) {
        return;
      }
      settled = true;
      clearJobState(state, jobId, timeout);
      resolveJob(result);
    },
    reject(error) {
      if (settled) {
        return;
      }
      settled = true;
      clearJobState(state, jobId, timeout);
      rejectJob(error);
    },
  };

  state.pendingJobs.set(jobId, job);
  return job;
}

export function getPendingJob(state, jobId) {
  return state.pendingJobs.get(jobId) || null;
}

export function getPrimaryPluginClient(state, fileKey) {
  const clients = Array.from(state.pluginClients.values());
  if (!clients.length) return { client: null, ambiguous: false, mismatch: false };

  if (fileKey) {
    const matched = clients.filter((c) => c.fileKey === fileKey);
    if (matched.length > 0) return { client: matched[matched.length - 1], ambiguous: false, mismatch: false };
    return { client: null, ambiguous: false, mismatch: true };
  }

  // No fileKey: single client is unambiguous; multiple clients is ambiguous — reject
  if (clients.length === 1) {
    return { client: clients[0], ambiguous: false, mismatch: false };
  }
  return { client: null, ambiguous: true, mismatch: false };
}

export function attachAssetWaiter(job) {
  if (job.assetPromise) {
    return job.assetPromise;
  }

  job.assetPromise = new Promise((resolve) => {
    job.assetResolve = resolve;
  });

  return job.assetPromise;
}

export function rejectJobsForClient(state, clientId, errorFactory) {
  for (const job of state.pendingJobs.values()) {
    if (job.clientId !== clientId) {
      continue;
    }

    const error =
      typeof errorFactory === 'function' ? errorFactory(job) : errorFactory;
    job.reject(error);
  }
}
