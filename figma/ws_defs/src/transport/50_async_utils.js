function createLimiter(maxConcurrent) {
  const queue = [];
  let activeCount = 0;
  const limit = Math.max(1, Number(maxConcurrent) || 1);

  function runNext() {
    activeCount -= 1;
    if (queue.length > 0) {
      const next = queue.shift();
      next();
    }
  }

  return (task) =>
    new Promise((resolve, reject) => {
      const runTask = () => {
        activeCount += 1;
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(runNext);
      };

      if (activeCount < limit) {
        runTask();
      } else {
        queue.push(runTask);
      }
    });
}

function withTimeout(promise, timeoutMs, label) {
  const ms = Number(timeoutMs) || 0;
  if (!ms) {
    return promise;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error((label || 'async operation') + ' timed out after ' + ms + 'ms'));
    }, ms);

    Promise.resolve(promise).then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function estimateJsonBytes(value) {
  try {
    return JSON.stringify(value).length;
  } catch (error) {
    return null;
  }
}

function formatStatusDetails(details) {
  if (!details || typeof details !== 'object') {
    return '';
  }

  const parts = [];
  const keys = Object.keys(details);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const value = details[key];
    if (value == null || value === '') {
      continue;
    }

    if (Array.isArray(value)) {
      parts.push(key + '=' + value.join(','));
      continue;
    }

    if (typeof value === 'object') {
      const nested = estimateJsonBytes(value);
      parts.push(key + '=' + (nested == null ? '[object]' : nested + 'b-json'));
      continue;
    }

    parts.push(key + '=' + String(value));
  }

  return parts.join(' | ');
}
