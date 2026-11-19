import { describe, expect, test } from 'vitest';

import { buildIndex, viewOf } from '../src/graph';
import { GHOST_WIDTH, NODE_HEIGHT, NODE_WIDTH, applyPositions, edgeLabel, layoutView, smoothPath } from '../src/layout';
import { anchorLabel, editorUrl, isEditorScheme, isEmbeddedBrowser, isSafeRelativePath } from '../src/links';
import { SAMPLE } from './fixture';

const index = buildIndex(SAMPLE);

describe('layoutView', () => {
  test('places every node inside the canvas without overlap', () => {
    const layout = layoutView(viewOf(index, null));
    expect(layout.boxes.map((b) => b.id).sort()).toEqual(['api', 'db', 'engine']);
    for (const box of layout.boxes) {
      expect(box.width).toBe(NODE_WIDTH);
      expect(box.height).toBe(NODE_HEIGHT);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(layout.width);
      expect(box.y + box.height).toBeLessThanOrEqual(layout.height);
    }
    const [a, b, c] = ['api', 'engine', 'db'].map((id) => layout.boxes.find((box) => box.id === id)!);
    expect(a!.y + a!.height).toBeLessThan(b!.y);
    expect(b!.y + b!.height).toBeLessThan(c!.y);
  });

  test('routes each edge and positions its label', () => {
    const layout = layoutView(viewOf(index, null));
    expect(layout.routes).toHaveLength(2);
    const route = layout.routes.find((r) => r.from === 'api')!;
    expect(route.points.length).toBeGreaterThanOrEqual(2);
    expect(route.label?.text).toBe('orders · order');
  });

  test('ghosts are drawn smaller', () => {
    const layout = layoutView(viewOf(index, 'engine'));
    expect(layout.boxes.find((b) => b.id === 'api')?.width).toBe(GHOST_WIDTH);
  });

  test('an empty view has no size', () => {
    const layout = layoutView(viewOf(index, 'engine.fee'));
    expect(layout.boxes).toEqual([]);
    expect(layout.routes).toEqual([]);
  });
});

describe('edge drawing', () => {
  test('long labels are shortened', () => {
    expect(edgeLabel(['a', 'b'])).toBe('a · b');
    expect(edgeLabel(['x'.repeat(40)])).toHaveLength(28);
    expect(edgeLabel([])).toBe('');
  });

  test('paths start and end on the given points', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toBe('M1,2 L3,4');
    expect(smoothPath([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 20 }, { x: 10, y: 30 }])).toBe(
      'M0,0 Q0,10 5,15 Q10,20 10,30',
    );
  });
});

describe('links', () => {
  const anchor = { file: 'src/my file.py', startLine: 12, endLine: 20 };

  test('builds an editor link to the first line', () => {
    expect(editorUrl('vscode', '/Users/me/repo/', anchor)).toBe('vscode://file/Users/me/repo/src/my%20file.py:12');
    expect(editorUrl('cursor', 'C:\\work\\repo', anchor)).toBe('cursor://file/C:/work/repo/src/my%20file.py:12');
    expect(editorUrl('vscode', '/r', { file: 'a.py' })).toBe('vscode://file/r/a.py:1');
  });

  test('labels an anchor with its range', () => {
    expect(anchorLabel(anchor)).toBe('src/my file.py:12–20');
    expect(anchorLabel({ file: 'a.py', startLine: 3, endLine: 3 })).toBe('a.py:3');
    expect(anchorLabel({ file: 'a.py' })).toBe('a.py');
  });

  test('refuses a path that would leave the repository, and a line that is not a number', () => {
    expect(editorUrl('vscode', '/r', { file: '../../.ssh/id_rsa', startLine: 1 })).toBeNull();
    expect(editorUrl('vscode', '/r', { file: '/etc/passwd' })).toBeNull();
    expect(editorUrl('vscode', '/r', { file: 'a.py', startLine: '1?x' as unknown as number })).toBe('vscode://file/r/a.py:1');
    expect(isSafeRelativePath('src/a.py')).toBe(true);
    for (const file of ['C:/x', 'a\\b', 'a/../b', '', 7]) expect(isSafeRelativePath(file)).toBe(false);
  });

  test('accepts only known editor schemes', () => {
    expect(isEditorScheme('cursor')).toBe(true);
    expect(isEditorScheme('javascript')).toBe(false);
    expect(isEditorScheme(null)).toBe(false);
  });
});

describe('applyPositions', () => {
  const view = viewOf(buildIndex(SAMPLE), null);
  const automatic = layoutView(view);

  test('no positions leaves the automatic layout as it is', () => {
    expect(applyPositions(automatic, {})).toBe(automatic);
    expect(applyPositions(automatic, { 'not.in.view': { x: 0, y: 0 } })).toBe(automatic);
  });

  test('moves the placed box and leaves the others', () => {
    const placed = applyPositions(automatic, { api: { x: 640, y: 480 } });
    expect(placed.boxes.find((box) => box.id === 'api')).toMatchObject({ x: 640, y: 480 });
    expect(placed.boxes.find((box) => box.id === 'db')).toEqual(automatic.boxes.find((box) => box.id === 'db'));
    expect(automatic.boxes.find((box) => box.id === 'api')?.x).not.toBe(640);
  });

  test('redraws arrows touching the moved box between the two box edges', () => {
    const placed = applyPositions(automatic, { api: { x: 640, y: 480 } });
    const moved = placed.routes.find((route) => route.from === 'api' && route.to === 'engine');
    const api = placed.boxes.find((box) => box.id === 'api')!;
    expect(moved?.points).toHaveLength(2);
    const [start] = moved!.points;
    const onEdge =
      start!.x === api.x || start!.x === api.x + api.width || start!.y === api.y || start!.y === api.y + api.height;
    expect(onEdge).toBe(true);
    expect(moved?.label?.text).toBe('orders · order');
    const untouched = placed.routes.find((route) => route.from === 'engine' && route.to === 'db');
    expect(untouched).toEqual(automatic.routes.find((route) => route.from === 'engine' && route.to === 'db'));
  });

  test('grows the drawing to contain a box dragged past its edge', () => {
    const placed = applyPositions(automatic, { api: { x: 4000, y: 3000 } });
    expect(placed.width).toBeGreaterThan(4000 + NODE_WIDTH);
    expect(placed.height).toBeGreaterThan(3000 + NODE_HEIGHT);
  });
});

describe('isEmbeddedBrowser', () => {
  test('recognises an editor built-in browser by its Electron user agent', () => {
    const editor = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Code/1.99.0 Chrome/134.0 Electron/35.1 Safari/537.36';
    const chrome = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
    expect(isEmbeddedBrowser(editor)).toBe(true);
    expect(isEmbeddedBrowser(chrome)).toBe(false);
  });
});
