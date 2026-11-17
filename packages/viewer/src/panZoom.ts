/**
 * Pan and zoom for the diagram: one CSS transform on the stage.
 *
 * The view re-fits itself when the window resizes until the reader pans or
 * zooms. After that their position is theirs and is left alone until they
 * press Fit or move to another level.
 */

const MIN_SCALE = 0.25;
const MAX_SCALE = 2;
/** Fitting never shrinks text below this; a larger flow is panned instead. */
const MIN_FIT_SCALE = 0.6;
const WHEEL_ZOOM_RATE = 0.0025;
const FIT_PADDING = 24;
/** Movement below this many pixels is a click, not a drag. */
const DRAG_THRESHOLD = 4;

interface Transform {
  x: number;
  y: number;
  scale: number;
}

interface Drag {
  pointer: number;
  startX: number;
  startY: number;
  origin: Transform;
  moved: boolean;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export class PanZoom {
  private transform: Transform = { x: 0, y: 0, scale: 1 };
  private content = { width: 0, height: 0 };
  private autoFit = true;
  private drag: Drag | null = null;
  private readonly observer: ResizeObserver | null;

  constructor(
    private readonly viewport: HTMLElement,
    private readonly stage: HTMLElement,
  ) {
    viewport.addEventListener('wheel', this.onWheel, { passive: false });
    viewport.addEventListener('pointerdown', this.onPointerDown);
    viewport.addEventListener('pointermove', this.onPointerMove);
    viewport.addEventListener('pointerup', this.endDrag);
    viewport.addEventListener('pointercancel', this.endDrag);
    this.observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (this.autoFit) this.fit();
          });
    this.observer?.observe(viewport);
  }

  /** False once the reader has panned or zoomed. */
  get isAutoFit(): boolean {
    return this.autoFit;
  }

  setContentSize(width: number, height: number): void {
    this.content = { width, height };
  }

  /** Scale the content to the viewport and centre it. */
  fit(): void {
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    const roomX = width - FIT_PADDING * 2;
    const roomY = height - FIT_PADDING * 2;
    const scale =
      this.content.width > 0 && roomX > 0 && roomY > 0
        ? clamp(Math.min(roomX / this.content.width, roomY / this.content.height), MIN_FIT_SCALE, 1)
        : 1;
    this.autoFit = true;
    this.apply({
      scale,
      // A flow too large to fit starts at its top-left corner, not off-screen.
      x: Math.max(FIT_PADDING, (width - this.content.width * scale) / 2),
      y: Math.max(FIT_PADDING, (height - this.content.height * scale) / 2),
    });
  }

  /** Zoom about the centre of the viewport. */
  zoomBy(factor: number): void {
    this.zoomAt(factor, this.viewport.clientWidth / 2, this.viewport.clientHeight / 2);
  }

  destroy(): void {
    this.observer?.disconnect();
    this.viewport.removeEventListener('wheel', this.onWheel);
    this.viewport.removeEventListener('pointerdown', this.onPointerDown);
    this.viewport.removeEventListener('pointermove', this.onPointerMove);
    this.viewport.removeEventListener('pointerup', this.endDrag);
    this.viewport.removeEventListener('pointercancel', this.endDrag);
  }

  private apply(next: Transform): void {
    this.transform = next;
    this.stage.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
  }

  private zoomAt(factor: number, originX: number, originY: number): void {
    const { x, y, scale: current } = this.transform;
    const scale = clamp(current * factor, MIN_SCALE, MAX_SCALE);
    const ratio = scale / current;
    this.autoFit = false;
    this.apply({ scale, x: originX - (originX - x) * ratio, y: originY - (originY - y) * ratio });
  }

  /** Scrolling pans; pinching (or scrolling with Ctrl or Cmd held) zooms at the pointer. */
  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const bounds = this.viewport.getBoundingClientRect();
      this.zoomAt(Math.exp(-event.deltaY * WHEEL_ZOOM_RATE), event.clientX - bounds.left, event.clientY - bounds.top);
      return;
    }
    this.autoFit = false;
    this.apply({ ...this.transform, x: this.transform.x - event.deltaX, y: this.transform.y - event.deltaY });
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    this.drag = {
      pointer: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: this.transform,
      moved: false,
    };
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      this.viewport.setPointerCapture?.(event.pointerId);
      this.viewport.classList.add('is-panning');
    }
    this.autoFit = false;
    this.apply({ ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy });
  };

  private readonly endDrag = (): void => {
    this.drag = null;
    this.viewport.classList.remove('is-panning');
  };
}
