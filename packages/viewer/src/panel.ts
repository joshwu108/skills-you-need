/** The reading panel: what the focused node is, why it exists, and where its code lives. */

import { h } from './dom';
import { createEditForm } from './editForm';
import type { AtlasIndex, Connection } from './graph';
import { childrenOf, connectionsOf, staleNodes } from './graph';
import { anchorLabel } from './links';
import { createLinkForm } from './linkForm';
import { renderInlineMarkdown, renderMarkdown } from './markdown';
import type { Anchor, AtlasNode, NodeChanges } from './types';

/** Optional members are things the host can write; their controls are hidden without them. */
export interface PanelHandlers {
  onOpenAnchor(anchor: Anchor): void;
  onFocus(nodeId: string): void;
  onSave?(nodeId: string, changes: NodeChanges): void;
  onRemoveNote?(nodeId: string): void;
  onAddLink?(from: string, to: string, label: string): void;
  onRemoveLink?(from: string, to: string): void;
}

export interface Panel {
  element: HTMLElement;
  showNode(node: AtlasNode): void;
  /**
   * Show `node` (null for the overview) after the map changed underneath.
   * An unsaved edit form stays open, and reading text that did not change is
   * left in place so the keyboard focus and a half-filled link form survive.
   */
  refresh(node: AtlasNode | null): void;
  showOverview(): void;
  /** Open the edit form for the node on show. Returns false when it cannot be edited. */
  edit(): boolean;
  /** True while an edit form is open that the reader has not saved. */
  holdsDraft(): boolean;
}

/** A one-line summary; it may contain inline Markdown such as `code`. */
function summary(className: string, text: string): HTMLElement {
  const element = h('span', className ? { class: className } : {});
  renderInlineMarkdown(document, text, element);
  return element;
}

function tags(node: AtlasNode): HTMLElement {
  return h(
    'p',
    { class: 'atlas-tags' },
    h('span', { class: `atlas-tag is-${node.kind}` }, node.kind === 'note' ? 'your note' : node.kind),
    node.planned && h('span', { class: 'atlas-tag is-flag' }, 'planned'),
    node.stale && h('span', { class: 'atlas-tag is-warning' }, 'out of date'),
  );
}

function section(heading: string, ...content: (Node | false | undefined)[]): HTMLElement {
  return h('section', { class: 'atlas-section' }, h('h3', {}, heading), ...content);
}

function anchorList(anchors: Anchor[], handlers: PanelHandlers): HTMLElement {
  const items = anchors.map((anchor) => {
    const button = h(
      'button',
      { type: 'button', class: 'atlas-anchor' },
      h('span', { class: 'atlas-anchor-path' }, anchorLabel(anchor)),
      anchor.symbol && h('span', { class: 'atlas-anchor-symbol' }, anchor.symbol),
    );
    button.addEventListener('click', () => handlers.onOpenAnchor(anchor));
    return h('li', {}, button);
  });
  return section('Code', h('ul', { class: 'atlas-anchors' }, ...items));
}

function nodeList(heading: string, nodes: AtlasNode[], handlers: PanelHandlers): HTMLElement {
  const items = nodes.map((node) => {
    const button = h(
      'button',
      { type: 'button', class: 'atlas-child' },
      h('span', { class: `atlas-dot is-${node.kind}`, 'aria-hidden': 'true' }),
      h('span', { class: 'atlas-child-title' }, node.title),
      node.summary && summary('atlas-child-summary', node.summary),
    );
    button.addEventListener('click', () => handlers.onFocus(node.id));
    return h('li', {}, button);
  });
  return section(heading, h('ol', { class: 'atlas-children' }, ...items));
}

function connectionItem(node: AtlasNode, { node: other, outgoing, labels, isUsers }: Connection, handlers: PanelHandlers): HTMLElement {
  const open = h(
    'button',
    { type: 'button', class: 'atlas-link' },
    h('span', { class: 'atlas-link-way' }, outgoing ? 'to' : 'from'),
    h('span', { class: 'atlas-link-title' }, other.title),
    labels.length > 0 && h('span', { class: 'atlas-link-what' }, labels.join(' · ')),
  );
  open.addEventListener('click', () => handlers.onFocus(other.id));
  const remove = h(
    'button',
    { type: 'button', class: 'atlas-link-remove', 'aria-label': `Remove the link ${outgoing ? 'to' : 'from'} ${other.title}`, title: 'Remove this link' },
    '×',
  );
  remove.addEventListener('click', () =>
    handlers.onRemoveLink?.(outgoing ? node.id : other.id, outgoing ? other.id : node.id),
  );
  // Only arrows the reader drew can be removed here; the rest are Claude's.
  return h('li', { class: 'atlas-link-row' }, open, handlers.onRemoveLink && isUsers && remove);
}

/** What flows into and out of a node, each line a link to the other end. */
function connectionSection(index: AtlasIndex, node: AtlasNode, handlers: PanelHandlers): HTMLElement | false {
  const connections = connectionsOf(index, node.id);
  const onAdd = handlers.onAddLink;
  if (connections.length === 0 && !onAdd) return false;
  return section(
    'Connections',
    connections.length > 0 &&
      h('ul', { class: 'atlas-links' }, ...connections.map((connection) => connectionItem(node, connection, handlers))),
    onAdd && index.map.nodes.length > 1 && createLinkForm(index, node, onAdd),
  );
}

function staleNote(node: AtlasNode): HTMLElement {
  const reason = node.staleReason ? `: ${node.staleReason}` : '';
  const advice =
    node.kind === 'note' ? 'Check that your note still holds, then save it again.' : 'Ask Claude to refresh the map.';
  return h('p', { class: 'atlas-callout', role: 'note' }, `The code changed after this was written${reason}. ${advice}`);
}

class ReadingPanel implements Panel {
  readonly element = h('aside', { class: 'atlas-panel', 'aria-live': 'polite', 'aria-label': 'Explanation' });
  private shown: AtlasNode | null = null;
  /** What the reading view was last drawn from; null while something else is on show. */
  private drawn: string | null = null;
  /** The node whose edit form is open, and whether Save has been pressed. */
  private draft: { nodeId: string; isSubmitted: boolean } | null = null;

  constructor(
    private readonly getIndex: () => AtlasIndex,
    private readonly handlers: PanelHandlers,
  ) {}

  holdsDraft(): boolean {
    return this.draft !== null && !this.draft.isSubmitted;
  }

  showNode(node: AtlasNode): void {
    this.shown = node;
    this.read();
  }

  refresh(node: AtlasNode | null): void {
    if (this.holdsDraft() && node?.id === this.draft?.nodeId) {
      // Cancelling the form must show the node as it is now.
      this.shown = node;
      return;
    }
    if (!node) {
      this.showOverview();
      return;
    }
    const isSame = this.shown?.id === node.id && this.drawn === this.signature(node);
    this.shown = node;
    if (!isSame) this.read();
  }

  /** Everything the reading view of `node` depends on. */
  private signature(node: AtlasNode): string {
    const index = this.getIndex();
    const connections = connectionsOf(index, node.id).map((c) => [c.node.id, c.node.title, c.outgoing, c.labels, c.isUsers]);
    const others = index.map.nodes.map((other) => [other.id, other.title, other.parent]);
    return JSON.stringify([node, connections, childrenOf(index, node.id), others]);
  }

  showOverview(): void {
    this.shown = null;
    this.drawn = null;
    this.draft = null;
    this.element.setAttribute('aria-live', 'polite');
    const index = this.getIndex();
    const stale = staleNodes(index);
    const prose = h('div', { class: 'atlas-prose' });
    if (index.map.summary) prose.appendChild(renderMarkdown(document, index.map.summary));
    this.element.replaceChildren(
      h('p', { class: 'atlas-tags' }, h('span', { class: 'atlas-tag is-flag' }, 'overview')),
      h('h2', {}, index.map.title),
      prose,
      h(
        'p',
        { class: 'atlas-hint' },
        'Select a box to read about it; boxes with parts inside open their own flow. Drag a box to move it. "Walk through" reads the map to you in order.',
      ),
      ...(stale.length > 0 ? [nodeList('Out of date', stale, this.handlers)] : []),
      nodeList('Top level', childrenOf(index, null), this.handlers),
    );
  }

  edit(): boolean {
    const node = this.shown;
    const onSave = this.handlers.onSave;
    if (!node || !onSave) return false;
    const draft = { nodeId: node.id, isSubmitted: false };
    this.draft = draft;
    this.drawn = null;
    const save = (changes: NodeChanges): void => {
      draft.isSubmitted = true;
      onSave(node.id, changes);
    };
    const form = createEditForm(node, save, () => this.read(true));
    // The form's own character counter must not be read out on every keystroke.
    this.element.setAttribute('aria-live', 'off');
    this.element.replaceChildren(h('p', { class: 'atlas-tags' }, h('span', { class: 'atlas-tag is-flag' }, 'editing')), form);
    const name = form.querySelector('input');
    name?.focus();
    name?.select();
    return true;
  }

  private read(returnFocus = false): void {
    const node = this.shown;
    if (!node) return;
    this.draft = null;
    this.element.setAttribute('aria-live', 'polite');
    this.element.replaceChildren(...this.reading(node));
    this.drawn = this.signature(node);
    // Leaving the form removes the focused control; hand focus to where it was opened.
    if (returnFocus) this.element.querySelector<HTMLElement>('.atlas-edit-open')?.focus();
  }

  private actions(node: AtlasNode): HTMLElement {
    const { onSave, onRemoveNote } = this.handlers;
    const edit = h('button', { type: 'button', class: 'atlas-button atlas-edit-open' }, 'Edit');
    edit.addEventListener('click', () => this.edit());
    const remove = h('button', { type: 'button', class: 'atlas-button atlas-note-remove' }, 'Delete');
    remove.addEventListener('click', () => onRemoveNote?.(node.id));
    const isRemovable = onRemoveNote && node.kind === 'note' && childrenOf(this.getIndex(), node.id).length === 0;
    return h('div', { class: 'atlas-panel-actions' }, onSave && edit, isRemovable && remove);
  }

  private reading(node: AtlasNode): Node[] {
    const index = this.getIndex();
    const anchors = node.anchors ?? [];
    const children = childrenOf(index, node.id);
    const prose = h('div', { class: 'atlas-prose' });
    if (node.explanation) prose.appendChild(renderMarkdown(document, node.explanation));
    const parts: (Node | false | undefined)[] = [
      h('div', { class: 'atlas-panel-top' }, tags(node), this.actions(node)),
      h('h2', {}, node.title),
      node.summary !== undefined && node.summary !== '' && h('p', { class: 'atlas-lead' }, summary('', node.summary)),
      node.stale === true && staleNote(node),
      node.explanation !== undefined && node.explanation !== '' && prose,
      anchors.length > 0 && anchorList(anchors, this.handlers),
      connectionSection(index, node, this.handlers),
      children.length > 0 && nodeList('In this flow', children, this.handlers),
    ];
    return parts.filter((part): part is Node => part instanceof Node);
  }
}

export function createPanel(getIndex: () => AtlasIndex, handlers: PanelHandlers): Panel {
  return new ReadingPanel(getIndex, handlers);
}
