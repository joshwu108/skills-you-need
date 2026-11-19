/** Drawing an arrow by hand: pick a direction, the box at the other end, and a label. */

import { h } from './dom';
import type { AtlasIndex } from './graph';
import { pathTo } from './graph';
import type { AtlasNode } from './types';

export const LINK_LABEL_LIMIT = 60;

/** Every other node, named by its place in the map so equal titles can be told apart. */
function targets(index: AtlasIndex, node: AtlasNode): HTMLOptionElement[] {
  return index.map.nodes
    .filter((other) => other.id !== node.id)
    .map((other) => ({ id: other.id, name: pathTo(index, other.id).map((step) => step.title).join(' / ') }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ id, name }) => h('option', { value: id }, name));
}

export function createLinkForm(
  index: AtlasIndex,
  node: AtlasNode,
  onAdd: (from: string, to: string, label: string) => void,
): HTMLElement {
  const way = h(
    'select',
    { 'aria-label': 'Direction of the arrow' },
    h('option', { value: 'to' }, 'to'),
    h('option', { value: 'from' }, 'from'),
  );
  const other = h('select', { 'aria-label': 'The box at the other end', required: '' }, ...targets(index, node));
  const label = h('input', {
    type: 'text',
    maxlength: String(LINK_LABEL_LIMIT),
    placeholder: 'what flows along it (optional)',
    'aria-label': 'Label for the arrow',
  });
  const form = h(
    'form',
    { class: 'atlas-link-form', 'aria-label': `Link ${node.title} to another box` },
    h('div', { class: 'atlas-link-ends' }, way, other),
    label,
    h('button', { type: 'submit', class: 'atlas-button' }, 'Add link'),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (other.value === '') return;
    const isOutgoing = way.value === 'to';
    onAdd(isOutgoing ? node.id : other.value, isOutgoing ? other.value : node.id, label.value.trim());
  });
  return form;
}
