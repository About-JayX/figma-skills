// Detect image format by reading the file's magic bytes.
// Independent of any Figma metadata — purely byte-driven.
//
// Returns 'png' | 'jpg' | 'gif' | 'webp' | 'avif' | 'svg' | 'bin'.
//
// References:
//   PNG  — RFC 2083 (89 50 4E 47 0D 0A 1A 0A)
//   JPEG — JFIF/Exif (FF D8 FF)
//   GIF  — GIF87a / GIF89a (47 49 46 38 37/39 61)
//   WebP — RIFF container + WEBP fourcc at byte 8
//   AVIF — ISOBMFF ftyp box with avif/avis brand at byte 4
//   SVG  — text-based, leading <?xml or <svg

export function sniffImageFormat(buffer) {
  if (!buffer || buffer.length < 4) return 'bin';
  // Normalize to Uint8Array view (works with Buffer or Uint8Array)
  const b = buffer.length !== undefined && buffer.subarray ? buffer : Buffer.from(buffer);

  // PNG
  if (b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
      b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) {
    return 'png';
  }
  // JPEG (any variant — JFIF/Exif/raw)
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) {
    return 'jpg';
  }
  // GIF87a / GIF89a
  if (b.length >= 6 &&
      b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
      (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) {
    return 'gif';
  }
  // WebP: "RIFF" .... "WEBP"
  if (b.length >= 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return 'webp';
  }
  // AVIF: ISOBMFF, "ftyp" at byte 4, "avif" or "avis" brand at byte 8
  if (b.length >= 12 &&
      b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 &&
      b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && (b[11] === 0x66 || b[11] === 0x73)) {
    return 'avif';
  }
  // SVG (text). Trim BOM and leading whitespace, then look for <?xml or <svg.
  // Only check first 200 bytes — SVG declarations are early.
  const head = b.subarray(0, Math.min(b.length, 200)).toString('utf8').trimStart();
  if (head.startsWith('<?xml') || head.startsWith('<svg')) {
    return 'svg';
  }
  return 'bin';
}

// Convenience: format → CSS-friendly extension. Always returns a sensible default.
export function formatToExtension(format) {
  if (typeof format !== 'string') return 'bin';
  const f = format.toLowerCase();
  if (f === 'jpeg') return 'jpg';
  return f;
}

// Convenience: derived MIME type for HTML/CSS contexts.
export function formatToMime(format) {
  switch (format) {
    case 'png':  return 'image/png';
    case 'jpg':  return 'image/jpeg';
    case 'gif':  return 'image/gif';
    case 'webp': return 'image/webp';
    case 'avif': return 'image/avif';
    case 'svg':  return 'image/svg+xml';
    default:     return 'application/octet-stream';
  }
}
