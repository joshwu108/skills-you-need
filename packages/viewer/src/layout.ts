/** Positions a view's nodes and routes its edges with dagre (layered, top to bottom). */

import dagre from '@dagrejs/dagre';

import type { View } from './graph';
import { positionOf } from './positions';
import type { Point, ViewPositions } from './types';

export type { Point };

export const NODE_WIDTH = 236;
export const NODE_HEIGHT = 112;
export const GHOST_WIDTH = 172;
export const GHOST_HEIGHT = 48;

const NODE_GAP = 40;
const RANK_GAP = 72;
const MARGIN = 32;
const LABEL_CHAR_WIDTH = 6.7;
const LABEL_PADDING = 18;
const LABEL_HEIGHT = 22;
const LABEL_MAX_CHARS = 28;

export interface Box extends Point {
  id: string;
  width: number;
  height: number;
}

export interface Route {
  from: string;
  to: string;
  points: Point[];
  label?: { text: string; x: number; y: number; width: number; height: number };
}

export interface Layout {
  width: number;
  height: number;
  boxes: Box[];
  routes: Route[];
}

export function edgeLabel(labels: string[]): string {
  const text = labels.join(' · ');
  return text.length > LABEL_MAX_CHARS ? `${text.slice(0, LABEL_MAX_CHARS - 1)}…` : text;
}

export function layoutView(view: View): Layout {
  const graph = new dagre.graphlib.Graph({ multigraph: false });
  graph.setGraph({ rankdir: 'TB', nodesep: NODE_GAP, ranksep: RANK_GAP, marginx: MARGIN, marginy: MARGIN });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const { node, ghost } of view.nodes) {
    graph.setNode(node.id, {
      width: ghost ? GHOST_WIDTH : NODE_WIDTH,
      height: ghost ? GHOST_HEIGHT : NODE_HEIGHT,
    });
  }
  for (const edge of view.edges) {
    const text = edgeLabel(edge.labels);
    graph.setEdge(edge.from, edge.to, {
      text,
      labelpos: 'c',
      width: text ? text.length * LABEL_CHAR_WIDTH + LABEL_PADDING : 0,
      height: text ? LABEL_HEIGHT : 0,
    });
  }
  dagre.layout(graph);

  const boxes: Box[] = view.nodes.map(({ node }) => {
    const placed = graph.node(node.id);
    // dagre reports centres; the renderer wants top-left corners.
    return {
      id: node.id,
      x: placed.x - placed.width / 2,
      y: placed.y - placed.height / 2,
      width: placed.width,
      height: placed.height,
    };
  });
  const routes: Route[] = graph.edges().map((key) => {
    const edge = graph.edge(key) as {
      points: Point[];
      text: string;
      x?: number;
      y?: number;
      width: number;
      height: number;
    };
    const hasLabel = edge.text !== '' && edge.x !== undefined && edge.y !== undefined;
    return {
      from: key.v,
      to: key.w,
      points: edge.points.map(({ x, y }) => ({ x, y })),
      label: hasLabel
        ? { text: edge.text, x: edge.x as number, y: edge.y as number, width: edge.width, height: edge.height }
        : undefined,
    };
  });

  const size = graph.graph();
  return { width: size.width ?? 0, height: size.height ?? 0, boxes, routes };
}

function centre(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Where the line from the centre of `box` towards `target` leaves the box. */
function borderPoint(box: Box, target: Point): Point {
  const from = centre(box);
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  if (dx === 0 && dy === 0) return from;
  const reach = Math.min(
    dx === 0 ? Infinity : box.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : box.height / 2 / Math.abs(dy),
  );
  return { x: from.x + dx * reach, y: from.y + dy * reach };
}

function straightRoute(route: Route, from: Box, to: Box): Route {
  const start = borderPoint(from, centre(to));
  const end = borderPoint(to, centre(from));
  const label = route.label
    ? { ...route.label, x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
    : undefined;
  return { ...route, points: [start, end], label };
}

/**
 * `layout` with the boxes the reader placed by hand moved to their positions.
 *
 * An arrow touching a moved box is redrawn as a straight line between the two
 * boxes; the automatic route no longer leads anywhere useful. Positions for
 * nodes that are not in the layout are ignored, so a layout file outlives
 * renamed or removed nodes.
 */
export function applyPositions(layout: Layout, positions: ViewPositions): Layout {
  const moved = new Set<string>();
  const boxes = layout.boxes.map((box) => {
    const placed = positionOf(positions, box.id);
    if (!placed) return box;
    moved.add(box.id);
    return { ...box, x: placed.x, y: placed.y };
  });
  if (moved.size === 0) return layout;

  const byId = new Map(boxes.map((box) => [box.id, box]));
  const routes = layout.routes.map((route) => {
    const from = byId.get(route.from);
    const to = byId.get(route.to);
    const isTouched = moved.has(route.from) || moved.has(route.to);
    return isTouched && from && to ? straightRoute(route, from, to) : route;
  });
  return {
    // reduce, not Math.max(...): a very large flow must not overflow the argument list.
    width: boxes.reduce((most, box) => Math.max(most, box.x + box.width + MARGIN), layout.width),
    height: boxes.reduce((most, box) => Math.max(most, box.y + box.height + MARGIN), layout.height),
    boxes,
    routes,
  };
}

/** An SVG path through `points`, rounded at each interior point. */
export function smoothPath(points: Point[]): string {
  const [first, ...rest] = points;
  if (!first) return '';
  const last = rest[rest.length - 1];
  if (!last) return `M${fmt(first.x)},${fmt(first.y)}`;

  let path = `M${fmt(first.x)},${fmt(first.y)}`;
  for (let index = 0; index < rest.length - 1; index += 1) {
    const control = rest[index] as Point;
    const next = rest[index + 1] as Point;
    const isLastSegment = index === rest.length - 2;
    const end = isLastSegment ? next : { x: (control.x + next.x) / 2, y: (control.y + next.y) / 2 };
    path += ` Q${fmt(control.x)},${fmt(control.y)} ${fmt(end.x)},${fmt(end.y)}`;
  }
  if (rest.length === 1) path += ` L${fmt(last.x)},${fmt(last.y)}`;
  return path;
}

function fmt(value: number): string {
  return String(Math.round(value * 10) / 10);
}
