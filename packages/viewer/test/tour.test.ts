import { describe, expect, test } from 'vitest';

import { buildIndex, connectionsOf, searchNodes, viewOf } from '../src/graph';
import { flowOrder, tourOrder } from '../src/tour';
import type { AtlasMap } from '../src/types';
import { SAMPLE } from './fixture';

const index = buildIndex(SAMPLE);
const ids = (nodes: { id: string }[]): string[] => nodes.map((node) => node.id);

function chain(nodes: string[], edges: [string, string][]): AtlasMap {
  return {
    version: 1,
    title: 'T',
    nodes: nodes.map((id) => ({ id, parent: null, kind: 'step', title: id.toUpperCase() })),
    edges: edges.map(([from, to]) => ({ from, to })),
  };
}

describe('flowOrder', () => {
  test('starts at the first listed node and follows the arrows', () => {
    const view = viewOf(buildIndex(chain(['a', 'd', 'c', 'b'], [['a', 'b'], ['b', 'c'], ['a', 'd']])), null);
    expect(ids(flowOrder(view))).toEqual(['a', 'd', 'b', 'c']);
  });

  test('picks up unreached nodes in listed order and leaves ghosts out', () => {
    expect(ids(flowOrder(viewOf(index, null)))).toEqual(['api', 'engine', 'db']);
    expect(ids(flowOrder(viewOf(index, 'engine')))).toEqual(['engine.step', 'engine.fee']);
  });

  test('a loop is read once round and ends', () => {
    const view = viewOf(buildIndex(chain(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'a']])), null);
    expect(ids(flowOrder(view))).toEqual(['a', 'b', 'c']);
  });
});

describe('tourOrder', () => {
  test('reads each node, then what is inside it', () => {
    expect(tourOrder(index, null)).toEqual(['api', 'api.route', 'engine', 'engine.step', 'engine.step.check', 'engine.fee', 'db']);
  });

  test('a walkthrough of one node starts with that node', () => {
    expect(tourOrder(index, 'engine')).toEqual(['engine', 'engine.step', 'engine.step.check', 'engine.fee']);
    expect(tourOrder(index, 'missing')).toEqual([]);
  });
});

describe('connectionsOf', () => {
  test('lists what flows in before what flows out, with labels', () => {
    const connections = connectionsOf(index, 'engine.fee').map((c) => [c.outgoing ? 'to' : 'from', c.node.id, c.labels]);
    expect(connections).toEqual([
      ['from', 'engine.step', ['notional']],
      ['to', 'db', ['fee row']],
    ]);
  });

  test('a node with no arrows has no connections', () => {
    expect(connectionsOf(index, 'engine.step.check')).toEqual([]);
  });
});

describe('searchNodes', () => {
  test('ranks a title that starts with the query first', () => {
    expect(ids(searchNodes(index, 'st', 8))).toEqual(['engine.step', 'api', 'engine.step.check']);
  });

  test('matches every word across title, id and summary, ignoring case', () => {
    expect(ids(searchNodes(index, 'ORDERS engine', 8))).toEqual(['engine']);
    expect(ids(searchNodes(index, 'engine', 2))).toHaveLength(2);
    expect(searchNodes(index, '   ', 8)).toEqual([]);
    expect(searchNodes(index, 'zzz', 8)).toEqual([]);
  });
});
