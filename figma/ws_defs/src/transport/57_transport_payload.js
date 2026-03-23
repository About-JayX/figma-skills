function trimPayloadForTransport(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  var trimmed = Object.assign({}, payload);

  if (trimmed.restSnapshot && typeof trimmed.restSnapshot === 'object' && !trimmed.restSnapshot.truncated) {
    var restBytes = estimateJsonBytes(trimmed.restSnapshot);
    if (restBytes !== null && restBytes > 3000000) {
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
    var imageAssets = trimmed.designSnapshot.resources.imageAssets;
    for (var hash in imageAssets) {
      var asset = imageAssets[hash];
      if (asset && asset.bytesBase64 && typeof asset.bytesBase64 === 'string') {
        delete asset.bytesBase64;
        asset.deferredBinary = true;
      }
    }
  }

  return trimmed;
}

var CHUNK_SIZE = 512 * 1024;

async function postJobResult(jobId, payload, reportStage) {
  if (reportStage) {
    reportStage.loading('transport.serialize.start', '结果序列化中', null);
  }

  var transportPayload = trimPayloadForTransport(payload);
  var body = JSON.stringify(transportPayload);
  var payloadBytes = body.length;

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
    reportStage.loading('transport.post.start', '结果回传 bridge 中', {
      payloadBytes: payloadBytes,
    });
  }

  var resultUrl = BRIDGE_BASE_URL + '/jobs/' + encodeURIComponent(jobId) + '/result';

  if (payloadBytes <= CHUNK_SIZE) {
    var response = await fetch(resultUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
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

  var totalChunks = Math.ceil(payloadBytes / CHUNK_SIZE);
  if (reportStage) {
    reportStage.loading('transport.chunked.start', '分块回传中', {
      totalChunks: totalChunks,
      chunkSize: CHUNK_SIZE,
      payloadBytes: payloadBytes,
    });
  }

  for (var i = 0; i < totalChunks; i += 1) {
    var chunk = body.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
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
