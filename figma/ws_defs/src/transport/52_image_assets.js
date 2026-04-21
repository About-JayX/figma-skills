function getImagePixelCount(width, height) {
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !isFinite(width) ||
    !isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return width * height;
}

function estimateRawImageBytes(pixelCount) {
  if (typeof pixelCount !== 'number' || !isFinite(pixelCount) || pixelCount <= 0) {
    return null;
  }
  return pixelCount * 4;
}

function assertImageWithinPreflightLimits(asset, options) {
  var assetMaxPixels = Number(options.assetMaxPixels) || 0;
  var pixelCount = getImagePixelCount(asset.width, asset.height);

  if (!assetMaxPixels || pixelCount == null || pixelCount <= assetMaxPixels) {
    return;
  }

  throw createPluginError(
    'IMAGE_TOO_LARGE_ESTIMATED',
    'Estimated image dimensions exceed the limit; skipping binary read',
    {
      imageHash: asset.imageHash,
      width: asset.width,
      height: asset.height,
      pixelCount: pixelCount,
      assetMaxPixels: assetMaxPixels,
      estimatedMaxBytes: estimateRawImageBytes(pixelCount),
      assetMaxBytes: options.assetMaxBytes,
    }
  );
}

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
    reportStage.loading('extract.images.start', 'Processing image asset metadata', {
      hashes: imageRecords.length,
      transferMode: diagnostics.transferMode,
    });
  }

  if (imageRecords.length === 0 || typeof figma.getImageByHash !== 'function') {
    if (reportStage) {
      reportStage.ok('extract.images.done', 'Image asset metadata processing complete', diagnostics);
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

          const pixelCount = getImagePixelCount(asset.width, asset.height);
          if (pixelCount != null) {
            asset.pixelCount = pixelCount;
            const assetMaxPixels = Number(options.assetMaxPixels) || 0;
            if (assetMaxPixels && pixelCount > assetMaxPixels) {
              asset.estimatedTooLarge = true;
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
    reportStage.ok('extract.images.done', 'Image asset metadata processing complete', diagnostics);
  }

  return {
    assets: assets,
    diagnostics: diagnostics,
  };
}

async function extractImageAssetByHash(imageHash, options, reportStage) {
  const mergedOptions = Object.assign({}, DEFAULT_EXTRACTION_OPTIONS, options || {});
  if (!imageHash || typeof figma.getImageByHash !== 'function') {
    throw createPluginError('INVALID_IMAGE_HASH', 'Missing a valid imageHash');
  }

  if (reportStage) {
    reportStage.loading('asset.lookup.start', 'Locating image asset', {
      imageHash: imageHash,
    });
  }

  const image = figma.getImageByHash(imageHash);
  if (!image) {
    throw createPluginError('IMAGE_NOT_FOUND', 'Could not find imageHash ' + imageHash);
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
    reportStage.ok('asset.lookup.done', 'Image asset located', {
      imageHash: imageHash,
      width: asset.width,
      height: asset.height,
    });
  }

  try {
    assertImageWithinPreflightLimits(asset, mergedOptions);
  } catch (preflightError) {
    if (reportStage) {
      reportStage.error(
        'asset.preflight.rejected',
        'Estimated image dimensions exceed the limit; skipping binary read',
        preflightError.details
      );
    }
    throw preflightError;
  }

  if (reportStage) {
    reportStage.loading('asset.bytes.start', 'Reading image binary bytes', {
      imageHash: imageHash,
    });
  }

  const bytes = await withTimeout(
    image.getBytesAsync(),
    mergedOptions.imageBytesTimeoutMs,
    'Image.getBytesAsync'
  );
  if (!bytes || typeof bytes.length !== 'number' || bytes.length === 0) {
    throw createPluginError('IMAGE_BYTES_EMPTY', 'Image bytes are empty: ' + imageHash);
  }

  if (mergedOptions.assetMaxBytes && bytes.length > mergedOptions.assetMaxBytes) {
    throw createPluginError(
      'IMAGE_TOO_LARGE',
      'Image bytes exceed the limit: ' + bytes.length + ' > ' + mergedOptions.assetMaxBytes,
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
    reportStage.ok('asset.bytes.done', 'Image binary read complete', {
      imageHash: imageHash,
      byteLength: asset.byteLength,
      format: asset.format,
    });
  }

  return asset;
}
