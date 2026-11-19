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

/**
 * True inside an editor's built-in browser (VS Code and its forks are
 * Electron applications). A page there cannot hand an editor link to the
 * operating system; the link is loaded as a web address and fails.
 */
export function isEmbeddedBrowser(userAgent: string): boolean {
  return /\bElectron\//.test(userAgent);
}

/** True for a path that stays inside the repository: relative, forward slashes, no `..`. */
export function isSafeRelativePath(file: unknown): file is string {
  if (typeof file !== 'string' || file === '' || file.includes('\\') || file.startsWith('/')) return false;
  const parts = file.split('/');
  return !(parts[0] ?? '').includes(':') && !parts.includes('..');
}

/**
 * `scheme://file/<absolute path>:<line>`, the form VS Code and its forks
 * register. Returns null for an anchor whose path would leave the repository,
 * so a crafted map cannot make a link open some other file.
 */
export function editorUrl(scheme: string, root: string, anchor: Anchor): string | null {
  if (!isSafeRelativePath(anchor.file)) return null;
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const absolute = `${base}/${anchor.file}`;
  const path = absolute.startsWith('/') ? absolute : `/${absolute}`;
  const encoded = path.split('/').map(encodeURIComponent).join('/').replace(/%3A/g, ':');
  const line = Number.isInteger(anchor.startLine) && (anchor.startLine as number) >= 1 ? anchor.startLine : 1;
  return `${scheme}://file${encoded}:${line}`;
}

export function anchorLabel(anchor: Anchor): string {
  if (anchor.startLine === undefined) return anchor.file;
  const range =
    anchor.endLine !== undefined && anchor.endLine !== anchor.startLine
      ? `${anchor.startLine}–${anchor.endLine}`
      : `${anchor.startLine}`;
  return `${anchor.file}:${range}`;
}
