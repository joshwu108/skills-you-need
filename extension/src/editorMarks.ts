/**
 * How explained code shows up in the editor: a code lens above each anchored
 * range, a hover on its first line, and a gutter mark.
 *
 * Text from the map (titles, summaries) is model-written, so it is only ever
 * added with `appendText`, which escapes it. The one trusted command a hover
 * may run is `codeatlas.showNode`.
 */

import * as vscode from 'vscode';

import { isOutOfDate } from './core/locate';
import type { LocatedNode } from './core/locate';
import type { Locator } from './locator';
import type { MapStore } from './mapStore';

export const SHOW_NODE_COMMAND = 'codeatlas.showNode';
const DECORATION_DELAY_MS = 200;

function isEnabled(setting: string): boolean {
  return vscode.workspace.getConfiguration('codeatlas').get<boolean>(setting, true);
}

function showNodeArguments(store: MapStore, located: LocatedNode): [string, string] {
  return [store.folder.uri.toString(), located.node.id];
}

function firstLine(located: LocatedNode): vscode.Range {
  const line = located.resolved.startLine - 1;
  return new vscode.Range(line, 0, line, 0);
}

export class AtlasLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  constructor(private readonly locator: Locator) {}

  refresh(): void {
    this.changed.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!isEnabled('codeLens.enabled')) return [];
    const nodes = this.locator.nodesIn(document);
    if (!nodes) return [];
    return nodes.located.map((located) => {
      const { node } = located;
      const flag = isOutOfDate(located) ? ' · out of date' : '';
      return new vscode.CodeLens(firstLine(located), {
        title: `$(type-hierarchy-sub) ${node.title} · ${node.kind}${flag}`,
        tooltip: node.summary ?? 'Show this code in the CodeAtlas map',
        command: SHOW_NODE_COMMAND,
        arguments: showNodeArguments(nodes.store, located),
      });
    });
  }

  dispose(): void {
    this.changed.dispose();
  }
}

export class AtlasHoverProvider implements vscode.HoverProvider {
  constructor(private readonly locator: Locator) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const nodes = this.locator.nodesIn(document);
    // Only the first line of a range answers, so hovers inside a long function stay quiet.
    const here = nodes?.located.filter((located) => located.resolved.startLine - 1 === position.line) ?? [];
    if (!nodes || here.length === 0) return undefined;

    const content = new vscode.MarkdownString();
    content.isTrusted = { enabledCommands: [SHOW_NODE_COMMAND] };
    here.forEach((located, position_) => {
      if (position_ > 0) content.appendMarkdown('\n\n---\n\n');
      const { node } = located;
      content.appendMarkdown('**');
      content.appendText(node.title);
      content.appendMarkdown('** · ');
      content.appendText(node.kind);
      if (isOutOfDate(located)) content.appendMarkdown(' · _out of date_');
      if (node.summary) {
        content.appendMarkdown('\n\n');
        content.appendText(node.summary);
      }
      const target = encodeURIComponent(JSON.stringify(showNodeArguments(nodes.store, located)));
      content.appendMarkdown(`\n\n[Show in CodeAtlas](command:${SHOW_NODE_COMMAND}?${target})`);
    });
    return new vscode.Hover(content, document.lineAt(position.line).range);
  }
}

/** Gutter icons on the first line of each explained range. */
export class GutterMarks implements vscode.Disposable {
  private readonly current: vscode.TextEditorDecorationType;
  private readonly outOfDate: vscode.TextEditorDecorationType;
  private readonly subscriptions: vscode.Disposable[];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    context: vscode.ExtensionContext,
    private readonly locator: Locator,
  ) {
    const icon = (name: string): vscode.TextEditorDecorationType =>
      vscode.window.createTextEditorDecorationType({
        gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'media', name),
        gutterIconSize: '70%',
      });
    this.current = icon('gutter.svg');
    this.outOfDate = icon('gutter-stale.svg');
    this.subscriptions = [
      vscode.window.onDidChangeVisibleTextEditors(() => this.refresh()),
      // Typing shifts ranges; wait for a pause before re-hashing the document.
      vscode.workspace.onDidChangeTextDocument(() => this.refreshSoon()),
    ];
  }

  refresh(): void {
    for (const editor of vscode.window.visibleTextEditors) this.apply(editor);
  }

  private refreshSoon(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), DECORATION_DELAY_MS);
  }

  private apply(editor: vscode.TextEditor): void {
    const located = isEnabled('gutter.enabled') ? (this.locator.nodesIn(editor.document)?.located ?? []) : [];
    // One mark per line; an out-of-date node on a line takes precedence.
    const stale = new Set(located.filter(isOutOfDate).map((entry) => entry.resolved.startLine - 1));
    const fresh = new Set(located.map((entry) => entry.resolved.startLine - 1).filter((line) => !stale.has(line)));
    const ranges = (lines: Set<number>): vscode.Range[] => [...lines].map((line) => new vscode.Range(line, 0, line, 0));
    editor.setDecorations(this.current, ranges(fresh));
    editor.setDecorations(this.outOfDate, ranges(stale));
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const subscription of this.subscriptions) subscription.dispose();
    this.current.dispose();
    this.outOfDate.dispose();
  }
}
