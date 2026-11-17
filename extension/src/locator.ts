/**
 * Answers "which map nodes cover this document?", cached per document version.
 *
 * Resolution hashes the document's lines, so it is computed once for each
 * (document version, map generation) pair and reused by the code lenses,
 * hovers, gutter marks and cursor following.
 */

import * as vscode from 'vscode';

import { locate } from './core/locate';
import type { LocatedNode } from './core/locate';
import type { MapStore, Stores } from './mapStore';

export interface DocumentNodes {
  store: MapStore;
  located: LocatedNode[];
}

interface Entry {
  version: number;
  generation: number;
  store: MapStore;
  located: LocatedNode[];
}

export function documentLines(document: vscode.TextDocument): string[] {
  return Array.from({ length: document.lineCount }, (_, line) => document.lineAt(line).text);
}

export class Locator implements vscode.Disposable {
  private readonly cache = new Map<string, Entry>();
  private readonly subscription: vscode.Disposable;

  constructor(private readonly stores: Stores) {
    this.subscription = vscode.workspace.onDidCloseTextDocument((document) =>
      this.cache.delete(document.uri.toString()),
    );
  }

  nodesIn(document: vscode.TextDocument): DocumentNodes | undefined {
    const store = this.stores.forUri(document.uri);
    const map = store?.map;
    if (!store || !map) return undefined;

    const key = document.uri.toString();
    const cached = this.cache.get(key);
    if (cached && cached.store === store && cached.version === document.version && cached.generation === store.generation) {
      return cached;
    }
    const file = store.relativePath(document.uri);
    const located = file === undefined ? [] : locate(map, file, documentLines(document));
    const entry: Entry = { version: document.version, generation: store.generation, store, located };
    this.cache.set(key, entry);
    return entry;
  }

  dispose(): void {
    this.subscription.dispose();
    this.cache.clear();
  }
}
