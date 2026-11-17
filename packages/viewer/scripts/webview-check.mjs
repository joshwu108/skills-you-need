/**
 * Renders the extension's webview bundle outside VS Code, with a stand-in
 * for the VS Code API, to check that it draws and follows the editor theme.
 *
 *   node scripts/webview-check.mjs <map.json> <output dir>
 */

import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const [mapPath, outDir] = process.argv.slice(2);
if (!mapPath || !outDir) {
  console.error('usage: node scripts/webview-check.mjs <map.json> <output dir>');
  process.exit(2);
}
const media = resolve(dirname(fileURLToPath(import.meta.url)), '../../../extension/media');
const map = JSON.parse(await readFile(resolve(mapPath), 'utf8'));
const script = await readFile(resolve(media, 'viewer.js'), 'utf8');
const style = await readFile(resolve(media, 'viewer.css'), 'utf8');
await mkdir(resolve(outDir), { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const problems = [];
for (const theme of ['vscode-light', 'vscode-dark']) {
  // The OS scheme is set opposite to the editor theme: the editor must win.
  const colorScheme = theme === 'vscode-dark' ? 'light' : 'dark';
  const page = await browser.newPage({ viewport: { width: 900, height: 800 }, colorScheme });
  page.on('pageerror', (error) => problems.push(`${theme}: ${error.message}`));
  await page.setContent(`<!doctype html><html><head><style>${style}</style></head><body class="${theme}"><main id="atlas"></main></body></html>`);
  await page.evaluate(() => {
    window.sent = [];
    window.acquireVsCodeApi = () => ({ postMessage: (message) => window.sent.push(message) });
  });
  await page.addScriptTag({ content: script });
  await page.evaluate((data) => window.postMessage({ type: 'map', data: { map: data }, focus: 'extension' }, '*'), map);
  await page.waitForSelector('.atlas-node');
  await page.waitForTimeout(450);
  const sent = await page.evaluate(() => window.sent);
  if (sent[0]?.type !== 'ready') problems.push(`${theme}: first message was ${JSON.stringify(sent[0])}, expected ready`);
  if (!sent.some((m) => m.type === 'navigate' && m.nodeId === 'extension')) problems.push(`${theme}: no navigate message for the focused node`);
  await page.click('.atlas-node-code');
  const opened = (await page.evaluate(() => window.sent)).find((m) => m.type === 'open');
  if (!opened?.anchor?.file) problems.push(`${theme}: clicking a code button sent no open message`);
  const applied = await page.evaluate(() => document.documentElement.dataset.theme);
  if (applied !== theme.replace('vscode-', '')) problems.push(`${theme}: data-theme is ${applied}`);
  await page.screenshot({ path: resolve(outDir, `webview-${theme}.png`) });
  await page.close();
}
await browser.close();
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Webview bundle renders in both themes; screenshots in ${resolve(outDir)}`);
