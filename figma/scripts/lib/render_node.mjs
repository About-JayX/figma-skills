// Pure recursive renderer: bridge node → target source.
//
// Framework-agnostic. The emitter argument plugs in target-specific behavior
// (React vs HTML vs Vue) for: tag function, style attribute syntax, data-*
// attributes, and svgRef rendering.
//
// Contract for emitter:
//   tag                        — tagged-template function from skeleton_template
//   cssStringToTarget(s)        — turn a CSS declarations string into target style
//   styleAttr(targetStyle)      — build a single attribute clause (e.g. ` style={{...}}`
//                                 for React, ` style="..."` for HTML). Returns raw.
//   dataAttrs({ figId, figName })
//                                — build data-fig-* attribute clause. Returns raw.
//   svgRefAttr(svgRef)          — build an <img src=...> or equivalent for large
//                                 referenced SVG blobs. Returns raw.
//
// All emitter outputs are raw() so renderNode can compose them via tag``...``.

import { raw } from './skeleton_template.mjs';

// Default tag mapping (semantic upgrades like h1/h2 are left to the consumer
// after generation — generator stays purely structural).
const TAG_BY_TYPE = {
  TEXT: 'span',
  FRAME: 'div',
  SECTION: 'section',
  GROUP: 'div',
  COMPONENT: 'div',
  COMPONENT_SET: 'div',
  INSTANCE: 'div',
  RECTANGLE: 'div',
  ELLIPSE: 'div',
  STAR: 'div',
  POLYGON: 'div',
  LINE: 'div',
  // VECTOR / BOOLEAN_OPERATION are handled specially below — when
  // computedHtml is an inline <svg>, the wrapper still uses div for
  // positioning while the svg lives inside.
  VECTOR: 'div',
  BOOLEAN_OPERATION: 'div',
};

export function tagForNode(node) {
  if (!node || !node.type) return 'div';
  return TAG_BY_TYPE[node.type] || 'div';
}

// Returns raw('') if the node should not render at all.
export function renderNode(node, emitter, ctx = {}) {
  if (!node) return raw('');
  if (node.visible === false) return raw('');
  if (node.style?.opacity === 0) return raw('');

  const tag = tagForNode(node);
  const styleObj = emitter.cssStringToTarget(node.computedCss?.full || '');
  const styleAttr = emitter.styleAttr(styleObj);
  const dataAttrs = emitter.dataAttrs({ figId: node.id, figName: node.name });

  // Children resolution — priority order chosen to avoid losing subtree info.
  // Container nodes (FRAME/INSTANCE/SECTION/GROUP) sometimes carry an
  // ancestor-export svgRef that contains all descendants flattened. If we
  // emitted that <img>, the entire subtree would collapse to one raster —
  // wrong. Always prefer recursing into children when present.
  let children;
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  if (node.computedHtml) {
    // Pre-rendered HTML/SVG string from pipeline (text segments, inline SVG
    // for small VECTOR / BOOLEAN_OPERATION nodes after L1.2).
    children = raw(node.computedHtml);
  } else if (hasChildren) {
    // Subtree — recurse. For NONE-layout parents, sort children by
    // absoluteBoundingBox.x/y so visual order matches Figma (otherwise
    // children[] is z-order, not visual).
    let kids = node.children;
    if (node.layout?.layoutMode === 'NONE') {
      kids = sortByVisualOrder(kids);
    }
    children = kids.map((c) => renderNode(c, emitter, ctx));
  } else if (node.svgRef) {
    // Leaf vector with large blob — emitter decides (e.g., <img src>).
    children = emitter.svgRefAttr(node.svgRef);
  } else {
    children = '';
  }

  return emitter.tag`<${raw(tag)}${dataAttrs}${styleAttr}>${children}</${raw(tag)}>`;
}

function sortByVisualOrder(children) {
  return [...children].sort((a, b) => {
    const ay = a.layout?.absoluteBoundingBox?.y ?? 0;
    const by = b.layout?.absoluteBoundingBox?.y ?? 0;
    if (Math.abs(ay - by) > 1) return ay - by;
    const ax = a.layout?.absoluteBoundingBox?.x ?? 0;
    const bx = b.layout?.absoluteBoundingBox?.x ?? 0;
    return ax - bx;
  });
}

// Walk the tree, return list of distinct font families used (for the generator
// to inject Google Fonts links / @font-face). Order preserves first-seen.
export function collectFontFamilies(root) {
  const seen = new Set();
  const order = [];
  function walk(node) {
    const fam = node?.text?.fontName?.family;
    if (typeof fam === 'string' && fam.length > 0 && !seen.has(fam)) {
      seen.add(fam);
      order.push(fam);
    }
    for (const seg of node?.text?.segments || []) {
      const sf = seg?.fontName?.family;
      if (typeof sf === 'string' && sf.length > 0 && !seen.has(sf)) {
        seen.add(sf);
        order.push(sf);
      }
    }
    for (const c of node?.children || []) walk(c);
  }
  walk(root);
  return order;
}

// Map Figma fontName.style ("Bold", "ExtraLight Italic", numeric "700") to
// { weight: number, italic: boolean }. Centralised so every emitter ships the
// same Google Fonts request — previously each call site shipped a different
// (often incomplete) weight list and unsupported families were silently
// dropped, which let the browser fall back to system fonts and tank SSIM.
const FIGMA_STYLE_TO_WEIGHT = {
  thin: 100, hairline: 100,
  extralight: 200, ultralight: 200,
  light: 300,
  regular: 400, normal: 400, book: 400,
  medium: 500,
  semibold: 600, demibold: 600,
  bold: 700,
  extrabold: 800, ultrabold: 800, heavy: 800,
  black: 900,
};

function parseFigmaStyle(style) {
  if (style == null) return { weight: 400, italic: false };
  const s = String(style).trim();
  if (!s) return { weight: 400, italic: false };
  const italic = /italic|oblique/i.test(s);
  const cleaned = s.replace(/italic|oblique/gi, '').replace(/\s+/g, '').toLowerCase();
  if (FIGMA_STYLE_TO_WEIGHT[cleaned]) return { weight: FIGMA_STYLE_TO_WEIGHT[cleaned], italic };
  const n = parseInt(cleaned, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 1000) return { weight: n, italic };
  return { weight: 400, italic };
}

// Walk the tree, return Map<family, { weights: Set<number>, italic: boolean }>.
// Pulls weight + italic from text.fontName.style AND each segment.fontName.style
// (numeric text.fontWeight is also accepted as a fallback). Used by every
// emitter that builds a Google Fonts URL so they all request the same
// (complete) set of axes.
export function collectFontFamilyWeights(root) {
  const map = new Map();
  function add(family, style, weight) {
    if (typeof family !== 'string' || family.length === 0) return;
    const parsed = parseFigmaStyle(style);
    const finalWeight = (typeof weight === 'number' && weight > 0) ? weight : parsed.weight;
    if (!map.has(family)) map.set(family, { weights: new Set(), italic: false });
    const entry = map.get(family);
    entry.weights.add(finalWeight);
    if (parsed.italic) entry.italic = true;
  }
  function walk(node) {
    const t = node?.text;
    if (t) {
      add(t.fontName?.family, t.fontName?.style, typeof t.fontWeight === 'number' ? t.fontWeight : null);
      for (const seg of t.segments || []) {
        add(seg.fontName?.family, seg.fontName?.style, typeof seg.fontWeight === 'number' ? seg.fontWeight : null);
      }
    }
    for (const c of node?.children || []) walk(c);
  }
  walk(root);
  return map;
}

// render-ready variant: emit_css consumes render-ready.json (flat node list,
// `text.fontFamily` + `text.fontWeight` as string/number, no fontName.style),
// not the bridge-payload tree. Italic isn't preserved at the render-ready
// stage, so this variant returns italic=false; codegen_pipeline's <link> still
// requests italic via the bridge-shape collector for accurate font metrics.
export function collectFontFamilyWeightsFromRenderReady(nodes) {
  const map = new Map();
  for (const n of nodes || []) {
    if (n?.role !== 'text' || !n.text) continue;
    const fam = n.text.fontFamily;
    if (typeof fam !== 'string' || !fam.length) continue;
    const parsed = parseFigmaStyle(n.text.fontWeight);
    if (!map.has(fam)) map.set(fam, { weights: new Set(), italic: false });
    map.get(fam).weights.add(parsed.weight);
  }
  return map;
}

// Families that Google Fonts does not host but that we know a public CDN for.
// Each entry declares the stylesheet URL and the font-family string that URL
// actually registers (may differ from the family Figma exported — e.g. Figma
// uses "MiSans VF" for the variable font, but jsdelivr's package registers
// "MiSans"). Both names stay in the CSS font stack (see emit_css.fontFamilyStack)
// so local installs and the CDN copy can both match.
//
// Verified URLs — confirm any additions by fetching and inspecting the
// @font-face block before shipping.
export const EXTERNAL_FONT_STYLESHEETS = {
  'MiSans VF': {
    href: 'https://cdn.jsdelivr.net/npm/misans-vf@1.0.0/lib/MiSans.min.css',
    actualFamily: 'MiSans',
  },
  'MiSans': {
    href: 'https://cdn.jsdelivr.net/npm/misans-vf@1.0.0/lib/MiSans.min.css',
    actualFamily: 'MiSans',
  },
};

// Partition a familyWeights map into (a) families Google Fonts can serve and
// (b) families that need an external stylesheet (lookup in
// EXTERNAL_FONT_STYLESHEETS). Families that match neither are kept on the
// Google side — the existing href builder will just encode a name Google might
// or might not serve; we emit the link regardless so the designer sees the
// fallback chain in devtools when the request 404s.
export function partitionFontsByHost(familyWeights) {
  const google = new Map();
  const externalHrefs = new Set();
  if (!familyWeights) return { google, externalHrefs };
  for (const [family, entry] of familyWeights.entries()) {
    const ext = EXTERNAL_FONT_STYLESHEETS[family];
    if (ext) {
      externalHrefs.add(ext.href);
    } else {
      google.set(family, entry);
    }
  }
  return { google, externalHrefs };
}

// Build a single Google Fonts CSS2 URL from collectFontFamilyWeights output.
// Returns '' when the map is empty so callers can branch cleanly.
// Format: family=<Name>:ital,wght@0,<w1>;0,<w2>;1,<w1>;1,<w2>&family=...&display=swap
export function buildGoogleFontsHref(familyWeights) {
  if (!familyWeights || familyWeights.size === 0) return '';
  const parts = [];
  for (const [family, { weights, italic }] of [...familyWeights.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sortedWeights = [...weights].sort((a, b) => a - b);
    const encoded = encodeURIComponent(family).replace(/%20/g, '+');
    if (italic) {
      const tuples = sortedWeights.flatMap((w) => [`0,${w}`, `1,${w}`]);
      parts.push(`family=${encoded}:ital,wght@${tuples.join(';')}`);
    } else {
      parts.push(`family=${encoded}:wght@${sortedWeights.join(';')}`);
    }
  }
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`;
}
