/** The reading panel: what the focused node is, why it exists, and where its code lives. */

import { clear, h } from './dom';
import type { AtlasIndex } from './graph';
import { childrenOf, staleNodes } from './graph';
import { anchorLabel } from './links';
import { renderInlineMarkdown, renderMarkdown } from './markdown';
import type { Anchor, AtlasNode } from './types';

export interface PanelHandlers {
  onOpenAnchor(anchor: Anchor): void;
  onFocus(nodeId: string): void;
}

export interface Panel {
  element: HTMLElement;
  showNode(node: AtlasNode): void;
  showOverview(): void;
}

/** A one-line summary; it may contain inline Markdown such as `code`. */
function summary(className: string, text: string): HTMLElement {
  const element = h('span', className ? { class: className } : {});
  renderInlineMarkdown(document, text, element);
  return element;
}

function tags(node: AtlasNode): HTMLElement {
  return h(
    'p',
    { class: 'atlas-tags' },
    h('span', { class: `atlas-tag is-${node.kind}` }, node.kind),
    node.planned && h('span', { class: 'atlas-tag is-flag' }, 'planned'),
    node.stale && h('span', { class: 'atlas-tag is-warning' }, 'out of date'),
  );
}

function anchorList(anchors: Anchor[], handlers: PanelHandlers): HTMLElement {
  const items = anchors.map((anchor) => {
    const button = h(
      'button',
      { type: 'button', class: 'atlas-anchor' },
      h('span', { class: 'atlas-anchor-path' }, anchorLabel(anchor)),
      anchor.symbol && h('span', { class: 'atlas-anchor-symbol' }, anchor.symbol),
    );
    button.addEventListener('click', () => handlers.onOpenAnchor(anchor));
    return h('li', {}, button);
  });
  return h('section', { class: 'atlas-section' }, h('h3', {}, 'Code'), h('ul', { class: 'atlas-anchors' }, ...items));
}

function nodeList(heading: string, nodes: AtlasNode[], handlers: PanelHandlers): HTMLElement {
  const items = nodes.map((node) => {
    const button = h(
      'button',
      { type: 'button', class: 'atlas-child' },
      h('span', { class: `atlas-dot is-${node.kind}`, 'aria-hidden': 'true' }),
      h('span', { class: 'atlas-child-title' }, node.title),
      node.summary && summary('atlas-child-summary', node.summary),
    );
    button.addEventListener('click', () => handlers.onFocus(node.id));
    return h('li', {}, button);
  });
  return h('section', { class: 'atlas-section' }, h('h3', {}, heading), h('ol', { class: 'atlas-children' }, ...items));
}

export function createPanel(index: AtlasIndex, handlers: PanelHandlers): Panel {
  const element = h('aside', { class: 'atlas-panel', 'aria-live': 'polite', 'aria-label': 'Explanation' });

  return {
    element,
    showNode(node) {
      clear(element);
      const anchors = node.anchors ?? [];
      const children = childrenOf(index, node.id);
      element.append(
        tags(node),
        h('h2', {}, node.title),
        ...(node.summary ? [h('p', { class: 'atlas-lead' }, summary('', node.summary))] : []),
        ...(node.stale
          ? [
              h(
                'p',
                { class: 'atlas-callout', role: 'note' },
                `The code changed after this was written${node.staleReason ? `: ${node.staleReason}` : ''}. Ask Claude to refresh the map.`,
              ),
            ]
          : []),
      );
      if (node.explanation) {
        const prose = h('div', { class: 'atlas-prose' });
        prose.appendChild(renderMarkdown(document, node.explanation));
        element.appendChild(prose);
      }
      if (anchors.length > 0) element.appendChild(anchorList(anchors, handlers));
      if (children.length > 0) element.appendChild(nodeList('In this flow', children, handlers));
    },
    showOverview() {
      clear(element);
      const { map } = index;
      const stale = staleNodes(index);
      element.append(
        h('p', { class: 'atlas-tags' }, h('span', { class: 'atlas-tag is-flag' }, 'overview')),
        h('h2', {}, map.title),
      );
      if (map.summary) {
        const prose = h('div', { class: 'atlas-prose' });
        prose.appendChild(renderMarkdown(document, map.summary));
        element.appendChild(prose);
      }
      element.appendChild(
        h('p', { class: 'atlas-hint' }, 'Select a box to read about it. Boxes with parts inside open their own flow.'),
      );
      if (stale.length > 0) element.appendChild(nodeList('Out of date', stale, handlers));
      element.appendChild(nodeList('Top level', childrenOf(index, null), handlers));
    },
  };
}
