/**
 * The walkthrough strip under the diagram: where the reader is in the
 * sequence, what comes next, and whether the code should follow along.
 */

import { h } from './dom';
import type { AtlasNode } from './types';

export interface TourBarHandlers {
  onStep(delta: 1 | -1): void;
  onExit(): void;
  /** Called when the reader turns "follow in code" on or off. */
  onFollow(isFollowing: boolean): void;
}

export interface TourBar {
  element: HTMLElement;
  /** Show step `position` (0-based) of `total`; `next` is undefined on the last step. */
  show(position: number, total: number, current: AtlasNode, next: AtlasNode | undefined): void;
  hide(): void;
}

export function createTourBar(handlers: TourBarHandlers, canFollowCode: boolean): TourBar {
  const count = h('span', { class: 'atlas-tour-count' });
  const title = h('span', { class: 'atlas-tour-title' });
  const meter = h('span', { class: 'atlas-tour-meter', 'aria-hidden': 'true' }, h('span', {}));
  const back = h('button', { type: 'button', class: 'atlas-tour-back', title: 'Previous step (left arrow)' }, 'Back');
  const forward = h('button', { type: 'button', class: 'atlas-tour-next', title: 'Next step (right arrow)' });
  const exit = h('button', { type: 'button', class: 'atlas-tour-exit', title: 'Leave the walkthrough (Escape)' }, 'Done');
  const follow = h('input', { type: 'checkbox', id: 'atlas-tour-follow' });
  const followLabel = h('label', { class: 'atlas-tour-follow', for: 'atlas-tour-follow' }, follow, 'Show code as I go');

  back.addEventListener('click', () => handlers.onStep(-1));
  forward.addEventListener('click', () => handlers.onStep(1));
  exit.addEventListener('click', () => handlers.onExit());
  follow.addEventListener('change', () => handlers.onFollow(follow.checked));

  const element = h(
    'div',
    { class: 'atlas-tour', role: 'region', 'aria-label': 'Walkthrough' },
    meter,
    h('p', { class: 'atlas-tour-where', 'aria-live': 'polite' }, count, title),
    canFollowCode && followLabel,
    h('div', { class: 'atlas-tour-buttons' }, back, forward, exit),
  );
  element.hidden = true;

  return {
    element,
    show(position, total, current, next) {
      element.hidden = false;
      count.textContent = `Step ${position + 1} of ${total}`;
      title.textContent = current.title;
      (meter.firstElementChild as HTMLElement).style.transform = `scaleX(${(position + 1) / total})`;
      back.disabled = position === 0;
      forward.disabled = next === undefined;
      forward.textContent = next ? `Next: ${next.title}` : 'End of walkthrough';
    },
    hide() {
      element.hidden = true;
    },
  };
}
