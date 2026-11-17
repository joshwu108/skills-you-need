/**
 * The diagram, hosted in a webview beside the code. One panel per workspace
 * folder.
 *
 * The webview runs the shared viewer bundle and never touches the file
 * system: the extension sends it the map and it sends back requests to open
 * code. Its content security policy allows only the bundled script (by
 * nonce) and stylesheet.
 */

import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';

import type { FromWebview, ToWebview } from '../../packages/viewer/src/protocol';
import { parseAnchor } from './core/parseMap';
import type { MapStore } from './mapStore';
import { revealAnchor } from './reveal';

const VIEW_TYPE = 'codeatlas.map';
const NO_MAP_MESSAGE =
  'This folder has no map yet. In Claude Code, run the codeatlas skill (for example "/codeatlas:codeatlas map") to create one.';

export class AtlasPanel implements vscode.Disposable {
  private static readonly panels = new Map<string, AtlasPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly subscriptions: vscode.Disposable[] = [];
  private isReady = false;
  /** A focus request that arrived before the webview finished loading. */
  private pendingFocus: string | null | undefined;
  private focusedNode: string | null = null;

  static for(store: MapStore): AtlasPanel | undefined {
    return AtlasPanel.panels.get(store.folder.uri.toString());
  }

  /** Open (or bring forward) the folder's panel, optionally focused on a node. */
  static show(context: vscode.ExtensionContext, store: MapStore, nodeId?: string | null): AtlasPanel {
    const existing = AtlasPanel.for(store);
    if (existing) {
      existing.panel.reveal(undefined, true);
      if (nodeId !== undefined) existing.focus(nodeId);
      return existing;
    }
    const created = new AtlasPanel(context, store, nodeId);
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

  focus(nodeId: string | null): void {
    if (!this.isReady || !this.store.map) {
      this.pendingFocus = nodeId;
      return;
    }
    this.post({ type: 'focus', nodeId });
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
    const focus = this.pendingFocus;
    this.pendingFocus = undefined;
    this.post({ type: 'map', data: { map }, ...(focus !== undefined ? { focus } : {}) });
  }

  private async receive(message: unknown): Promise<void> {
    const incoming = message as Partial<FromWebview> | null;
    if (incoming?.type === 'ready') {
      this.isReady = true;
      this.sendMap();
    } else if (incoming?.type === 'navigate') {
      this.focusedNode = typeof incoming.nodeId === 'string' ? incoming.nodeId : null;
    } else if (incoming?.type === 'open') {
      // Never trust the shape of a message from the webview.
      const anchor = parseAnchor(incoming.anchor);
      if (anchor) await revealAnchor(this.store, anchor, this.panel.viewColumn);
    }
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
