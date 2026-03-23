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

export function getPrimaryPluginClient(state) {
  const clients = Array.from(state.pluginClients.values());
  return clients.length > 0 ? clients[clients.length - 1] : null;
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
