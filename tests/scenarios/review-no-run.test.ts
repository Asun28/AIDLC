/**
 * Card T0-REVIEW-NO-RUN-2 (issue 328): `aidlc review r3` and `aidlc review pre` read the card run of the goal they resolve
 * without creating it, refuse a card with no run (naming `aidlc card next <card> --goal <goal>`) and a run with no
 * successful attempt and no withdrawn candidate (naming `aidlc card attempt <card> --outcome success`), before any reviewer
 * runs and with nothing written; a withdrawn candidate keeps the runner's refusal, and a successful attempt is reviewed.
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
const KINDS = ['r3', 'pre'] as const;
const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'aidlc.js');
/** The fake reviewer: reads the prompt from stdin, writes the marker file named by argv[2], prints a pass verdict last. */
const REVIEWER = `import { writeFileSync } from 'node:fs';
const verdicts = { r3: '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}', pre: '{"verdict":"pass","reasons":[]}' };
process.stdin.resume();
process.stdin.on('end', () => { writeFileSync(process.argv[2], 'ran\\n'); process.stdout.write(verdicts[process.argv[3]] + '\\n'); });
`;

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=aidlc-test', '-c', 'user.email=aidlc-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** Every file under `dir` with its bytes, keyed by its path relative to `dir`; empty when `dir` does not exist. */
function tree(dir: string, rel = '', files: Record<string, string> = {}): Record<string, string> {
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(path.join(dir, rel))) {
    const r = path.join(rel, name);
    if (statSync(path.join(dir, r)).isDirectory()) tree(dir, r, files);
    else files[r] = readFileSync(path.join(dir, r), 'base64');
  }
  return files;
}

/**
 * A git repository with card T0-NR, a formal reviewer and (with `pre`) a pre-reviewer that each write a marker file when
 * run, a temporary state directory and a goal for the card; the checkout is on the card branch with a committed diff
 * against main. The r3 refusals leave the pre-reviewer out: with one set, `review r3` on main is refused by the pre-review
 * gate before its reviewer runs, so the test could not show that the guard keeps the reviewer from running.
 */
function cliRepo(pre: boolean) {
  const [repo, state] = [tmpDir('aidlc-norun-repo-'), tmpDir('aidlc-norun-state-')];
  const local = path.join(repo, '_local');
  for (const d of [path.join(repo, 'specs', 'tasks'), path.join(repo, 'src'), local]) mkdirSync(d, { recursive: true });
  const script = path.join(local, 'reviewer.mjs');
  writeFileSync(script, REVIEWER);
  const marker = { r3: path.join(local, 'r3.marker'), pre: path.join(local, 'pre.marker') };
  const reviewer = (kind: 'r3' | 'pre') => ({ command: [process.execPath, script, marker[kind], kind], reviewer: kind, timeoutMs: 60_000, shell: false });
  const worktreeRoot = path.join(state, 'wt');
  const preReview = pre ? { preReview: { ...reviewer('pre'), rounds: 2, onExhausted: 'stop' } } : {};
  writeFileSync(path.join(repo, 'aidlc.config.json'), JSON.stringify({ shipPath: 'dry-run', cardsDir: 'specs/tasks', worktreeRoot, base: 'main', mode: 'remote', formalReview: reviewer('r3'), ...preReview }));
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
  const card = (...args: string[]) => cli('card', args[0]!, CARD, '--goal', goalId, ...args.slice(1));
  /** `card next` twice: PREPARE, then BUILD. */
  const toBuild = () => ['prepare', 'build'].forEach((kind) => assert.equal(card('next')['directive']['kind'], kind));
  const succeed = () => card('attempt', '--outcome', 'success', '--dod-receipt', 'dod:cli', '--red-receipt', 'red:cli', '--candidate-sha', sha);
  /** The card-run records, the goal journal and the review queue, byte for byte. */
  const snapshot = () => ({ cards: tree(path.join(state, 'cards')), journal: tree(path.join(state, 'journal')), queue: tree(path.join(state, 'review-queue')) });
  /** Every `.review/` file of the checkout and of the card worktrees. */
  const reviewFiles = () => [...Object.keys(tree(path.join(repo, '.review'))), ...Object.keys(tree(worktreeRoot)).filter((f) => f.split(path.sep).includes('.review'))];
  /** `review <kind>` exits 1 with one `aidlc: ` stderr line containing `expected`, nothing on stdout, and its reviewer did not run. */
  const refused = (kind: 'r3' | 'pre', expected: string): void => {
    const r = raw('review', kind, CARD, '--goal', goalId);
    assert.equal(r.status, 1, `${r.stderr}\n${r.stdout}`);
    const lines = r.stderr.split(/\r?\n/).filter((l) => l !== '');
    assert.equal(lines.length, 1, `exactly one stderr line: ${r.stderr}`);
    assert.ok(lines[0]!.startsWith('aidlc: ') && lines[0]!.includes(expected), `${lines[0]} names ${expected}`);
    assert.equal(r.stdout, '');
    assert.equal(existsSync(marker[kind]), false, 'the reviewer did not run');
  };
  return { goalId, marker, cli, card, toBuild, succeed, snapshot, reviewFiles, refused, cleanup: () => [repo, state].forEach((d) => rmSync(d, { recursive: true, force: true })) };
}

/** Run `body` on a fresh repository, removed afterwards. */
function withRepo(pre: boolean, body: (x: ReturnType<typeof cliRepo>) => void): void {
  const x = cliRepo(pre);
  try {
    body(x);
  } finally {
    x.cleanup();
  }
}

describe('T0-REVIEW-NO-RUN-2: refusals before any reviewer runs [R1] [R2]', () => {
  for (const kind of KINDS) {
    it(`acceptance 1: review ${kind} on a card with no run exits 1 naming aidlc card next and writes nothing; the reviewer does not run [R1]`, () =>
      withRepo(kind === 'pre', (x) => {
        const before = x.snapshot();
        assert.deepEqual(before.cards, {}, 'no card run before');
        x.refused(kind, `aidlc card next ${CARD} --goal ${x.goalId}`);
        assert.deepEqual(x.snapshot(), before, 'no card run file, the same journal lines, no review queue request');
        assert.deepEqual(x.reviewFiles(), [], 'no .review/ file');
      }));

    it(`acceptance 2: review ${kind} with no attempt, then after a failed and a not-counted attempt, exits 1 naming aidlc card attempt and changes nothing [R2]`, () =>
      withRepo(kind === 'pre', (x) => {
        const check = (): void => {
          const before = x.snapshot();
          x.refused(kind, `aidlc card attempt ${CARD} --outcome success`);
          assert.deepEqual(x.snapshot(), before, 'the card run, the journal and the review queue are byte-for-byte unchanged');
        };
        x.toBuild();
        check();
        x.card('attempt', '--outcome', 'fail', '--cause', 'dod red: one test fails');
        assert.equal(x.card('next')['directive']['kind'], 'build');
        x.card('attempt', '--outcome', 'not-counted', '--not-counted', 'tool-outage');
        const attempts = x.card('next')['run']['attempts'];
        assert.ok(attempts >= 2, `the run holds the failed and the not-counted attempt: ${attempts}`);
        check();
      }));
  }

  it('acceptance 2: after a successful attempt withdrawn with card withdraw, review r3 exits 1 with the withdrawn-candidate refusal and the reviewer does not run [R2]', () =>
    withRepo(false, (x) => {
      x.toBuild();
      x.succeed();
      x.card('withdraw', '--cause', 'F9 the guard is missing');
      x.refused('r3', 'the candidate was withdrawn (F9 the guard is missing); repair it and record the attempt');
    }));
});

describe('T0-REVIEW-NO-RUN-2: a run with a successful attempt is reviewed [R1] [R3]', () => {
  it('acceptance 3: after a successful attempt with --candidate-sha, review pre and review r3 run their reviewers and record their decisions [R1] [R3]', () =>
    withRepo(true, (x) => {
      x.toBuild();
      x.succeed();
      const pre = x.cli('review', 'pre', CARD, '--goal', x.goalId);
      assert.equal(pre['outcome'], 'pass', JSON.stringify(pre));
      assert.equal(existsSync(x.marker.pre), true, 'the pre-reviewer ran');
      const r3 = x.cli('review', 'r3', CARD, '--goal', x.goalId);
      assert.deepEqual({ outcome: r3['outcome'], decisions: r3['decisions'] }, { outcome: 'pass', decisions: 1 }, JSON.stringify(r3));
      assert.equal(existsSync(x.marker.r3), true, 'the formal reviewer ran');
    }));
});

// Acceptance 4: the sentences this card adds, each in its place, and removing any one fails.
const OPERATIONS_SENTENCES = [
  'Review with no run (card T0-REVIEW-NO-RUN-2, issue 328): `aidlc review r3 <card>` and `aidlc review pre <card>` read the card run of the goal they resolve and do not create it.',
  'After the goal checks, when that goal holds no run for the card, each exits 1 with one `aidlc: ` line that names the card and the goal and says to run `aidlc card next <card> --goal <goal>` first; no reviewer runs, no card run is created, no deadline starts, and nothing is written to the journal, the review queue or `.review/`.',
  'When the run exists, none of its attempts has the outcome `success` and its candidate was not withdrawn, each exits 1 in the same way with one line that says to record a successful attempt first (`aidlc card attempt <card> --outcome success ...`); no reviewer runs and the run record, the journal and the review queue are unchanged.',
  'A candidate withdrawn with `aidlc card withdraw` keeps its own refusal.',
];
const CHANGELOG_SENTENCES = [
  '- T0-REVIEW-NO-RUN-2 (bugfix, issue 328): `aidlc review r3` and `aidlc review pre` no longer create a card run.',
  'On a card with no run in the goal they resolve, each exits 1 with one `aidlc: ` line naming `aidlc card next <card> --goal <goal>`, and on a run with no successful attempt and no withdrawn candidate with one line naming `aidlc card attempt <card> --outcome success`; in both cases no reviewer runs and nothing is written.',
  'Before, either command created the run, started its deadline, ran the reviewer on the checkout HEAD and recorded its decision.',
];
const readDoc = (file: string): string => readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

/** Each sentence in its place, as `[sentence, present]`: the OPERATIONS paragraph and the CHANGELOG Unreleased entry. */
function placed(ops: string, changelog: string): Array<[string, boolean]> {
  const paragraph = ops.split('\n').find((line) => line.startsWith('Review with no run (card T0-REVIEW-NO-RUN-2')) ?? '';
  const entry = changelogSince010(changelog).split('\n').find((line) => line.startsWith('- T0-REVIEW-NO-RUN-2 ')) ?? '';
  const within = (text: string, all: string[]) => (s: string): [string, boolean] => [s, text.includes(s) && text === all.join(' ')];
  return [...OPERATIONS_SENTENCES.map(within(paragraph, OPERATIONS_SENTENCES)), ...CHANGELOG_SENTENCES.map(within(entry, CHANGELOG_SENTENCES))];
}

describe('T0-REVIEW-NO-RUN-2 docs [R4]', () => {
  it('acceptance 4: docs/OPERATIONS.md carries the Review with no run paragraph and CHANGELOG.md Unreleased carries the entry [R4]', () => {
    for (const [sentence, present] of placed(readDoc('docs/OPERATIONS.md'), readDoc('CHANGELOG.md'))) assert.ok(present, `missing: ${sentence}`);
  });

  it('acceptance 4: removing any one sentence from its document fails its check [R4]', () => {
    const [ops, changelog] = [readDoc('docs/OPERATIONS.md'), readDoc('CHANGELOG.md')];
    for (const s of OPERATIONS_SENTENCES) assert.equal(placed(ops.replace(s, ''), changelog).find(([x]) => x === s)?.[1], false, `removing this text still passes: ${s}`);
    for (const s of CHANGELOG_SENTENCES) assert.equal(placed(ops, changelog.replace(s, '')).find(([x]) => x === s)?.[1], false, `removing this text still passes: ${s}`);
  });
});
