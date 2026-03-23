import fs from 'fs';
import path from 'path';

import { CACHE_ROOT } from './bridge_config.mjs';
import { writeJsonFile, writeJsonFileStreaming } from './bridge_http.mjs';

export function sanitizePathPart(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export function getCacheDirFromTarget(target, node) {
  const fileKey = target && target.fileKey ? target.fileKey : 'unknown-file';
  const nodeId =
    target && target.nodeId ? target.nodeId : node && node.id ? node.id : 'unknown-node';

  return path.join(CACHE_ROOT, sanitizePathPart(fileKey), sanitizePathPart(nodeId));
}

export function ensureCacheDirForResult(result) {
  const target = result && result.target ? result.target : null;
  const node = result && result.node ? result.node : null;
  const cacheDir = getCacheDirFromTarget(target, node);
  fs.mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

export function normalizeAssetExtension(asset) {
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

export function upsertAssetMetadata(cacheDir, assetMetadata) {
  if (!cacheDir || !assetMetadata || !assetMetadata.imageHash) {
    return null;
  }

  const assetsDir = path.join(cacheDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const extension = normalizeAssetExtension(assetMetadata);
  const fileName = `${sanitizePathPart(assetMetadata.imageHash)}.${extension}`;
  const filePath = path.join(assetsDir, fileName);

  if (assetMetadata.bytes && Buffer.isBuffer(assetMetadata.bytes)) {
    fs.writeFileSync(filePath, assetMetadata.bytes);
  }

  const metadata = {
    imageHash: assetMetadata.imageHash,
    fileName,
    relativePath: path.relative(cacheDir, filePath),
    localPath: filePath,
    format: assetMetadata.format || null,
    mimeType: assetMetadata.mimeType || null,
    width: typeof assetMetadata.width === 'number' ? assetMetadata.width : null,
    height: typeof assetMetadata.height === 'number' ? assetMetadata.height : null,
    byteLength:
      typeof assetMetadata.byteLength === 'number'
        ? assetMetadata.byteLength
        : Buffer.isBuffer(assetMetadata.bytes)
          ? assetMetadata.bytes.length
          : null,
  };

  const manifestFile = path.join(cacheDir, 'cache-manifest.json');
  let manifest = null;
  if (fs.existsSync(manifestFile)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch (error) {
      manifest = null;
    }
  }

  if (!manifest || typeof manifest !== 'object') {
    manifest = {
      version: 4,
      cacheDir,
      bridgeFiles: {
        response: path.join(cacheDir, 'bridge-response.json'),
        agentPayload: path.join(cacheDir, 'bridge-agent-payload.json'),
        mergedAgentPayload: path.join(cacheDir, 'merged-agent-payload.json'),
        assetsDir,
      },
      assetFiles: {},
    };
  }

  manifest.version = 4;
  manifest.bridgeFiles = Object.assign({}, manifest.bridgeFiles || {}, { assetsDir });
  manifest.assetFiles = Object.assign({}, manifest.assetFiles || {}, {
    [assetMetadata.imageHash]: metadata,
  });

  writeJsonFile(manifestFile, manifest);
  return metadata;
}

export function buildMeta(data) {
  return {
    jobId: data && data.jobId ? data.jobId : null,
    target: data && data.target ? data.target : null,
    node: data && data.node ? data.node : null,
    extractedAt: data && data.extractedAt ? data.extractedAt : null,
    returnedAt: data && data.returnedAt ? data.returnedAt : null,
  };
}

export function buildAgentPayload(data) {
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

export function buildCacheManifest(data, cacheDir, assetFiles) {
  const target = data && data.target ? data.target : {};
  const node = data && data.node ? data.node : {};

  return {
    version: 4,
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

export function materializeEmbeddedImageAssets(data, cacheDir) {
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

  const assetFiles = {};
  for (const [hash, asset] of Object.entries(imageAssets)) {
    if (!asset || typeof asset !== 'object' || typeof asset.bytesBase64 !== 'string') {
      continue;
    }

    const metadata = upsertAssetMetadata(cacheDir, {
      imageHash: hash,
      format: asset.format || null,
      mimeType: asset.mimeType || null,
      width: typeof asset.width === 'number' ? asset.width : null,
      height: typeof asset.height === 'number' ? asset.height : null,
      byteLength: typeof asset.byteLength === 'number' ? asset.byteLength : null,
      bytes: Buffer.from(asset.bytesBase64, 'base64'),
    });

    delete asset.bytesBase64;
    if (metadata) {
      asset.fileName = metadata.fileName;
      asset.relativePath = metadata.relativePath;
      asset.localPath = metadata.localPath;
      assetFiles[hash] = metadata;
    }
  }

  return assetFiles;
}

export function persistBridgeResult(result) {
  if (!result || result.ok === false || !result.target) {
    return null;
  }

  const cacheDir = ensureCacheDirForResult(result);
  const assetFiles = materializeEmbeddedImageAssets(result, cacheDir);
  writeJsonFileStreaming(path.join(cacheDir, 'bridge-response.json'), result);
  writeJsonFile(path.join(cacheDir, 'bridge-agent-payload.json'), buildAgentPayload(result));
  writeJsonFile(path.join(cacheDir, 'cache-manifest.json'), buildCacheManifest(result, cacheDir, assetFiles));
  return cacheDir;
}
