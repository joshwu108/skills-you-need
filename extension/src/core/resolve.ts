/**
 * Finds where an anchor's code is in the text as it stands now.
 *
 * The map records a line range and a hash of those lines. The editor's text
 * may be newer than the map (unsaved edits, or edits made without Claude),
 * so the recorded range is checked against the hash and, if it no longer
 * matches, the block is searched for elsewhere in the file.
 *
 * The hash must match `hash_lines` in the skill's anchors.py exactly:
 * trailing spaces and tabs stripped per line, joined with "\n", SHA-256,
 * first 16 hex characters.
 */

import { createHash } from 'node:crypto';

import type { Anchor } from '../../../packages/viewer/src/types';

const HASH_LENGTH = 16;
/**
 * Looking for a moved block hashes every window of the file, which costs
 * (windows x block length) line reads, and this runs on the extension host
 * as the reader types. Above this the search is skipped and the anchor is
 * reported as changed. Same limit as MAX_SEARCH_WORK in anchors.py.
 */
const MAX_SEARCH_WORK = 400_000;

/** `ok` and `moved` are trustworthy; `changed` means the explanation may be out of date. */
export type AnchorStatus = 'ok' | 'moved' | 'changed' | 'unstamped';

export interface ResolvedAnchor {
  anchor: Anchor;
  /** 1-based, inclusive, and always inside the given text. */
  startLine: number;
  endLine: number;
  status: AnchorStatus;
}

export function hashLines(lines: readonly string[]): string {
  const normalised = lines.map((line) => line.replace(/[ \t]+$/, '')).join('\n');
  return createHash('sha256').update(normalised, 'utf8').digest('hex').slice(0, HASH_LENGTH);
}

function findBlock(lines: readonly string[], length: number, wanted: string, near: number): number | undefined {
  const windows = lines.length - length + 1;
  if (windows <= 0 || windows * length > MAX_SEARCH_WORK) return undefined;
  let best: number | undefined;
  for (let start = 0; start < windows; start += 1) {
    if (hashLines(lines.slice(start, start + length)) !== wanted) continue;
    const line = start + 1;
    if (best === undefined || Math.abs(line - near) < Math.abs(best - near)) best = line;
  }
  return best;
}

/** Returns undefined for an anchor with no line range, or for empty text. */
export function resolveAnchor(lines: readonly string[], anchor: Anchor): ResolvedAnchor | undefined {
  const { startLine, endLine, hash } = anchor;
  if (startLine === undefined || endLine === undefined || lines.length === 0) return undefined;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    return undefined;
  }

  const clampedStart = Math.min(startLine, lines.length);
  const clamped = { startLine: clampedStart, endLine: Math.max(clampedStart, Math.min(endLine, lines.length)) };
  if (hash === undefined) return { anchor, ...clamped, status: 'unstamped' };

  if (endLine <= lines.length && hashLines(lines.slice(startLine - 1, endLine)) === hash) {
    return { anchor, startLine, endLine, status: 'ok' };
  }
  const length = endLine - startLine + 1;
  const movedTo = findBlock(lines, length, hash, startLine);
  if (movedTo !== undefined) {
    return { anchor, startLine: movedTo, endLine: movedTo + length - 1, status: 'moved' };
  }
  return { anchor, ...clamped, status: 'changed' };
}
