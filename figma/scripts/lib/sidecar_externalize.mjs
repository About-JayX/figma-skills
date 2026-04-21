/**
 * sidecar_externalize.mjs — move inlined per-node "dead weight" fields out
 * of the main bridge-agent-payload into sidecar files. Matches MCP's
 * principle of never inlining binary/bulky data into the tree JSON.
 *
 * Two concrete applications:
 *
 *   1. `variables.inferred` (suggestion-only data, dominant ~74% of our
 *      designSnapshot) → aggregated to a single sidecar
 *      `variables-inferred.json` keyed by nodeId. Downstream reads
 *      `variables.bound` only; inferred is informational.
 *
 *   2. `vector.{fillGeometry, vectorPaths, vectorNetwork}` (raw geometry
 *      arrays, currently unread by any downstream script — svgString is the
 *      actual render source) → per-node blob `blobs/geom-<sanitizedId>.json`
 *      referenced from the node as `vector.geomRef`.
 *
 * Both are **lossless**: the data still exists on disk, just not inline in
 * the 9MB main payload. New consumers who want it can load the sidecar.
 *
 * Safety: callers MUST NOT run these on a payload that has already been
 * externalized (the functions detect this and skip). They return a report
 * describing what was moved.
 */
import fs from 'fs';
import path from 'path';

function sanitizeId(s) {
  return String(s).replace(/[:;]/g, '-');
}

/**
 * Externalize `variables.inferred` from every node into a single sidecar
 * file at `<cacheDir>/variables-inferred.json`. Deletes the inline field
 * after writing. Returns { nodes, bytesRemoved, path }.
 *
 * Note: `variables.bound` is preserved inline (actively consumed by
 * variable_substitution.mjs → computedCss.tokens).
 */
export function externalizeInferredVariables(root, cacheDir) {
  if (!root) return null;
  const map = {};
  let nodes = 0;
  let bytesRemoved = 0;

  function walk(node) {
    if (node?.variables && node.variables.inferred) {
      const inferred = node.variables.inferred;
      if (inferred && typeof inferred === 'object' && Object.keys(inferred).length > 0) {
        map[node.id] = inferred;
        bytesRemoved += Buffer.byteLength(JSON.stringify(inferred));
        nodes += 1;
      }
      delete node.variables.inferred;
    }
    for (const c of node.children || []) walk(c);
  }

  walk(root);

  if (nodes === 0) return { nodes: 0, bytesRemoved: 0, path: null };

  const outPath = path.join(cacheDir, 'variables-inferred.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        note: 'Per-node Figma "inferred variable suggestions". Not consumed by the reproduction pipeline; externalized to keep bridge-agent-payload lean. Keyed by nodeId.',
        byNodeId: map,
      },
      null,
      2
    )
  );
  return { nodes, bytesRemoved, path: outPath };
}

/**
 * Externalize `vector.fillGeometry`, `vector.vectorPaths`,
 * `vector.vectorNetwork` from every node into per-node blob files under
 * `<cacheDir>/blobs/geom-<sanitizedId>.json`. Replaces the inline fields
 * with a single `vector.geomRef` relative path. Returns
 * { nodes, bytesRemoved, files }.
 */
export function externalizeVectorGeometry(root, cacheDir) {
  if (!root) return null;
  const blobsDir = path.join(cacheDir, 'blobs');
  fs.mkdirSync(blobsDir, { recursive: true });

  const files = [];
  let nodes = 0;
  let bytesRemoved = 0;

  function walk(node) {
    if (node?.vector) {
      const geom = {};
      let has = false;
      for (const k of ['fillGeometry', 'vectorPaths', 'vectorNetwork']) {
        if (node.vector[k] != null) {
          geom[k] = node.vector[k];
          has = true;
        }
      }
      if (has) {
        const fileName = `geom-${sanitizeId(node.id)}.json`;
        const outPath = path.join(blobsDir, fileName);
        fs.writeFileSync(outPath, JSON.stringify(geom));
        const bytes = Buffer.byteLength(JSON.stringify(geom));
        bytesRemoved += bytes;
        files.push({ nodeId: node.id, file: fileName, bytes });
        nodes += 1;
        for (const k of ['fillGeometry', 'vectorPaths', 'vectorNetwork']) delete node.vector[k];
        node.vector.geomRef = `blobs/${fileName}`;
      }
    }
    for (const c of node.children || []) walk(c);
  }

  walk(root);
  return { nodes, bytesRemoved, files };
}
