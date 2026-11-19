/** Opens the code behind a map anchor and briefly highlights its range. */

import * as vscode from 'vscode';

import type { Anchor } from '../../packages/viewer/src/types';
import { resolveAnchor } from './core/resolve';
import { documentLines } from './locator';
import type { MapStore } from './mapStore';

const HIGHLIGHT_MS = 1600;
/** Selection changes this soon after a reveal are ours, not the reader's. */
const REVEAL_SETTLE_MS = 400;

let lastReveal: { document: string; at: number } | undefined;
let highlight: vscode.TextEditorDecorationType | undefined;

/** True when a selection change in `document` was caused by `revealAnchor`. */
export function wasJustRevealed(document: vscode.TextDocument): boolean {
  return (
    lastReveal !== undefined &&
    lastReveal.document === document.uri.toString() &&
    Date.now() - lastReveal.at < REVEAL_SETTLE_MS
  );
}

function columnFor(uri: vscode.Uri, avoid: vscode.ViewColumn | undefined): vscode.ViewColumn {
  const open = vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() === uri.toString());
  if (open?.viewColumn !== undefined) return open.viewColumn;
  // Keep the diagram visible: never open the code on top of it.
  return avoid === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One;
}

function flash(editor: vscode.TextEditor, range: vscode.Range): void {
  highlight?.dispose();
  const decoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.rangeHighlightForeground'),
  });
  highlight = decoration;
  editor.setDecorations(decoration, [range]);
  setTimeout(() => {
    decoration.dispose();
    if (highlight === decoration) highlight = undefined;
  }, HIGHLIGHT_MS);
}

/**
 * Show `anchor` in an editor. `avoidColumn` is where the diagram is;
 * `preserveFocus` leaves the keyboard where it was.
 * Returns false, after telling the reader why, when the code cannot be shown.
 */
export async function revealAnchor(
  store: MapStore,
  anchor: Anchor,
  avoidColumn?: vscode.ViewColumn,
  preserveFocus = false,
): Promise<boolean> {
  const uri = store.uriFor(anchor.file);
  if (!uri) {
    void vscode.window.showWarningMessage(`CodeAtlas: "${anchor.file}" is not a path inside this workspace folder.`);
    return false;
  }

  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(uri);
  } catch {
    void vscode.window.showWarningMessage(
      `CodeAtlas: ${anchor.file} could not be opened. It may have been moved or deleted; ask Claude to refresh the map.`,
    );
    return false;
  }

  const resolved = resolveAnchor(documentLines(document), anchor);
  const startLine = (resolved?.startLine ?? 1) - 1;
  const endLine = (resolved?.endLine ?? 1) - 1;
  const range = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);

  lastReveal = { document: uri.toString(), at: Date.now() };
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: columnFor(uri, avoidColumn),
    preserveFocus,
    selection: new vscode.Range(range.start, range.start),
  });
  lastReveal = { document: uri.toString(), at: Date.now() };
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  flash(editor, range);

  if (resolved?.status === 'changed') {
    void vscode.window.setStatusBarMessage('CodeAtlas: this code changed after its explanation was written.', 5000);
  }
  return true;
}
