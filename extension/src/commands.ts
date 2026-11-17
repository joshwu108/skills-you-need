/** The extension's commands and the logic behind each. */

import * as vscode from 'vscode';

import { AtlasPanel } from './atlasPanel';
import { narrowestAt } from './core/locate';
import { SHOW_NODE_COMMAND } from './editorMarks';
import type { Locator } from './locator';
import type { MapStore, Stores } from './mapStore';

/** The folder to act on: the active editor's if it has a map, else the only one, else ask. */
async function pickStore(stores: Stores): Promise<MapStore | undefined> {
  const active = vscode.window.activeTextEditor;
  const fromEditor = active ? stores.forUri(active.document.uri) : undefined;
  if (fromEditor?.map) return fromEditor;

  const candidates = stores.withMaps();
  if (candidates.length <= 1) return candidates[0] ?? fromEditor ?? stores.all()[0];
  const picked = await vscode.window.showQuickPick(
    candidates.map((store) => ({ label: store.folder.name, description: store.map?.title, store })),
    { placeHolder: "Which folder's map?" },
  );
  return picked?.store;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  stores: Stores,
  locator: Locator,
): vscode.Disposable[] {
  // Arguments come from code lenses and hover links, so they are checked.
  const showNode = (folderUri: unknown, nodeId: unknown): void => {
    const store = typeof folderUri === 'string' ? stores.byFolder(folderUri) : undefined;
    if (!store || typeof nodeId !== 'string' || !store.index?.byId.has(nodeId)) {
      void vscode.window.showWarningMessage('CodeAtlas: that part of the map no longer exists.');
      return;
    }
    AtlasPanel.show(context, store, nodeId);
  };

  const openMap = async (): Promise<void> => {
    const store = await pickStore(stores);
    if (!store) {
      void vscode.window.showInformationMessage('CodeAtlas: open a folder first.');
      return;
    }
    AtlasPanel.show(context, store);
  };

  const explainHere = (): void => {
    const editor = vscode.window.activeTextEditor;
    const nodes = editor ? locator.nodesIn(editor.document) : undefined;
    const located = editor && nodes ? narrowestAt(nodes.located, editor.selection.active.line + 1) : undefined;
    if (!nodes || !located) {
      void vscode.window.showInformationMessage(
        'CodeAtlas: this code is not in the map yet. Ask Claude to explain it with the codeatlas skill.',
      );
      return;
    }
    AtlasPanel.show(context, nodes.store, located.node.id);
  };

  return [
    vscode.commands.registerCommand('codeatlas.openMap', openMap),
    vscode.commands.registerCommand('codeatlas.explainHere', explainHere),
    vscode.commands.registerCommand(SHOW_NODE_COMMAND, showNode),
  ];
}
