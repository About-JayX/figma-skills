#!/usr/bin/env node
/**
 * Tests for /register endpoint, fileKey-based client routing,
 * and bridge-agent-payload.json trimming.
 *
 * Checks:
 * 1. SSE /events returns clientId in ready event
 * 2. POST /register with valid clientId + fileKey succeeds
 * 3. POST /register with unknown clientId returns 404
 * 4. getPrimaryPluginClient selects client by fileKey
 * 5. buildAgentPayload trims restSnapshot and strips bytesBase64
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, '..');
const SERVER_FILE = path.join(SKILL_ROOT, 'scripts', 'bridge_server.mjs');

const TEST_PORT = 14333 + Math.floor(Math.random() * 1000);
const TEST_HOST = '127.0.0.1';
const BASE_URL = `http://${TEST_HOST}:${TEST_PORT}`;
const STARTUP_TIMEOUT_MS = 8000;

const errors = [];
let checkCount = 0;

function pass(name) {
  checkCount++;
}

function fail(message) {
  checkCount++;
  errors.push(message);
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
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Server did not start within ${STARTUP_TIMEOUT_MS}ms`));
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
    child.on('error', (err) => { if (!resolved) { resolved = true; clearTimeout(timeout); reject(err); } });
    child.on('exit', (code) => { if (!resolved) { resolved = true; clearTimeout(timeout); reject(new Error(`Server exited ${code}`)); } });
  });
}

function parseSseEvents(buf) {
  // Extract all complete SSE events from buffer; return [events[], remaining]
  const events = [];
  const blocks = buf.split('\n\n');
  for (let i = 0; i < blocks.length - 1; i++) {
    const block = blocks[i].trim();
    if (!block) continue;
    const eventMatch = block.match(/^event:\s*(.+)$/m);
    const dataMatch = block.match(/^data:\s*(.+)$/m);
    if (eventMatch && dataMatch) {
      try {
        events.push({ event: eventMatch[1], data: JSON.parse(dataMatch[1]) });
      } catch { /* skip unparseable */ }
    }
  }
  return [events, blocks[blocks.length - 1]];
}

function connectSse() {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); reject(new Error('SSE connect timeout')); }, 5000);

    fetch(`${BASE_URL}/events`, {
      signal: controller.signal,
      headers: { 'Accept': 'text/event-stream' },
    }).then(async (res) => {
      clearTimeout(timer);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const pendingEvents = []; // events received after ready

      // Read until we get the ready event
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const [events, remaining] = parseSseEvents(buf);
        buf = remaining;

        for (const ev of events) {
          if (ev.event === 'ready' && ev.data.clientId) {
            // readNextEvent: wait for the next non-ready SSE event on this connection
            function readNextEvent(timeoutMs = 3000) {
              return new Promise((res2, rej2) => {
                if (pendingEvents.length > 0) { res2(pendingEvents.shift()); return; }
                const t = setTimeout(() => rej2(new Error('SSE event timeout')), timeoutMs);
                const check = setInterval(async () => {
                  // Drain any data waiting on the reader
                  try {
                    const { value: v2, done: d2 } = await reader.read();
                    if (d2) { clearInterval(check); clearTimeout(t); rej2(new Error('SSE ended')); return; }
                    buf += decoder.decode(v2, { stream: true });
                    const [evs, rem] = parseSseEvents(buf);
                    buf = rem;
                    pendingEvents.push(...evs);
                    if (pendingEvents.length > 0) {
                      clearInterval(check); clearTimeout(t);
                      res2(pendingEvents.shift());
                    }
                  } catch (e) { clearInterval(check); clearTimeout(t); rej2(e); }
                }, 50);
              });
            }
            resolve({ clientId: ev.data.clientId, reader, controller, readNextEvent });
            // Stash remaining events
            pendingEvents.push(...events.filter(e => e !== ev));
            return;
          }
        }
      }
      reject(new Error('SSE stream ended without ready event'));
    }).catch(reject);
  });
}

async function postJson(urlPath, body) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await res.json();
  return { ok: res.ok, status: res.status, result };
}

async function main() {
  let serverProcess = null;

  try {
    serverProcess = await startServer();
    await sleep(300);

    // --- Check 1: SSE /events returns clientId in ready event ---
    const sse1 = await connectSse();
    if (!sse1.clientId || typeof sse1.clientId !== 'string') {
      fail('Check 1: SSE ready event missing clientId');
    } else {
      pass('Check 1: SSE ready event has clientId');
    }

    // --- Check 2: POST /register with valid clientId + fileKey ---
    const reg1 = await postJson('/register', { clientId: sse1.clientId, fileKey: 'ABC123' });
    if (!reg1.ok || reg1.result.ok !== true || reg1.result.fileKey !== 'ABC123') {
      fail(`Check 2: /register failed: ${JSON.stringify(reg1.result)}`);
    } else {
      pass('Check 2: /register succeeded');
    }

    // --- Check 3: POST /register with unknown clientId returns 404 ---
    const reg2 = await postJson('/register', { clientId: 'nonexistent-id', fileKey: 'XYZ' });
    if (reg2.status !== 404 || reg2.result.errorCode !== 'CLIENT_NOT_FOUND') {
      fail(`Check 3: /register unknown client should be 404, got ${reg2.status}`);
    } else {
      pass('Check 3: /register unknown client returns 404');
    }

    // --- Check 4: Multi-client fileKey routing ---
    // Connect a second SSE client and register with a different fileKey
    const sse2 = await connectSse();
    await postJson('/register', { clientId: sse2.clientId, fileKey: 'DEF456' });

    // Check /health shows 2 connections
    const healthRes = await fetch(`${BASE_URL}/health`);
    const health = await healthRes.json();
    if (health.pluginConnections !== 2) {
      fail(`Check 4a: Expected 2 plugin connections, got ${health.pluginConnections}`);
    } else {
      pass('Check 4a: 2 plugin connections registered');
    }

    // POST /extract-node-defs with a URL containing fileKey=ABC123
    // It should route to sse1's client, not sse2
    // We can't fully test the routing without a plugin response, but we can verify
    // the job gets created and times out on the correct client
    // Instead, let's verify via /health detail that fileKeys are set
    // Actually, let's just verify the registration stuck by re-registering and checking response
    const reg3 = await postJson('/register', { clientId: sse1.clientId, fileKey: 'ABC123-updated' });
    if (!reg3.ok || reg3.result.fileKey !== 'ABC123-updated') {
      fail('Check 4b: fileKey update failed');
    } else {
      pass('Check 4b: fileKey update succeeded');
    }

    // --- Check 5: buildAgentPayload trims restSnapshot and bytesBase64 ---
    const { buildAgentPayload } = await import('./lib/bridge_cache.mjs');
    const mockData = {
      jobId: 'test-job',
      target: { fileKey: 'F1', nodeId: '1:2' },
      node: { id: '1:2', name: 'TestNode' },
      extractedAt: '2026-01-01T00:00:00Z',
      defs: { flat: { '1:2': {} }, full: { '1:2': { largeData: 'x'.repeat(10000) } }, summary: { nodeCount: 1 } },
      designSnapshot: {
        root: {
          id: '1:2', name: 'Root', svgString: '<svg>root</svg>', css: { display: 'flex' },
          children: [
            { id: '2:1', name: 'Child1', svgString: '<svg>child1</svg>', css: { color: 'red' } },
            { id: '2:2', name: 'Child2', svgString: '<svg>child2</svg>', css: { color: 'blue' },
              children: [{ id: '3:1', name: 'GrandChild', svgString: '<svg>gc</svg>', css: { margin: '0' } }] },
          ],
        },
        resources: {
          imageAssets: {
            'hash1': { format: 'png', bytesBase64: 'AAAA', width: 100, height: 100 },
            'hash2': { format: 'jpg', bytesBase64: 'BBBB', width: 200, height: 200 },
          },
        },
      },
      restSnapshot: {
        name: 'TestFile',
        lastModified: '2026-01-01',
        version: '1',
        document: { children: [{ children: [{}, {}] }] },
      },
    };

    const payload = buildAgentPayload(mockData);

    // restSnapshot should be trimmed to metadata only
    if (payload.restSnapshot.document) {
      fail('Check 5a: restSnapshot.document should be stripped');
    } else if (!payload.restSnapshot.available) {
      fail('Check 5a: restSnapshot.available should be true');
    } else if (payload.restSnapshot.nodeCount !== 4) {
      fail(`Check 5a: restSnapshot.nodeCount should be 4, got ${payload.restSnapshot.nodeCount}`);
    } else {
      pass('Check 5a: restSnapshot trimmed correctly');
    }

    // designSnapshot.resources.imageAssets should have bytesBase64 stripped
    const asset1 = payload.designSnapshot.resources.imageAssets['hash1'];
    if (asset1.bytesBase64) {
      fail('Check 5b: bytesBase64 should be stripped from imageAssets');
    } else if (asset1.format !== 'png' || asset1.width !== 100) {
      fail('Check 5b: imageAsset metadata should be preserved');
    } else {
      pass('Check 5b: imageAsset bytesBase64 stripped, metadata preserved');
    }

    // designSnapshot.root should still be present
    if (!payload.designSnapshot.root || payload.designSnapshot.root.id !== '1:2') {
      fail('Check 5c: designSnapshot.root should be preserved');
    } else {
      pass('Check 5c: designSnapshot.root preserved');
    }

    // defs.full should be omitted from agent payload (large, duplicated in bridge-response.json)
    if (payload.defs.full !== undefined) {
      fail('Check 5d: defs.full should be omitted from agent payload');
    } else if (!payload.defs.flat || !payload.defs.summary) {
      fail('Check 5d: defs.flat and defs.summary should be preserved');
    } else {
      pass('Check 5d: defs.full omitted, flat/summary preserved');
    }

    // svgString and css should be kept on root but stripped from all children
    const root = payload.designSnapshot.root;
    if (!root.svgString) {
      fail('Check 5e: root svgString should be preserved');
    } else if (!root.css) {
      fail('Check 5e: root css should be preserved');
    } else if (root.children[0].svgString || root.children[0].css) {
      fail('Check 5e: child svgString/css should be stripped');
    } else if (root.children[1].svgString || root.children[1].css) {
      fail('Check 5e: child svgString/css should be stripped');
    } else if (root.children[1].children[0].svgString || root.children[1].children[0].css) {
      fail('Check 5e: grandchild svgString/css should be stripped');
    } else {
      pass('Check 5e: svgString/css kept on root, stripped from children/grandchildren');
    }

    // --- Check 6: End-to-end SSE routing ---
    // Reconnect two fresh SSE clients with known fileKeys,
    // then POST /extract-node-defs with a Figma URL containing one fileKey
    // and verify the SSE event arrives at the correct client.

    // Clean up old connections first
    try { sse1.controller.abort(); } catch {}
    try { sse2.controller.abort(); } catch {}
    await sleep(200);

    const sseA = await connectSse();
    await postJson('/register', { clientId: sseA.clientId, fileKey: 'ROUTE_A' });
    const sseB = await connectSse();
    await postJson('/register', { clientId: sseB.clientId, fileKey: 'ROUTE_B' });

    // Send extract request targeting ROUTE_A via body.fileKey
    // Don't await the response — it will time out since no plugin responds.
    // We only care that the SSE event reaches sseA, not sseB.
    const extractPromise = postJson('/extract-node-defs', {
      input: '99:1',
      fileKey: 'ROUTE_A',
    });

    try {
      const sseEvent = await sseA.readNextEvent(2000);
      if (sseEvent.event !== 'extract-node-defs') {
        fail(`Check 6a: Expected extract-node-defs event on sseA, got ${sseEvent.event}`);
      } else if (!sseEvent.data.jobId) {
        fail('Check 6a: SSE event missing jobId');
      } else if (sseEvent.data.target?.nodeId !== '99:1') {
        fail(`Check 6a: SSE event target.nodeId should be 99:1, got ${sseEvent.data.target?.nodeId}`);
      } else {
        pass('Check 6a: extract-node-defs SSE event routed to correct client (sseA)');
      }
    } catch (e) {
      fail(`Check 6a: Failed to receive SSE event on sseA: ${e.message}`);
    }

    // Verify sseB did NOT receive the event (poll briefly)
    let sseBGotEvent = false;
    try {
      await sseB.readNextEvent(500);
      sseBGotEvent = true;
    } catch { /* expected timeout */ }
    if (sseBGotEvent) {
      fail('Check 6b: sseB should NOT receive event meant for ROUTE_A');
    } else {
      pass('Check 6b: sseB correctly did not receive event for ROUTE_A');
    }

    // Check /health exposes pluginFileKeys
    const health2 = await (await fetch(`${BASE_URL}/health`)).json();
    if (!Array.isArray(health2.pluginFileKeys)) {
      fail('Check 6c: health should expose pluginFileKeys array');
    } else if (!health2.pluginFileKeys.includes('ROUTE_A') || !health2.pluginFileKeys.includes('ROUTE_B')) {
      fail(`Check 6c: pluginFileKeys should include ROUTE_A and ROUTE_B, got ${JSON.stringify(health2.pluginFileKeys)}`);
    } else {
      pass('Check 6c: health exposes pluginFileKeys correctly');
    }

    // Wait for extract to time out (don't let it block test exit)
    extractPromise.catch(() => {});

    // --- Check 7: fileKey mismatch must be rejected, not fallback ---
    // sseA has ROUTE_A, sseB has ROUTE_B; request fileKey=NONEXISTENT must fail
    const mismatchRes = await postJson('/extract-node-defs', {
      input: '99:1',
      fileKey: 'NONEXISTENT_KEY',
    });
    if (mismatchRes.status !== 409) {
      fail(`Check 7a: fileKey mismatch should return 409, got ${mismatchRes.status}`);
    } else if (mismatchRes.result.errorCode !== 'FILEKEY_MISMATCH') {
      fail(`Check 7a: errorCode should be FILEKEY_MISMATCH, got ${mismatchRes.result.errorCode}`);
    } else {
      pass('Check 7a: fileKey mismatch correctly rejected with 409 FILEKEY_MISMATCH');
    }

    // Same for extract-image-asset
    const mismatchAssetRes = await postJson('/extract-image-asset', {
      input: '99:1',
      imageHash: 'test-hash',
      fileKey: 'NONEXISTENT_KEY',
    });
    if (mismatchAssetRes.status !== 409) {
      fail(`Check 7b: asset fileKey mismatch should return 409, got ${mismatchAssetRes.status}`);
    } else if (mismatchAssetRes.result.errorCode !== 'FILEKEY_MISMATCH') {
      fail(`Check 7b: asset errorCode should be FILEKEY_MISMATCH, got ${mismatchAssetRes.result.errorCode}`);
    } else {
      pass('Check 7b: asset fileKey mismatch correctly rejected with 409 FILEKEY_MISMATCH');
    }

    // --- Check 8: multi-client no-fileKey must be rejected (server-side) ---
    // Both sseA (ROUTE_A) and sseB (ROUTE_B) are still connected;
    // a bare node-id without fileKey must be rejected, not silently routed.
    const ambiguousRes = await postJson('/extract-node-defs', {
      input: '99:1',
    });
    if (ambiguousRes.status !== 409) {
      fail(`Check 8a: no-fileKey multi-client should return 409, got ${ambiguousRes.status}`);
    } else if (ambiguousRes.result.errorCode !== 'AMBIGUOUS_ROUTING') {
      fail(`Check 8a: errorCode should be AMBIGUOUS_ROUTING, got ${ambiguousRes.result.errorCode}`);
    } else {
      pass('Check 8a: no-fileKey multi-client rejected with 409 AMBIGUOUS_ROUTING');
    }

    const ambiguousAssetRes = await postJson('/extract-image-asset', {
      input: '99:1',
      imageHash: 'test-hash',
    });
    if (ambiguousAssetRes.status !== 409) {
      fail(`Check 8b: asset no-fileKey multi-client should return 409, got ${ambiguousAssetRes.status}`);
    } else if (ambiguousAssetRes.result.errorCode !== 'AMBIGUOUS_ROUTING') {
      fail(`Check 8b: asset errorCode should be AMBIGUOUS_ROUTING, got ${ambiguousAssetRes.result.errorCode}`);
    } else {
      pass('Check 8b: asset no-fileKey multi-client rejected with 409 AMBIGUOUS_ROUTING');
    }

    try { sseA.controller.abort(); } catch {}
    try { sseB.controller.abort(); } catch {}

  } catch (error) {
    fail(`Test error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await sleep(300);
      if (!serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
    }
  }

  const output = errors.length === 0
    ? { ok: true, port: TEST_PORT, checks: checkCount, message: 'All fileKey routing checks passed' }
    : { ok: false, port: TEST_PORT, checks: checkCount, errors };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  if (errors.length > 0) process.exitCode = 1;
}

main();
