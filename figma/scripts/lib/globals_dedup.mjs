/**
 * globals_dedup.mjs — content-hash dedup of repeated paint / stroke / effect
 * bundles across the bridge tree. Modeled on GLips / Figma-Context-MCP's
 * `globalVars` trick: extract one canonical copy per unique bundle into a
 * `globals.json` sidecar, then reference by stable id from each node.
 *
 * This is STRICTLY ADDITIVE in v1:
 *   - Inline `style.fills[]` / `style.strokes[]` / `style.effects[]` are NOT
 *     removed (current consumers keep reading them unchanged).
 *   - A parallel id field (`style.fillId` / `style.strokeId` / `style.effectId`)
 *     is attached next to the inline array so future consumers can opt in.
 *
 * Once emit_css / emit_jsx / codegen consumers have migrated to the id refs,
 * a follow-up can drop the inline arrays to realize the full size savings.
 */
import crypto from 'crypto';

/**
 * Canonical JSON: keys sorted recursively so object permutations hash
 * identically. Arrays preserve order (fills[0] vs fills[1] are distinct).
 */
function canonical(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

function hash(prefix, value) {
  if (value == null) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  const h = crypto.createHash('sha256').update(canonical(value)).digest('hex').slice(0, 10);
  return `${prefix}_${h}`;
}

/**
 * Walk the bridge tree. For each node with non-empty style.fills / strokes /
 * effects, assign a stable id field and intern the array into a globals map.
 * Returns { globals, stats }.
 *
 * stats.{uniqueFills, uniqueStrokes, uniqueEffects} — dedup quality metric.
 * stats.{hits.fills, hits.strokes, hits.effects} — how many nodes carry each.
 */
export function buildGlobals(root) {
  const globals = { fills: {}, strokes: {}, effects: {} };
  const stats = {
    hits: { fills: 0, strokes: 0, effects: 0 },
    uniqueFills: 0,
    uniqueStrokes: 0,
    uniqueEffects: 0,
  };

  function intern(bucket, arr, prefix) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const id = hash(prefix, arr);
    if (!id) return null;
    if (!(id in globals[bucket])) globals[bucket][id] = arr;
    return id;
  }

  function walk(node) {
    if (!node) return;
    const s = node.style;
    if (s) {
      const fillId = intern('fills', s.fills, 'f');
      if (fillId) { s.fillId = fillId; stats.hits.fills += 1; }
      const strokeId = intern('strokes', s.strokes, 's');
      if (strokeId) { s.strokeId = strokeId; stats.hits.strokes += 1; }
      const effectId = intern('effects', s.effects, 'e');
      if (effectId) { s.effectId = effectId; stats.hits.effects += 1; }
    }
    for (const c of node.children || []) walk(c);
  }

  walk(root);

  stats.uniqueFills = Object.keys(globals.fills).length;
  stats.uniqueStrokes = Object.keys(globals.strokes).length;
  stats.uniqueEffects = Object.keys(globals.effects).length;

  return { globals, stats };
}
