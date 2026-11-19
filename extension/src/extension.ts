/**
 * CodeAtlas for VS Code.
 *
 * Reads the map the CodeAtlas skill writes to `.codeatlas/map.json` and
 * connects it to the editor in both directions: from a line of code to its
 * explanation and place in the flow, and from a box in the flow to its code.
 */

import * as vscode from 'vscode';

import { AtlasPanel, NEW_NOTE_TITLE } from './atlasPanel';
import { registerCommands } from './commands';
import { AtlasHoverProvider, AtlasLensProvider, GutterMarks } from './editorMarks';
import { followCursor } from './followCursor';
import { Locator } from './locator';
import { Stores } from './mapStore';
import { statusBar } from './statusBar';

const HAS_MAP_CONTEXT = 'codeatlas.hasMap';

/** What other extensions and the integration tests can ask of this one. */
export interface CodeAtlasApi {
  /** Folder URIs that currently have a readable map. */
  foldersWithMaps(): string[];
  /** The node shown in a folder's open panel; undefined when no panel is open. */
  focusedNode(folderUri: string): string | null | undefined;
  /**
   * What the diagram does when a reader edits a box: write the change to the
   * folder's map file. Resolves to the reason when the edit is refused.
   */
  editNode(folderUri: string, nodeId: string, changes: unknown): Promise<string | undefined>;
  /** What "Add note" in the diagram does. Resolves to the new note's id, or the reason it was refused. */
  addNote(folderUri: string, parent: string | null): Promise<{ id: string } | { error: string }>;
  /** What drawing or removing an arrow in the diagram does. */
  addLink(folderUri: string, from: string, to: string, label: string): Promise<string | undefined>;
  removeLink(folderUri: string, from: string, to: string): Promise<string | undefined>;
  /** What the diagram does when a reader drags boxes: remember one view's positions. */
  savePositions(folderUri: string, viewId: string | null, positions: unknown): Promise<void>;
}

const NO_FOLDER = 'That folder is not open in this window.';

export async function activate(context: vscode.ExtensionContext): Promise<CodeAtlasApi> {
  const log = vscode.window.createOutputChannel('CodeAtlas', { log: true });
  const stores = new Stores(log);
  const locator = new Locator(stores);
  const lenses = new AtlasLensProvider(locator);
  const gutter = new GutterMarks(context, locator);

  const refreshMarks = (): void => {
    void vscode.commands.executeCommand('setContext', HAS_MAP_CONTEXT, stores.withMaps().length > 0);
    lenses.refresh();
    gutter.refresh();
  };

  const anyFile: vscode.DocumentSelector = [{ scheme: 'file' }, { scheme: 'vscode-remote' }];
  context.subscriptions.push(
    log,
    stores,
    locator,
    lenses,
    gutter,
    vscode.languages.registerCodeLensProvider(anyFile, lenses),
    vscode.languages.registerHoverProvider(anyFile, new AtlasHoverProvider(locator)),
    ...registerCommands(context, stores, locator),
    followCursor(locator),
    stores.onDidChange((store) => {
      // A folder removed from the workspace takes its panel with it.
      if (!stores.all().includes(store)) AtlasPanel.for(store)?.dispose();
      refreshMarks();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('codeatlas')) refreshMarks();
    }),
  );

  await stores.start();
  context.subscriptions.push(statusBar(stores));
  refreshMarks();

  return {
    foldersWithMaps: () => stores.withMaps().map((store) => store.folder.uri.toString()),
    focusedNode: (folderUri) => {
      const store = stores.byFolder(folderUri);
      return store ? AtlasPanel.for(store)?.focused : undefined;
    },
    editNode: async (folderUri, nodeId, changes) => {
      const store = stores.byFolder(folderUri);
      return store ? store.editNode(nodeId, changes) : NO_FOLDER;
    },
    addNote: async (folderUri, parent) =>
      stores.byFolder(folderUri)?.addNote({ parent, title: NEW_NOTE_TITLE }) ?? { error: NO_FOLDER },
    addLink: async (folderUri, from, to, label) => stores.byFolder(folderUri)?.addLink(from, to, label) ?? NO_FOLDER,
    removeLink: async (folderUri, from, to) => stores.byFolder(folderUri)?.removeLink(from, to) ?? NO_FOLDER,
    savePositions: async (folderUri, viewId, positions) => stores.byFolder(folderUri)?.savePositions(viewId, positions),
  };
}

export function deactivate(): void {
  // Everything is released through context.subscriptions.
}
