#!/usr/bin/env node
import path from 'path';
import { Readable } from 'stream';

import {
  RESULT_CHUNK_MAX_BYTES,
  RESULT_CHUNK_MAX_COUNT,
  RESULT_CHUNK_MAX_TOTAL_BYTES,
  RESULT_CHUNK_SIZE_BYTES,
} from './lib/bridge_config.mjs';
import { readBinaryBody } from './lib/bridge_http.mjs';
import { appendJobResultChunk } from './lib/bridge_server/chunk_store.mjs';
import { createBridgeServerState } from './lib/bridge_server/state.mjs';

const errors = [];

function fail(label, message) {
  errors.push(`[${label}] ${message}`);
}

function pass(label) {
  process.stderr.write(`  PASS: ${label}\n`);
}

function createMockRequest(data) {
  const stream = new Readable();
  stream.push(data);
  stream.push(null);
  return stream;
}

// Test 1: readBinaryBody rejects oversized single chunk
async function testOversizedSingleChunk() {
  const label = 'readBinaryBody rejects oversized chunk';
  const oversized = Buffer.alloc(RESULT_CHUNK_MAX_BYTES + 1, 0x41);
  const req = createMockRequest(oversized);

  try {
    await readBinaryBody(req, {
      maxBytes: RESULT_CHUNK_MAX_BYTES,
      errorCode: 'RESULT_CHUNK_TOO_LARGE',
      label: 'result chunk',
    });
    fail(label, 'Expected error but readBinaryBody succeeded');
  } catch (error) {
    if (error.code !== 'RESULT_CHUNK_TOO_LARGE') {
      fail(label, `Expected code RESULT_CHUNK_TOO_LARGE, got ${error.code}`);
    } else {
      pass(label);
    }
  }
}

// Test 2: appendJobResultChunk rejects excessive chunk count
function testExcessiveChunkCount() {
  const label = 'appendJobResultChunk rejects excessive chunk count';
  const state = createBridgeServerState({
    host: '127.0.0.1',
    port: 9999,
    startedAt: new Date().toISOString(),
  });

  const excessiveTotal = RESULT_CHUNK_MAX_COUNT + 1;
  const result = appendJobResultChunk(
    state,
    'test-job-count',
    '0',
    String(excessiveTotal),
    Buffer.from('x')
  );

  if (result.ok !== false) {
    fail(label, 'Expected ok=false');
  } else if (result.errorCode !== 'RESULT_CHUNK_COUNT_EXCEEDED') {
    fail(label, `Expected RESULT_CHUNK_COUNT_EXCEEDED, got ${result.errorCode}`);
  } else if (result.statusCode !== 413) {
    fail(label, `Expected status 413, got ${result.statusCode}`);
  } else {
    pass(label);
  }
}

// Test 3: cumulative bytes limit via subprocess with small limits
async function testCumulativeOversized() {
  const label = 'appendJobResultChunk rejects cumulative oversized';

  const script = `
    const { appendJobResultChunk } = await import('./lib/bridge_server/chunk_store.mjs');
    const { createBridgeServerState } = await import('./lib/bridge_server/state.mjs');

    const state = createBridgeServerState({
      host: '127.0.0.1', port: 9999,
      startedAt: new Date().toISOString(),
    });

    const chunkCount = 3;
    let gotError = false;
    for (let i = 0; i < chunkCount; i++) {
      const chunk = Buffer.alloc(800, 0x42);
      const result = appendJobResultChunk(state, 'test-cum', String(i), String(chunkCount), chunk);
      if (!result.ok && result.errorCode === 'RESULT_CHUNK_TOTAL_TOO_LARGE') {
        gotError = true;
        break;
      }
    }

    process.stdout.write(JSON.stringify({ gotError }));
  `;

  const { spawn: spawnChild } = await import('child_process');
  const result = await new Promise((resolve, reject) => {
    const child = spawnChild(process.execPath, [
      '--input-type=module',
      '-e',
      script,
    ], {
      cwd: path.dirname(new URL(import.meta.url).pathname),
      env: {
        ...process.env,
        FIGMA_BRIDGE_RESULT_CHUNK_MAX_TOTAL_BYTES: '2000',
        FIGMA_BRIDGE_RESULT_CHUNK_MAX_BYTES: '1500',
        FIGMA_BRIDGE_RESULT_CHUNK_MAX_COUNT: '100',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('exit', () => {
      try { resolve(JSON.parse(stdout.trim())); }
      catch { resolve({ gotError: false }); }
    });
    child.on('error', reject);
  });

  if (result.gotError) {
    pass(label);
  } else {
    fail(label, 'Expected RESULT_CHUNK_TOTAL_TOO_LARGE but all chunks accepted');
  }
}

// Test 4: UTF-8 round-trip with multibyte characters across chunk boundaries
// Uses a deliberately small chunk size (32 bytes) to force multibyte chars
// to land on chunk boundaries, verifying reassembly integrity.
function testUtf8RoundTrip() {
  const label = 'UTF-8 multi-chunk round-trip with multibyte chars';
  const state = createBridgeServerState({
    host: '127.0.0.1',
    port: 9999,
    startedAt: new Date().toISOString(),
  });

  const original = JSON.stringify({
    message: '这是一段中文测试文本 🎨 with mixed ASCII',
    data: Array(50).fill('设计稿变量名称').join('|'),
  });

  const encoded = Buffer.from(original, 'utf8');
  // Force many small chunks to ensure multibyte chars span boundaries
  const testChunkSize = 32;
  const totalChunks = Math.ceil(encoded.length / testChunkSize);

  if (totalChunks < 3) {
    fail(label, `Expected at least 3 chunks but got ${totalChunks}`);
    return;
  }

  for (let i = 0; i < totalChunks; i++) {
    const start = i * testChunkSize;
    const end = Math.min(start + testChunkSize, encoded.length);
    const chunk = encoded.subarray(start, end);

    const result = appendJobResultChunk(
      state,
      'test-job-utf8',
      String(i),
      String(totalChunks),
      chunk
    );

    if (i < totalChunks - 1) {
      if (result.ok !== true || result.complete !== false) {
        fail(label, `Intermediate chunk ${i} unexpected result`);
        return;
      }
    } else {
      if (result.ok !== true || result.complete !== true) {
        fail(label, `Final chunk result not complete`);
        return;
      }
      const reassembled = Buffer.isBuffer(result.body)
        ? result.body.toString('utf8')
        : result.body;
      if (reassembled !== original) {
        fail(label, 'Reassembled body does not match original');
        return;
      }
    }
  }

  pass(label + ` (${totalChunks} chunks, ${testChunkSize}B each)`);
}

async function main() {
  process.stderr.write('Running result chunk limit checks...\n');

  await testOversizedSingleChunk();
  testExcessiveChunkCount();
  await testCumulativeOversized();
  testUtf8RoundTrip();

  if (errors.length === 0) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          checks: 4,
          message: 'All result chunk limit checks passed',
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
