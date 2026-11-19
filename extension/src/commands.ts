/** The extension's commands and the logic behind each. */

import * as vscode from 'vscode';

import { AtlasPanel } from './atlasPanel';
import { narrowestAt } from './core/locate';
import { hashLines } from './core/resolve';
import { documentLines } from './locator';
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

/**
 * Start a note about the selected lines (the cursor's line when nothing is
 * selected). The note is placed beside the most specific box that covers
 * those lines, with an arrow to it, and opened for writing.
 */
async function addNoteForSelection(context: vscode.ExtensionContext, stores: Stores, locator: Locator): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const store = editor ? stores.forUri(editor.document.uri) : undefined;
  const file = editor && store ? store.relativePath(editor.document.uri) : undefined;
  if (!editor || !store?.index || file === undefined) {
    void vscode.window.showInformationMessage(
      'CodeAtlas: notes are added to a map. Open a file in a folder that has one, or ask Claude to create it with the codeatlas skill.',
    );
    return;
  }
  const { start, end } = editor.selection;
  // A selection ending at the start of a line does not include that line.
  const lastLine = end.line > start.line && end.character === 0 ? end.line - 1 : end.line;
  const startLine = start.line + 1;
  const endLine = lastLine + 1;
  const about = narrowestAt(locator.nodesIn(editor.document)?.located ?? [], startLine)?.node;
  const added = await store.addNote({
    parent: about ? about.parent : null,
    title: `Note on ${file.split('/').pop() ?? file}:${startLine}`,
    anchor: { file, startLine, endLine, hash: hashLines(documentLines(editor.document).slice(startLine - 1, endLine)) },
    about: about?.id,
  });
  if ('error' in added) {
    void vscode.window.showErrorMessage(`CodeAtlas: the note was not added. ${added.error}`);
    return;
  }
  AtlasPanel.show(context, store, added.id, true);
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

  // Run from a file's context menu, the argument is that file's URI.
  const openMap = async (resource?: unknown): Promise<void> => {
    const fromResource = resource instanceof vscode.Uri ? stores.forUri(resource) : undefined;
    const store = fromResource ?? (await pickStore(stores));
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
    vscode.commands.registerCommand('codeatlas.addNote', () => addNoteForSelection(context, stores, locator)),
    vscode.commands.registerCommand(SHOW_NODE_COMMAND, showNode),
  ];
}
