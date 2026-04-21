import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('skills/figma');
const textExts = new Set([
  '.md', '.mjs', '.js', '.ts', '.tsx', '.json', '.yaml', '.yml', '.py', '.html', '.d.ts',
]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === 'cache' || entry.name === 'assets' || entry.name === '.git') continue;
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && textExts.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

test('skills/figma text files do not contain direct Han characters', () => {
  const files = walk(root);
  const offenders = [];
  for (const file of files) {
    const rel = path.relative(root, file);
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (/[\p{Script=Han}]/u.test(lines[i])) {
        offenders.push(`${rel}:${i + 1}:${lines[i].trim()}`);
        break;
      }
    }
  }
  assert.deepEqual(offenders, [], `Found Han characters in:\n${offenders.join('\n')}`);
});

