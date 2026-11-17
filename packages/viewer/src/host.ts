import type { Anchor } from './types';

/** What the viewer needs from its surroundings (a browser page or a webview). */
export interface Host {
  openAnchor(anchor: Anchor): void;
  /** Called with the focused node id, or null at the top level. */
  onNavigate?(nodeId: string | null): void;
  /** Extra controls placed in the header. */
  toolbar?: HTMLElement;
}
