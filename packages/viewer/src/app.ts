/**
 * Wires the header, diagram and panel to one piece of state: which level is
 * shown (`view`) and which node in it is selected (`selected`).
 *
 * Focusing a node with children opens it as the view; focusing a leaf shows
 * its parent's flow with the leaf selected. Everything else derives from that.
 */

import { createDiagram } from './diagram';
import type { Diagram, Direction } from './diagram';
import { clear, h } from './dom';
import { buildIndex, childrenOf, parentIdOf, pathTo, staleNodes, viewOf } from './graph';
import type { AtlasIndex } from './graph';
import type { Host } from './host';
import { createPanel } from './panel';
import type { Panel } from './panel';
import type { AtlasData } from './types';

export interface Controller {
  /** Show `nodeId` (null for the top level). Returns false for an unknown id. */
  focus(nodeId: string | null): boolean;
  /** The focused node id, or null at the top level. */
  focused(): string | null;
  destroy(): void;
}

interface State {
  view: string | null;
  selected: string | null;
}

class AtlasApp implements Controller {
  private readonly index: AtlasIndex;
  private readonly crumbs = h('ol', { class: 'atlas-crumbs' });
  private readonly diagram: Diagram;
  private readonly panel: Panel;
  private readonly root: HTMLElement;
  private state: State = { view: null, selected: null };

  constructor(
    container: HTMLElement,
    private readonly data: AtlasData,
    private readonly host: Host,
  ) {
    this.index = buildIndex(data.map);
    this.diagram = createDiagram({
      onActivate: ({ node }) => this.focus(node.id),
      onOpenCode: ({ node }) => {
        const first = node.anchors?.[0];
        if (first) host.openAnchor(first);
      },
    });
    this.panel = createPanel(this.index, {
      onOpenAnchor: (anchor) => host.openAnchor(anchor),
      onFocus: (nodeId) => this.focus(nodeId),
    });
    this.root = h('div', { class: 'atlas' }, this.header(), this.diagram.element, this.panel.element);
    this.root.addEventListener('keydown', this.onKeyDown);
    container.replaceChildren(this.root);
    this.render('none');
  }

  // Arrow functions: these are handed out as callbacks and must keep `this`.
  readonly focus = (nodeId: string | null): boolean => {
    const node = nodeId === null ? undefined : this.index.byId.get(nodeId);
    if (nodeId !== null && !node) return false;

    const opensOwnFlow = !node || childrenOf(this.index, node.id).length > 0;
    const next: State = opensOwnFlow
      ? { view: node?.id ?? null, selected: null }
      : { view: parentIdOf(this.index, node.id), selected: node.id };
    if (next.view === this.state.view && next.selected === this.state.selected) return true;

    const direction = this.directionTo(next.view);
    this.state = next;
    this.render(direction);
    this.host.onNavigate?.(this.focused());
    return true;
  };

  readonly focused = (): string | null => this.state.selected ?? this.state.view;

  readonly destroy = (): void => {
    this.root.removeEventListener('keydown', this.onKeyDown);
    this.diagram.destroy();
    this.root.remove();
  };

  private header(): HTMLElement {
    const staleCount = staleNodes(this.index).length;
    return h(
      'header',
      { class: 'atlas-bar' },
      h('span', { class: 'atlas-mark', 'aria-hidden': 'true' }, 'CodeAtlas'),
      h('nav', { 'aria-label': 'Location in the map' }, this.crumbs),
      staleCount > 0 && h('span', { class: 'atlas-stale-count' }, `${staleCount} out of date`),
      this.host.toolbar,
    );
  }

  private renderCrumbs(): void {
    clear(this.crumbs);
    const path = pathTo(this.index, this.state.view);
    const entries = [{ id: null as string | null, title: this.data.map.title }, ...path];
    entries.forEach((entry, position) => {
      const button = h('button', { type: 'button', class: 'atlas-crumb' }, entry.title);
      if (position === entries.length - 1) button.setAttribute('aria-current', 'location');
      button.addEventListener('click', () => this.focus(entry.id));
      this.crumbs.appendChild(h('li', {}, button));
    });
  }

  private render(direction: Direction): void {
    this.renderCrumbs();
    this.diagram.show(viewOf(this.index, this.state.view), this.state.selected, direction);
    const shown = this.index.byId.get(this.state.selected ?? this.state.view ?? '');
    if (shown) this.panel.showNode(shown);
    else this.panel.showOverview();
  }

  private directionTo(view: string | null): Direction {
    if (view === this.state.view) return 'none';
    const isDeeper = pathTo(this.index, view).length > pathTo(this.index, this.state.view).length;
    return isDeeper ? 'in' : 'out';
  }

  /** Escape clears the selection first, then steps out one level. */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (this.state.selected !== null) this.focus(this.state.view);
    else if (this.state.view !== null) this.focus(parentIdOf(this.index, this.state.view));
  };
}

export function mount(container: HTMLElement, data: AtlasData, host: Host): Controller {
  return new AtlasApp(container, data, host);
}
