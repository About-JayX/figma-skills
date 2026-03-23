async function resolveImageAssets(imageResources, options, reportStage) {
  const assets = {};
  const imageRecords = Array.isArray(imageResources)
    ? imageResources
        .map((item) => {
          if (!item || !item.imageHash) {
            return null;
          }

          return {
            imageHash: item.imageHash,
            count: typeof item.count === 'number' ? item.count : 0,
            imageRef: typeof item.imageRef === 'string' ? item.imageRef : null,
            gifRef: typeof item.gifRef === 'string' ? item.gifRef : null,
          };
        })
        .filter(Boolean)
    : [];
  const diagnostics = {
    requested: imageRecords.length,
    resolved: 0,
    errors: 0,
    transferMode: 'deferred-binary',
  };

  if (reportStage) {
    reportStage.loading('extract.images.start', '图片资源元数据处理中', {
      hashes: imageRecords.length,
      transferMode: diagnostics.transferMode,
    });
  }

  if (imageRecords.length === 0 || typeof figma.getImageByHash !== 'function') {
    if (reportStage) {
      reportStage.ok('extract.images.done', '图片资源元数据处理完成', diagnostics);
    }
    return {
      assets: assets,
      diagnostics: diagnostics,
    };
  }

  const limit = createLimiter(options.imageConcurrency);
  await Promise.all(
    imageRecords.map((record) =>
      limit(async () => {
        try {
          const image = figma.getImageByHash(record.imageHash);
          if (!image) {
            return;
          }

          const asset = {
            imageHash: record.imageHash,
            count: record.count,
            imageRef: record.imageRef,
            gifRef: record.gifRef,
            deferredBinary: true,
          };
          const inferredFormat = normalizeImageReferenceFormat(record);
          if (inferredFormat.format) {
            asset.format = inferredFormat.format;
            asset.mimeType = inferredFormat.mimeType;
          }

          if (typeof image.getSizeAsync === 'function') {
            const size = await withTimeout(
              image.getSizeAsync(),
              options.imageTimeoutMs,
              'Image.getSizeAsync'
            );
            if (size && typeof size.width === 'number' && typeof size.height === 'number') {
              asset.width = size.width;
              asset.height = size.height;
            }
          }

          assets[record.imageHash] = asset;
          diagnostics.resolved += 1;
        } catch (error) {
          diagnostics.errors += 1;
        }
      })
    )
  );

  if (reportStage) {
    reportStage.ok('extract.images.done', '图片资源元数据处理完成', diagnostics);
  }

  return {
    assets: assets,
    diagnostics: diagnostics,
  };
}

async function extractImageAssetByHash(imageHash, options, reportStage) {
  const mergedOptions = Object.assign({}, DEFAULT_EXTRACTION_OPTIONS, options || {});
  if (!imageHash || typeof figma.getImageByHash !== 'function') {
    throw createPluginError('INVALID_IMAGE_HASH', '缺少合法的 imageHash');
  }

  if (reportStage) {
    reportStage.loading('asset.lookup.start', '定位图片资产中', {
      imageHash: imageHash,
    });
  }

  const image = figma.getImageByHash(imageHash);
  if (!image) {
    throw createPluginError('IMAGE_NOT_FOUND', '未找到 imageHash ' + imageHash);
  }

  const asset = {
    imageHash: imageHash,
    width: null,
    height: null,
    byteLength: null,
    format: null,
    mimeType: null,
    bytes: null,
  };

  if (typeof image.getSizeAsync === 'function') {
    try {
      const size = await withTimeout(
        image.getSizeAsync(),
        mergedOptions.imageTimeoutMs,
        'Image.getSizeAsync'
      );
      if (size && typeof size.width === 'number' && typeof size.height === 'number') {
        asset.width = size.width;
        asset.height = size.height;
      }
    } catch (error) {
      // keep best effort metadata-only behavior for dimensions
    }
  }

  if (reportStage) {
    reportStage.ok('asset.lookup.done', '图片资产定位完成', {
      imageHash: imageHash,
      width: asset.width,
      height: asset.height,
    });
    reportStage.loading('asset.bytes.start', '图片二进制读取中', {
      imageHash: imageHash,
    });
  }

  const bytes = await withTimeout(
    image.getBytesAsync(),
    mergedOptions.imageBytesTimeoutMs,
    'Image.getBytesAsync'
  );
  if (!bytes || typeof bytes.length !== 'number' || bytes.length === 0) {
    throw createPluginError('IMAGE_BYTES_EMPTY', '图片字节为空: ' + imageHash);
  }

  if (bytes.length > mergedOptions.assetMaxBytes) {
    throw createPluginError(
      'IMAGE_TOO_LARGE',
      '图片字节超出上限: ' + bytes.length + ' > ' + mergedOptions.assetMaxBytes,
      {
        imageHash: imageHash,
        byteLength: bytes.length,
        assetMaxBytes: mergedOptions.assetMaxBytes,
      }
    );
  }

  const format = detectImageAssetFormat(bytes);
  asset.bytes = bytes;
  asset.byteLength = bytes.length;
  asset.format = format.format;
  asset.mimeType = format.mimeType;

  if (reportStage) {
    reportStage.ok('asset.bytes.done', '图片二进制读取完成', {
      imageHash: imageHash,
      byteLength: asset.byteLength,
      format: asset.format,
    });
  }

  return asset;
}
