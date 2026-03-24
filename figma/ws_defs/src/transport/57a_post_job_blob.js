function getBlobTransportLimits() {
  var runtime =
    typeof WS_DEFS_CONFIG === 'object' &&
    WS_DEFS_CONFIG &&
    WS_DEFS_CONFIG.blobTransport
      ? WS_DEFS_CONFIG.blobTransport
      : {};

  return {
    chunkSizeBytes: Number(runtime.chunkSizeBytes) || 512 * 1024,
    maxChunkBytes: Number(runtime.maxChunkBytes) || 512 * 1024,
    maxTotalBytes: Number(runtime.maxTotalBytes) || 128 * 1024 * 1024,
    maxChunkCount: Number(runtime.maxChunkCount) || 256,
  };
}

async function postJobBlob(jobId, blob, reportStage) {
  if (!blob || typeof blob !== 'object') {
    throw createPluginError('INVALID_BLOB', '缺少 blob 元数据');
  }

  var text = typeof blob.text === 'string' ? blob.text : '';
  var nodeId = typeof blob.nodeId === 'string' ? blob.nodeId : null;
  var kind = typeof blob.kind === 'string' ? blob.kind : 'blob';
  var ext = typeof blob.ext === 'string' ? blob.ext : 'bin';
  var limits = getBlobTransportLimits();
  var bytes = encodeUtf8Text(text);
  var byteLength = bytes.length;

  if (byteLength > limits.maxTotalBytes) {
    throw createPluginError(
      'BLOB_TOO_LARGE',
      'blob 字节超出上限: ' + byteLength + ' > ' + limits.maxTotalBytes,
      {
        kind: kind,
        nodeId: nodeId,
        byteLength: byteLength,
        maxTotalBytes: limits.maxTotalBytes,
      }
    );
  }

  if (reportStage) {
    reportStage.loading('blob.transport.start', 'SVG side-channel 上传中', {
      kind: kind,
      nodeId: nodeId,
      byteLength: byteLength,
    });
  }

  var params = [
    'kind=' + encodeURIComponent(kind),
    'nodeId=' + encodeURIComponent(nodeId || ''),
    'ext=' + encodeURIComponent(ext),
  ];
  var blobUrl = BRIDGE_BASE_URL + '/jobs/' + encodeURIComponent(jobId) + '/blob?' + params.join('&');

  if (byteLength <= limits.chunkSizeBytes) {
    var response = await fetch(blobUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    var result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result && result.error ? result.error : 'Bridge blob 回传失败');
    }

    if (reportStage) {
      reportStage.ok('blob.transport.done', 'SVG side-channel 上传完成', {
        kind: kind,
        nodeId: nodeId,
        byteLength: byteLength,
        chunked: false,
      });
    }

    return {
      transfer: 'side-channel',
      kind: kind,
      nodeId: nodeId,
      ext: ext,
      blobId: result.blobId || (kind + ':' + (nodeId || 'unknown')),
      byteLength: byteLength,
    };
  }

  var totalChunks = Math.ceil(byteLength / limits.chunkSizeBytes);
  if (totalChunks > limits.maxChunkCount) {
    throw createPluginError(
      'BLOB_CHUNK_COUNT_EXCEEDED',
      'blob 分块数超出上限: ' + totalChunks + ' > ' + limits.maxChunkCount,
      {
        kind: kind,
        nodeId: nodeId,
        totalChunks: totalChunks,
        maxChunkCount: limits.maxChunkCount,
      }
    );
  }

  for (var i = 0; i < totalChunks; i += 1) {
    var start = i * limits.chunkSizeBytes;
    var end = Math.min(start + limits.chunkSizeBytes, bytes.length);
    var chunk = bytes.subarray(start, end);
    if (chunk.byteLength > limits.maxChunkBytes) {
      throw createPluginError(
        'BLOB_CHUNK_TOO_LARGE',
        'blob 单块超出上限: ' + chunk.byteLength + ' > ' + limits.maxChunkBytes,
        {
          kind: kind,
          nodeId: nodeId,
          chunkIndex: i,
          chunkBytes: chunk.byteLength,
          maxChunkBytes: limits.maxChunkBytes,
        }
      );
    }

    var chunkResponse = await fetch(blobUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Chunk-Index': String(i),
        'X-Chunk-Total': String(totalChunks),
        'X-Chunk-JobId': jobId,
      },
      body: chunk,
    });
    var chunkResult = await chunkResponse.json();
    if (!chunkResponse.ok || !chunkResult.ok) {
      throw new Error(chunkResult && chunkResult.error ? chunkResult.error : 'Bridge blob 分块回传失败 chunk=' + i);
    }
  }

  if (reportStage) {
    reportStage.ok('blob.transport.done', 'SVG side-channel 上传完成', {
      kind: kind,
      nodeId: nodeId,
      byteLength: byteLength,
      chunked: true,
      totalChunks: totalChunks,
    });
  }

  return {
    transfer: 'side-channel',
    kind: kind,
    nodeId: nodeId,
    ext: ext,
    blobId: kind + ':' + (nodeId || 'unknown'),
    byteLength: byteLength,
  };
}
