import { describe, expect, test } from 'vitest';

import { EMPTY_LAYOUT, mergeLayouts, parseLayout, parsePositions, positionOf, positionsFor, snap, withPositions } from '../src/positions';

describe('parseLayout', () => {
  test('keeps well-formed positions and snaps them to the grid', () => {
    const layout = parseLayout({ version: 1, views: { ':root': { api: { x: 41, y: 83 } } } });
    expect(layout).toEqual({ version: 1, views: { ':root': { api: { x: 40, y: 80 } } } });
  });

  test('drops entries of the wrong shape and views left empty', () => {
    const layout = parseLayout({
      version: 1,
      views: { a: { n: { x: '1', y: 2 }, m: { x: NaN, y: 0 }, k: null }, b: 'nope', c: { ok: { x: 8, y: 8 } } },
    });
    expect(layout.views).toEqual({ c: { ok: { x: 8, y: 8 } } });
  });

  test('anything that is not a version 1 layout reads as empty', () => {
    for (const value of [undefined, null, 'x', [], { version: 2, views: {} }, { version: 1, views: [] }]) {
      expect(parseLayout(value)).toEqual(EMPTY_LAYOUT);
    }
  });

  test('clamps coordinates into the drawable area', () => {
    expect(parsePositions({ n: { x: -500, y: 1e9 } })).toEqual({ n: { x: 0, y: 20000 } });
    expect(snap(11.9)).toBe(8);
    expect(snap(12)).toBe(16);
  });
});

describe('lookups', () => {
  test('never return inherited object properties', () => {
    const layout = parseLayout({ version: 1, views: { ':root': { a: { x: 0, y: 0 } } } });
    expect(positionsFor(layout, 'constructor')).toEqual({});
    expect(positionsFor(layout, 'toString')).toEqual({});
    expect(positionOf(positionsFor(layout, null), 'hasOwnProperty')).toBeUndefined();
    expect(positionOf(positionsFor(layout, null), 'a')).toEqual({ x: 0, y: 0 });
  });
});

describe('withPositions', () => {
  test('replaces one view without changing the layout it was given', () => {
    const before = parseLayout({ version: 1, views: { a: { n: { x: 8, y: 8 } } } });
    const after = withPositions(before, null, { top: { x: 16, y: 24 } });
    expect(after.views).toEqual({ a: { n: { x: 8, y: 8 } }, ':root': { top: { x: 16, y: 24 } } });
    expect(before.views).toEqual({ a: { n: { x: 8, y: 8 } } });
  });

  test('an empty set of positions removes the view', () => {
    const before = parseLayout({ version: 1, views: { a: { n: { x: 8, y: 8 } } } });
    expect(withPositions(before, 'a', {}).views).toEqual({});
  });

  test('merging lets the second layout win view by view', () => {
    const base = parseLayout({ version: 1, views: { a: { n: { x: 8, y: 8 } }, b: { m: { x: 0, y: 0 } } } });
    const over = parseLayout({ version: 1, views: { a: { n: { x: 80, y: 80 } } } });
    expect(mergeLayouts(base, over).views).toEqual({ a: { n: { x: 80, y: 80 } }, b: { m: { x: 0, y: 0 } } });
  });
});
