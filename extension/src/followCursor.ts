/**
 * While a folder's map is on screen, moving the cursor shows the node for
 * the code it lands in.
 *
 * It stays out of the way in three cases: the panel is hidden, the cursor
 * moved because a diagram box was just opened in the editor, or the reader is
 * already on that node or inside its flow. The last rule stops the map from
 * backing out of a sub-flow the reader opened on purpose.
 */

import * as vscode from 'vscode';

import { parentIdOf } from '../../packages/viewer/src/graph';
import { AtlasPanel } from './atlasPanel';
import { narrowestAt } from './core/locate';
import type { Locator } from './locator';
import { wasJustRevealed } from './reveal';

const FOLLOW_DELAY_MS = 150;

function followNow(locator: Locator, editor: vscode.TextEditor): void {
  if (wasJustRevealed(editor.document)) return;
  const nodes = locator.nodesIn(editor.document);
  const panel = nodes ? AtlasPanel.for(nodes.store) : undefined;
  const index = nodes?.store.index;
  if (!nodes || !index || !panel?.isVisible) return;

  const located = narrowestAt(nodes.located, editor.selection.active.line + 1);
  if (!located) return;
  const { focused } = panel;
  if (focused === located.node.id) return;
  if (focused !== null && parentIdOf(index, focused) === located.node.id) return;
  panel.focus(located.node.id);
}

export function followCursor(locator: Locator): vscode.Disposable {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const subscription = vscode.window.onDidChangeTextEditorSelection((event) => {
    if (timer) clearTimeout(timer);
    if (!vscode.workspace.getConfiguration('codeatlas').get<boolean>('followCursor', true)) return;
    const { scheme } = event.textEditor.document.uri;
    if (scheme !== 'file' && scheme !== 'vscode-remote') return;
    timer = setTimeout(() => followNow(locator, event.textEditor), FOLLOW_DELAY_MS);
  });
  return {
    dispose: () => {
      if (timer) clearTimeout(timer);
      subscription.dispose();
    },
  };
}
