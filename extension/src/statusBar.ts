/** A status bar entry that opens the map and reports stale or unreadable maps. */

import * as vscode from 'vscode';

import type { Stores } from './mapStore';

function staleCount(stores: Stores): number {
  return stores
    .withMaps()
    .reduce((count, store) => count + (store.map?.nodes.filter((node) => node.stale).length ?? 0), 0);
}

export function statusBar(stores: Stores): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  item.command = 'codeatlas.openMap';
  item.name = 'CodeAtlas';

  const update = (): void => {
    const broken = stores.all().find((store) => store.error !== undefined);
    const stale = staleCount(stores);
    if (broken) {
      item.text = '$(error) CodeAtlas';
      item.tooltip = broken.error;
    } else if (stale > 0) {
      item.text = `$(warning) CodeAtlas: ${stale} out of date`;
      item.tooltip = 'Some explanations no longer match their code. Ask Claude to refresh the map.';
    } else {
      item.text = '$(type-hierarchy-sub) CodeAtlas';
      item.tooltip = 'Open the code map';
    }
    if (stores.withMaps().length > 0 || broken) item.show();
    else item.hide();
  };
  const subscription = stores.onDidChange(update);
  update();
  return vscode.Disposable.from(item, subscription);
}
