/** The map file as written by the CodeAtlas skill (`.codeatlas/map.json`). */

/** `note` is a box the reader added themselves; the others are written by Claude. */
export type NodeKind = 'service' | 'module' | 'function' | 'step' | 'data' | 'external' | 'note';

export const NODE_KINDS: readonly NodeKind[] = ['service', 'module', 'function', 'step', 'data', 'external', 'note'];

export interface Anchor {
  /** Repository-relative path with forward slashes. */
  file: string;
  symbol?: string;
  /** 1-based, inclusive. Present once the map has been stamped. */
  startLine?: number;
  endLine?: number;
  hash?: string;
}

export interface AtlasNode {
  id: string;
  parent: string | null;
  kind: NodeKind;
  title: string;
  summary?: string;
  explanation?: string;
  anchors?: Anchor[];
  /** Designed but not written yet. */
  planned?: boolean;
  /** The anchored code changed after the explanation was written. */
  stale?: boolean;
  staleReason?: string;
}

export interface AtlasEdge {
  from: string;
  to: string;
  label?: string;
  kind?: 'call' | 'data' | 'event';
  /** Drawn by the reader, not by Claude. */
  user?: boolean;
}

export interface AtlasMap {
  version: number;
  title: string;
  summary?: string;
  nodes: AtlasNode[];
  edges?: AtlasEdge[];
}

export interface Point {
  x: number;
  y: number;
}

/** Hand-placed boxes in one view: node id to the top-left corner of its box. */
export type ViewPositions = Record<string, Point>;

/**
 * Where the reader dragged boxes to (`.codeatlas/layout.json`). Kept apart
 * from the map so rearranging a diagram never touches what Claude wrote.
 * Views are keyed by the id of the node whose flow they show.
 */
export interface AtlasLayout {
  version: number;
  views: Record<string, ViewPositions>;
}

/** The text of a node a reader may change from the diagram. */
export interface NodeChanges {
  title?: string;
  kind?: NodeKind;
  summary?: string;
  explanation?: string;
}

export interface AtlasData {
  map: AtlasMap;
  layout?: AtlasLayout;
  /** Absolute path of the repository, used to build editor links. */
  root?: string;
}
