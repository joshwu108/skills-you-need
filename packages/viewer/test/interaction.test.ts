// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { mount } from '../src/app';
import type { Controller } from '../src/app';
import type { Host } from '../src/host';
import type { Anchor, AtlasLayout, NodeChanges, ViewPositions } from '../src/types';
import { SAMPLE } from './fixture';

let container: HTMLElement;
let controller: Controller;
let revealed: Anchor[];
let moves: { view: string | null; positions: ViewPositions }[];
let edits: { nodeId: string; changes: NodeChanges }[];

const $ = <T extends HTMLElement>(selector: string): T => container.querySelector<T>(selector)!;
const node = (id: string): HTMLElement => $(`[data-node="${id}"]`);
const press = (key: string, init: KeyboardEventInit = {}, target: Element = container.firstElementChild!): boolean =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

function pointer(type: string, target: Element, clientX: number, clientY: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}

function drag(id: string, dx: number, dy: number): void {
  const body = node(id).querySelector('.atlas-node-body')!;
  pointer('pointerdown', body, 100, 100);
  pointer('pointermove', body, 100 + dx, 100 + dy);
  pointer('pointerup', body, 100 + dx, 100 + dy);
}

function open(host: Partial<Host> = {}, layout?: AtlasLayout): void {
  document.body.replaceChildren();
  container = document.createElement('main');
  document.body.appendChild(container);
  revealed = [];
  moves = [];
  edits = [];
  controller = mount(
    container,
    { map: SAMPLE, root: '/repo', layout },
    {
      openAnchor: vi.fn(),
      revealAnchor: (anchor) => revealed.push(anchor),
      savePositions: (view, positions) => moves.push({ view, positions }),
      saveNode: (nodeId, changes) => edits.push({ nodeId, changes }),
      ...host,
    },
  );
}

beforeEach(() => open());

describe('walkthrough', () => {
  const where = (): string => $('.atlas-tour-where').textContent ?? '';

  test('is hidden until started, then begins at the first box', () => {
    expect($('.atlas-tour').hidden).toBe(true);
    $<HTMLButtonElement>('.atlas-tour-start').click();
    expect($('.atlas-tour').hidden).toBe(false);
    expect(where()).toBe('Step 1 of 7API');
    expect(controller.focused()).toBe('api');
    expect(node('api').classList.contains('is-selected')).toBe(true);
    expect($<HTMLButtonElement>('.atlas-tour-back').disabled).toBe(true);
    expect($('.atlas-tour-next').textContent).toBe('Next: Route');
  });

  test('steps into a box, shows it among its neighbours, and stops at the end', () => {
    $<HTMLButtonElement>('.atlas-tour-start').click();
    $<HTMLButtonElement>('.atlas-tour-next').click();
    expect(controller.focused()).toBe('api.route');
    expect([...container.querySelectorAll('.atlas-crumb')].map((c) => c.textContent)).toEqual(['Sample', 'API']);
    for (let step = 0; step < 10; step += 1) press('ArrowRight');
    expect(where()).toBe('Step 7 of 7Database');
    expect($<HTMLButtonElement>('.atlas-tour-next').disabled).toBe(true);
    press('ArrowLeft');
    expect(controller.focused()).toBe('engine.fee');
  });

  test('starting inside a flow walks only that flow', () => {
    controller.focus('engine');
    $<HTMLButtonElement>('.atlas-tour-start').click();
    expect(where()).toBe('Step 1 of 4Engine');
  });

  test('follows the reader when they click another box mid-walkthrough', () => {
    $<HTMLButtonElement>('.atlas-tour-start').click();
    controller.focus('engine.fee');
    expect(where()).toBe('Step 6 of 7Fee');
  });

  test('"show code as I go" reveals each step that has code', () => {
    $<HTMLButtonElement>('.atlas-tour-start').click();
    const follow = $<HTMLInputElement>('#atlas-tour-follow');
    follow.checked = true;
    follow.dispatchEvent(new Event('change'));
    expect(revealed).toEqual([]);
    controller.focus('engine');
    press('ArrowRight');
    expect(revealed.map((anchor) => anchor.symbol)).toEqual(['Engine.step']);
  });

  test('the code checkbox is absent where the host cannot reveal code', () => {
    open({ revealAnchor: undefined });
    expect(container.querySelector('#atlas-tour-follow')).toBeNull();
  });

  test('escape leaves the walkthrough before it leaves the flow', () => {
    $<HTMLButtonElement>('.atlas-tour-start').click();
    press('ArrowRight');
    press('Escape');
    expect($('.atlas-tour').hidden).toBe(true);
    expect(controller.focused()).toBe('api.route');
    press('ArrowRight');
    expect(controller.focused()).toBe('api.route');
  });
});

describe('search', () => {
  const input = (): HTMLInputElement => $<HTMLInputElement>('.atlas-search-input');
  const type = (text: string): void => {
    input().value = text;
    input().dispatchEvent(new Event('input'));
  };

  test('slash focuses the field; typing lists matches with where they live', () => {
    press('/');
    expect(document.activeElement).toBe(input());
    type('fee');
    const results = [...container.querySelectorAll('.atlas-search-result')];
    expect(results.map((r) => r.querySelector('.atlas-search-title')?.textContent)).toEqual(['Fee']);
    expect(results[0]?.querySelector('.atlas-search-where')?.textContent).toBe('Engine');
  });

  test('enter goes to the highlighted match and clears the field', () => {
    type('st');
    press('ArrowDown', {}, input());
    press('ArrowDown', {}, input());
    press('Enter', {}, input());
    expect(controller.focused()).toBe('engine.step.check');
    expect(input().value).toBe('');
    expect($('.atlas-search-results').hidden).toBe(true);
  });

  test('says so when nothing matches, and escape clears without leaving the flow', () => {
    controller.focus('engine');
    type('zzz');
    expect($('.atlas-search-none').textContent).toBe('No box matches.');
    press('Escape', {}, input());
    expect(input().value).toBe('');
    expect(controller.focused()).toBe('engine');
  });

  test('typing in the field does not drive the walkthrough', () => {
    $<HTMLButtonElement>('.atlas-tour-start').click();
    press('ArrowRight', {}, input());
    expect(controller.focused()).toBe('api');
  });
});

describe('moving boxes', () => {
  test('a drag moves the box, reports the view positions, and does not open the box', () => {
    drag('engine', 80, 40);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.view).toBeNull();
    const placed = moves[0]!.positions.engine!;
    expect(node('engine').style.transform).toBe(`translate(${placed.x}px, ${placed.y}px)`);
    expect(placed.x % 8).toBe(0);
    node('engine').querySelector<HTMLElement>('.atlas-node-body')!.click();
    expect(controller.focused()).toBeNull();
    node('engine').querySelector<HTMLElement>('.atlas-node-body')!.click();
    expect(controller.focused()).toBe('engine');
  });

  test('a press that barely moves is still a click', () => {
    drag('engine', 1, 1);
    expect(moves).toEqual([]);
    node('engine').querySelector<HTMLElement>('.atlas-node-body')!.click();
    expect(controller.focused()).toBe('engine');
  });

  test('positions from the layout are applied per view', () => {
    open({}, { version: 1, views: { ':root': { db: { x: 800, y: 640 } }, engine: { 'engine.fee': { x: 8, y: 16 } } } });
    expect(node('db').style.transform).toBe('translate(800px, 640px)');
    expect($('.atlas-tidy').hidden).toBe(false);
    controller.focus('engine');
    expect(node('engine.fee').style.transform).toBe('translate(8px, 16px)');
  });

  test('positions survive leaving the flow and coming back', () => {
    drag('db', 160, 0);
    const moved = node('db').style.transform;
    controller.focus('engine');
    controller.focus(null);
    expect(node('db').style.transform).toBe(moved);
  });

  test('Tidy restores the automatic layout and reports an empty set', () => {
    const before = node('api').style.transform;
    drag('api', 200, 120);
    expect(node('api').style.transform).not.toBe(before);
    $<HTMLButtonElement>('.atlas-tidy').click();
    expect(node('api').style.transform).toBe(before);
    expect(moves[moves.length - 1]).toEqual({ view: null, positions: {} });
    expect($('.atlas-tidy').hidden).toBe(true);
  });

  test('Alt and an arrow key nudge the focused box one grid step', () => {
    const body = node('api').querySelector<HTMLElement>('.atlas-node-body')!;
    body.focus();
    const before = /translate\((-?[\d.]+)px/.exec(node('api').style.transform)![1];
    press('ArrowRight', { altKey: true }, body);
    expect(moves[0]?.positions.api?.x).toBeGreaterThan(Number(before) - 8);
    expect(moves[0]?.positions.api?.x).toBeLessThanOrEqual(Number(before) + 8);
    expect(document.activeElement).toBe(node('api').querySelector('.atlas-node-body'));
  });

  test('a hostile layout cannot break the page', () => {
    const hostile = { version: 1, views: { ':root': { api: { x: 'a', y: {} }, __proto__: { x: 1, y: 1 } }, constructor: 5 } };
    expect(() => open({}, hostile as unknown as AtlasLayout)).not.toThrow();
    expect(container.querySelectorAll('.atlas-node')).toHaveLength(3);
  });
});

describe('following arrows', () => {
  test('hovering a box marks its arrows and neighbours, and leaving clears them', () => {
    const flow = $('.atlas-flow');
    node('engine').querySelector('.atlas-node-body')!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(flow.classList.contains('has-active')).toBe(true);
    expect(node('api').classList.contains('is-linked')).toBe(true);
    expect(container.querySelectorAll('.atlas-edge.is-linked')).toHaveLength(2);
    expect(container.querySelectorAll('.atlas-edge.is-outgoing')).toHaveLength(1);
    flow.dispatchEvent(new MouseEvent('pointerleave'));
    expect(flow.classList.contains('has-active')).toBe(false);
  });

  test('the panel lists connections and they navigate', () => {
    controller.focus('engine.fee');
    const links = [...container.querySelectorAll<HTMLButtonElement>('.atlas-link')];
    expect(links.map((link) => link.textContent)).toEqual(['fromStepnotional', 'toDatabasefee row']);
    links[0]!.click();
    expect(controller.focused()).toBe('engine.step');
  });
});

describe('editing', () => {
  const field = <T extends HTMLElement>(position: number): T =>
    container.querySelectorAll<T>('.atlas-field input, .atlas-field select, .atlas-field textarea')[position]!;
  const submit = (): boolean => $('.atlas-edit').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

  test('saves only the fields that changed', () => {
    controller.focus('engine.fee');
    $<HTMLButtonElement>('.atlas-edit-open').click();
    field<HTMLInputElement>(0).value = '  Fee   calculation ';
    field<HTMLTextAreaElement>(2).value = 'Charges a fee.';
    submit();
    expect(edits).toEqual([{ nodeId: 'engine.fee', changes: { title: 'Fee calculation', summary: 'Charges a fee.' } }]);
  });

  test('an unchanged form and Cancel both return to reading without saving', () => {
    controller.focus('engine.step');
    $<HTMLButtonElement>('.atlas-edit-open').click();
    submit();
    expect(container.querySelector('.atlas-edit')).toBeNull();
    $<HTMLButtonElement>('.atlas-edit-open').click();
    press('Escape', {}, field(0));
    expect(container.querySelector('.atlas-edit')).toBeNull();
    expect(controller.focused()).toBe('engine.step');
    expect(edits).toEqual([]);
  });

  test('refuses an empty name', () => {
    controller.focus('engine.fee');
    $<HTMLButtonElement>('.atlas-edit-open').click();
    field<HTMLInputElement>(0).value = '   ';
    submit();
    expect(edits).toEqual([]);
    expect(container.querySelector('.atlas-edit')).not.toBeNull();
  });

  test('clearing the explanation and changing the kind are reported', () => {
    controller.focus('engine.step');
    $<HTMLButtonElement>('.atlas-edit-open').click();
    field<HTMLSelectElement>(1).value = 'step';
    field<HTMLTextAreaElement>(3).value = '';
    submit();
    expect(edits[0]?.changes).toEqual({ kind: 'step', explanation: '' });
  });

  test('there is no Edit button where the map is read-only', () => {
    open({ saveNode: undefined });
    controller.focus('engine.fee');
    expect(container.querySelector('.atlas-edit-open')).toBeNull();
  });
});

describe('drag edge cases', () => {
  const body = (id: string): Element => node(id).querySelector('.atlas-node-body')!;

  test('a button released out of sight abandons the drag instead of sticking to the pointer', () => {
    const before = node('engine').style.transform;
    pointer('pointerdown', body('engine'), 100, 100);
    pointer('pointermove', body('engine'), 180, 160);
    const hover = new MouseEvent('pointermove', { bubbles: true, buttons: 0, clientX: 400, clientY: 400 });
    Object.defineProperty(hover, 'pointerId', { value: 1 });
    body('engine').dispatchEvent(hover);
    expect(node('engine').style.transform).toBe(before);
    expect(node('engine').classList.contains('is-dragging')).toBe(false);
    expect(moves).toEqual([]);
  });

  test('a second press while dragging does not replace the drag', () => {
    pointer('pointerdown', body('engine'), 100, 100);
    pointer('pointermove', body('engine'), 180, 160);
    pointer('pointerdown', body('api'), 10, 10);
    pointer('pointerup', body('engine'), 180, 160);
    expect(Object.keys(moves[0]!.positions)).toEqual(['engine']);
    expect(node('engine').classList.contains('is-dragging')).toBe(false);
  });

  test('navigating mid-drag saves nothing into the flow that replaced it', () => {
    pointer('pointerdown', body('engine'), 100, 100);
    pointer('pointermove', body('engine'), 180, 160);
    controller.focus('engine');
    pointer('pointerup', container.querySelector('.atlas-flow')!, 180, 160);
    expect(moves).toEqual([]);
  });

  test('saving one view keeps the other views in the order they were', () => {
    open({}, { version: 1, views: { ':root': { db: { x: 800, y: 640 } }, engine: { 'engine.fee': { x: 8, y: 16 } } } });
    drag('api', 80, 80);
    drag('db', 16, 16);
    expect(moves).toHaveLength(2);
    expect(Object.keys(moves[1]!.positions)).toEqual(['db', 'api']);
  });
});

describe('a map that changes underneath the reader', () => {
  const renamed = {
    ...SAMPLE,
    nodes: SAMPLE.nodes.map((entry) => (entry.id === 'engine.fee' ? { ...entry, title: 'Fee charge' } : entry)),
  };

  test('keeps the level, the selection and the walkthrough', () => {
    $<HTMLButtonElement>('.atlas-tour-start').click();
    controller.focus('engine.fee');
    controller.update({ map: renamed });
    expect(controller.focused()).toBe('engine.fee');
    expect($('.atlas-panel h2').textContent).toBe('Fee charge');
    expect($('.atlas-tour-where').textContent).toBe('Step 6 of 7Fee charge');
    expect(node('engine.fee').querySelector('.atlas-node-title')?.textContent).toBe('Fee charge');
  });

  test('keeps an unsaved edit open, and closes the form once its own save comes back', () => {
    controller.focus('engine.fee');
    expect(controller.edit()).toBe(true);
    const name = $<HTMLInputElement>('.atlas-field input');
    name.value = 'Half typed';
    controller.update({ map: renamed });
    expect($<HTMLInputElement>('.atlas-field input').value).toBe('Half typed');

    $('.atlas-edit').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    controller.update({ map: renamed });
    expect(container.querySelector('.atlas-edit')).toBeNull();
    expect($('.atlas-panel h2').textContent).toBe('Fee charge');
  });

  test('falls back to what still exists when the focused node is removed', () => {
    controller.focus('engine.step.check');
    $<HTMLButtonElement>('.atlas-tour-start').click();
    controller.update({ map: { ...SAMPLE, nodes: SAMPLE.nodes.filter((entry) => entry.id !== 'engine.step.check'), edges: [] } });
    expect(controller.focused()).toBe('engine.step');
    controller.update({ map: { version: 1, title: 'Tiny', nodes: [{ id: 'only', parent: null, kind: 'step', title: 'Only' }] } });
    expect(controller.focused()).toBeNull();
    expect($('.atlas-tour').hidden).toBe(true);
    expect([...container.querySelectorAll('.atlas-crumb')].map((c) => c.textContent)).toEqual(['Tiny']);
  });

  test('search and the legend follow the new map', () => {
    controller.update({ map: { version: 1, title: 'Tiny', nodes: [{ id: 'only', parent: null, kind: 'note', title: 'Only' }] } });
    expect([...container.querySelectorAll('.atlas-legend li')].map((li) => li.textContent)).toEqual(['note']);
    const input = $<HTMLInputElement>('.atlas-search-input');
    input.value = 'only';
    input.dispatchEvent(new Event('input'));
    expect(container.querySelectorAll('.atlas-search-result')).toHaveLength(1);
  });

  test('edit() refuses at the top level and where the map is read-only', () => {
    expect(controller.edit()).toBe(false);
    open({ saveNode: undefined });
    controller.focus('engine.fee');
    expect(controller.edit()).toBe(false);
  });
});

describe("the reader's own notes and links", () => {
  let calls: unknown[][];
  const withNote = {
    ...SAMPLE,
    nodes: [...SAMPLE.nodes, { id: 'note.1', parent: 'engine', kind: 'note' as const, title: 'Why fees round down' }],
    edges: [...(SAMPLE.edges ?? []), { from: 'note.1', to: 'engine.fee', user: true }],
  };

  beforeEach(() => {
    calls = [];
    open({
      addNote: (view) => calls.push(['addNote', view]),
      removeNote: (id) => calls.push(['removeNote', id]),
      addLink: (from, to, label) => calls.push(['addLink', from, to, label]),
      removeLink: (from, to) => calls.push(['removeLink', from, to]),
    });
    controller.update({ map: withNote });
  });

  test('"Add note" asks for a note in the flow on screen', () => {
    $<HTMLButtonElement>('.atlas-note-add').click();
    controller.focus('engine');
    $<HTMLButtonElement>('.atlas-note-add').click();
    expect(calls).toEqual([['addNote', null], ['addNote', 'engine']]);
  });

  test('a note is drawn as a note, labelled as the reader\'s, and can be deleted', () => {
    controller.focus('note.1');
    expect(node('note.1').classList.contains('is-note')).toBe(true);
    expect($('.atlas-tag').textContent).toBe('your note');
    $<HTMLButtonElement>('.atlas-note-remove').click();
    expect(calls).toEqual([['removeNote', 'note.1']]);
  });

  test('the edit form offers no way to change what is a note', () => {
    controller.focus('note.1');
    controller.edit();
    expect(container.querySelector('.atlas-edit select')).toBeNull();
    controller.focus('engine.fee');
    controller.edit();
    const kinds = [...$<HTMLSelectElement>('.atlas-edit select').options].map((option) => option.value);
    expect(kinds).not.toContain('note');
  });

  test('boxes Claude wrote have no Delete button', () => {
    controller.focus('engine.fee');
    expect(container.querySelector('.atlas-note-remove')).toBeNull();
  });

  test('a link is drawn in the chosen direction with its label', () => {
    controller.focus('engine.fee');
    const form = $<HTMLFormElement>('.atlas-link-form');
    const [way, other] = [...form.querySelectorAll('select')];
    expect([...other!.options].map((option) => option.textContent)).toContain('Engine / Step / Check');
    expect([...other!.options].map((option) => option.value)).not.toContain('engine.fee');
    other!.value = 'api';
    form.querySelector('input')!.value = '  rate table ';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    way!.value = 'from';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(calls).toEqual([
      ['addLink', 'engine.fee', 'api', 'rate table'],
      ['addLink', 'api', 'engine.fee', 'rate table'],
    ]);
  });

  test("only the reader's own links can be removed", () => {
    controller.focus('engine.fee');
    const removes = [...container.querySelectorAll<HTMLButtonElement>('.atlas-link-remove')];
    expect(removes.map((button) => button.getAttribute('aria-label'))).toEqual(['Remove the link from Why fees round down']);
    removes[0]!.click();
    expect(calls).toEqual([['removeLink', 'note.1', 'engine.fee']]);
  });

  test('a reload that changes nothing on show keeps focus and a half-filled link form', () => {
    controller.focus('engine.fee');
    const label = $<HTMLInputElement>('.atlas-link-form input');
    label.value = 'half';
    label.focus();
    controller.update({ map: { ...withNote, summary: 'Changed elsewhere.' } });
    expect(document.activeElement).toBe(label);
    expect(label.value).toBe('half');
    expect($('.atlas-search-input').isConnected).toBe(true);
  });

  test('cancelling an edit after a reload shows the node as it is now', () => {
    controller.focus('engine.fee');
    controller.edit();
    const nodes = withNote.nodes.map((entry) => (entry.id === 'engine.fee' ? { ...entry, title: 'Fee, renamed' } : entry));
    controller.update({ map: { ...withNote, nodes } });
    press('Escape', {}, $('.atlas-field input'));
    expect($('.atlas-panel h2').textContent).toBe('Fee, renamed');
  });

  test('a map sent before the host heard about a drag does not put the box back', () => {
    drag('api', 80, 80);
    const moved = node('api').style.transform;
    controller.update({ map: withNote });
    expect(node('api').style.transform).toBe(moved);
    controller.update({ map: withNote, layout: { version: 1, views: {} } });
    expect(node('api').style.transform).not.toBe(moved);
  });

  test('none of these controls exist where the map is read-only', () => {
    open({ saveNode: undefined });
    controller.focus('engine.fee');
    for (const selector of ['.atlas-note-add', '.atlas-link-form', '.atlas-link-remove', '.atlas-note-remove']) {
      expect(container.querySelector(selector)).toBeNull();
    }
  });
});

describe('keyboard focus', () => {
  test('returns to the Edit button when the form is cancelled', () => {
    controller.focus('engine.fee');
    $<HTMLButtonElement>('.atlas-edit-open').click();
    expect(document.activeElement).toBe($('.atlas-field input'));
    press('Escape', {}, $('.atlas-field input'));
    expect(document.activeElement).toBe($('.atlas-edit-open'));
  });

  test('escape during text composition does not discard the form', () => {
    controller.focus('engine.fee');
    $<HTMLButtonElement>('.atlas-edit-open').click();
    press('Escape', { isComposing: true }, $('.atlas-field input'));
    expect(container.querySelector('.atlas-edit')).not.toBeNull();
  });

  test('returns to "Walk through" when the walkthrough ends', () => {
    $<HTMLButtonElement>('.atlas-tour-start').click();
    $<HTMLButtonElement>('.atlas-tour-exit').click();
    expect(document.activeElement).toBe($('.atlas-tour-start'));
  });
});
