import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniffImageFormat, formatToExtension, formatToMime } from './image_format.mjs';

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]);
const JPG_HEAD = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
const JPG_RAW  = Buffer.from([0xFF, 0xD8, 0xFF, 0xDB, 0x00, 0x84]);
const GIF87A   = Buffer.from('GIF87a', 'utf8');
const GIF89A   = Buffer.from('GIF89a', 'utf8');
const WEBP     = Buffer.concat([Buffer.from('RIFF', 'utf8'), Buffer.from([0,0,0,0]), Buffer.from('WEBP', 'utf8')]);
const AVIF     = Buffer.concat([Buffer.from([0,0,0,0]), Buffer.from('ftypavif', 'utf8')]);
const AVIS     = Buffer.concat([Buffer.from([0,0,0,0]), Buffer.from('ftypavis', 'utf8')]);
const SVG_XML  = Buffer.from('<?xml version="1.0"?><svg xmlns="...">', 'utf8');
const SVG_RAW  = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');

test('sniffImageFormat: PNG', () => {
  assert.equal(sniffImageFormat(PNG_HEAD), 'png');
});

test('sniffImageFormat: JPEG (JFIF + raw)', () => {
  assert.equal(sniffImageFormat(JPG_HEAD), 'jpg');
  assert.equal(sniffImageFormat(JPG_RAW), 'jpg');
});

test('sniffImageFormat: GIF87a + GIF89a', () => {
  assert.equal(sniffImageFormat(GIF87A), 'gif');
  assert.equal(sniffImageFormat(GIF89A), 'gif');
});

test('sniffImageFormat: WebP', () => {
  assert.equal(sniffImageFormat(WEBP), 'webp');
});

test('sniffImageFormat: AVIF (avif + avis brands)', () => {
  assert.equal(sniffImageFormat(AVIF), 'avif');
  assert.equal(sniffImageFormat(AVIS), 'avif');
});

test('sniffImageFormat: SVG (xml decl + raw)', () => {
  assert.equal(sniffImageFormat(SVG_XML), 'svg');
  assert.equal(sniffImageFormat(SVG_RAW), 'svg');
});

test('sniffImageFormat: unknown bytes → bin', () => {
  assert.equal(sniffImageFormat(Buffer.from([0x00, 0x01, 0x02, 0x03])), 'bin');
});

test('sniffImageFormat: empty / too-short buffer → bin', () => {
  assert.equal(sniffImageFormat(Buffer.alloc(0)), 'bin');
  assert.equal(sniffImageFormat(Buffer.from([0x89])), 'bin');
});

test('sniffImageFormat: works with Uint8Array (not just Buffer)', () => {
  const u8 = new Uint8Array(PNG_HEAD);
  assert.equal(sniffImageFormat(u8), 'png');
});

test('formatToExtension: jpeg → jpg', () => {
  assert.equal(formatToExtension('JPEG'), 'jpg');
  assert.equal(formatToExtension('jpeg'), 'jpg');
  assert.equal(formatToExtension('PNG'), 'png');
  assert.equal(formatToExtension(undefined), 'bin');
});

test('formatToMime: round-trip', () => {
  assert.equal(formatToMime('png'), 'image/png');
  assert.equal(formatToMime('jpg'), 'image/jpeg');
  assert.equal(formatToMime('svg'), 'image/svg+xml');
  assert.equal(formatToMime('unknown'), 'application/octet-stream');
});
