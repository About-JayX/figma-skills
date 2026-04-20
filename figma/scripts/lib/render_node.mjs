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
