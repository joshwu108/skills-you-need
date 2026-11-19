// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { SAMPLE } from './fixture';

const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const EDITOR = `${CHROME} Code/1.99.0 Electron/35.1`;
const LAYOUT_KEY = 'codeatlas.layout:/repo';

/** The test runner's own `localStorage` is not a working store, so the page gets this one. */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'clear'> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    clear: () => items.clear(),
  };
}

/** Build the page the way the skill does, then run the entry point against it. */
async function load(data: unknown, userAgent = CHROME): Promise<HTMLElement> {
  vi.resetModules();
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  const block = document.createElement('script');
  block.id = 'atlas-data';
  block.type = 'application/json';
  block.textContent = typeof data === 'string' ? data : JSON.stringify(data);
  const main = document.createElement('main');
  main.id = 'atlas';
  document.body.replaceChildren(main, block);
  await import('../src/standalone');
  return main;
}

function pointer(type: string, target: Element, clientX: number, clientY: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}

vi.stubGlobal('localStorage', memoryStorage());

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', location.pathname);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('standalone page', () => {
  test('draws the embedded map and offers an editor choice, but no editing', async () => {
    const main = await load({ map: SAMPLE, root: '/repo' });
    expect(main.querySelectorAll('.atlas-node')).toHaveLength(3);
    expect(main.querySelector<HTMLSelectElement>('#atlas-editor')?.value).toBe('vscode');
    main.querySelector<HTMLElement>('[data-node="db"] .atlas-node-body')?.click();
    expect(main.querySelector('.atlas-edit-open')).toBeNull();
    expect(location.hash).toBe('#/db');
  });

  test('says what is wrong when the page has no usable map', async () => {
    expect((await load('')).querySelector('[role="alert"]')?.textContent).toMatch(/no embedded map/);
    expect((await load({ map: { nodes: 'x' } })).querySelector('[role="alert"]')?.textContent).toMatch(/expected format/);
  });

  test('remembers the chosen editor', async () => {
    const main = await load({ map: SAMPLE, root: '/repo' });
    const select = main.querySelector<HTMLSelectElement>('#atlas-editor')!;
    select.value = 'cursor';
    select.dispatchEvent(new Event('change'));
    expect((await load({ map: SAMPLE, root: '/repo' })).querySelector<HTMLSelectElement>('#atlas-editor')?.value).toBe('cursor');
  });

  test('remembers moved boxes in the browser until the layout file changes', async () => {
    let main = await load({ map: SAMPLE, root: '/repo' });
    const body = main.querySelector('[data-node="db"] .atlas-node-body')!;
    pointer('pointerdown', body, 10, 10);
    pointer('pointermove', body, 210, 110);
    pointer('pointerup', body, 210, 110);
    const moved = main.querySelector<HTMLElement>('[data-node="db"]')!.style.transform;
    expect(localStorage.getItem(LAYOUT_KEY)).toContain('"db"');

    main = await load({ map: SAMPLE, root: '/repo' });
    expect(main.querySelector<HTMLElement>('[data-node="db"]')!.style.transform).toBe(moved);

    const fromFile = { version: 1, views: { ':root': { db: { x: 8, y: 8 } } } };
    main = await load({ map: SAMPLE, root: '/repo', layout: fromFile });
    expect(main.querySelector<HTMLElement>('[data-node="db"]')!.style.transform).toBe('translate(8px, 8px)');
  });

  test('an unreadable saved arrangement is ignored', async () => {
    localStorage.setItem(LAYOUT_KEY, '{oops');
    const main = await load({ map: SAMPLE, root: '/repo' });
    expect(main.querySelectorAll('.atlas-node')).toHaveLength(3);
  });

  test("inside an editor's built-in browser it explains instead of following a dead link", async () => {
    const main = await load({ map: SAMPLE, root: '/repo' }, EDITOR);
    const toast = document.querySelector<HTMLElement>('.atlas-toast')!;
    expect(toast.hidden).toBe(false);
    expect(toast.textContent).toMatch(/CodeAtlas: Open Map/);
    vi.advanceTimersByTime(10_000);
    expect(toast.hidden).toBe(true);

    main.querySelector<HTMLElement>('[data-node="engine"] .atlas-node-body')?.click();
    main.querySelector<HTMLElement>('[data-node="engine.fee"] .atlas-node-code')?.click();
    expect(toast.hidden).toBe(false);
    toast.querySelector<HTMLElement>('.atlas-toast-close')?.click();
    expect(toast.hidden).toBe(true);
  });
});
