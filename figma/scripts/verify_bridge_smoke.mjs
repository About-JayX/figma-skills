#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, '..');
const SERVER_FILE = path.join(SKILL_ROOT, 'scripts', 'bridge_server.mjs');
const CLIENT_FILE = path.join(SKILL_ROOT, 'scripts', 'bridge_client.mjs');

const TEST_PORT = 13333 + Math.floor(Math.random() * 1000);
const TEST_HOST = '127.0.0.1';
const STARTUP_TIMEOUT_MS = 8000;

const errors = [];

function fail(message) {
  errors.push(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const result = await response.json();
    return { ok: response.ok, status: response.status, result };
  } finally {
    clearTimeout(timer);
  }
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

    child.stderr.on('data', (data) => {
      output += data.toString();
    });

    child.on('error', (error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(error);
      }
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

function runClient(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLIENT_FILE, command], {
      env: {
        ...process.env,
        FIGMA_BRIDGE_HOST: TEST_HOST,
        FIGMA_BRIDGE_PORT: String(TEST_PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('exit', (code) => {
      try {
        const result = JSON.parse(stdout.trim());
        resolve({ code, result, stderr });
      } catch {
        resolve({ code, result: null, stdout, stderr });
      }
    });

    child.on('error', reject);
  });
}

async function main() {
  let serverProcess = null;

  try {
    // 1. Start bridge server on test port
    serverProcess = await startServer();
    await sleep(500);

    // 2. Direct /health request
    const healthResponse = await fetchJson(`http://${TEST_HOST}:${TEST_PORT}/health`);

    if (!healthResponse.ok || !healthResponse.result) {
      fail('/health: response not ok');
    } else {
      const h = healthResponse.result;
      if (h.ok !== true) fail('/health: ok !== true');
      if (h.host !== TEST_HOST) fail(`/health: host="${h.host}" expected="${TEST_HOST}"`);
      if (h.port !== TEST_PORT) fail(`/health: port=${h.port} expected=${TEST_PORT}`);
      if (typeof h.pluginConnections !== 'number') fail('/health: pluginConnections not a number');
      if (typeof h.pendingJobs !== 'number') fail('/health: pendingJobs not a number');
    }

    // 3. bridge_client.mjs health
    const clientHealth = await runClient('health');
    if (!clientHealth.result || clientHealth.result.ok !== true) {
      fail('bridge_client health: failed');
    }

    // 4. bridge_client.mjs ensure
    const clientEnsure = await runClient('ensure');
    if (!clientEnsure.result || clientEnsure.result.ok !== true) {
      fail('bridge_client ensure: failed');
    }
  } catch (error) {
    fail(`Smoke test error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
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
          port: TEST_PORT,
          checks: 4,
          message: 'All bridge smoke checks passed',
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
          port: TEST_PORT,
          errors,
        },
        null,
        2
      ) + '\n'
    );
    process.exitCode = 1;
  }
}

main();
