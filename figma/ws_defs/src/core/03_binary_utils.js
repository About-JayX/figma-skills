function matchesByteSignature(bytes, signature, offset) {
  const start = offset || 0;
  if (!bytes || start < 0 || start + signature.length > bytes.length) {
    return false;
  }

  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[start + i] !== signature[i]) {
      return false;
    }
  }

  return true;
}

function detectImageAssetFormat(bytes) {
  if (matchesByteSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)) {
    return {
      format: 'png',
      mimeType: 'image/png',
    };
  }

  if (matchesByteSignature(bytes, [0xff, 0xd8, 0xff], 0)) {
    return {
      format: 'jpg',
      mimeType: 'image/jpeg',
    };
  }

  if (matchesByteSignature(bytes, [0x47, 0x49, 0x46, 0x38], 0)) {
    return {
      format: 'gif',
      mimeType: 'image/gif',
    };
  }

  if (
    matchesByteSignature(bytes, [0x52, 0x49, 0x46, 0x46], 0) &&
    matchesByteSignature(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return {
      format: 'webp',
      mimeType: 'image/webp',
    };
  }

  if (
    matchesByteSignature(bytes, [0x66, 0x74, 0x79, 0x70], 4) &&
    (matchesByteSignature(bytes, [0x61, 0x76, 0x69, 0x66], 8) ||
      matchesByteSignature(bytes, [0x61, 0x76, 0x69, 0x73], 8))
  ) {
    return {
      format: 'avif',
      mimeType: 'image/avif',
    };
  }

  return {
    format: 'bin',
    mimeType: 'application/octet-stream',
  };
}

function normalizeImageReferenceFormat(record) {
  if (!record || typeof record !== 'object') {
    return {
      format: null,
      mimeType: null,
    };
  }

  if (record.gifRef) {
    return {
      format: 'gif',
      mimeType: 'image/gif',
    };
  }

  return {
    format: null,
    mimeType: null,
  };
}


function encodeBytesToBase64(bytes) {
  if (!bytes || bytes.length === 0) {
    return '';
  }

  let output = '';
  let index = 0;

  while (index < bytes.length) {
    const a = bytes[index++];
    const hasB = index < bytes.length;
    const b = hasB ? bytes[index++] : 0;
    const hasC = index < bytes.length;
    const c = hasC ? bytes[index++] : 0;
    const chunk = (a << 16) | (b << 8) | c;

    output += BASE64_ALPHABET[(chunk >> 18) & 63];
    output += BASE64_ALPHABET[(chunk >> 12) & 63];
    output += hasB ? BASE64_ALPHABET[(chunk >> 6) & 63] : '=';
    output += hasC ? BASE64_ALPHABET[chunk & 63] : '=';
  }

  return output;
}
