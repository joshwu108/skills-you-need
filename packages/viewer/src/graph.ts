/**
 * Turns the flat node list into views.
 *
 * A view is one level of the hierarchy: the children of a node (or the
 * top-level nodes). Edges are stored between nodes at any depth, so each
 * edge is lifted to the nodes visible in the view. An endpoint outside the
 * view's subtree becomes a "ghost": the outermost ancestor of that endpoint
 * which is not also an ancestor of the view, shown so a sub-flow keeps its
 * context.
 */

import type { AtlasEdge, AtlasMap, AtlasNode } from './types';

export interface AtlasIndex {
  map: AtlasMap;
  byId: Map<string, AtlasNode>;
  children: Map<string | null, AtlasNode[]>;
}

export interface ViewNode {
  node: AtlasNode;
  ghost: boolean;
  childCount: number;
}

export interface ViewEdge {
  from: string;
  to: string;
  labels: string[];
  kind?: AtlasEdge['kind'];
}

export interface View {
  parent: AtlasNode | null;
  nodes: ViewNode[];
  edges: ViewEdge[];
}

export function buildIndex(map: AtlasMap): AtlasIndex {
  const byId = new Map<string, AtlasNode>();
  for (const node of map.nodes) byId.set(node.id, node);

  const children = new Map<string | null, AtlasNode[]>();
  for (const node of map.nodes) {
    // A parent that does not exist would hide the node; show it at the top.
    const parent = node.parent !== null && byId.has(node.parent) ? node.parent : null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  return { map, byId, children };
}

export function childrenOf(index: AtlasIndex, id: string | null): AtlasNode[] {
  return index.children.get(id) ?? [];
}

/** The chain from the top level down to `id`, inclusive. Empty for unknown ids. */
export function pathTo(index: AtlasIndex, id: string | null): AtlasNode[] {
  const path: AtlasNode[] = [];
  const seen = new Set<string>();
  let node = id === null ? undefined : index.byId.get(id);
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    path.unshift(node);
    node = node.parent === null ? undefined : index.byId.get(node.parent);
  }
  return path;
}

/** The id of the node containing `id`, or null when it sits at the top level. */
export function parentIdOf(index: AtlasIndex, id: string): string | null {
  const parent = index.byId.get(id)?.parent ?? null;
  return parent !== null && index.byId.has(parent) ? parent : null;
}

interface Lifted {
  id: string;
  ghost: boolean;
}

function lift(index: AtlasIndex, viewPath: AtlasNode[], endpoint: string): Lifted | null {
  const path = pathTo(index, endpoint);
  if (path.length === 0) return null;

  let shared = 0;
  while (
    shared < viewPath.length &&
    shared < path.length &&
    viewPath[shared]?.id === path[shared]?.id
  ) {
    shared += 1;
  }
  const representative = path[shared];
  // The endpoint is the view itself or one of its ancestors: nothing to draw.
  if (!representative) return null;
  return { id: representative.id, ghost: shared < viewPath.length };
}

export function viewOf(index: AtlasIndex, parentId: string | null): View {
  const parent = parentId === null ? null : (index.byId.get(parentId) ?? null);
  const viewPath = pathTo(index, parent?.id ?? null);
  const inside = childrenOf(index, parent?.id ?? null);

  const ghosts = new Map<string, AtlasNode>();
  const merged = new Map<string, ViewEdge>();
  for (const edge of index.map.edges ?? []) {
    const from = lift(index, viewPath, edge.from);
    const to = lift(index, viewPath, edge.to);
    if (!from || !to || from.id === to.id || (from.ghost && to.ghost)) continue;

    for (const end of [from, to]) {
      const node = index.byId.get(end.id);
      if (end.ghost && node) ghosts.set(end.id, node);
    }
    const key = `${from.id}\u0000${to.id}`;
    const existing = merged.get(key);
    const labels = existing?.labels ?? [];
    const withLabel = edge.label && !labels.includes(edge.label) ? [...labels, edge.label] : labels;
    merged.set(key, { from: from.id, to: to.id, labels: withLabel, kind: existing?.kind ?? edge.kind });
  }

  const toViewNode = (node: AtlasNode, ghost: boolean): ViewNode => ({
    node,
    ghost,
    childCount: childrenOf(index, node.id).length,
  });
  return {
    parent,
    nodes: [
      ...inside.map((node) => toViewNode(node, false)),
      ...[...ghosts.values()].map((node) => toViewNode(node, true)),
    ],
    edges: [...merged.values()],
  };
}

/**
 * The most specific node anchored at `line` of `file`: the one with the
 * narrowest enclosing range. Used to go from a line of code to its visual.
 */
export function nodeAtLine(index: AtlasIndex, file: string, line: number): AtlasNode | undefined {
  let best: { node: AtlasNode; size: number } | undefined;
  for (const node of index.map.nodes) {
    for (const anchor of node.anchors ?? []) {
      if (anchor.file !== file || anchor.startLine === undefined || anchor.endLine === undefined) continue;
      if (line < anchor.startLine || line > anchor.endLine) continue;
      const size = anchor.endLine - anchor.startLine;
      if (!best || size < best.size) best = { node, size };
    }
  }
  return best?.node;
}

export function staleNodes(index: AtlasIndex): AtlasNode[] {
  return index.map.nodes.filter((node) => node.stale === true);
}

export interface Connection {
  /** The node at the other end. */
  node: AtlasNode;
  /** True when the arrow points at the other node. */
  outgoing: boolean;
  labels: string[];
  /** True when at least one of the arrows was drawn by the reader, so it can be removed. */
  isUsers: boolean;
}

/**
 * The arrows that touch `id` directly, grouped by the node at the other end.
 * Arrows drawn between parts deeper inside either node are not included.
 */
export function connectionsOf(index: AtlasIndex, id: string): Connection[] {
  const grouped = new Map<string, Connection>();
  for (const edge of index.map.edges ?? []) {
    if (edge.from !== id && edge.to !== id) continue;
    const outgoing = edge.from === id;
    const other = index.byId.get(outgoing ? edge.to : edge.from);
    if (!other || other.id === id) continue;
    const key = `${outgoing ? '>' : '<'}${other.id}`;
    const seen = grouped.get(key);
    const labels = seen?.labels ?? [];
    grouped.set(key, {
      node: other,
      outgoing,
      labels: edge.label && !labels.includes(edge.label) ? [...labels, edge.label] : labels,
      isUsers: seen?.isUsers === true || edge.user === true,
    });
  }
  return [...grouped.values()].sort((a, b) => Number(a.outgoing) - Number(b.outgoing));
}

/**
 * Nodes matching every word of `query`, best first: a title that starts with
 * the query, then a title containing it, then a match in the id or summary.
 */
export function searchNodes(index: AtlasIndex, query: string, limit: number): AtlasNode[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const phrase = words.join(' ');
  const ranked: { node: AtlasNode; rank: number }[] = [];
  for (const node of index.map.nodes) {
    const title = node.title.toLowerCase();
    const haystack = `${title}\n${node.id.toLowerCase()}\n${(node.summary ?? '').toLowerCase()}`;
    if (!words.every((word) => haystack.includes(word))) continue;
    const rank = title.startsWith(phrase) ? 0 : words.every((word) => title.includes(word)) ? 1 : 2;
    ranked.push({ node, rank });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((entry) => entry.node);
}
