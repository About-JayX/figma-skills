#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, '..');
const SERVER_FILE = path.join(SKILL_ROOT, 'scripts', 'bridge_server.mjs');

const TEST_PORT = 15333 + Math.floor(Math.random() * 1000);
const TEST_HOST = '127.0.0.1';
const BASE_URL = `http://${TEST_HOST}:${TEST_PORT}`;
const STARTUP_TIMEOUT_MS = 8000;

const errors = [];
let checks = 0;

function fail(message) {
  checks += 1;
  errors.push(message);
}

function pass() {
  checks += 1;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_FILE], {
      env: {
        ...process.env,
        FIGMA_BRIDGE_BIND_HOST: TEST_HOST,
        FIGMA_BRIDGE_PORT: String(TEST_PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Server did not start within ${STARTUP_TIMEOUT_MS}ms`));
      }
    }, STARTUP_TIMEOUT_MS);

    child.stdout.on('data', (data) => {
      output += data.toString();
      if (!settled && output.includes('"ok":true')) {
        settled = true;
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', (data) => { output += data.toString(); });
    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Server exited early with code ${code}`));
      }
    });
  });
}

function parseSseEvents(buffer) {
  const events = [];
  const blocks = buffer.split('\n\n');
  for (let i = 0; i < blocks.length - 1; i += 1) {
    const block = blocks[i].trim();
    if (!block) {
      continue;
    }
    const eventMatch = block.match(/^event:\s*(.+)$/m);
    const dataMatch = block.match(/^data:\s*(.+)$/m);
    if (!eventMatch || !dataMatch) {
      continue;
    }
    try {
      events.push({ event: eventMatch[1], data: JSON.parse(dataMatch[1]) });
    } catch {}
  }
  return [events, blocks[blocks.length - 1]];
}

function connectSse() {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('SSE connect timeout'));
    }, 5000);

    fetch(`${BASE_URL}/events`, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    }).then(async (res) => {
      clearTimeout(timeout);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const pendingEvents = [];
      let buffer = '';

      async function readNextEvent(timeoutMs = 3000) {
        if (pendingEvents.length > 0) {
          return pendingEvents.shift();
        }

        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const { value, done } = await reader.read();
          if (done) {
            throw new Error('SSE stream ended');
          }
          buffer += decoder.decode(value, { stream: true });
          const [events, remaining] = parseSseEvents(buffer);
          buffer = remaining;
          pendingEvents.push(...events);
          if (pendingEvents.length > 0) {
            return pendingEvents.shift();
          }
        }
        throw new Error('SSE event timeout');
      }

      while (true) {
        const event = await readNextEvent(5000);
        if (event.event === 'ready' && event.data && event.data.clientId) {
          resolve({
            clientId: event.data.clientId,
            controller,
            readNextEvent,
          });
          return;
        }
      }
    }).catch(reject);
  });
}

async function postJson(urlPath, body) {
  const response = await fetch(`${BASE_URL}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, result };
}

async function uploadBlob(jobId) {
  const response = await fetch(
    `${BASE_URL}/jobs/${encodeURIComponent(jobId)}/blob?kind=svg&nodeId=1%3A2&ext=svg`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from('<svg><path d="M0 0L10 10"/></svg>', 'utf8'),
    }
  );
  const result = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, result };
}

async function main() {
  let serverProcess = null;
  let sse = null;
  let extractPromise = null;

  try {
    serverProcess = await startServer();
    await sleep(300);

    sse = await connectSse();

    extractPromise = postJson('/extract-node-defs', {
      input: '99:1',
    });

    const event = await sse.readNextEvent(2000);
    let jobId = null;

    if (event.event !== 'extract-node-defs' || !event.data || !event.data.jobId) {
      fail(`expected extract-node-defs SSE event with jobId, got ${JSON.stringify(event)}`);
    } else {
      pass();
      jobId = event.data.jobId;
    }

    if (jobId) {
      const blobRes = await uploadBlob(jobId);
      if (!blobRes.ok) {
        fail(`blob upload should succeed, got ${blobRes.status} ${blobRes.result.errorCode || ''}`.trim());
      } else {
        pass();
      }

      if (blobRes.ok) {
        const resultRes = await postJson(`/jobs/${encodeURIComponent(jobId)}/result`, {
          ok: true,
          jobId,
          nodeId: '99:1',
          designSnapshot: {
            root: {
              id: '99:1',
              type: 'FRAME',
              svgRef: {
                transfer: 'side-channel',
                nodeId: '1:2',
                kind: 'svg',
              },
            },
          },
        });
        if (!resultRes.ok) {
          fail(`job result callback should succeed, got ${resultRes.status}`);
        } else {
          pass();
        }

        const extractRes = await extractPromise;
        if (!extractRes.ok) {
          fail(`extract response should succeed, got ${extractRes.status} ${extractRes.result.errorCode || ''}`.trim());
        } else if (
          !Array.isArray(extractRes.result.sideChannelBlobs) ||
          extractRes.result.sideChannelBlobs.length !== 1
        ) {
          fail('extract response should contain sideChannelBlobs metadata');
        } else {
          pass();

          const { persistBridgeResult } = await import('./lib/bridge_cache.mjs');
          const cacheDir = persistBridgeResult(extractRes.result);
          const persisted = extractRes.result.sideChannelBlobs[0];
          const persistedPath =
            persisted && typeof persisted.localPath === 'string' ? persisted.localPath : '';

          if (!cacheDir) {
            fail('persistBridgeResult should return a cacheDir');
          } else if (!persistedPath || !fs.existsSync(persistedPath)) {
            fail('sideChannel blob should be materialized to a real file path');
          } else if (!persistedPath.startsWith(cacheDir)) {
            fail('sideChannel blob localPath should point inside cacheDir');
          } else {
            pass();
          }
        }
      }
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    extractPromise?.catch(() => {});
    try { sse?.controller.abort(); } catch {}
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await sleep(300);
      if (!serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
    }
  }

  const output =
    errors.length === 0
      ? {
          ok: true,
          checks,
          message: 'SVG blob side-channel checks passed',
        }
      : {
          ok: false,
          checks,
          errors,
        };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

main();
