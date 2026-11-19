/**
 * Editing a box's words in place: its name, kind, one-line summary and
 * explanation. The form only reports what changed; writing the map is the
 * host's job, and the host re-sends the map once the file is written.
 */

import { h } from './dom';
import { NODE_KINDS } from './types';
import type { AtlasNode, NodeChanges, NodeKind } from './types';

export const TITLE_LIMIT = 120;
/** The map validator rejects longer summaries. */
export const SUMMARY_LIMIT = 160;

let fieldCount = 0;

/** A labelled control. The hint describes it without becoming part of its name. */
function field(label: string, control: HTMLElement, hint?: HTMLElement | string): HTMLElement {
  fieldCount += 1;
  const hintId = `atlas-field-hint-${fieldCount}`;
  if (hint) control.setAttribute('aria-describedby', hintId);
  return h(
    'div',
    { class: 'atlas-field' },
    h('label', { class: 'atlas-field-name' }, h('span', { class: 'atlas-field-label' }, label), control),
    hint && h('span', { class: 'atlas-field-hint', id: hintId }, hint),
  );
}

/** Only the fields whose text differs from the node's. */
function changesFrom(node: AtlasNode, draft: Required<NodeChanges>): NodeChanges {
  const changes: NodeChanges = {};
  if (draft.title !== node.title) changes.title = draft.title;
  if (draft.kind !== node.kind) changes.kind = draft.kind;
  if (draft.summary !== (node.summary ?? '')) changes.summary = draft.summary;
  if (draft.explanation !== (node.explanation ?? '')) changes.explanation = draft.explanation;
  return changes;
}

export function createEditForm(
  node: AtlasNode,
  onSave: (changes: NodeChanges) => void,
  onCancel: () => void,
): HTMLFormElement {
  const title = h('input', { type: 'text', required: '', maxlength: String(TITLE_LIMIT), value: node.title });
  // A note stays a note, and nothing else can become one: the kind is what marks a box as the reader's.
  const isNote = node.kind === 'note';
  const kinds = NODE_KINDS.filter((name) => (name === 'note') === isNote);
  const kind = h('select', {}, ...kinds.map((name) => h('option', { value: name }, name)));
  kind.value = node.kind;
  const summary = h('textarea', { rows: '3', maxlength: String(SUMMARY_LIMIT) }, node.summary ?? '');
  const remaining = h('span', {});
  const explanation = h('textarea', { rows: '14', class: 'atlas-field-long' }, node.explanation ?? '');
  const count = (): void => {
    remaining.textContent = `${SUMMARY_LIMIT - summary.value.length} characters left. One sentence, shown on the box.`;
  };
  summary.addEventListener('input', count);
  count();

  const cancel = h('button', { type: 'button', class: 'atlas-button' }, 'Cancel');
  cancel.addEventListener('click', onCancel);
  const form = h(
    'form',
    { class: 'atlas-edit', 'aria-label': `Edit ${node.title}` },
    field('Name', title),
    !isNote && field('Kind', kind),
    field('Summary', summary, remaining),
    field('Explanation', explanation, 'Markdown: **bold**, `code`, lists and headings. Ctrl or Cmd + Enter saves.'),
    h('div', { class: 'atlas-edit-actions' }, h('button', { type: 'submit', class: 'atlas-button is-primary' }, 'Save'), cancel),
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const draft = {
      title: title.value.trim().replace(/\s+/g, ' '),
      kind: kind.value as NodeKind,
      summary: summary.value.trim(),
      explanation: explanation.value.trim(),
    };
    if (draft.title === '') {
      title.focus();
      return;
    }
    const changes = changesFrom(node, draft);
    if (Object.keys(changes).length === 0) onCancel();
    else onSave(changes);
  });
  form.addEventListener('keydown', (event) => {
    // Escape during text composition dismisses the composition, not the form.
    if (event.key === 'Escape' && !event.isComposing) {
      // Consumed here so the same press does not also step out of the flow.
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  return form;
}
