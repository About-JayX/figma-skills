import fs from 'fs';

import { JSON_BODY_MAX_BYTES } from './bridge_config.mjs';

const ACCESS_CONTROL_ALLOW_HEADERS = [
  'Content-Type',
  'X-Chunk-Index',
  'X-Chunk-Total',
  'X-Chunk-JobId',
  'X-Figma-Image-Hash',
  'X-Figma-Image-Format',
  'X-Figma-Image-Mime',
  'X-Figma-Image-Width',
  'X-Figma-Image-Height',
  'X-Figma-Image-Byte-Length',
].join(',');

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson(url, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const result = await response.json();
    return { ok: response.ok, status: response.status, result };
  } finally {
    clearTimeout(timer);
  }
}

export async function readJsonBody(req, maxBytes = JSON_BODY_MAX_BYTES) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (maxBytes && total > maxBytes) {
      const error = new Error(`JSON body exceeds maxBytes=${maxBytes}`);
      error.code = 'JSON_BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) {
    return {};
  }

  return JSON.parse(text);
}

function normalizeBinaryBodyOptions(options) {
  if (typeof options === 'number') {
    return {
      maxBytes: options,
      errorCode: 'BINARY_BODY_TOO_LARGE',
      label: 'binary body',
    };
  }

  return {
    maxBytes: options && options.maxBytes ? options.maxBytes : 0,
    errorCode:
      options && typeof options.errorCode === 'string'
        ? options.errorCode
        : 'BINARY_BODY_TOO_LARGE',
    label:
      options && typeof options.label === 'string'
        ? options.label
        : 'binary body',
  };
}

export async function readBinaryBody(req, options) {
  const normalized = normalizeBinaryBodyOptions(options);
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (normalized.maxBytes && total > normalized.maxBytes) {
      const error = new Error(
        `${normalized.label} exceeds maxBytes=${normalized.maxBytes}`
      );
      error.code = normalized.errorCode;
      throw error;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

export function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', ACCESS_CONTROL_ALLOW_HEADERS);
}

export function writeJson(res, statusCode, body) {
  setCorsHeaders(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function writeSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function writeJsonFile(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function writeJsonLeaf(fd, value, indent) {
  const json = JSON.stringify(value, null, 2);
  // JSON.stringify returns undefined for undefined/functions/symbols — emit null
  if (json === undefined) {
    fs.writeSync(fd, 'null');
    return;
  }
  if (!json.includes('\n')) {
    fs.writeSync(fd, json);
    return;
  }
  const lines = json.split('\n');
  fs.writeSync(fd, lines[0] + '\n');
  for (let i = 1; i < lines.length; i++) {
    fs.writeSync(fd, indent + lines[i]);
    if (i < lines.length - 1) fs.writeSync(fd, '\n');
  }
}

function writeJsonValue(fd, value, indent, depth) {
  if (depth > 0 && value && typeof value === 'object') {
    if (Array.isArray(value)) {
      writeJsonArrayPerElement(fd, value, indent, depth - 1);
    } else {
      writeJsonObjectPerKey(fd, value, indent, depth - 1);
    }
  } else {
    writeJsonLeaf(fd, value, indent);
  }
}

function writeJsonArrayPerElement(fd, arr, indent, depth) {
  if (arr.length === 0) { fs.writeSync(fd, '[]'); return; }
  fs.writeSync(fd, '[\n');
  for (let i = 0; i < arr.length; i++) {
    fs.writeSync(fd, indent + '  ');
    writeJsonValue(fd, arr[i], indent + '  ', depth);
    if (i < arr.length - 1) fs.writeSync(fd, ',');
    fs.writeSync(fd, '\n');
  }
  fs.writeSync(fd, indent + ']');
}

function writeJsonObjectPerKey(fd, obj, indent, depth) {
  // Filter out undefined values to match JSON.stringify behavior
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  if (keys.length === 0) { fs.writeSync(fd, '{}'); return; }
  fs.writeSync(fd, '{\n');
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    fs.writeSync(fd, indent + '  ' + JSON.stringify(key) + ': ');
    writeJsonValue(fd, obj[key], indent + '  ', depth);
    if (i < keys.length - 1) fs.writeSync(fd, ',');
    fs.writeSync(fd, '\n');
  }
  fs.writeSync(fd, indent + '}');
}

// Maximum nesting depth for per-key streaming serialization.
// Level 0 = top-level keys; level 1 = sub-keys (e.g. designSnapshot.root);
// level 2 = sub-sub-keys (e.g. designSnapshot.root.children is an array → leaf).
const STREAMING_DEPTH = 2;

export function writeJsonFileStreaming(file, data) {
  // Serialize and write per-key at multiple nesting levels to avoid building
  // large sub-trees as single JSON strings in memory.
  const fd = fs.openSync(file, 'w');
  try {
    const keys = Object.keys(data);
    fs.writeSync(fd, '{\n');
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const val = data[key];
      fs.writeSync(fd, '  ' + JSON.stringify(key) + ': ');
      writeJsonValue(fd, val, '  ', STREAMING_DEPTH);
      if (i < keys.length - 1) fs.writeSync(fd, ',');
      fs.writeSync(fd, '\n');
    }
    fs.writeSync(fd, '}\n');
  } finally {
    fs.closeSync(fd);
  }
}
