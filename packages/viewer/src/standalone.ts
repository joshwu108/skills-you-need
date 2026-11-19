/**
 * Entry point for the generated HTML page.
 *
 * The map is read from the inert JSON block the build script inlines. Code
 * links use an editor URL scheme, and the focused node is mirrored in the
 * URL fragment so a view can be bookmarked and the back button works. The
 * page cannot write files, so boxes moved here are remembered by the browser.
 */

import { mount } from './app';
import { h } from './dom';
import { DEFAULT_EDITOR, EDITORS, anchorLabel, editorUrl, isEditorScheme, isEmbeddedBrowser } from './links';
import { parseLayout, withPositions } from './positions';
import { createToast } from './toast';
import type { Toast } from './toast';
import type { Anchor, AtlasData, AtlasLayout } from './types';

const EDITOR_KEY = 'codeatlas.editor';
const LAYOUT_KEY = 'codeatlas.layout';
const HASH_PREFIX = '#/';
/** An editor that takes the link pulls focus from the page well within this. */
const HANDOFF_MS = 1800;
const EMBEDDED_MESSAGE =
  "Code links cannot open from an editor's built-in browser. In VS Code run “CodeAtlas: Open Map” from the command palette, or open this page in your usual browser.";

function readData(): AtlasData {
  const source = document.getElementById('atlas-data')?.textContent;
  if (!source) throw new Error('This page has no embedded map. Rebuild it with the codeatlas skill.');
  const data = JSON.parse(source) as Partial<AtlasData>;
  if (!data.map || !Array.isArray(data.map.nodes)) {
    throw new Error('The embedded map is not in the expected format. Rebuild it with the codeatlas skill.');
  }
  return data as AtlasData;
}

/** Storage can throw in private windows; a value then lasts for this visit only. */
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not persisted; the page keeps the value for this visit.
  }
}

/**
 * The reader's arrangement for this map. The browser's copy is used until the
 * layout file built into the page changes, which means the boxes were moved
 * somewhere that can write the file; the file then wins.
 */
function arrangement(data: AtlasData): { layout: AtlasLayout; save(next: AtlasLayout): void } {
  const key = `${LAYOUT_KEY}:${data.root ?? ''}`;
  const fromFile = parseLayout(data.layout);
  const fileMark = JSON.stringify(fromFile);
  let layout = fromFile;
  try {
    const kept = JSON.parse(stored(key) ?? 'null') as { file?: unknown; layout?: unknown } | null;
    if (kept?.file === fileMark) layout = parseLayout(kept.layout);
  } catch {
    // An unreadable saved arrangement is the same as none.
  }
  return { layout, save: (next) => store(key, JSON.stringify({ file: fileMark, layout: next })) };
}

function editorPicker(): { element: HTMLElement; scheme(): string; label(): string } {
  const select = h('select', { id: 'atlas-editor' });
  for (const editor of EDITORS) select.appendChild(h('option', { value: editor.scheme }, editor.label));
  const kept = stored(EDITOR_KEY);
  select.value = isEditorScheme(kept) ? kept : DEFAULT_EDITOR;
  select.addEventListener('change', () => store(EDITOR_KEY, select.value));
  const element = h('label', { class: 'atlas-editor', for: 'atlas-editor' }, 'Open code in ', select);
  return {
    element,
    scheme: () => select.value,
    label: () => EDITORS.find((editor) => editor.scheme === select.value)?.label ?? select.value,
  };
}

/** Hand `anchor` to the chosen editor, and say what to try if nothing takes it. */
function openInEditor(data: AtlasData, picker: ReturnType<typeof editorPicker>, toast: Toast, anchor: Anchor): void {
  const url = editorUrl(picker.scheme(), data.root ?? '', anchor);
  if (!url) return;
  if (isEmbeddedBrowser(navigator.userAgent)) {
    toast.show(EMBEDDED_MESSAGE);
    return;
  }
  let wasTaken = false;
  const taken = (): void => {
    wasTaken = true;
  };
  window.addEventListener('blur', taken, { once: true });
  setTimeout(() => {
    window.removeEventListener('blur', taken);
    if (wasTaken || document.visibilityState !== 'visible') return;
    toast.show(
      `Asked ${picker.label()} to open ${anchorLabel(anchor)}. If nothing opened, pick the editor you use under “Open code in”, and check it is installed.`,
    );
  }, HANDOFF_MS);
  location.href = url;
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
  const toast = createToast();
  const kept = arrangement(data);
  let layout = kept.layout;
  const controller = mount(
    container,
    { ...data, layout },
    {
      toolbar: picker.element,
      openAnchor: (anchor) => openInEditor(data, picker, toast, anchor),
      onNavigate: (nodeId) => {
        const hash = nodeId === null ? '' : HASH_PREFIX + encodeURIComponent(nodeId);
        if (hash !== location.hash) history.pushState(null, '', hash || location.pathname + location.search);
      },
      savePositions: (viewId, positions) => {
        layout = withPositions(layout, viewId, positions);
        kept.save(layout);
      },
    },
  );
  document.body.appendChild(toast.element);
  if (isEmbeddedBrowser(navigator.userAgent)) toast.show(EMBEDDED_MESSAGE);

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
