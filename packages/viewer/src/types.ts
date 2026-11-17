/** The map file as written by the CodeAtlas skill (`.codeatlas/map.json`). */

export type NodeKind = 'service' | 'module' | 'function' | 'step' | 'data' | 'external';

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
}

export interface AtlasMap {
  version: number;
  title: string;
  summary?: string;
  nodes: AtlasNode[];
  edges?: AtlasEdge[];
}

export interface AtlasData {
  map: AtlasMap;
  /** Absolute path of the repository, used to build editor links. */
  root?: string;
}

/** What the viewer needs from its surroundings (a browser page or a webview). */
export interface Host {
  openAnchor(anchor: Anchor): void;
  /** Called with the focused node id, or null at the top level. */
  onNavigate?(nodeId: string | null): void;
  /** Extra controls placed in the header. */
  toolbar?: HTMLElement;
}
