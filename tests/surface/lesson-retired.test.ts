import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findLesson, hasLesson, matchedLessons, parseLessonLine, readLessons, reviewLessons } from '../../src/artifacts/lessons.ts';
import { loadContextPack } from '../../src/loop/context-pack.ts';
import { makeFixture, writeCard } from '../scenarios/_harness.ts';
import { tmpDir } from '../infra/helpers.ts';

// The fixture of acceptance 1: A, B, A again, D, N; one entry retires A by N.
const A = '- 2026-01-01 T0-A: ALWAYS call `fooBar` in `src/foo/bar.ts` before a write (source: PR 1)';
const B = '- 2026-01-02 T0-B: NEVER call `bazQux` twice (source: PR 2)';
const D = '- 2026-01-04 T0-D: ALWAYS check the result of `fooBar` in `src/foo/bar.ts` and in each caller (source: PR 4)';
const N = '- 2026-01-05 T0-N: NOTE the rule of T0-A is replaced by the rule of T0-D (source: PR 5)';
const LESSONS = [A, B, A, D, N];
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const ENTRY = `- 2026-01-06 RETIRE 2026-01-01 T0-A ${sha(A)} BY 2026-01-05 T0-N ${sha(N)}: T0-D supersedes T0-A`;
const bytes = (line: string) => Buffer.byteLength(line, 'utf8') + 1;
const DIFF = { changedPaths: [], diff: '+ fooBar(); bazQux();', history: [] };

function withDocs(retired: string | undefined, body: (file: string) => void): void {
  const dir = tmpDir('aidlc-retired-');
  try {
    mkdirSync(path.join(dir, 'docs'));
    const file = path.join(dir, 'docs', 'LESSONS.md');
    writeFileSync(file, `${LESSONS.join('\n')}\n`);
    if (retired !== undefined) writeFileSync(path.join(dir, 'docs', 'LESSONS-RETIRED.md'), `# Retired lessons\n\n${retired}\n`);
    body(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('T0-LESSON-ACTIVE-VIEW acceptance 1: readLessons counts and lists only the lines no entry retires [R3]', () => {
  withDocs(ENTRY, (file) => {
    assert.deepEqual(readLessons(file, 3), { file, count: 3, recent: [B, D, N] });
  });
});

test('T0-LESSON-ACTIVE-VIEW acceptance 1: reviewLessons fills the cap with the active rules and counts the omitted ones over them [R3]', () => {
  withDocs(ENTRY, (file) => {
    assert.deepEqual(reviewLessons(file, bytes(D) + bytes(B)), { lines: [D, B], omitted: 0 });
  });
});

test('T0-LESSON-ACTIVE-VIEW acceptance 1: matchedLessons scores the active rules only, so a retired copy does not lower the idf of a term [R3]', () => {
  withDocs(ENTRY, (file) => {
    assert.deepEqual(matchedLessons(file, DIFF, bytes(D)), { lines: [D], omitted: 1, matched: true });
  });
});

test('T0-LESSON-ACTIVE-VIEW acceptance 2: loadContextPack leaves out the retired lines and a missing retired file is no missing source [R4]', () => {
  const fx = makeFixture();
  try {
    mkdirSync(path.join(fx.tmp, 'docs'));
    writeFileSync(path.join(fx.tmp, 'docs/LESSONS.md'), `# Lessons\n${LESSONS.join('\n')}\n`);
    writeFileSync(path.join(fx.tmp, 'docs/LESSONS-RETIRED.md'), `${ENTRY}\n`);
    writeCard(fx, { id: 'T1-PACK', title: 'retired lessons', allowPaths: ['src/foo/bar.ts'] });
    const card = { ...fx.card('T1-PACK'), plan_ref: undefined };
    assert.deepEqual(JSON.parse(loadContextPack(card, fx.tmp, [])).lessons, [D]);
    rmSync(path.join(fx.tmp, 'docs/LESSONS-RETIRED.md'));
    const pack = JSON.parse(loadContextPack(card, fx.tmp, []));
    assert.deepEqual(pack.lessons, [A, A, D]);
    assert.deepEqual(pack.missingSources, ['plan_ref']);
  } finally { fx.cleanup(); }
});

test('T0-LESSON-ACTIVE-VIEW acceptance 2: a retired file that is a link resolving elsewhere refuses loading [R4]', (t) => {
  const fx = makeFixture();
  try {
    mkdirSync(path.join(fx.tmp, 'docs'));
    mkdirSync(path.join(fx.tmp, 'private'));
    writeFileSync(path.join(fx.tmp, 'docs/LESSONS.md'), `# Lessons\n${LESSONS.join('\n')}\n`);
    writeFileSync(path.join(fx.tmp, 'private/secret.md'), 'private material');
    writeCard(fx, { id: 'T1-PACK', title: 'retired lessons', allowPaths: ['src/foo/bar.ts'] });
    try {
      symlinkSync(path.join(fx.tmp, 'private'), path.join(fx.tmp, 'docs/LESSONS-RETIRED.md'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      t.skip(`links cannot be made here: ${(error as NodeJS.ErrnoException).code}`);
      return;
    }
    assert.throws(() => loadContextPack({ ...fx.card('T1-PACK'), plan_ref: undefined }, fx.tmp, []), /lesson source resolves outside its allowed location/);
  } finally { fx.cleanup(); }
});

test('T0-LESSON-ACTIVE-VIEW acceptance 4: findLesson and hasLesson still read the retired line, so a repeated close appends nothing [R5]', () => {
  withDocs(ENTRY, (file) => {
    assert.equal(findLesson(file, parseLessonLine(A)!), A);
    assert.equal(hasLesson(file, A), true);
  });
});
