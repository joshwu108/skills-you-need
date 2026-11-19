/**
 * One workspace folder's map, kept in step with `.codeatlas/map.json`.
 *
 * Claude and the skill's tools write the map. The extension writes two
 * things only, both at the reader's request from the diagram: the text of a
 * box they edited, and where they dragged boxes to (`layout.json`). Each
 * successful or failed load bumps `generation`, which callers use to drop
 * anything they derived from the previous contents.
 */

import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';

import { buildIndex } from '../../packages/viewer/src/graph';
import type { AtlasIndex } from '../../packages/viewer/src/graph';
import { EMPTY_LAYOUT, parseLayout, parsePositions, withPositions } from '../../packages/viewer/src/positions';
import type { AtlasLayout, AtlasMap } from '../../packages/viewer/src/types';
import { addLink, addNote, removeLink, removeNote } from './core/authorMap';
import type { NoteRequest } from './core/authorMap';
import { applyNodeEdit } from './core/editMap';
import type { EditResult } from './core/editMap';
import { isSafeRelativePath, parseMap } from './core/parseMap';

export const MAP_DIR = '.codeatlas';
export const MAP_PATH = `${MAP_DIR}/map.json`;
export const LAYOUT_PATH = `${MAP_DIR}/layout.json`;

/** A layout file larger than this is not one the viewer wrote. */
const MAX_LAYOUT_BYTES = 1_000_000;
const UNTRUSTED = 'This folder is open in Restricted Mode, where CodeAtlas does not write files. Trust the folder to save changes.';

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

function isMissing(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}

/**
 * A cloned repository can commit `.codeatlas`, or a file in it, as a link to
 * any file the user can write. Writing through it would overwrite that file,
 * so a link anywhere on the way is refused.
 */
async function isLink(uri: vscode.Uri): Promise<boolean> {
  try {
    return ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.SymbolicLink) !== 0;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

export class MapStore implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly watcher: vscode.FileSystemWatcher;
  private current: { map: AtlasMap; index: AtlasIndex } | undefined;
  private problem: string | undefined;
  private placed: AtlasLayout = EMPTY_LAYOUT;
  /** Layout writes run one at a time, so the last drag is the one on disk. */
  private layoutWrites: Promise<void> = Promise.resolve();
  /** Bumped by each drag, so a reload cannot put back a layout it read before the drag. */
  private layoutRevision = 0;
  /** Map rewrites run one at a time: each reads what the one before wrote. */
  private mapWrites: Promise<unknown> = Promise.resolve();
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

  private get layoutUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.folder.uri, LAYOUT_PATH);
  }

  /** Where the reader has dragged boxes to. */
  get layout(): AtlasLayout {
    return this.placed;
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
      text = decoder.decode(await vscode.workspace.fs.readFile(this.mapUri));
    } catch (error) {
      if (attempt !== this.attempts) return;
      this.problem = undefined;
      // No map in this folder is the normal state, not a fault.
      if (!isMissing(error)) {
        this.problem = `Could not read ${MAP_PATH}: ${String(error)}`;
        this.log.error(this.problem);
      }
    }
    const revision = this.layoutRevision;
    const placed = await this.readLayout();
    if (attempt !== this.attempts) return;

    if (revision === this.layoutRevision) this.placed = placed;
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

  /**
   * An unreadable or missing layout file is the same as no hand-placed boxes.
   * Only a regular file of plausible size is read: the path could be
   * committed as a link to a device or to something enormous.
   */
  private async readLayout(): Promise<AtlasLayout> {
    try {
      // A write in progress must land first, or this would read the file it replaces.
      await this.layoutWrites;
      const status = await vscode.workspace.fs.stat(this.layoutUri);
      if (status.type !== vscode.FileType.File || status.size > MAX_LAYOUT_BYTES) {
        this.log.warn(`${this.folder.name}: ignored ${LAYOUT_PATH}: not a regular file of reasonable size`);
        return EMPTY_LAYOUT;
      }
      return parseLayout(JSON.parse(decoder.decode(await vscode.workspace.fs.readFile(this.layoutUri))));
    } catch (error) {
      if (!isMissing(error)) this.log.warn(`${this.folder.name}: ignored ${LAYOUT_PATH}: ${String(error)}`);
      return EMPTY_LAYOUT;
    }
  }

  private async refuseLinks(target: vscode.Uri, name: string): Promise<void> {
    const directory = vscode.Uri.joinPath(this.folder.uri, MAP_DIR);
    if ((await isLink(directory)) || (await isLink(target))) {
      throw new Error(`${name} is a symbolic link, so it was not written.`);
    }
  }

  /**
   * Replace a file in `.codeatlas` by writing a sibling and renaming it over
   * the target. A rename replaces the path itself, so even a link swapped in
   * after the check above is replaced, not written through.
   */
  private async replaceFile(target: vscode.Uri, name: string, text: string): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new Error(UNTRUSTED);
    await this.refuseLinks(target, name);
    const temporary = target.with({ path: `${target.path}.${randomBytes(6).toString('hex')}.tmp` });
    try {
      await vscode.workspace.fs.writeFile(temporary, encoder.encode(text));
      await vscode.workspace.fs.rename(temporary, target, { overwrite: true });
    } catch (error) {
      await vscode.workspace.fs.delete(temporary).then(undefined, () => undefined);
      throw error;
    }
  }

  /**
   * Remember where the reader put the boxes of one view (null is the top
   * level). The request comes from the webview: the view and every box must
   * be nodes of the current map, so what is stored is bounded by the map.
   */
  savePositions(viewId: unknown, positions: unknown): Promise<void> {
    const byId = this.current?.index.byId;
    if (!byId || (viewId !== null && (typeof viewId !== 'string' || !byId.has(viewId)))) return Promise.resolve();
    const known = Object.entries(parsePositions(positions)).filter(([nodeId]) => byId.has(nodeId));
    this.placed = withPositions(this.placed, viewId, Object.fromEntries(known));
    this.layoutRevision += 1;
    const write = (): Promise<void> =>
      this.replaceFile(this.layoutUri, LAYOUT_PATH, `${JSON.stringify(this.placed, null, 2)}\n`);
    this.layoutWrites = this.layoutWrites.then(write).catch((error: unknown) => {
      this.log.error(`${this.folder.name}: could not save ${LAYOUT_PATH}: ${String(error)}`);
      const reason = error instanceof Error ? error.message : String(error);
      void vscode.window.showWarningMessage(`CodeAtlas: the new positions were not saved. ${reason}`);
    });
    return this.layoutWrites;
  }

  /**
   * Rewrite the map file with `change`, which gets the file's text. Resolves
   * to the reason when the change was refused or could not be written; the
   * file is then untouched. On success the map is reloaded before this
   * resolves, so the caller can show what it just added.
   */
  private rewrite(change: (text: string) => EditResult): Promise<string | undefined> {
    const run = async (): Promise<string | undefined> => {
      const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === this.mapUri.toString());
      if (open?.isDirty) return `${MAP_PATH} has unsaved changes in an editor. Save or revert it first.`;
      try {
        const result = change(decoder.decode(await vscode.workspace.fs.readFile(this.mapUri)));
        if (!result.ok) return result.error;
        await this.replaceFile(this.mapUri, MAP_PATH, result.text);
        await this.load();
        return undefined;
      } catch (error) {
        this.log.error(`${this.folder.name}: could not change ${MAP_PATH}: ${String(error)}`);
        return isMissing(error) ? 'This folder has no map yet.' : error instanceof Error ? error.message : String(error);
      }
    };
    const next = this.mapWrites.then(run, run);
    this.mapWrites = next;
    return next;
  }

  /** Write a reader's edit of one box (name, kind, summary, explanation). */
  editNode(nodeId: unknown, changes: unknown): Promise<string | undefined> {
    return this.rewrite((text) => applyNodeEdit(text, nodeId, changes));
  }

  /** Add a note box. Resolves to the new node's id, or to the reason it was not added. */
  async addNote(request: NoteRequest): Promise<{ id: string } | { error: string }> {
    let id: string | undefined;
    const problem = await this.rewrite((text) => {
      const result = addNote(text, request);
      id = result.ok ? result.id : undefined;
      return result;
    });
    return problem === undefined && id !== undefined ? { id } : { error: problem ?? 'The note was not added.' };
  }

  removeNote(nodeId: unknown): Promise<string | undefined> {
    return this.rewrite((text) => removeNote(text, nodeId));
  }

  addLink(from: unknown, to: unknown, label: unknown): Promise<string | undefined> {
    return this.rewrite((text) => addLink(text, from, to, label));
  }

  removeLink(from: unknown, to: unknown): Promise<string | undefined> {
    return this.rewrite((text) => removeLink(text, from, to));
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
