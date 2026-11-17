import { describe, expect, test } from 'vitest';

import { buildIndex, childrenOf, nodeAtLine, parentIdOf, pathTo, staleNodes, viewOf } from '../src/graph';
import { SAMPLE } from './fixture';

const index = buildIndex(SAMPLE);
const ids = (nodes: { node: { id: string } }[]) => nodes.map((entry) => entry.node.id);

describe('hierarchy', () => {
  test('lists children in map order', () => {
    expect(childrenOf(index, null).map((n) => n.id)).toEqual(['api', 'engine', 'db']);
    expect(childrenOf(index, 'engine').map((n) => n.id)).toEqual(['engine.step', 'engine.fee']);
  });

  test('builds the path from the top level', () => {
    expect(pathTo(index, 'engine.step.check').map((n) => n.id)).toEqual(['engine', 'engine.step', 'engine.step.check']);
    expect(pathTo(index, null)).toEqual([]);
    expect(pathTo(index, 'unknown')).toEqual([]);
  });

  test('reports the containing node', () => {
    expect(parentIdOf(index, 'engine.step')).toBe('engine');
    expect(parentIdOf(index, 'engine')).toBeNull();
  });

  test('shows a node with a missing parent at the top level', () => {
    const orphaned = buildIndex({ ...SAMPLE, nodes: [{ id: 'lost', parent: 'nowhere', kind: 'step', title: 'Lost' }] });
    expect(childrenOf(orphaned, null).map((n) => n.id)).toEqual(['lost']);
    expect(parentIdOf(orphaned, 'lost')).toBeNull();
  });

  test('survives a parent cycle', () => {
    const cyclic = buildIndex({
      ...SAMPLE,
      nodes: [
        { id: 'a', parent: 'b', kind: 'step', title: 'A' },
        { id: 'b', parent: 'a', kind: 'step', title: 'B' },
      ],
    });
    expect(pathTo(cyclic, 'a').map((n) => n.id)).toEqual(['b', 'a']);
  });
});

describe('viewOf', () => {
  test('top level lifts deep edges to top-level nodes and merges them', () => {
    const view = viewOf(index, null);
    expect(view.parent).toBeNull();
    expect(ids(view.nodes)).toEqual(['api', 'engine', 'db']);
    expect(view.nodes.every((n) => !n.ghost)).toBe(true);
    expect(view.edges).toEqual([
      { from: 'api', to: 'engine', labels: ['orders', 'order'], kind: undefined },
      { from: 'engine', to: 'db', labels: ['fee row', 'fills'], kind: 'data' },
    ]);
  });

  test('counts children so containers can be marked', () => {
    const counts = Object.fromEntries(viewOf(index, null).nodes.map((n) => [n.node.id, n.childCount]));
    expect(counts).toEqual({ api: 1, engine: 2, db: 0 });
  });

  test('a sub-flow shows outside neighbours as ghosts', () => {
    const view = viewOf(index, 'engine');
    expect(view.parent?.id).toBe('engine');
    expect(view.nodes.filter((n) => !n.ghost).map((n) => n.node.id)).toEqual(['engine.step', 'engine.fee']);
    expect(view.nodes.filter((n) => n.ghost).map((n) => n.node.id)).toEqual(['api', 'db']);
    expect(view.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['api>engine.step', 'engine.step>engine.fee', 'engine.fee>db']);
  });

  test('edges that end on the view itself or its ancestors are not drawn', () => {
    const view = viewOf(index, 'engine');
    expect(view.edges.some((e) => e.from === 'engine' || e.to === 'engine')).toBe(false);
  });

  test('a leaf view is empty rather than an error', () => {
    expect(viewOf(index, 'engine.fee').nodes).toEqual([]);
  });

  test('an unknown view falls back to the top level', () => {
    expect(ids(viewOf(index, 'nope').nodes)).toEqual(['api', 'engine', 'db']);
  });
});

describe('nodeAtLine', () => {
  test('prefers the narrowest anchor containing the line', () => {
    expect(nodeAtLine(index, 'src/engine.py', 21)?.id).toBe('engine.step.check');
    expect(nodeAtLine(index, 'src/engine.py', 20)?.id).toBe('engine.step');
    expect(nodeAtLine(index, 'src/engine.py', 17)?.id).toBe('engine.fee');
  });

  test('returns nothing for unmapped lines and files', () => {
    expect(nodeAtLine(index, 'src/engine.py', 3)).toBeUndefined();
    expect(nodeAtLine(index, 'src/other.py', 21)).toBeUndefined();
  });
});

test('staleNodes lists nodes whose code changed', () => {
  expect(staleNodes(index).map((n) => n.id)).toEqual(['engine.step']);
});
