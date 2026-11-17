/** Runs inside a real VS Code window opened on test/fixture-workspace. */

const assert = require('node:assert');
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
});
