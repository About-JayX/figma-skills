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

export function writeJsonFileStreaming(file, data) {
  const json = JSON.stringify(data, null, 2);
  const fd = fs.openSync(file, 'w');

  try {
    const chunkSize = 4 * 1024 * 1024;
    for (let offset = 0; offset < json.length; offset += chunkSize) {
      fs.writeSync(fd, json.slice(offset, offset + chunkSize));
    }
  } finally {
    fs.closeSync(fd);
  }
}
