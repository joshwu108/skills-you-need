/**
 * Entry point for the generated HTML page.
 *
 * The map is read from the inert JSON block the build script inlines. Code
 * links use an editor URL scheme, and the focused node is mirrored in the
 * URL fragment so a view can be bookmarked and the back button works.
 */

import { mount } from './app';
import { h } from './dom';
import { DEFAULT_EDITOR, EDITORS, editorUrl, isEditorScheme } from './links';
import type { AtlasData } from './types';

const EDITOR_KEY = 'codeatlas.editor';
const HASH_PREFIX = '#/';

function readData(): AtlasData {
  const source = document.getElementById('atlas-data')?.textContent;
  if (!source) throw new Error('This page has no embedded map. Rebuild it with the codeatlas skill.');
  const data = JSON.parse(source) as Partial<AtlasData>;
  if (!data.map || !Array.isArray(data.map.nodes)) {
    throw new Error('The embedded map is not in the expected format. Rebuild it with the codeatlas skill.');
  }
  return data as AtlasData;
}

/** Storage can throw in private windows; the choice then lasts for this visit only. */
function storedEditor(): string {
  try {
    const value = localStorage.getItem(EDITOR_KEY);
    return isEditorScheme(value) ? value : DEFAULT_EDITOR;
  } catch {
    return DEFAULT_EDITOR;
  }
}

function storeEditor(scheme: string): void {
  try {
    localStorage.setItem(EDITOR_KEY, scheme);
  } catch {
    // Not persisted; the select keeps the choice for this visit.
  }
}

function editorPicker(): { element: HTMLElement; scheme(): string } {
  const select = h('select', { id: 'atlas-editor' });
  for (const editor of EDITORS) select.appendChild(h('option', { value: editor.scheme }, editor.label));
  select.value = storedEditor();
  select.addEventListener('change', () => storeEditor(select.value));
  const element = h('label', { class: 'atlas-editor', for: 'atlas-editor' }, 'Open code in ', select);
  return { element, scheme: () => select.value };
}

function hashNode(): string | null {
  if (!location.hash.startsWith(HASH_PREFIX)) return null;
  try {
    return decodeURIComponent(location.hash.slice(HASH_PREFIX.length));
  } catch {
    // A hand-edited fragment with a broken escape names no node.
    return null;
  }
}

function start(container: HTMLElement): void {
  const data = readData();
  const picker = editorPicker();
  const controller = mount(container, data, {
    toolbar: picker.element,
    openAnchor: (anchor) => {
      const url = editorUrl(picker.scheme(), data.root ?? '', anchor);
      if (url) location.href = url;
    },
    onNavigate: (nodeId) => {
      const hash = nodeId === null ? '' : HASH_PREFIX + encodeURIComponent(nodeId);
      if (hash !== location.hash) history.pushState(null, '', hash || location.pathname + location.search);
    },
  });

  const syncFromHash = (): void => {
    controller.focus(hashNode());
  };
  window.addEventListener('popstate', syncFromHash);
  window.addEventListener('hashchange', syncFromHash);
  syncFromHash();
}

const container = document.getElementById('atlas');
if (container) {
  try {
    start(container);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    container.replaceChildren(h('p', { class: 'atlas-fatal', role: 'alert' }, message));
  }
}
