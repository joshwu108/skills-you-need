/** Find a box by name: a text field with a list of matches under it. */

import { clear, h } from './dom';
import type { AtlasIndex } from './graph';
import { pathTo, searchNodes } from './graph';

const MAX_RESULTS = 8;
const LIST_ID = 'atlas-search-results';

export interface Search {
  element: HTMLElement;
  focus(): void;
}

/** `getIndex` is called on each keystroke, so the list follows a map that is reloaded. */
export function createSearch(getIndex: () => AtlasIndex, onPick: (nodeId: string) => void): Search {
  const input = h('input', {
    type: 'search',
    class: 'atlas-search-input',
    placeholder: 'Find a box  /',
    'aria-label': 'Find a box by name',
    role: 'combobox',
    'aria-controls': LIST_ID,
    'aria-expanded': 'false',
    'aria-autocomplete': 'list',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const list = h('ul', { class: 'atlas-search-results', id: LIST_ID, role: 'listbox', 'aria-label': 'Matching boxes' });
  list.hidden = true;
  const element = h('div', { class: 'atlas-search' }, input, list);
  let matches: string[] = [];
  let active = 0;

  const close = (): void => {
    matches = [];
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const mark = (): void => {
    [...list.children].forEach((item, position) => item.setAttribute('aria-selected', String(position === active)));
    if (matches.length > 0) input.setAttribute('aria-activedescendant', `${LIST_ID}-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const pick = (nodeId: string | undefined): void => {
    if (nodeId === undefined) return;
    input.value = '';
    close();
    onPick(nodeId);
  };

  const refresh = (): void => {
    const index = getIndex();
    const found = searchNodes(index, input.value, MAX_RESULTS);
    clear(list);
    matches = found.map((node) => node.id);
    active = 0;
    found.forEach((node, position) => {
      const where = pathTo(index, node.parent).map((ancestor) => ancestor.title).join(' / ');
      const item = h(
        'li',
        { role: 'option', id: `${LIST_ID}-${position}`, class: `atlas-search-result is-${node.kind}` },
        h('span', { class: 'atlas-search-title' }, node.title),
        h('span', { class: 'atlas-search-where' }, where || 'top level'),
      );
      // mousedown, not click: the field must not lose focus (and close the list) first.
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        pick(node.id);
      });
      list.appendChild(item);
    });
    if (input.value.trim() !== '' && found.length === 0) {
      list.appendChild(h('li', { class: 'atlas-search-none', role: 'option', 'aria-disabled': 'true' }, 'No box matches.'));
    }
    list.hidden = input.value.trim() === '';
    input.setAttribute('aria-expanded', String(!list.hidden));
    mark();
  };

  input.addEventListener('input', refresh);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (matches.length === 0) return;
      event.preventDefault();
      active = (active + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length;
      mark();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(matches[active]);
    } else if (event.key === 'Escape' && (input.value !== '' || !list.hidden)) {
      // Handled here so the same press does not also step out of the flow.
      event.preventDefault();
      input.value = '';
      close();
    }
  });

  return { element, focus: () => input.focus() };
}
