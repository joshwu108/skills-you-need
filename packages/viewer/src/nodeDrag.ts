/**
 * Moving boxes by hand: drag with the pointer, or Alt plus an arrow key.
 *
 * A press that does not travel stays a click, so a box still opens when
 * pressed. A press that does travel moves the box and swallows the click the
 * browser sends when it is released.
 */

import { GRID, snap } from './positions';
import type { Point } from './types';

/** Movement below this many screen pixels is a click, not a drag. */
const DRAG_THRESHOLD = 4;
const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -GRID, y: 0 },
  ArrowRight: { x: GRID, y: 0 },
  ArrowUp: { x: 0, y: -GRID },
  ArrowDown: { x: 0, y: GRID },
};

export interface DragHost {
  /** Screen pixels per diagram pixel. */
  scale(): number;
  /** The current top-left corner of a box, or undefined for an unknown id. */
  positionOf(nodeId: string): Point | undefined;
  /** The box is over `point` but has not been released. */
  onDrag(nodeId: string, point: Point): void;
  /** The box was released at `point`. */
  onDrop(nodeId: string, point: Point): void;
}

interface Drag {
  pointer: number;
  nodeId: string;
  element: HTMLElement;
  startX: number;
  startY: number;
  origin: Point;
  latest: Point;
  moved: boolean;
}

function nodeOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('.atlas-node') : null;
}

export interface NodeDrag {
  /** Abandon a drag in progress; its box goes back to where it started. */
  cancel(): void;
  detach(): void;
}

/** Attach to the element containing the boxes. */
export function enableNodeDrag(flow: HTMLElement, host: DragHost): NodeDrag {
  let drag: Drag | null = null;

  const cancel = (): void => {
    const abandoned = drag;
    drag = null;
    if (!abandoned?.moved) return;
    abandoned.element.classList.remove('is-dragging');
    host.onDrop(abandoned.nodeId, abandoned.origin);
  };

  const onPointerDown = (event: PointerEvent): void => {
    const element = nodeOf(event.target);
    const nodeId = element?.dataset.node;
    const origin = nodeId === undefined ? undefined : host.positionOf(nodeId);
    // One drag at a time: a second finger must not orphan the first.
    if (drag || event.button !== 0 || !element || nodeId === undefined || !origin) return;
    drag = { pointer: event.pointerId, nodeId, element, startX: event.clientX, startY: event.clientY, origin, latest: origin, moved: false };
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointer) return;
    if (event.buttons === 0) {
      // The button was released somewhere this element did not see.
      cancel();
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.element.setPointerCapture?.(event.pointerId);
      drag.element.classList.add('is-dragging');
    }
    const scale = host.scale() || 1;
    drag.latest = { x: snap(drag.origin.x + dx / scale), y: snap(drag.origin.y + dy / scale) };
    host.onDrag(drag.nodeId, drag.latest);
  };

  const swallowClick = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  const onPointerUp = (event: PointerEvent): void => {
    const finished = drag;
    if (!finished || event.pointerId !== finished.pointer) return;
    drag = null;
    if (!finished.moved) return;
    finished.element.classList.remove('is-dragging');
    // The click that follows a drag must not open the box.
    flow.addEventListener('click', swallowClick, { capture: true, once: true });
    setTimeout(() => flow.removeEventListener('click', swallowClick, { capture: true }), 0);
    if (event.type === 'pointercancel') host.onDrop(finished.nodeId, finished.origin);
    else host.onDrop(finished.nodeId, finished.latest);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const step = event.altKey ? ARROWS[event.key] : undefined;
    const nodeId = nodeOf(event.target)?.dataset.node;
    const origin = nodeId === undefined ? undefined : host.positionOf(nodeId);
    if (!step || nodeId === undefined || !origin) return;
    event.preventDefault();
    event.stopPropagation();
    host.onDrop(nodeId, { x: snap(origin.x + step.x), y: snap(origin.y + step.y) });
  };

  flow.addEventListener('pointerdown', onPointerDown);
  flow.addEventListener('pointermove', onPointerMove);
  flow.addEventListener('pointerup', onPointerUp);
  flow.addEventListener('pointercancel', onPointerUp);
  flow.addEventListener('keydown', onKeyDown);
  const detach = (): void => {
    flow.removeEventListener('pointerdown', onPointerDown);
    flow.removeEventListener('pointermove', onPointerMove);
    flow.removeEventListener('pointerup', onPointerUp);
    flow.removeEventListener('pointercancel', onPointerUp);
    flow.removeEventListener('keydown', onKeyDown);
  };
  return { cancel, detach };
}
