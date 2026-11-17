/** Which map nodes describe which lines of one file. */

import type { AtlasMap, AtlasNode } from '../../../packages/viewer/src/types';
import { resolveAnchor } from './resolve';
import type { ResolvedAnchor } from './resolve';

export interface LocatedNode {
  node: AtlasNode;
  resolved: ResolvedAnchor;
}

/** Every anchor in `file`, resolved against `lines`, outermost first. */
export function locate(map: AtlasMap, file: string, lines: readonly string[]): LocatedNode[] {
  const located: LocatedNode[] = [];
  for (const node of map.nodes) {
    for (const anchor of node.anchors ?? []) {
      if (anchor.file !== file) continue;
      const resolved = resolveAnchor(lines, anchor);
      if (resolved) located.push({ node, resolved });
    }
  }
  return located.sort(
    (a, b) => a.resolved.startLine - b.resolved.startLine || b.resolved.endLine - a.resolved.endLine,
  );
}

/** The most specific node covering `line` (1-based): the one with the narrowest range. */
export function narrowestAt(located: readonly LocatedNode[], line: number): LocatedNode | undefined {
  let best: LocatedNode | undefined;
  for (const candidate of located) {
    const { startLine, endLine } = candidate.resolved;
    if (line < startLine || line > endLine) continue;
    if (!best || endLine - startLine < best.resolved.endLine - best.resolved.startLine) best = candidate;
  }
  return best;
}

export function isOutOfDate({ node, resolved }: LocatedNode): boolean {
  return node.stale === true || resolved.status === 'changed';
}
