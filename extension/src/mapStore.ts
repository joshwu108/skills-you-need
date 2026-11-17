/**
 * One workspace folder's map, kept in step with `.codeatlas/map.json`.
 *
 * The extension never writes the map; Claude and the skill's tools do. Each
 * successful or failed load bumps `generation`, which callers use to drop
 * anything they derived from the previous contents.
 */

import * as vscode from 'vscode';

import { buildIndex } from '../../packages/viewer/src/graph';
import type { AtlasIndex } from '../../packages/viewer/src/graph';
import type { AtlasMap } from '../../packages/viewer/src/types';
import { isSafeRelativePath, parseMap } from './core/parseMap';

export const MAP_PATH = '.codeatlas/map.json';

export class MapStore implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly watcher: vscode.FileSystemWatcher;
  private current: { map: AtlasMap; index: AtlasIndex } | undefined;
  private problem: string | undefined;
  private loads = 0;
  private attempts = 0;

  readonly onDidChange = this.changed.event;

  constructor(
    readonly folder: vscode.WorkspaceFolder,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, MAP_PATH));
    const reload = (): void => void this.load();
    this.watcher.onDidCreate(reload);
    this.watcher.onDidChange(reload);
    this.watcher.onDidDelete(reload);
  }

  get mapUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.folder.uri, MAP_PATH);
  }

  get map(): AtlasMap | undefined {
    return this.current?.map;
  }

  get index(): AtlasIndex | undefined {
    return this.current?.index;
  }

  /** Why the map could not be read, when a file exists but is unusable. */
  get error(): string | undefined {
    return this.problem;
  }

  get generation(): number {
    return this.loads;
  }

  async load(): Promise<void> {
    // Create and change events can arrive together. Only the read that was
    // started last may publish, or an older, partial read could win.
    const attempt = (this.attempts += 1);
    let text: string | undefined;
    try {
      text = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(this.mapUri));
    } catch (error) {
      // No map in this folder is the normal state, not a fault.
      const isMissing = error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
      if (attempt !== this.attempts) return;
      this.problem = undefined;
      if (!isMissing) {
        this.problem = `Could not read ${MAP_PATH}: ${String(error)}`;
        this.log.error(this.problem);
      }
    }
    if (attempt !== this.attempts) return;

    this.current = undefined;
    if (text !== undefined) {
      const result = parseMap(text);
      if (result.ok) {
        this.current = { map: result.map, index: buildIndex(result.map) };
        this.problem = undefined;
        if (result.dropped > 0) {
          this.log.warn(
            `${this.folder.name}: ignored ${result.dropped} malformed entries in ${MAP_PATH}. ` +
              'Run the codeatlas skill\'s "validate" command to see them.',
          );
        }
      } else {
        this.problem = result.error;
        this.log.error(`${this.folder.name}: ${result.error}`);
      }
    }
    this.loads += 1;
    this.changed.fire();
  }

  /** The map's name for a file: its path relative to the folder, with forward slashes. */
  relativePath(uri: vscode.Uri): string | undefined {
    const root = this.folder.uri.path.endsWith('/') ? this.folder.uri.path : `${this.folder.uri.path}/`;
    if (uri.scheme !== this.folder.uri.scheme || uri.authority !== this.folder.uri.authority) return undefined;
    return uri.path.startsWith(root) ? uri.path.slice(root.length) : undefined;
  }

  /** The file an anchor points at, or undefined for a path that leaves the folder. */
  uriFor(file: string): vscode.Uri | undefined {
    return isSafeRelativePath(file) ? vscode.Uri.joinPath(this.folder.uri, ...file.split('/')) : undefined;
  }

  dispose(): void {
    this.watcher.dispose();
    this.changed.dispose();
  }
}

/** The stores for every open workspace folder. */
export class Stores implements vscode.Disposable {
  private readonly stores = new Map<string, MapStore>();
  private readonly changed = new vscode.EventEmitter<MapStore>();
  private readonly subscription: vscode.Disposable;

  /** Fires whenever any folder's map is loaded, changed or removed. */
  readonly onDidChange = this.changed.event;

  constructor(private readonly log: vscode.LogOutputChannel) {
    this.subscription = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      for (const folder of event.removed) this.remove(folder);
      for (const folder of event.added) void this.add(folder);
    });
  }

  async start(): Promise<void> {
    await Promise.all((vscode.workspace.workspaceFolders ?? []).map((folder) => this.add(folder)));
  }

  all(): MapStore[] {
    return [...this.stores.values()];
  }

  withMaps(): MapStore[] {
    return this.all().filter((store) => store.map !== undefined);
  }

  byFolder(folderUri: string): MapStore | undefined {
    return this.stores.get(folderUri);
  }

  forUri(uri: vscode.Uri): MapStore | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder ? this.stores.get(folder.uri.toString()) : undefined;
  }

  private async add(folder: vscode.WorkspaceFolder): Promise<void> {
    const key = folder.uri.toString();
    if (this.stores.has(key)) return;
    const store = new MapStore(folder, this.log);
    this.stores.set(key, store);
    store.onDidChange(() => this.changed.fire(store));
    await store.load();
  }

  private remove(folder: vscode.WorkspaceFolder): void {
    const key = folder.uri.toString();
    const store = this.stores.get(key);
    if (!store) return;
    this.stores.delete(key);
    store.dispose();
    this.changed.fire(store);
  }

  dispose(): void {
    this.subscription.dispose();
    for (const store of this.stores.values()) store.dispose();
    this.stores.clear();
    this.changed.dispose();
  }
}
