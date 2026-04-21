/**
 * browser.mjs — launch a headless Chromium-compatible browser via playwright-core.
 *
 * Resolution order (first that succeeds wins):
 *   1. $FIGMA_BROWSER_PATH — escape hatch for CI or exotic setups
 *   2. System Google Chrome        (channel: 'chrome')
 *   3. System Microsoft Edge       (channel: 'msedge')
 *   4. System Chromium at known OS paths (executablePath)
 *   5. Playwright-managed Chromium (requires one-time `npx playwright install chromium`)
 *
 * Rationale: skill package stays small (playwright-core ≈ 11MB, no bundled browser).
 * Users with Chrome/Edge already installed pay nothing. Users without can opt-in
 * to Playwright's chromium download (stored in ~/.cache/ms-playwright, not in skill).
 */
import fs from 'fs';
import { chromium } from 'playwright-core';

const SYSTEM_CHROMIUM_PATHS = {
  darwin: [
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
  win32: [],
};

function firstExisting(paths) {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function tryLaunch(label, launchArgs) {
  try {
    const browser = await chromium.launch(launchArgs);
    return { browser, source: label };
  } catch (err) {
    return { error: err, source: label };
  }
}

export async function launchBrowser(extraLaunchOptions = {}) {
  const baseOpts = { headless: true, ...extraLaunchOptions };
  const attempts = [];

  const envPath = process.env.FIGMA_BROWSER_PATH;
  if (envPath && fs.existsSync(envPath)) {
    const res = await tryLaunch('env', { ...baseOpts, executablePath: envPath });
    if (res.browser) return res;
    attempts.push(res);
  }

  for (const channel of ['chrome', 'msedge']) {
    const res = await tryLaunch(`channel:${channel}`, { ...baseOpts, channel });
    if (res.browser) return res;
    attempts.push(res);
  }

  const chromiumPath = firstExisting(SYSTEM_CHROMIUM_PATHS[process.platform] || []);
  if (chromiumPath) {
    const res = await tryLaunch('system-chromium', { ...baseOpts, executablePath: chromiumPath });
    if (res.browser) return res;
    attempts.push(res);
  }

  const res = await tryLaunch('playwright-chromium', baseOpts);
  if (res.browser) return res;
  attempts.push(res);

  const err = new Error(missingBrowserMessage());
  err.attempts = attempts.map((a) => ({ source: a.source, message: a.error?.message || 'unknown' }));
  throw err;
}

export function missingBrowserMessage() {
  return [
    'verify_loop needs Chrome, Edge, or Chromium. None was found. Options:',
    '  • Install Google Chrome (easiest)',
    '  • Or run once:  npx playwright install chromium',
    '      (downloads ~170MB to ~/.cache/ms-playwright — not into the skill)',
    '  • Or set FIGMA_BROWSER_PATH=/absolute/path/to/chromium',
  ].join('\n');
}
