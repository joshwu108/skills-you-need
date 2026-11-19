// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { FromWebview, ToWebview } from '../src/protocol';
import { SAMPLE } from './fixture';

let sent: FromWebview[];
let main: HTMLElement;

const send = (message: ToWebview): boolean => window.dispatchEvent(new MessageEvent('message', { data: message }));
const last = (type: FromWebview['type']): FromWebview | undefined => [...sent].reverse().find((message) => message.type === type);

beforeEach(async () => {
  vi.resetModules();
  sent = [];
  vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage: (message: FromWebview) => sent.push(message) }));
  main = document.createElement('main');
  main.id = 'atlas';
  document.body.className = 'vscode-dark';
  document.body.replaceChildren(main);
  await import('../src/webview');
});

describe('webview entry', () => {
  test('announces itself, follows the editor theme and draws the map it is sent', () => {
    expect(sent).toEqual([{ type: 'ready' }]);
    expect(document.documentElement.dataset.theme).toBe('dark');
    send({ type: 'map', data: { map: SAMPLE }, focus: 'engine.fee' });
    expect(main.querySelector('.atlas-panel h2')?.textContent).toBe('Fee');
    expect(last('navigate')).toEqual({ type: 'navigate', nodeId: 'engine.fee' });
  });

  test('a second map updates the same viewer instead of starting over', () => {
    send({ type: 'map', data: { map: SAMPLE }, focus: 'engine.fee' });
    const root = main.firstElementChild;
    main.querySelector<HTMLButtonElement>('.atlas-tour-start')?.click();
    send({ type: 'map', data: { map: { ...SAMPLE, title: 'Renamed' } } });
    expect(main.firstElementChild).toBe(root);
    expect(main.querySelector('.atlas-crumb')?.textContent).toBe('Renamed');
    expect(main.querySelector<HTMLElement>('.atlas-tour')?.hidden).toBe(false);
    expect(last('navigate')).toEqual({ type: 'navigate', nodeId: 'engine.fee' });
  });

  test('can be told to open a node for editing', () => {
    send({ type: 'map', data: { map: SAMPLE }, focus: 'engine.step', edit: true });
    expect(main.querySelector<HTMLInputElement>('.atlas-field input')?.value).toBe('Step');
  });

  test('passes what the reader does back to the extension', () => {
    send({ type: 'map', data: { map: SAMPLE }, focus: 'engine.fee' });
    main.querySelector<HTMLButtonElement>('.atlas-anchor')?.click();
    main.querySelector<HTMLButtonElement>('.atlas-note-add')?.click();
    main.querySelector('.atlas-link-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(last('open')).toMatchObject({ anchor: { file: 'src/engine.py' } });
    expect(last('addNote')).toEqual({ type: 'addNote', parent: 'engine' });
    expect(last('addLink')).toMatchObject({ type: 'addLink', from: 'engine.fee', label: '' });
  });

  test('shows an error in place of the map, and recovers when a good map arrives', () => {
    send({ type: 'map', data: { map: SAMPLE } });
    send({ type: 'error', message: 'The map is not valid JSON.' });
    expect(main.querySelector('[role="alert"]')?.textContent).toBe('The map is not valid JSON.');
    send({ type: 'focus', nodeId: 'engine' });
    send({ type: 'map', data: { map: SAMPLE } });
    expect(main.querySelectorAll('.atlas-node')).toHaveLength(3);
  });
});
