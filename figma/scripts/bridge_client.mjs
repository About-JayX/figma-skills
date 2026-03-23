#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

import {
  BRIDGE_BASE_URL,
  BRIDGE_SERVER_FILE,
  CACHE_ROOT,
  EXTRACT_REQUEST_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  SKILL_ROOT,
  STARTUP_RETRIES,
  STARTUP_WAIT_MS,
} from './lib/bridge_config.mjs';
import { parseTarget } from './lib/bridge_target.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const result = await response.json();
    return { ok: response.ok, status: response.status, result };
  } finally {
    clearTimeout(timer);
  }
}

async function getHealth() {
  try {
    const response = await fetchJson(`${BRIDGE_BASE_URL}/health`, {}, 1500);
    if (!response.ok || !response.result || response.result.ok !== true) {
      return null;
    }
    return response.result;
  } catch (error) {
    return null;
  }
}

function startBridge() {
  const child = spawn(process.execPath, [BRIDGE_SERVER_FILE], {
    cwd: SKILL_ROOT,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid;
}

async function ensureBridge() {
  let health = await getHealth();
  if (health) {
    return {
      ok: true,
      startedBridge: false,
      health,
    };
  }

  const pid = startBridge();

  for (let attempt = 0; attempt < STARTUP_RETRIES; attempt += 1) {
    await sleep(STARTUP_WAIT_MS);
    health = await getHealth();
    if (health) {
      return {
        ok: true,
        startedBridge: true,
        pid,
        health,
      };
    }
  }

  return {
    ok: false,
    startedBridge: true,
    pid,
    error: 'bridge 启动失败或未在预期时间内响应 /health',
  };
}

function buildMeta(data) {
  return {
    jobId: data && data.jobId ? data.jobId : null,
    target: data && data.target ? data.target : null,
    node: data && data.node ? data.node : null,
    extractedAt: data && data.extractedAt ? data.extractedAt : null,
    returnedAt: data && data.returnedAt ? data.returnedAt : null,
  };
}

function buildAgentPayload(data) {
  const defs = data && data.defs ? data.defs : {};
  return {
    meta: buildMeta(data),
    defs: {
      flat: defs.flat || {},
      full: defs.full || null,
      summary: defs.summary || null,
      unresolvedAliasIds: Array.isArray(defs.unresolvedAliasIds) ? defs.unresolvedAliasIds : [],
    },
    designSnapshot: data && data.designSnapshot ? data.designSnapshot : null,
    restSnapshot: data && data.restSnapshot ? data.restSnapshot : null,
    diagnostics: data && data.diagnostics ? data.diagnostics : null,
  };
}

function buildPluginInstallHint() {
  return {
    status: 'plugin_required',
    message:
      '未检测到活动的 ws_defs 插件连接。请先在 Figma Desktop 导入并运行 ./ws_defs 插件，再重试 bridge 请求。',
    pluginName: 'ws_defs',
    manifestPath: path.join(SKILL_ROOT, 'ws_defs', 'manifest.json'),
    steps: [
      '在 Figma Desktop 打开 Plugins -> Development -> Import plugin from manifest...',
      '选择 ./ws_defs/manifest.json',
      '打开目标设计文件后手动运行 ws_defs 插件',
      '确认插件 UI 显示 Bridge SSE 已连接，再重试当前命令',
    ],
  };
}

function sanitizePathPart(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function getCacheDir(data) {
  const fileKey =
    data && data.target && data.target.fileKey ? data.target.fileKey : 'unknown-file';
  const nodeId =
    data && data.target && data.target.nodeId ? data.target.nodeId
      : data && data.node && data.node.id ? data.node.id
      : 'unknown-node';

  return path.join(
    CACHE_ROOT,
    sanitizePathPart(fileKey),
    sanitizePathPart(nodeId)
  );
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function normalizeAssetExtension(asset) {
  if (!asset || typeof asset !== 'object') {
    return 'bin';
  }

  const format = typeof asset.format === 'string' ? asset.format.toLowerCase() : '';
  if (format === 'jpeg') {
    return 'jpg';
  }

  if (format) {
    return format;
  }

  const mimeType = typeof asset.mimeType === 'string' ? asset.mimeType.toLowerCase() : '';
  if (mimeType === 'image/jpeg') {
    return 'jpg';
  }
  if (mimeType === 'image/png') {
    return 'png';
  }
  if (mimeType === 'image/gif') {
    return 'gif';
  }
  if (mimeType === 'image/webp') {
    return 'webp';
  }
  if (mimeType === 'image/avif') {
    return 'avif';
  }

  return 'bin';
}

function materializeImageAssets(data, cacheDir) {
  const resources =
    data && data.designSnapshot && data.designSnapshot.resources
      ? data.designSnapshot.resources
      : null;
  const imageAssets =
    resources && resources.imageAssets && typeof resources.imageAssets === 'object'
      ? resources.imageAssets
      : null;

  if (!imageAssets) {
    return {};
  }

  const assetsDir = path.join(cacheDir, 'assets');
  const assetFiles = {};

  for (const [hash, asset] of Object.entries(imageAssets)) {
    if (!asset || typeof asset !== 'object') {
      continue;
    }

    const byteString = typeof asset.bytesBase64 === 'string' ? asset.bytesBase64 : '';
    if (!byteString) {
      continue;
    }

    fs.mkdirSync(assetsDir, { recursive: true });
    const extension = normalizeAssetExtension(asset);
    const fileName = `${sanitizePathPart(hash)}.${extension}`;
    const filePath = path.join(assetsDir, fileName);

    fs.writeFileSync(filePath, Buffer.from(byteString, 'base64'));

    asset.fileName = fileName;
    asset.relativePath = path.relative(cacheDir, filePath);
    asset.localPath = filePath;
    delete asset.bytesBase64;

    assetFiles[hash] = {
      fileName,
      relativePath: asset.relativePath,
      localPath: filePath,
      format: asset.format || null,
      mimeType: asset.mimeType || null,
      width: typeof asset.width === 'number' ? asset.width : null,
      height: typeof asset.height === 'number' ? asset.height : null,
      byteLength: typeof asset.byteLength === 'number' ? asset.byteLength : null,
    };
  }

  return assetFiles;
}

function persistBridgeResult(result) {
  if (!result || result.ok === false || !result.target) {
    return null;
  }

  return persistArtifacts(result);
}

function buildCacheManifest(data, cacheDir, assetFiles) {
  const target = data && data.target ? data.target : {};
  const node = data && data.node ? data.node : {};

  return {
    version: 3,
    fileKey: target.fileKey || null,
    nodeId: target.nodeId || node.id || null,
    cacheDir,
    bridgeFiles: {
      response: path.join(cacheDir, 'bridge-response.json'),
      agentPayload: path.join(cacheDir, 'bridge-agent-payload.json'),
      mergedAgentPayload: path.join(cacheDir, 'merged-agent-payload.json'),
      assetsDir: path.join(cacheDir, 'assets'),
    },
    mcpFiles: {
      designContext: path.join(cacheDir, 'design-context.md'),
      variableDefs: path.join(cacheDir, 'variable-defs.json'),
      screenshotObservation: path.join(cacheDir, 'screenshot-observation.md'),
      codeConnectMap: path.join(cacheDir, 'code-connect-map.json'),
      mergeSummary: path.join(cacheDir, 'merge-summary.md'),
    },
    assetFiles: assetFiles || {},
    mergePriority: {
      bridge: [
        'layout',
        'absoluteBoundingBox',
        'absoluteRenderBounds',
        'gradientTransform',
        'fills',
        'strokes',
        'effects',
        'vector',
        'textSegments',
        'boundVariables',
        'inferredVariables',
        'resolvedVariableModes',
        'css',
        'svgString',
        'restSnapshot',
        'imageAssets',
      ],
      mcp: [
        'screenshot',
        'assets',
        'codeConnect',
        'componentReuseHints',
        'remoteDesignContext',
      ],
    },
  };
}

function persistArtifacts(data) {
  if (!data || !data.target) {
    return null;
  }

  const cacheDir = getCacheDir(data);
  fs.mkdirSync(cacheDir, { recursive: true });
  const assetFiles = materializeImageAssets(data, cacheDir);
  writeJson(path.join(cacheDir, 'bridge-response.json'), data);
  writeJson(path.join(cacheDir, 'bridge-agent-payload.json'), buildAgentPayload(data));
  writeJson(path.join(cacheDir, 'cache-manifest.json'), buildCacheManifest(data, cacheDir, assetFiles));
  return cacheDir;
}

function buildAgentResult(extraction) {
  const result = extraction && extraction.result ? extraction.result : null;
  const cacheDir = persistBridgeResult(result);
  const pluginHint =
    result && result.errorCode === 'NO_PLUGIN_CONNECTION' ? buildPluginInstallHint() : null;

  return {
    ok: extraction && extraction.ok === true,
    startedBridge: extraction ? extraction.startedBridge === true : false,
    health: extraction ? extraction.health || null : null,
    plugin: pluginHint,
    bridge: result ? {
      jobId: result.jobId || null,
      target: result.target || null,
      node: result.node || null,
      defsSummary: result.defs && result.defs.summary ? result.defs.summary : null,
      restSnapshotAvailable: !!(result && result.restSnapshot),
      diagnostics: result && result.diagnostics ? result.diagnostics : null,
      error: result && result.error ? result.error : null,
      errorCode: result && result.errorCode ? result.errorCode : null,
      details: result && result.details ? result.details : null,
      extractedAt: result.extractedAt || null,
      returnedAt: result.returnedAt || null,
      cacheDir,
    } : null,
    agentPayload: result ? buildAgentPayload(result) : null,
  };
}

async function runExtract(input) {
  const ensured = await ensureBridge();
  if (!ensured.ok) {
    return ensured;
  }

  const response = await fetchJson(
    `${BRIDGE_BASE_URL}/extract-node-defs`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    },
    EXTRACT_REQUEST_TIMEOUT_MS
  );

  return {
    ok: response.ok && response.result && response.result.ok === true,
    startedBridge: ensured.startedBridge,
    health: ensured.health,
    result: response.result,
    status: response.status,
  };
}

async function runAssetFetch(targetInput, imageHash) {
  const ensured = await ensureBridge();
  if (!ensured.ok) return ensured;

  const target = parseTarget(targetInput);
  if (!target) return { ok: false, error: '无法解析目标节点' };

  const cacheDir = path.join(
    CACHE_ROOT,
    sanitizePathPart(target.fileKey || 'unknown-file'),
    sanitizePathPart(target.nodeId || 'unknown-node')
  );
  const assetsDir = path.join(cacheDir, 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${BRIDGE_BASE_URL}/extract-image-asset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: target.raw || targetInput, imageHash }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      return { ok: false, error: errBody.error || `HTTP ${response.status}`, target };
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('octet-stream')) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const ext = (response.headers.get('x-image-format') || 'png').toLowerCase();
      const safeHash = imageHash.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `${safeHash}.${ext}`;
      const filePath = path.join(assetsDir, fileName);
      fs.writeFileSync(filePath, buffer);

      return {
        ok: true,
        startedBridge: ensured.startedBridge,
        target,
        assetsDir,
        filePath,
        fileName,
        byteLength: buffer.length,
      };
    }

    const result = await response.json().catch(() => ({}));
    return { ok: false, error: result.error || 'unexpected response', target };
  } catch (error) {
    clearTimeout(timer);
    return { ok: false, error: error instanceof Error ? error.message : String(error), target };
  }
}

function usage() {
  return {
    ok: false,
    error:
      '用法: node ./scripts/bridge_client.mjs <health|ensure|extract|agent|asset> [figma-link-or-node-id] [image-hash]',
  };
}

async function main() {
  const command = process.argv[2];
  const input = process.argv.slice(3).join(' ').trim();
  let output = null;

  if (command === 'health') {
    const health = await getHealth();
    output = health
      ? { ok: true, health }
      : { ok: false, error: 'bridge 未启动或 /health 不可达' };
  } else if (command === 'ensure') {
    output = await ensureBridge();
  } else if (command === 'extract') {
    if (!input) {
      output = usage();
    } else {
      output = await runExtract(input);
      if (output && output.result) {
        output.cacheDir = persistBridgeResult(output.result);
      }
    }
  } else if (command === 'agent') {
    if (!input) {
      output = usage();
    } else {
      const extraction = await runExtract(input);
      output = buildAgentResult(extraction);
    }
  } else if (command === 'asset') {
    const parts = input.split(/\s+/);
    const targetInput = parts[0] || '';
    const imageHash = parts[1] || '';
    if (!targetInput || !imageHash) {
      output = { ok: false, error: '用法: asset <figma-url> <image-hash>' };
    } else {
      output = await runAssetFetch(targetInput, imageHash);
    }
  } else {
    output = usage();
  }

  console.log(JSON.stringify(output, null, 2));
  if (!output || output.ok !== true) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
