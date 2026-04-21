#!/usr/bin/env node
/**
 * Smoke tests for verify_loop's new capture pipeline:
 *   - browser.mjs: missingBrowserMessage text, FIGMA_BROWSER_PATH escape hatch
 *   - dom_snapshot.mjs: id sanitization, id-pair builder
 *   - End-to-end (when a browser is available): launch → evaluate snapshot on
 *     synthetic HTML → assert shape (rect, computed whitelist, leaf text)
 *
 * The end-to-end block is skipped (not failed) when no Chrome/Chromium is
 * resolvable, so this file stays green on CI boxes without a browser.
 */
import http from 'http';
import { launchBrowser, missingBrowserMessage } from './lib/browser.mjs';
import {
  COMPUTED_WHITELIST,
  buildNodeIdPairs,
  captureDomSnapshot,
  sanitizeDomId,
} from './lib/dom_snapshot.mjs';

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}

function skip(msg) {
  skipped += 1;
  console.log(`  ↷ SKIP ${msg}`);
}

// ─── Pure unit checks (no browser needed) ───

console.log('browser.mjs unit');
{
  const msg = missingBrowserMessage();
  assert(msg.includes('Chrome'), 'missingBrowserMessage mentions Chrome');
  assert(msg.includes('playwright install chromium'), 'missingBrowserMessage suggests playwright install');
  assert(msg.includes('FIGMA_BROWSER_PATH'), 'missingBrowserMessage documents env escape hatch');
}

console.log('dom_snapshot.mjs unit');
{
  assert(sanitizeDomId('1:2;3') === '1-2-3', 'sanitizeDomId replaces : and ;');
  assert(sanitizeDomId('abc') === 'abc', 'sanitizeDomId passes plain IDs through');

  const pairs = buildNodeIdPairs([{ id: 'I1:2;3' }, { id: '4:5' }]);
  assert(pairs[0].rr === 'I1:2;3' && pairs[0].dom === 'I1-2-3', 'buildNodeIdPairs preserves rr, sanitizes dom');
  assert(pairs[1].rr === '4:5' && pairs[1].dom === '4-5', 'buildNodeIdPairs sanitizes colon');

  assert(COMPUTED_WHITELIST.includes('paddingLeft'), 'whitelist includes paddingLeft');
  assert(COMPUTED_WHITELIST.includes('backgroundColor'), 'whitelist includes backgroundColor');
  assert(!COMPUTED_WHITELIST.includes('all'), 'whitelist does not include dangerous shorthand "all"');
}

// ─── End-to-end check (needs a browser) ───

async function e2e() {
  console.log('dom_snapshot end-to-end');

  let launched;
  try {
    launched = await launchBrowser();
  } catch (err) {
    skip('no browser resolvable — ' + (err.message.split('\n')[0] || 'unknown'));
    return;
  }

  const browser = launched.browser;
  const html = `<!doctype html>
<html>
  <head><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui; }
    .n-1-2 { width: 200px; height: 100px; padding: 16px 24px; background: rgb(255, 0, 0); }
    .n-1-3 { color: rgb(0, 128, 0); font-size: 18px; font-weight: 700; }
  </style></head>
  <body>
    <div id="1-2" class="n-1-2">
      <span id="1-3" class="n-1-3">Hello</span>
    </div>
  </body>
</html>`;
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  try {
    console.log(`    browser source: ${launched.source}`);
    const context = await browser.newContext({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

    const pairs = [
      { rr: '1:2', dom: '1-2' },
      { rr: '1:3', dom: '1-3' },
      { rr: '9:9', dom: '9-9' }, // intentionally absent
    ];
    const snap = await captureDomSnapshot(page, pairs);

    assert(snap.length === 3, 'snapshot returns entry per input pair');

    const a = snap.find((n) => n.id === '1:2');
    assert(a && a.present === true, '1:2 found in DOM');
    assert(a.rect.w === 200 && a.rect.h === 100, '1:2 rect matches CSS (200×100)');
    assert(a.computed.paddingLeft === '24px', '1:2 paddingLeft captured');
    assert(a.computed.backgroundColor === 'rgb(255, 0, 0)', '1:2 backgroundColor captured');
    assert(a.tag === 'div', '1:2 tag is div');
    assert(a.className === 'n-1-2', '1:2 className is n-1-2');

    const b = snap.find((n) => n.id === '1:3');
    assert(b && b.text === 'Hello', '1:3 leaf text captured');
    assert(b.computed.fontWeight === '700', '1:3 fontWeight captured');
    assert(b.tag === 'span', '1:3 tag is span');

    const c = snap.find((n) => n.id === '9:9');
    assert(c && c.present === false, '9:9 absent node marked present:false');

    await context.close();
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
}

await e2e();

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed === 0 ? 0 : 1);
