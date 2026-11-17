/** Editor deep links for the standalone page, and anchor labels. */

import type { Anchor } from './types';

export const EDITORS = [
  { scheme: 'vscode', label: 'VS Code' },
  { scheme: 'vscode-insiders', label: 'VS Code Insiders' },
  { scheme: 'cursor', label: 'Cursor' },
  { scheme: 'windsurf', label: 'Windsurf' },
] as const;

export const DEFAULT_EDITOR = EDITORS[0].scheme;

export function isEditorScheme(value: unknown): value is (typeof EDITORS)[number]['scheme'] {
  return EDITORS.some((editor) => editor.scheme === value);
}

/** `scheme://file/<absolute path>:<line>`, the form VS Code and its forks register. */
export function editorUrl(scheme: string, root: string, anchor: Anchor): string {
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const absolute = `${base}/${anchor.file}`;
  const path = absolute.startsWith('/') ? absolute : `/${absolute}`;
  const encoded = path.split('/').map(encodeURIComponent).join('/').replace(/%3A/g, ':');
  return `${scheme}://file${encoded}:${anchor.startLine ?? 1}`;
}

export function anchorLabel(anchor: Anchor): string {
  if (anchor.startLine === undefined) return anchor.file;
  const range =
    anchor.endLine !== undefined && anchor.endLine !== anchor.startLine
      ? `${anchor.startLine}–${anchor.endLine}`
      : `${anchor.startLine}`;
  return `${anchor.file}:${range}`;
}
