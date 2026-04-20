import { test } from 'node:test';
import assert from 'node:assert/strict';
import { raw, isRaw, interp, jsxReact, htmlRaw, vueSfc } from './skeleton_template.mjs';

test('raw + isRaw round trip', () => {
  const r = raw('<div/>');
  assert.equal(r.value, '<div/>');
  assert.equal(isRaw(r), true);
  assert.equal(isRaw('<div/>'), false);
  assert.equal(isRaw(null), false);
});

test('interp: null / undefined / false drop', () => {
  assert.equal(interp(null), '');
  assert.equal(interp(undefined), '');
  assert.equal(interp(false), '');
});

test('interp: escapes HTML-dangerous chars in strings', () => {
  assert.equal(interp('<script>"&\'>'), '&lt;script&gt;&quot;&amp;&#39;&gt;');
});

test('interp: arrays are joined and recursively escaped', () => {
  assert.equal(interp(['a', '<', 'b']), 'a&lt;b');
});

test('interp: raw values pass through verbatim', () => {
  assert.equal(interp(raw('<X />')), '<X />');
});

test('interp: numbers stringify directly', () => {
  assert.equal(interp(42), '42');
});

test('jsxReact: simple template', () => {
  const out = jsxReact`<div>${'hi'}</div>`;
  assert.equal(isRaw(out), true);
  assert.equal(out.value, '<div>hi</div>');
});

test('jsxReact: escapes user content', () => {
  const out = jsxReact`<p>${'<script>'}</p>`;
  assert.equal(out.value, '<p>&lt;script&gt;</p>');
});

test('jsxReact: nested raw not double-escaped', () => {
  const inner = jsxReact`<a/>`;
  const outer = jsxReact`<div>${inner}</div>`;
  assert.equal(outer.value, '<div><a/></div>');
});

test('jsxReact: array of raw values composes', () => {
  const items = [jsxReact`<li/>`, jsxReact`<li/>`];
  const out = jsxReact`<ul>${items}</ul>`;
  assert.equal(out.value, '<ul><li/><li/></ul>');
});

test('jsxReact: null/false interpolation drops cleanly', () => {
  const out = jsxReact`<x>${null}${false}${'ok'}</x>`;
  assert.equal(out.value, '<x>ok</x>');
});

test('htmlRaw vs jsxReact: same composition behavior', () => {
  const a = htmlRaw`<div>${'<x>'}</div>`;
  const b = jsxReact`<div>${'<x>'}</div>`;
  assert.equal(a.value, b.value);  // tag-agnostic for now; emitters differ at the node-render level
});

test('vueSfc: same composition behavior, returns raw', () => {
  const out = vueSfc`<template>${'<x>'}</template>`;
  assert.equal(out.value, '<template>&lt;x&gt;</template>');
});
