/**
 * CodeAtlas for VS Code.
 *
 * Reads the map the CodeAtlas skill writes to `.codeatlas/map.json` and
 * connects it to the editor in both directions: from a line of code to its
 * explanation and place in the flow, and from a box in the flow to its code.
 */

import * as vscode from 'vscode';

import { AtlasPanel } from './atlasPanel';
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
}

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
  };
}

export function deactivate(): void {
  // Everything is released through context.subscriptions.
}
