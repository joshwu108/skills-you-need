/**
 * Entry point for the VS Code webview.
 *
 * The extension owns the map and sends it by message; the webview never
 * reads files. Code links go back to the extension as messages, which
 * reveals the range in a real editor.
 */

import { mount } from './app';
import type { Controller } from './app';
import { h } from './dom';
import type { Host } from './host';
import type { FromWebview, ToWebview } from './protocol';

declare function acquireVsCodeApi(): { postMessage(message: FromWebview): void };

const vscode = acquireVsCodeApi();
const container = document.getElementById('atlas');
let controller: Controller | undefined;

/** VS Code sets a theme class on the body; the viewer's tokens key off data-theme. */
function applyTheme(): void {
  const classes = document.body.classList;
  const isDark = classes.contains('vscode-dark') || (classes.contains('vscode-high-contrast') && !classes.contains('vscode-high-contrast-light'));
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
}

function showError(message: string): void {
  controller?.destroy();
  controller = undefined;
  vscode.postMessage({ type: 'navigate', nodeId: null });
  container?.replaceChildren(h('p', { class: 'atlas-fatal', role: 'alert' }, message));
}

function receive(message: ToWebview): void {
  if (!container) return;
  if (message.type === 'error') {
    showError(message.message);
  } else if (message.type === 'focus') {
    controller?.focus(message.nodeId);
  } else if (message.type === 'map') {
    showMap(container, message);
  }
}

function host(): Host {
  return {
    openAnchor: (anchor) => vscode.postMessage({ type: 'open', anchor }),
    revealAnchor: (anchor) => vscode.postMessage({ type: 'reveal', anchor }),
    onNavigate: (nodeId) => vscode.postMessage({ type: 'navigate', nodeId }),
    savePositions: (view, positions) => vscode.postMessage({ type: 'positions', view, positions }),
    saveNode: (nodeId, changes) => vscode.postMessage({ type: 'edit', nodeId, changes }),
    addNote: (parent) => vscode.postMessage({ type: 'addNote', parent }),
    removeNote: (nodeId) => vscode.postMessage({ type: 'removeNote', nodeId }),
    addLink: (from, to, label) => vscode.postMessage({ type: 'addLink', from, to, label }),
    removeLink: (from, to) => vscode.postMessage({ type: 'removeLink', from, to }),
  };
}

/**
 * A changed map is shown in the running viewer, so a reload (the reader's
 * own save, or Claude rewriting the map) does not cost them their place,
 * their walkthrough or a half-written edit.
 */
function showMap(target: HTMLElement, message: Extract<ToWebview, { type: 'map' }>): void {
  if (controller) controller.update(message.data);
  else controller = mount(target, message.data, host());
  if (message.focus !== undefined) controller.focus(message.focus);
  if (message.edit) controller.edit();
  // Always report where the reader ended up: the requested node may be gone.
  vscode.postMessage({ type: 'navigate', nodeId: controller.focused() });
}

applyTheme();
new MutationObserver(applyTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });
window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
  try {
    receive(event.data);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
});
vscode.postMessage({ type: 'ready' });
