
const SVG_FALLBACK_PAINT_TYPES = {
  GRADIENT_RADIAL: true,
  GRADIENT_ANGULAR: true,
  GRADIENT_DIAMOND: true,
  PATTERN: true,
};

const DEFAULT_EXTRACTION_OPTIONS = {
  cssConcurrency: 6,
  cssTimeoutMs: 1200,
  // C5: SVG extraction was previously serialized (concurrency=1). exportAsync
  // is IO-bound inside the plugin sandbox and benefits from parallelism. Four
  // concurrent exports keep peak memory well under the 2 GB sandbox ceiling
  // for typical pages; raise further only after memory monitoring is in place.
  svgConcurrency: 4,
  svgTimeoutMs: 4000,
  imageConcurrency: 4,
  imageTimeoutMs: 2000,
  imageBytesTimeoutMs: 12000,
  assetMaxBytes: 32 * 1024 * 1024,
  assetMaxPixels: 3200 * 3200,
  includeInvisibleInstanceChildren: true,
  restTimeoutMs: 5000,
  restMaxBytes: 3000000,
  uploadSvgBlobs: true,
};

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
