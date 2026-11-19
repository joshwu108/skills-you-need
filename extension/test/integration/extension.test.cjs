/** Runs inside a real VS Code window opened on test/fixture-workspace. */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

const POLL_MS = 100;
const WAIT_MS = 10000;

async function waitFor(read, description) {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function lensesFor(uri) {
  return vscode.commands.executeCommand('vscode.executeCodeLensProvider', uri);
}

function atlasLenses(lenses) {
  return lenses
    .filter((lens) => lens.command?.command === 'codeatlas.showNode')
    .map((lens) => ({ line: lens.range.start.line, title: lens.command.title, node: lens.command.arguments[1] }))
    .sort((a, b) => a.line - b.line);
}

suite('CodeAtlas extension', () => {
  let api;
  let folder;
  let document;
  let editor;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('joshwu108.codeatlas');
    assert.ok(extension, 'the extension is installed in the test host');
    api = await extension.activate();
    folder = vscode.workspace.workspaceFolders[0].uri;
    document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, 'src', 'engine.py'));
    editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
  });

  let mapFile;
  let layoutFile;
  let originalMap;

  suiteSetup(() => {
    mapFile = path.join(folder.fsPath, '.codeatlas', 'map.json');
    layoutFile = path.join(folder.fsPath, '.codeatlas', 'layout.json');
    originalMap = fs.readFileSync(mapFile, 'utf8');
  });

  // The fixture is part of the repository: leave it as it was found.
  suiteTeardown(() => {
    fs.rmSync(layoutFile, { force: true });
    fs.writeFileSync(mapFile, originalMap);
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('loads the map in the workspace folder', () => {
    assert.deepStrictEqual(api.foldersWithMaps(), [folder.toString()]);
  });

  test('puts a code lens above each explained range', async () => {
    const lenses = atlasLenses(await lensesFor(document.uri));
    assert.deepStrictEqual(
      lenses.map(({ line, node }) => [line, node]),
      [
        [9, 'engine'],
        [15, 'engine.fee'],
        [19, 'engine.step'],
      ],
    );
    assert.match(lenses[2].title, /Step · function$/);
  });

  test('describes the node when its first line is hovered', async () => {
    const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, new vscode.Position(19, 8));
    // VS Code escapes plain text in hovers, turning spaces into non-breaking ones.
    const text = hovers.flatMap((hover) => hover.contents).map((content) => content.value ?? String(content)).join('\n').replaceAll('&nbsp;', ' ');
    assert.match(text, /\*\*Step\*\*/);
    assert.match(text, /Adds one order\./);
    assert.match(text, /command:codeatlas\.showNode/);
  });

  test('follows code moved by an unsaved edit and flags code that changed', async () => {
    await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), '# one\n# two\n'));
    let lenses = atlasLenses(await lensesFor(document.uri));
    assert.deepStrictEqual(lenses.map((lens) => lens.line), [11, 17, 21]);
    assert.doesNotMatch(lenses[1].title, /out of date/);

    const feeBody = document.lineAt(19);
    await editor.edit((builder) => builder.replace(feeBody.range, '        return notional * FEE_RATE * 2'));
    lenses = atlasLenses(await lensesFor(document.uri));
    assert.match(lenses[1].title, /Fee · function · out of date$/);
    assert.doesNotMatch(lenses[2].title, /out of date/);

    await vscode.commands.executeCommand('workbench.action.files.revert');
    lenses = atlasLenses(await lensesFor(document.uri));
    assert.deepStrictEqual(lenses.map((lens) => lens.line), [9, 15, 19]);
  });

  test('"Explain This Code" opens the map on the node under the cursor', async () => {
    assert.strictEqual(api.focusedNode(folder.toString()), undefined, 'no panel yet');
    editor.selection = new vscode.Selection(20, 4, 20, 4);
    await vscode.commands.executeCommand('codeatlas.explainHere');
    await waitFor(() => api.focusedNode(folder.toString()) === 'engine.step', 'the panel to focus engine.step');
    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).map((tab) => tab.label);
    assert.ok(tabs.includes('CodeAtlas: fixture-workspace'), `panel tab among ${tabs.join(', ')}`);
  });

  test('moving the cursor to other explained code moves the map with it', async () => {
    editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
    editor.selection = new vscode.Selection(17, 8, 17, 8);
    await waitFor(() => api.focusedNode(folder.toString()) === 'engine.fee', 'the panel to follow the cursor to engine.fee');
  });

  test('a lens for a node that no longer exists reports it instead of failing', async () => {
    await vscode.commands.executeCommand('codeatlas.showNode', folder.toString(), 'not.a.node');
    assert.strictEqual(api.focusedNode(folder.toString()), 'engine.fee');
  });

  test('"Open Map" reuses the open panel', async () => {
    await vscode.commands.executeCommand('codeatlas.openMap');
    const panels = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => tab.label.startsWith('CodeAtlas:'));
    assert.strictEqual(panels.length, 1);
  });

  test('an edit made in the diagram is written to the map and shows up in the editor', async () => {
    const problem = await api.editNode(folder.toString(), 'engine.fee', { title: 'Fee charge', summary: 'Charges the taker.' });
    assert.strictEqual(problem, undefined);
    const saved = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    const before = JSON.parse(originalMap);
    const fee = saved.nodes.find((node) => node.id === 'engine.fee');
    assert.strictEqual(fee.title, 'Fee charge');
    assert.strictEqual(fee.summary, 'Charges the taker.');
    assert.deepStrictEqual(fee.anchors, before.nodes.find((node) => node.id === 'engine.fee').anchors);
    assert.deepStrictEqual(saved.edges, before.edges);
    await waitFor(
      async () => atlasLenses(await lensesFor(document.uri)).some((lens) => /Fee charge · function$/.test(lens.title)),
      'the code lens to show the new name',
    );
  });

  test('an edit that is not acceptable is refused and leaves the map alone', async () => {
    const before = fs.readFileSync(mapFile, 'utf8');
    assert.match(await api.editNode(folder.toString(), 'engine.fee', { title: '' }), /needs a name/);
    assert.match(await api.editNode(folder.toString(), 'gone', { title: 'X' }), /no longer in the map/);
    assert.strictEqual(fs.readFileSync(mapFile, 'utf8'), before);
  });

  test('an edit is refused while the map file has unsaved changes in an editor', async () => {
    const mapDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(mapFile));
    const mapEditor = await vscode.window.showTextDocument(mapDocument, vscode.ViewColumn.One);
    await mapEditor.edit((builder) => builder.insert(new vscode.Position(0, 0), ' '));
    assert.match(await api.editNode(folder.toString(), 'engine.fee', { title: 'Lost' }), /unsaved changes/);
    await vscode.commands.executeCommand('workbench.action.files.revert');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('dragged boxes are remembered in the layout file, checked on the way in', async () => {
    await api.savePositions(folder.toString(), null, { engine: { x: 41, y: 83 }, bad: { x: 'no', y: 1 } });
    await api.savePositions(folder.toString(), 'engine', { 'engine.fee': { x: 160, y: 8 } });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(layoutFile, 'utf8')), {
      version: 1,
      views: { ':root': { engine: { x: 40, y: 80 } }, engine: { 'engine.fee': { x: 160, y: 8 } } },
    });
    await api.savePositions(folder.toString(), null, {});
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(layoutFile, 'utf8')).views), ['engine']);
  });

  test('a layout file that is a link to another file is never written through', async function () {
    const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codeatlas-')), 'victim.txt');
    fs.writeFileSync(outside, 'do not overwrite');
    fs.rmSync(layoutFile, { force: true });
    try {
      fs.symlinkSync(outside, layoutFile);
    } catch {
      this.skip(); // No permission to create links on this machine.
    }
    await api.savePositions(folder.toString(), null, { engine: { x: 8, y: 8 } });
    assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'do not overwrite');
    fs.rmSync(layoutFile, { force: true });
  });

  test('"Add Note for Selection" records the lines, links the note to their box and opens it for writing', async () => {
    editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
    editor.selection = new vscode.Selection(20, 0, 22, 0);
    await vscode.commands.executeCommand('codeatlas.addNote');
    const saved = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    const note = saved.nodes.find((node) => node.kind === 'note');
    assert.ok(note, 'a note node was written');
    assert.match(note.id, /^note\.[a-z0-9]+$/);
    assert.strictEqual(note.parent, 'engine');
    assert.strictEqual(note.title, 'Note on engine.py:21');
    assert.strictEqual(note.anchors[0].file, 'src/engine.py');
    assert.deepStrictEqual([note.anchors[0].startLine, note.anchors[0].endLine], [21, 22]);
    assert.match(note.anchors[0].hash, /^[0-9a-f]{16}$/);
    assert.deepStrictEqual(saved.edges[saved.edges.length - 1], { from: note.id, to: 'engine.step', user: true });
    await waitFor(() => api.focusedNode(folder.toString()) === note.id, 'the panel to open on the new note');
    const lenses = atlasLenses(await lensesFor(document.uri));
    assert.ok(lenses.some((lens) => lens.node === note.id), 'the note has a code lens on its lines');
  });

  test('a blank note and hand-drawn links are written to the map and can be removed', async () => {
    const added = await api.addNote(folder.toString(), 'engine');
    assert.match(added.id, /^note\./);
    assert.strictEqual(await api.addLink(folder.toString(), added.id, 'engine.fee', 'see also'), undefined);
    assert.match(await api.addLink(folder.toString(), added.id, 'engine.fee', 'see also'), /already linked/);
    let saved = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    assert.deepStrictEqual(saved.edges[saved.edges.length - 1], { from: added.id, to: 'engine.fee', label: 'see also', user: true });
    assert.strictEqual(await api.removeLink(folder.toString(), added.id, 'engine.fee'), undefined);
    saved = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    assert.ok(!saved.edges.some((edge) => edge.from === added.id));
    assert.match((await api.addNote(folder.toString(), 'not.a.node')).error, /no longer in the map/);
  });

  test('changes made in quick succession are all kept', async () => {
    const results = await Promise.all([
      api.addNote(folder.toString(), null),
      api.addNote(folder.toString(), null),
      api.editNode(folder.toString(), 'engine', { summary: 'Edited alongside.' }),
    ]);
    const saved = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    assert.notStrictEqual(results[0].id, results[1].id);
    assert.ok(saved.nodes.some((node) => node.id === results[0].id));
    assert.ok(saved.nodes.some((node) => node.id === results[1].id));
    assert.strictEqual(saved.nodes.find((node) => node.id === 'engine').summary, 'Edited alongside.');
  });
});
