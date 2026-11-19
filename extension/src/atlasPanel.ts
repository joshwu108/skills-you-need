/**
 * The diagram, hosted in a webview beside the code. One panel per workspace
 * folder.
 *
 * The webview runs the shared viewer bundle and never touches the file
 * system: the extension sends it the map and it sends back requests to open
 * code, to remember where a box was dragged, or to save an edited
 * explanation. Its content security policy allows only the bundled script (by
 * nonce) and stylesheet.
 */

import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';

import type { FromWebview, ToWebview } from '../../packages/viewer/src/protocol';
import { parseAnchor } from './core/parseMap';
import type { MapStore } from './mapStore';
import { revealAnchor } from './reveal';

const VIEW_TYPE = 'codeatlas.map';
export const NEW_NOTE_TITLE = 'New note';
const NO_MAP_MESSAGE =
  'This folder has no map yet. In Claude Code, run the codeatlas skill (for example "/codeatlas:codeatlas map") to create one.';

export class AtlasPanel implements vscode.Disposable {
  private static readonly panels = new Map<string, AtlasPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly subscriptions: vscode.Disposable[] = [];
  private isReady = false;
  /** A focus request that arrived before the webview finished loading. */
  private pendingFocus: string | null | undefined;
  /** Open the edit form on the node of the pending focus request. */
  private pendingEdit = false;
  private focusedNode: string | null = null;

  static for(store: MapStore): AtlasPanel | undefined {
    return AtlasPanel.panels.get(store.folder.uri.toString());
  }

  /**
   * Open (or bring forward) the folder's panel, optionally focused on a node
   * and, with `edit`, with that node's edit form open.
   */
  static show(context: vscode.ExtensionContext, store: MapStore, nodeId?: string | null, edit = false): AtlasPanel {
    const existing = AtlasPanel.for(store);
    if (existing) {
      // Editing needs the keyboard in the panel; otherwise it stays in the code.
      existing.panel.reveal(undefined, !edit);
      if (nodeId !== undefined) existing.focus(nodeId, edit);
      return existing;
    }
    const created = new AtlasPanel(context, store, nodeId);
    created.pendingEdit = edit;
    AtlasPanel.panels.set(store.folder.uri.toString(), created);
    return created;
  }

  private constructor(
    context: vscode.ExtensionContext,
    private readonly store: MapStore,
    nodeId: string | null | undefined,
  ) {
    const media = vscode.Uri.joinPath(context.extensionUri, 'media');
    this.pendingFocus = nodeId;
    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      `CodeAtlas: ${store.folder.name}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media] },
    );
    this.panel.iconPath = vscode.Uri.joinPath(media, 'gutter.svg');
    this.panel.webview.html = this.html(media);

    this.subscriptions.push(
      this.panel.webview.onDidReceiveMessage((message: unknown) => void this.receive(message)),
      this.panel.onDidDispose(() => this.dispose()),
      store.onDidChange(() => this.sendMap()),
    );
  }

  get isVisible(): boolean {
    return this.panel.visible;
  }

  /** The node the reader is looking at, or null at the top level. */
  get focused(): string | null {
    return this.focusedNode;
  }

  focus(nodeId: string | null, edit = false): void {
    if (!edit && this.isReady && this.store.map) {
      this.post({ type: 'focus', nodeId });
      return;
    }
    this.pendingFocus = nodeId;
    this.pendingEdit = edit;
    this.sendMap();
  }

  private post(message: ToWebview): void {
    void this.panel.webview.postMessage(message);
  }

  /** Send the current map, or the reason there is none. */
  private sendMap(): void {
    if (!this.isReady) return;
    const { map, error } = this.store;
    if (!map) {
      // A focus request waiting for the map stays pending until one arrives.
      this.focusedNode = null;
      this.post({ type: 'error', message: error ?? NO_MAP_MESSAGE });
      return;
    }
    // A request for a node this map does not have is dropped, not kept: it
    // must not take the reader somewhere unasked if the id appears later.
    const isKnown = typeof this.pendingFocus !== 'string' || this.store.index?.byId.has(this.pendingFocus) === true;
    const focus = isKnown ? this.pendingFocus : undefined;
    const edit = focus !== undefined && this.pendingEdit;
    this.pendingFocus = undefined;
    this.pendingEdit = false;
    this.post({
      type: 'map',
      data: { map, layout: this.store.layout },
      ...(focus !== undefined ? { focus } : {}),
      ...(edit ? { edit } : {}),
    });
  }

  private async receive(message: unknown): Promise<void> {
    const incoming = message as Partial<FromWebview> | null;
    if (incoming?.type === 'ready') {
      this.isReady = true;
      this.sendMap();
    } else if (incoming?.type === 'navigate') {
      this.focusedNode = typeof incoming.nodeId === 'string' ? incoming.nodeId : null;
    } else if (incoming?.type === 'open' || incoming?.type === 'reveal') {
      // Never trust the shape of a message from the webview.
      const anchor = parseAnchor(incoming.anchor);
      // A walkthrough reveals code as it goes; the keyboard stays with the diagram.
      const keepFocus = incoming.type === 'reveal';
      if (anchor) await revealAnchor(this.store, anchor, this.panel.viewColumn, keepFocus);
    } else if (incoming?.type === 'positions') {
      await this.store.savePositions(incoming.view, incoming.positions);
    } else if (incoming) {
      this.report(await this.author(incoming));
    }
  }

  /** The requests that rewrite the map. Resolves to the reason one was refused. */
  private async author(incoming: Partial<FromWebview>): Promise<string | undefined> {
    if (incoming.type === 'edit') return this.store.editNode(incoming.nodeId, incoming.changes);
    if (incoming.type === 'addLink') return this.store.addLink(incoming.from, incoming.to, incoming.label);
    if (incoming.type === 'removeLink') return this.store.removeLink(incoming.from, incoming.to);
    if (incoming.type === 'removeNote') return this.removeNote(incoming.nodeId);
    if (incoming.type !== 'addNote') return undefined;
    const added = await this.store.addNote({ parent: incoming.parent ?? null, title: NEW_NOTE_TITLE });
    if ('error' in added) return added.error;
    this.focus(added.id, true);
    return undefined;
  }

  private async removeNote(nodeId: unknown): Promise<string | undefined> {
    const node = typeof nodeId === 'string' ? this.store.index?.byId.get(nodeId) : undefined;
    // Anything that is not a note is refused by the store without asking first.
    if (node?.kind !== 'note') return this.store.removeNote(nodeId);
    const { title } = node;
    const choice = await vscode.window.showWarningMessage(
      `Delete the note "${title}"?`,
      { modal: true, detail: 'Its text and its links are removed from the map.' },
      'Delete',
    );
    return choice === 'Delete' ? this.store.removeNote(nodeId) : undefined;
  }

  private report(problem: string | undefined): void {
    if (problem) void vscode.window.showErrorMessage(`CodeAtlas: the map was not changed. ${problem}`);
  }

  private html(media: vscode.Uri): string {
    const { webview } = this.panel;
    const nonce = randomBytes(16).toString('base64');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(media, 'viewer.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(media, 'viewer.css'));
    const policy = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`,
      "form-action 'none'",
      "base-uri 'none'",
    ].join('; ');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<link rel="stylesheet" href="${style.toString()}">
<title>CodeAtlas</title>
</head>
<body>
<main id="atlas"></main>
<script nonce="${nonce}" src="${script.toString()}"></script>
</body>
</html>`;
  }

  dispose(): void {
    AtlasPanel.panels.delete(this.store.folder.uri.toString());
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
    this.panel.dispose();
  }
}
