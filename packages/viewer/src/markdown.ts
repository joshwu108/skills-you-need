/**
 * A small Markdown subset for node explanations: headings, paragraphs,
 * fenced code, bullet and numbered lists, inline code, bold, italic, links.
 *
 * Explanations are model-written from repository content, so they are
 * untrusted. Parsing produces a plain tree and rendering builds DOM nodes
 * with `textContent`; no HTML string is ever assigned. Links are kept only
 * for http(s) targets.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] };

export type Block =
  | { type: 'heading'; level: number; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'list'; ordered: boolean; items: Inline[][] };

const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
// The link label and target are length-bounded so a long run of unclosed
// brackets cannot make matching quadratic.
const INLINE = /(`[^`]+`)|(\*\*[^*]+?\*\*)|(\*[^*\s][^*]*?\*)|(\[[^\]]{1,300}\]\([^)\s]{1,2000}\))/;
const SAFE_LINK = /^https?:\/\//i;

export function parseInline(text: string): Inline[] {
  const result: Inline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (!match) {
      result.push({ type: 'text', text: rest });
      break;
    }
    if (match.index > 0) result.push({ type: 'text', text: rest.slice(0, match.index) });
    const token = match[0];
    if (match[1]) {
      result.push({ type: 'code', text: token.slice(1, -1) });
    } else if (match[2]) {
      result.push({ type: 'strong', children: parseInline(token.slice(2, -2)) });
    } else if (match[3]) {
      result.push({ type: 'em', children: parseInline(token.slice(1, -1)) });
    } else {
      const split = token.lastIndexOf('](');
      const label = parseInline(token.slice(1, split));
      const href = token.slice(split + 2, -1);
      // An unsafe target keeps its label and loses its link.
      if (SAFE_LINK.test(href)) result.push({ type: 'link', href, children: label });
      else result.push(...label);
    }
    rest = rest.slice(match.index + token.length);
  }
  return result;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1; // closing fence, or end of input
      blocks.push({ type: 'code', lang: fence[1] ?? '', text: body.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: (heading[1] ?? '#').length, inlines: parseInline(heading[2] ?? '') });
      index += 1;
      continue;
    }
    const listPattern = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
    if (listPattern) {
      const items: Inline[][] = [];
      let item = listPattern.exec(lines[index] ?? '');
      while (item) {
        items.push(parseInline(item[1] ?? ''));
        index += 1;
        item = listPattern.exec(lines[index] ?? '');
      }
      blocks.push({ type: 'list', ordered: listPattern === NUMBERED, items });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && isParagraphLine(lines[index] ?? '')) {
      paragraph.push((lines[index] ?? '').trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', inlines: parseInline(paragraph.join(' ')) });
  }
  return blocks;
}

function isParagraphLine(line: string): boolean {
  return line.trim() !== '' && !FENCE.test(line) && !HEADING.test(line) && !BULLET.test(line) && !NUMBERED.test(line);
}

function renderInline(doc: Document, inlines: Inline[], into: Node): void {
  for (const inline of inlines) {
    if (inline.type === 'text') {
      into.appendChild(doc.createTextNode(inline.text));
    } else if (inline.type === 'code') {
      const code = doc.createElement('code');
      code.textContent = inline.text;
      into.appendChild(code);
    } else if (inline.type === 'link') {
      const link = doc.createElement('a');
      link.href = inline.href;
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      renderInline(doc, inline.children, link);
      into.appendChild(link);
    } else {
      const element = doc.createElement(inline.type);
      renderInline(doc, inline.children, element);
      into.appendChild(element);
    }
  }
}

/** Render one line of inline Markdown (code, bold, italic, links) into `into`. */
export function renderInlineMarkdown(doc: Document, source: string, into: Node): void {
  renderInline(doc, parseInline(source), into);
}

/** Headings start at h3 so they nest under the panel's own title. */
const HEADING_OFFSET = 2;
const MAX_HEADING_LEVEL = 6;

export function renderMarkdown(doc: Document, source: string): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  for (const block of parseMarkdown(source)) {
    if (block.type === 'code') {
      const pre = doc.createElement('pre');
      const code = doc.createElement('code');
      code.textContent = block.text;
      pre.appendChild(code);
      fragment.appendChild(pre);
    } else if (block.type === 'list') {
      const list = doc.createElement(block.ordered ? 'ol' : 'ul');
      for (const item of block.items) {
        const li = doc.createElement('li');
        renderInline(doc, item, li);
        list.appendChild(li);
      }
      fragment.appendChild(list);
    } else {
      const tag =
        block.type === 'heading' ? `h${Math.min(block.level + HEADING_OFFSET, MAX_HEADING_LEVEL)}` : 'p';
      const element = doc.createElement(tag);
      renderInline(doc, block.inlines, element);
      fragment.appendChild(element);
    }
  }
  return fragment;
}
