/**
 * Hand-placed box positions, read defensively.
 *
 * The layout file is written by the viewer but lives in the repository, so
 * it is treated like any other file content: entries of the wrong shape are
 * dropped, and lookups never reach inherited object properties.
 */

import type { AtlasLayout, Point, ViewPositions } from './types';

export const LAYOUT_VERSION = 1;
/** The key for the top-level view. Node ids cannot start with a colon. */
export const ROOT_VIEW = ':root';
/** Boxes snap to this many pixels, so hand-placed rows and columns line up. */
export const GRID = 8;
const MAX_COORDINATE = 20_000;
const MAX_VIEWS = 2_000;
const MAX_NODES_PER_VIEW = 500;

export const EMPTY_LAYOUT: AtlasLayout = { version: LAYOUT_VERSION, views: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

export function viewKey(viewId: string | null): string {
  return viewId ?? ROOT_VIEW;
}

/** A coordinate on the grid, inside the drawable area. */
export function snap(value: number): number {
  const snapped = Math.round(value / GRID) * GRID;
  return Math.min(MAX_COORDINATE, Math.max(0, snapped));
}

function parsePoint(value: unknown): Point | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y } = value;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x: snap(x), y: snap(y) };
}

export function parsePositions(value: unknown): ViewPositions {
  if (!isRecord(value)) return {};
  const entries: [string, Point][] = [];
  for (const [id, raw] of Object.entries(value).slice(0, MAX_NODES_PER_VIEW)) {
    const point = parsePoint(raw);
    if (point) entries.push([id, point]);
  }
  return Object.fromEntries(entries);
}

/** Never throws: anything that is not a layout reads as an empty one. */
export function parseLayout(value: unknown): AtlasLayout {
  if (!isRecord(value) || value.version !== LAYOUT_VERSION || !isRecord(value.views)) return EMPTY_LAYOUT;
  const views: [string, ViewPositions][] = [];
  for (const [key, raw] of Object.entries(value.views).slice(0, MAX_VIEWS)) {
    const positions = parsePositions(raw);
    if (Object.keys(positions).length > 0) views.push([key, positions]);
  }
  return { version: LAYOUT_VERSION, views: Object.fromEntries(views) };
}

export function positionsFor(layout: AtlasLayout, viewId: string | null): ViewPositions {
  return own(layout.views, viewKey(viewId)) ?? {};
}

export function positionOf(positions: ViewPositions, nodeId: string): Point | undefined {
  return own(positions, nodeId);
}

/**
 * A copy of `layout` with one view's positions replaced. An empty set removes
 * the view. Other views keep their order, so saving one drag is a small diff.
 */
export function withPositions(layout: AtlasLayout, viewId: string | null, positions: ViewPositions): AtlasLayout {
  const key = viewKey(viewId);
  const isEmpty = Object.keys(positions).length === 0;
  const entries = Object.entries(layout.views);
  const kept = entries.flatMap(([existing, value]): [string, ViewPositions][] => {
    if (existing !== key) return [[existing, value]];
    return isEmpty ? [] : [[key, positions]];
  });
  const isNew = !isEmpty && !entries.some(([existing]) => existing === key);
  return { version: LAYOUT_VERSION, views: Object.fromEntries(isNew ? [...kept, [key, positions]] : kept) };
}

/** Views from `over` replace the same views in `base`. */
export function mergeLayouts(base: AtlasLayout, over: AtlasLayout): AtlasLayout {
  return { version: LAYOUT_VERSION, views: Object.fromEntries([...Object.entries(base.views), ...Object.entries(over.views)]) };
}
