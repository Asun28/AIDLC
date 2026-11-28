// Card T0-LESSON-RETIRE: `aidlc lessons retire` appends one validated entry to LESSONS-RETIRED.md of the checkout it runs in,
// `appendRetirement` only appends, and `aidlc doctor` reports the main checkout's entries and problems.
import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs, { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lessons from '../../src/artifacts/lessons.ts';
import { cleanup, tmpDir } from '../infra/helpers.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = path.join(ROOT, 'src', 'cli', 'main.ts');
const dirs: string[] = [];
after(() => {
  for (const dir of dirs) cleanup(dir);
});
const fresh = (): string => {
  const dir = tmpDir('aidlc-retire-');
  dirs.push(dir);
  return dir;
};
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

// The worktree's lessons: A, B, C, N at lines 3 to 6. The main checkout holds other lines at those numbers.
const A = '- 2026-01-01 T0-A: ALWAYS check `fooBar` before a write (source: PR 1)';
const B = '- 2026-01-02 T0-B: NEVER call `bazQux` twice (source: PR 2)';
const C = '- 2026-01-03 T0-C: NOTE the bench reads the checkout root (source: PR 3)';
const N = '- 2026-01-05 T0-N: NOTE the rules of T0-A, T0-B and T0-C are replaced (source: PR 5)';
const MA = '- 2026-02-01 T0-MA: ALWAYS read main first (source: PR 11)';
const MB = '- 2026-02-02 T0-MB: NEVER write main twice (source: PR 12)';
const MC = '- 2026-02-03 T0-MC: NOTE main has its own lines (source: PR 13)';
const MN = '- 2026-02-05 T0-MN: NOTE main replaces its lines (source: PR 15)';
const entryOf = (date: string, old: string, by: string, reason: string): string => {
  const o = lessons.parseLessonLine(old)!;
  const n = lessons.parseLessonLine(by)!;
  return `- ${date} RETIRE ${o.date} ${o.ref} ${sha(old)} BY ${n.date} ${n.ref} ${sha(by)}: ${reason}`;
};
const RETIRED_HEAD = '# Retired lessons\n\n';

function env(dir: string, state: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.toUpperCase().startsWith('GIT_') && key.toUpperCase() !== 'NODE_OPTIONS') out[key] = value;
  out['GIT_CEILING_DIRECTORIES'] = [path.dirname(dir), path.dirname(realpathSync.native(dir))].join(path.delimiter);
  out['AIDLC_STATE_DIR'] = state;
  out['AIDLC_SESSION'] = 'lesson-retire-test';
  return out;
}
function aidlc(cwd: string, top: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [ENTRY, ...args], { cwd, env: env(top, path.join(top, 'state')), encoding: 'utf8', timeout: 120_000, windowsHide: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const retire = (cwd: string, top: string, line: number, by: number, reason: string) => aidlc(cwd, top, 'lessons', 'retire', '--line', String(line), '--by', String(by), '--reason', reason, '--json');
function put(dir: string, rel: string, text: string): void {
  const file = path.join(dir, ...rel.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}
const read = (dir: string, rel: string): string | undefined => (existsSync(path.join(dir, rel)) ? readFileSync(path.join(dir, rel), 'utf8') : undefined);

/** A git repository whose main checkout and linked worktree hold different lessons and retired files. */
function linkedWorktree(): { top: string; main: string; wt: string } {
  const top = fresh();
  const main = path.join(top, 'main');
  mkdirSync(main);
  const git = (cwd: string, ...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, env: env(top, path.join(top, 'state')), encoding: 'utf8', windowsHide: true });
  put(main, 'base.txt', 'base\n');
  assert.equal(git(main, 'init', '-q').status, 0);
  assert.equal(git(main, 'add', '.').status, 0);
  assert.equal(git(main, 'commit', '-q', '-m', 'base').status, 0);
  const wt = path.join(top, 'wt');
  assert.equal(git(main, 'worktree', 'add', '-q', '-b', 'wt', wt).status, 0);
  put(main, 'docs/LESSONS.md', `# Lessons\n\n${[MA, MB, MC, MN].join('\n')}\n`);
  put(main, 'docs/LESSONS-RETIRED.md', `${RETIRED_HEAD}${entryOf('2026-03-01', MC, MN, 'main retires line 5')}\n`);
  put(wt, 'docs/LESSONS.md', `# Lessons\n\n${[A, B, C, N].join('\n')}\n`);
  put(wt, 'docs/LESSONS-RETIRED.md', `${RETIRED_HEAD}${entryOf('2026-03-01', B, N, 'the worktree retires line 4')}\n`);
  return { top, main, wt };
}

test('T0-LESSON-RETIRE acceptance 1: lessons retire in a linked worktree appends the entry of the worktree lines to the worktree file and leaves the main checkout alone [R1]', () => {
  const { top, main, wt } = linkedWorktree();
  const mainBefore = [read(main, 'docs/LESSONS.md'), read(main, 'docs/LESSONS-RETIRED.md')];
  const wtBefore = read(wt, 'docs/LESSONS-RETIRED.md')!;
  const dayBefore = today();
  const first = retire(wt, top, 3, 6, 'T0-N replaces T0-A');
  const dayAfter = today();
  assert.equal(first.status, 0, first.stderr);
  const printed = JSON.parse(first.stdout) as { entry: string; file: string };
  assert.ok([dayBefore, dayAfter].some((d) => printed.entry === entryOf(d, A, N, 'T0-N replaces T0-A')), printed.entry);
  assert.ok(path.isAbsolute(printed.file), printed.file);
  assert.equal(realpathSync.native(printed.file), realpathSync.native(path.join(wt, 'docs', 'LESSONS-RETIRED.md')));
  assert.equal(read(wt, 'docs/LESSONS-RETIRED.md'), `${wtBefore}${printed.entry}\n`);
  assert.deepEqual([read(main, 'docs/LESSONS.md'), read(main, 'docs/LESSONS-RETIRED.md')], mainBefore);

  const refused = retire(wt, top, 4, 6, 'already retired in the worktree');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /already retired/);
  assert.equal(read(wt, 'docs/LESSONS-RETIRED.md'), `${wtBefore}${printed.entry}\n`);

  const second = retire(wt, top, 5, 6, 'main retires line 5, the worktree does not');
  assert.equal(second.status, 0, second.stderr);
  const after = read(wt, 'docs/LESSONS-RETIRED.md')!;
  assert.equal(after, `${wtBefore}${printed.entry}\n${(JSON.parse(second.stdout) as { entry: string }).entry}\n`);
  const resolved = lessons.lessonRetirements(read(wt, 'docs/LESSONS.md')!, after);
  assert.deepEqual([resolved.problems, resolved.entries.map((e) => [e.old, e.by])], [[], [[[4], 6], [[3], 6], [[5], 6]]]);
  assert.deepEqual([read(main, 'docs/LESSONS.md'), read(main, 'docs/LESSONS-RETIRED.md')], mainBefore);
});

/** A plain directory with the given lessons and retired texts; the refusal leaves the retired file as it was. */
function refuses(lessonLines: string[], retired: string | undefined, line: number, by: number, reason: string, check: RegExp): void {
  const top = fresh();
  const dir = path.join(top, 'repo');
  put(dir, 'docs/LESSONS.md', `${lessonLines.join('\n')}\n`);
  if (retired !== undefined) put(dir, 'docs/LESSONS-RETIRED.md', retired);
  const r = retire(dir, top, line, by, reason);
  assert.match(r.stderr, check);
  assert.notEqual(r.status, 0);
  assert.equal(read(dir, 'docs/LESSONS-RETIRED.md'), retired);
}

test('T0-LESSON-RETIRE acceptance 2: a line n or m that is not a lesson line is refused and nothing is written [R1]', () => {
  refuses(['# Lessons', A, N], undefined, 1, 3, 'header', /line 1 is not a lesson line/);
  refuses(['# Lessons', A, N], undefined, 2, 9, 'past the end', /line 9 is not a lesson line/);
});

test('T0-LESSON-RETIRE acceptance 2: an empty or multi-line reason is refused and nothing is written [R1]', () => {
  refuses([A, N], `${RETIRED_HEAD}`, 1, 2, '', /reason/);
  refuses([A, N], `${RETIRED_HEAD}`, 1, 2, '   ', /reason/);
  refuses([A, N], `${RETIRED_HEAD}`, 1, 2, 'one\ntwo', /reason/);
});

test('T0-LESSON-RETIRE acceptance 2: a line already retired by a resolving entry is refused and nothing is written [R1]', () => {
  refuses([A, B, N], `${RETIRED_HEAD}${entryOf('2026-03-01', A, N, 'done')}\n`, 1, 2, 'again', /already retired/);
});

test('T0-LESSON-RETIRE acceptance 2: lessons A, C, A with line 1 retired by line 2 is refused by the validator check order [R1]', () => {
  refuses([A, C, A], undefined, 1, 2, 'C after the first A only', /order/);
  refuses([A, C, A], '# Retired lessons', 1, 2, 'a file without a last line feed', /order/);
});

const E1 = entryOf('2026-03-02', A, N, 'first');
const E2 = entryOf('2026-03-03', B, N, 'second');

test('T0-LESSON-RETIRE acceptance 3: with no file, two appendRetirement calls write the header once and both entries [R2]', () => {
  const file = path.join(fresh(), 'docs', 'LESSONS-RETIRED.md');
  lessons.appendRetirement(file, E1);
  lessons.appendRetirement(file, E2);
  const text = readFileSync(file, 'utf8');
  assert.ok(text.endsWith(`\n${E1}\n${E2}\n`), text);
  const head = text.slice(0, text.indexOf(E1));
  assert.ok(head.startsWith('# '), head);
  assert.equal(text.split(head.split('\n')[0]!).length, 2, 'the header is written once');
});

test('T0-LESSON-RETIRE acceptance 3: an empty file another creator made gets the entry and no header [R2]', () => {
  const file = path.join(fresh(), 'LESSONS-RETIRED.md');
  writeFileSync(file, '');
  lessons.appendRetirement(file, E1);
  assert.equal(readFileSync(file, 'utf8'), `${E1}\n`);
  writeFileSync(file, `${E1}`);
  lessons.appendRetirement(file, E2);
  assert.equal(readFileSync(file, 'utf8'), `${E1}\n${E2}\n`, 'a last line without a line feed keeps its own line');
});

test('T0-LESSON-RETIRE acceptance 3: an entry appended after retireLesson read the file survives its write [R2]', () => {
  const dir = fresh();
  const lessonsFile = path.join(dir, 'LESSONS.md');
  const retiredFile = path.join(dir, 'LESSONS-RETIRED.md');
  writeFileSync(lessonsFile, `${[A, B, N].join('\n')}\n`);
  writeFileSync(retiredFile, RETIRED_HEAD);
  const real = fs.readFileSync;
  const realAppend = fs.appendFileSync;
  let reads = 0;
  const spy = mock.method(fs, 'readFileSync', function (this: unknown, file: fs.PathOrFileDescriptor, ...rest: unknown[]) {
    const result = (real as (...a: unknown[]) => unknown).call(this, file, ...rest);
    if (typeof file === 'string' && path.resolve(file) === path.resolve(retiredFile) && reads++ === 0) realAppend(retiredFile, `${E2}\n`);
    return result;
  });
  syncBuiltinESMExports();
  let result: unknown;
  try {
    result = lessons.retireLesson(lessonsFile, { line: 1, by: 3, reason: 'first', date: '2026-03-02' });
  } finally {
    spy.mock.restore();
    syncBuiltinESMExports();
  }
  assert.deepEqual(result, { ok: true, entry: E1, file: path.resolve(retiredFile) });
  assert.equal(readFileSync(retiredFile, 'utf8'), `${RETIRED_HEAD}${E2}\n${E1}\n`);
});

/** The doctor fixtures of acceptance 4: no retired file, one resolving entry, one resolving and one unresolved entry. */
const UNRESOLVED = `- 2026-03-04 RETIRE 2026-01-09 T0-Z ${sha('gone')} BY 2026-01-05 T0-N ${sha(N)}: gone`;
const DOCTOR_CASES: Array<[string | undefined, unknown, string]> = [
  [undefined, { entries: 0, problems: [] }, 'none'],
  [`${RETIRED_HEAD}${E1}\n`, { entries: 1, problems: [] }, 'ok (1 entries)'],
  [`${RETIRED_HEAD}${E1}\n${UNRESOLVED}\n`, { entries: 2, problems: [{ line: 4, check: 'old line' }] }, 'PROBLEMS: entry 4: old line'],
];
function doctorRepo(retired: string | undefined): { top: string; dir: string } {
  const top = fresh();
  const dir = path.join(top, 'repo');
  put(dir, 'docs/LESSONS.md', `${[A, B, N].join('\n')}\n`);
  if (retired !== undefined) put(dir, 'docs/LESSONS-RETIRED.md', retired);
  return { top, dir };
}

test('T0-LESSON-RETIRE acceptance 4: doctor --json reports lessonRetirements as entries and the validator problems [R3]', () => {
  for (const [retired, expected] of DOCTOR_CASES) {
    const { top, dir } = doctorRepo(retired);
    const r = aidlc(dir, top, 'doctor', '--json');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual((JSON.parse(r.stdout) as Record<string, unknown>)['lessonRetirements'], expected);
  }
});

test('T0-LESSON-RETIRE acceptance 4: doctor prints none, ok (k entries) or PROBLEMS for lessonRetirements [R3]', () => {
  for (const [retired, , expected] of DOCTOR_CASES) {
    const { top, dir } = doctorRepo(retired);
    const r = aidlc(dir, top, 'doctor', '--no-json');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.split(/\r?\n/).includes(`lessonRetirements ${expected}`), r.stdout);
  }
});
