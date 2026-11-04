/**
 * Mutant generator (card T1-VERIFY-MUTANT-GEN, spec review-verification R17).
 *
 * Pure: it parses the diff text and the source text it is given and never reads a file or runs a
 * process; the runner card does the I/O. An in-house scanner reads the whole file once and marks
 * which characters are code, so no operator is ever counted inside a comment, a string, a template
 * literal (with its `${}` parts) or a regex literal. `typescript` is a devDependency and is not
 * available where `src` runs, so the scanner adds no dependency.
 */
import { MUTATION_OPERATORS, type MutationOperator } from '../core/types.ts';

export interface Mutant {
  /** 1-based line of the span. */
  line: number;
  /** 1-based column of the span's first character, in UTF-16 code units. */
  column: number;
  operator: MutationOperator;
  original: string;
  mutated: string;
  /** Source offsets of the span, end exclusive. */
  start: number;
  end: number;
}

export interface ChangedSourceFile {
  /** Path from the `+++ b/` header. */
  file: string;
  /** 1-based new-side line numbers of the `+` lines, ascending. */
  lines: number[];
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
/** The one line git prints after a body line whose side lacks a final newline; xdiff does not translate it. */
const NO_NEWLINE = '\\ No newline at end of file';
const isSource = (file: string) => file.startsWith('src/') && !file.includes('\t') && file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts');

/** `[oldCount, newStart, newCount]` of a hunk header, or null when a number is not a safe integer, a non-empty side starts below line 1 or both sides are empty. */
function hunkCounts(line: string): [number, number, number] | null {
  const m = HUNK.exec(line);
  if (!m) return null;
  const [oldStart, oldCount, newStart, newCount] = [m[1], m[2] ?? '1', m[3], m[4] ?? '1'].map(Number) as [number, number, number, number];
  const safe = [oldStart, oldCount, newStart, newCount, newStart + newCount].every(Number.isSafeInteger);
  return safe && oldCount + newCount > 0 && (oldCount === 0 || oldStart >= 1) && (newCount === 0 || newStart >= 1) ? [oldCount, newStart, newCount] : null;
}

/**
 * The added new-side lines of every `src/**\/*.ts` file (not `.d.ts`, not `.test.ts`) in a `git diff --unified=0`
 * text; the tab git writes after a path holding whitespace is no part of the path. Fails closed: a deleted file, a path git quoted, text outside a `diff --git` section and a file with a hunk
 * header it cannot read (a coordinate that is not a safe integer, a non-empty side starting below line 1, two empty
 * sides), a hunk whose `+` and `-` lines do not match its counts, or any other body line (an excess line, a context
 * line, a blank line, a `\` line other than the exact no-newline marker right after a body line) get no entry: such a
 * line invalidates the file for good, whatever hunks follow, so an empty or unreadable diff yields no lines at all.
 */
export function changedSourceLines(diff: string): ChangedSourceFile[] {
  const out: ChangedSourceFile[] = [];
  let current: ChangedSourceFile | null = null;
  let valid = false;
  let section = false;
  let inHunks = false;
  let oldLeft = 0;
  let newLeft = 0;
  let next = 0;
  let afterBody = false;
  const close = () => {
    if (current && valid && oldLeft === 0 && newLeft === 0 && current.lines.length > 0) out.push({ file: current.file, lines: [...new Set(current.lines)].sort((a, b) => a - b) });
    [current, inHunks, oldLeft, newLeft] = [null, false, 0, 0];
  };
  const rows = diff.split('\n');
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]!;
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const c = line[0];
    const marker = afterBody && line === NO_NEWLINE;
    afterBody = false;
    // An excess line drives its count below zero, which no later line raises: the next hunk header and close() refuse the file.
    if (line.startsWith('diff --git ')) {
      close();
      section = true;
    } else if (!section) continue;
    else if (line.startsWith('@@')) {
      inHunks = true;
      const counts = hunkCounts(line);
      if (counts && oldLeft === 0 && newLeft === 0) [oldLeft, next, newLeft] = counts;
      else valid = false;
    } else if (!inHunks) {
      const name = line.startsWith('+++ ') ? line.slice(4) : '';
      if (name.startsWith('b/')) {
        current = { file: name.slice(2).replace(/\t$/, ''), lines: [] };
        valid = isSource(current.file);
      }
    } else if (c === '+') {
      current?.lines.push(next++);
      newLeft--;
      afterBody = true;
    } else if (c === '-') {
      oldLeft--;
      afterBody = true;
    } else if (!marker && !(line === '' && i === rows.length - 1)) valid = false;
  }
  close();
  return out;
}

const CODE = 1;
const COMMENT = 2;
/** One UTF-16 code unit of an identifier: surrogates stand for the astral letters a code unit cannot show. */
const IDENT = /[\p{ID_Continue}$\ud800-\udfff]/u;
/** The language's whitespace and line terminators, with the U+0085 and U+200B the TypeScript scanner also skips. */
const SPACE = /[\s\u0085\u200b]/;
const isSpace = (ch: string | undefined) => ch !== undefined && SPACE.test(ch);
const LINE_BREAK = /[\n\r\u2028\u2029]/;
const UNICODE_ESCAPE = /\\u(?:([0-9a-fA-F]{4})|\{([0-9a-fA-F]+)\})/y;

/** End offset of the Unicode escape at `i` when it writes an identifier character, else -1. */
function escapeEnd(src: string, i: number): number {
  UNICODE_ESCAPE.lastIndex = i;
  const m = UNICODE_ESCAPE.exec(src);
  if (!m) return -1;
  const code = parseInt(m[1] ?? m[2]!, 16);
  return code <= 0x10ffff && IDENT.test(String.fromCodePoint(code)) ? UNICODE_ESCAPE.lastIndex : -1;
}

/** End offset of the word at `i`, its Unicode escapes included; `i` itself when no word starts there. */
function wordEnd(src: string, i: number): number {
  let j = i;
  for (;;) {
    if (j < src.length && IDENT.test(src[j]!)) j++;
    else {
      const end = escapeEnd(src, j);
      if (end < 0) return j;
      j = end;
    }
  }
}
const REGEX_AFTER = new Set('(,=:[!&|?{};+-*%<>~^');
/** Words after which an expression starts: a `/` opens a regex literal there and a `!` is unary. */
const OPERAND_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

/** End offset of the string literal opening at `i`; an unterminated string ends at the line end. */
function stringEnd(src: string, i: number): number {
  const quote = src[i];
  for (let j = i + 1; j < src.length; j++) {
    const ch = src[j];
    if (ch === '\\') j += src[j + 1] === '\r' && src[j + 2] === '\n' ? 2 : 1;
    else if (ch === quote) return j + 1;
    else if (ch === '\n' || ch === '\r') return j;
  }
  return src.length;
}

/** End offset of the regex literal opening at `i` (its flags read as an identifier); an unterminated one ends at the line end. */
function regexEnd(src: string, i: number): number {
  let inClass = false;
  for (let j = i + 1; j < src.length; j++) {
    const ch = src[j]!;
    if (ch === '\\') j++;
    else if (LINE_BREAK.test(ch)) return j;
    else if (inClass) inClass = ch !== ']';
    else if (ch === '[') inClass = true;
    else if (ch === '/') return j + 1;
  }
  return src.length;
}

/**
 * `mask`, per character: CODE at the top level of the file, COMMENT, or 0 (literals and `${}` parts). `opens`: the
 * offsets where a literal opens at the top level, which tell its first line from the rest of a multiline literal.
 */
function scan(src: string): { mask: Uint8Array; opens: Set<number> } {
  const mask = new Uint8Array(src.length);
  const opens = new Set<number>();
  const exprs: number[] = [];
  let braces = 0;
  let template = false;
  let last = '';
  let word = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (template) {
      if (c === '\\') i += 2;
      else if (c === '`') [template, last, word, i] = [false, '`', '', i + 1];
      else if (c === '$' && src[i + 1] === '{') {
        exprs.push(braces++);
        [template, last, word, i] = [false, '{', '', i + 2];
      } else i++;
      continue;
    }
    const d = src[i + 1];
    let end = i + 1;
    if (c === '/' && d === '/') {
      while (end < src.length && !LINE_BREAK.test(src[end]!)) end++;
      mask.fill(COMMENT, i, end);
    } else if (c === '/' && d === '*') {
      end = src.indexOf('*/', i + 2) < 0 ? src.length : src.indexOf('*/', i + 2) + 2;
      mask.fill(COMMENT, i, end);
    } else if (c === "'" || c === '"' || c === '`' || (c === '/' && (last === '' || REGEX_AFTER.has(last) || OPERAND_WORDS.has(word)))) {
      if (exprs.length === 0) opens.add(i);
      if (c === '`') template = true;
      else [end, last, word] = [c === '/' ? regexEnd(src, i) : stringEnd(src, i), c, ''];
    }
    else if (c === '}' && exprs.length > 0 && braces - 1 === exprs[exprs.length - 1]) {
      exprs.pop();
      [braces, template] = [braces - 1, true];
    }
    else {
      const stop = wordEnd(src, i);
      if (stop > i) {
        end = stop;
        word = last === '.' || last === '#' ? '' : src.slice(i, end);
        last = 'a'; // Any word character: an escape may end in `}`, which would read as punctuation.
      } else if (src.startsWith('...', i)) [end, last, word] = [i + 3, '...', ''];
      else if (!isSpace(c)) [last, word] = [c, ''];
      if (c === '{') braces++;
      else if (c === '}') braces--;
      if (exprs.length === 0) mask.fill(CODE, i, end);
    }
    i = end;
  }
  return { mask, opens };
}

/** The operator tokens read whole; with the whitespace rule this is enough for `=>`, `<<`, `>>`, `>>>`, `<<=`, `>>=`, `??`, `&&=` and `||=` never to match. */
const PUNCTUATORS = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||', '...'];
/** Own entries only (a Map), so an identifier such as `constructor` or `toString` never reads an inherited member. */
const BINARY = new Map<string, [MutationOperator, string]>([
  ['===', ['negate-equality', '!==']],
  ['!==', ['negate-equality', '===']],
  ['==', ['negate-equality', '!=']],
  ['!=', ['negate-equality', '==']],
  ['&&', ['swap-logic', '||']],
  ['||', ['swap-logic', '&&']],
  ['<', ['boundary', '<=']],
  ['<=', ['boundary', '<']],
  ['>', ['boundary', '>=']],
  ['>=', ['boundary', '>']],
]);
const DECLARATIONS = new Set(['const', 'let', 'var', 'return', 'import', 'export', 'type', 'interface', 'declare']);
const BRACKETS = new Map<string, [number, number]>([['(', [0, 1]], [')', [0, -1]], ['[', [1, 1]], [']', [1, -1]], ['{', [2, 1]], ['}', [2, -1]]]);
/** The binary-operator rule: whitespace, or the start or end of the input. */
const spaceOrEdge = (ch: string | undefined) => ch === undefined || isSpace(ch);

/** A token of the whole file; each character of literal text (a string, a template, a regex) is a token with empty `text`. */
interface Token {
  text: string;
  start: number;
  end: number;
}

/**
 * The tokens of the file, operators read greedily, comments and whitespace left out. Each operator token starts on a
 * code character and stays in code: a literal or comment opens with a quote, a backtick or a slash, none of which a
 * word or a listed operator holds.
 */
function tokens(src: string, mask: Uint8Array): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    let end = i + 1;
    if (mask[i] === COMMENT || isSpace(c)) {
      i++;
      continue;
    }
    if (mask[i] !== CODE) {
      out.push({ text: '', start: i, end });
      i = end;
      continue;
    }
    const stop = wordEnd(src, i);
    if (stop > i) end = stop;
    else {
      const p = PUNCTUATORS.find((op) => src.startsWith(op, i));
      if (p) end = i + p.length;
    }
    out.push({ text: src.slice(i, end), start: i, end });
    i = end;
  }
  return out;
}

/** What a `{` opens: members (an object literal or a type literal), class members, or statements. */
type BraceKind = 'object' | 'class' | 'block';

/** The bracket structure of a token list, by token index. */
interface Shape {
  toks: Token[];
  /** Each matched bracket to its partner, both ways. */
  match: Map<number, number>;
  /** The innermost open bracket at each token, -1 at the top level. */
  enclosing: number[];
  braces: Map<number, BraceKind>;
}

const OPENERS = new Map([[')', '('], [']', '['], ['}', '{']]);
/** Words after which a `{` starts an expression or a type, unless the word ends a return type. */
const OBJECT_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await', 'default', 'as', 'satisfies', 'extends']);
/** Words a `!` follows as a unary operator: the operand words and `export default`. */
const UNARY_WORDS = new Set([...OPERAND_WORDS, 'default']);
const CONTROL_WORDS = new Set(['if', 'while', 'for', 'with']);
/** Words that continue an expression, so a `!` before them has no operand. */
const BINARY_WORDS = new Set(['in', 'instanceof', 'as', 'satisfies']);
const OPERAND_PUNCTUATORS = new Set('([{+-~<#');

const isWord = (t: Token) => wordEnd(t.text, 0) > 0;
/** A name after a `.`, `?.` or `#` is a member, never a keyword. */
const isMember = (toks: Token[], n: number) => toks[n - 1]?.text === '.' || toks[n - 1]?.text === '#';

/** Whether the `>` at token `n` ends an arrow. */
const isArrow = (toks: Token[], n: number) => toks[n - 1]?.text === '=';

/**
 * The first token of the statement around token `n`, walking back over matched groups, and whether it declares a
 * class or an interface. A `}` ends the walk as the end of the statement before, unless it sits in `<...>`, where it
 * closes a type group of a heritage clause or a type parameter.
 */
function statementHead(s: Shape, n: number): { first: number; declares: boolean } {
  let first = n;
  let declares = false;
  let angles = 0;
  for (let k = n - 1; k >= 0; k--) {
    const text = s.toks[k]!.text;
    if (text === '>' && !isArrow(s.toks, k)) angles++;
    else if (text === '<' && angles > 0) angles--;
    if (text === ';' || text === '{' || text === '(' || text === '[' || (text === '}' && angles === 0)) break;
    if (text === ')' || text === ']' || text === '}') {
      const open = s.match.get(k);
      if (open === undefined) break;
      k = open;
    }
    first = k;
    if ((text === 'class' || text === 'interface') && !isMember(s.toks, k)) declares = true;
  }
  return { first, declares };
}

/** Whether the `(` at token `open` opens the parameters of a declaration: a name or `function` before it, not a ternary's branch. */
function opensParameters(s: Shape, open: number): boolean {
  const name = s.toks[open - 1];
  if (!name || !(isWord(name) || name.text === '>' || name.text === ']' || name.text === '')) return false;
  return s.toks[open - 2]?.text !== '?';
}

/** Whether the `{` at token `n` follows a return type: walking back over its type, the `:` after a parameter list comes first. */
function followsReturnType(s: Shape, n: number): boolean {
  for (let k = n - 1; k >= 0; k--) {
    const text = s.toks[k]!.text;
    if (text === ')' || text === ']' || text === '}') {
      const open = s.match.get(k);
      if (open === undefined) return false;
      k = open;
    } else if (text === ';' || text === '{' || text === '(' || text === '[' || (text === '=' && s.toks[k + 1]?.text !== '>')) return false;
    else if (text === ':' && s.toks[k - 1]?.text === ')') return opensParameters(s, s.match.get(k - 1) ?? 0);
  }
  return false;
}

/** The kind of the `{` at token `n`, read from the token before it and, where that says nothing, from the statement around it. */
function braceKind(s: Shape, n: number): BraceKind {
  const prev = s.toks[n - 1];
  if (!prev || prev.text === ';' || prev.text === '{' || prev.text === '}') return 'block';
  if (prev.text === ':') {
    const outer = s.enclosing[n]!;
    if (outer >= 0 && s.braces.get(outer) !== 'block') return 'object';
    const { first } = statementHead(s, n);
    const label = first === n - 2 || s.toks[first]!.text === 'case';
    return label ? 'block' : 'object';
  }
  const tail = prev.text === '' || prev.text === ')' || prev.text === ']' || prev.text === '>' || (isWord(prev) && (isMember(s.toks, n - 1) || !OBJECT_WORDS.has(prev.text) || followsReturnType(s, n)));
  if (!tail) return 'object';
  return statementHead(s, n).declares ? 'class' : 'block';
}

function shapeOf(toks: Token[]): Shape {
  const s: Shape = { toks, match: new Map(), enclosing: [], braces: new Map() };
  const open: number[] = [];
  toks.forEach((t, n) => {
    s.enclosing[n] = open.at(-1) ?? -1;
    if (t.text === '(' || t.text === '[' || t.text === '{') {
      if (t.text === '{') s.braces.set(n, braceKind(s, n));
      open.push(n);
    } else if (OPENERS.has(t.text) && open.length > 0 && toks[open.at(-1)!]!.text === OPENERS.get(t.text)) {
      const partner = open.pop()!;
      s.match.set(partner, n);
      s.match.set(n, partner);
    }
  });
  return s;
}

/** The keyword of the statement head opened by the `(` at token `open`, or `''`; a member named like one is no keyword. */
function controlWord(s: Shape, open: number): string {
  const word = s.toks[open - 1]?.text === 'await' && s.toks[open - 2]?.text === 'for' ? open - 2 : open - 1;
  const text = s.toks[word]?.text ?? '';
  return CONTROL_WORDS.has(text) && !isMember(s.toks, word) ? text : '';
}

/** Whether the token at `n` (not a `!`) can end an expression, so a `!` after it on the same line asserts non-null. */
function endsValue(s: Shape, n: number): boolean {
  const t = s.toks[n]!;
  if (t.text === '' || t.text === ']') return true;
  if (t.text === ')') return controlWord(s, s.match.get(n) ?? -1) === '';
  if (t.text === '}') return s.braces.get(s.match.get(n) ?? -1) === 'object';
  if (isMember(s.toks, n) || (t.text === 'of' && controlWord(s, s.enclosing[n]!) !== 'for')) return true;
  return isWord(t) && !UNARY_WORDS.has(t.text);
}

/** Whether a token can start an operand. */
function startsOperand(src: string, t: Token): boolean {
  if (t.text === '') return true;
  if (isWord(t)) return !BINARY_WORDS.has(t.text);
  return OPERAND_PUNCTUATORS.has(t.text) || (t.text === '.' && /\d/.test(src[t.end] ?? ''));
}

/**
 * Whether the `!` at token `n` is unary. The operand comes first: a `!` (or a run of them) with no operand after it
 * is postfix. With an operand, a `!` after a value is postfix only on the value's line, since a non-null assertion
 * takes no line break before it and automatic semicolon insertion ends the statement there; a line break inside a
 * comment counts, as it does for the language.
 */
function isUnaryNot(src: string, s: Shape, n: number): boolean {
  let after = n + 1;
  while (s.toks[after]?.text === '!') after++;
  const operand = s.toks[after];
  if (!operand || !startsOperand(src, operand)) return false;
  const prev = s.toks[n - 1];
  if (!prev) return true;
  const value = prev.text === '!' ? !isUnaryNot(src, s, n - 1) : endsValue(s, n - 1);
  return !value || LINE_BREAK.test(src.slice(prev.end, s.toks[n]!.start));
}

/** Whether the `if` at token `n` is a statement: not a member, and not a name directly in a list of members. */
function isIfStatement(s: Shape, n: number): boolean {
  if (isMember(s.toks, n) || s.toks[n + 1]?.text !== '(') return false;
  const kind = s.braces.get(s.enclosing[n]!);
  return kind !== 'object' && kind !== 'class';
}

/** The mutants of the given 1-based lines of `source`, ordered by line, column and `MUTATION_OPERATORS`. */
export function mutantsFor(source: string, changedLines: readonly number[]): Mutant[] {
  const { mask, opens } = scan(source);
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  const out: Mutant[] = [];
  const wanted = new Set(changedLines);
  const add = (line: number, operator: MutationOperator, start: number, end: number, mutated: string) =>
    out.push({ line, column: start - starts[line - 1]! + 1, operator, original: source.slice(start, end), mutated, start, end });
  for (const line of wanted) {
    const from = starts[line - 1];
    if (from === undefined) continue;
    const to = starts[line] ?? source.length;
    let first = from;
    while (first < to && (mask[first] === COMMENT || isSpace(source[first]))) first++;
    let last = to - 1;
    while (last >= first && (mask[last] === COMMENT || isSpace(source[last]))) last--;
    if ((mask[first] === CODE || opens.has(first)) && mask[last] === CODE && source[last] === ';' && !DECLARATIONS.has(source.slice(first, wordEnd(source, first)))) {
      const depth = [0, 0, 0];
      let balanced = true;
      for (let k = first; k <= last && balanced; k++) {
        const b = mask[k] === CODE ? BRACKETS.get(source[k]!) : undefined;
        if (b) balanced = (depth[b[0]]! += b[1]) >= 0;
      }
      if (balanced && depth.every((n) => n === 0)) add(line, 'drop-statement', first, last + 1, '');
    }
  }
  const toks = tokens(source, mask);
  const shape = shapeOf(toks);
  let line = 1;
  toks.forEach((t, n) => {
    while (t.start >= (starts[line] ?? Infinity)) line++;
    if (!wanted.has(line)) return;
    const binary = BINARY.get(t.text);
    if (binary && spaceOrEdge(source[t.start - 1]) && spaceOrEdge(source[t.end])) add(line, binary[0], t.start, t.end, binary[1]);
    else if (t.text === '!' && isUnaryNot(source, shape, n)) add(line, 'drop-not', t.start, t.end, '');
    else if ((t.text === 'true' || t.text === 'false') && !isMember(toks, n)) add(line, 'flip-boolean', t.start, t.end, t.text === 'true' ? 'false' : 'true');
    else if (t.text === 'if' && isIfStatement(shape, n)) {
      const close = shape.match.get(n + 1);
      if (close === undefined || toks[close]!.start >= (starts[line] ?? Infinity)) return;
      for (const value of ['true', 'false'] as const) add(line, value === 'true' ? 'force-true' : 'force-false', toks[n + 1]!.end, toks[close]!.start, value);
    }
  });
  const rank = (m: Mutant) => MUTATION_OPERATORS.indexOf(m.operator);
  return out.sort((a, b) => a.line - b.line || a.column - b.column || rank(a) - rank(b));
}

/** `source` with exactly the mutant's span replaced by its mutated text; throws when the span no longer holds the original. */
export function applyMutant(source: string, mutant: Mutant): string {
  if (source.slice(mutant.start, mutant.end) !== mutant.original) throw new Error(`applyMutant: offsets ${mutant.start}-${mutant.end} no longer hold the original text ${JSON.stringify(mutant.original)}`);
  return source.slice(0, mutant.start) + mutant.mutated + source.slice(mutant.end);
}
