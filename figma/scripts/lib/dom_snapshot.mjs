/**
 * dom_snapshot.mjs — capture per-node rect + computedStyle from a live page.
 *
 * Keyed by the render-ready node IDs (sanitized for HTML `id=` attributes the
 * same way emit_jsx.mjs sanitizes them: `:` and `;` → `-`). Output is a flat
 * array consumers can join against the render-ready graph to compute design-vs-
 * rendered deltas for repair loops.
 */

export const COMPUTED_WHITELIST = [
  'display', 'position', 'top', 'right', 'bottom', 'left',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignSelf',
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'gap', 'rowGap', 'columnGap',
  'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
  'color', 'opacity', 'overflow', 'overflowX', 'overflowY',
  'borderRadius', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
  'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
  'textAlign', 'textTransform', 'textDecoration',
  'boxShadow', 'filter', 'transform', 'zIndex',
];

export function sanitizeDomId(rrId) {
  return String(rrId).replace(/[:;]/g, '-');
}

export function buildNodeIdPairs(rrNodes) {
  return rrNodes.map((n) => ({ rr: n.id, dom: sanitizeDomId(n.id) }));
}

/**
 * Run inside a Playwright page. Accepts a list of {rr, dom} id pairs.
 * Returns entries with shape documented in verify_loop.mjs.
 */
export async function captureDomSnapshot(page, nodeIdPairs, whitelist = COMPUTED_WHITELIST) {
  return page.evaluate(
    ({ pairs, allowed }) => {
      const results = [];
      for (const pair of pairs) {
        const el = document.getElementById(pair.dom);
        if (!el) {
          results.push({ id: pair.rr, domId: pair.dom, present: false });
          continue;
        }
        const rect = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);
        const computed = {};
        for (const key of allowed) computed[key] = cs[key];
        const leafText = el.children.length === 0 ? (el.textContent || '') : null;
        results.push({
          id: pair.rr,
          domId: pair.dom,
          present: true,
          tag: el.tagName.toLowerCase(),
          className: el.getAttribute('class') || '',
          rect: {
            x: +rect.x.toFixed(2),
            y: +rect.y.toFixed(2),
            w: +rect.width.toFixed(2),
            h: +rect.height.toFixed(2),
          },
          computed,
          text: leafText ? leafText.slice(0, 200) : null,
        });
      }
      return results;
    },
    { pairs: nodeIdPairs, allowed: whitelist }
  );
}
