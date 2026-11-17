// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';

import { parseInline, parseMarkdown, renderMarkdown } from '../src/markdown';

const html = (source: string): string => {
  const holder = document.createElement('div');
  holder.appendChild(renderMarkdown(document, source));
  return holder.innerHTML;
};

describe('parseInline', () => {
  test('splits code, bold, italic and plain text', () => {
    expect(parseInline('Call `step()` **once** per *tick*.')).toEqual([
      { type: 'text', text: 'Call ' },
      { type: 'code', text: 'step()' },
      { type: 'text', text: ' ' },
      { type: 'strong', children: [{ type: 'text', text: 'once' }] },
      { type: 'text', text: ' per ' },
      { type: 'em', children: [{ type: 'text', text: 'tick' }] },
      { type: 'text', text: '.' },
    ]);
  });

  test('keeps http links and drops the target of anything else', () => {
    expect(parseInline('[docs](https://example.com/a)')).toEqual([
      { type: 'link', href: 'https://example.com/a', children: [{ type: 'text', text: 'docs' }] },
    ]);
    expect(parseInline('[x](javascript:alert(1))')[0]).toEqual({ type: 'text', text: 'x' });
    expect(parseInline('[x](vscode://file/etc/passwd)')).toEqual([{ type: 'text', text: 'x' }]);
  });

  test('leaves arithmetic asterisks alone', () => {
    expect(parseInline('a * b * c')).toEqual([{ type: 'text', text: 'a * b * c' }]);
  });
});

describe('parseMarkdown', () => {
  test('recognises each block type', () => {
    const blocks = parseMarkdown('# Title\n\nFirst line\nsecond line.\n\n- one\n- two\n\n1. a\n2. b\n\n```py\nx = 1\n\ny = 2\n```\n');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'code']);
    expect(blocks[1]).toEqual({ type: 'paragraph', inlines: [{ type: 'text', text: 'First line second line.' }] });
    expect(blocks[2]).toMatchObject({ ordered: false });
    expect(blocks[3]).toMatchObject({ ordered: true });
    expect(blocks[4]).toEqual({ type: 'code', lang: 'py', text: 'x = 1\n\ny = 2' });
  });

  test('an unclosed fence takes the rest of the text', () => {
    expect(parseMarkdown('```\nabc')).toEqual([{ type: 'code', lang: '', text: 'abc' }]);
  });

  test('empty input gives no blocks', () => {
    expect(parseMarkdown('  \n\n')).toEqual([]);
  });
});

describe('renderMarkdown', () => {
  test('renders structure', () => {
    expect(html('## Why\n\nUse `x`.\n\n- a\n- **b**')).toBe(
      '<h4>Why</h4><p>Use <code>x</code>.</p><ul><li>a</li><li><strong>b</strong></li></ul>',
    );
  });

  test('never turns source text into markup', () => {
    const output = html('<img src=x onerror=alert(1)> and `<script>` and\n\n```\n</pre><script>alert(1)</script>\n```');
    expect(output).not.toContain('<img');
    expect(output).not.toContain('<script>');
    expect(output).toContain('&lt;img');
  });

  test('links open in a new tab without a referrer', () => {
    expect(html('[d](https://example.com)')).toBe(
      '<p><a href="https://example.com" rel="noopener noreferrer" target="_blank">d</a></p>',
    );
  });
});
