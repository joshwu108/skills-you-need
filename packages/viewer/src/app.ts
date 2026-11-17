/**
 * Wires the header, diagram and panel to one piece of state: which level is
 * shown (`view`) and which node in it is selected (`selected`).
 *
 * Focusing a node with children opens it as the view; focusing a leaf shows
 * its parent's flow with the leaf selected. Everything else derives from that.
 */

import { createDiagram } from './diagram';
import type { Direction } from './diagram';
import { clear, h } from './dom';
import { buildIndex, childrenOf, parentIdOf, pathTo, staleNodes, viewOf } from './graph';
import { createPanel } from './panel';
import type { AtlasData, Host } from './types';

export interface Controller {
  /** Show `nodeId` (null for the top level). Returns false for an unknown id. */
  focus(nodeId: string | null): boolean;
  /** The focused node id, or null at the top level. */
  focused(): string | null;
  destroy(): void;
}

interface State {
  view: string | null;
  selected: string | null;
}

export function mount(container: HTMLElement, data: AtlasData, host: Host): Controller {
  const index = buildIndex(data.map);
  let state: State = { view: null, selected: null };

  const crumbs = h('ol', { class: 'atlas-crumbs' });
  const staleCount = staleNodes(index).length;
  const header = h(
    'header',
    { class: 'atlas-bar' },
    h('span', { class: 'atlas-mark', 'aria-hidden': 'true' }, 'CodeAtlas'),
    h('nav', { 'aria-label': 'Location in the map' }, crumbs),
    staleCount > 0 && h('span', { class: 'atlas-stale-count' }, `${staleCount} out of date`),
    host.toolbar,
  );

  const diagram = createDiagram({
    onActivate: ({ node }) => focus(node.id),
    onOpenCode: ({ node }) => {
      const first = node.anchors?.[0];
      if (first) host.openAnchor(first);
    },
  });
  const panel = createPanel(index, {
    onOpenAnchor: (anchor) => host.openAnchor(anchor),
    onFocus: (nodeId) => focus(nodeId),
  });
  const root = h('div', { class: 'atlas' }, header, diagram.element, panel.element);

  const renderCrumbs = (): void => {
    clear(crumbs);
    const path = pathTo(index, state.view);
    const entries = [{ id: null as string | null, title: data.map.title }, ...path];
    entries.forEach((entry, position) => {
      const isCurrent = position === entries.length - 1;
      const button = h('button', { type: 'button', class: 'atlas-crumb' }, entry.title);
      if (isCurrent) button.setAttribute('aria-current', 'location');
      button.addEventListener('click', () => focus(entry.id));
      crumbs.appendChild(h('li', {}, button));
    });
  };

  const render = (direction: Direction): void => {
    renderCrumbs();
    diagram.show(viewOf(index, state.view), state.selected, direction);
    const shown = index.byId.get(state.selected ?? state.view ?? '');
    if (shown) panel.showNode(shown);
    else panel.showOverview();
  };

  const directionTo = (view: string | null): Direction => {
    if (view === state.view) return 'none';
    const isDeeper = pathTo(index, view).length > pathTo(index, state.view).length;
    return isDeeper ? 'in' : 'out';
  };

  function focus(nodeId: string | null): boolean {
    const node = nodeId === null ? undefined : index.byId.get(nodeId);
    if (nodeId !== null && !node) return false;

    const opensOwnFlow = !node || childrenOf(index, node.id).length > 0;
    const view = opensOwnFlow ? (node?.id ?? null) : parentIdOf(index, node.id);
    const next: State = { view, selected: opensOwnFlow ? null : node.id };
    if (next.view === state.view && next.selected === state.selected) return true;

    const direction = directionTo(next.view);
    state = next;
    render(direction);
    host.onNavigate?.(focused());
    return true;
  }

  function focused(): string | null {
    return state.selected ?? state.view;
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (state.selected !== null) focus(state.view);
    else if (state.view !== null) focus(parentIdOf(index, state.view));
  };
  root.addEventListener('keydown', onKeyDown);

  container.replaceChildren(root);
  render('none');

  return {
    focus,
    focused,
    destroy() {
      root.removeEventListener('keydown', onKeyDown);
      diagram.destroy();
      root.remove();
    },
  };
}
