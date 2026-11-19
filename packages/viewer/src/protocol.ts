/** Messages between the VS Code extension and the viewer running in its webview. */

import type { Anchor, AtlasData, NodeChanges, ViewPositions } from './types';

export type ToWebview =
  /**
   * A new or changed map. `focus` is the node to show, or undefined to keep
   * the current one; `edit` opens that node's edit form.
   */
  | { type: 'map'; data: AtlasData; focus?: string | null; edit?: boolean }
  | { type: 'focus'; nodeId: string | null }
  | { type: 'error'; message: string };

export type FromWebview =
  /** The webview has loaded and can receive a map. */
  | { type: 'ready' }
  | { type: 'open'; anchor: Anchor }
  /** Show code beside the diagram, leaving focus where it is. */
  | { type: 'reveal'; anchor: Anchor }
  | { type: 'navigate'; nodeId: string | null }
  /** The reader moved boxes in one view; an empty set restores the automatic layout. */
  | { type: 'positions'; view: string | null; positions: ViewPositions }
  | { type: 'edit'; nodeId: string; changes: NodeChanges }
  | { type: 'addNote'; parent: string | null }
  | { type: 'removeNote'; nodeId: string }
  | { type: 'addLink'; from: string; to: string; label: string }
  | { type: 'removeLink'; from: string; to: string };
