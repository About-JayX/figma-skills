#!/usr/bin/env node
// Run the post-extract enrichment passes on an existing cache dir.
// Replicates figma_pipeline.mjs steps 1.8/1.9/1.10 without re-extracting.
// Needed when bridge_client agent was run directly (no --auto pipeline).
//
// Usage: node enrich_cache.mjs <cache-dir>

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { enrichNodeTokens, buildSubstitutionMap } from './lib/variable_substitution.mjs';
import { enrichComputedCss as enrichFullComputedCss } from './lib/computed_css.mjs';

const cacheDir = process.argv[2];
if (!cacheDir) {
  console.error('Usage: enrich_cache.mjs <cache-dir>');
  process.exit(2);
}

const payloadPath = path.join(cacheDir, 'bridge-agent-payload.json');
if (!fs.existsSync(payloadPath)) {
  console.error(`No bridge-agent-payload.json in ${cacheDir}`);
  process.exit(2);
}

console.log('[enrich] loading payload…');
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));

// Step 1.9 — variable substitution
try {
  const root = payload?.designSnapshot?.root;
  const defs = payload?.defs;
  if (root && defs) {
    const substMap = buildSubstitutionMap(defs);
    const enriched = enrichNodeTokens(root, substMap);
    console.log(`[enrich] variable substitution: ${enriched} nodes`);
    // persist substitution map alongside payload
    fs.writeFileSync(
      path.join(cacheDir, 'variables-substitution-map.json'),
      JSON.stringify(substMap, null, 2)
    );
  }
} catch (e) {
  console.warn('[enrich] variable substitution failed:', e.message);
}

// Step 1.10 — computedCss.full + computedHtml per node (THIS is what B1 + text content rely on)
try {
  const manifestPath = path.join(cacheDir, 'cache-manifest.json');
  let assetFiles = {};
  if (fs.existsSync(manifestPath)) {
    try {
      const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assetFiles = mf.assetFiles || {};
    } catch {
      /* ignore */
    }
  }
  const ccCtx = { assetFiles };
  const root = payload?.designSnapshot?.root;
  if (root) {
    const fullEnriched = enrichFullComputedCss(root, ccCtx);
    console.log(`[enrich] computedCss.full: ${fullEnriched} nodes (inlinedSvgs=${ccCtx.inlinedSvgs || 0})`);
  }
} catch (e) {
  console.warn('[enrich] computedCss.full failed:', e.message);
}

// Persist
console.log('[enrich] writing back payload…');
fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2));
console.log('[enrich] done');
