#!/usr/bin/env node
// Stage 3 — Mechanical JSX emitter.
// Reads render-ready.json and produces a mechanical App.jsx: one div/span/img per node,
// className = n-<sanitized-id>, id attribute = sanitized id. No semantics, no sub-components.
// The codegen_pipeline.mjs hands this to a model for refactoring.

import fs from 'fs';
import path from 'path';

function esc(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

function escJsx(s) {
  return String(s ?? '').replace(/[{<>]/g, (ch) => ({ '{': '&#123;', '<': '&lt;', '>': '&gt;' }[ch]));
}

function renderNode(node, indexById, imageImports, depth = 0) {
  const pad = '  '.repeat(depth + 2);
  const id = node.id.replace(/[:;]/g, '-');
  const cls = node.className;

  // TEXT leaf
  if (node.role === 'text') {
    const content = node.text?.content || node.name || '';
    return `${pad}<span className="${cls}" id="${id}">${escJsx(content)}</span>`;
  }

  // VECTOR — emit <img src> with absolute /svg/ path (served from public/)
  if (node.role === 'vector' && node.vector?.svgPath) {
    const abs = node.vector.svgPath.replace(/^\.\//, '/');
    return `${pad}<img className="${cls}" id="${id}" src="${abs}" alt="${esc(node.name)}" />`;
  }

  // IMAGE container: use background-image via inline style for determinism (CSS may override)
  let extraStyle = '';
  if (node.role === 'image' && node.image?.path) {
    const importName = `img_${node.image.hash.slice(0, 12)}`;
    imageImports.set(importName, node.image.path);
    const scale = node.image.scaleMode;
    const size = scale === 'CROP' ? '100% 100%' : scale === 'FIT' ? 'contain' : 'cover';
    extraStyle = ` style={{ backgroundImage: \`url(\${${importName}})\`, backgroundSize: '${size}', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}`;
  }

  const childNodes = node.childrenOrder
    .map((cid) => indexById.get(cid))
    .filter(Boolean)
    .map((c) => renderNode(c, indexById, imageImports, depth + 1));

  if (childNodes.length === 0) {
    return `${pad}<div className="${cls}" id="${id}"${extraStyle} />`;
  }
  return `${pad}<div className="${cls}" id="${id}"${extraStyle}>\n${childNodes.join('\n')}\n${pad}</div>`;
}

function emitJsx(renderReady) {
  const indexById = new Map(renderReady.nodes.map((n) => [n.id, n]));
  const root = indexById.get(renderReady.rootId);
  if (!root) throw new Error(`Root node ${renderReady.rootId} not found`);

  const imageImports = new Map();
  const body = renderNode(root, indexById, imageImports, 0);

  const imports = [`import './App.css';`];
  for (const [name, relPath] of imageImports) {
    imports.push(`import ${name} from '${relPath}';`);
  }

  return `${imports.join('\n')}

export default function App() {
  return (
${body}
  );
}
`;
}

function main() {
  const rrPath = process.argv[2];
  const outPath = process.argv[3];
  if (!rrPath || !outPath) {
    console.error('Usage: emit_jsx.mjs <render-ready.json> <out.jsx>');
    process.exit(2);
  }
  const rr = JSON.parse(fs.readFileSync(rrPath, 'utf8'));
  const jsx = emitJsx(rr);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, jsx);
  console.log(JSON.stringify({ ok: true, out: outPath, chars: jsx.length, nodes: rr.nodes.length }, null, 2));
}

main();
