// Map Figma boundVariables (on scene nodes) to CSS variable references.
//
// Input shape comes from plugin serialization:
//   node.variables.bound = {
//     fills:       [{ id, name, key, type, collectionId, remote }],
//     fontSize:    [{ ... }],
//     ...other Figma binding properties
//   }
//
// Output per node:
//   node.computedCss.tokens = {
//     [cssProperty]: { cssVar, figmaProp, variable: {name, id, type} }
//   }
//
// Global output at cache root:
//   variables-substitution-map.json = {
//     [figmaVarName]: { cssVar, type, collectionName, values: {[modeName]: resolvedValue} }
//   }

// CSS custom properties allow most Unicode (including CJK). We preserve CJK
// as-is so var(--色值-950) round-trips legibly; only ASCII letters get
// lowercased, and runs of punctuation/whitespace collapse to a single dash.
export function figmaNameToCssVar(name) {
  if (typeof name !== 'string' || name.length === 0) return null;
  const slug = name
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? `--${slug}` : null;
}

const FIGMA_PROP_TO_CSS = {
  fills: 'color',
  strokes: 'border-color',
  fontSize: 'font-size',
  lineHeight: 'line-height',
  letterSpacing: 'letter-spacing',
  fontWeight: 'font-weight',
  fontName: 'font-family',
  opacity: 'opacity',
  itemSpacing: 'gap',
  counterAxisSpacing: 'row-gap',
  paddingTop: 'padding-top',
  paddingRight: 'padding-right',
  paddingBottom: 'padding-bottom',
  paddingLeft: 'padding-left',
  topLeftRadius: 'border-top-left-radius',
  topRightRadius: 'border-top-right-radius',
  bottomLeftRadius: 'border-bottom-left-radius',
  bottomRightRadius: 'border-bottom-right-radius',
  strokeWeight: 'border-width',
  strokeTopWeight: 'border-top-width',
  strokeRightWeight: 'border-right-width',
  strokeBottomWeight: 'border-bottom-width',
  strokeLeftWeight: 'border-left-width',
  width: 'width',
  height: 'height',
  minWidth: 'min-width',
  minHeight: 'min-height',
  maxWidth: 'max-width',
  maxHeight: 'max-height',
  paragraphSpacing: 'margin-bottom',
  paragraphIndent: 'text-indent',
};

function firstBinding(value) {
  if (Array.isArray(value)) return value[0] || null;
  if (value && typeof value === 'object') return value;
  return null;
}

export function buildNodeTokens(boundTree) {
  if (!boundTree || typeof boundTree !== 'object') return null;
  const tokens = {};

  for (const figmaProp of Object.keys(boundTree)) {
    const ref = firstBinding(boundTree[figmaProp]);
    if (!ref || typeof ref.name !== 'string') continue;
    const cssProp = FIGMA_PROP_TO_CSS[figmaProp] || figmaProp;
    const cssVar = figmaNameToCssVar(ref.name);
    if (!cssVar) continue;
    tokens[cssProp] = {
      cssVar,
      figmaProp,
      variable: {
        name: ref.name,
        id: ref.id || null,
        type: ref.type || null,
      },
    };
  }

  return Object.keys(tokens).length > 0 ? tokens : null;
}

export function buildSubstitutionMap(defsFull) {
  if (!defsFull || typeof defsFull !== 'object') return {};
  const map = {};
  for (const collectionName of Object.keys(defsFull)) {
    const entry = defsFull[collectionName];
    if (!entry || !entry.variables) continue;
    for (const varName of Object.keys(entry.variables)) {
      const variable = entry.variables[varName];
      const cssVar = figmaNameToCssVar(varName);
      if (!cssVar) continue;
      map[varName] = {
        cssVar,
        type: variable.type || null,
        collectionName,
        collectionId: entry.collectionId || null,
        defaultModeId: entry.defaultModeId || null,
        values: variable.values || {},
      };
    }
  }
  return map;
}

export function enrichNodeTokens(root) {
  if (!root) return 0;
  let count = 0;

  function walk(node) {
    const bound = node?.variables?.bound;
    if (bound && typeof bound === 'object' && Object.keys(bound).length > 0) {
      const tokens = buildNodeTokens(bound);
      if (tokens) {
        node.computedCss = node.computedCss || {};
        node.computedCss.tokens = tokens;
        count += 1;
      }
    }
    for (const child of node.children || []) walk(child);
  }

  walk(root);
  return count;
}
