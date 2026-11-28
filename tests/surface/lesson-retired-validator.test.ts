import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { lessonRetirements, matchedLessons, readLessons, reviewLessons } from '../../src/artifacts/lessons.ts';
import { tmpDir } from '../infra/helpers.ts';

// The fixture of T0-LESSON-ACTIVE-VIEW acceptance 1: A, B, A again, D, N at lines 1 to 5.
const A = '- 2026-01-01 T0-A: ALWAYS call `fooBar` in `src/foo/bar.ts` before a write (source: PR 1)';
const B = '- 2026-01-02 T0-B: NEVER call `bazQux` twice (source: PR 2)';
const D = '- 2026-01-04 T0-D: ALWAYS check the result of `fooBar` in `src/foo/bar.ts` and in each caller (source: PR 4)';
const N = '- 2026-01-05 T0-N: NOTE the rule of T0-A is replaced by the rule of T0-D (source: PR 5)';
const LESSONS = [A, B, A, D, N].join('\n');
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const ENTRY = `- 2026-01-06 RETIRE 2026-01-01 T0-A ${sha(A)} BY 2026-01-05 T0-N ${sha(N)}: T0-D supersedes T0-A`;

// One entry line per failed check of R2, in the order R2 names the checks.
const FAILING: [string, string][] = [
  ['format', `- 2026-01-06 RETIRE 2026-01-01 T0-A ${sha(A).toUpperCase()} BY 2026-01-05 T0-N ${sha(N)}: upper-case hash`],
  ['old line', `- 2026-01-06 RETIRE 2026-01-01 T0-A ${sha('no such line')} BY 2026-01-05 T0-N ${sha(N)}: unknown old line`],
  ['replacement', `- 2026-01-06 RETIRE 2026-01-01 T0-A ${sha(A)} BY 2026-01-05 T0-N ${sha('no such line')}: unknown replacement`],
  ['date or ref', `- 2026-01-06 RETIRE 2026-01-01 T0-X ${sha(A)} BY 2026-01-05 T0-N ${sha(N)}: wrong old ref`],
  ['date or ref', `- 2026-01-06 RETIRE 2026-01-01 T0-A ${sha(A)} BY 2026-01-09 T0-N ${sha(N)}: wrong new date`],
  ['order', `- 2026-01-06 RETIRE 2026-01-01 T0-A ${sha(A)} BY 2026-01-02 T0-B ${sha(B)}: replacement before the last old line`],
];

test('T0-LESSON-ACTIVE-VIEW acceptance 3: a resolving entry names the old lines and the replacement by line number and retires the old text [R1] [R2]', () => {
  assert.deepEqual(lessonRetirements(LESSONS, `# Retired\n\n${ENTRY}\n`), { retired: new Set([A]), entries: [{ line: 3, old: [1, 3], by: 5 }], problems: [] });
});

test('T0-LESSON-ACTIVE-VIEW acceptance 3: each failed check gives one problem naming that check and retires nothing [R2]', () => {
  for (const [check, line] of FAILING) {
    assert.deepEqual(lessonRetirements(LESSONS, line), { retired: new Set(), entries: [], problems: [{ line: 1, check }] }, line);
  }
  assert.deepEqual(lessonRetirements(LESSONS, FAILING.map(([, line]) => line).join('\n')).problems.map((p) => p.line), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(lessonRetirements(LESSONS, 'RETIRE text that is not an entry line\n'), { retired: new Set(), entries: [], problems: [] });
});

test('T0-LESSON-ACTIVE-VIEW acceptance 3: with only unresolved entries, every delivery path gives what it gives with no retired file [R2] [R3]', () => {
  const dir = tmpDir('aidlc-retired-check-');
  try {
    mkdirSync(path.join(dir, 'docs'));
    const file = path.join(dir, 'docs', 'LESSONS.md');
    writeFileSync(file, `${LESSONS}\n`);
    const input = { changedPaths: [], diff: '+ fooBar(); bazQux();', history: [] };
    const deliver = () => ({ read: readLessons(file, 3), review: reviewLessons(file, 200), matched: matchedLessons(file, input, 120) });
    const without = deliver();
    writeFileSync(path.join(dir, 'docs', 'LESSONS-RETIRED.md'), `${FAILING.map(([, line]) => line).join('\n')}\n`);
    assert.deepEqual(deliver(), without);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T0-LESSON-ACTIVE-VIEW acceptance 3: two identical resolving entry lines are two entries [R1]', () => {
  const { entries, problems } = lessonRetirements(LESSONS, `${ENTRY}\n${ENTRY}\n`);
  assert.deepEqual(entries, [{ line: 1, old: [1, 3], by: 5 }, { line: 2, old: [1, 3], by: 5 }]);
  assert.deepEqual(problems, []);
});
