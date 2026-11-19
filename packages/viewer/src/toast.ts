/** A short message at the bottom of the page that goes away on its own. */

import { h } from './dom';

const VISIBLE_MS = 9000;

export interface Toast {
  element: HTMLElement;
  show(message: string): void;
}

export function createToast(): Toast {
  const text = h('span', {});
  const dismiss = h('button', { type: 'button', class: 'atlas-toast-close', 'aria-label': 'Dismiss' }, '×');
  const element = h('div', { class: 'atlas-toast', role: 'status' }, text, dismiss);
  element.hidden = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = (): void => {
    element.hidden = true;
  };
  dismiss.addEventListener('click', hide);
  return {
    element,
    show(message) {
      text.textContent = message;
      element.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(hide, VISIBLE_MS);
    },
  };
}
