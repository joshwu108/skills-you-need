/**
 * The reader's own additions to a map: note boxes and hand-drawn arrows.
 *
 * Like `editMap`, these work on the text of the map file and assume nothing
 * about a request's shape, because requests come from the webview. A note is
 * an ordinary node of kind `note`; an arrow drawn by hand is an ordinary
 * edge marked `user`. Claude is told to leave both alone.
 */

import type { Anchor } from '../../../packages/viewer/src/types';
import { transformMap } from './editMap';
import type { EditResult, MapData } from './editMap';
import { parseAnchor } from './parseMap';

const LABEL_LIMIT = 60;
const HASH = /^[0-9a-f]{16}$/;
const NOTE_PREFIX = 'note.';

type Entry = Record<string, unknown>;

function isEntry(value: unknown): value is Entry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nodeWith(data: MapData, id: unknown): Entry | undefined {
  return typeof id === 'string' ? data.nodes.filter(isEntry).find((node) => node.id === id) : undefined;
}

function edgesOf(data: MapData): unknown[] {
  return Array.isArray(data.edges) ? data.edges : [];
}

/** An id no node has yet, in the form the map validator accepts. */
export function freshNoteId(taken: ReadonlySet<string>, seed: number): string {
  let attempt = seed;
  while (taken.has(`${NOTE_PREFIX}${attempt.toString(36)}`)) attempt += 1;
  return `${NOTE_PREFIX}${attempt.toString(36)}`;
}

export interface NoteRequest {
  /** The flow the note is added to; null is the top level. */
  parent: unknown;
  title: string;
  /** The lines the note is about, already stamped with their hash. */
  anchor?: Anchor;
  /** A node the note is about: an arrow is drawn from the note to it. */
  about?: string;
  /** Makes the generated id repeatable in tests; the clock otherwise. */
  seed?: number;
}

export function addNote(text: string, request: NoteRequest): EditResult & { id?: string } {
  let id = '';
  const result = transformMap(text, (data) => {
    if (request.parent !== null && !nodeWith(data, request.parent)) return 'The flow this note was added to is no longer in the map.';
    const anchor = request.anchor === undefined ? undefined : parseAnchor(request.anchor);
    if (request.anchor !== undefined && (!anchor?.startLine || !HASH.test(anchor.hash ?? ''))) return 'The selected code could not be recorded.';
    const taken = new Set(data.nodes.filter(isEntry).map((node) => String(node.id)));
    id = freshNoteId(taken, request.seed ?? Date.now());
    const note: Entry = { id, parent: request.parent, kind: 'note', title: request.title, ...(anchor ? { anchors: [anchor] } : {}) };
    const about = request.about !== undefined && nodeWith(data, request.about) ? [{ from: id, to: request.about, user: true }] : [];
    return { ...data, nodes: [...data.nodes, note], edges: [...edgesOf(data), ...about] };
  });
  return result.ok ? { ...result, id } : result;
}

/** Only a note can be deleted from the diagram, and only once nothing is inside it. */
export function removeNote(text: string, nodeId: unknown): EditResult {
  return transformMap(text, (data) => {
    const node = nodeWith(data, nodeId);
    if (!node) return 'That note is no longer in the map.';
    if (node.kind !== 'note') return 'Only notes you added can be deleted here. Ask Claude to change the rest of the map.';
    if (data.nodes.some((other) => isEntry(other) && other.parent === nodeId)) return 'This note has boxes inside it. Delete those first.';
    return {
      ...data,
      nodes: data.nodes.filter((other) => other !== node),
      edges: edgesOf(data).filter((edge) => !isEntry(edge) || (edge.from !== nodeId && edge.to !== nodeId)),
    };
  });
}

export function addLink(text: string, from: unknown, to: unknown, label: unknown): EditResult {
  return transformMap(text, (data) => {
    if (!nodeWith(data, from) || !nodeWith(data, to)) return 'One of those boxes is no longer in the map.';
    if (from === to) return 'A box cannot be linked to itself.';
    if (typeof label !== 'string' || label.length > LABEL_LIMIT || /[\r\n]/.test(label)) return `A label is one line of at most ${LABEL_LIMIT} characters.`;
    const text_ = label.trim();
    const isDuplicate = edgesOf(data).some(
      (edge) => isEntry(edge) && edge.from === from && edge.to === to && (edge.label ?? '') === text_,
    );
    if (isDuplicate) return 'Those boxes are already linked that way.';
    const edge = { from, to, ...(text_ ? { label: text_ } : {}), user: true };
    return { ...data, edges: [...edgesOf(data), edge] };
  });
}

/** Removes the arrows the reader drew from `from` to `to`. Claude's arrows are not theirs to remove here. */
export function removeLink(text: string, from: unknown, to: unknown): EditResult {
  return transformMap(text, (data) => {
    const isBetween = (edge: unknown): edge is Entry => isEntry(edge) && edge.from === from && edge.to === to;
    const kept = edgesOf(data).filter((edge) => !isBetween(edge) || edge.user !== true);
    if (kept.length === edgesOf(data).length) {
      return edgesOf(data).some(isBetween)
        ? 'Only links you drew can be removed here. Ask Claude to change the rest of the map.'
        : 'That link is no longer in the map.';
    }
    return { ...data, edges: kept };
  });
}
