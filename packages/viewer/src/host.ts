import type { Anchor, NodeChanges, ViewPositions } from './types';

/**
 * What the viewer needs from its surroundings (a browser page or a webview).
 * Optional members are capabilities: the viewer hides the matching control
 * where one is absent.
 */
export interface Host {
  openAnchor(anchor: Anchor): void;
  /** Show code beside the diagram without taking focus from it. */
  revealAnchor?(anchor: Anchor): void;
  /** Called with the focused node id, or null at the top level. */
  onNavigate?(nodeId: string | null): void;
  /** Keep the boxes the reader placed by hand in one view (null is the top level). */
  savePositions?(viewId: string | null, positions: ViewPositions): void;
  /** Write edited text back to the map. Absent where the map is read-only. */
  saveNode?(nodeId: string, changes: NodeChanges): void;
  /** Add an empty note box to a flow (null is the top level). */
  addNote?(viewId: string | null): void;
  /** Delete a note box the reader added. */
  removeNote?(nodeId: string): void;
  /** Draw an arrow between two boxes. */
  addLink?(from: string, to: string, label: string): void;
  /** Remove the arrows that run from one box to another. */
  removeLink?(from: string, to: string): void;
  /** Extra controls placed in the header. */
  toolbar?: HTMLElement;
}
