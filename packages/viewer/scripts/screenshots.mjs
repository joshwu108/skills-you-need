/**
 * Visual check of a built viewer page across breakpoints and themes.
 *
 *   node scripts/screenshots.mjs <atlas.html> <output dir> [node id to open]
 *
 * Uses the locally installed Chrome. Fails if the page logs an error or
 * scrolls sideways at any width.
 */

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright-core';

const [page_, outDir, nodeId] = process.argv.slice(2);
if (!page_ || !outDir) {
  console.error('usage: node scripts/screenshots.mjs <atlas.html> <output dir> [node id]');
  process.exit(2);
}

const WIDTHS = [320, 768, 1024, 1440];
const HEIGHT = 900;
const SETTLE_MS = 450; // longer than the entry animation

const base = pathToFileURL(resolve(page_)).href;
const out = resolve(outDir);
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];

async function capture(name, { width, scheme, hash = '' }) {
  const context = await browser.newContext({ viewport: { width, height: HEIGHT }, colorScheme: scheme });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${name}: console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`${name}: ${error.message}`));
  await page.goto(base + hash);
  await page.waitForSelector('.atlas-node');
  await page.waitForTimeout(SETTLE_MS);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) problems.push(`${name}: page scrolls sideways by ${overflow}px`);
  await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: width < 860 });
  await context.close();
}

for (const width of WIDTHS) await capture(`top-${width}-light`, { width, scheme: 'light' });
await capture('top-1440-dark', { width: 1440, scheme: 'dark' });
if (nodeId) {
  const hash = `#/${encodeURIComponent(nodeId)}`;
  await capture('node-1440-light', { width: 1440, scheme: 'light', hash });
  await capture('node-1440-dark', { width: 1440, scheme: 'dark', hash });
  await capture('node-320-light', { width: 320, scheme: 'light', hash });
}
await browser.close();

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Screenshots written to ${out}`);
