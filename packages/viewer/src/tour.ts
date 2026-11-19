/**
 * The order a walkthrough visits nodes in.
 *
 * Within one flow the walkthrough starts at the first node the map lists and
 * follows the arrows out of it, as a reader tracing the diagram would; when a
 * trail ends it picks up at the next listed node not yet read. It reads a
 * node, then everything inside it, then moves on within the same flow.
 */

import { viewOf } from './graph';
import type { AtlasIndex, View } from './graph';
import type { AtlasNode } from './types';

/** The view's own nodes (no outside neighbours), in reading order. */
export function flowOrder(view: View): AtlasNode[] {
  const own = view.nodes.filter((entry) => !entry.ghost).map((entry) => entry.node);
  const byId = new Map(own.map((node) => [node.id, node]));
  const listed = new Map(own.map((node, position) => [node.id, position]));
  const targets = new Map<string, AtlasNode[]>();
  for (const edge of view.edges) {
    const to = byId.get(edge.to);
    if (byId.has(edge.from) && to) targets.set(edge.from, [...(targets.get(edge.from) ?? []), to]);
  }

  const ordered: AtlasNode[] = [];
  const seen = new Set<string>();
  // An explicit stack: a long chain of steps must not exhaust the call stack.
  const pending = [...own].reverse();
  while (pending.length > 0) {
    const node = pending.pop() as AtlasNode;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    ordered.push(node);
    const next = [...(targets.get(node.id) ?? [])].sort((a, b) => (listed.get(a.id) ?? 0) - (listed.get(b.id) ?? 0));
    pending.push(...next.reverse());
  }
  return ordered;
}

/**
 * Every node under `startId` (the whole map for null), in reading order.
 * A non-null start is itself the first step.
 */
export function tourOrder(index: AtlasIndex, startId: string | null): string[] {
  const steps: string[] = [];
  const seen = new Set<string>();
  const visit = (viewId: string | null): void => {
    for (const node of flowOrder(viewOf(index, viewId))) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      steps.push(node.id);
      visit(node.id);
    }
  };
  if (startId !== null) {
    if (!index.byId.has(startId)) return [];
    seen.add(startId);
    steps.push(startId);
  }
  visit(startId);
  return steps;
}
