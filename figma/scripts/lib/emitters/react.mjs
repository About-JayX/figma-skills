// React emitter for the skeleton generator.
//
// Plugs into render_node.renderNode by providing:
//   - tag: the jsxReact tagged template (re-exported from skeleton_template)
//   - cssStringToTarget(s): parse "padding: 12px; gap: 7.246px" → {padding:"12px", gap:"7.246px"}
//                           with kebab→camel for prop names. Url(...) commas are protected.
//   - styleAttr(obj): emit ` style={{...}}` JSX attribute
//   - dataAttrs({figId, figName}): emit ` data-fig-id="..." data-fig-name="..."`
//   - svgRefAttr(svgRef): emit `<img src="..." alt="" />` for large blob refs

import { raw, jsxReact } from '../skeleton_template.mjs';

// Split CSS declarations on `;` while respecting nested parens (url() can
// contain `;` only inside data URIs but we still play it safe with paren depth).
function splitDeclarations(s) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth = Math.max(0, depth - 1);
    if (c === ';' && depth === 0) {
      if (buf.trim().length > 0) out.push(buf.trim());
      buf = '';
    } else {
      buf += c;
    }
  }
  if (buf.trim().length > 0) out.push(buf.trim());
  return out;
}

function kebabToCamel(s) {
  // CSS custom properties (--foo) stay as-is (React supports them via key).
  if (s.startsWith('--')) return s;
  // Vendor prefixes: -webkit-foo-bar → WebkitFooBar (capital W + camel rest).
  // -ms-foo → msFoo (Microsoft is the historical exception per React docs).
  if (s.startsWith('-webkit-')) return 'Webkit' + capitalizeFirst(camelize(s.slice(8)));
  if (s.startsWith('-moz-'))    return 'Moz'    + capitalizeFirst(camelize(s.slice(5)));
  if (s.startsWith('-ms-'))     return 'ms'     + capitalizeFirst(camelize(s.slice(4)));
  if (s.startsWith('-o-'))      return 'O'      + capitalizeFirst(camelize(s.slice(3)));
  return camelize(s);
}

function camelize(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function capitalizeFirst(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function cssStringToObject(s) {
  if (!s || typeof s !== 'string') return {};
  const out = {};
  for (const decl of splitDeclarations(s)) {
    const colonIdx = decl.indexOf(':');
    if (colonIdx <= 0) continue;
    const prop = decl.slice(0, colonIdx).trim();
    const value = decl.slice(colonIdx + 1).trim();
    if (!prop || !value) continue;
    out[kebabToCamel(prop)] = value;
  }
  return out;
}

// Format a JS object literal for inline JSX consumption. Always uses
// double-quoted strings on values; keys with special chars (like custom
// properties --foo) get quoted.
function formatObjectLiteral(obj) {
  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}';
  const parts = keys.map((k) => {
    const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
    const value = obj[k];
    return `${safeKey}: ${JSON.stringify(value)}`;
  });
  return `{ ${parts.join(', ')} }`;
}

function escAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export const reactEmitter = {
  tag: jsxReact,

  cssStringToTarget(cssString) {
    return cssStringToObject(cssString);
  },

  styleAttr(targetStyle) {
    if (!targetStyle || Object.keys(targetStyle).length === 0) return raw('');
    return raw(` style={${formatObjectLiteral(targetStyle)}}`);
  },

  dataAttrs({ figId, figName }) {
    let out = '';
    if (figId) out += ` data-fig-id="${escAttr(figId)}"`;
    if (figName) out += ` data-fig-name="${escAttr(figName)}"`;
    return raw(out);
  },

  svgRefAttr(svgRef) {
    if (!svgRef) return raw('');
    const src = svgRef.relativePath || svgRef.localPath || '';
    return raw(`<img src="${escAttr(src)}" alt="" />`);
  },
};

export const __test = { cssStringToObject, kebabToCamel, formatObjectLiteral };
