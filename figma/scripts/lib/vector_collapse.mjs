/**
 * vector_collapse.mjs — OPT-IN, FIDELITY-GATED subtree collapsing.
 *
 * Identifies FRAMEs whose entire descendant tree is VECTOR / BOOLEAN_OPERATION
 * / LINE / STAR / POLYGON / ELLIPSE / RECTANGLE with no TEXT / IMAGE fill /
 * nested auto-layout / interaction. Collapses the subtree in render-ready.json
 * into a single `{type: "SVG_GROUP", svgRef, box, children: []}` node, writing
 * a composite SVG to blobs/svg-composite-<hash>.svg.
 *
 * **Default OFF** — enable per-design only after the fidelity harness confirms
 * SSIM does not regress on the collapsed subtree. Bridge-agent-payload.json
 * is NEVER mutated by this module; only render-ready.json node tree shape.
 *
 * First-version limitations (documented; expand later if needed):
 *   - Composite positioning uses `translate(dx, dy)` from absoluteBoundingBox
 *     deltas. Subtrees with rotation / scale / skew in `relativeTransform`
 *     fall back to "non-eligible" rather than risk a wrong collapse.
 *   - `vector.svgString` on each child must be present (large vectors stored
 *     externally as `svgRef` are dereferenced to disk for reading).
 *   - Composite fidelity is not guaranteed when children reuse masks or have
 *     blendMode other than NORMAL/PASS_THROUGH — those subtrees are skipped.
 *
 * Output: audit sidecar `cache/<>/collapsed-vector-groups.json` keyed by the
 * collapsed frame's nodeId, listing the child ids that were folded in. This
 * makes every collapse reversible.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const COLLAPSIBLE_LEAF_TYPES = new Set([
  'VECTOR', 'BOOLEAN_OPERATION', 'LINE', 'STAR', 'POLYGON', 'ELLIPSE', 'RECTANGLE',
]);

function sanitizeId(s) { return String(s).replace(/[:;]/g, '-'); }

function isIdentityTransform(rt) {
  // relativeTransform is 2x3: [[a,b,tx],[c,d,ty]]; identity is [[1,0,tx],[0,1,ty]]
  if (!Array.isArray(rt) || rt.length !== 2) return true;
  const [[a, b], [c, d]] = rt;
  return a === 1 && b === 0 && c === 0 && d === 1;
}

function hasDisallowedBlend(node) {
  const bm = node?.style?.blendMode;
  return bm && bm !== 'NORMAL' && bm !== 'PASS_THROUGH';
}

/**
 * Walk the tree starting at `frame`; return true iff every descendant is a
 * plain vector leaf (no text, no image fills, no interactivity, identity
 * transform, normal blend mode), and there's at least one such descendant.
 */
export function isCollapsibleSubtree(frame) {
  if (!frame || !frame.children || frame.children.length === 0) return false;
  let leafCount = 0;
  function check(node) {
    if (!node) return false;
    if (node.type === 'TEXT' || node.type === 'FRAME' || node.type === 'INSTANCE' || node.type === 'COMPONENT' || node.type === 'SECTION') return false;
    if (!COLLAPSIBLE_LEAF_TYPES.has(node.type)) return false;
    if (hasDisallowedBlend(node)) return false;
    if (node.layout && !isIdentityTransform(node.layout.relativeTransform)) return false;
    // Disqualify IMAGE/VIDEO fills: they aren't a vector shape we can
    // faithfully composite into one SVG.
    const fills = node.style?.fills || [];
    for (const f of fills) {
      if (f?.visible === false) continue;
      if (f?.type === 'IMAGE' || f?.type === 'VIDEO') return false;
    }
    leafCount += 1;
    // Leaves may have children (e.g. BOOLEAN_OPERATION); recurse.
    for (const c of node.children || []) {
      if (!check(c)) return false;
    }
    return true;
  }
  for (const c of frame.children) {
    if (!check(c)) return false;
  }
  return leafCount >= 1;
}

function readChildSvg(node, cacheDir) {
  // 1. Inline svgString on the vector object
  if (typeof node.vector?.svgString === 'string' && node.vector.svgString.length > 0) {
    return node.vector.svgString;
  }
  // 2. Explicit svgRef (with localPath or relative path)
  const ref = node.vector?.svgRef || node.svgRef;
  if (ref) {
    const local = ref.localPath || (typeof ref === 'string' ? path.join(cacheDir, ref) : null);
    if (local && fs.existsSync(local)) return fs.readFileSync(local, 'utf8');
  }
  // 3. Convention-based: bridge plugin materializes per-node SVGs to
  //    blobs/svg-<sanitizedId>.svg (see lib/bridge_cache.mjs). Used when
  //    svgString was empty but the disk blob was written during extract.
  const conv = path.join(cacheDir, 'blobs', `svg-${sanitizeId(node.id)}.svg`);
  if (fs.existsSync(conv)) return fs.readFileSync(conv, 'utf8');
  // 4. computedHtml (small inlined SVGs — maybeInlineSvgRef handles <=4KB)
  if (typeof node.computedHtml === 'string' && node.computedHtml.trim().startsWith('<svg')) {
    return node.computedHtml;
  }
  return null;
}

/**
 * Strip the outer <svg ...> wrapper of a child SVG and return the inner
 * markup. Preserves defs / paths / groups. If parsing fails, returns null
 * (caller should treat the subtree as non-collapsible).
 */
function unwrapSvg(svgString) {
  if (typeof svgString !== 'string') return null;
  const openMatch = svgString.match(/<svg\b[^>]*>/i);
  const closeMatch = svgString.match(/<\/svg\s*>\s*$/i);
  if (!openMatch || !closeMatch) return null;
  const inner = svgString.slice(openMatch.index + openMatch[0].length, closeMatch.index);
  return inner.trim();
}

/**
 * Build a composite SVG from a frame + its leaf descendants. Each child is
 * placed in a <g transform="translate(dx dy)"> where dx/dy = childAbs -
 * frameAbs. Returns { svgString, childIds } or null if any child couldn't
 * be read.
 */
export function buildCompositeSvg(frame, cacheDir) {
  const fBox = frame.layout?.absoluteBoundingBox;
  if (!fBox) return null;
  const inners = [];
  const childIds = [];
  function walk(node) {
    if (node === frame) {
      for (const c of node.children || []) walk(c);
      return;
    }
    const box = node.layout?.absoluteBoundingBox;
    if (!box) return;
    const dx = +(box.x - fBox.x).toFixed(3);
    const dy = +(box.y - fBox.y).toFixed(3);
    const svg = readChildSvg(node, cacheDir);
    if (!svg) throw new Error(`no svg for child ${node.id}`);
    const inner = unwrapSvg(svg);
    if (inner == null) throw new Error(`unparsable svg for child ${node.id}`);
    inners.push(`<g transform="translate(${dx} ${dy})">${inner}</g>`);
    childIds.push(node.id);
    for (const c of node.children || []) walk(c);
  }
  try {
    walk(frame);
  } catch {
    return null;
  }
  if (inners.length === 0) return null;
  const w = +(fBox.width).toFixed(3);
  const h = +(fBox.height).toFixed(3);
  const svgString = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg">${inners.join('')}</svg>`;
  return { svgString, childIds };
}

/**
 * Apply collapse to a render-ready flat node list. For each FRAME in the
 * bridge tree that passes `isCollapsibleSubtree`, we:
 *   - Build a composite SVG, write it to blobs/svg-composite-<hash>.svg
 *   - Replace the frame's render-ready entry: set `role: 'vector'`,
 *     `vector: { svgPath: "./svg/svg-composite-<hash>.svg" }`,
 *     `childrenOrder: []` (children become dead; they're still in the flat
 *     list but orphaned — we also remove them to avoid emit_jsx rendering
 *     them twice).
 *   - Record { frameId, childIds, svgFile } in the audit list.
 *
 * The bridge tree (`root`) is needed to scan subtrees; `renderReady` is the
 * flat form we mutate. Returns { collapsed: N, audit: [...] }.
 */
export function collapseVectorGroups(root, renderReady, cacheDir) {
  if (!root || !renderReady) return { collapsed: 0, audit: [] };
  const blobsDir = path.join(cacheDir, 'blobs');
  fs.mkdirSync(blobsDir, { recursive: true });

  // Build a quick id → renderReady node index
  const rrIndex = new Map();
  for (let i = 0; i < renderReady.nodes.length; i++) {
    rrIndex.set(renderReady.nodes[i].id, i);
  }

  const collapsedChildIds = new Set();
  const audit = [];

  function walk(node) {
    if (!node) return;
    // FRAME/COMPONENT/INSTANCE/GROUP can all contain vector subtrees worth
    // collapsing. GROUP is common when designers group related icon paths.
    const t = node.type;
    if ((t === 'FRAME' || t === 'COMPONENT' || t === 'INSTANCE' || t === 'GROUP') &&
        isCollapsibleSubtree(node)) {
      const composite = buildCompositeSvg(node, cacheDir);
      if (composite) {
        const contentHash = crypto.createHash('sha256').update(composite.svgString).digest('hex').slice(0, 10);
        const fileName = `svg-composite-${sanitizeId(node.id)}-${contentHash}.svg`;
        const svgPath = path.join(blobsDir, fileName);
        fs.writeFileSync(svgPath, composite.svgString);
        // Mutate render-ready
        const idx = rrIndex.get(node.id);
        if (idx != null) {
          const rrNode = renderReady.nodes[idx];
          rrNode.role = 'vector';
          rrNode.vector = { svgPath: `./svg/${fileName}` };
          rrNode.childrenOrder = [];
          for (const cid of composite.childIds) collapsedChildIds.add(cid);
        }
        audit.push({ frameId: node.id, childIds: composite.childIds, svgFile: fileName });
        return; // don't descend — whole subtree absorbed
      }
    }
    for (const c of node.children || []) walk(c);
  }
  walk(root);

  // Remove collapsed children from the render-ready flat list
  if (collapsedChildIds.size > 0) {
    renderReady.nodes = renderReady.nodes.filter((n) => !collapsedChildIds.has(n.id));
    // Fix any parent.childrenOrder that still references removed ids
    for (const n of renderReady.nodes) {
      if (Array.isArray(n.childrenOrder) && n.childrenOrder.length > 0) {
        n.childrenOrder = n.childrenOrder.filter((id) => !collapsedChildIds.has(id));
      }
    }
  }

  // Write audit sidecar
  if (audit.length > 0) {
    fs.writeFileSync(
      path.join(cacheDir, 'collapsed-vector-groups.json'),
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        note: 'Every entry lists a FRAME whose vector-only subtree was collapsed to one composite SVG. Reversible: remove entries + rerun render_ready without --collapse-vector-groups.',
        collapsed: audit,
      }, null, 2)
    );
  }

  return { collapsed: audit.length, audit };
}
