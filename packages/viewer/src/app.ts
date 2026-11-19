/**
 * Wires the header, diagram and panel to one piece of state: which level is
 * shown (`view`) and which node in it is selected (`selected`).
 *
 * Focusing a node with children opens it as the view; focusing a leaf shows
 * its parent's flow with the leaf selected. A walkthrough is a list of node
 * ids and a position in it; each step selects its node in the flow that
 * contains it, so the reader sees a part among its neighbours before going
 * inside it.
 */

import { createDiagram } from './diagram';
import type { Diagram, Direction } from './diagram';
import { clear, h } from './dom';
import { buildIndex, childrenOf, parentIdOf, pathTo, staleNodes, viewOf } from './graph';
import type { AtlasIndex } from './graph';
import type { Host } from './host';
import { createPanel } from './panel';
import type { Panel } from './panel';
import { parseLayout, positionsFor, withPositions } from './positions';
import { createSearch } from './search';
import type { Search } from './search';
import { tourOrder } from './tour';
import { createTourBar } from './tourBar';
import type { TourBar } from './tourBar';
import { NODE_KINDS } from './types';
import type { AtlasData, AtlasLayout, AtlasNode, ViewPositions } from './types';

export interface Controller {
  /** Show `nodeId` (null for the top level). Returns false for an unknown id. */
  focus(nodeId: string | null): boolean;
  /** The focused node id, or null at the top level. */
  focused(): string | null;
  /**
   * Show a changed map in place. The reader keeps their level, selection,
   * pan and zoom, walkthrough and any unsaved edit, as far as the new map
   * still has the nodes involved.
   */
  update(data: AtlasData): void;
  /** Open the edit form for the focused node. Returns false when it cannot be edited. */
  edit(): boolean;
  destroy(): void;
}

interface State {
  view: string | null;
  selected: string | null;
}

interface Tour {
  steps: string[];
  position: number;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('input, textarea, select') !== null;
}

/** One swatch per node kind the map actually uses. */
function legend(index: AtlasIndex): HTMLElement {
  const used = new Set(index.map.nodes.map((node) => node.kind));
  const items = NODE_KINDS.filter((kind) => used.has(kind)).map((kind) =>
    h('li', {}, h('span', { class: `atlas-dot is-${kind}`, 'aria-hidden': 'true' }), kind),
  );
  return h('ul', { class: 'atlas-legend', 'aria-label': 'Kinds of box' }, ...items);
}

class AtlasApp implements Controller {
  private index: AtlasIndex;
  private readonly staleCount = h('span', { class: 'atlas-stale-count' });
  /** The layout as the host last sent it, to tell a real change from an echo. */
  private sentLayout: string;
  private kinds: HTMLElement;
  private readonly crumbs = h('ol', { class: 'atlas-crumbs' });
  private readonly tourButton = h('button', { type: 'button', class: 'atlas-button atlas-tour-start' }, 'Walk through');
  private readonly diagram: Diagram;
  private readonly panel: Panel;
  private readonly search: Search;
  private readonly tourBar: TourBar;
  private readonly root: HTMLElement;
  private state: State = { view: null, selected: null };
  private layout: AtlasLayout;
  private tour: Tour | null = null;
  private isFollowingCode = false;

  constructor(
    container: HTMLElement,
    private data: AtlasData,
    private readonly host: Host,
  ) {
    this.index = buildIndex(data.map);
    // The layout comes from a file in the repository: read it as untrusted.
    this.layout = parseLayout(data.layout);
    this.diagram = createDiagram({
      onActivate: ({ node }) => this.focus(node.id),
      onOpenCode: ({ node }) => this.openCode(node, host.openAnchor),
      onMove: (positions) => this.keepPositions(positions),
    });
    this.panel = createPanel(() => this.index, {
      onOpenAnchor: (anchor) => host.openAnchor(anchor),
      onFocus: (nodeId) => this.focus(nodeId),
      onSave: host.saveNode?.bind(host),
      onRemoveNote: host.removeNote?.bind(host),
      onAddLink: host.addLink?.bind(host),
      onRemoveLink: host.removeLink?.bind(host),
    });
    this.search = createSearch(() => this.index, (nodeId) => this.focus(nodeId));
    this.tourBar = createTourBar(
      { onStep: (delta) => this.step(delta), onExit: () => this.endTour(), onFollow: (isOn) => this.followCode(isOn) },
      host.revealAnchor !== undefined,
    );
    this.tourButton.addEventListener('click', () => (this.tour ? this.endTour() : this.startTour()));
    this.kinds = legend(this.index);
    this.sentLayout = JSON.stringify(data.layout ?? null);
    this.renderStaleCount();
    this.diagram.element.append(this.kinds, this.tourBar.element);
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
    this.go(
      opensOwnFlow
        ? { view: node?.id ?? null, selected: null }
        : { view: parentIdOf(this.index, node.id), selected: node.id },
    );
    return true;
  };

  readonly focused = (): string | null => this.state.selected ?? this.state.view;

  readonly update = (data: AtlasData): void => {
    this.data = data;
    this.index = buildIndex(data.map);
    // The host's layout is adopted only when it changed. A map sent before the
    // host heard about a drag would otherwise put the box back for a moment.
    const sent = JSON.stringify(data.layout ?? null);
    if (sent !== this.sentLayout) this.layout = parseLayout(data.layout);
    this.sentLayout = sent;
    const has = (id: string | null): boolean => id === null || this.index.byId.has(id);
    const view = has(this.state.view) ? this.state.view : null;
    const selected = this.state.selected !== null && has(this.state.selected) ? this.state.selected : null;
    // A selected node belongs to the flow of its parent, which may have changed.
    this.state = selected === null ? { view, selected } : { view: parentIdOf(this.index, selected), selected };
    if (this.tour) {
      const at = this.tour.steps[this.tour.position];
      const steps = this.tour.steps.filter((id) => this.index.byId.has(id));
      this.tour = steps.length > 0 ? { steps, position: Math.max(0, steps.indexOf(at ?? '')) } : null;
    }
    const kinds = legend(this.index);
    this.kinds.replaceWith(kinds);
    this.kinds = kinds;
    this.renderStaleCount();
    this.render('none', true);
  };

  readonly edit = (): boolean => this.panel.edit();

  readonly destroy = (): void => {
    this.root.removeEventListener('keydown', this.onKeyDown);
    this.diagram.destroy();
    this.root.remove();
  };

  private go(next: State): void {
    if (next.view === this.state.view && next.selected === this.state.selected) return;
    const direction = this.directionTo(next.view);
    this.state = next;
    this.render(direction);
    this.host.onNavigate?.(this.focused());
  }

  private header(): HTMLElement {
    return h(
      'header',
      { class: 'atlas-bar' },
      h('span', { class: 'atlas-mark', 'aria-hidden': 'true' }, 'CodeAtlas'),
      h('nav', { 'aria-label': 'Location in the map' }, this.crumbs),
      this.staleCount,
      this.search.element,
      this.noteButton(),
      this.tourButton,
      this.host.toolbar,
    );
  }

  private renderStaleCount(): void {
    const count = staleNodes(this.index).length;
    this.staleCount.hidden = count === 0;
    this.staleCount.textContent = `${count} out of date`;
  }

  private noteButton(): HTMLElement | undefined {
    const addNote = this.host.addNote;
    if (!addNote) return undefined;
    const button = h(
      'button',
      { type: 'button', class: 'atlas-button atlas-note-add', title: 'Add a box of your own to this flow' },
      'Add note',
    );
    button.addEventListener('click', () => addNote.call(this.host, this.state.view));
    return button;
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

  /** `isReload` is a map changing underneath the reader, who should lose as little as possible. */
  private render(direction: Direction, isReload = false): void {
    this.renderCrumbs();
    const positions = positionsFor(this.layout, this.state.view);
    this.diagram.show(viewOf(this.index, this.state.view), this.state.selected, direction, positions);
    const shown = this.index.byId.get(this.state.selected ?? this.state.view ?? '');
    if (isReload) this.panel.refresh(shown ?? null);
    else if (shown) this.panel.showNode(shown);
    else this.panel.showOverview();
    this.renderTour();
  }

  private directionTo(view: string | null): Direction {
    if (view === this.state.view) return 'none';
    const isDeeper = pathTo(this.index, view).length > pathTo(this.index, this.state.view).length;
    return isDeeper ? 'in' : 'out';
  }

  private keepPositions(positions: ViewPositions): void {
    this.layout = withPositions(this.layout, this.state.view, positions);
    this.host.savePositions?.(this.state.view, positions);
  }

  private openCode(node: AtlasNode | undefined, open: Host['openAnchor'] | undefined): void {
    const first = node?.anchors?.[0];
    if (first) open?.(first);
  }

  // --- walkthrough ---

  /** Walk everything under the flow on screen, starting at the reader's place in it. */
  private startTour(): void {
    const steps = tourOrder(this.index, this.state.view);
    if (steps.length === 0) return;
    this.tour = { steps, position: Math.max(0, steps.indexOf(this.focused() ?? '')) };
    this.showStep();
  }

  private step(delta: 1 | -1): void {
    if (!this.tour) return;
    const position = Math.min(this.tour.steps.length - 1, Math.max(0, this.tour.position + delta));
    if (position === this.tour.position) return;
    this.tour = { ...this.tour, position };
    this.showStep();
  }

  private showStep(): void {
    const id = this.tour?.steps[this.tour.position];
    if (id === undefined) return;
    this.go({ view: parentIdOf(this.index, id), selected: id });
    this.renderTour();
    if (this.isFollowingCode) this.openCode(this.index.byId.get(id), this.host.revealAnchor);
  }

  private endTour(): void {
    this.tour = null;
    this.renderTour();
    // "Done" has just been hidden; keep the keyboard somewhere useful.
    this.tourButton.focus();
  }

  private followCode(isFollowing: boolean): void {
    this.isFollowingCode = isFollowing;
    if (isFollowing) this.openCode(this.index.byId.get(this.focused() ?? ''), this.host.revealAnchor);
  }

  /** Keep the strip in step with the reader, who may click around mid-walkthrough. */
  private renderTour(): void {
    this.tourButton.setAttribute('aria-pressed', String(this.tour !== null));
    if (!this.tour) {
      this.tourBar.hide();
      return;
    }
    const at = this.tour.steps.indexOf(this.focused() ?? '');
    if (at >= 0 && at !== this.tour.position) this.tour = { ...this.tour, position: at };
    const { steps, position } = this.tour;
    const current = this.index.byId.get(steps[position] ?? '');
    if (current) this.tourBar.show(position, steps.length, current, this.index.byId.get(steps[position + 1] ?? ''));
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape') this.escape();
    else if (isTyping(event.target)) return;
    else if (event.key === '/') this.search.focus();
    else if (this.tour && event.key === 'ArrowRight') this.step(1);
    else if (this.tour && event.key === 'ArrowLeft') this.step(-1);
    else return;
    event.preventDefault();
  };

  /** Escape leaves the walkthrough, then clears the selection, then steps out one level. */
  private escape(): void {
    if (this.tour) this.endTour();
    else if (this.state.selected !== null) this.focus(this.state.view);
    else if (this.state.view !== null) this.focus(parentIdOf(this.index, this.state.view));
  }
}

export function mount(container: HTMLElement, data: AtlasData, host: Host): Controller {
  return new AtlasApp(container, data, host);
}
