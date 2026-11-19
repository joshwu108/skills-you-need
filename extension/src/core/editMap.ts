/**
 * Applies an edit made in the diagram to the text of a map file.
 *
 * The request comes from the webview, so nothing about its shape is assumed.
 * Only the four text fields a reader may change are touched; everything else
 * in the file, including fields this extension does not know, is written
 * back as it was. Output matches the skill's own formatting (two-space
 * indent, trailing newline) so an edit shows up as a small diff.
 */

import { NODE_KINDS } from '../../../packages/viewer/src/types';
import type { NodeChanges, NodeKind } from '../../../packages/viewer/src/types';

const KINDS: readonly string[] = NODE_KINDS;
const TITLE_LIMIT = 120;
/** The skill's validator rejects longer summaries. */
const SUMMARY_LIMIT = 160;
const EXPLANATION_LIMIT = 20_000;

export type EditResult = { ok: true; text: string } | { ok: false; error: string };

/** A parsed map file: an object with a `nodes` list and whatever else it holds. */
export type MapData = Record<string, unknown> & { nodes: unknown[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The requested changes, checked; or the reason they are not acceptable. */
export function parseChanges(value: unknown): { changes: NodeChanges } | { error: string } {
  if (!isRecord(value)) return { error: 'The edit is not in the expected format.' };
  const changes: NodeChanges = {};
  const { title, kind, summary, explanation } = value;
  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim() === '') return { error: 'A box needs a name.' };
    if (title.length > TITLE_LIMIT || /[\r\n]/.test(title)) return { error: `A name is one line of at most ${TITLE_LIMIT} characters.` };
    changes.title = title.trim();
  }
  if (kind !== undefined) {
    if (typeof kind !== 'string' || !KINDS.includes(kind)) return { error: `The kind must be one of: ${KINDS.join(', ')}.` };
    changes.kind = kind as NodeKind;
  }
  if (summary !== undefined) {
    if (typeof summary !== 'string' || summary.length > SUMMARY_LIMIT) return { error: `A summary is at most ${SUMMARY_LIMIT} characters.` };
    changes.summary = summary.trim();
  }
  if (explanation !== undefined) {
    if (typeof explanation !== 'string' || explanation.length > EXPLANATION_LIMIT) return { error: 'The explanation is too long.' };
    changes.explanation = explanation.trim();
  }
  if (Object.keys(changes).length === 0) return { error: 'Nothing to change.' };
  return { changes };
}

/** A copy of `node` with `changes` applied; an emptied optional field is removed. */
function editedNode(node: Record<string, unknown>, changes: NodeChanges): Record<string, unknown> {
  const next: Record<string, unknown> = { ...node };
  if (changes.title !== undefined) next.title = changes.title;
  if (changes.kind !== undefined) next.kind = changes.kind;
  for (const field of ['summary', 'explanation'] as const) {
    const value = changes[field];
    if (value === undefined) continue;
    if (value === '') delete next[field];
    else next[field] = value;
  }
  return next;
}

/**
 * Parse the map text, apply `change`, and serialise it the way the skill
 * does. `change` returns the new map, or a sentence saying why not; it must
 * not modify the map it is given.
 */
export function transformMap(text: string, change: (data: MapData) => MapData | string): EditResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The map file is not valid JSON, so it was left alone. Ask Claude to repair it.' };
  }
  if (!isRecord(data) || !Array.isArray(data.nodes)) {
    return { ok: false, error: 'The map file is not in the expected format, so it was left alone.' };
  }
  const changed = change(data as MapData);
  if (typeof changed === 'string') return { ok: false, error: changed };
  return { ok: true, text: `${JSON.stringify(changed, null, 2)}\n` };
}

export function applyNodeEdit(text: string, nodeId: unknown, rawChanges: unknown): EditResult {
  const parsed = parseChanges(rawChanges);
  if ('error' in parsed) return { ok: false, error: parsed.error };
  if (typeof nodeId !== 'string') return { ok: false, error: 'The edit does not say which box it is for.' };
  return transformMap(text, (data) => {
    const position = data.nodes.findIndex((node) => isRecord(node) && node.id === nodeId);
    if (position < 0) return 'That box is no longer in the map. It may have been renamed or removed.';
    const current = (data.nodes[position] as Record<string, unknown>).kind;
    const next = parsed.changes.kind;
    if (next !== undefined && next !== current && (next === 'note' || current === 'note')) {
      return 'A note stays a note, and other boxes cannot become notes.';
    }
    const nodes = data.nodes.map((node, at) => (at === position ? editedNode(node as Record<string, unknown>, parsed.changes) : node));
    return { ...data, nodes };
  });
}
