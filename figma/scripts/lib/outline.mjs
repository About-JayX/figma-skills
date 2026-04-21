/**
 * outline.mjs — sparse tree sidecar (MCP `get_metadata` equivalent).
 *
 * Walks the full bridge-agent-payload `designSnapshot.root` tree and emits a
 * flat, minimal descriptor of every node so an LLM (or tooling) can plan
 * against cheap metadata instead of reading the 9MB payload or even the
 * 200KB render-ready. All nodes are included — visibility is a field, not a
 * filter — matching MCP convention. This is strictly additive; nothing
 * downstream reads it yet, it is a new artifact for planning-pass consumption.
 *
 * Shape:
 *   {
 *     rootId: "7336:1035",
 *     totalNodes: 1500,
 *     nodes: [
 *       { id, parentId, name, type, depth, visible, x, y, w, h }
 *     ],
 *     idIndex: { "<id>": <index in nodes[]> }
 *   }
 *
 * Field choices:
 *   - x/y/w/h are from `layout.absoluteBoundingBox` (Figma canvas coordinates,
 *     same basis as box in render-ready). Nullable when the node has no
 *     geometry (e.g. DOCUMENT root).
 *   - `visible` is `node.visible !== false` AND not opacity-0 AND not hidden
 *     by a parent; we only check `node.visible !== false` directly (cheap
 *     single-node decision) — ancestor-cascade filtering is out of scope for
 *     outline and belongs to render-ready.
 *   - `depth` from root (root.depth = 0). Helpful for flat BFS planning.
 */

export function buildOutline(root) {
  const nodes = [];
  const idIndex = {};

  function walk(node, parentId, depth) {
    if (!node || !node.id) return;
    const box = node.layout?.absoluteBoundingBox;
    const entry = {
      id: node.id,
      parentId,
      name: typeof node.name === 'string' ? node.name : null,
      type: node.type,
      depth,
      visible: node.visible !== false,
      x: box?.x ?? null,
      y: box?.y ?? null,
      w: box?.width ?? null,
      h: box?.height ?? null,
    };
    idIndex[node.id] = nodes.length;
    nodes.push(entry);
    for (const c of node.children || []) walk(c, node.id, depth + 1);
  }

  walk(root, null, 0);

  return {
    schemaVersion: 1,
    rootId: root?.id ?? null,
    totalNodes: nodes.length,
    nodes,
    idIndex,
  };
}
