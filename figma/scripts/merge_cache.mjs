#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const RESULT_FILE = path.join(ROOT, 'figma-variables.json');
const CACHE_ROOT = path.join(ROOT, 'figma', 'cache');
const LEGACY_CACHE_ROOT = path.join(ROOT, 'artifacts', 'figma-node-cache');

function sanitizePathPart(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function maybeReadJson(file) {
  return fs.existsSync(file) ? readJson(file) : null;
}

function maybeReadText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function buildCacheDir(baseDir, fileKey, nodeId) {
  return path.join(baseDir, sanitizePathPart(fileKey), sanitizePathPart(nodeId));
}

function resolveCacheDir(fileKey, nodeId) {
  const nextDir = buildCacheDir(CACHE_ROOT, fileKey, nodeId);
  if (fs.existsSync(nextDir)) {
    return nextDir;
  }

  const legacyDir = buildCacheDir(LEGACY_CACHE_ROOT, fileKey, nodeId);
  if (fs.existsSync(legacyDir)) {
    return legacyDir;
  }

  return nextDir;
}

function hasUsableCodeConnectMap(codeConnectMap) {
  if (!codeConnectMap || typeof codeConnectMap !== 'object' || Array.isArray(codeConnectMap)) {
    return false;
  }

  if (codeConnectMap.ok === false || codeConnectMap.error) {
    return false;
  }

  return Object.keys(codeConnectMap).length > 0;
}

function parseTargetFromInput(input) {
  const trimmed = String(input || '').trim().replace(/^@/, '');
  if (!trimmed) {
    return null;
  }

  if (fs.existsSync(trimmed) && fs.statSync(trimmed).isDirectory()) {
    return { cacheDir: path.resolve(trimmed) };
  }

  if (!/^https?:\/\//.test(trimmed)) {
    return null;
  }

  const url = new URL(trimmed);
  const match = url.pathname.match(/\/(?:design|file)\/([^/]+)/);
  const nodeIdParam = url.searchParams.get('node-id');
  if (!match || !nodeIdParam) {
    return null;
  }

  const fileKey = match[1];
  const nodeId = nodeIdParam.replace(/-/g, ':');
  return {
    fileKey,
    nodeId,
    cacheDir: resolveCacheDir(fileKey, nodeId),
  };
}

function readLatestTarget() {
  if (!fs.existsSync(RESULT_FILE)) {
    return null;
  }

  const latest = readJson(RESULT_FILE);
  if (!latest || !latest.target) {
    return null;
  }

  const fileKey = latest.target.fileKey || null;
  const nodeId = latest.target.nodeId || (latest.node && latest.node.id) || null;
  if (!fileKey || !nodeId) {
    return null;
  }

  return {
    fileKey,
    nodeId,
    cacheDir: resolveCacheDir(fileKey, nodeId),
  };
}

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^--/, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function getBridgeVariableNames(bridgeResponse) {
  const fromResources =
    bridgeResponse &&
    bridgeResponse.designSnapshot &&
    bridgeResponse.designSnapshot.resources &&
    Array.isArray(bridgeResponse.designSnapshot.resources.variables)
      ? bridgeResponse.designSnapshot.resources.variables.map((item) => item.name)
      : [];

  const fromFlat =
    bridgeResponse && bridgeResponse.defs && bridgeResponse.defs.flat
      ? Object.keys(bridgeResponse.defs.flat.colors || {})
          .concat(Object.keys(bridgeResponse.defs.flat.numbers || {}))
          .concat(Object.keys(bridgeResponse.defs.flat.strings || {}))
          .concat(Object.keys(bridgeResponse.defs.flat.booleans || {}))
      : [];

  return uniqueSorted(fromResources.concat(fromFlat));
}

function getMcpVariableNames(variableDefs) {
  if (!variableDefs || typeof variableDefs !== 'object' || Array.isArray(variableDefs)) {
    return [];
  }
  return uniqueSorted(Object.keys(variableDefs));
}

function buildVariableDiff(bridgeNames, mcpNames) {
  const bridgeMap = new Map(bridgeNames.map((name) => [normalizeName(name), name]));
  const mcpMap = new Map(mcpNames.map((name) => [normalizeName(name), name]));

  const shared = [];
  const bridgeOnly = [];
  const mcpOnly = [];

  for (const [normalized, original] of bridgeMap.entries()) {
    if (mcpMap.has(normalized)) {
      shared.push({ bridge: original, mcp: mcpMap.get(normalized) });
    } else {
      bridgeOnly.push(original);
    }
  }

  for (const [normalized, original] of mcpMap.entries()) {
    if (!bridgeMap.has(normalized)) {
      mcpOnly.push(original);
    }
  }

  return {
    sharedCount: shared.length,
    bridgeOnlyCount: bridgeOnly.length,
    mcpOnlyCount: mcpOnly.length,
    shared,
    bridgeOnly,
    mcpOnly,
  };
}

function buildMergeSummaryMarkdown(merged) {
  const lines = [];
  lines.push('# Merge Summary');
  lines.push('');
  lines.push(`- fileKey: ${merged.meta.fileKey || 'unknown'}`);
  lines.push(`- nodeId: ${merged.meta.nodeId || 'unknown'}`);
  lines.push(`- cacheDir: ${merged.meta.cacheDir}`);
  lines.push('');
  lines.push('## Availability');
  lines.push(`- bridgeResponse: ${merged.availability.bridgeResponse}`);
  lines.push(`- bridgeAgentPayload: ${merged.availability.bridgeAgentPayload}`);
  lines.push(`- bridgeRestSnapshot: ${merged.availability.bridgeRestSnapshot}`);
  lines.push(`- designContext: ${merged.availability.designContext}`);
  lines.push(`- variableDefs: ${merged.availability.variableDefs}`);
  lines.push(`- screenshotObservation: ${merged.availability.screenshotObservation}`);
  lines.push(`- codeConnectMap: ${merged.availability.codeConnectMap}`);
  lines.push('');
  lines.push('## Merge Priority');
  lines.push(`- bridge: ${merged.mergePolicy.bridge.join(', ')}`);
  lines.push(`- mcp: ${merged.mergePolicy.mcp.join(', ')}`);
  lines.push('');
  lines.push('## Variable Diff');
  lines.push(`- shared: ${merged.diff.variables.sharedCount}`);
  lines.push(`- bridgeOnly: ${merged.diff.variables.bridgeOnlyCount}`);
  lines.push(`- mcpOnly: ${merged.diff.variables.mcpOnlyCount}`);
  lines.push('');
  lines.push('## Guidance');
  lines.push('- bridge 默认提供 designSnapshot 真源、inspect css 提示、restSnapshot 对账和条件 svg 兜底。');
  lines.push('- 布局、渐变、描边、多层 paints、vector 和 live variable 绑定优先用 bridge。');
  lines.push('- screenshot、assets、Code Connect、远程结构化补充优先用 MCP。');
  lines.push('- 复杂 fill 先看 bridge.designSnapshot.root.style + node.css；需要对账时再看 bridge.response.restSnapshot。');
  lines.push('- 如果 MCP 某项缺失，不阻塞 bridge 数据用于代码实现。');
  lines.push('- 如果 bridge 缺少截图或组件映射，不要臆测，补 MCP。');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function usage() {
  return {
    ok: false,
    error:
      '用法: node ./scripts/merge_cache.mjs <figma-link|cache-dir>',
  };
}

function main() {
  const rawInput = process.argv.slice(2).join(' ').trim();
  if (!rawInput) {
    console.log(JSON.stringify(usage(), null, 2));
    process.exitCode = 1;
    return;
  }
  const target = parseTargetFromInput(rawInput);
  if (!target || !target.cacheDir) {
    console.log(JSON.stringify(usage(), null, 2));
    process.exitCode = 1;
    return;
  }

  const cacheDir = target.cacheDir;
  if (!fs.existsSync(cacheDir)) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          error: `cache 目录不存在: ${cacheDir}`,
        },
        null,
        2
      )
    );
    process.exitCode = 1;
    return;
  }

  const manifest = maybeReadJson(path.join(cacheDir, 'cache-manifest.json'));
  const bridgeResponse = maybeReadJson(path.join(cacheDir, 'bridge-response.json'));
  const bridgeAgentPayload = maybeReadJson(path.join(cacheDir, 'bridge-agent-payload.json'));
  const variableDefs = maybeReadJson(path.join(cacheDir, 'variable-defs.json'));
  const codeConnectMap = maybeReadJson(path.join(cacheDir, 'code-connect-map.json'));
  const designContext = maybeReadText(path.join(cacheDir, 'design-context.md'));
  const screenshotObservation = maybeReadText(path.join(cacheDir, 'screenshot-observation.md'));
  const codeConnectAvailable = hasUsableCodeConnectMap(codeConnectMap);

  const bridgeVariableNames = getBridgeVariableNames(bridgeResponse);
  const mcpVariableNames = getMcpVariableNames(variableDefs);
  const variableDiff = buildVariableDiff(bridgeVariableNames, mcpVariableNames);

  const merged = {
    ok: true,
    meta: {
      fileKey:
        (manifest && manifest.fileKey) ||
        (bridgeResponse && bridgeResponse.target && bridgeResponse.target.fileKey) ||
        (target && target.fileKey) ||
        null,
      nodeId:
        (manifest && manifest.nodeId) ||
        (bridgeResponse && bridgeResponse.target && bridgeResponse.target.nodeId) ||
        (target && target.nodeId) ||
        null,
      cacheDir,
      bridgeJobId: bridgeResponse && bridgeResponse.jobId ? bridgeResponse.jobId : null,
    },
    availability: {
      bridgeResponse: !!bridgeResponse,
      bridgeAgentPayload: !!bridgeAgentPayload,
      bridgeRestSnapshot: !!(bridgeResponse && bridgeResponse.restSnapshot),
      designContext: !!designContext,
      variableDefs: !!variableDefs,
      screenshotObservation: !!screenshotObservation,
      codeConnectMap: codeConnectAvailable,
    },
    mergePolicy: manifest && manifest.mergePriority ? manifest.mergePriority : {
      bridge: ['layout', 'style', 'vector', 'liveVariables', 'css', 'svgString', 'restSnapshot', 'imageAssets'],
      mcp: ['screenshot', 'assets', 'codeConnect', 'remoteContext'],
    },
    bridge: {
      summary:
        bridgeResponse && bridgeResponse.defs && bridgeResponse.defs.summary
          ? bridgeResponse.defs.summary
          : null,
      response: bridgeResponse,
      agentPayload: bridgeAgentPayload,
    },
    mcp: {
      designContext,
      variableDefs,
      codeConnectMap,
      screenshotObservation,
    },
    diff: {
      variables: variableDiff,
    },
    implementationHints: {
      primaryGeometrySource: 'bridge.designSnapshot',
      primaryPaintSource: 'bridge.designSnapshot + bridge.response.restSnapshot',
      primaryVisualReference: screenshotObservation ? 'mcp.screenshotObservation' : 'mcp.designContext',
      primaryTokenSource: variableDefs ? 'bridge + mcp.variableDefs' : 'bridge.defs',
      primaryReconciliationSource:
        bridgeResponse && bridgeResponse.restSnapshot ? 'bridge.restSnapshot' : null,
      primaryReuseSource: codeConnectAvailable ? 'mcp.codeConnectMap' : 'local project inspection',
    },
  };

  fs.writeFileSync(
    path.join(cacheDir, 'merged-agent-payload.json'),
    JSON.stringify(merged, null, 2)
  );
  fs.writeFileSync(
    path.join(cacheDir, 'merge-summary.md'),
    buildMergeSummaryMarkdown(merged)
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        cacheDir,
        mergedAgentPayload: path.join(cacheDir, 'merged-agent-payload.json'),
        mergeSummary: path.join(cacheDir, 'merge-summary.md'),
        availability: merged.availability,
        variableDiff: {
          sharedCount: variableDiff.sharedCount,
          bridgeOnlyCount: variableDiff.bridgeOnlyCount,
          mcpOnlyCount: variableDiff.mcpOnlyCount,
        },
      },
      null,
      2
    )
  );
}

main();
