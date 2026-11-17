/**
 * Card T0-REVIEW-NO-RUN (issue 328): `aidlc review r3` and `aidlc review pre` read the card run of the goal they resolve
 * without creating it, refuse a card with no run (naming `aidlc card next <card> --goal <goal>`) and a run with no
 * successful attempt (naming `aidlc card attempt <card> --outcome success`), before any reviewer runs and with nothing
 * written; a run with a successful attempt is reviewed as before.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard } from './_harness.ts';
import { tmpDir } from '../infra/helpers.ts';
import { changelogSince010 } from '../infra/changelog.ts';

const CARD = 'T0-NR';
const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'aidlc.js');

/** The fake reviewer: reads the prompt from stdin, writes the marker file named by argv[2], prints a pass verdict last. */
const REVIEWER = [
  "import { writeFileSync } from 'node:fs';",
  "const verdicts = { r3: '{\"verdict\":\"pass\",\"reasons\":[],\"axes\":{\"spec\":{\"verdict\":\"pass\",\"reasons\":[]},\"standards\":{\"verdict\":\"pass\",\"reasons\":[]}}}', pre: '{\"verdict\":\"pass\",\"reasons\":[]}' };",
  "process.stdin.resume();",
  "process.stdin.on('end', () => { writeFileSync(process.argv[2], 'ran\\n'); process.stdout.write(verdicts[process.argv[3]] + '\\n'); });",
  '',
].join('\n');

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=aidlc-test', '-c', 'user.email=aidlc-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** Every file under `dir` with its bytes, keyed by its path relative to `dir`; empty when `dir` does not exist. */
function tree(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  if (!existsSync(dir)) return files;
  const walk = (rel: string): void => {
    for (const name of readdirSync(path.join(dir, rel))) {
      const r = path.join(rel, name);
      if (statSync(path.join(dir, r)).isDirectory()) walk(r);
      else files[r] = readFileSync(path.join(dir, r), 'base64');
    }
  };
  walk('');
  return files;
}

/**
 * A git repository with card T0-NR, a formal reviewer and a pre-reviewer that each write a marker file when run, a
 * temporary state directory and a goal for the card; the checkout is on the card branch with a committed diff against main.
 * With `pre: false` the pre-reviewer is left out: with one set, `review r3` on main is refused by the pre-review gate
 * before its reviewer runs, so an r3 refusal test could not show that the guard keeps the reviewer from running.
 */
function cliRepo(options: { pre: boolean } = { pre: true }) {
  const repo = tmpDir('aidlc-norun-repo-');
  const state = tmpDir('aidlc-norun-state-');
  const local = path.join(repo, '_local');
  mkdirSync(path.join(repo, 'specs', 'tasks'), { recursive: true });
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  mkdirSync(local, { recursive: true });
  const script = path.join(local, 'reviewer.mjs');
  writeFileSync(script, REVIEWER);
  const marker = { r3: path.join(local, 'r3.marker'), pre: path.join(local, 'pre.marker') };
  const worktreeRoot = path.join(state, 'wt');
  writeFileSync(
    path.join(repo, 'aidlc.config.json'),
    JSON.stringify({
      shipPath: 'dry-run',
      cardsDir: 'specs/tasks',
      worktreeRoot,
      base: 'main',
      mode: 'remote',
      formalReview: { command: [process.execPath, script, marker.r3, 'r3'], reviewer: 'primary', timeoutMs: 60_000, shell: false },
      ...(options.pre ? { preReview: { command: [process.execPath, script, marker.pre, 'pre'], reviewer: 'pre', rounds: 2, timeoutMs: 60_000, onExhausted: 'stop', shell: false } } : {}),
    }),
  );
  writeFileSync(path.join(repo, '.gitignore'), '_local/\n.review/\n');
  writeFileSync(path.join(repo, 'src', 't0-nr.ts'), 'export const nr = 0;\n');
  const fx = makeFixture();
  try {
    writeCard(fx, { id: CARD, title: 'review with no run', allowPaths: ['src/t0-nr.ts'] });
    copyFileSync(path.join(fx.cardsDir, `${CARD}.md`), path.join(repo, 'specs', 'tasks', `${CARD}.md`));
  } finally {
    fx.cleanup();
  }
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'checkout', '-q', '-b', CARD);
  writeFileSync(path.join(repo, 'src', 't0-nr.ts'), 'export const nr = 1;\n');
  git(repo, 'commit', '-q', '-am', 'candidate');
  const sha = git(repo, 'rev-parse', 'HEAD');

  const env = { ...process.env, AIDLC_STATE_DIR: state };
  const raw = (...args: string[]) => spawnSync(process.execPath, [bin, '-C', repo, ...args], { cwd: repo, env, encoding: 'utf8', timeout: 120_000 });
  const cli = (...args: string[]) => {
    const r = raw(...args, '--json');
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}\n${r.stdout}`);
    return JSON.parse(r.stdout) as Record<string, any>;
  };
  const created = cli('goal', 'new', `implement ${CARD}`, '--card', CARD);
  const goalId = typeof created['goal'] === 'string' ? (created['goal'] as string) : (created['goal']?.id as string);
  cli('report', '--goal', goalId, '--result', 'cards-projected', '--cards', CARD);

  /** The card-run records, the goal journal and the review queue, byte for byte. */
  const snapshot = () => ({ cards: tree(path.join(state, 'cards')), journal: tree(path.join(state, 'journal')), queue: tree(path.join(state, 'review-queue')) });
  /** Every `.review/` file of the checkout and of the card worktrees. */
  const reviewFiles = () => [...Object.keys(tree(path.join(repo, '.review'))), ...Object.keys(tree(worktreeRoot)).filter((f) => f.split(path.sep).includes('.review'))];
  const cleanup = (): void => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  };
  return { repo, state, raw, cli, goalId, sha, marker, snapshot, reviewFiles, cleanup };
}

type Repo = ReturnType<typeof cliRepo>;

/** The command exits 1 with one `aidlc: ` line on stderr that contains `expected`, and writes nothing to stdout. */
function refused(r: ReturnType<Repo['raw']>, expected: string): void {
  assert.equal(r.status, 1, `${r.stderr}\n${r.stdout}`);
  const lines = r.stderr.split(/\r?\n/).filter((l) => l !== '');
  assert.equal(lines.length, 1, `exactly one stderr line: ${r.stderr}`);
  assert.ok(lines[0]!.startsWith('aidlc: '), lines[0]);
  assert.ok(lines[0]!.includes(expected), `${lines[0]} names ${expected}`);
  assert.equal(r.stdout, '');
}

/** `review <kind>` on a card of the goal with no card run: refused, and no run, journal line, queue request, `.review/` file or marker. */
function noRunRefusal(kind: 'r3' | 'pre'): void {
  const x = cliRepo({ pre: kind === 'pre' });
  try {
    const before = x.snapshot();
    assert.deepEqual(before.cards, {}, 'no card run before');
    refused(x.raw('review', kind, CARD, '--goal', x.goalId), `aidlc card next ${CARD} --goal ${x.goalId}`);
    assert.deepEqual(x.snapshot(), before, 'no card run file, the same journal lines, no review queue request');
    assert.deepEqual(x.reviewFiles(), [], 'no .review/ file');
    assert.equal(existsSync(x.marker[kind]), false, 'the reviewer did not run');
  } finally {
    x.cleanup();
  }
}

/** `review <kind>` after PREPARE and BUILD with no attempt, then after a failed and a not-counted attempt: refused, nothing changed. */
function noSuccessRefusal(kind: 'r3' | 'pre'): void {
  const x = cliRepo({ pre: kind === 'pre' });
  try {
    const check = (): void => {
      const before = x.snapshot();
      refused(x.raw('review', kind, CARD, '--goal', x.goalId), `aidlc card attempt ${CARD} --outcome success`);
      assert.deepEqual(x.snapshot(), before, 'the card run, the journal and the review queue are byte-for-byte unchanged');
      assert.equal(existsSync(x.marker[kind]), false, 'the reviewer did not run');
    };
    assert.equal(x.cli('card', 'next', CARD, '--goal', x.goalId)['directive']['kind'], 'prepare');
    assert.equal(x.cli('card', 'next', CARD, '--goal', x.goalId)['directive']['kind'], 'build');
    check();
    x.cli('card', 'attempt', CARD, '--goal', x.goalId, '--outcome', 'fail', '--cause', 'dod red: one test fails');
    assert.equal(x.cli('card', 'next', CARD, '--goal', x.goalId)['directive']['kind'], 'build');
    x.cli('card', 'attempt', CARD, '--goal', x.goalId, '--outcome', 'not-counted', '--not-counted', 'tool-outage');
    const attempts = x.cli('card', 'next', CARD, '--goal', x.goalId)['run']['attempts'];
    assert.ok(attempts >= 2, `the run holds the failed and the not-counted attempt: ${attempts}`);
    check();
  } finally {
    x.cleanup();
  }
}

describe('T0-REVIEW-NO-RUN: no card run in the goal [R1]', () => {
  it('acceptance 1: review r3 on a card with no run exits 1 naming aidlc card next and writes nothing; the reviewer does not run [R1]', () => noRunRefusal('r3'));
  it('acceptance 1: review pre on a card with no run exits 1 naming aidlc card next and writes nothing; the pre-reviewer does not run [R1]', () => noRunRefusal('pre'));
});

describe('T0-REVIEW-NO-RUN: a run with no successful attempt [R2]', () => {
  it('acceptance 2: review r3 with no attempt, then after a failed and a not-counted attempt, exits 1 naming aidlc card attempt and changes nothing [R2]', () => noSuccessRefusal('r3'));
  it('acceptance 2: review pre with no attempt, then after a failed and a not-counted attempt, exits 1 naming aidlc card attempt and changes nothing [R2]', () => noSuccessRefusal('pre'));
});

describe('T0-REVIEW-NO-RUN: a run with a successful attempt is reviewed [R1] [R3]', () => {
  it('acceptance 3: after a successful attempt with --candidate-sha, review pre and review r3 run their reviewers and record their decisions [R1] [R3]', () => {
    const x = cliRepo();
    try {
      assert.equal(x.cli('card', 'next', CARD, '--goal', x.goalId)['directive']['kind'], 'prepare');
      assert.equal(x.cli('card', 'next', CARD, '--goal', x.goalId)['directive']['kind'], 'build');
      x.cli('card', 'attempt', CARD, '--goal', x.goalId, '--outcome', 'success', '--dod-receipt', 'dod:cli', '--red-receipt', 'red:cli', '--candidate-sha', x.sha);
      const pre = x.cli('review', 'pre', CARD, '--goal', x.goalId);
      assert.equal(pre['outcome'], 'pass', JSON.stringify(pre));
      assert.equal(existsSync(x.marker.pre), true, 'the pre-reviewer ran');
      const r3 = x.cli('review', 'r3', CARD, '--goal', x.goalId);
      assert.deepEqual({ outcome: r3['outcome'], decisions: r3['decisions'] }, { outcome: 'pass', decisions: 1 }, JSON.stringify(r3));
      assert.equal(existsSync(x.marker.r3), true, 'the formal reviewer ran');
    } finally {
      x.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Acceptance 4: the sentences this card adds, each in its place, and removing any one fails.
// ---------------------------------------------------------------------------------------------------------------------

const OPERATIONS_SENTENCES = [
  'Review with no run (card T0-REVIEW-NO-RUN, issue 328): `aidlc review r3 <card>` and `aidlc review pre <card>` read the card run of the goal they resolve and do not create it.',
  'After the goal checks, when that goal holds no run for the card, each exits 1 with one `aidlc: ` line that names the card and the goal and says to run `aidlc card next <card> --goal <goal>` first; no reviewer runs, no card run is created, no deadline starts, and nothing is written to the journal, the review queue or `.review/`.',
  'When the run exists but none of its attempts has the outcome `success`, each exits 1 in the same way with one line that says to record a successful attempt first (`aidlc card attempt <card> --outcome success ...`); no reviewer runs and the run record, the journal and the review queue are unchanged.',
];
const CHANGELOG_SENTENCES = [
  '- T0-REVIEW-NO-RUN (bugfix, issue 328): `aidlc review r3` and `aidlc review pre` no longer create a card run.',
  'On a card with no run in the goal they resolve, each exits 1 with one `aidlc: ` line naming `aidlc card next <card> --goal <goal>`, and on a run with no successful attempt with one line naming `aidlc card attempt <card> --outcome success`; in both cases no reviewer runs and nothing is written.',
  'Before, either command created the run, started its deadline, ran the reviewer on the checkout HEAD and recorded its decision.',
];

const readDoc = (file: string): string => readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

/** Each sentence in its place, as `[sentence, present]`: the OPERATIONS paragraph and the CHANGELOG Unreleased entry. */
function placed(ops: string, changelog: string): Array<[string, boolean]> {
  const paragraph = ops.split('\n').find((line) => line.startsWith('Review with no run (card T0-REVIEW-NO-RUN')) ?? '';
  const unreleased = changelogSince010(changelog);
  const entry = unreleased.split('\n').find((line) => line.startsWith('- T0-REVIEW-NO-RUN ')) ?? '';
  return [
    ...OPERATIONS_SENTENCES.map((s): [string, boolean] => [s, paragraph.includes(s) && paragraph === OPERATIONS_SENTENCES.join(' ')]),
    ...CHANGELOG_SENTENCES.map((s): [string, boolean] => [s, entry.includes(s) && entry === CHANGELOG_SENTENCES.join(' ')]),
  ];
}

describe('T0-REVIEW-NO-RUN docs [R4]', () => {
  it('acceptance 4: docs/OPERATIONS.md carries the Review with no run paragraph and CHANGELOG.md Unreleased carries the entry [R4]', () => {
    for (const [sentence, present] of placed(readDoc('docs/OPERATIONS.md'), readDoc('CHANGELOG.md'))) assert.ok(present, `missing: ${sentence}`);
  });

  it('acceptance 4: removing any one sentence from its document fails its check [R4]', () => {
    const ops = readDoc('docs/OPERATIONS.md');
    const changelog = readDoc('CHANGELOG.md');
    for (const s of OPERATIONS_SENTENCES) assert.equal(placed(ops.replace(s, ''), changelog).find(([x]) => x === s)?.[1], false, `removing this text still passes: ${s}`);
    for (const s of CHANGELOG_SENTENCES) assert.equal(placed(ops, changelog.replace(s, '')).find(([x]) => x === s)?.[1], false, `removing this text still passes: ${s}`);
  });
});
