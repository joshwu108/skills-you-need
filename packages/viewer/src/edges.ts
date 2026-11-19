/** The SVG layer of arrows under the boxes, and the emphasis of one box's arrows. */

import { s } from './dom';
import type { ViewEdge } from './graph';
import { smoothPath } from './layout';
import type { Layout } from './layout';

const ARROW_ID = 'atlas-arrow';

function arrowMarker(): SVGElement {
  return s(
    'marker',
    { id: ARROW_ID, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' },
    // context-stroke: the arrowhead takes the colour of the line it ends.
    s('path', { d: 'M0,0 L10,5 L0,10 z', class: 'atlas-arrow', fill: 'context-stroke' }),
  );
}

export function edgeLayer(layout: Layout): SVGElement {
  const layer = s(
    'svg',
    {
      class: 'atlas-edges',
      width: String(layout.width),
      height: String(layout.height),
      viewBox: `0 0 ${layout.width} ${layout.height}`,
      'aria-hidden': 'true',
    },
    s('defs', {}, arrowMarker()),
  );
  for (const route of layout.routes) {
    layer.appendChild(
      s('path', {
        class: 'atlas-edge',
        d: smoothPath(route.points),
        'marker-end': `url(#${ARROW_ID})`,
        'data-from': route.from,
        'data-to': route.to,
      }),
    );
  }
  // Labels go last so they sit above every line.
  for (const route of layout.routes) {
    if (!route.label) continue;
    const { text, x, y, width, height } = route.label;
    layer.appendChild(
      s(
        'g',
        { class: 'atlas-edge-label', 'data-from': route.from, 'data-to': route.to },
        s('rect', { x: String(x - width / 2), y: String(y - height / 2), width: String(width), height: String(height), rx: '3' }),
        s('text', { x: String(x), y: String(y), 'text-anchor': 'middle', 'dominant-baseline': 'central' }, text),
      ),
    );
  }
  return layer;
}

/**
 * Emphasise the arrows into and out of `activeId` and the boxes at their
 * other ends; everything else in `flow` recedes. Null clears the emphasis.
 */
export function markLinked(flow: HTMLElement, edges: ViewEdge[], activeId: string | null): void {
  const linked = new Set<string>();
  if (activeId !== null) {
    linked.add(activeId);
    for (const edge of edges) {
      if (edge.from === activeId) linked.add(edge.to);
      if (edge.to === activeId) linked.add(edge.from);
    }
  }
  flow.classList.toggle('has-active', activeId !== null && linked.size > 1);
  for (const element of flow.querySelectorAll<HTMLElement>('.atlas-node')) {
    element.classList.toggle('is-linked', linked.has(element.dataset.node ?? ''));
  }
  for (const element of flow.querySelectorAll<SVGElement>('.atlas-edge, .atlas-edge-label')) {
    const touches = element.dataset.from === activeId || element.dataset.to === activeId;
    element.classList.toggle('is-linked', activeId !== null && touches);
    element.classList.toggle('is-outgoing', activeId !== null && element.dataset.from === activeId);
  }
}
