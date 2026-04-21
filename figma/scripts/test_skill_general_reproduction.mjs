import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('skills/figma');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('figma skill documents generic reproduction delivery modes', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /DOM-first/);
  assert.match(skill, /Hybrid-SVG/);
  assert.match(skill, /Visual-lock/);
});

test('figma skill defines a no-skip workflow for generic reproduction', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /Standard Workflow \(No Skipping\)/);
  assert.match(skill, /Workflow 1.*Extract and Generate the Mechanical Baseline First/s);
  assert.match(skill, /Workflow 2.*Read Diagnostics Before Choosing a Delivery Mode/s);
  assert.match(skill, /Workflow 4.*Re-Verify After Every Meaningful Change/s);
  assert.match(skill, /Do not/);
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
