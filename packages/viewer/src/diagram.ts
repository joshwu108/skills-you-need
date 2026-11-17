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

const MIN_SCALE = 0.25;
const MAX_SCALE = 2;
const ZOOM_STEP = 1.25;
const WHEEL_ZOOM_RATE = 0.0025;
const FIT_PADDING = 24;
/** Fitting never shrinks text below this; a larger flow is panned instead. */
const MIN_FIT_SCALE = 0.6;
/** Movement below this many pixels is a click, not a drag. */
const DRAG_THRESHOLD = 4;

interface Transform {
  x: number;
  y: number;
  scale: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
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

export function createDiagram(handlers: DiagramHandlers): Diagram {
  const flow = h('div', { class: 'atlas-flow' });
  const stage = h('div', { class: 'atlas-stage' }, flow);
  const viewport = h('div', { class: 'atlas-viewport' }, stage);
  const empty = h('p', { class: 'atlas-empty' });
  const zoomOut = h('button', { type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out' }, '−');
  const zoomIn = h('button', { type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in' }, '+');
  const fitButton = h('button', { type: 'button', class: 'atlas-fit', title: 'Fit the flow to the window' }, 'Fit');
  const controls = h('div', { class: 'atlas-zoom', role: 'group', 'aria-label': 'Zoom' }, zoomOut, zoomIn, fitButton);
  const element = h('section', { class: 'atlas-canvas', 'aria-label': 'Flow diagram' }, viewport, empty, controls);

  let layout: Layout = { width: 0, height: 0, boxes: [], routes: [] };
  let transform: Transform = { x: 0, y: 0, scale: 1 };
  // Once the reader pans or zooms, resizing the window stops re-fitting.
  let isAutoFit = true;

  const apply = (next: Transform): void => {
    transform = next;
    stage.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
  };

  const fit = (): void => {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    const available = { width: width - FIT_PADDING * 2, height: height - FIT_PADDING * 2 };
    const scale =
      layout.width > 0 && available.width > 0 && available.height > 0
        ? clamp(Math.min(available.width / layout.width, available.height / layout.height), MIN_FIT_SCALE, 1)
        : 1;
    isAutoFit = true;
    apply({
      scale,
      // A flow too large to fit starts at its top-left corner, not off-screen.
      x: Math.max(FIT_PADDING, (width - layout.width * scale) / 2),
      y: Math.max(FIT_PADDING, (height - layout.height * scale) / 2),
    });
  };

  const zoomAt = (factor: number, originX: number, originY: number): void => {
    const scale = clamp(transform.scale * factor, MIN_SCALE, MAX_SCALE);
    const ratio = scale / transform.scale;
    isAutoFit = false;
    apply({ scale, x: originX - (originX - transform.x) * ratio, y: originY - (originY - transform.y) * ratio });
  };
  const zoomAtCentre = (factor: number): void => zoomAt(factor, viewport.clientWidth / 2, viewport.clientHeight / 2);

  zoomIn.addEventListener('click', () => zoomAtCentre(ZOOM_STEP));
  zoomOut.addEventListener('click', () => zoomAtCentre(1 / ZOOM_STEP));
  fitButton.addEventListener('click', fit);

  viewport.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const bounds = viewport.getBoundingClientRect();
        zoomAt(Math.exp(-event.deltaY * WHEEL_ZOOM_RATE), event.clientX - bounds.left, event.clientY - bounds.top);
        return;
      }
      isAutoFit = false;
      apply({ ...transform, x: transform.x - event.deltaX, y: transform.y - event.deltaY });
    },
    { passive: false },
  );

  let drag: { pointer: number; startX: number; startY: number; origin: Transform; moved: boolean } | null = null;
  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    drag = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, origin: transform, moved: false };
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      viewport.setPointerCapture?.(event.pointerId);
      viewport.classList.add('is-panning');
    }
    isAutoFit = false;
    apply({ ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy });
  });
  const endDrag = (): void => {
    drag = null;
    viewport.classList.remove('is-panning');
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          if (isAutoFit) fit();
        });
  observer?.observe(viewport);

  return {
    element,
    show(view, selectedId, direction) {
      layout = layoutView(view);
      const nodes = view.nodes.map((viewNode) => {
        const box = layout.boxes.find((candidate) => candidate.id === viewNode.node.id);
        const node = nodeElement(viewNode, viewNode.node.id === selectedId, handlers);
        node.style.width = `${box?.width ?? 0}px`;
        node.style.height = `${box?.height ?? 0}px`;
        node.style.transform = `translate(${box?.x ?? 0}px, ${box?.y ?? 0}px)`;
        return node;
      });
      flow.style.width = `${layout.width}px`;
      flow.style.height = `${layout.height}px`;
      flow.replaceChildren(edgeLayer(layout), ...nodes);

      empty.textContent = view.nodes.length === 0 ? 'Nothing is mapped inside this node yet.' : '';
      empty.hidden = view.nodes.length > 0;

      if (direction !== 'none') {
        // Restart the entry animation for the new level.
        flow.classList.remove('enters-in', 'enters-out');
        void flow.offsetWidth;
        flow.classList.add(direction === 'in' ? 'enters-in' : 'enters-out');
        fit();
      } else if (isAutoFit) {
        fit();
      }
    },
    destroy() {
      observer?.disconnect();
      element.remove();
    },
  };
}
