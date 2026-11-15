// Card T1-FINDING-IDENTITY: the identity of a formal finding, computed from its cited path, its class or dimension and the
// whitespace-normalised cited lines, and stored by recordFindings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Namespace import: the function is new, so each test fails at its first call rather than at link time.
import * as policy from '../../src/core/review-policy.ts';

type ReadLines = (file: string, from: number, to: number) => string[] | undefined;
type Identity = (reason: string, readLines: ReadLines) => string | undefined;
const identity = (reason: string, readLines: ReadLines): string | undefined => (policy as unknown as { findingIdentity: Identity }).findingIdentity(reason, readLines);

/** A candidate commit as a map of file to lines; a file absent from it cannot be read. */
const tree = (files: Record<string, string[]>): ReadLines => (file, from, to) => files[file]?.slice(from - 1, to);

// Worked examples, the first 16 hex characters of sha256 over `<file>\n<category>\n<text>`, computed once by hand:
// sha256('src/a.ts\n3\nconst x = 1;\nreturn x + 2;') and sha256('src/a.ts\nnull-check\nconst x = 1;\nreturn x + 2;').
const DIM3 = 'f07faa102466a5d4';
const CLASS = '942f491acb42fd4b';

const CODE = tree({ 'src/a.ts': ['const x = 1;', 'return x + 2;', 'export {};'], 'src/b.ts': ['const x = 1;', 'return x + 2;'] });

test('T1-FINDING-IDENTITY acceptance 1: the identity hashes path, category and whitespace-normalised cited lines', () => {
  assert.equal(identity('[spec] 3 correctness @ src/a.ts:1-2: wrong -> fix', CODE), DIM3, 'dimension 3 over lines 1 and 2');
  const messy = tree({ 'src/a.ts': ['   const   x =\t1;  ', '', '  ', '\treturn x  +  2;'] });
  assert.equal(identity('[spec] 3 correctness @ src/a.ts:1-4: wrong -> fix', messy), DIM3, 'other indentation, inner white space and blank lines give the same identity');
  assert.equal(identity('[spec] 3 correctness (class: null-check) @ src/a.ts:1-2: wrong -> fix', CODE), CLASS, 'the class is the category');
  assert.equal(identity('[spec] 4 tests (class: null-check) @ src/a.ts:1-2: wrong -> fix', CODE), CLASS, 'the class wins over the dimension');
  assert.equal(identity('[spec] [P0] 3 correctness @ src/a.ts:1-2: wrong -> fix', CODE), DIM3, 'an axis tag and a severity tag are skipped');
  assert.equal(identity('[P2] 3 correctness @ src/a.ts:1-2: wrong -> fix', CODE), DIM3, 'a severity tag opening the reason is skipped');
  assert.equal(identity('[standards] 3 naming @ src/a.ts:1-2: wrong -> fix', CODE), DIM3, 'an axis tag alone is skipped');
  const others = [
    ['another file', '[spec] 3 correctness @ src/b.ts:1-2: wrong -> fix'],
    ['another class', '[spec] 3 correctness (class: bounds) @ src/a.ts:1-2: wrong -> fix'],
    ['another dimension number', '[spec] 4 tests @ src/a.ts:1-2: wrong -> fix'],
    ['another line text', '[spec] 3 correctness @ src/a.ts:2-3: wrong -> fix'],
  ];
  for (const [what, reason] of others) {
    const got = identity(reason!, CODE);
    assert.match(got ?? '', /^[0-9a-f]{16}$/, `${what}: an identity`);
    assert.notEqual(got, DIM3, `${what} gives another identity`);
  }
});

test('T1-FINDING-IDENTITY acceptance 2: no identity without a file, a line, readable lines or text; a range is cut to 40 lines', () => {
  assert.equal(identity('[spec] 3 correctness: wrong -> fix', CODE), undefined, 'no file');
  assert.equal(identity('[spec] 3 correctness @ src/a.ts: wrong -> fix', CODE), undefined, 'no line');
  assert.equal(identity('[spec] 3 correctness @ src/gone.ts:1: wrong -> fix', CODE), undefined, 'readLines returns undefined');
  assert.equal(identity('[spec] 3 correctness @ src/blank.ts:1-3: wrong -> fix', tree({ 'src/blank.ts': ['', '  ', '\t'] })), undefined, 'only blank lines: no text');
  const long = tree({ 'src/long.ts': Array.from({ length: 100 }, (_, i) => `line ${i + 1};`) });
  const forty = identity('[spec] 3 correctness @ src/long.ts:5-44: wrong -> fix', long);
  assert.match(forty ?? '', /^[0-9a-f]{16}$/);
  assert.equal(identity('[spec] 3 correctness @ src/long.ts:5-100: wrong -> fix', long), forty, 'lines 5 to 100 are cut to lines 5 to 44');
  assert.notEqual(identity('[spec] 3 correctness @ src/long.ts:5-43: wrong -> fix', long), forty, 'lines 5 to 43 are another text');
  assert.notEqual(identity('[spec] 3 correctness @ src/long.ts:5: wrong -> fix', long), forty, 'a single line is the line alone');
  assert.equal(identity('[spec] 3 correctness @ src/long.ts:7: wrong -> fix', long), identity('[spec] 3 correctness @ src/long.ts:7-7: wrong -> fix', long), ':n is the range n to n');
});

test('T1-FINDING-IDENTITY acceptance 3: recordFindings stores the identity of new findings and keeps it on a re-raise', () => {
  const r1 = '[spec] 3 correctness @ src/a.ts:1: wrong -> fix';
  const r2 = '[spec] 6 tests @ src/a.ts:2: untested -> test it';
  const first = policy.recordFindings([], { stage: 'formal', round: 1, candidateSha: 'sha1', at: '2026-11-16T00:00:00.000Z', outcome: 'block', reasons: [r1, r2], identities: { [r1]: 'aaaaaaaaaaaaaaaa' } } as policy.RecordFindingsInput);
  assert.deepEqual(first.findings.map((f) => [f.id, (f as { identity?: string }).identity]), [['F1', 'aaaaaaaaaaaaaaaa'], ['F2', undefined]], 'the identity of the reason the map holds; none for another');
  assert.ok(!('identity' in first.findings[1]!), 'a finding without an identity carries no identity field');
  const again = `${r1} re:F1`;
  const second = policy.recordFindings(first.findings, { stage: 'formal', round: 2, candidateSha: 'sha2', at: '2026-11-16T01:00:00.000Z', outcome: 'block', reasons: [again], identities: { [again]: 'bbbbbbbbbbbbbbbb' } } as policy.RecordFindingsInput);
  assert.deepEqual(second.reraised, ['F1']);
  assert.equal((second.findings.find((f) => f.id === 'F1') as { identity?: string }).identity, 'aaaaaaaaaaaaaaaa', 'a re-raise keeps the identity of the finding');
});
