
const SVG_FALLBACK_PAINT_TYPES = {
  GRADIENT_RADIAL: true,
  GRADIENT_ANGULAR: true,
  GRADIENT_DIAMOND: true,
  PATTERN: true,
};

const DEFAULT_EXTRACTION_OPTIONS = {
  cssConcurrency: 6,
  cssTimeoutMs: 1200,
  svgConcurrency: 1,
  svgTimeoutMs: 4000,
  imageConcurrency: 4,
  imageTimeoutMs: 2000,
  imageBytesTimeoutMs: 12000,
  assetMaxBytes: 32 * 1024 * 1024,
  assetMaxPixels: 3200 * 3200,
  includeInvisibleInstanceChildren: false,
  restTimeoutMs: 5000,
  restMaxBytes: 3000000,
};

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
