/**
 * The flow diagram: HTML buttons for nodes over an SVG layer for edges,
 * inside a stage that pans and zooms with a single CSS transform.
 *
 * Nodes are real buttons so the diagram is keyboard-reachable. A node with
 * children carries two controls: the body opens its sub-flow and the corner
 * button jumps straight to its code.
 */

import { h, s } from './dom';
import type { View, ViewNode } from './graph';
import { layoutView, smoothPath } from './layout';
import type { Layout } from './layout';
import { PanZoom } from './panZoom';

export type Direction = 'in' | 'out' | 'none';

export interface DiagramHandlers {
  onActivate(node: ViewNode): void;
  onOpenCode(node: ViewNode): void;
}

export interface Diagram {
  element: HTMLElement;
  show(view: View, selectedId: string | null, direction: Direction): void;
  destroy(): void;
}

function describe({ node, ghost, childCount }: ViewNode): string {
  const parts = [node.title, node.kind];
  if (ghost) parts.push('outside this flow');
  if (childCount > 0) parts.push(`${childCount} parts inside`);
  if (node.planned) parts.push('planned');
  if (node.stale) parts.push('explanation out of date');
  return `${parts.join(', ')}.${node.summary ? ` ${node.summary}` : ''}`;
}

function nodeElement(viewNode: ViewNode, selected: boolean, handlers: DiagramHandlers): HTMLElement {
  const { node, ghost, childCount } = viewNode;
  const hasCode = (node.anchors?.length ?? 0) > 0;
  const classes = ['atlas-node', `is-${node.kind}`];
  if (ghost) classes.push('is-ghost');
  if (childCount > 0) classes.push('has-children');
  if (node.planned) classes.push('is-planned');
  if (node.stale) classes.push('is-stale');
  if (selected) classes.push('is-selected');

  const body = h(
    'button',
    { type: 'button', class: 'atlas-node-body', 'aria-label': describe(viewNode), title: node.summary },
    h('span', { class: 'atlas-node-kind' }, ghost ? `${node.kind} · outside` : node.kind),
    h('span', { class: 'atlas-node-title' }, node.title),
    !ghost && childCount > 0 && h('span', { class: 'atlas-node-more' }, `${childCount} inside`),
  );
  if (selected) body.setAttribute('aria-pressed', 'true');
  body.addEventListener('click', () => handlers.onActivate(viewNode));

  const element = h('div', { class: classes.join(' '), 'data-node': node.id }, body);
  if (hasCode && !ghost) {
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

function edgeLayer(layout: Layout): SVGElement {
  const marker = s(
    'marker',
    { id: 'atlas-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' },
    s('path', { d: 'M0,0 L10,5 L0,10 z', class: 'atlas-arrow' }),
  );
  const layer = s(
    'svg',
    {
      class: 'atlas-edges',
      width: String(layout.width),
      height: String(layout.height),
      viewBox: `0 0 ${layout.width} ${layout.height}`,
      'aria-hidden': 'true',
    },
    s('defs', {}, marker),
  );
  for (const route of layout.routes) {
    layer.appendChild(s('path', { class: 'atlas-edge', d: smoothPath(route.points), 'marker-end': 'url(#atlas-arrow)' }));
  }
  // Labels go last so they sit above every line.
  for (const route of layout.routes) {
    if (!route.label) continue;
    const { text, x, y, width, height } = route.label;
    layer.appendChild(
      s(
        'g',
        { class: 'atlas-edge-label' },
        s('rect', { x: String(x - width / 2), y: String(y - height / 2), width: String(width), height: String(height), rx: '3' }),
        s('text', { x: String(x), y: String(y), 'text-anchor': 'middle', 'dominant-baseline': 'central' }, text),
      ),
    );
  }
  return layer;
}

const ZOOM_STEP = 1.25;

function zoomControls(panZoom: PanZoom): HTMLElement {
  const zoomOut = h('button', { type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out' }, '−');
  const zoomIn = h('button', { type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in' }, '+');
  const fit = h('button', { type: 'button', class: 'atlas-fit', title: 'Fit the flow to the window' }, 'Fit');
  zoomIn.addEventListener('click', () => panZoom.zoomBy(ZOOM_STEP));
  zoomOut.addEventListener('click', () => panZoom.zoomBy(1 / ZOOM_STEP));
  fit.addEventListener('click', () => panZoom.fit());
  return h('div', { class: 'atlas-zoom', role: 'group', 'aria-label': 'Zoom' }, zoomOut, zoomIn, fit);
}

function placedNodes(view: View, layout: Layout, selectedId: string | null, handlers: DiagramHandlers): HTMLElement[] {
  return view.nodes.map((viewNode) => {
    const box = layout.boxes.find((candidate) => candidate.id === viewNode.node.id);
    const node = nodeElement(viewNode, viewNode.node.id === selectedId, handlers);
    node.style.width = `${box?.width ?? 0}px`;
    node.style.height = `${box?.height ?? 0}px`;
    node.style.transform = `translate(${box?.x ?? 0}px, ${box?.y ?? 0}px)`;
    return node;
  });
}

export function createDiagram(handlers: DiagramHandlers): Diagram {
  const flow = h('div', { class: 'atlas-flow' });
  const stage = h('div', { class: 'atlas-stage' }, flow);
  const viewport = h('div', { class: 'atlas-viewport' }, stage);
  const empty = h('p', { class: 'atlas-empty' });
  const panZoom = new PanZoom(viewport, stage);
  const element = h('section', { class: 'atlas-canvas', 'aria-label': 'Flow diagram' }, viewport, empty, zoomControls(panZoom));

  return {
    element,
    show(view, selectedId, direction) {
      const layout = layoutView(view);
      flow.style.width = `${layout.width}px`;
      flow.style.height = `${layout.height}px`;
      flow.replaceChildren(edgeLayer(layout), ...placedNodes(view, layout, selectedId, handlers));
      panZoom.setContentSize(layout.width, layout.height);

      empty.textContent = view.nodes.length === 0 ? 'Nothing is mapped inside this node yet.' : '';
      empty.hidden = view.nodes.length > 0;

      if (direction !== 'none') {
        // Restart the entry animation for the new level.
        flow.classList.remove('enters-in', 'enters-out');
        void flow.offsetWidth;
        flow.classList.add(direction === 'in' ? 'enters-in' : 'enters-out');
        panZoom.fit();
      } else if (panZoom.isAutoFit) {
        panZoom.fit();
      }
    },
    destroy() {
      panZoom.destroy();
      element.remove();
    },
  };
}
