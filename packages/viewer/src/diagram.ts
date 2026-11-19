/**
 * The flow diagram: HTML buttons for nodes over an SVG layer for edges,
 * inside a stage that pans and zooms with a single CSS transform.
 *
 * Nodes are real buttons so the diagram is keyboard-reachable. A node with
 * children carries two controls: the body opens its sub-flow and the corner
 * button jumps straight to its code. Boxes can be dragged; a moved box keeps
 * its element, so a drag never loses the pointer or the keyboard focus.
 */

import { h } from './dom';
import { edgeLayer, markLinked } from './edges';
import type { View, ViewNode } from './graph';
import { applyPositions, layoutView } from './layout';
import type { Layout } from './layout';
import { renderInlineMarkdown } from './markdown';
import { enableNodeDrag } from './nodeDrag';
import type { NodeDrag } from './nodeDrag';
import { PanZoom } from './panZoom';
import { positionOf } from './positions';
import type { Point, ViewPositions } from './types';

export type Direction = 'in' | 'out' | 'none';

export interface DiagramHandlers {
  onActivate(node: ViewNode): void;
  onOpenCode(node: ViewNode): void;
  /** The reader placed boxes by hand. `positions` is the view's full set; empty after a reset. */
  onMove(positions: ViewPositions): void;
}

export interface Diagram {
  element: HTMLElement;
  show(view: View, selectedId: string | null, direction: Direction, positions: ViewPositions): void;
  destroy(): void;
}

const ZOOM_STEP = 1.25;
const EMPTY_VIEW: View = { parent: null, nodes: [], edges: [] };
const EMPTY_LAYOUT: Layout = { width: 0, height: 0, boxes: [], routes: [] };

function describe({ node, ghost, childCount }: ViewNode): string {
  const parts = [node.title, node.kind];
  if (ghost) parts.push('outside this flow');
  if (childCount > 0) parts.push(`${childCount} parts inside`);
  if (node.planned) parts.push('planned');
  if (node.stale) parts.push('explanation out of date');
  return `${parts.join(', ')}.${node.summary ? ` ${node.summary}` : ''}`;
}

function nodeClasses({ node, ghost, childCount }: ViewNode, selected: boolean): string {
  const classes = ['atlas-node', `is-${node.kind}`];
  if (ghost) classes.push('is-ghost');
  if (childCount > 0) classes.push('has-children');
  if (node.planned) classes.push('is-planned');
  if (node.stale) classes.push('is-stale');
  if (selected) classes.push('is-selected');
  return classes.join(' ');
}

function nodeElement(viewNode: ViewNode, selected: boolean, handlers: DiagramHandlers): HTMLElement {
  const { node, ghost, childCount } = viewNode;
  const summary = h('span', { class: 'atlas-node-summary' });
  if (node.summary && !ghost) renderInlineMarkdown(document, node.summary, summary);

  const body = h(
    'button',
    { type: 'button', class: 'atlas-node-body', 'aria-label': describe(viewNode) },
    h(
      'span',
      { class: 'atlas-node-meta' },
      h('span', { class: 'atlas-node-kind' }, ghost ? `${node.kind} · outside` : node.kind),
      !ghost && childCount > 0 && h('span', { class: 'atlas-node-more' }, `${childCount} inside`),
    ),
    h('span', { class: 'atlas-node-title' }, node.title),
    node.summary && !ghost && summary,
  );
  if (selected) body.setAttribute('aria-pressed', 'true');
  body.addEventListener('click', () => handlers.onActivate(viewNode));

  const element = h('div', { class: nodeClasses(viewNode, selected), 'data-node': node.id }, body);
  if ((node.anchors?.length ?? 0) > 0 && !ghost) {
    const code = h(
      'button',
      { type: 'button', class: 'atlas-node-code', 'aria-label': `Open the code for ${node.title}`, title: 'Open code' },
      '</>',
    );
    code.addEventListener('click', () => handlers.onOpenCode(viewNode));
    element.appendChild(code);
  }
  return element;
}

function controls(panZoom: PanZoom, tidy: HTMLButtonElement): HTMLElement {
  const zoomOut = h('button', { type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out' }, '−');
  const zoomIn = h('button', { type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in' }, '+');
  const fit = h('button', { type: 'button', class: 'atlas-fit', title: 'Fit the flow to the window' }, 'Fit');
  zoomIn.addEventListener('click', () => panZoom.zoomBy(ZOOM_STEP));
  zoomOut.addEventListener('click', () => panZoom.zoomBy(1 / ZOOM_STEP));
  fit.addEventListener('click', () => panZoom.fit());
  return h('div', { class: 'atlas-zoom', role: 'group', 'aria-label': 'Diagram view' }, tidy, zoomOut, zoomIn, fit);
}

class FlowDiagram implements Diagram {
  private readonly flow = h('div', { class: 'atlas-flow' });
  private readonly empty = h('p', { class: 'atlas-empty' });
  private readonly tidy = h(
    'button',
    { type: 'button', class: 'atlas-tidy', title: 'Put every box in this flow back where the automatic layout places it' },
    'Tidy',
  );
  private readonly panZoom: PanZoom;
  private readonly drag: NodeDrag;
  readonly element: HTMLElement;

  private view: View = EMPTY_VIEW;
  private selectedId: string | null = null;
  private automatic: Layout = EMPTY_LAYOUT;
  /** The positions last shown or reported; a drag in progress is not in here. */
  private saved: ViewPositions = {};
  private layout: Layout = EMPTY_LAYOUT;
  private edges: Element | null = null;
  private elements = new Map<string, HTMLElement>();

  constructor(private readonly handlers: DiagramHandlers) {
    const stage = h('div', { class: 'atlas-stage' }, this.flow);
    const viewport = h('div', { class: 'atlas-viewport' }, stage);
    this.panZoom = new PanZoom(viewport, stage);
    this.element = h(
      'section',
      { class: 'atlas-canvas', 'aria-label': 'Flow diagram' },
      viewport,
      this.empty,
      controls(this.panZoom, this.tidy),
    );
    this.tidy.addEventListener('click', () => {
      this.saved = {};
      this.place({});
      handlers.onMove({});
    });
    this.flow.addEventListener('pointerover', (event) => this.emphasise(this.hovered(event.target)));
    this.flow.addEventListener('pointerleave', () => this.emphasise(null));
    this.flow.addEventListener('focusin', (event) => this.emphasise(this.hovered(event.target)));
    this.flow.addEventListener('focusout', () => this.emphasise(null));
    this.drag = enableNodeDrag(this.flow, {
      scale: () => this.panZoom.scale,
      positionOf: (nodeId) => this.boxOf(nodeId),
      onDrag: (nodeId, point) => this.place({ ...this.saved, [nodeId]: point }),
      onDrop: (nodeId, point) => this.drop(nodeId, point),
    });
  }

  show(view: View, selectedId: string | null, direction: Direction, positions: ViewPositions): void {
    // A drag belongs to the boxes being replaced; it cannot continue onto new ones.
    this.drag.cancel();
    const isSameFlow = view.parent?.id === this.view.parent?.id && direction === 'none';
    const focusedId = isSameFlow ? this.hovered(document.activeElement) : null;
    this.view = view;
    this.selectedId = selectedId;
    this.automatic = layoutView(view);
    this.elements = new Map(
      view.nodes.map((viewNode) => [viewNode.node.id, nodeElement(viewNode, viewNode.node.id === selectedId, this.handlers)]),
    );
    this.flow.replaceChildren(...this.elements.values());
    this.edges = null;
    this.saved = positions;
    this.place(positions);
    this.empty.textContent = view.nodes.length === 0 ? 'Nothing is mapped inside this node yet.' : '';
    this.empty.hidden = view.nodes.length > 0;
    // Rebuilding the boxes must not drop the keyboard focus from the one in use.
    if (focusedId !== null) this.nodeElement(focusedId)?.querySelector<HTMLElement>('.atlas-node-body')?.focus();

    if (direction !== 'none') {
      // Restart the entry animation for the new level.
      this.flow.classList.remove('enters-in', 'enters-out');
      void this.flow.offsetWidth;
      this.flow.classList.add(direction === 'in' ? 'enters-in' : 'enters-out');
      this.panZoom.fit();
    } else if (this.panZoom.isAutoFit) {
      this.panZoom.fit();
    }
    const selected = this.layout.boxes.find((box) => box.id === selectedId);
    if (selected) this.panZoom.reveal(selected.x, selected.y, selected.width, selected.height);
  }

  destroy(): void {
    this.drag.detach();
    this.panZoom.destroy();
    this.element.remove();
  }

  /** Lay the current boxes out with `positions` applied, without rebuilding them. */
  private place(positions: ViewPositions): void {
    this.layout = applyPositions(this.automatic, positions);
    this.flow.style.width = `${this.layout.width}px`;
    this.flow.style.height = `${this.layout.height}px`;
    for (const box of this.layout.boxes) {
      const element = this.nodeElement(box.id);
      if (!element) continue;
      element.style.width = `${box.width}px`;
      element.style.height = `${box.height}px`;
      element.style.transform = `translate(${box.x}px, ${box.y}px)`;
      element.classList.toggle('is-placed', positionOf(positions, box.id) !== undefined);
    }
    const edges = edgeLayer(this.layout);
    if (this.edges) this.edges.replaceWith(edges);
    else this.flow.prepend(edges);
    this.edges = edges;
    this.panZoom.setContentSize(this.layout.width, this.layout.height);
    this.tidy.hidden = !this.layout.boxes.some((box) => positionOf(positions, box.id) !== undefined);
    this.emphasise(this.hovered(document.activeElement));
  }

  private drop(nodeId: string, point: Point): void {
    const automatic = this.automatic.boxes.find((box) => box.id === nodeId);
    if (!automatic) return;
    const before = positionOf(this.saved, nodeId) ?? automatic;
    if (before.x === point.x && before.y === point.y) {
      // Released where it started (or the drag was cancelled): nothing to save.
      this.place(this.saved);
      return;
    }
    this.saved = { ...this.saved, [nodeId]: point };
    this.place(this.saved);
    this.handlers.onMove(this.saved);
  }

  private boxOf(nodeId: string): Point | undefined {
    const box = this.layout.boxes.find((candidate) => candidate.id === nodeId);
    return box ? { x: box.x, y: box.y } : undefined;
  }

  private nodeElement(nodeId: string): HTMLElement | null {
    return this.elements.get(nodeId) ?? null;
  }

  private hovered(target: EventTarget | null): string | null {
    const element = target instanceof Element ? target.closest<HTMLElement>('.atlas-node') : null;
    return element && this.flow.contains(element) ? (element.dataset.node ?? null) : null;
  }

  /** The hovered or focused box wins; otherwise the selected one. */
  private emphasise(nodeId: string | null): void {
    markLinked(this.flow, this.view.edges, nodeId ?? this.selectedId);
  }
}

export function createDiagram(handlers: DiagramHandlers): Diagram {
  return new FlowDiagram(handlers);
}
