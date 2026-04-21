import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('skills/figma/references');

function read(name) {
  return fs.readFileSync(path.join(root, name), 'utf8');
}

test('05-layout-modes keeps exact mapping detail', () => {
  const text = read('05-layout-modes.md');
  assert.match(text, /primaryAxisAlignItems/i);
  assert.match(text, /counterAxisAlignItems/i);
  assert.match(text, /layoutWrap/i);
  assert.match(text, /constraints\.horizontal/i);
  assert.match(text, /gridRowSizes/i);
  assert.match(text, /strokeAlign/i);
  assert.match(text, /clipsContent/i);
});

test('01-data-sources keeps field-level authority detail', () => {
  const text = read('01-data-sources.md');
  assert.match(text, /minWidth/i);
  assert.match(text, /strokeTopWeight/i);
  assert.match(text, /textAlignVertical/i);
  assert.match(text, /paragraphSpacing/i);
  assert.match(text, /handleMirroring/i);
  assert.match(text, /computedCss\.withTokens/i);
  assert.match(text, /globals\.json/i);
  assert.match(text, /variables-inferred\.json/i);
});

test('03-node-to-html keeps deterministic step detail', () => {
  const text = read('03-node-to-html.md');
  assert.match(text, /Step 1/i);
  assert.match(text, /Step 7/i);
  assert.match(text, /computedCss\.full/i);
  assert.match(text, /data-fig-name|Nav|Header|Footer/i);
  assert.match(text, /segment/i);
  assert.match(text, /scorecard/i);
});

test('04-text-rendering keeps advanced text fidelity rules', () => {
  const text = read('04-text-rendering.md');
  assert.match(text, /paragraphSpacing/i);
  assert.match(text, /paragraphIndent/i);
  assert.match(text, /small-caps|all-small-caps/i);
  assert.match(text, /CJK|Chinese/i);
  assert.match(text, /fallback/i);
  assert.match(text, /hyperlink/i);
});

test('07-tokens-and-vars keeps binding and conflict detail', () => {
  const text = read('07-tokens-and-vars.md');
  assert.match(text, /variables\.bound/i);
  assert.match(text, /variables\.inferred/i);
  assert.match(text, /variables-substitution-map\.json/i);
  assert.match(text, /Figma property|Figma binding prop/i);
  assert.match(text, /Unicode/i);
  assert.match(text, /collision|conflict/i);
  assert.match(text, /data-theme|prefers-color-scheme/i);
});

test('06-paint-effects keeps tricky implementation guidance', () => {
  const text = read('06-paint-effects.md');
  assert.match(text, /mask-composite/i);
  assert.match(text, /Option A/i);
  assert.match(text, /Option B/i);
  assert.match(text, /maskType/i);
  assert.match(text, /mix-blend-mode/i);
  assert.match(text, /PASS_THROUGH/i);
  assert.match(text, /z-order|stroke.*above.*fill/i);
});

test('08-route-escalation keeps hard-signal and implementation detail', () => {
  const text = read('08-route-escalation.md');
  assert.match(text, /DOM_NATIVE.*DOM_INFERRED/s);
  assert.match(text, /DOM_GRID.*SVG_ISLAND/s);
  assert.match(text, /node\.isMask|BOOLEAN_OPERATION|variable-width/i);
  assert.match(text, /viewBox/i);
  assert.match(text, /RASTER_LOCK/i);
  assert.match(text, /componentPropertyDefinitions|variantProperties|resolvedVariableModes/i);
  assert.match(text, /Self-Check|checklist/i);
});

test('09-verification keeps thresholds, commands, and acceptance details', () => {
  const text = read('09-verification.md');
  assert.match(text, /\| page \|/i);
  assert.match(text, /\| region \|/i);
  assert.match(text, /\| hard-node \|/i);
  assert.match(text, /\| text \|/i);
  assert.match(text, /--headless=new/);
  assert.match(text, /--force-device-scale-factor=2/);
  assert.match(text, /--early-exit/);
  assert.match(text, /--fail-on-thresholds/);
  assert.match(text, /acceptance-manifest\.json/);
  assert.match(text, /Six-Dimension|six-dimension|6 dimensions/i);
});

test('10-bridge-env keeps dependency, env var, and cache artifact detail', () => {
  const text = read('10-bridge-env.md');
  assert.match(text, /pip3 install numpy Pillow/);
  assert.match(text, /brew install librsvg/);
  assert.match(text, /FIGMA_BRIDGE_HOST/);
  assert.match(text, /FIGMA_BRIDGE_PORT/);
  assert.match(text, /FIGMA_BRIDGE_EXTRACT_TIMEOUT_MS/);
  assert.match(text, /ws_defs \(C5\+A8\)/);
  assert.match(text, /bridge-response\.json/);
  assert.match(text, /baseline\/baseline\.png\.lab\.npy/);
  assert.match(text, /merged-agent-payload\.json/);
});

test('test corpus README keeps sample taxonomy and workflow detail', () => {
  const text = fs.readFileSync(path.resolve('skills/figma/test_corpus/README.md'), 'utf8');
  assert.match(text, /marketing-long-page/);
  assert.match(text, /dashboard-dense/);
  assert.match(text, /component-library/);
  assert.match(text, /icon-gallery/);
  assert.match(text, /long-article/);
  assert.match(text, /baselineSsimFloor/);
  assert.match(text, /ingest_corpus_sample\.mjs/);
  assert.match(text, /npm run regression:corpus/);
  assert.match(text, /Git LFS/i);
});

test('ws_defs source README keeps rebuild and module ordering guidance', () => {
  const text = fs.readFileSync(path.resolve('skills/figma/ws_defs/src/README.md'), 'utf8');
  assert.match(text, /build_ws_defs_bundle\.mjs/);
  assert.match(text, /ws_defs\/code\.js/);
  assert.match(text, /00_bootstrap_and_core\.js/);
  assert.match(text, /10_variables_and_primitives\.js/);
  assert.match(text, /20_routing_and_text\.js/);
  assert.match(text, /30_scene_snapshot\.js/);
  assert.match(text, /35_enrichment_filters\.js/);
  assert.match(text, /40_extraction_transport\.js/);
  assert.match(text, /50_job_runtime\.js/);
});
