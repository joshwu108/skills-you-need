/** Element builders. Text always goes in as text nodes, never as markup. */

type Child = Node | string | null | undefined | false;
type Attributes = Record<string, string | undefined>;

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function fill(element: Element, attributes: Attributes, children: Child[]): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined) element.setAttribute(name, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  fill(element, attributes, children);
  return element;
}

export function s(tag: string, attributes: Attributes = {}, ...children: Child[]): SVGElement {
  const element = document.createElementNS(SVG_NAMESPACE, tag);
  fill(element, attributes, children);
  return element;
}

export function clear(element: Element): void {
  element.replaceChildren();
}
