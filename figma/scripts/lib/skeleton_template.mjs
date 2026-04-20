// Tagged-template helpers for code generation.
//
// Generators (React / HTML / Vue / ...) compose target-language source by
// invoking these tag functions. The same renderNode traversal can target any
// of them by swapping the tag — the goal is "framework-agnostic walk +
// framework-specific emit".
//
// Concepts:
//   raw(s)       — wrap a string that is already framework source and must
//                  not be re-escaped on interpolation
//   isRaw(v)     — discriminator (used by interp + emitters)
//   interp(v)    — safely turn an interpolated value into emit-string. Escapes
//                  HTML-dangerous chars by default; arrays joined; null/false
//                  drop; raw values pass through verbatim
//   jsxReact     — tag function for JSX/React source
//   htmlRaw      — tag function for plain HTML source
//   vueSfc       — tag function for Vue SFC <template> source
//
// All three tag functions return raw(...) so output composes naturally:
//   const child = jsxReact`<a/>`;
//   const parent = jsxReact`<div>${child}</div>`;     // <div><a/></div>

const RAW = Symbol('raw');

export function raw(value) {
  return { [RAW]: true, value: typeof value === 'string' ? value : String(value) };
}

export function isRaw(value) {
  return Boolean(value && value[RAW] === true);
}

const HTML_ESCAPE_MAP = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, (c) => HTML_ESCAPE_MAP[c]);
}

export function interp(value) {
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return value.map(interp).join('');
  if (isRaw(value)) return value.value;
  if (value instanceof Error) return escapeHtml(value.message);
  return escapeHtml(value);
}

function makeTag(_label) {
  // Currently all targets use the same interp logic — they differ in how the
  // node renderer composes attributes (style as object vs string, class vs
  // className, etc). The tag itself just stitches strings + interpolations.
  return function tag(strings, ...values) {
    let out = '';
    for (let i = 0; i < strings.length; i += 1) {
      out += strings[i];
      if (i < values.length) out += interp(values[i]);
    }
    return raw(out);
  };
}

export const jsxReact = makeTag('jsxReact');
export const htmlRaw  = makeTag('htmlRaw');
export const vueSfc   = makeTag('vueSfc');

// Internal — exposed for tests to verify discriminator behavior.
export const __test = { RAW, escapeHtml };
