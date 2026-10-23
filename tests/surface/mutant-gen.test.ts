import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMutant, changedSourceLines, mutantsFor, type Mutant } from '../../src/review/mutant-gen.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

type Row = [line: number, column: number, operator: string, original: string, mutated: string];
const view = (ms: Mutant[]): Row[] => ms.map((m) => [m.line, m.column, m.operator, m.original, m.mutated]);
const every = (source: string) => source.split('\n').map((_, i) => i + 1);

/** One code line per operator; the expected rows below are counted by hand from the R3 definitions. */
const FIXTURE = [
  'export function check(a: number, b: number, flags: Flags): boolean {',
  '  record(a);',
  '  if (flags.ready) {',
  '    note(a === b);',
  '  }',
  '  const both = flags.x && flags.y;',
  '  const off = !flags.on;',
  '  const big = a >= b;',
  '  return true;',
  '}',
];
const SOURCE = FIXTURE.join('\n') + '\n';
const TABLE: Row[] = [
  [2, 3, 'drop-statement', 'record(a);', ''],
  [3, 7, 'force-true', 'flags.ready', 'true'],
  [3, 7, 'force-false', 'flags.ready', 'false'],
  [4, 5, 'drop-statement', 'note(a === b);', ''],
  [4, 12, 'negate-equality', '===', '!=='],
  [6, 24, 'swap-logic', '&&', '||'],
  [7, 15, 'drop-not', '!', ''],
  [8, 17, 'boundary', '>=', '>'],
  [9, 10, 'flip-boolean', 'true', 'false'],
];

describe('mutantsFor (card T1-VERIFY-MUTANT-GEN)', () => {
  test('acceptance 1: the operator table, one mutant per operator on its line, in line, column and operator order [R2] [R3]', () => {
    assert.deepEqual(view(mutantsFor(SOURCE, every(SOURCE))), TABLE);
  });

  test('acceptance 1: each operator swaps both ways [R3]', () => {
    const source = 'x = a == b || c != d || e !== f;\ny = a < b || a <= b || a > b || !false;\n';
    assert.deepEqual(view(mutantsFor(source, [1, 2])), [
      [1, 1, 'drop-statement', 'x = a == b || c != d || e !== f;', ''],
      [1, 7, 'negate-equality', '==', '!='],
      [1, 12, 'swap-logic', '||', '&&'],
      [1, 17, 'negate-equality', '!=', '=='],
      [1, 22, 'swap-logic', '||', '&&'],
      [1, 27, 'negate-equality', '!==', '==='],
      [2, 1, 'drop-statement', 'y = a < b || a <= b || a > b || !false;', ''],
      [2, 7, 'boundary', '<', '<='],
      [2, 11, 'swap-logic', '||', '&&'],
      [2, 16, 'boundary', '<=', '<'],
      [2, 21, 'swap-logic', '||', '&&'],
      [2, 26, 'boundary', '>', '>='],
      [2, 30, 'swap-logic', '||', '&&'],
      [2, 33, 'drop-not', '!', ''],
      [2, 34, 'flip-boolean', 'false', 'true'],
    ]);
  });

  test('acceptance 2: nothing inside a comment, a string, a template literal with its ${} parts or a regex literal, and the code after each is read [R4]', () => {
    const source = [
      'const a1 = 1; // x === y && !z',
      'const b1 = 2; /* a === b',
      '   c && !d */ const b2 = e && f;',
      "const c1 = 'it\\'s === \"x\"' && g;",
      'const c2 = "a // b || \\" !c" && h;',
      "const t1 = `x === ${y && `n ${z || !w}` ? 'a' : true} < v` && k;",
      'const r1 = s.match(/ === && /g) && m;',
      'const r2 = /[/] < true/ || n;',
      'return /\\/ !x/.test(p) && q;',
    ].join('\n');
    assert.deepEqual(view(mutantsFor(source, every(source))), [
      [3, 28, 'swap-logic', '&&', '||'],
      [4, 28, 'swap-logic', '&&', '||'],
      [5, 30, 'swap-logic', '&&', '||'],
      [6, 60, 'swap-logic', '&&', '||'],
      [7, 33, 'swap-logic', '&&', '||'],
      [8, 25, 'swap-logic', '||', '&&'],
      [9, 24, 'swap-logic', '&&', '||'],
    ]);
  });

  test('acceptance 2: no generic, arrow, ??, compound or shift token, non-null x!, .true, split if or declaration; != is negate-equality only; / after an identifier or ) is division [R3] [R4]', () => {
    const source = [
      'const list: Array<string> = [];',
      'const f = (x: number) => x;',
      'const v = a ?? b;',
      'let w = (u &&= ok) ||= z;',
      'const n = x!.size + f()! + y[0]!;',
      'const p = cfg.true;',
      'if (ready(a,',
      '    b)) {',
      'const q = a === b;',
      'const d = total / count === 0;',
      'const e = a != b;',
      'const g = (a) / 2 === b;',
      'let h = a << 1 >> 2 >>> 3 + (a<b) <<= 4 >>= 5;',
    ].join('\n');
    const changed = every(source).filter((l) => l !== 9);
    assert.deepEqual(view(mutantsFor(source, changed)), [
      [10, 25, 'negate-equality', '===', '!=='],
      [11, 13, 'negate-equality', '!=', '=='],
      [12, 19, 'negate-equality', '===', '!=='],
    ]);
    assert.deepEqual(view(mutantsFor(source, [9])), [[9, 13, 'negate-equality', '===', '!==']]);
  });

  test('the first and last line of a file without a final newline, a line break as whitespace, and lines outside the file or repeated [R2] [R4]', () => {
    const source = 'x();\nok = a &&\n  b ? 1 : 2\ny = a || b';
    assert.deepEqual(view(mutantsFor(source, [0, 4, 1, 2, 4, 5])), [
      [1, 1, 'drop-statement', 'x();', ''],
      [2, 8, 'swap-logic', '&&', '||'],
      [4, 7, 'swap-logic', '||', '&&'],
    ]);
    assert.deepEqual(mutantsFor(source, []), []);
  });
});

describe('applyMutant (card T1-VERIFY-MUTANT-GEN)', () => {
  const withLine = (line: number, text: string) => FIXTURE.map((l, i) => (i + 1 === line ? text : l)).join('\n') + '\n';
  const EXPECTED: [line: number, operator: string, source: string][] = [
    [2, 'drop-statement', withLine(2, '  ')],
    [3, 'force-true', withLine(3, '  if (true) {')],
    [3, 'force-false', withLine(3, '  if (false) {')],
    [4, 'negate-equality', withLine(4, '    note(a !== b);')],
    [6, 'swap-logic', withLine(6, '  const both = flags.x || flags.y;')],
    [7, 'drop-not', withLine(7, '  const off = flags.on;')],
    [8, 'boundary', withLine(8, '  const big = a > b;')],
    [9, 'flip-boolean', withLine(9, '  return false;')],
  ];
  const pick = (ms: Mutant[], line: number, operator: string) => ms.find((m) => m.line === line && m.operator === operator)!;

  test('acceptance 4: one mutant of each operator replaces exactly its span [R5]', () => {
    const ms = mutantsFor(SOURCE, every(SOURCE));
    for (const [line, operator, expected] of EXPECTED) assert.equal(applyMutant(SOURCE, pick(ms, line, operator)), expected, `${operator} on line ${line}`);
    assert.throws(() => applyMutant(SOURCE.replace('record', 'resort'), pick(ms, 2, 'drop-statement')), /original/);
  });

  test('acceptance 4: on a \\r\\n copy the mutants keep their lines, columns and texts and every \\r\\n is kept [R4] [R5]', () => {
    const crlf = SOURCE.replaceAll('\n', '\r\n');
    const ms = mutantsFor(crlf, every(crlf));
    assert.deepEqual(view(ms), TABLE);
    for (const [line, operator, expected] of EXPECTED) assert.equal(applyMutant(crlf, pick(ms, line, operator)), expected.replaceAll('\n', '\r\n'), `${operator} on line ${line}`);
  });
});

describe('changedSourceLines (card T1-VERIFY-MUTANT-GEN)', () => {
  const file = (name: string, hunk: string) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n${hunk}`;
  test('acceptance 3: the added new-side lines of src/**/*.ts files, with no entry for other paths, deletions or a quoted header [R1]', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -3,0 +4,2 @@ export function a() {',
      '+  one();',
      '+  two();',
      '@@ -10 +12 @@',
      '-  old();',
      '+  new();',
      '@@ -20,2 +21,0 @@',
      '-  gone();',
      '-  gone2();',
      '@@ -30,0 +30,3 @@',
      '+++ b/not-a-header',
      '+x',
      '+y',
      file('src/b.ts', '@@ -1,0 +1 @@\n+first();'),
      file('src/c.ts', '@@ -5 +4,0 @@\n-onlyDeletes();'),
      file('src/m.d.ts', '@@ -0,0 +1 @@\n+declare const x: number;'),
      file('src/m.test.ts', '@@ -0,0 +1 @@\n+t();'),
      file('tests/x.test.ts', '@@ -0,0 +1 @@\n+t();'),
      file('docs/a.md', '@@ -0,0 +1 @@\n+text'),
      'diff --git a/src/old.ts b/src/old.ts',
      'deleted file mode 100644',
      '--- a/src/old.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-a();',
      '-b();',
      'diff --git "a/src/q\\"x.ts" "b/src/q\\"x.ts"',
      '--- "a/src/q\\"x.ts"',
      '+++ "b/src/q\\"x.ts"',
      '@@ -0,0 +1 @@',
      '+q();',
      '',
    ].join('\n');
    assert.deepEqual(changedSourceLines(diff), [
      { file: 'src/a.ts', lines: [4, 5, 12, 30, 31, 32] },
      { file: 'src/b.ts', lines: [1] },
    ]);
  });

  test('fails closed: an empty diff, text that is not a diff and a file with an unreadable hunk header yield nothing [R1]', () => {
    assert.deepEqual(changedSourceLines(''), []);
    assert.deepEqual(changedSourceLines('+ok();\n@@ -1 +1 @@\n+ok();\n'), []);
    assert.deepEqual(changedSourceLines(file('src/d.ts', '@@ -0,0 +1 @@\n+ok();\n@@ nonsense @@\n+y();\n')), []);
    assert.deepEqual(changedSourceLines(file('src/e.ts', '@@ -0,0 +1 @@\r\n+ok();\r\n')), [{ file: 'src/e.ts', lines: [1] }]);
  });
});

describe('docs (card T1-VERIFY-MUTANT-GEN)', () => {
  const OPERATIONS = [
    '`src/review/mutant-gen.ts` (card T1-VERIFY-MUTANT-GEN) lists the mutants of the source lines a change adds; it is pure, reads no file and runs nothing, and the command that runs the mutants under a card\'s DoD arrives with card T1-VERIFY-MUTANTS.',
    '`changedSourceLines(diff)` reads a `git diff --unified=0` text and returns, for each file under `src/` that ends in `.ts` but not in `.d.ts` or `.test.ts`, the new-side line numbers of its added lines in ascending order; a deleted file, a file whose hunks only delete and a path git quoted get no entry, and an empty diff, text that is not a diff or a file with a hunk header it cannot read yields no lines, so no mutant is ever generated over a whole file.',
    '`mutantsFor(source, changedLines)` returns the mutants of those lines, each with its 1-based line and column (in UTF-16 code units), its operator, its original and mutated text and its source offsets, ordered by line, column and operator; `applyMutant(source, mutant)` replaces exactly that span and refuses a source whose span no longer holds the original text.',
    'The mutation operators, in run order, are `drop-statement`, `force-true`, `force-false`, `negate-equality`, `swap-logic`, `drop-not`, `boundary` and `flip-boolean`; an operator counts only in code, never inside a comment, a string, a template literal or a regex literal.',
    '`drop-statement` removes the code of a line that ends with `;`, balances `()`, `[]` and `{}` within the line and does not begin with `const`, `let`, `var`, `return`, `import`, `export`, `type`, `interface` or `declare`.',
    '`force-true` and `force-false` replace the condition of an `if (...)` whose closing parenthesis is on the same line with `true` and with `false`.',
    '`negate-equality` swaps `===` with `!==` and `==` with `!=`, `swap-logic` swaps `&&` with `||`, and `boundary` swaps `<` with `<=` and `>` with `>=`; each counts only with whitespace (a space, a tab or a line break) on both sides, so a generic such as `Array<string>` and a comparison written without spaces (`a<b`) are never mutated.',
    '`drop-not` removes a unary `!`, never the `!` of `!=` or `!==` nor a non-null assertion after an identifier, `)` or `]`, and `flip-boolean` swaps the words `true` and `false` where no `.` precedes them.',
    'An in-house scanner reads the whole file once (no new dependency), takes operator tokens greedily, so `=>`, `<<`, `>>`, `>>>`, `<<=`, `>>=`, `??`, `&&=` and `||=` never match, and keeps the `\\r` of a `\\r\\n` line end out of the code.',
    'A `/` opens a regex literal after no code, after one of `( , = : [ ! & | ? { } ; + - * % < > ~ ^` or after the word `return`, `typeof`, `case`, `do`, `else`, `in`, `of`, `new`, `delete`, `void`, `throw`, `instanceof`, `yield` or `await`, and is a division otherwise; this reads a regex literal after `)` as a division and a division after `}` as a regex, which adds or drops a mutant and changes nothing else.',
  ];
  const ARCHITECTURE = '`src/review/mutant-gen.ts` lists the mutants of the `src/` TypeScript lines a zero-context diff adds under eight fixed operators, with an in-house scanner that keeps comments, strings, template literals and regex literals out of reach; it is pure and adds no dependency (card T1-VERIFY-MUTANT-GEN).';
  const CHANGELOG = [
    '- T1-VERIFY-MUTANT-GEN: `src/review/mutant-gen.ts` lists the mutants of the source lines a change adds, with no new dependency: `changedSourceLines` reads the added lines of `src/**/*.ts` files (not `.d.ts` or `.test.ts`) from a `git diff --unified=0` text, `mutantsFor` lists the mutants of those lines under the eight operators of `MutationOperator` (`drop-statement`, `force-true`, `force-false`, `negate-equality`, `swap-logic`, `drop-not`, `boundary`, `flip-boolean`) while an in-house scanner skips comments, strings, template literals and regex literals, and `applyMutant` writes one mutant into the source.',
    'Nothing runs the mutants yet; card T1-VERIFY-MUTANTS adds the run.',
  ];
  const lf = (text: string) => text.replace(/\r\n/g, '\n');
  const sectionOf = (text: string, heading: string) => {
    const start = text.indexOf(`\n${heading}\n`);
    return start < 0 ? '' : text.slice(start, text.indexOf('\n#', start + heading.length + 2));
  };
  const unreleasedOf = (text: string) => text.slice(text.indexOf('## Unreleased'), text.indexOf('\n## ', text.indexOf('## Unreleased') + 1));

  test('acceptance 5: OPERATIONS.md Mutant sweep follows Review statistics and is pinned whole, ARCHITECTURE.md follows the stats sentence, the CHANGELOG entry is pinned; removing any sentence fails [R6]', () => {
    const operations = lf(readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8'));
    const architecture = lf(readFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8'));
    const changelog = lf(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));
    const stats = operations.indexOf('\n### Review statistics\n');
    assert.ok(stats >= 0, 'OPERATIONS.md keeps Review statistics');
    assert.equal(operations.indexOf('\n#', stats + 1), operations.indexOf('\n### Mutant sweep\n'), 'Mutant sweep is the next heading after Review statistics');
    const opsHold = (text: string) => sectionOf(text, '### Mutant sweep') === `\n### Mutant sweep\n\n${OPERATIONS.join(' ')}\n`;
    const archHolds = (text: string) => text.includes('(`aidlc review stats`). ' + ARCHITECTURE + ' ');
    const changelogHolds = (text: string) => unreleasedOf(text).split('\n').includes(CHANGELOG.join(' '));
    assert.ok(opsHold(operations), 'OPERATIONS.md Mutant sweep is the pinned paragraph');
    assert.ok(archHolds(architecture), 'ARCHITECTURE.md names src/review/mutant-gen.ts after the stats sentence');
    assert.ok(changelogHolds(changelog), 'CHANGELOG.md Unreleased carries the entry');
    for (const s of OPERATIONS) assert.equal(opsHold(operations.replace(s, '')), false, `removing this sentence still passes: ${s}`);
    for (const s of CHANGELOG) assert.equal(changelogHolds(changelog.replace(s, '')), false, `removing this sentence still passes: ${s}`);
    assert.equal(archHolds(architecture.replace(ARCHITECTURE, '')), false);
  });
});
