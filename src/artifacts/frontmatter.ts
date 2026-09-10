/**
 * Front matter parsing compatible with the scaffold's card parser:
 * `(?s)\A﻿?---\r?\n(.*?)\r?\n---`, scalars via `^key[ \t]*:[ \t]*(.*?)`, trailing
 * `\s+#.*$` comments stripped, block lists only (`- item`), and a strict YAML fallback.
 */
import YAML from 'yaml';

export interface FrontMatterDoc {
  raw: string;
  frontMatter: string;
  body: string;
  /** Strict YAML parse of the front matter (undefined when it fails). */
  yaml?: Record<string, unknown>;
  yamlError?: string;
}

const FM_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontMatter(text: string): FrontMatterDoc | undefined {
  const m = text.match(FM_RE);
  if (!m) return undefined;
  const frontMatter = m[1] ?? '';
  const body = text.slice(m[0].length);
  let yaml: Record<string, unknown> | undefined;
  let yamlError: string | undefined;
  try {
    const parsed = YAML.parse(frontMatter);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) yaml = parsed as Record<string, unknown>;
    else if (parsed !== null && parsed !== undefined) yamlError = 'front matter is not a mapping';
  } catch (err) {
    yamlError = (err as Error).message;
  }
  return { raw: text, frontMatter, body, yaml, yamlError };
}

export function stripComment(value: string): string {
  return value.replace(/\s+#.*$/, '').trim();
}

/** Scalar lookup the scaffold way: first line `key: value`, comments stripped. */
export function scalar(frontMatter: string, key: string): string | undefined {
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*:[ \\t]*(.*?)[ \\t\\r]*$`, 'm');
  const m = frontMatter.match(re);
  if (!m) return undefined;
  return stripComment(m[1] ?? '');
}

/** Block-list items under `key:` (indented `- item` lines until a non-indented line). */
export function blockList(frontMatter: string, key: string): string[] | undefined {
  const lines = frontMatter.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^${key}[ \\t]*:`).test(l));
  if (start < 0) return undefined;
  const items: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^\s*#/.test(line)) continue;
    if (!/^\s+/.test(line)) break;
    const m = line.match(/^\s*-\s+(.*)$/);
    if (m) items.push(stripComment(m[1] ?? ''));
  }
  return items;
}

export function hasKey(frontMatter: string, key: string): boolean {
  return new RegExp(`^${key}[ \\t]*:`, 'm').test(frontMatter);
}

/** Serialize a front-matter document deterministically. */
export function renderFrontMatter(data: Record<string, unknown>, body: string): string {
  const yaml = YAML.stringify(data, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n${body.startsWith('\n') ? body : '\n' + body}`;
}
