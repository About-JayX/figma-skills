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
  assert.match(skill, /标准 Workflow（不可跳步）/);
  assert.match(skill, /Workflow 1.*先跑提取与机械基线/s);
  assert.match(skill, /Workflow 2.*先读诊断，再选交付模式/s);
  assert.match(skill, /Workflow 4.*每轮改动后立即复验/s);
  assert.match(skill, /禁止跳过/);
});

test('route escalation reference documents subtree and page-level escalation', () => {
  const route = read('references/08-route-escalation.md');
  assert.match(route, /子树级|subtree/i);
  assert.match(route, /页面级|page-level|root-level/i);
  assert.match(route, /overlay/i);
});

test('verification reference requires reporting delivery mode and locked regions', () => {
  const verification = read('references/09-verification.md');
  assert.match(verification, /交付模式|delivery mode/i);
  assert.match(verification, /锁定区域|locked region/i);
});
