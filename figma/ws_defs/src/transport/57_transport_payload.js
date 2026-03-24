function getResultTransportLimits() {
  var runtime =
    typeof WS_DEFS_CONFIG === 'object' &&
    WS_DEFS_CONFIG &&
    WS_DEFS_CONFIG.resultTransport
      ? WS_DEFS_CONFIG.resultTransport
      : {};

  return {
    chunkSizeBytes: Number(runtime.chunkSizeBytes) || 512 * 1024,
    maxChunkBytes: Number(runtime.maxChunkBytes) || 512 * 1024,
    maxTotalBytes: Number(runtime.maxTotalBytes) || 50 * 1024 * 1024,
    maxChunkCount: Number(runtime.maxChunkCount) || 48,
  };
}

function trimPayloadForTransport(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  var trimmed = Object.assign({}, payload);

  if (trimmed.restSnapshot && typeof trimmed.restSnapshot === 'object' && !trimmed.restSnapshot.truncated) {
    var restBytes = estimateJsonBytes(trimmed.restSnapshot);
    var restLimit = DEFAULT_EXTRACTION_OPTIONS.restMaxBytes;
    if (restBytes !== null && restBytes > restLimit) {
      trimmed.restSnapshot = {
        truncated: true,
        bytes: restBytes,
        reason: 'TRANSPORT_TRIM',
        document: trimmed.restSnapshot.document && trimmed.restSnapshot.document.id
          ? trimmed.restSnapshot.document.id
          : null,
      };
    }
  }

  if (
    trimmed.designSnapshot &&
    trimmed.designSnapshot.resources &&
    trimmed.designSnapshot.resources.imageAssets
  ) {
    var originalImageAssets = trimmed.designSnapshot.resources.imageAssets;
    var clonedImageAssets = {};
    for (var hash in originalImageAssets) {
      var originalAsset = originalImageAssets[hash];
      var clonedAsset = originalAsset && typeof originalAsset === 'object'
        ? Object.assign({}, originalAsset)
        : originalAsset;

      if (clonedAsset && clonedAsset.bytesBase64 && typeof clonedAsset.bytesBase64 === 'string') {
        delete clonedAsset.bytesBase64;
        clonedAsset.deferredBinary = true;
      }

      clonedImageAssets[hash] = clonedAsset;
    }

    trimmed.designSnapshot = Object.assign({}, trimmed.designSnapshot, {
      resources: Object.assign({}, trimmed.designSnapshot.resources, {
        imageAssets: clonedImageAssets,
      }),
    });
  }

  return trimmed;
}

async function postJobResult(jobId, payload, reportStage) {
  if (reportStage) {
    reportStage.loading('transport.serialize.start', '结果序列化中', null);
  }

  var limits = getResultTransportLimits();
  var transportPayload = trimPayloadForTransport(payload);
  var encoded = encodeJsonUtf8Lazy(transportPayload);
  var payloadBytes = encoded.byteLength;

  if (reportStage) {
    reportStage.ok('transport.serialize.done', '结果序列化完成', {
      payloadBytes: payloadBytes,
      trimmed: transportPayload !== payload,
      defsTotal:
        payload &&
        payload.defs &&
        payload.defs.summary &&
        typeof payload.defs.summary.total === 'number'
          ? payload.defs.summary.total
          : null,
    });
  }

  if (payloadBytes > limits.maxTotalBytes) {
    var payloadBreakdown = buildPayloadSizeDiagnostics(transportPayload);
    throw createPluginError(
      'RESULT_PAYLOAD_TOO_LARGE',
      '结果字节超出上限: ' + payloadBytes + ' > ' + limits.maxTotalBytes,
      {
        payloadBytes: payloadBytes,
        maxTotalBytes: limits.maxTotalBytes,
        payloadBreakdown: payloadBreakdown,
      }
    );
  }

  if (reportStage) {
    reportStage.loading('transport.post.start', '结果回传 bridge 中', {
      payloadBytes: payloadBytes,
    });
  }

  var resultUrl = BRIDGE_BASE_URL + '/jobs/' + encodeURIComponent(jobId) + '/result';

  if (payloadBytes <= limits.chunkSizeBytes) {
    var response = await fetch(resultUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: encoded.json,
    });
    var result = await response.json();

    if (reportStage) {
      reportStage.ok('transport.post.done', 'bridge 已响应结果回传', {
        status: response.status,
        bridgeOk: !!(result && result.ok),
      });
    }

    if (!response.ok || !result.ok) {
      throw new Error(result && result.error ? result.error : 'Bridge 回传失败');
    }

    return result;
  }

  var totalChunks = Math.ceil(payloadBytes / limits.chunkSizeBytes);

  if (totalChunks > limits.maxChunkCount) {
    throw createPluginError(
      'RESULT_CHUNK_COUNT_EXCEEDED',
      '结果分块数超出上限: ' + totalChunks + ' > ' + limits.maxChunkCount,
      { totalChunks: totalChunks, maxChunkCount: limits.maxChunkCount }
    );
  }

  if (reportStage) {
    reportStage.loading('transport.chunked.start', '分块回传中', {
      totalChunks: totalChunks,
      chunkSizeBytes: limits.chunkSizeBytes,
      payloadBytes: payloadBytes,
    });
  }

  var bodyBytes = encoded.bytes;
  for (var i = 0; i < totalChunks; i += 1) {
    var start = i * limits.chunkSizeBytes;
    var end = Math.min(start + limits.chunkSizeBytes, bodyBytes.length);
    var chunk = bodyBytes.subarray(start, end);

    if (chunk.byteLength > limits.maxChunkBytes) {
      throw createPluginError(
        'RESULT_CHUNK_TOO_LARGE',
        '结果单块超出上限: ' + chunk.byteLength + ' > ' + limits.maxChunkBytes,
        { chunkIndex: i, chunkBytes: chunk.byteLength, maxChunkBytes: limits.maxChunkBytes }
      );
    }

    var chunkRes = await fetch(resultUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Chunk-Index': String(i),
        'X-Chunk-Total': String(totalChunks),
        'X-Chunk-JobId': jobId,
      },
      body: chunk,
    });
    var chunkResult = await chunkRes.json();
    if (!chunkRes.ok || !chunkResult.ok) {
      throw new Error(chunkResult && chunkResult.error ? chunkResult.error : 'Bridge 分块回传失败 chunk=' + i);
    }
  }

  if (reportStage) {
    reportStage.ok('transport.chunked.done', '分块回传完成', {
      totalChunks: totalChunks,
      payloadBytes: payloadBytes,
    });
  }

  return { ok: true, jobId: jobId, chunked: true, totalChunks: totalChunks };
}
