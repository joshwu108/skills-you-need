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
    // Keep the reader's place across a reload unless the extension asks for a node.
    const focus = message.focus !== undefined ? message.focus : (controller?.focused() ?? null);
    controller?.destroy();
    // Cleared first: if mounting throws, no destroyed controller is left behind.
    controller = undefined;
    controller = mount(container, message.data, {
      openAnchor: (anchor) => vscode.postMessage({ type: 'open', anchor }),
      onNavigate: (nodeId) => vscode.postMessage({ type: 'navigate', nodeId }),
    });
    controller.focus(focus);
    // Always report where the reader ended up: the requested node may be gone.
    vscode.postMessage({ type: 'navigate', nodeId: controller.focused() });
  }
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
