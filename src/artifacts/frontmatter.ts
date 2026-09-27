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

/** A space or a tab: the only blanks YAML reads as separation. */
function blank(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t';
}

/**
 * A one-line value as YAML reads it (card T0-FM-COMMENT-CUT): where its comment starts (-1 when none) and the offsets of the
 * commas that separate the items of a flow collection. A comment starts at the first hash sign after a space or a tab that is
 * outside a quoted scalar; any other blank, a non-breaking space included, is text, as in YAML. A quoted scalar opens only
 * where a scalar starts (the value start, or after `[`, `{`, `,` or `:` inside a flow collection) and closes at its unescaped
 * closing quote (a backslash escapes in a double-quoted scalar, a doubled quote in a single-quoted one). A hash directly after
 * any other character, or at the value start, is text. A value is a flow collection when it starts with `[` or `{`; in valid
 * YAML only a comment follows its closing bracket.
 */
function scanValue(value: string): { comment: number; commas: number[] } {
  let quote: '"' | "'" | undefined;
  let flow = false;
  let scalarStart = true;
  const commas: number[] = [];
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
    if (blank(ch)) continue;
    if (ch === '#' && blank(value[i - 1])) return { comment: i, commas };
    if (scalarStart && (ch === '"' || ch === "'")) {
      quote = ch;
      scalarStart = false;
    } else if (scalarStart && (ch === '[' || ch === '{')) {
      flow = true;
    } else if (flow && (ch === ',' || ch === ':')) {
      scalarStart = true;
      if (ch === ',') commas.push(i);
    } else {
      scalarStart = false;
    }
  }
  return { comment: -1, commas };
}

/** Where a YAML comment starts in a one-line value, or -1 (see `scanValue`). */
export function commentStart(value: string): number {
  return scanValue(value).comment;
}

/** The trimmed items of a one-line flow list `[a, "b, c"]`, split only at a comma outside a quoted item, or undefined when the value is not one. */
export function flowItems(value: string): string[] | undefined {
  if (!/^\[.*\]$/.test(value)) return undefined;
  const items: string[] = [];
  let from = 1;
  for (const at of scanValue(value).commas) {
    items.push(value.slice(from, at).trim());
    from = at + 1;
  }
  items.push(value.slice(from, -1).trim());
  return items;
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
 * A block scalar header: `|` or `>`, with an optional indentation and chomping indicator in either order, alone or after the
 * key of a mapping written in a list item (`- note: |`), which the group captures.
 */
const BLOCK_HEADER = /^(?:([^#]*?):[ \t]+)?[|>](?:[1-9][+-]?|[+-][1-9]?)?$/;

/**
 * Every value line of the front matter (a key, a nested key or a list item) that a comment cuts where the comment begins
 * with a hash directly followed by a non-blank character, which is how an issue or a PR number reads (card
 * T0-FM-COMMENT-CUT). A key is read with or without a space after its colon, as `scalar` and the nested-key reader read it. A
 * comment of a hash, a space and text is an annotation and is not listed, and the body of a block scalar (the blank lines and
 * the lines indented deeper than the key or the list item holding its header) is text, as YAML reads it.
 */
export function referenceCuts(frontMatter: string): ReferenceCut[] {
  const cuts: ReferenceCut[] = [];
  let parent = '';
  let item = 0;
  let blockIndent: number | undefined;
  for (const line of frontMatter.split(/\r?\n/)) {
    const indent = line.match(/^\s*/)![0].length;
    if (blockIndent !== undefined) {
      if (indent === line.length || indent > blockIndent) continue;
      blockIndent = undefined;
    }
    const kv = line.match(/^(\s*)([A-Za-z_][\w-]*)[ \t]*:[ \t]*(.*?)[ \t\r]*$/);
    const listItem = kv ? undefined : line.match(/^(\s*)-(\s+)(.*?)[ \t\r]*$/);
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
      raw = listItem[3] ?? '';
    } else continue;
    const at = commentStart(raw);
    const kept = (at < 0 ? raw : raw.slice(0, at)).trim();
    const header = kept.match(BLOCK_HEADER);
    if (header) blockIndent = listItem && header[1] !== undefined ? listItem[1]!.length + 1 + listItem[2]!.length : indent;
    else if (at >= 0 && /^#\S/.test(raw.slice(at))) cuts.push({ key, raw, kept, comment: raw.slice(at) });
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
