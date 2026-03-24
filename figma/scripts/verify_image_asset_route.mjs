#!/usr/bin/env node
/**
 * Automated verification for the extract-image-asset HTTP route.
 * Spins up a real bridge server, registers a fake plugin SSE client,
 * then exercises 4 branches of handleExtractImageAssetRequest:
 *
 *   1. IMAGE_TOO_LARGE_ESTIMATED  → 413 + errorCode + details preserved
 *   2. IMAGE_TOO_LARGE            → 413 + errorCode + details preserved
 *   3. Generic plugin error       → 502 + original errorCode preserved
 *   4. Successful binary delivery → 200 octet-stream + headers
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, '..');
const SERVER_FILE = path.join(SKILL_ROOT, 'scripts', 'bridge_server.mjs');

const TEST_PORT = 14000 + Math.floor(Math.random() * 1000);
const TEST_HOST = '127.0.0.1';
const BASE_URL = `http://${TEST_HOST}:${TEST_PORT}`;
const STARTUP_TIMEOUT_MS = 8000;

const errors = [];

function fail(label, message) {
  errors.push(`[${label}] ${message}`);
}

function pass(label) {
  process.stderr.write(`  PASS: ${label}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_FILE], {
      env: {
        ...process.env,
        FIGMA_BRIDGE_BIND_HOST: TEST_HOST,
        FIGMA_BRIDGE_PORT: String(TEST_PORT),
        FIGMA_BRIDGE_JOB_TIMEOUT_MS: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Server did not start within ${STARTUP_TIMEOUT_MS}ms. Output: ${output}`));
      }
    }, STARTUP_TIMEOUT_MS);

    child.stdout.on('data', (data) => {
      output += data.toString();
      if (output.includes('"ok":true') && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(child);
      }
    });

    child.stderr.on('data', (data) => { output += data.toString(); });
    child.on('error', (err) => {
      if (!resolved) { resolved = true; clearTimeout(timeout); reject(err); }
    });
    child.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}. Output: ${output}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Fake plugin SSE client
// ---------------------------------------------------------------------------

/**
 * Opens a persistent SSE connection to /events (simulating a plugin client).
 * Returns { readNextEvent(eventName, timeoutMs), disconnect() }.
 *
 * readNextEvent filters by event name so 'ready' heartbeat events don't
 * interfere with 'extract-image-asset' event waiters.
 */
async function connectSsePlugin() {
  const abortController = new AbortController();

  const response = await fetch(`${BASE_URL}/events`, {
    signal: abortController.signal,
    headers: { Accept: 'text/event-stream' },
  });

  if (!response.ok) {
    throw new Error(`SSE connect failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  // Per-event-name waiter queues; unmatched events go into eventQueue
  const namedWaiters = new Map();
  const eventQueue = [];
  let buffer = '';
  let currentEvent = {};

  function dispatch(event) {
    const waiters = namedWaiters.get(event.event);
    if (waiters && waiters.length > 0) {
      waiters.shift()(event);
    } else {
      eventQueue.push(event);
    }
  }

  function processBuffer() {
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep partial last line

    for (const line of lines) {
      if (line === '') {
        if (currentEvent.event && currentEvent.data != null) {
          dispatch({ ...currentEvent });
        }
        currentEvent = {};
      } else if (line.startsWith('event:')) {
        currentEvent.event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        currentEvent.data = line.slice(5).trim();
      }
      // ignore comment lines (heartbeats start with ':')
    }
  }

  // Background reader loop
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        processBuffer();
      }
    } catch {
      // connection aborted — expected on disconnect()
    }
  })();

  function readNextEvent(eventName, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      // Check if already queued
      const idx = eventQueue.findIndex((e) => e.event === eventName);
      if (idx >= 0) {
        resolve(eventQueue.splice(idx, 1)[0]);
        return;
      }

      if (!namedWaiters.has(eventName)) {
        namedWaiters.set(eventName, []);
      }
      const waiters = namedWaiters.get(eventName);

      const timer = setTimeout(() => {
        const i = waiters.indexOf(waiter);
        if (i >= 0) waiters.splice(i, 1);
        reject(new Error(`Timeout waiting for SSE event '${eventName}' after ${timeoutMs}ms`));
      }, timeoutMs);

      const waiter = (event) => {
        clearTimeout(timer);
        resolve(event);
      };

      waiters.push(waiter);
    });
  }

  function disconnect() {
    abortController.abort();
    reader.cancel().catch(() => {});
  }

  return { readNextEvent, disconnect };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function postExtractImageAsset(imageHash) {
  return fetch(`${BASE_URL}/extract-image-asset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageHash }),
  });
}

async function postJobResult(jobId, payload) {
  return fetch(`${BASE_URL}/jobs/${jobId}/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function postJobAsset(jobId, bytes, hash, format) {
  return fetch(`${BASE_URL}/jobs/${jobId}/asset?hash=${encodeURIComponent(hash)}&format=${format}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes,
  });
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function waitForSseJobId(sseConn, label) {
  try {
    const event = await sseConn.readNextEvent('extract-image-asset');
    const data = JSON.parse(event.data);
    return data.jobId;
  } catch (err) {
    fail(label, `SSE event not received: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Test 1: IMAGE_TOO_LARGE_ESTIMATED → 413 with errorCode + details
async function testImageTooLargeEstimated(sseConn) {
  const label = 'IMAGE_TOO_LARGE_ESTIMATED → 413 with errorCode and details';

  const requestPromise = postExtractImageAsset('hash_estimated_preflight');
  const jobId = await waitForSseJobId(sseConn, label);
  if (!jobId) {
    requestPromise.catch(() => {});
    return;
  }

  await postJobResult(jobId, {
    ok: false,
    error: '图片尺寸预估超限，跳过二进制读取',
    errorCode: 'IMAGE_TOO_LARGE_ESTIMATED',
    details: {
      imageHash: 'hash_estimated_preflight',
      width: 5000,
      height: 5000,
      pixelCount: 25000000,
      assetMaxPixels: 10240000,
      estimatedMaxBytes: 100000000,
      assetMaxBytes: 33554432,
    },
  });

  const response = await requestPromise;
  const body = await response.json().catch(() => ({}));

  if (response.status !== 413) {
    fail(label, `Expected status 413, got ${response.status}`);
  } else if (body.errorCode !== 'IMAGE_TOO_LARGE_ESTIMATED') {
    fail(label, `Expected errorCode IMAGE_TOO_LARGE_ESTIMATED, got ${body.errorCode}`);
  } else if (!body.details || typeof body.details.pixelCount !== 'number') {
    fail(label, 'details.pixelCount missing or not a number');
  } else if (typeof body.details.assetMaxPixels !== 'number') {
    fail(label, 'details.assetMaxPixels missing or not a number');
  } else {
    pass(label);
  }
}

// Test 2: IMAGE_TOO_LARGE (post-read byte limit) → 413
async function testImageTooLarge(sseConn) {
  const label = 'IMAGE_TOO_LARGE → 413 with errorCode and details';

  const requestPromise = postExtractImageAsset('hash_bytes_too_large');
  const jobId = await waitForSseJobId(sseConn, label);
  if (!jobId) {
    requestPromise.catch(() => {});
    return;
  }

  await postJobResult(jobId, {
    ok: false,
    error: '图片字节超出上限: 50000000 > 33554432',
    errorCode: 'IMAGE_TOO_LARGE',
    details: {
      imageHash: 'hash_bytes_too_large',
      byteLength: 50000000,
      assetMaxBytes: 33554432,
    },
  });

  const response = await requestPromise;
  const body = await response.json().catch(() => ({}));

  if (response.status !== 413) {
    fail(label, `Expected status 413, got ${response.status}`);
  } else if (body.errorCode !== 'IMAGE_TOO_LARGE') {
    fail(label, `Expected errorCode IMAGE_TOO_LARGE, got ${body.errorCode}`);
  } else if (!body.details || typeof body.details.byteLength !== 'number') {
    fail(label, 'details.byteLength missing or not a number');
  } else {
    pass(label);
  }
}

// Test 3: Generic plugin error → 502, original errorCode preserved (not collapsed)
async function testGenericPluginError(sseConn) {
  const label = 'generic plugin error → 502 with original errorCode preserved';

  const requestPromise = postExtractImageAsset('hash_plugin_crash');
  const jobId = await waitForSseJobId(sseConn, label);
  if (!jobId) {
    requestPromise.catch(() => {});
    return;
  }

  await postJobResult(jobId, {
    ok: false,
    error: '未知内部错误',
    errorCode: 'INTERNAL_PLUGIN_CRASH',
  });

  const response = await requestPromise;
  const body = await response.json().catch(() => ({}));

  if (response.status !== 502) {
    fail(label, `Expected status 502, got ${response.status}`);
  } else if (body.errorCode !== 'INTERNAL_PLUGIN_CRASH') {
    fail(label, `Expected original errorCode INTERNAL_PLUGIN_CRASH, got ${body.errorCode}`);
  } else {
    pass(label);
  }
}

// Test 4: Successful binary asset delivery → 200 octet-stream
async function testSuccessBinaryResponse(sseConn) {
  const label = 'successful asset delivery → 200 octet-stream with correct headers';

  const testHash = 'abc123testhash';
  const requestPromise = postExtractImageAsset(testHash);
  const jobId = await waitForSseJobId(sseConn, label);
  if (!jobId) {
    requestPromise.catch(() => {});
    return;
  }

  // PNG magic bytes as fake image payload
  const fakeBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await postJobAsset(jobId, fakeBytes, testHash, 'png');

  const response = await requestPromise;

  if (response.status !== 200) {
    fail(label, `Expected status 200, got ${response.status}`);
    return;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('octet-stream')) {
    fail(label, `Expected octet-stream Content-Type, got "${contentType}"`);
    return;
  }

  const xHash = response.headers.get('x-image-hash');
  if (xHash !== testHash) {
    fail(label, `Expected X-Image-Hash=${testHash}, got ${xHash}`);
    return;
  }

  const xFormat = response.headers.get('x-image-format');
  if (xFormat !== 'png') {
    fail(label, `Expected X-Image-Format=png, got ${xFormat}`);
    return;
  }

  const responseBytes = Buffer.from(await response.arrayBuffer());
  if (responseBytes.length !== fakeBytes.length) {
    fail(label, `Expected ${fakeBytes.length} bytes, got ${responseBytes.length}`);
    return;
  }

  pass(label);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  process.stderr.write('Running extract-image-asset route checks...\n');

  let serverProcess = null;
  let sseConn = null;

  try {
    serverProcess = await startServer();
    await sleep(300);

    sseConn = await connectSsePlugin();
    // Allow the 'ready' SSE event to arrive before sending requests
    await sleep(200);

    await testImageTooLargeEstimated(sseConn);
    await testImageTooLarge(sseConn);
    await testGenericPluginError(sseConn);
    await testSuccessBinaryResponse(sseConn);
  } catch (error) {
    errors.push(`Setup error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (sseConn) {
      sseConn.disconnect();
    }
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await sleep(300);
      if (!serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
    }
  }

  if (errors.length === 0) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          checks: 4,
          message: 'All extract-image-asset route checks passed',
        },
        null,
        2
      ) + '\n'
    );
  } else {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          errors,
        },
        null,
        2
      ) + '\n'
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
