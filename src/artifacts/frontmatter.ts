/**
 * Front matter parsing compatible with the scaffold's card parser:
 * `(?s)\A﻿?---\r?\n(.*?)\r?\n---`, scalars via `^key[ \t]*:[ \t]*(.*?)`, trailing
 * comments stripped as YAML reads them (never inside a quoted scalar), block lists only (`- item`), and a strict YAML fallback.
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

/**
 * Where a YAML comment starts in a one-line value, or -1 (card T0-FM-COMMENT-CUT): the first hash sign after whitespace that
 * is outside a quoted scalar. A quoted scalar opens only where a scalar starts (the value start, or after `[`, `{`, `,` or
 * `:` inside a flow collection) and closes at its unescaped closing quote (a backslash escapes in a double-quoted scalar, a
 * doubled quote in a single-quoted one). A hash directly after a non-blank character, or at the value start, is text. A
 * value is a flow collection when it starts with `[` or `{`; in valid YAML only a comment follows its closing bracket.
 */
export function commentStart(value: string): number {
  let quote: '"' | "'" | undefined;
  let flow = false;
  let scalarStart = true;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!;
    if (quote === '"') {
      if (ch === '\\') i += 1;
      else if (ch === '"') quote = undefined;
      continue;
    }
    if (quote === "'") {
      if (ch === "'" && value[i + 1] === "'") i += 1;
      else if (ch === "'") quote = undefined;
      continue;
    }
    if (/\s/.test(ch)) continue;
    if (ch === '#' && i > 0 && /\s/.test(value[i - 1]!)) return i;
    if (scalarStart && (ch === '"' || ch === "'")) {
      quote = ch;
      scalarStart = false;
    } else if (scalarStart && (ch === '[' || ch === '{')) {
      flow = true;
    } else if (flow && (ch === ',' || ch === ':')) {
      scalarStart = true;
    } else {
      scalarStart = false;
    }
  }
  return -1;
}

export function flowItems(_value: string): string[] | undefined {
  return undefined;
}

export function stripComment(value: string): string {
  const at = commentStart(value);
  return (at < 0 ? value : value.slice(0, at)).trim();
}

/** A front-matter value a comment cuts at a hash directly followed by text: where it is, its raw text, the kept text and the comment. */
export interface ReferenceCut {
  key: string;
  raw: string;
  kept: string;
  comment: string;
}

/**
 * Every value line of the front matter (a key, a nested key or a list item) that a comment cuts where the comment begins
 * with a hash directly followed by a non-blank character, which is how an issue or a PR number reads (card
 * T0-FM-COMMENT-CUT). A comment of a hash, a space and text is an annotation and is not listed.
 */
export function referenceCuts(frontMatter: string): ReferenceCut[] {
  const cuts: ReferenceCut[] = [];
  let parent = '';
  let item = 0;
  for (const line of frontMatter.split(/\r?\n/)) {
    const kv = line.match(/^(\s*)([A-Za-z_][\w-]*)[ \t]*:(?:[ \t]+(.*?))?[ \t\r]*$/);
    const listItem = kv ? undefined : line.match(/^\s*-\s+(.*?)[ \t\r]*$/);
    let key: string;
    let raw: string;
    if (kv) {
      if (!kv[1]) {
        parent = kv[2]!;
        item = 0;
        key = parent;
      } else key = `${parent}.${kv[2]}`;
      raw = kv[3] ?? '';
    } else if (listItem) {
      item += 1;
      key = `${parent} item ${item}`;
      raw = listItem[1] ?? '';
    } else continue;
    const at = commentStart(raw);
    if (at < 0 || !/^#\S/.test(raw.slice(at))) continue;
    cuts.push({ key, raw, kept: raw.slice(0, at).trim(), comment: raw.slice(at) });
  }
  return cuts;
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
