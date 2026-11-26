// Card T0-REVIEW-DIFF-DELETE (issue 517): the R2 and R3 review diff shows a deleted file by its header only, so a card that
// deletes tracked data files is not refused at the cap for content it removes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { countDiffLines } from '../../src/core/review-effort.ts';
import { runSync } from '../../src/probes/exec.ts';
import { collectCandidateDiff } from '../../src/review/pre-review.ts';
import { tmpDir } from '../infra/helpers.ts';

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

/** A repository with its own git settings, so the user's configuration never changes the diff. */
function repo(): { dir: string; git: (...args: string[]) => string; write: (rel: string, text: string) => void; commit: (message: string) => string } {
  const dir = tmpDir('aidlc-diff-delete-');
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  for (const [key, value] of [['core.autocrlf', 'false'], ['diff.renames', 'false'], ['user.name', 't'], ['user.email', 't@example.invalid'], ['commit.gpgsign', 'false']]) git('config', key!, value!);
  const write = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text, 'utf8');
  };
  const commit = (message: string) => {
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD').trim();
  };
  return { dir, git, write, commit };
}

const BIG = Array.from({ length: 2000 }, (_, i) => `corpus line ${i} with some text to delete`).join('\n') + '\n';

/** A base with a large data file and a source file; a candidate that deletes the data file and changes one source line. */
function deletion() {
  const r = repo();
  r.write('data/big.txt', BIG);
  r.write('src/a.ts', 'export const a = 1;\nexport const b = 2;\n');
  const base = r.commit('base');
  r.git('rm', '-q', 'data/big.txt');
  r.write('src/a.ts', 'export const a = 1;\nexport const b = 3;\n');
  const head = r.commit('candidate');
  return { ...r, base, head };
}

test('a deleted file is its header only: the diff fits the cap, the changed file keeps its hunk [R1] [R2]', () => {
  const r = deletion();
  // The case of issue 517: the whole diff with the deleted body is above the cap.
  const whole = r.git('diff', '--text', `${r.base}...${r.head}`, '--no-color', '--no-ext-diff', '--no-textconv');
  assert.ok(Buffer.byteLength(whole, 'utf8') > 4096, `without the option the diff is ${Buffer.byteLength(whole, 'utf8')} bytes`);
  const got = collectCandidateDiff(runSync, r.dir, r.base, 4096, r.head);
  assert.ok(got.diff.includes('diff --git a/data/big.txt b/data/big.txt'), got.diff);
  assert.ok(got.diff.includes('deleted file mode'), got.diff);
  assert.ok(!got.diff.includes('corpus line'), 'no line of the deleted content');
  assert.ok(!got.diff.includes('--- a/data/big.txt'), 'no hunk header for the deleted file');
  assert.ok(got.diff.includes('-export const b = 2;') && got.diff.includes('+export const b = 3;'), got.diff);
  assert.deepEqual(got.changedPaths, ['data/big.txt', 'src/a.ts']);
  assert.equal(got.bytes, Buffer.byteLength(got.diff, 'utf8'));
});

test('the effort line count reads the changed file only; added and NUL-byte files keep their hunks [R1] [R2]', () => {
  const r = deletion();
  const got = collectCandidateDiff(runSync, r.dir, r.base, 4096, r.head);
  assert.equal(countDiffLines(got.diff), 2);
  const a = repo();
  a.write('src/keep.ts', 'x\n');
  a.write('src/zero.bin', 'a\u0000b\n');
  const base = a.commit('base');
  a.write('src/new.ts', 'export const added = true;\n');
  a.write('src/zero.bin', 'a\u0000c\n');
  const head = a.commit('candidate');
  const added = collectCandidateDiff(runSync, a.dir, base, 4096, head);
  assert.ok(added.diff.includes('+export const added = true;'), added.diff);
  assert.ok(added.diff.includes('+a\u0000c'), 'the NUL-byte file shows its hunk under --text');
  assert.ok(!added.diff.includes('Binary files'), added.diff);
  assert.deepEqual(added.changedPaths, ['src/new.ts', 'src/zero.bin']);
});
