import { describe, expect, test } from 'vitest';

import { addLink, addNote, freshNoteId, removeLink, removeNote } from '../../src/core/authorMap';
import { applyNodeEdit } from '../../src/core/editMap';
import { isOutOfDate, locate, narrowestAt } from '../../src/core/locate';
import { isSafeRelativePath, parseMap } from '../../src/core/parseMap';
import { hashLines, resolveAnchor } from '../../src/core/resolve';

const SOURCE = ['import os', '', 'def f(x):', '    return x + 1', '', 'def g():', '    return f(2)'];
const F_HASH = hashLines(SOURCE.slice(2, 4));

describe('hashLines', () => {
  test('matches the hash the Python tools write', () => {
    // Expected values computed by atlas.anchors.hash_lines.
    expect(hashLines(['def f(x):  ', '    return x + 1\t', ''])).toBe('64545701caa5b428');
    expect(hashLines(['naïve = "é"'])).toBe('8778be493e79ea8c');
  });

  test('strips only trailing spaces and tabs, as the Python tools do', () => {
    // A form feed and a no-break space are content, not trailing whitespace.
    expect(hashLines(['a\x0c ', 'b\u00a0'])).toBe('9ea111b436044941');
    expect(hashLines(['a\x0c'])).not.toBe(hashLines(['a']));
  });

  test('ignores trailing whitespace only', () => {
    expect(hashLines(['a = 1  '])).toBe(hashLines(['a = 1']));
    expect(hashLines(['  a = 1'])).not.toBe(hashLines(['a = 1']));
  });
});

describe('resolveAnchor', () => {
  const anchor = { file: 'a.py', startLine: 3, endLine: 4, hash: F_HASH };

  test('unchanged code is ok', () => {
    expect(resolveAnchor(SOURCE, anchor)).toEqual({ anchor, startLine: 3, endLine: 4, status: 'ok' });
  });

  test('code pushed down by new lines is followed', () => {
    const edited = ['# one', '# two', ...SOURCE];
    expect(resolveAnchor(edited, anchor)).toMatchObject({ startLine: 5, endLine: 6, status: 'moved' });
  });

  test('of two identical blocks the nearer one wins', () => {
    const doubled = [...SOURCE.slice(2, 4), 'x = 1', 'y = 2', 'z = 3', ...SOURCE.slice(2, 4)];
    expect(resolveAnchor(doubled, { ...anchor, startLine: 6, endLine: 7 })).toMatchObject({ startLine: 6, status: 'ok' });
    expect(resolveAnchor(doubled, { ...anchor, startLine: 5, endLine: 6 })).toMatchObject({ startLine: 6, status: 'moved' });
  });

  test('edited code keeps its place and is flagged', () => {
    const edited = SOURCE.map((line) => line.replace('x + 1', 'x + 2'));
    expect(resolveAnchor(edited, anchor)).toMatchObject({ startLine: 3, endLine: 4, status: 'changed' });
  });

  test('a range past the end of a shortened file is clamped', () => {
    expect(resolveAnchor(['only line'], { ...anchor, startLine: 40, endLine: 60 })).toMatchObject({
      startLine: 1,
      endLine: 1,
      status: 'changed',
    });
  });

  test('the search for moved code is skipped when it would cost too much', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `x${i} = ${i}`);
    const wide = { file: 'a.py', startLine: 1, endLine: 2500, hash: hashLines(big.slice(0, 2500)) };
    expect(resolveAnchor(big, wide)).toMatchObject({ status: 'ok' });
    // Shifted by one line: findable in principle, but 2501 windows of 2500 lines is too much.
    expect(resolveAnchor(['# shifted', ...big], wide)).toMatchObject({ startLine: 1, endLine: 2500, status: 'changed' });
  });

  test('an anchor that was never stamped is used as written', () => {
    expect(resolveAnchor(SOURCE, { file: 'a.py', startLine: 6, endLine: 7 })).toMatchObject({ startLine: 6, endLine: 7, status: 'unstamped' });
  });

  test('anchors without a usable range resolve to nothing', () => {
    expect(resolveAnchor(SOURCE, { file: 'a.py', symbol: 'f' })).toBeUndefined();
    expect(resolveAnchor(SOURCE, { file: 'a.py', startLine: 4, endLine: 3 })).toBeUndefined();
    expect(resolveAnchor(SOURCE, { file: 'a.py', startLine: 0, endLine: 3 })).toBeUndefined();
    expect(resolveAnchor([], anchor)).toBeUndefined();
  });
});

const MAP = {
  version: 1,
  title: 'T',
  nodes: [
    { id: 'mod', parent: null, kind: 'module', title: 'Module', anchors: [{ file: 'a.py', startLine: 1, endLine: 7, hash: hashLines(SOURCE) }] },
    { id: 'mod.f', parent: 'mod', kind: 'function', title: 'f', anchors: [{ file: 'a.py', startLine: 3, endLine: 4, hash: F_HASH }] },
    { id: 'mod.g', parent: 'mod', kind: 'function', title: 'g', stale: true, anchors: [{ file: 'a.py', startLine: 6, endLine: 7, hash: hashLines(SOURCE.slice(5, 7)) }] },
    { id: 'other', parent: null, kind: 'module', title: 'Other', anchors: [{ file: 'b.py', startLine: 1, endLine: 2 }] },
  ],
} as const;

describe('locate', () => {
  const map = JSON.parse(JSON.stringify(MAP));

  test('returns this file\'s nodes, outermost first', () => {
    expect(locate(map, 'a.py', SOURCE).map((l) => l.node.id)).toEqual(['mod', 'mod.f', 'mod.g']);
    expect(locate(map, 'c.py', SOURCE)).toEqual([]);
  });

  test('narrowestAt picks the most specific node', () => {
    const located = locate(map, 'a.py', SOURCE);
    expect(narrowestAt(located, 4)?.node.id).toBe('mod.f');
    expect(narrowestAt(located, 1)?.node.id).toBe('mod');
    expect(narrowestAt(located, 99)).toBeUndefined();
  });

  test('a node is out of date when flagged stale or when its code changed', () => {
    const edited = SOURCE.map((line) => line.replace('x + 1', 'x + 2'));
    const byId = Object.fromEntries(locate(map, 'a.py', edited).map((l) => [l.node.id, isOutOfDate(l)]));
    expect(byId).toEqual({ mod: true, 'mod.f': true, 'mod.g': true });
    const fresh = Object.fromEntries(locate(map, 'a.py', SOURCE).map((l) => [l.node.id, isOutOfDate(l)]));
    expect(fresh).toEqual({ mod: false, 'mod.f': false, 'mod.g': true });
  });
});

describe('parseMap', () => {
  test('reads a well-formed map', () => {
    const result = parseMap(JSON.stringify({ ...MAP, summary: 'S', edges: [{ from: 'mod.f', to: 'mod.g', label: 'x' }] }));
    expect(result).toMatchObject({ ok: true, dropped: 0 });
    if (!result.ok) return;
    expect(result.map.nodes).toHaveLength(4);
    expect(result.map.edges).toEqual([{ from: 'mod.f', to: 'mod.g', label: 'x' }]);
    expect(result.map.nodes[2]).toMatchObject({ stale: true });
  });

  test('rejects files that are not a map', () => {
    expect(parseMap('{nope')).toMatchObject({ ok: false });
    expect(parseMap('[]')).toMatchObject({ ok: false });
    expect(parseMap('{"version":1}')).toMatchObject({ ok: false });
    expect(parseMap('{"version":1,"nodes":[{"bad":true}]}')).toMatchObject({ ok: false });
    const future = parseMap('{"version":2,"nodes":[]}');
    expect(future.ok === false && future.error).toContain('version 2');
  });

  test('drops malformed entries and keeps the rest', () => {
    const result = parseMap(
      JSON.stringify({
        version: 1,
        nodes: [
          { id: 'a', parent: null, kind: 'step', title: 'A', anchors: [{ file: '../../etc/passwd', startLine: 1, endLine: 2 }, { file: 'ok.py', startLine: 5, endLine: 2 }] },
          { id: 'a', parent: null, kind: 'step', title: 'Duplicate' },
          { id: 'b', parent: 7, kind: 'widget', title: 'Bad kind' },
          'not a node',
        ],
        edges: [{ from: 'a', to: 'missing' }, { from: 'a', to: 'a' }],
      }),
    );
    expect(result).toMatchObject({ ok: true, dropped: 6 });
    if (!result.ok) return;
    expect(result.map.title).toBe('Code map');
    expect(result.map.nodes).toHaveLength(1);
    // The escaping anchor is gone; the inverted range is kept as a file-only anchor.
    expect(result.map.nodes[0]?.anchors).toEqual([{ file: 'ok.py' }]);
    expect(result.map.edges).toEqual([]);
  });

  test('refuses paths that leave the workspace', () => {
    for (const file of ['/etc/passwd', '../x', 'a/../../x', 'C:/x', 'a\\b', '', 7]) {
      expect(isSafeRelativePath(file)).toBe(false);
    }
    expect(isSafeRelativePath('src/a.py')).toBe(true);
  });
});

describe('applyNodeEdit', () => {
  const source = `${JSON.stringify(
    {
      version: 1,
      title: 'T',
      custom: { kept: true },
      nodes: [
        { id: 'a', parent: null, kind: 'service', title: 'A', summary: 'Old.', explanation: 'Why.', extra: [1, 2] },
        { id: 'b', parent: 'a', kind: 'step', title: 'B' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    },
    null,
    2,
  )}\n`;
  const edited = (nodeId: unknown, changes: unknown) => {
    const result = applyNodeEdit(source, nodeId, changes);
    if (!result.ok) throw new Error(result.error);
    return JSON.parse(result.text) as { custom: unknown; nodes: Record<string, unknown>[]; edges: unknown[] };
  };

  test('changes only the named fields of the named node', () => {
    const data = edited('a', { title: ' Alpha ', kind: 'module', summary: 'New.' });
    expect(data.nodes[0]).toEqual({ id: 'a', parent: null, kind: 'module', title: 'Alpha', summary: 'New.', explanation: 'Why.', extra: [1, 2] });
    expect(data.nodes[1]).toEqual({ id: 'b', parent: 'a', kind: 'step', title: 'B' });
    expect(data.custom).toEqual({ kept: true });
    expect(data.edges).toEqual([{ from: 'a', to: 'b' }]);
  });

  test('an emptied summary or explanation is removed, not stored as empty', () => {
    const [node] = edited('a', { summary: '', explanation: '  ' }).nodes;
    expect(node).not.toHaveProperty('summary');
    expect(node).not.toHaveProperty('explanation');
  });

  test('writes the same formatting the skill writes, so an unchanged file round-trips', () => {
    const result = applyNodeEdit(source, 'b', { title: 'B' });
    expect(result).toEqual({ ok: true, text: source });
  });

  test('ignores fields a reader may not change', () => {
    const [node] = edited('a', { title: 'A2', id: 'hijack', parent: 'b', anchors: [{ file: '/etc/passwd' }], stale: false }).nodes;
    expect(node).toMatchObject({ id: 'a', parent: null, title: 'A2' });
    expect(node).not.toHaveProperty('anchors');
    expect(node).not.toHaveProperty('stale');
  });

  test.each([
    [{ title: '' }, /needs a name/],
    [{ title: 'two\nlines' }, /one line/],
    [{ title: 'x'.repeat(121) }, /one line/],
    [{ kind: 'wizard' }, /kind must be/],
    [{ summary: 'x'.repeat(161) }, /at most 160/],
    [{ summary: 7 }, /at most 160/],
    [{ explanation: 'x'.repeat(20001) }, /too long/],
    [{}, /Nothing to change/],
    [{ unknown: 'field' }, /Nothing to change/],
    ['title', /expected format/],
    [null, /expected format/],
  ])('refuses %j', (changes, reason) => {
    const result = applyNodeEdit(source, 'a', changes);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(reason);
  });

  test('refuses an unknown node, a missing id and a file that is not a map', () => {
    expect(applyNodeEdit(source, 'zzz', { title: 'X' })).toMatchObject({ ok: false, error: expect.stringMatching(/no longer in the map/) });
    expect(applyNodeEdit(source, 5, { title: 'X' })).toMatchObject({ ok: false });
    expect(applyNodeEdit('{broken', 'a', { title: 'X' })).toMatchObject({ ok: false, error: expect.stringMatching(/not valid JSON/) });
    expect(applyNodeEdit('[]', 'a', { title: 'X' })).toMatchObject({ ok: false, error: expect.stringMatching(/expected format/) });
  });
});

describe('notes and links', () => {
  const source = `${JSON.stringify(
    {
      version: 1,
      title: 'T',
      nodes: [
        { id: 'a', parent: null, kind: 'service', title: 'A' },
        { id: 'a.x', parent: 'a', kind: 'function', title: 'X' },
      ],
      edges: [{ from: 'a', to: 'a.x', label: 'calls' }],
    },
    null,
    2,
  )}\n`;
  type Data = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
  const read = (result: { ok: boolean; text?: string; error?: string }): Data => {
    if (!result.ok || result.text === undefined) throw new Error(result.error);
    return JSON.parse(result.text) as Data;
  };
  const anchor = { file: 'src/a.py', startLine: 3, endLine: 5, hash: '0123456789abcdef' };

  test('a note about selected code is anchored, placed in a flow and linked to its box', () => {
    const result = addNote(source, { parent: 'a', title: 'Note on a.py:3', anchor, about: 'a.x', seed: 100 });
    expect(result.ok && result.id).toBe('note.2s');
    const data = read(result);
    expect(data.nodes[2]).toEqual({ id: 'note.2s', parent: 'a', kind: 'note', title: 'Note on a.py:3', anchors: [anchor] });
    expect(data.edges[1]).toEqual({ from: 'note.2s', to: 'a.x', user: true });
    expect(data.nodes.slice(0, 2)).toEqual(JSON.parse(source).nodes);
  });

  test('a blank note has no anchor and no arrow, and ids never collide', () => {
    const first = addNote(source, { parent: null, title: 'New note', seed: 7 });
    const second = addNote(first.ok ? first.text : '', { parent: null, title: 'New note', seed: 7 });
    expect([first.ok && first.id, second.ok && second.id]).toEqual(['note.7', 'note.8']);
    expect(read(first).nodes[2]).toEqual({ id: 'note.7', parent: null, kind: 'note', title: 'New note' });
    expect(read(first).edges).toHaveLength(1);
    expect(freshNoteId(new Set(['note.a', 'note.b']), 10)).toBe('note.c');
  });

  test('refuses a note in a flow that is gone or with an anchor it cannot trust', () => {
    expect(addNote(source, { parent: 'gone', title: 'N' })).toMatchObject({ ok: false, error: expect.stringMatching(/no longer in the map/) });
    for (const bad of [{ ...anchor, file: '../etc/passwd' }, { ...anchor, hash: 'xyz' }, { file: 'src/a.py' }]) {
      expect(addNote(source, { parent: null, title: 'N', anchor: bad as never })).toMatchObject({ ok: false });
    }
  });

  test('only an empty note can be deleted, and its arrows go with it', () => {
    const withNote = addNote(source, { parent: 'a', title: 'N', about: 'a.x', seed: 1 });
    const text = withNote.ok ? withNote.text : '';
    expect(read(removeNote(text, 'note.1'))).toEqual(JSON.parse(source));
    expect(removeNote(text, 'a.x')).toMatchObject({ ok: false, error: expect.stringMatching(/Only notes/) });
    expect(removeNote(text, 'nope')).toMatchObject({ ok: false });
    const nested = addNote(text, { parent: 'note.1', title: 'Inner', seed: 2 });
    expect(removeNote(nested.ok ? nested.text : '', 'note.1')).toMatchObject({ ok: false, error: expect.stringMatching(/boxes inside/) });
  });

  test('a link is added once, marked as the user\'s, and removed by direction', () => {
    const linked = addLink(source, 'a.x', 'a', ' result ');
    expect(read(linked).edges[1]).toEqual({ from: 'a.x', to: 'a', label: 'result', user: true });
    expect(read(addLink(source, 'a.x', 'a', '')).edges[1]).toEqual({ from: 'a.x', to: 'a', user: true });
    expect(addLink(linked.ok ? linked.text : '', 'a.x', 'a', 'result')).toMatchObject({ ok: false, error: expect.stringMatching(/already linked/) });
    const removed = removeLink(linked.ok ? linked.text : '', 'a.x', 'a');
    expect(read(removed)).toEqual(JSON.parse(source));
    expect(removeLink(source, 'a.x', 'a')).toMatchObject({ ok: false, error: expect.stringMatching(/no longer in the map/) });
    expect(removeLink(source, 'a', 'a.x')).toMatchObject({ ok: false, error: expect.stringMatching(/Only links you drew/) });
  });

  test.each([
    ['a', 'a', 'x', /itself/],
    ['a', 'gone', 'x', /no longer in the map/],
    [5, 'a', 'x', /no longer in the map/],
    ['a', 'a.x', 'x'.repeat(61), /one line/],
    ['a', 'a.x', 'two\nlines', /one line/],
    ['a', 'a.x', 7, /one line/],
  ])('refuses a link from %j to %j labelled %j', (from, to, label, reason) => {
    const result = addLink(source, from, to, label);
    expect(!result.ok && result.error).toMatch(reason);
  });

  test('a kind edit cannot turn a box into a note or a note into a box', () => {
    const withNote = addNote(source, { parent: null, title: 'N', seed: 1 });
    const text = withNote.ok ? withNote.text : '';
    expect(applyNodeEdit(text, 'a', { kind: 'note' })).toMatchObject({ ok: false, error: expect.stringMatching(/stays a note/) });
    expect(applyNodeEdit(text, 'note.1', { kind: 'step' })).toMatchObject({ ok: false });
    expect(applyNodeEdit(text, 'note.1', { kind: 'note', title: 'Renamed' })).toMatchObject({ ok: true });
  });

  test('none of them touch a file that is not a map', () => {
    expect(addNote('{', { parent: null, title: 'N' })).toMatchObject({ ok: false });
    expect(removeNote('[]', 'a')).toMatchObject({ ok: false });
    expect(addLink('null', 'a', 'b', '')).toMatchObject({ ok: false });
  });
});
