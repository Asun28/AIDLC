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
      'const r2 = / < true/ || n;',
      'return /\\/ !x/.test(p) && q;',
    ].join('\n');
    assert.deepEqual(view(mutantsFor(source, every(source))), [
      [3, 28, 'swap-logic', '&&', '||'],
      [4, 28, 'swap-logic', '&&', '||'],
      [5, 30, 'swap-logic', '&&', '||'],
      [6, 60, 'swap-logic', '&&', '||'],
      [7, 33, 'swap-logic', '&&', '||'],
      [8, 22, 'swap-logic', '||', '&&'],
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
    assert.deepEqual(view(mutantsFor(source, [0, 4, 1, 2, 4, 5, 1.5])), [
      [1, 1, 'drop-statement', 'x();', ''],
      [2, 8, 'swap-logic', '&&', '||'],
      [4, 7, 'swap-logic', '||', '&&'],
    ]);
    assert.deepEqual(mutantsFor(source, []), []);
  });

  /** Each case closes a scanner or operator branch the hand mutation sweep found untested (card hygiene, T1-OPUS55-R3-3). */
  const CASES: [source: string, expected: Row[]][] = [
    ["const s = 'a \\\n=== b' && c;", [[2, 8, 'swap-logic', '&&', '||']]],
    ["const s = 'a \\\r\n=== b' && c;", [[2, 8, 'swap-logic', '&&', '||']]],
    ["const u = 'open\nok = a && b", [[2, 8, 'swap-logic', '&&', '||']]],
    ['const t = `a \\` && b` && c;', [[1, 23, 'swap-logic', '&&', '||']]],
    ["const o = `${ {a: b}.a + '`' } && x` && y;", [[1, 38, 'swap-logic', '&&', '||']]],
    ['/ === /.test(s) && ok;', [[1, 1, 'drop-statement', '/ === /.test(s) && ok;', ''], [1, 17, 'swap-logic', '&&', '||']]],
    ['const r3 = s.split(/[/] < 1/) || n;', [[1, 31, 'swap-logic', '||', '&&']]],
    ['return /oops\nok = a && b', [[2, 8, 'swap-logic', '&&', '||']]],
    ['run(); /* x && y */', [[1, 1, 'drop-statement', 'run();', '']]],
    ['x = `a;\nb`;', []],
    [';', [[1, 1, 'drop-statement', ';', '']]],
    ["log(')');", [[1, 1, 'drop-statement', "log(')');", '']]],
    ['  }).then(done);\nx = f(g(1);\na) + (b;', []],
    ['if (ok(a)) {', [[1, 5, 'force-true', 'ok(a)', 'true'], [1, 5, 'force-false', 'ok(a)', 'false']]],
    ['const lt = a <b || c> d;', [[1, 17, 'swap-logic', '||', '&&']]],
    ['const m = cfg?.false;\nconst n = é!.size;\nconst p = cfg.if;', []],
    ["var a = 1;\nimport x from 'y';\nexport const z = 1;\ntype T = A;\ninterface I { a: number };\ndeclare const d: number;\nconstant();\nlets();", [
      [7, 1, 'drop-statement', 'constant();', ''],
      [8, 1, 'drop-statement', 'lets();', ''],
    ]],
  ];
  test('a / opens a regex literal after each listed character and word, so the operators inside it are not code [R4]', () => {
    const chars = '( , = : [ ! & | ? { } ; + - * % < > ~ ^'.split(' ').map((c) => `x${c}/ === / && a`).join('\n');
    assert.deepEqual(view(mutantsFor(chars, every(chars))), every(chars).map((line): Row => [line, 11, 'swap-logic', '&&', '||']));
    const words = 'typeof case do else in of new delete void throw instanceof yield await'.split(' ').map((w) => `${w} / === / && a`).join('\n');
    const columns = [16, 14, 12, 14, 12, 12, 13, 16, 14, 15, 20, 15, 15];
    assert.deepEqual(view(mutantsFor(words, every(words))), columns.map((column, i): Row => [i + 1, column, 'swap-logic', '&&', '||']));
  });

  test('scanner and operator edges:continued and unterminated literals, escapes, braces in ${}, a regex first in the file, trailing comments, bracket balance, nested if parentheses, one-sided spaces, ?., every excluded keyword [R3] [R4]', () => {
    for (const [source, expected] of CASES) assert.deepEqual(view(mutantsFor(source, every(source))), expected, JSON.stringify(source));
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
      file('src/b.ts', '@@ -1 +1,2 @@\n-x();\n\\ No newline at end of file\n+first();\n+second();\n\\ No newline at end of file'),
      file('bench/x.ts', '@@ -0,0 +1 @@\n+b();'),
      file('src/x.js', '@@ -0,0 +1 @@\n+b();'),
      'diff --git i/src/w.ts w/src/w.ts\n--- i/src/w.ts\n+++ w/src/w.ts\n@@ -0,0 +1 @@\n+w();',
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
      { file: 'src/b.ts', lines: [1, 2] },
    ]);
  });

  test('hunks out of order or repeated still give ascending lines, each once [R1]', () => {
    assert.deepEqual(changedSourceLines(file('src/i.ts', '@@ -0,0 +9 @@\n+a();\n@@ -0,0 +2 @@\n+b();\n@@ -0,0 +9 @@\n+c();')), [{ file: 'src/i.ts', lines: [2, 9] }]);
  });

  test('fails closed: an empty diff, text that is not a diff and a file with an unreadable hunk header yield nothing [R1]', () => {
    assert.deepEqual(changedSourceLines(''), []);
    assert.deepEqual(changedSourceLines('+ok();\n@@ -1 +1 @@\n+ok();\n'), []);
    assert.deepEqual(changedSourceLines(file('src/d.ts', '@@ -0,0 +1 @@\n+ok();\n@@ nonsense @@\n+y();\n')), []);
    assert.deepEqual(changedSourceLines(file('src/f.ts', '@@ -0,0 +1,2 @@\n+a();') + '\n' + file('src/g.ts', '@@ -0,0 +5 @@\n+g();')), [{ file: 'src/g.ts', lines: [5] }]);
    assert.deepEqual(changedSourceLines(file('src/h.ts', '@@ -1,2 +1,2 @@\n ctx();\n-a();\n+b();')), []);
    assert.deepEqual(changedSourceLines(file('src/j.ts', '@@ -1 +1 @@\n+a();\n+b();\n-c();')), []);
    assert.deepEqual(changedSourceLines(file('src/k.ts', '@@ -1 +1,2 @@\n-a();\n-b();\n+c();\n+d();')), []);
    assert.deepEqual(changedSourceLines(file('src/e.ts', '@@ -0,0 +1 @@\n+ok();\n').replaceAll('\n', '\r\n')), [{ file: 'src/e.ts', lines: [1] }]);
  });
});

describe('R3 decision 1 repairs (card T1-VERIFY-MUTANT-GEN)', () => {
  const file = (name: string, hunk: string) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n${hunk}`;
  const lines = (diff: string) => changedSourceLines(diff);

  test('F1: an identifier named like an Object.prototype member is never an operator [R3]', () => {
    const source = 'const a = constructor ();\nconst b = toString ();\nconst c = __proto__ ;\nconst d = hasOwnProperty ();\nx = valueOf ();';
    assert.deepEqual(view(mutantsFor(source, every(source))), [[5, 1, 'drop-statement', 'x = valueOf ();', '']]);
  });

  test('F2: a hunk with lines still owed at the end of the diff gives no entry, with and without a final newline [R1]', () => {
    for (const end of ['', '\n']) {
      assert.deepEqual(lines(file('src/a.ts', '@@ -0,0 +1,2 @@\n+a();' + end)), [], `new side, end ${JSON.stringify(end)}`);
      assert.deepEqual(lines(file('src/a.ts', '@@ -1,2 +1 @@\n-a();\n+b();' + end)), [], `old side, end ${JSON.stringify(end)}`);
    }
    assert.deepEqual(lines(file('src/a.ts', '@@ -0,0 +1 @@\n+a();')), [{ file: 'src/a.ts', lines: [1] }], 'a complete hunk without a final newline');
    assert.deepEqual(lines(file('src/a.ts', '@@ -0,0 +1,2 @@\n+a();\n@@ -0,0 +5 @@\n+b();\n')), [], 'a hunk cut short by the next hunk header');
  });

  test('F3: a body line after the counts are spent, or a line no diff carries there, fails the file closed [R1]', () => {
    assert.deepEqual(lines(file('src/a.ts', '@@ -0,0 +1 @@\n+a();\n+b();\n')), []);
    assert.deepEqual(lines(file('src/a.ts', '@@ -1 +1 @@\n-a();\n+b();\n-c();\n')), []);
    assert.deepEqual(lines(file('src/a.ts', '@@ -0,0 +1 @@\n+a();\ngarbage\n')), []);
    assert.deepEqual(lines(file('src/a.ts', '@@ -0,0 +1 @@\n+a();\n\n@@ -0,0 +3 @@\n+c();\n')), []);
    assert.deepEqual(lines(file('src/a.ts', '@@ -0,0 +1 @@\n+a();\n\\ No newline at end of file\n@@ -0,0 +3 @@\n+c();\n')), [{ file: 'src/a.ts', lines: [1, 3] }]);
    assert.deepEqual(lines(file('src/a.ts', '@@ -0,0 +1 @@\n+a();\n@@ nonsense @@\n')), [], 'an unreadable hunk header after a complete hunk');
    assert.deepEqual(lines('--- a/src/a.ts\n+++ b/src/a.ts\n@@ -0,0 +1 @@\n+a();\n'), [], 'file headers outside a diff --git section');
  });

  test('F4: hunk coordinates must be safe integers and a non-empty range must start at line 1 or later [R1]', () => {
    for (const header of ['@@ -0,0 +0 @@', '@@ -0,0 +0,1 @@', '@@ -0,0 +-1 @@', '@@ -0,0 +1.5 @@', '@@ -0,0 +9007199254740993 @@', '@@ -0,0 +1,9007199254740993 @@', '@@ -0,0 +9007199254740991 @@']) {
      assert.deepEqual(lines(file('src/a.ts', `${header}\n+a();\n`)), [], header);
    }
    assert.deepEqual(lines(file('src/a.ts', '@@ -0,1 +1 @@\n-a();\n+b();\n')), [], 'old side starting at 0');
    assert.deepEqual(lines(file('src/a.ts', '@@ -1 +0,0 @@\n-a();\n@@ -3,0 +2 @@\n+b();\n')), [{ file: 'src/a.ts', lines: [2] }], 'an empty new side may start at 0');
  });

  test('F5: a statement after a leading comment is dropped and the comment stays [R3]', () => {
    const source = '/* lead */ run();\n/* a\n   b */ go();\n/* lead */ const x = 1;';
    const ms = mutantsFor(source, every(source));
    assert.deepEqual(view(ms), [
      [1, 12, 'drop-statement', 'run();', ''],
      [3, 9, 'drop-statement', 'go();', ''],
    ]);
    assert.equal(applyMutant(source, ms[0]!), '/* lead */ \n/* a\n   b */ go();\n/* lead */ const x = 1;');
  });

  test('F6: a non-null assertion is read from the previous significant token across spaces, comments and lines; a unary ! after (, = or return is dropped [R3]', () => {
    const source = [
      'const a = value !;',
      'const b = value /* c */ !;',
      'const c = f() !;',
      'const d = arr[0]',
      '  !.size;',
      'const e = (!x);',
      'const f = !x;',
      'return !x;',
      'return /* c */ !x;',
    ].join('\n');
    assert.deepEqual(view(mutantsFor(source, every(source))), [
      [5, 3, 'drop-statement', '!.size;', ''],
      [6, 12, 'drop-not', '!', ''],
      [7, 11, 'drop-not', '!', ''],
      [8, 8, 'drop-not', '!', ''],
      [9, 16, 'drop-not', '!', ''],
    ]);
    const unterminated = "const s = 'abc\n!x;";
    assert.deepEqual(view(mutantsFor(unterminated, [2])), [[2, 1, 'drop-statement', '!x;', ''], [2, 1, 'drop-not', '!', '']], 'a literal is not a token a ! can follow');
  });

  test('F7 and F8: true, false and if after a property dot are never mutated, across spaces, comments and lines; an if after else is [R3]', () => {
    const source = [
      'const a = obj.',
      '  true;',
      'const b = obj',
      '  .false;',
      'const c = obj. /* c */ true;',
      'const d = obj?.',
      '  true;',
      'obj.',
      '  if (ok) {',
      'obj.if(ok);',
      'obj. /* c */ if (ok) {',
      '} else if (ok) {',
      'const o = { if: 1 };',
    ].join('\n');
    assert.deepEqual(view(mutantsFor(source, every(source))), [
      [2, 3, 'drop-statement', 'true;', ''],
      [4, 3, 'drop-statement', '.false;', ''],
      [7, 3, 'drop-statement', 'true;', ''],
      [10, 1, 'drop-statement', 'obj.if(ok);', ''],
      [12, 12, 'force-true', 'ok', 'true'],
      [12, 12, 'force-false', 'ok', 'false'],
    ]);
  });

  test('R2 suggestion: the start and the end of the input count as whitespace for a binary operator [R4]', () => {
    assert.deepEqual(view(mutantsFor('ok = a &&', [1])), [[1, 8, 'swap-logic', '&&', '||']]);
    assert.deepEqual(view(mutantsFor('&& b', [1])), [[1, 1, 'swap-logic', '&&', '||']]);
  });
});

describe('R3 decision 2 repairs (card T1-VERIFY-MUTANT-GEN-2)', () => {
  const file = (name: string, hunk: string) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n${hunk}`;
  const MARKER = '\\ No newline at end of file';
  const ds = (line: number, column: number, original: string): Row => [line, column, 'drop-statement', original, ''];
  const dn = (line: number, column: number): Row => [line, column, 'drop-not', '!', ''];
  const conditions = (ms: Mutant[]) => view(ms).filter((row) => row[2] === 'force-true' || row[2] === 'force-false');
  const forced = (line: number, column: number, condition = 'ok'): Row[] => [
    [line, column, 'force-true', condition, 'true'],
    [line, column, 'force-false', condition, 'false'],
  ];

  test('F3: an excess body line invalidates the file for good, whatever hunk follows [R1]', () => {
    const cases = [
      '@@ -0,0 +1 @@\n+a();\n+b();',
      '@@ -0,0 +1 @@\n+a();\n+b();\n',
      '@@ -1 +1 @@\n-a\n-b\n+c\n@@ -3 +3 @@\n-d\n+e',
      '@@ -1 +1 @@\n-a\n-b\n+c\n@@ -3 +3 @@\n-d\n+e\n',
      '@@ -1 +1 @@\n+a\n+b\n-c\n@@ -3 +3 @@\n-d\n+e',
      '@@ -1 +1 @@\n+a\n-b\n-c\n@@ -3 +3 @@\n-d\n+e\n@@ -5 +5 @@\n-f\n+g',
      '@@ -0,0 +1 @@\n+a();\n@@ -0,0 +3 @@\n+c();\n+d();\n@@ -0,0 +9 @@\n+e();',
    ];
    for (const hunks of cases) assert.deepEqual(changedSourceLines(file('src/a.ts', hunks)), [], JSON.stringify(hunks));
  });

  test('F3: a hunk header while the last hunk still owes lines, and a hunk with no lines at all, invalidate the file [R1]', () => {
    assert.deepEqual(changedSourceLines(file('src/a.ts', '@@ -0,0 +1,2 @@\n+a();\n@@ -0,0 +5 @@\n+b();\n@@ -0,0 +7 @@\n+c();')), []);
    assert.deepEqual(changedSourceLines(file('src/a.ts', '@@ -1,2 +1 @@\n-a();\n+b();\n@@ -5 +5 @@\n-c();\n+d();')), []);
    assert.deepEqual(changedSourceLines(file('src/a.ts', '@@ -0,0 +0,0 @@\n@@ -0,0 +1 @@\n+a();')), []);
  });

  test('F3: only the exact marker, right after a body line, is accepted inside or after a hunk [R1]', () => {
    const notMarkers = ['\\ garbage', '\\', '\\ ', '\\No newline at end of file', '\\  No newline at end of file', '\\ no newline at end of file', `${MARKER}.`, `${MARKER} `, ` ${MARKER}`];
    for (const bad of notMarkers) {
      assert.deepEqual(changedSourceLines(file('src/a.ts', `@@ -0,0 +1 @@\n${bad}\n+x;`)), [], `inside a hunk: ${bad}`);
      assert.deepEqual(changedSourceLines(file('src/a.ts', `@@ -1 +1,2 @@\n-a\n${bad}\n+x;\n+y;`)), [], `between the sides: ${bad}`);
      assert.deepEqual(changedSourceLines(file('src/a.ts', `@@ -0,0 +1 @@\n+x;\n${bad}\n`)), [], `after a complete hunk: ${bad}`);
      assert.deepEqual(changedSourceLines(file('src/a.ts', `@@ -0,0 +1 @@\n+x;\n${bad}\n@@ -0,0 +3 @@\n+y;`)), [], `before another hunk: ${bad}`);
    }
    assert.deepEqual(changedSourceLines(file('src/a.ts', '@@ -0,0 +1 @@\n+x;\ngarbage')), [], 'text on the last row of the diff');
    assert.deepEqual(changedSourceLines(file('src/a.ts', `@@ -0,0 +1 @@\n${MARKER}\n+x;`)), [], 'a marker with no body line before it');
    assert.deepEqual(changedSourceLines(file('src/a.ts', `@@ -0,0 +1 @@\n+x;\n${MARKER}\n${MARKER}\n`)), [], 'a marker after a marker');
    assert.deepEqual(changedSourceLines(file('src/a.ts', `@@ -1 +1 @@\n-a\n${MARKER}\n+x;\n${MARKER}\n`)), [{ file: 'src/a.ts', lines: [1] }], 'the marker after each side');
    assert.deepEqual(changedSourceLines(file('src/a.ts', `@@ -0,0 +1 @@\r\n+x;\r\n${MARKER}\r\n`)), [{ file: 'src/a.ts', lines: [1] }], 'the marker in a \\r\\n diff');
  });

  test('F3: an invalid file takes no entry and the next file keeps its own [R1]', () => {
    const diff = file('src/a.ts', '@@ -0,0 +1 @@\n+a();\n+b();\n') + file('src/b.ts', '@@ -0,0 +2 @@\n+c();\n') + file('src/c.ts', '@@ -0,0 +3 @@\n\\ garbage\n+d();\n') + file('src/d.ts', '@@ -0,0 +4 @@\n+e();\n');
    assert.deepEqual(changedSourceLines(diff), [{ file: 'src/b.ts', lines: [2] }, { file: 'src/d.ts', lines: [4] }]);
  });

  test('F6: a ! after a value on the same line is postfix, after a property named like a keyword, in a chain and after a literal or an object [R3]', () => {
    const source = [
      'const a = obj.return!;',
      'const b = value!!;',
      'const c = obj?.in!.size;',
      'const d = this.#return!;',
      'const e = obj. /* c */ return !;',
      'const f = value!!.size;',
      'const g = `t`!;',
      "const h = 'a'!.length;",
      'const i = /r/!.source;',
      'const j = { a: 1 }!;',
      'const k = value !c;',
      'const l = f()!(x);',
      'const m = y[0]![1]!;',
      'const n = of!.size;',
      'const o = obj.await!(x);',
      'class A { return!: number; }',
      'let p!: number;',
      'const q = value !;',
      'const r = value /* c */ !;',
    ].join('\n');
    assert.deepEqual(view(mutantsFor(source, every(source))), []);
  });

  test('F6: a ! that starts an operand stays unary after keywords, control heads, blocks and other unary operators [R3]', () => {
    const source = [
      'const a = !!x;',
      'const b = c ? !d : !e;',
      'if (a) !b;',
      'while (a) !b;',
      'for (;;) !b;',
      'for await (const a of b) !c;',
      'obj.if(a)!.b;',
      'export default !x;',
      'const c = [...await !x];',
      'const d = !(a);',
      "const e = !'s';",
      'const f = !-1;',
      'const g = !.5;',
      'const h = !/r/.test(s);',
      'const i = !`t`;',
      'const j = !a.in;',
      'x = <T>!y;',
      '{ a(); } !b;',
    ].join('\n');
    assert.deepEqual(view(mutantsFor(source, every(source))), [
      dn(1, 11),
      dn(1, 12),
      dn(2, 15),
      dn(2, 20),
      ds(3, 1, 'if (a) !b;'),
      ...forced(3, 5, 'a'),
      dn(3, 8),
      ds(4, 1, 'while (a) !b;'),
      dn(4, 11),
      ds(5, 1, 'for (;;) !b;'),
      dn(5, 10),
      ds(6, 1, 'for await (const a of b) !c;'),
      dn(6, 26),
      ds(7, 1, 'obj.if(a)!.b;'),
      dn(8, 16),
      dn(9, 21),
      dn(10, 11),
      dn(11, 11),
      dn(12, 11),
      dn(13, 11),
      dn(14, 11),
      dn(15, 11),
      dn(16, 11),
      ds(17, 1, 'x = <T>!y;'),
      dn(17, 8),
      ds(18, 1, '{ a(); } !b;'),
      dn(18, 10),
    ]);
  });

  test('F11: after a line break a ! before an operand is unary (automatic semicolon insertion) [R3]', () => {
    const unary: Row[] = [ds(2, 1, '!c;'), dn(2, 1)];
    for (const head of ['const a = b', 'const a = f()', 'const a = y[0]', "const a = 's'", 'const a = `t`', 'const a = { b: 1 }', 'b!', 'break', 'continue', 'const a = b // c', 'const a = b /* c */']) {
      assert.deepEqual(view(mutantsFor(`${head}\n!c;`, [2])), unary, head);
    }
    assert.deepEqual(view(mutantsFor('const a = b\r\n!c;', [2])), unary, 'a \\r\\n line end');
    assert.deepEqual(view(mutantsFor('const a = b /* x\n */ !d;', [2])), [ds(2, 5, '!d;'), dn(2, 5)], 'a comment holding the line break');
    assert.deepEqual(view(mutantsFor('const a = b\n/* c */ !d;', [2])), [ds(2, 9, '!d;'), dn(2, 9)], 'a comment before the !');
    assert.deepEqual(view(mutantsFor('const a = b\n!!c;', [2])), [ds(2, 1, '!!c;'), dn(2, 1), dn(2, 2)], 'a double negation');
    assert.deepEqual(view(mutantsFor('const a = b\u2028!c;', [1])), [dn(1, 13)], 'U+2028 ends a line for the language though not for git');
    assert.deepEqual(view(mutantsFor('const a = b\r!c;', [1])), [dn(1, 13)], 'a lone \\r');
    for (const operand of ['!(c);', '![c].length;', "!'s'.length;", '!`t`.length;', '!/r/.test(c);', '!-c;', '!+c;', '!~c;', '!<T>c;', '!{}.a;', '!new C();', '!.5;', '!#p in c;']) {
      assert.deepEqual(view(mutantsFor(`b\n${operand}`, [2])), [ds(2, 1, operand), dn(2, 1)], operand);
    }
  });

  test('F11: after a line break a ! with no operand after it continues the expression, the case F6 pins [R3]', () => {
    for (const tail of ['!.size;', '!?.size;', '!!.size;', '!;', '! in c;', '! instanceof C;', '! as T;', '! satisfies T;', '! ? c : d;']) {
      assert.deepEqual(view(mutantsFor(`const a = b\n${tail}`, [2])), [ds(2, 1, tail)], tail);
    }
    assert.deepEqual(view(mutantsFor('const a = b\n! === c;', [2])), [ds(2, 1, '! === c;'), [2, 3, 'negate-equality', '===', '!==']]);
    assert.deepEqual(view(mutantsFor('f(b\n!, c);', [2])), []);
    assert.deepEqual(view(mutantsFor('f(b\n!);', [2])), []);
    assert.deepEqual(view(mutantsFor('const a = b\n!', [2])), []);
  });

  test('F9: a member named if in an object literal, a class, an interface or a type literal is no condition [R3]', () => {
    const sources = [
      'const o = { if(ok) {} };',
      'class A { if(ok: boolean) {} }',
      'const o = { a: 1, if(ok) {} };',
      'const o = { async if(ok) {} };',
      'const o = { *if(ok) {} };',
      'const o = { set if(ok) {} };',
      'const o = { a: { if(ok) {} } };',
      'class A { static if(ok: boolean) {} }',
      'class A { public async if(ok: boolean) {} }',
      'class A { #if(ok: boolean) {} }',
      'class A { a() {} if(ok: boolean) {} }',
      'class A { x = 1; if(ok: boolean) {} }',
      'abstract class A { abstract if(ok: boolean): void; }',
      'class A<T> { if(ok: boolean) {} }',
      'class A extends B implements C { if(ok: boolean) {} }',
      'class A extends mix({ a: 1 }) { if(ok: boolean) {} }',
      'const C = class { if(ok: boolean) {} };',
      'interface I { if(ok: boolean): void; }',
      'interface I extends J<K> { if(ok: boolean): void; }',
      'type T = { if(ok: boolean): void };',
      'function f(p: { if(ok: boolean): void }) {}',
      'function f(): { if(ok: boolean): void } { return x; }',
      'const t: { if(ok: boolean): void } = x;',
      'foo({ if(ok) {} });',
      'const a = [{ if(ok) {} }];',
      'const a = x ? { if(ok) {} } : y;',
      'const a = x ? y : { if(ok) {} };',
      'const a = x || { if(ok) {} };',
      'export default { if(ok) {} };',
      'return { if(ok) {} };',
      'throw { if(ok) {} };',
      'const a = await { if(ok) {} };',
      'const a = b as { if(ok: boolean): void };',
      'const a = b satisfies { if(ok: boolean): void };',
      'function f<T extends { if(ok: boolean): void }>() {}',
      'class A {\n  if(ok: boolean) {}\n}',
      'const o = {\n  a: 1,\n  if(ok) {},\n};',
    ];
    for (const source of sources) assert.deepEqual(conditions(mutantsFor(source, every(source))), [], source);
  });

  test('F9: an if statement stays a condition in every block, method body and function body [R3]', () => {
    const CONDITIONS: [source: string, column: number][] = [
      ['class A { m() { if (ok) {} } }', 21],
      ['class A extends B { m() { if (ok) {} } }', 31],
      ['class A { static { if (ok) {} } }', 24],
      ['class A {} function f(): T { if (ok) {} }', 34],
      ['{ if (ok) {} }', 7],
      ['function f(): T { if (ok) {} }', 23],
      ['function f(): Promise<void> { if (ok) {} }', 35],
      ['const g = () => { if (ok) {} };', 23],
      ['const t = (): { a: 1 } => { if (ok) {} };', 33],
      ['const o = { m() { if (ok) {} } };', 23],
      ['const o = { a: () => { if (ok) {} } };', 28],
      ['const o = { a: function () { if (ok) {} } };', 34],
      ['const o = { if(x) { if (ok) {} } };', 25],
      ['foo(function () { if (ok) {} });', 23],
      ['switch (x) { case 1: { if (ok) {} } }', 28],
      ['switch (x) { default: { if (ok) {} } }', 29],
      ['switch (x) { case 1: x(); case 2: { if (ok) {} } }', 41],
      ['lbl: { if (ok) {} }', 12],
      ['try { if (ok) {} } catch { y(); }', 11],
      ['do { if (ok) {} } while (x);', 10],
      ['x(); else { if (ok) {} }', 17],
      ['namespace N { if (ok) {} }', 19],
    ];
    for (const [source, column] of CONDITIONS) assert.deepEqual(conditions(mutantsFor(source, every(source))), forced(1, column), source);
    assert.deepEqual(conditions(mutantsFor('if (a) { if (ok) {} }', [1])), [...forced(1, 5, 'a'), ...forced(1, 14)]);
  });

  test('F10: no whitespace character of the language is an identifier character [R3] [R4]', () => {
    const spaces = ['\u00a0', '\u1680', '\u2000', '\u2005', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff', '\u0085', '\u200b'];
    for (const ws of spaces) {
      const name = `U+${ws.charCodeAt(0).toString(16)}`;
      assert.deepEqual(view(mutantsFor(`const${ws}x = 1;`, [1])), [], `declaration keyword, ${name}`);
      assert.deepEqual(view(mutantsFor(`return${ws}/ === /.test(x);`, [1])), [], `regex after a keyword, ${name}`);
      assert.deepEqual(view(mutantsFor(`a${ws}===${ws}b`, [1])), [[1, 3, 'negate-equality', '===', '!==']], `binary operator, ${name}`);
      assert.deepEqual(view(mutantsFor(`y = ${ws}true`, [1])), [[1, 6, 'flip-boolean', 'true', 'false']], `boolean, ${name}`);
      assert.deepEqual(view(mutantsFor(`if${ws}(ok) {`, [1])), forced(1, 5), `if keyword, ${name}`);
      assert.deepEqual(view(mutantsFor(`const v = obj.${ws}true;`, [1])), [], `boolean after a dot, ${name}`);
      assert.deepEqual(view(mutantsFor(`const v = value${ws}!;`, [1])), [], `postfix !, ${name}`);
      assert.deepEqual(view(mutantsFor(`const v = obj.return${ws}!;`, [1])), [], `postfix ! after a property, ${name}`);
    }
  });

  test('F10: non-ASCII identifier characters stay identifier characters [R3] [R4]', () => {
    const cases: [source: string, expected: Row[]][] = [
      ['const\u0394();', [ds(1, 1, 'const\u0394();')]],
      ['let\u200c();', [ds(1, 1, 'let\u200c();')]],
      ['var\u200d();', [ds(1, 1, 'var\u200d();')]],
      ['const a = \u00e9 !;', []],
      ['const a = \ud835\udcb3 !;', []],
      ['const a = \ud835\udcb3 !c;', []],
      ['const\ud835\udcb3();', [ds(1, 1, 'const\ud835\udcb3();')]],
      ['const$();', [ds(1, 1, 'const$();')]],
      ['const¶();', []],
      ['const a = $ !c;', []],
      ['\ud835\udcb3!.size;', [ds(1, 1, '\ud835\udcb3!.size;')]],
      ['return\u0301 / 2 === b / c;', [ds(1, 1, 'return\u0301 / 2 === b / c;'), [1, 13, 'negate-equality', '===', '!==']]],
    ];
    for (const [source, expected] of cases) assert.deepEqual(view(mutantsFor(source, every(source))), expected, JSON.stringify(source));
  });

  test('sweep: a line comment and a regex literal end at every line terminator of the language [R4]', () => {
    for (const end of ['\u2028', '\u2029', '\r']) {
      assert.deepEqual(view(mutantsFor(`// x${end}y = a && b;`, [1])), [ds(1, 6, 'y = a && b;'), [1, 12, 'swap-logic', '&&', '||']], JSON.stringify(end));
      assert.deepEqual(view(mutantsFor(`return /oops${end}ok = a && b`, [1])), [[1, 21, 'swap-logic', '&&', '||']], JSON.stringify(end));
    }
  });

  test('sweep: a property named like a keyword does not open a regex; a word after a spread is still a keyword [R4]', () => {
    const cases: [source: string, expected: Row[]][] = [
      ['const a = obj.return / 2 === b / c;', [[1, 26, 'negate-equality', '===', '!==']]],
      ['const a = this.#in / 2 === b / c;', [[1, 24, 'negate-equality', '===', '!==']]],
      ['const a = obj. /* c */ of / 2 === b / c;', [[1, 31, 'negate-equality', '===', '!==']]],
      ['const a = f(...await / === /);', []],
      ['const a = [...typeof / === /];', []],
    ];
    for (const [source, expected] of cases) assert.deepEqual(view(mutantsFor(source, every(source))), expected, source);
  });

  test('sweep: a body after a return type is a block, void included; a brace after a word that starts an expression lists members [R3]', () => {
    const BLOCKS: [source: string, column: number][] = [
      ['function f(): void { if (ok) {} }', 26],
      ['class A { m(): void { if (ok) {} } }', 27],
      ['function f(): T[] { if (ok) {} }', 25],
      ['const c = class B extends f(function (): T { if (ok) {} }) {};', 50],
      ['class B extends a[function (): T { if (ok) {} }] {}', 40],
      ['x = class; function f(): T { if (ok) {} }', 34],
      ['class A ) { if (ok) {} }', 17],
      ['const c = obj.class\n{ if (ok) {} }', 7],
      ['const c = obj.in\n{ if (ok) {} }', 7],
      ["const c = 's'\n{ if (ok) {} }", 7],
      ['x; { if (ok) {} }', 10],
      ['{ { if (ok) {} } }', 9],
      ['{} { if (ok) {} }', 10],
      ['{ lbl: { if (ok) {} } }', 14],
      ['{ x = class } function f(): T { if (ok) {} }', 37],
      ['switch (x) { case 1: {} case 2: { if (ok) {} } }', 39],
    ];
    for (const [source, column] of BLOCKS) assert.deepEqual(conditions(mutantsFor(source, every(source))), forced(source.split('\n').length, column), source);
    const MEMBERS = [
      'const a = typeof { if(ok) {} };',
      'void { if(ok) {} };',
      'case { if(ok) {} }:',
      'const a = x in { if(ok) {} };',
      'for (const a of { if(ok) {} }) y();',
      'const a = new { if(ok) {} };',
      'delete { if(ok) {} };',
      'const a = x instanceof { if(ok) {} };',
      'const a = yield { if(ok) {} };',
      'class A extends m[0] { if(ok: boolean) {} }',
      'class A extends mix(B) { if(ok: boolean) {} }',
    ];
    for (const source of MEMBERS) assert.deepEqual(conditions(mutantsFor(source, every(source))), [], source);
  });

  test('sweep: unbalanced brackets and the first token of the file, read without a throw [R3]', () => {
    assert.deepEqual(view(mutantsFor('if ([) {', [1])), [], 'a closer that does not match the innermost opener');
    assert.deepEqual(view(mutantsFor('if (a', [1])), [], 'an if that never closes');
    assert.deepEqual(view(mutantsFor('if (a]) {', [1])), forced(1, 5, 'a]'), 'a stray closer stays inside the condition');
    assert.deepEqual(view(mutantsFor('if [a] {', [1])), [], 'an if with no parenthesis');
    assert.deepEqual(view(mutantsFor('if (a\n) {', [1])), [], 'a closing parenthesis first on the next line');
    assert.deepEqual(view(mutantsFor('); if (ok) {', [1])), forced(1, 8), 'a closer with nothing open');
    assert.deepEqual(view(mutantsFor('!x;', [1])), [ds(1, 1, '!x;'), dn(1, 1)], 'a ! that opens the file');
    assert.deepEqual(view(mutantsFor('(a)!.b;', [1])), [ds(1, 1, '(a)!.b;')], 'a ) whose ( opens the file');
    assert.deepEqual(view(mutantsFor('const a = ) !y;', [1])), [], 'a ) with no partner is a value');
    assert.deepEqual(view(mutantsFor('const a = } !y;', [1])), [dn(1, 13)], 'a } with no partner is not');
  });

  test('sweep: every control keyword and member spelling around a ! [R3]', () => {
    const cases: [source: string, expected: Row[]][] = [
      ['with (a) !b;', [ds(1, 1, 'with (a) !b;'), dn(1, 10)]],
      ['x.while(a)!.b;', [ds(1, 1, 'x.while(a)!.b;')]],
      ['await (a)!.b;', [ds(1, 1, 'await (a)!.b;')]],
      ['const a = default!.b;', []],
      ['const a = of !(c);', []],
      ['const a = (of !(c));', []],
      ['const a = obj.of !(c);', []],
      ['for (const a of !b) c();', [ds(1, 1, 'for (const a of !b) c();'), dn(1, 17)]],
      ['for await (const a of !b) c();', [ds(1, 1, 'for await (const a of !b) c();'), dn(1, 23)]],
      ['(a) !b;', [ds(1, 1, '(a) !b;')]],
      ['await (a) !b;', [ds(1, 1, 'await (a) !b;')]],
      ['if await (a) !b;', [ds(1, 1, 'if await (a) !b;')]],
      ['x.while(a) !b;', [ds(1, 1, 'x.while(a) !b;')]],
      ["const a = 's' !b;", []],
      ['const a = { b: 1 } !c;', []],
      ['const a = b! !c;', []],
      ['const a = x.default!;', []],
    ];
    for (const [source, expected] of cases) assert.deepEqual(view(mutantsFor(source, [1])), expected, source);
  });

  test('sweep: a private name is a member, so true, false and if after # are never mutated [R3]', () => {
    assert.deepEqual(view(mutantsFor('const a = this.#true;\nconst b = this.#false;', [1, 2])), []);
    assert.deepEqual(view(mutantsFor('this.#if(ok);', [1])), [ds(1, 1, 'this.#if(ok);')]);
  });
});

describe('R3 decision 1 repairs (card T1-VERIFY-MUTANT-GEN-2)', () => {
  const ds = (line: number, column: number, original: string): Row => [line, column, 'drop-statement', original, ''];
  const dn = (line: number, column: number): Row => [line, column, 'drop-not', '!', ''];
  const conditions = (ms: Mutant[]) => view(ms).filter((row) => row[2] === 'force-true' || row[2] === 'force-false');
  const forced = (line: number, column: number): Row[] => [
    [line, column, 'force-true', 'ok', 'true'],
    [line, column, 'force-false', 'ok', 'false'],
  ];
  const noCondition = (sources: string[]) => {
    for (const source of sources) assert.deepEqual(conditions(mutantsFor(source, every(source))), [], source);
  };
  const conditionAt = (cases: [source: string, line: number, column: number][]) => {
    for (const [source, line, column] of cases) assert.deepEqual(conditions(mutantsFor(source, every(source))), forced(line, column), source);
  };

  describe('F2: the tab git writes after a path holding whitespace', () => {
    const spaced = (name: string, hunk = '@@ -0,0 +1 @@\n+a();\n') => `diff --git a/${name} b/${name}\n--- a/${name}\t\n+++ b/${name}\t\n${hunk}`;

    test('it is no part of the path, in a plain and a \\r\\n diff and beside another file [R1]', () => {
      assert.deepEqual(changedSourceLines(spaced('src/a b.ts')), [{ file: 'src/a b.ts', lines: [1] }]);
      assert.deepEqual(changedSourceLines(spaced('src/a b.ts').replaceAll('\n', '\r\n')), [{ file: 'src/a b.ts', lines: [1] }]);
      const second = 'diff --git a/src/c.ts b/src/c.ts\n--- a/src/c.ts\n+++ b/src/c.ts\n@@ -0,0 +2 @@\n+b();\n';
      assert.deepEqual(changedSourceLines(spaced('src/a b.ts') + second), [{ file: 'src/a b.ts', lines: [1] }, { file: 'src/c.ts', lines: [2] }]);
    });

    test('the path filters read the name without it, and only one final tab is the delimiter [R1]', () => {
      for (const name of ['src/a b.d.ts', 'src/a b.test.ts', 'docs/a b.ts', 'src/a b.md']) assert.deepEqual(changedSourceLines(spaced(name)), [], name);
      assert.deepEqual(changedSourceLines('diff --git a/src/a b.ts b/src/a b.ts\n--- a/src/a b.ts\t\n+++ /dev/null\n@@ -1 +0,0 @@\n-a();\n'), [], 'a deleted file');
      for (const header of ['+++ b/src/a.ts\t\t', '+++ b/src/a.ts\tx', '+++ b/src/\ta.ts']) {
        assert.deepEqual(changedSourceLines(`diff --git a/x b/x\n--- a/x\n${header}\n@@ -0,0 +1 @@\n+a();\n`), [], JSON.stringify(header));
      }
    });
  });

  test('F3: a function body after any return type is a block, whatever word ends the type [R3]', () => {
    conditionAt([
      ['function f(): string | void { if (ok) {} }', 1, 35],
      ['function f(): A & void { if (ok) {} }', 1, 30],
      ['function f(): () => void { if (ok) {} }', 1, 32],
      ['function f(x): x is void { if (ok) {} }', 1, 32],
      ['function f(): T extends U ? void : void { if (ok) {} }', 1, 47],
      ['function f(): { a: 1 } | void { if (ok) {} }', 1, 37],
      ['function f(): Array<void> | void { if (ok) {} }', 1, 40],
      ['function* g<T>(): string | void { if (ok) {} }', 1, 39],
      ['function f(): of { if (ok) {} }', 1, 24],
      ['x = function (): string | void { if (ok) {} };', 1, 38],
      ['class A { m(): string | void { if (ok) {} } }', 1, 36],
      ['const o = { m(): string | void { if (ok) {} } };', 1, 38],
      ['const o = { m: function (): A & void { if (ok) {} } };', 1, 44],
      ['class A { [k](): string | void { if (ok) {} } }', 1, 38],
      ["class A { 'a'(): string | void { if (ok) {} } }", 1, 38],
    ]);
  });

  test('F3: void and the operators before it stay an expression where no return type holds them [R3]', () => {
    noCondition([
      'const a = void { if(ok) {} };',
      'const a = b | void { if(ok) {} };',
      'const a = b & void { if(ok) {} };',
      'const a = () => void { if(ok) {} };',
      'const a = c ? d : void { if(ok) {} };',
      'const a = c ? (d) : void { if(ok) {} };',
      'const a = c ? f(d) : void { if(ok) {} };',
      'g(c ? d : void { if(ok) {} });',
      'return c ? d : void { if(ok) {} };',
      'const a = [c ? d : void { if(ok) {} }];',
      'c ? (d) : void { if(ok) {} };',
      'declare function m(): a; void { if(ok) {} };',
      'function f(): T { void { if(ok) {} }; }',
      'function f(): T (void { if(ok) {} });',
      'function f(): T [void { if(ok) {} }];',
      'function f(): a) void { if(ok) {} };',
      'declare function f(): T\nconst a = void { if(ok) {} };',
    ]);
  });

  test('F4: a type group in a heritage clause or a type parameter keeps the class head [R3]', () => {
    noCondition([
      'class C extends B<{x: number}> { if(ok: boolean) {} }',
      'class C implements I<{x: number}> { if(ok: boolean) {} }',
      'interface I extends J<{x: number}> { if(ok: boolean): void; }',
      'class C<T extends {x: number}> { if(ok: boolean) {} }',
      'class C<T = {x: number}> { if(ok: boolean) {} }',
      'class C extends B<D<{x: 1}>> { if(ok: boolean) {} }',
      'class C extends B<{x: 1}[]> { if(ok: boolean) {} }',
      'class C extends B<() => {x: 1}> { if(ok: boolean) {} }',
      'class C extends B<{x: 1}> implements D<{y: 2}>, E { if(ok: boolean) {} }',
      'const C = class<T extends {x: 1}> { if(ok: boolean) {} };',
      'export default class<T extends {x: 1}> { if(ok: boolean) {} }',
      'abstract class C extends B<{x: 1}> { abstract if(ok: boolean): void; }',
      'interface I<T extends {x: 1}> extends J { if(ok: boolean): void; }',
      'class C extends B<{ m(a: { b: 1 }): void; }> { if(ok: boolean) {} }',
      'class C extends B<{x: 1}>\n{ if(ok: boolean) {} }',
    ]);
  });

  test('F4: a brace after a type group stays a block where no class heads the statement [R3]', () => {
    conditionAt([
      ['class A<T> {} function f<T extends {a: 1}>() { if (ok) {} }', 1, 52],
      ['class A {} const g = (a: Array<{b: 1}>) => { if (ok) {} };', 1, 50],
      ['class A<T extends {a: 1}> { m(): Foo<{a: 1}> { if (ok) {} } }', 1, 52],
      ['class A {}\nconst x = a < b\n{ if (ok) {} }', 3, 7],
    ]);
  });

  test('F5: a Unicode escape is part of its identifier in scanner and tokens, in declarations and references [R3]', () => {
    const cases: [source: string, expected: Row[]][] = [
      ['const a = true\\u0061;', []],
      ['const a = true\\u{61};', []],
      ['const true\\u0061 = 1;', []],
      ['const false\\u{61} = 1;', []],
      ['x = false\\u0061;', [ds(1, 1, 'x = false\\u0061;')]],
      ['x = \\u0061true;', [ds(1, 1, 'x = \\u0061true;')]],
      ['x = \\u{61}true;', [ds(1, 1, 'x = \\u{61}true;')]],
      ['x = true\\u{1d49c};', [ds(1, 1, 'x = true\\u{1d49c};')]],
      ['x = true\\u00E9;', [ds(1, 1, 'x = true\\u00E9;')]],
      ['x = true\\u{00061};', [ds(1, 1, 'x = true\\u{00061};')]],
      ['const a = \\u{61} / 2 === b / c;', [[1, 22, 'negate-equality', '===', '!==']]],
      ['const a = \\u{00061} / 2 === b / c;', [[1, 25, 'negate-equality', '===', '!==']]],
      ['x = \\u{61}return / 2 === b / c;', [ds(1, 1, 'x = \\u{61}return / 2 === b / c;'), [1, 22, 'negate-equality', '===', '!==']]],
      ['if\\u0061 (ok) {', []],
      ['const a = \\u0061 !c;', []],
      ['const a = \\u{61} !c;', []],
      ['const a = b\\u0061 !c;', []],
      ['const a = !\\u0061;', [dn(1, 11)]],
      ['const a = b\n!\\u0061;', [ds(2, 1, '!\\u0061;'), dn(2, 1)]],
      ['const\\u0061();', [ds(1, 1, 'const\\u0061();')]],
      ['return\\u{61}();', [ds(1, 1, 'return\\u{61}();')]],
      ['return\\u0061 / 2 === b / c;', [ds(1, 1, 'return\\u0061 / 2 === b / c;'), [1, 18, 'negate-equality', '===', '!==']]],
      ['const a = `${x\\u{61}} ${y}` && z;', [[1, 29, 'swap-logic', '&&', '||']]],
    ];
    for (const [source, expected] of cases) assert.deepEqual(view(mutantsFor(source, every(source))), expected, source);
  });

  test('F5: text that is no identifier escape ends the word [R3]', () => {
    for (const source of ['true\\u0020;', 'true\\u00;', 'true\\u61;', 'true\\u{};', 'true\\u{110000};', 'true\\x61;', 'true\\u{g};']) {
      assert.deepEqual(view(mutantsFor(source, [1])), [ds(1, 1, source), [1, 1, 'flip-boolean', 'true', 'false']], source);
    }
  });

  test('F6: a whole statement that opens with a literal is dropped [R3]', () => {
    const cases: [source: string, expected: Row[]][] = [
      ["'use strict';", [ds(1, 1, "'use strict';")]],
      ['"use strict";', [ds(1, 1, '"use strict";')]],
      ['/a/.test(x);', [ds(1, 1, '/a/.test(x);')]],
      ['`t`.length;', [ds(1, 1, '`t`.length;')]],
      ['`a${b}`.c();', [ds(1, 1, '`a${b}`.c();')]],
      ['  /a/.test(x); // c', [ds(1, 3, '/a/.test(x);')]],
      ['/* c */ "x";', [ds(1, 9, '"x";')]],
      ["'a'.b(c) && d;", [ds(1, 1, "'a'.b(c) && d;"), [1, 10, 'swap-logic', '&&', '||']]],
    ];
    for (const [source, expected] of cases) assert.deepEqual(view(mutantsFor(source, every(source))), expected, source);
  });

  test('F6: the rest of a literal from an earlier line, an open bracket and a line with no ; stay out [R3]', () => {
    const cases: [source: string, expected: Row[]][] = [
      ['`a\n`;', []],
      ['`a\n${b}`;', []],
      ['`a${b}\n`;', []],
      ["'a\\\n';", []],
      ["`${\n'a'}`;", []],
      ['`${\n`b`}`;', []],
      ['/* a\n */ `b\n`;', []],
      ['`a\nb`.c();\n`d`;', [ds(3, 1, '`d`;')]],
      ["'a' + (b;", []],
      ["'a'", []],
      ["'a;", []],
      ['`a;', []],
    ];
    for (const [source, expected] of cases) assert.deepEqual(view(mutantsFor(source, every(source))), expected, JSON.stringify(source));
  });
});

describe('docs (card T1-VERIFY-MUTANT-GEN)', () => {
  const OPERATIONS = [
    '`src/review/mutant-gen.ts` (card T1-VERIFY-MUTANT-GEN) lists the mutants of the source lines a change adds; it is pure, reads no file and runs nothing, and the command that runs the mutants under a card\'s DoD arrives with card T1-VERIFY-MUTANTS.',
    '`changedSourceLines(diff)` reads a `git diff --unified=0` text and returns, for each file under `src/` that ends in `.ts` but not in `.d.ts` or `.test.ts`, the new-side line numbers of its added lines in ascending order; a deleted file, a file whose hunks only delete and a path git quoted get no entry, and an empty diff, text outside a `diff --git` section, a hunk header it cannot read (a coordinate that is not a safe integer, a non-empty side starting below line 1), a hunk whose `+` and `-` lines do not match its counts or a line after the hunks that is neither a hunk header nor a `\\ No newline` marker leaves the file without an entry, so no mutant is ever generated over a whole file.',
    '`mutantsFor(source, changedLines)` returns the mutants of those lines, each with its 1-based line and column (in UTF-16 code units), its operator, its original and mutated text and its source offsets, ordered by line, column and operator; `applyMutant(source, mutant)` replaces exactly that span and refuses a source whose span no longer holds the original text.',
    'The mutation operators, in run order, are `drop-statement`, `force-true`, `force-false`, `negate-equality`, `swap-logic`, `drop-not`, `boundary` and `flip-boolean`; an operator counts only in code, never inside a comment, a string, a template literal or a regex literal.',
    '`drop-statement` removes the code of a line that ends with `;`, balances `()`, `[]` and `{}` within the line and does not begin with `const`, `let`, `var`, `return`, `import`, `export`, `type`, `interface` or `declare`; the code starts after any leading whitespace and comment, which stay in place.',
    '`force-true` and `force-false` replace the condition of an `if (...)` whose closing parenthesis is on the same line with `true` and with `false`, never the argument of a member named `if` (`obj.if(...)`).',
    '`negate-equality` swaps `===` with `!==` and `==` with `!=`, `swap-logic` swaps `&&` with `||`, and `boundary` swaps `<` with `<=` and `>` with `>=`; each counts only with whitespace (a space, a tab or a line break) or the start or end of the input on both sides, so a generic such as `Array<string>` and a comparison written without spaces (`a<b`) are never mutated.',
    '`drop-not` removes a unary `!`, never the `!` of `!=` or `!==` nor a non-null assertion after an identifier, `)` or `]`, and `flip-boolean` swaps the words `true` and `false` where no `.` precedes them; both read what precedes the token across whitespace, comments and line ends, and a `!` after a word that starts an expression (`return`, `typeof` and the other words of the regex rule) is unary.',
    'An in-house scanner reads the whole file once (no new dependency), takes operator tokens greedily, so `=>`, `<<`, `>>`, `>>>`, `<<=`, `>>=`, `??`, `&&=` and `||=` never match, and treats the `\\r` of a `\\r\\n` line end as whitespace, so no mutant span holds it.',
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
