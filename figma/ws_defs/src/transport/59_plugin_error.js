function normalizePluginError(error) {
  if (error && error.code) {
    return {
      code: error.code,
      message: error.message,
      details: error.details || null,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'EXTRACTION_FAILED',
      message: error.message,
      details: {
        name: error.name,
        stack: error.stack || null,
      },
    };
  }

  if (error && typeof error === 'object') {
    let serialized = null;
    try {
      serialized = JSON.stringify(error, null, 2);
    } catch (serializationError) {
      serialized = null;
    }

    return {
      code: 'EXTRACTION_FAILED',
      message: serialized || '[object Object]',
      details: serialized ? { serialized } : null,
    };
  }

  return {
    code: 'EXTRACTION_FAILED',
    message: String(error),
    details: null,
  };
}

