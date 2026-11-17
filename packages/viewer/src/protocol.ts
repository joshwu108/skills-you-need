/** Messages between the VS Code extension and the viewer running in its webview. */

import type { Anchor, AtlasData } from './types';

export type ToWebview =
  /** A new or changed map. `focus` is the node to show, or undefined to keep the current one. */
  | { type: 'map'; data: AtlasData; focus?: string | null }
  | { type: 'focus'; nodeId: string | null }
  | { type: 'error'; message: string };

export type FromWebview =
  /** The webview has loaded and can receive a map. */
  | { type: 'ready' }
  | { type: 'open'; anchor: Anchor }
  | { type: 'navigate'; nodeId: string | null };
