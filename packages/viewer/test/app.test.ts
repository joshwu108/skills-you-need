// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { mount } from '../src/app';
import type { Controller } from '../src/app';
import type { Anchor } from '../src/types';
import { SAMPLE } from './fixture';

let container: HTMLElement;
let controller: Controller;
let opened: Anchor[];
let navigated: (string | null)[];

const nodeIds = (): string[] =>
  [...container.querySelectorAll<HTMLElement>('.atlas-node')].map((el) => el.dataset.node ?? '');
const body = (id: string): HTMLButtonElement =>
  container.querySelector<HTMLButtonElement>(`[data-node="${id}"] .atlas-node-body`)!;
const crumbs = (): string[] => [...container.querySelectorAll('.atlas-crumb')].map((el) => el.textContent ?? '');
const panelTitle = (): string => container.querySelector('.atlas-panel h2')?.textContent ?? '';

beforeEach(() => {
  document.body.replaceChildren();
  container = document.createElement('main');
  document.body.appendChild(container);
  opened = [];
  navigated = [];
  controller = mount(
    container,
    { map: SAMPLE, root: '/repo' },
    { openAnchor: (anchor) => opened.push(anchor), onNavigate: (id) => navigated.push(id) },
  );
});

describe('overview', () => {
  test('shows the top-level flow and the map summary', () => {
    expect(nodeIds()).toEqual(['api', 'engine', 'db']);
    expect(crumbs()).toEqual(['Sample']);
    expect(panelTitle()).toBe('Sample');
    expect(container.querySelector('.atlas-prose strong')?.textContent).toBe('small');
    expect(container.querySelector('.atlas-stale-count')?.textContent).toBe('1 out of date');
  });

  test('draws one path per lifted edge with its label', () => {
    expect(container.querySelectorAll('.atlas-edge')).toHaveLength(2);
    expect([...container.querySelectorAll('.atlas-edge-label text')].map((t) => t.textContent)).toContain('orders · order');
  });
});

describe('navigation', () => {
  test('clicking a service opens its flow with outside neighbours as ghosts', () => {
    body('engine').click();
    expect(nodeIds()).toEqual(['engine.step', 'engine.fee', 'api', 'db']);
    expect(container.querySelector('[data-node="api"]')?.classList.contains('is-ghost')).toBe(true);
    expect(crumbs()).toEqual(['Sample', 'Engine']);
    expect(panelTitle()).toBe('Engine');
    expect(navigated).toEqual(['engine']);
    expect(controller.focused()).toBe('engine');
  });

  test('clicking a leaf selects it and explains it', () => {
    controller.focus('engine');
    body('engine.fee').click();
    expect(body('engine.fee').getAttribute('aria-pressed')).toBe('true');
    expect(panelTitle()).toBe('Fee');
    expect(crumbs()).toEqual(['Sample', 'Engine']);
    expect(controller.focused()).toBe('engine.fee');
  });

  test('focusing a leaf from outside shows its parent flow', () => {
    expect(controller.focus('engine.step.check')).toBe(true);
    expect(crumbs()).toEqual(['Sample', 'Engine', 'Step']);
    expect(container.querySelector('.is-selected')?.getAttribute('data-node')).toBe('engine.step.check');
  });

  test('breadcrumbs go back up', () => {
    controller.focus('engine.step');
    container.querySelectorAll<HTMLButtonElement>('.atlas-crumb')[0]!.click();
    expect(nodeIds()).toEqual(['api', 'engine', 'db']);
    expect(controller.focused()).toBeNull();
  });

  test('escape clears the selection, then leaves the flow', () => {
    controller.focus('engine.fee');
    const escape = () => container.firstElementChild!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    escape();
    expect(controller.focused()).toBe('engine');
    escape();
    expect(controller.focused()).toBeNull();
    escape();
    expect(controller.focused()).toBeNull();
  });

  test('unknown ids are refused and change nothing', () => {
    expect(controller.focus('nope')).toBe(false);
    expect(nodeIds()).toEqual(['api', 'engine', 'db']);
    expect(navigated).toEqual([]);
  });

  test('focusing the current node again does not re-announce it', () => {
    controller.focus('engine');
    controller.focus('engine');
    expect(navigated).toEqual(['engine']);
  });

  test('the panel lists the parts of a flow and they are clickable', () => {
    controller.focus('engine');
    const children = [...container.querySelectorAll<HTMLButtonElement>('.atlas-child')];
    expect(children.map((c) => c.querySelector('.atlas-child-title')?.textContent)).toEqual(['Step', 'Fee']);
    children[1]!.click();
    expect(controller.focused()).toBe('engine.fee');
  });
});

describe('code links', () => {
  test('the corner button opens the first anchor', () => {
    controller.focus('engine');
    container.querySelector<HTMLButtonElement>('[data-node="engine.fee"] .atlas-node-code')!.click();
    expect(opened).toEqual([SAMPLE.nodes[4]!.anchors![0]]);
  });

  test('panel anchors open their range', () => {
    controller.focus('engine.fee');
    const anchor = container.querySelector<HTMLButtonElement>('.atlas-anchor')!;
    expect(anchor.textContent).toContain('src/engine.py:16–18');
    anchor.click();
    expect(opened).toHaveLength(1);
  });

  test('nodes without code and ghosts get no code button', () => {
    expect(container.querySelector('[data-node="db"] .atlas-node-code')).toBeNull();
    controller.focus('engine.step');
    expect(container.querySelector('.is-ghost .atlas-node-code')).toBeNull();
  });
});

describe('states', () => {
  test('summaries render inline code instead of showing backticks', () => {
    const page = document.createElement('main');
    mount(
      page,
      { map: { version: 1, title: 'T', nodes: [{ id: 'a', parent: null, kind: 'data', title: 'A', summary: 'The `map.json` file.' }] } },
      { openAnchor: vi.fn() },
    ).focus('a');
    expect(page.querySelector('.atlas-lead code')?.textContent).toBe('map.json');
    expect(page.querySelector('.atlas-lead')?.textContent).toBe('The map.json file.');
  });

  test('stale and planned nodes are marked and explained', () => {
    controller.focus('engine');
    expect(container.querySelector('[data-node="engine.step"]')?.classList.contains('is-stale')).toBe(true);
    controller.focus('engine.step');
    expect(container.querySelector('.atlas-callout')?.textContent).toContain('Engine.step) changed');
    controller.focus('api.route');
    expect(container.querySelector('[data-node="api.route"]')?.classList.contains('is-planned')).toBe(true);
  });

  test('a leaf opened as a view says nothing is inside', () => {
    const lone = document.createElement('main');
    const single = mount(lone, { map: { version: 1, title: 'One', nodes: [{ id: 'a', parent: null, kind: 'step', title: 'A' }] } }, { openAnchor: vi.fn() });
    expect(lone.querySelectorAll('.atlas-node')).toHaveLength(1);
    single.destroy();
    expect(lone.children).toHaveLength(0);
  });

  test('explanations cannot inject markup', () => {
    const hostile = document.createElement('main');
    mount(
      hostile,
      { map: { version: 1, title: '<img src=x>', nodes: [{ id: 'a', parent: null, kind: 'step', title: '<script>x</script>', explanation: '<img src=x onerror=1>' }] } },
      { openAnchor: vi.fn() },
    ).focus('a');
    expect(hostile.querySelector('img')).toBeNull();
    expect(hostile.querySelector('script')).toBeNull();
  });
});
