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

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const isSource = (file: string) => file.startsWith('src/') && file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts');

/**
 * The added new-side lines of every `src/**\/*.ts` file (not `.d.ts`, not `.test.ts`) in a `git diff --unified=0`
 * text. Fails closed: a deleted file, a path git quoted, text outside a file section and a file with a hunk header
 * or a hunk line it cannot read (a context line included, since the input has zero context) get no entry, so an empty or unreadable diff yields no lines at all.
 */
export function changedSourceLines(diff: string): ChangedSourceFile[] {
  const out: ChangedSourceFile[] = [];
  let current: ChangedSourceFile | null = null;
  let valid = false;
  let oldLeft = 0;
  let newLeft = 0;
  let next = 0;
  const close = () => {
    if (current && valid && current.lines.length > 0) out.push({ file: current.file, lines: [...new Set(current.lines)].sort((a, b) => a - b) });
    current = null;
  };
  for (const raw of diff.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (oldLeft > 0 || newLeft > 0) {
      const c = line[0];
      if (c === '+' && newLeft > 0) {
        current?.lines.push(next);
        next++;
        newLeft--;
        continue;
      }
      if (c === '-' && oldLeft > 0) {
        oldLeft--;
        continue;
      }
      if (c === '\\') continue;
      valid = false;
      oldLeft = newLeft = 0;
    }
    if (line.startsWith('+++ ')) {
      close();
      const name = line.slice(4);
      if (name.startsWith('b/')) {
        current = { file: name.slice(2), lines: [] };
        valid = isSource(current.file);
      }
    } else if (line.startsWith('@@')) {
      const m = HUNK.exec(line);
      if (!m) valid = false;
      else {
        oldLeft = m[1] === undefined ? 1 : Number(m[1]);
        next = Number(m[2]);
        newLeft = m[3] === undefined ? 1 : Number(m[3]);
      }
    }
  }
  close();
  return out;
}

const CODE = 1;
const COMMENT = 2;
const IDENT = /[A-Za-z0-9_$\u0080-\uffff]/;
const REGEX_AFTER = new Set('(,=:[!&|?{};+-*%<>~^');
const REGEX_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

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
    else if (ch === '\n' || ch === '\r') return j;
    else if (inClass) inClass = ch !== ']';
    else if (ch === '[') inClass = true;
    else if (ch === '/') return j + 1;
  }
  return src.length;
}

/** Per character: CODE at the top level of the file, COMMENT, or 0 (literals and `${}` parts). */
function scan(src: string): Uint8Array {
  const mask = new Uint8Array(src.length);
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
      while (end < src.length && src[end] !== '\n') end++;
      mask.fill(COMMENT, i, end);
    } else if (c === '/' && d === '*') {
      end = src.indexOf('*/', i + 2) < 0 ? src.length : src.indexOf('*/', i + 2) + 2;
      mask.fill(COMMENT, i, end);
    } else if (c === "'" || c === '"') [end, last, word] = [stringEnd(src, i), c, ''];
    else if (c === '`') template = true;
    else if (c === '/' && (last === '' || REGEX_AFTER.has(last) || REGEX_WORDS.has(word))) [end, last, word] = [regexEnd(src, i), '/', ''];
    else if (c === '}' && exprs.length > 0 && braces - 1 === exprs[exprs.length - 1]) {
      exprs.pop();
      [braces, template] = [braces - 1, true];
    }
    else {
      if (IDENT.test(c)) {
        while (end < src.length && IDENT.test(src[end]!)) end++;
        word = src.slice(i, end);
        last = src[end - 1]!;
      } else if (!/\s/.test(c)) [last, word] = [c, ''];
      if (c === '{') braces++;
      else if (c === '}') braces--;
      if (exprs.length === 0) mask.fill(CODE, i, end);
    }
    i = end;
  }
  return mask;
}

/** The operator tokens read whole; with the whitespace rule this is enough for `=>`, `<<`, `>>`, `>>>`, `<<=`, `>>=`, `??`, `&&=` and `||=` never to match. */
const PUNCTUATORS = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||'];
const BINARY: Partial<Record<string, [MutationOperator, string]>> = {
  '===': ['negate-equality', '!=='],
  '!==': ['negate-equality', '==='],
  '==': ['negate-equality', '!='],
  '!=': ['negate-equality', '=='],
  '&&': ['swap-logic', '||'],
  '||': ['swap-logic', '&&'],
  '<': ['boundary', '<='],
  '<=': ['boundary', '<'],
  '>': ['boundary', '>='],
  '>=': ['boundary', '>'],
};
const DECLARATION = /^(?:const|let|var|return|import|export|type|interface|declare)(?![A-Za-z0-9_$\u0080-\uffff])/;
const BRACKETS: Partial<Record<string, [number, number]>> = { '(': [0, 1], ')': [0, -1], '[': [1, 1], ']': [1, -1], '{': [2, 1], '}': [2, -1] };
const isSpace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);

interface Token {
  text: string;
  start: number;
  end: number;
}

/**
 * The code tokens of `[from, to)`, operators read greedily. Each token starts on a code character and stays in code:
 * a literal or comment opens with a quote, a backtick or a slash, none of which a word or a listed operator holds.
 */
function tokens(src: string, mask: Uint8Array, from: number, to: number): Token[] {
  const out: Token[] = [];
  let i = from;
  while (i < to) {
    const c = src[i]!;
    let end = i + 1;
    if (mask[i] !== CODE || isSpace(c)) {
      i++;
      continue;
    }
    if (IDENT.test(c)) while (end < to && IDENT.test(src[end]!)) end++;
    else {
      const p = PUNCTUATORS.find((op) => src.startsWith(op, i) && i + op.length <= to);
      if (p) end = i + p.length;
    }
    out.push({ text: src.slice(i, end), start: i, end });
    i = end;
  }
  return out;
}

/** The mutants of the given 1-based lines of `source`, ordered by line, column and `MUTATION_OPERATORS`. */
export function mutantsFor(source: string, changedLines: readonly number[]): Mutant[] {
  const mask = scan(source);
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  const out: Mutant[] = [];
  for (const line of new Set(changedLines)) {
    const from = starts[line - 1];
    if (from === undefined) continue;
    const to = starts[line] ?? source.length;
    const add = (operator: MutationOperator, start: number, end: number, mutated: string) =>
      out.push({ line, column: start - from + 1, operator, original: source.slice(start, end), mutated, start, end });
    let first = from;
    while (first < to && isSpace(source[first])) first++;
    let last = to - 1;
    while (last >= first && (mask[last] === COMMENT || isSpace(source[last]))) last--;
    if (mask[first] === CODE && mask[last] === CODE && source[last] === ';' && !DECLARATION.test(source.slice(first, last))) {
      const depth = [0, 0, 0];
      let balanced = true;
      for (let k = first; k <= last && balanced; k++) {
        const b = mask[k] === CODE ? BRACKETS[source[k]!] : undefined;
        if (b) balanced = (depth[b[0]]! += b[1]) >= 0;
      }
      if (balanced && depth.every((n) => n === 0)) add('drop-statement', first, last + 1, '');
    }
    const toks = tokens(source, mask, from, to);
    toks.forEach((t, n) => {
      const before = source[t.start - 1];
      const binary = BINARY[t.text];
      if (binary && isSpace(before) && isSpace(source[t.end])) add(binary[0], t.start, t.end, binary[1]);
      else if (t.text === '!' && !(before !== undefined && (IDENT.test(before) || before === ')' || before === ']'))) add('drop-not', t.start, t.end, '');
      else if ((t.text === 'true' || t.text === 'false') && toks[n - 1]?.text !== '.') add('flip-boolean', t.start, t.end, t.text === 'true' ? 'false' : 'true');
      else if (t.text === 'if' && toks[n + 1]?.text === '(') {
        let depth = 0;
        for (let k = n + 1; k < toks.length; k++) {
          depth += toks[k]!.text === '(' ? 1 : toks[k]!.text === ')' ? -1 : 0;
          if (depth > 0) continue;
          const [open, close] = [toks[n + 1]!.end, toks[k]!.start];
          for (const value of ['true', 'false'] as const) add(value === 'true' ? 'force-true' : 'force-false', open, close, value);
          break;
        }
      }
    });
  }
  const rank = (m: Mutant) => MUTATION_OPERATORS.indexOf(m.operator);
  return out.sort((a, b) => a.line - b.line || a.column - b.column || rank(a) - rank(b));
}

/** `source` with exactly the mutant's span replaced by its mutated text; throws when the span no longer holds the original. */
export function applyMutant(source: string, mutant: Mutant): string {
  if (source.slice(mutant.start, mutant.end) !== mutant.original) throw new Error(`applyMutant: offsets ${mutant.start}-${mutant.end} no longer hold the original text ${JSON.stringify(mutant.original)}`);
  return source.slice(0, mutant.start) + mutant.mutated + source.slice(mutant.end);
}
