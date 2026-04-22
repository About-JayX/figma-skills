import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function has(rel) {
  return fs.existsSync(path.join(root, rel));
}

test('figma skill documents generic reproduction delivery modes', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /DOM-first/);
  assert.match(skill, /Hybrid-SVG/);
  assert.match(skill, /Visual-lock/);
  assert.match(skill, /keep it as the active workflow unless the user explicitly requests an exception/i);
});

test('figma skill defines a no-skip workflow for generic reproduction', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /Standard Workflow \(No Skipping\)/);
  assert.match(skill, /single source of truth for reproduction workflow/i);
  assert.match(skill, /Workflow 1.*Extract and Generate the Mechanical Baseline First/s);
  assert.match(skill, /Workflow 2.*Read Diagnostics Before Choosing a Delivery Mode/s);
  assert.match(skill, /Workflow 3.*AI Implementation Pass/s);
  assert.match(skill, /Workflow 4.*Re-Verify After Every Meaningful Change/s);
  assert.match(skill, /Do not/);
});

test('architecture review defers canonical workflow definition to SKILL.md', () => {
  if (!has('docs/architecture-review.md')) return;
  const review = read('docs/architecture-review.md');
  assert.match(review, /SKILL\.md.*唯一权威来源/);
  assert.match(review, /本文件不单独定义或覆盖 workflow/);
});

test('figma skill treats mechanical codegen as a starter and AI as a formal implementation stage', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /mechanical output project/);
  assert.match(skill, /starting point, not the final implementation/i);
  assert.match(skill, /AI implementation is a required stage/i);
  assert.match(skill, /Prefer existing repo components, tokens, and semantic structure/i);
});

test('figma skill distinguishes interactive AI execution from autonomous CLI execution', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /interactive agent session/i);
  assert.match(skill, /autonomous CLI/i);
  assert.match(skill, /--ai-implement-cmd|FIGMA_AI_IMPLEMENT_CMD/);
});

test('figma skill constrains SVG output to true svg/vector elements only', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /Only actual SVG\/vector elements may be emitted as SVG/);
  assert.match(skill, /Do not escalate ordinary text, ordinary auto-layout containers, or ordinary image content to `SVG_ISLAND`/);
});

test('figma skill forbids page-level image cover overlays without explicit approval', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /Do not use page-level image overlays or full-page SVG\/image cover layers unless the user explicitly approves/i);
  assert.match(skill, /full-page image-style cover layer is forbidden unless the user explicitly asks for or approves it/i);
});

test('route escalation reference documents subtree and page-level escalation', () => {
  const route = read('references/08-route-escalation.md');
  assert.match(route, /subtree/i);
  assert.match(route, /page-level|root-level/i);
  assert.match(route, /overlay/i);
});

test('verification reference requires reporting delivery mode and locked regions', () => {
  const verification = read('references/09-verification.md');
  assert.match(verification, /delivery mode/i);
  assert.match(verification, /locked region/i);
});
