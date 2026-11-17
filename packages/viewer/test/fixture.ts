import type { AtlasMap } from '../src/types';

/** Two services, one with a two-level sub-flow, and edges at mixed depths. */
export const SAMPLE: AtlasMap = {
  version: 1,
  title: 'Sample',
  summary: 'A **small** system.',
  nodes: [
    { id: 'api', parent: null, kind: 'service', title: 'API', summary: 'Takes requests.' },
    { id: 'engine', parent: null, kind: 'service', title: 'Engine', summary: 'Matches orders.', explanation: 'Owns the `book`.' },
    { id: 'db', parent: null, kind: 'external', title: 'Database' },
    {
      id: 'engine.step',
      parent: 'engine',
      kind: 'function',
      title: 'Step',
      summary: 'Adds one order.',
      explanation: 'Appends, then counts.',
      anchors: [{ file: 'src/engine.py', symbol: 'Engine.step', startLine: 20, endLine: 22 }],
      stale: true,
      staleReason: 'src/engine.py (Engine.step) changed',
    },
    {
      id: 'engine.fee',
      parent: 'engine',
      kind: 'function',
      title: 'Fee',
      anchors: [{ file: 'src/engine.py', symbol: 'Engine.fee', startLine: 16, endLine: 18 }],
    },
    { id: 'engine.step.check', parent: 'engine.step', kind: 'step', title: 'Check', anchors: [{ file: 'src/engine.py', startLine: 21, endLine: 21 }] },
    { id: 'api.route', parent: 'api', kind: 'function', title: 'Route', planned: true },
  ],
  edges: [
    { from: 'api', to: 'engine', label: 'orders' },
    { from: 'api.route', to: 'engine.step', label: 'order' },
    { from: 'engine.step', to: 'engine.fee', label: 'notional' },
    { from: 'engine.fee', to: 'db', label: 'fee row', kind: 'data' },
    { from: 'engine', to: 'db', label: 'fills' },
  ],
};
