import fs from 'fs';
import path from 'path';

import { CACHE_ROOT } from './bridge_config.mjs';
import { writeJsonFile, writeJsonFileStreaming } from './bridge_http.mjs';
import { sniffImageFormat, formatToExtension } from './image_format.mjs';

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

  // L1.1: when the upstream caller didn't provide a format / mimeType,
  // sniff it from the actual bytes. The previous fallback chain ended at
  // 'bin' for any image whose plugin metadata wasn't filled in, which
  // produced bridge-side .bin files and downstream URLs guessed wrong.
  let resolvedFormat = assetMetadata.format;
  if ((!resolvedFormat || normalizeAssetExtension(assetMetadata) === 'bin')
      && Buffer.isBuffer(assetMetadata.bytes)) {
    const sniffed = sniffImageFormat(assetMetadata.bytes);
    if (sniffed && sniffed !== 'bin') {
      resolvedFormat = sniffed;
    }
  }
  const extension = formatToExtension(resolvedFormat) === 'bin'
    ? normalizeAssetExtension(assetMetadata)
    : formatToExtension(resolvedFormat);
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
    format: resolvedFormat || null,
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

function attachBlobMetadataToNode(node, blobByNodeId) {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (
    node.svgRef &&
    typeof node.svgRef === 'object' &&
    typeof node.svgRef.nodeId === 'string' &&
    blobByNodeId[node.svgRef.nodeId]
  ) {
    Object.assign(node.svgRef, blobByNodeId[node.svgRef.nodeId]);
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      attachBlobMetadataToNode(child, blobByNodeId);
    }
  }
}

function trimNodeTree(node, isRoot) {
  if (!node || typeof node !== 'object') return node;
  const out = Object.assign({}, node);
  if (!isRoot) {
    // Only root keeps svgString (used for baseline generation) and css;
    // child svgStrings and css objects are heavy and unused by pipeline/cross-validation.
    delete out.svgString;
    delete out.css;
  }
  if (Array.isArray(out.children)) {
    out.children = out.children.map((c) => trimNodeTree(c, false));
  }
  return out;
}

function trimDesignSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const trimmed = Object.assign({}, snapshot);
  // Trim node tree: strip svgString from non-root nodes
  if (trimmed.root) {
    trimmed.root = trimNodeTree(trimmed.root, true);
  }
  // Strip heavy resources.imageAssets bytesBase64 (already materialized to disk)
  if (trimmed.resources && typeof trimmed.resources === 'object') {
    const res = Object.assign({}, trimmed.resources);
    if (res.imageAssets && typeof res.imageAssets === 'object') {
      const cleanAssets = {};
      for (const [hash, asset] of Object.entries(res.imageAssets)) {
        if (asset && typeof asset === 'object') {
          const { bytesBase64, ...rest } = asset;
          cleanAssets[hash] = rest;
        } else {
          cleanAssets[hash] = asset;
        }
      }
      res.imageAssets = cleanAssets;
    }
    trimmed.resources = res;
  }
  return trimmed;
}

function trimRestSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  // Keep only structural metadata, drop full node trees to limit size
  return {
    available: true,
    nodeCount: snapshot.document && snapshot.document.children
      ? countNodes(snapshot.document)
      : null,
    name: snapshot.name || null,
    lastModified: snapshot.lastModified || null,
    version: snapshot.version || null,
  };
}

function countNodes(node) {
  if (!node) return 0;
  let count = 1;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}

export function buildAgentPayload(data) {
  const defs = data && data.defs ? data.defs : {};
  return {
    meta: buildMeta(data),
    defs: {
      flat: defs.flat || {},
      // defs.full omitted — it duplicates bridge-response.json and can be tens of MB
      summary: defs.summary || null,
      unresolvedAliasIds: Array.isArray(defs.unresolvedAliasIds) ? defs.unresolvedAliasIds : [],
    },
    designSnapshot: trimDesignSnapshot(data && data.designSnapshot ? data.designSnapshot : null),
    restSnapshot: trimRestSnapshot(data && data.restSnapshot ? data.restSnapshot : null),
    sideChannelBlobs: Array.isArray(data && data.sideChannelBlobs)
      ? data.sideChannelBlobs.map((blob) => ({
          kind: blob && blob.kind ? blob.kind : 'blob',
          blobId: blob && blob.blobId ? blob.blobId : null,
          nodeId: blob && blob.nodeId ? blob.nodeId : null,
          fileName: blob && blob.fileName ? blob.fileName : null,
          relativePath: blob && blob.relativePath ? blob.relativePath : null,
          localPath: blob && blob.localPath ? blob.localPath : null,
          byteLength: blob && typeof blob.byteLength === 'number' ? blob.byteLength : null,
          ext: blob && blob.ext ? blob.ext : null,
        }))
      : [],
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
        'svgRef',
        'svgString',
        'sideChannelBlobs',
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

// A8: side-channel binary assets uploaded via /jobs/:jobId/asset (e.g. FRAME
// baseline PNGs). Persists each to cache/<key>/assets/<hash>.<format> and
// strips the Buffer from the result object so JSON serialization stays clean.
function coerceToBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  // Buffer round-tripped through JSON becomes { type: 'Buffer', data: [...] }
  if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  return null;
}

export function materializeSideChannelAssets(data, cacheDir) {
  const assets = Array.isArray(data && data.sideChannelAssets) ? data.sideChannelAssets : [];
  if (assets.length === 0) {
    return {};
  }

  const assetFiles = {};
  for (const asset of assets) {
    if (!asset || !asset.hash) continue;
    const buf = coerceToBuffer(asset.bytes);
    if (!buf) continue;
    const metadata = upsertAssetMetadata(cacheDir, {
      imageHash: asset.hash,
      format: asset.format || 'png',
      bytes: buf,
      byteLength: buf.length,
    });
    if (metadata) {
      assetFiles[asset.hash] = metadata;
      asset.fileName = metadata.fileName;
      asset.relativePath = metadata.relativePath;
      asset.localPath = metadata.localPath;
      asset.byteLength = metadata.byteLength;
    }
    delete asset.bytes;
  }
  return assetFiles;
}

export function materializeSideChannelBlobs(data, cacheDir) {
  const blobs = Array.isArray(data && data.sideChannelBlobs) ? data.sideChannelBlobs : [];
  if (blobs.length === 0) {
    return {};
  }

  const blobsDir = path.join(cacheDir, 'blobs');
  fs.mkdirSync(blobsDir, { recursive: true });

  const blobFiles = {};
  const blobByNodeId = {};

  for (const blob of blobs) {
    if (!blob || typeof blob !== 'object' || typeof blob.localPath !== 'string' || !fs.existsSync(blob.localPath)) {
      continue;
    }

    const fileName = blob.fileName || `${sanitizePathPart(blob.kind || 'blob')}-${sanitizePathPart(blob.nodeId || blob.blobId || 'unknown')}.${sanitizePathPart(blob.ext || 'bin')}`;
    const destPath = path.join(blobsDir, fileName);
    fs.renameSync(blob.localPath, destPath);

    blob.fileName = fileName;
    blob.localPath = destPath;
    blob.relativePath = path.relative(cacheDir, destPath);

    if (blob.nodeId) {
      blobByNodeId[blob.nodeId] = {
        fileName: blob.fileName,
        localPath: blob.localPath,
        relativePath: blob.relativePath,
      };
    }

    blobFiles[blob.blobId || blob.nodeId || fileName] = {
      kind: blob.kind || 'blob',
      nodeId: blob.nodeId || null,
      fileName: blob.fileName,
      localPath: blob.localPath,
      relativePath: blob.relativePath,
      byteLength: typeof blob.byteLength === 'number' ? blob.byteLength : null,
      ext: blob.ext || null,
    };
  }

  if (data && data.designSnapshot && data.designSnapshot.root) {
    attachBlobMetadataToNode(data.designSnapshot.root, blobByNodeId);
  }

  return blobFiles;
}

export function persistBridgeResult(result) {
  if (!result || result.ok === false || !result.target) {
    return null;
  }

  const cacheDir = ensureCacheDirForResult(result);
  const assetFiles = materializeEmbeddedImageAssets(result, cacheDir);
  const sideAssetFiles = materializeSideChannelAssets(result, cacheDir);
  const blobFiles = materializeSideChannelBlobs(result, cacheDir);

  // Write bridge-response first (largest), then build+write agent payload.
  // Using streaming for both to avoid holding entire JSON strings in memory.
  writeJsonFileStreaming(path.join(cacheDir, 'bridge-response.json'), result);

  const agentPayload = buildAgentPayload(result);
  writeJsonFileStreaming(path.join(cacheDir, 'bridge-agent-payload.json'), agentPayload);

  writeJsonFile(
    path.join(cacheDir, 'cache-manifest.json'),
    buildCacheManifest(result, cacheDir, Object.assign({}, assetFiles, sideAssetFiles, blobFiles))
  );
  return cacheDir;
}
