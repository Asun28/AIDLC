/**
 * Front matter parsing compatible with the scaffold's card parser:
 * `(?s)\A﻿?---\r?\n(.*?)\r?\n---`, scalars via `^key[ \t]*:[ \t]*(.*?)`, trailing
 * comments stripped as the yaml lexer reads them, block lists only (`- item`), and a strict YAML fallback.
 */
import YAML, { CST, Lexer } from 'yaml';

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
 * A token the yaml package's lexer reads, with its offset in the lexed text: typed by `CST.tokenType`, except a plain scalar
 * or a block-scalar body, which the lexer marks and which is typed `scalar`.
 */
interface Token {
  type: CST.TokenType | null;
  source: string;
  at: number;
}

/**
 * The tokens the yaml package's lexer reads in `text`, each with its offset, leaving out the control tokens that carry no
 * source text (card T0-FM-COMMENT-CUT-2). The yaml Lexer decides comment versus text, for both the readers and the report: a
 * hash sign after a space or a tab starts a comment, except inside a quoted scalar or a block-scalar body, and a hash directly
 * after any other character, a non-breaking space included, is text.
 */
function lex(text: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  let scalar = false;
  for (const source of new Lexer().lex(text)) {
    if (source === CST.SCALAR) {
      scalar = true;
      continue;
    }
    if (source === CST.DOCUMENT || source === CST.FLOW_END) continue;
    tokens.push({ type: scalar ? 'scalar' : CST.tokenType(source), source, at });
    scalar = false;
    at += source.length;
  }
  return tokens;
}

/** The tokens of a one-line value read as a mapping value, with offsets counted from the start of the value. */
function lexValue(value: string): Token[] {
  const key = 'k: ';
  return lex(key + value).map((t) => ({ ...t, at: t.at - key.length }));
}

/** Where the yaml lexer starts a comment in a one-line value, or -1; a comment at the very start of the value is text, as before. */
export function commentStart(value: string): number {
  const comment = lexValue(value).find((t) => t.type === 'comment');
  return comment && comment.at > 0 ? comment.at : -1;
}

/**
 * The trimmed items of a one-line flow list `[a, "b, c"]`, split at the commas the yaml lexer reads at its top level, so a
 * quoted item, a plain item holding a colon and a nested flow collection stay whole; undefined when the value is not one.
 */
export function flowItems(value: string): string[] | undefined {
  if (!/^\[.*\]$/.test(value)) return undefined;
  const items: string[] = [];
  let depth = 0;
  let from = 1;
  for (const t of lexValue(value)) {
    if (t.type === 'flow-seq-start' || t.type === 'flow-map-start') depth += 1;
    else if (t.type === 'flow-seq-end' || t.type === 'flow-map-end') depth -= 1;
    else if (t.type === 'comma' && depth === 1) {
      items.push(value.slice(from, t.at).trim());
      from = t.at + 1;
    }
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
 * Every reference-like comment in the front matter (card T0-FM-COMMENT-CUT-2): a comment that begins with a hash directly
 * followed by a non-blank character, which is how an issue or a PR number reads, after value text on a key line or a
 * list-item line, since the reader shortens that value by it. The comment of a line is the one the lexer reads in the line's
 * value, the reading `stripComment` gives the reader. A list-item line is a line the readers read as an item (a dash and a
 * blank, as `blockList` reads it); a key line holds a plain key the readers read (with or without a space after its colon,
 * as `scalar` and the nested-key reader read it, also where the lexer reads the line as part of a plain scalar begun on an
 * earlier line) or a key the lexer reads (plain or quoted, followed by the `:` indicator). The lines of a block-scalar body,
 * the scalar the lexer reads after a header, are text. A comment of a hash, a space and text is an annotation and is not
 * listed.
 */
export function referenceCuts(frontMatter: string): ReferenceCut[] {
  const tokens = lex(frontMatter);
  const bodies: Token[] = [];
  let header = false;
  for (const t of tokens) {
    if (t.type === 'block-scalar-header') header = true;
    else if (t.type === 'scalar') {
      if (header) bodies.push(t);
      header = false;
    }
  }
  const cuts: ReferenceCut[] = [];
  let parent = '';
  let item = 0;
  let lineStart = 0;
  for (const line of frontMatter.split('\n')) {
    const start = lineStart;
    const end = start + line.length;
    lineStart = end + 1;
    if (bodies.some((t) => start >= t.at && start < t.at + t.source.length)) continue;
    const dash = line.match(/^\s*-\s+/);
    let key: string;
    let valueStart: number;
    if (dash) {
      item += 1;
      key = `${parent} item ${item}`;
      valueStart = dash[0].length;
    } else {
      const readerKey = line.match(/^(\s*)([A-Za-z_][\w-]*)[ \t]*:[ \t]*/);
      // An empty block-scalar body is a token of no length at the next line's start: it holds no key.
      const [first, second, third] = tokens.filter((t) => t.at >= start && t.at < end && t.type !== 'space' && t.source !== '');
      let top: boolean;
      if (readerKey) {
        key = readerKey[2]!;
        valueStart = readerKey[0].length;
        top = !readerKey[1];
      } else if (first && second?.type === 'map-value-ind') {
        key = first.source;
        valueStart = (third?.at ?? end) - start;
        top = first.at === start;
      } else continue;
      if (top) {
        parent = key;
        item = 0;
      } else key = `${parent}.${key}`;
    }
    const raw = line.slice(valueStart).replace(/[ \t\r]+$/, '');
    const at = commentStart(raw);
    if (at >= 0 && /^#\S/.test(raw.slice(at))) cuts.push({ key, raw, kept: raw.slice(0, at).trim(), comment: raw.slice(at) });
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
