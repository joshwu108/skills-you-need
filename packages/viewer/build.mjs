/**
 * Bundles the viewer into the files the skill and the extension ship.
 *
 * The outputs are committed: the skill must work straight from a plugin
 * install, with no build step on the reader's machine. CI rebuilds and fails
 * if the committed files differ from the sources.
 */

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const skillAssets = resolve(repo, 'plugins/codeatlas/skills/codeatlas/assets');
const extensionMedia = resolve(repo, 'extension/media');

const shared = {
  bundle: true,
  minify: true,
  target: ['es2020'],
  legalComments: 'none',
  logLevel: 'info',
};

async function bundle(entry, outfile) {
  await mkdir(dirname(outfile), { recursive: true });
  await build({ ...shared, entryPoints: [resolve(here, entry)], outfile, format: 'iife' });
}

await bundle('src/standalone.ts', resolve(skillAssets, 'viewer.js'));
await bundle('src/styles.css', resolve(skillAssets, 'viewer.css'));

// The extension is built after the skill; skip its copies until it exists.
if (existsSync(resolve(repo, 'extension/package.json'))) {
  await bundle('src/webview.ts', resolve(extensionMedia, 'viewer.js'));
  await bundle('src/styles.css', resolve(extensionMedia, 'viewer.css'));
}
