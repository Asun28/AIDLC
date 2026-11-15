/**
 * Card T0-R3-POOL-WAIT (issue 318): `aidlc review r3` answers a review pool that does not admit the request, and a matching
 * request already running, with the `wait` directive `card next` gives for the same state and exit 75; `CardRunner.formalReview`
 * throws an exported error class that carries the wait, with its message unchanged; and `bin/aidlc.js` prints a thrown error
 * as one `aidlc: <message>` line with exit 1 instead of an unhandled rejection with its stack.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { actorB, goalForCards, makeFixture, writeCard, type Fixture } from './_harness.ts';
import { tmpDir } from '../infra/helpers.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import * as cardRunnerModule from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { ReviewQueue } from '../../src/coordination/review-queue.ts';
import { GoalStore } from '../../src/state/goal-store.ts';
import { statePathsFromRoot } from '../../src/state/paths.ts';
import { ProjectConfig } from '../../src/config.ts';

const { CardRunner, ReviewPoolWaitError } = cardRunnerModule;

const Y = 'T1-Y';
const Z = 'T1-Z';
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const OTHER = 'g-20260911000000-000000:T1-X';
const busyMessage = 'review pool "default" is busy; the formal review waits for admission (aidlc review status --pool "default")';
const behindMessage = (requester: string) => `review pool "default" is behind the request of ${requester}; the formal review waits for admission (aidlc review status --pool "default")`;

/** Two cards of one goal at the R3 step, pool `default` at its default `maxConcurrent: 1`. */
function atReview(): { fx: Fixture; runner: InstanceType<typeof CardRunner>; goalId: string; spawned: { r3: number } } {
  const fx = makeFixture({ config: { gateRequired: true, formalReview: { command: ['fake-p', '--schema', '{schema}', '{instructions}'], reviewer: 'primary', timeoutMs: 1000, shell: false } } });
  const spawned = { r3: 0 };
  const exec = scriptedRunner({
    'git diff --numstat': { stdout: '0\t0\tsrc/t1-yz.ts\n' },
    'git diff --name-only': { stdout: 'src/t1-yz.ts\u0000' },
    'git diff': { stdout: 'diff --git a/src/t1-yz.ts b/src/t1-yz.ts\n+export const yz = 1;\n' },
    'fake-p': () => {
      spawned.r3 += 1;
      return { stdout: PASS };
    },
  });
  for (const id of [Y, Z]) writeCard(fx, { id, title: `review r3 wait ${id}`, allowPaths: ['src/t1-yz.ts'] });
  const goalId = goalForCards(fx, [Y, Z]).id;
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: exec });
  for (const id of [Y, Z]) {
    let r = runner.next(fx.goal(goalId), fx.card(id), fx.controller.ensureCardRun(fx.goal(goalId), id));
    assert.equal(r.directive.kind, 'prepare', r.directive.narration);
    r = runner.next(fx.goal(goalId), fx.card(id), r.run);
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    runner.recordAttempt(fx.goal(goalId), fx.card(id), r.run, { outcome: 'success', dodReceipt: `dod:${id}`, redReceipt: `red:${id}`, candidateSha: `sha-${id.toLowerCase()}` });
    assert.equal(runner.next(fx.goal(goalId), fx.card(id), fx.store.getCardRun(goalId, id)!).directive.kind, 'review');
  }
  return { fx, runner, goalId, spawned };
}

describe('T0-R3-POOL-WAIT: formalReview throws the exported wait error with its message unchanged [R1]', () => {
  it('acceptance 1: behind a foreign admitted request the second card rejects busy, then behind the first card, and its run and journal are unchanged [R1]', async () => {
    assert.equal(typeof ReviewPoolWaitError, 'function', 'card-runner.ts exports ReviewPoolWaitError');
    const { fx, runner, goalId, spawned } = atReview();
    const review = (id: string) => runner.formalReview(fx.goal(goalId), fx.card(id), fx.store.getCardRun(goalId, id)!);
    const foreign = fx.queue.enqueue({ pool: 'default', repository: fx.goal(goalId).repository, candidateDigest: 'digest-x', base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'primary', requester: OTHER, deadline: fx.store.getCardRun(goalId, Y)!.deadline, now: fx.now() }).request;
    assert.equal(fx.queue.admit('default', actorB, fx.now()).status, 'admitted');
    const runBefore = fx.store.getCardRun(goalId, Z)!;
    const journalBefore = fx.events(goalId);
    await assert.rejects(review(Y), ReviewPoolWaitError);
    await assert.rejects(review(Z), (err: unknown) => {
      assert.ok(err instanceof ReviewPoolWaitError);
      assert.deepEqual({ message: err.message, cardId: err.cardId, pool: err.pool, status: err.status, ahead: err.ahead, resetAt: err.resetAt }, { message: busyMessage, cardId: Z, pool: 'default', status: 'busy', ahead: [], resetAt: undefined });
      return true;
    });
    fx.queue.complete(foreign.key, 'verdict:x', fx.now());
    await assert.rejects(review(Z), (err: unknown) => {
      assert.ok(err instanceof ReviewPoolWaitError);
      assert.deepEqual({ message: err.message, cardId: err.cardId, pool: err.pool, status: err.status, ahead: err.ahead }, { message: behindMessage(`${goalId}:${Y}`), cardId: Z, pool: 'default', status: 'behind', ahead: [`${goalId}:${Y}`] });
      return true;
    });
    const runAfter = fx.store.getCardRun(goalId, Z)!;
    assert.deepEqual(runAfter, runBefore, "Z's card run is unchanged");
    assert.equal(runAfter.review.substantiveDecisions, 0);
    assert.deepEqual(runAfter.review.invocations, []);
    assert.deepEqual(fx.events(goalId), journalBefore, 'no journal event is added');
    assert.equal(spawned.r3, 0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Acceptance 2 and 3: the CLI through bin/aidlc.js, against a git repository and a temporary state directory.
// ---------------------------------------------------------------------------------------------------------------------

const CARD = 'T0-PW';
const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'aidlc.js');

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=aidlc-test', '-c', 'user.email=aidlc-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

describe('T0-R3-POOL-WAIT: review r3 through bin/aidlc.js [R2] [R3]', () => {
  it('acceptance 2 and 3: an unknown error is one aidlc: line and exit 1; a busy pool and a running match are the wait directive and exit 75 [R2] [R3]', () => {
    const repo = tmpDir('aidlc-r3wait-repo-');
    const state = tmpDir('aidlc-r3wait-state-');
    try {
      mkdirSync(path.join(repo, 'specs', 'tasks'), { recursive: true });
      mkdirSync(path.join(repo, 'src'), { recursive: true });
      writeFileSync(path.join(repo, 'aidlc.config.json'), JSON.stringify({ shipPath: 'dry-run', cardsDir: 'specs/tasks', worktreeRoot: path.join(state, 'wt'), base: 'main', mode: 'remote', gateRequired: true, formalReview: { command: ['aidlc-test-no-reviewer'], reviewer: 'primary', timeoutMs: 1000, shell: false } }));
      writeFileSync(path.join(repo, '.gitignore'), '_local/\n.review/\n');
      writeFileSync(path.join(repo, 'src', 't0-pw.ts'), 'export const pw = 0;\n');
      const fx = makeFixture();
      try {
        writeCard(fx, { id: CARD, title: 'review r3 pool wait', allowPaths: ['src/t0-pw.ts'] });
        copyFileSync(path.join(fx.cardsDir, `${CARD}.md`), path.join(repo, 'specs', 'tasks', `${CARD}.md`));
      } finally {
        fx.cleanup();
      }
      git(repo, 'init', '-q', '-b', 'main');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', 'base');

      const env = { ...process.env, AIDLC_STATE_DIR: state };
      const raw = (...args: string[]) => spawnSync(process.execPath, [bin, '-C', repo, ...args], { cwd: repo, env, encoding: 'utf8', timeout: 60_000 });
      const cli = (...args: string[]) => {
        const r = raw(...args, '--json');
        assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}\n${r.stdout}`);
        return JSON.parse(r.stdout) as Record<string, any>;
      };
      const created = cli('goal', 'new', `implement ${CARD}`, '--card', CARD);
      const goalId = typeof created['goal'] === 'string' ? (created['goal'] as string) : (created['goal']?.id as string);
      cli('report', '--goal', goalId, '--result', 'cards-projected', '--cards', CARD);

      // Acceptance 3: the card has no card run and the checkout no candidate diff against main, so the command throws.
      const failed = raw('review', 'r3', CARD, '--goal', goalId);
      assert.equal(failed.status, 1, `${failed.stderr}\n${failed.stdout}`);
      const errLines = failed.stderr.split(/\r?\n/).filter((l) => l !== '');
      assert.equal(errLines.length, 1, `exactly one stderr line: ${failed.stderr}`);
      assert.ok(errLines[0]!.startsWith('aidlc: '), errLines[0]);
      assert.ok(!failed.stderr.split(/\r?\n/).some((l) => l.startsWith('    at ')), 'no stack frame');

      git(repo, 'checkout', '-q', '-b', CARD);
      writeFileSync(path.join(repo, 'src', 't0-pw.ts'), 'export const pw = 1;\n');
      git(repo, 'commit', '-q', '-am', 'candidate');
      const sha = git(repo, 'rev-parse', 'HEAD');

      assert.equal(cli('card', 'next', CARD, '--goal', goalId)['directive']['kind'], 'prepare');
      assert.equal(cli('card', 'next', CARD, '--goal', goalId)['directive']['kind'], 'build');
      cli('card', 'attempt', CARD, '--goal', goalId, '--outcome', 'success', '--dod-receipt', 'dod:cli', '--red-receipt', 'red:cli', '--candidate-sha', sha);
      assert.equal(cli('card', 'next', CARD, '--goal', goalId)['directive']['kind'], 'review');

      const store = new GoalStore(statePathsFromRoot(state));
      const queue = new ReviewQueue(statePathsFromRoot(state).reviewQueue);
      const goal = store.getGoal(goalId)!;
      const now = goal.createdAt;
      const foreign = queue.enqueue({ pool: 'default', repository: goal.repository, candidateDigest: 'digest-x', base: 'main', policyVersion: ProjectConfig.parse({}).reviewPolicyVersion, reviewer: 'primary', requester: OTHER, deadline: store.getCardRun(goalId, CARD)!.deadline, now }).request;
      assert.equal(queue.admit('default', actorB, now).status, 'admitted');

      // Acceptance 2: a busy pool.
      const busy = raw('review', 'r3', CARD, '--goal', goalId);
      assert.equal(busy.status, 75, `${busy.stderr}\n${busy.stdout}`);
      assert.equal(busy.stderr, '');
      const waitBusy = JSON.parse(busy.stdout) as Record<string, unknown>;
      assert.deepEqual({ kind: waitBusy['kind'], cardId: waitBusy['cardId'], on: waitBusy['on'], pollSeconds: waitBusy['pollSeconds'] }, { kind: 'wait', cardId: CARD, on: 'review-pool:default:busy', pollSeconds: 120 });
      assert.match(String(waitBusy['narration']), /default/);
      assert.match(String(waitBusy['narration']), /busy/);
      assert.ok(String(waitBusy['narration']).includes(`aidlc review r3 ${CARD}`), String(waitBusy['narration']));

      // Acceptance 2: the card's own request, admitted and running, is a matching request already running.
      queue.complete(foreign.key, 'verdict:x', now);
      const own = queue.list('default').find((r) => r.requesters.includes(`${goalId}:${CARD}`) && r.state === 'queued');
      assert.ok(own, "the card's request is queued");
      assert.equal(queue.admit('default', actorB, now, own.key).status, 'admitted');
      const running = raw('review', 'r3', CARD, '--goal', goalId);
      assert.equal(running.status, 75, `${running.stderr}\n${running.stdout}`);
      assert.equal(running.stderr, '');
      const waitRunning = JSON.parse(running.stdout) as Record<string, unknown>;
      assert.deepEqual({ kind: waitRunning['kind'], cardId: waitRunning['cardId'], on: waitRunning['on'], pollSeconds: waitRunning['pollSeconds'] }, { kind: 'wait', cardId: CARD, on: `review:${own.key}`, pollSeconds: 60 });
      assert.ok(String(waitRunning['narration']).includes(`aidlc review r3 ${CARD}`), String(waitRunning['narration']));
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(state, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Acceptance 5: the sentences this card adds, each in its place, and removing any one fails.
// ---------------------------------------------------------------------------------------------------------------------

const OPERATIONS_SENTENCES = [
  'Pool wait (card T0-R3-POOL-WAIT): when the shared review pool does not admit the request (`busy`, `behind` or `reset-pending`) or a matching request is already running, `aidlc review r3 <card>` writes to stdout the JSON of the `wait` directive `card next` gives for that state (`on` `review-pool:<pool>:<status>` with `pollSeconds` 120, or `review:<request key>` with 60), writes nothing to stderr and exits 75; run it again once the pool admits the request.',
  'Any other error of the command, as of every command run through `bin/aidlc.js`, is one `aidlc: <message>` line on stderr and exit 1, with no stack trace.',
];
const CHANGELOG_SENTENCES = [
  '- T0-R3-POOL-WAIT (bugfix, issue 318): `aidlc review r3` answers a review pool that does not admit the request (`busy`, `behind`, `reset-pending`), and a matching request already running, with the `wait` directive JSON that `card next` gives for the same state and exit 75, with nothing on stderr; `CardRunner.formalReview` throws the exported `ReviewPoolWaitError` (card id, pool, status, requesters ahead, reset time) with the message it threw before.',
  '`bin/aidlc.js` prints a rejection of `main` as one `aidlc: <message>` line on stderr with exit 1, as `node src/cli/main.ts` does.',
  'Before, a pool that did not admit the request ended `review r3` with an unhandled rejection, its stack trace and exit 1.',
];

const readDoc = (file: string): string => readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

/** Each sentence in its place, as `[sentence, present]`: the OPERATIONS paragraph and the CHANGELOG Unreleased entry. */
function placed(ops: string, changelog: string): Array<[string, boolean]> {
  const paragraph = ops.split('\n').find((line) => line.startsWith('Pool wait (card T0-R3-POOL-WAIT):')) ?? '';
  const start = changelog.indexOf('\n## Unreleased\n');
  const end = changelog.indexOf('\n## ', start + 1);
  const unreleased = start < 0 || end < 0 ? '' : changelog.slice(start, end);
  const entry = unreleased.split('\n').find((line) => line.startsWith('- T0-R3-POOL-WAIT ')) ?? '';
  return [
    ...OPERATIONS_SENTENCES.map((s): [string, boolean] => [s, paragraph.includes(s) && paragraph === OPERATIONS_SENTENCES.join(' ')]),
    ...CHANGELOG_SENTENCES.map((s): [string, boolean] => [s, entry.includes(s) && entry === CHANGELOG_SENTENCES.join(' ')]),
  ];
}

describe('T0-R3-POOL-WAIT docs [R4]', () => {
  it('acceptance 5: docs/OPERATIONS.md carries the Pool wait paragraph and CHANGELOG.md Unreleased carries the entry [R4]', () => {
    for (const [sentence, present] of placed(readDoc('docs/OPERATIONS.md'), readDoc('CHANGELOG.md'))) assert.ok(present, `missing: ${sentence}`);
  });

  it('acceptance 5: removing any one sentence from its document fails its check [R4]', () => {
    const ops = readDoc('docs/OPERATIONS.md');
    const changelog = readDoc('CHANGELOG.md');
    for (const s of OPERATIONS_SENTENCES) assert.equal(placed(ops.replace(s, ''), changelog).find(([x]) => x === s)?.[1], false, `removing this text still passes: ${s}`);
    for (const s of CHANGELOG_SENTENCES) assert.equal(placed(ops, changelog.replace(s, '')).find(([x]) => x === s)?.[1], false, `removing this text still passes: ${s}`);
  });
});
