/**
 * Reads a map file defensively.
 *
 * The skill's validator is the authority on what a good map is; this only
 * keeps a damaged or hand-edited file from breaking the editor. A file that
 * is not a map at all is rejected. Individual malformed nodes, anchors and
 * edges are dropped and counted, so the rest of the map still works.
 *
 * Anchor paths are joined to the workspace folder and opened, so a path that
 * is absolute or climbs out with `..` is always dropped.
 */

import { isSafeRelativePath } from '../../../packages/viewer/src/links';
import { NODE_KINDS } from '../../../packages/viewer/src/types';
import type { Anchor, AtlasEdge, AtlasMap, AtlasNode, NodeKind } from '../../../packages/viewer/src/types';

export { isSafeRelativePath };

const SUPPORTED_VERSION = 1;
const KINDS: readonly string[] = NODE_KINDS;

export type ParseResult = { ok: true; map: AtlasMap; dropped: number } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLine(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

export function parseAnchor(value: unknown): Anchor | undefined {
  if (!isRecord(value) || !isSafeRelativePath(value.file)) return undefined;
  const anchor: Anchor = { file: value.file };
  if (typeof value.symbol === 'string') anchor.symbol = value.symbol;
  if (isLine(value.startLine) && isLine(value.endLine) && value.startLine <= value.endLine) {
    anchor.startLine = value.startLine;
    anchor.endLine = value.endLine;
  }
  if (typeof value.hash === 'string') anchor.hash = value.hash;
  return anchor;
}

function parseNode(value: unknown): { node: AtlasNode; dropped: number } | undefined {
  if (!isRecord(value)) return undefined;
  const { id, title, kind, parent } = value;
  if (typeof id !== 'string' || id === '' || typeof title !== 'string' || !KINDS.includes(kind as string)) {
    return undefined;
  }
  const rawAnchors = Array.isArray(value.anchors) ? value.anchors : [];
  const anchors = rawAnchors.map(parseAnchor).filter((anchor): anchor is Anchor => anchor !== undefined);
  const node: AtlasNode = {
    id,
    title,
    kind: kind as NodeKind,
    parent: typeof parent === 'string' ? parent : null,
    anchors,
  };
  if (typeof value.summary === 'string') node.summary = value.summary;
  if (typeof value.explanation === 'string') node.explanation = value.explanation;
  if (value.planned === true) node.planned = true;
  if (value.stale === true) node.stale = true;
  if (typeof value.staleReason === 'string') node.staleReason = value.staleReason;
  return { node, dropped: rawAnchors.length - anchors.length };
}

export function parseMap(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `The map is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isRecord(data)) return { ok: false, error: 'The map must be a JSON object.' };
  if (data.version !== SUPPORTED_VERSION) {
    return {
      ok: false,
      error: `This map is version ${JSON.stringify(data.version)}; this extension reads version ${SUPPORTED_VERSION}. Update the extension or rebuild the map.`,
    };
  }
  if (!Array.isArray(data.nodes)) return { ok: false, error: 'The map has no "nodes" list.' };

  let dropped = 0;
  const nodes: AtlasNode[] = [];
  const ids = new Set<string>();
  for (const raw of data.nodes) {
    const parsed = parseNode(raw);
    if (!parsed || ids.has(parsed.node.id)) {
      dropped += 1;
      continue;
    }
    ids.add(parsed.node.id);
    nodes.push(parsed.node);
    dropped += parsed.dropped;
  }
  if (nodes.length === 0) return { ok: false, error: 'The map has no usable nodes.' };

  const edges: AtlasEdge[] = [];
  for (const raw of Array.isArray(data.edges) ? data.edges : []) {
    if (isRecord(raw) && typeof raw.from === 'string' && typeof raw.to === 'string' && ids.has(raw.from) && ids.has(raw.to) && raw.from !== raw.to) {
      edges.push({ from: raw.from, to: raw.to, ...(typeof raw.label === 'string' ? { label: raw.label } : {}) });
    } else {
      dropped += 1;
    }
  }

  const map: AtlasMap = {
    version: SUPPORTED_VERSION,
    title: typeof data.title === 'string' && data.title !== '' ? data.title : 'Code map',
    nodes,
    edges,
  };
  if (typeof data.summary === 'string') map.summary = data.summary;
  return { ok: true, map, dropped };
}
