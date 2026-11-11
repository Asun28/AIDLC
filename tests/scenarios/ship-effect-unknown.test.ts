/**
 * Card T0-SHIP-TIMEOUT: a ship whose push, PR create or merge timed out ends as an effect of unknown outcome; its operation is
 * UNKNOWN, its result is owed and delivered, and the card waits for `aidlc ops reconcile` before it ships again.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs, { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { candidateShaFor, goalForCards, makeFixture, writeCard, type Fixture } from './_harness.ts';
import { cleanup, tmpDir } from '../infra/helpers.ts';
import { DryRunShipPath, type ShipOutcomeClass, type ShipRequest, type ShipResult } from '../../src/delivery/ship.ts';
import { GitHubShipPath } from '../../src/delivery/github-ship.ts';
import { runSync, scriptedRunner, type ExecReceipt, type SyncRunner } from '../../src/probes/exec.ts';
import { makeStop } from '../../src/core/stop.ts';
import { summarizeBounds } from '../../src/state/bounds.ts';
import { verifyAudit } from '../../src/audit/verifier.ts';
import type { Goal, OperationRecord } from '../../src/core/types.ts';

const CARD = 'T1-UNKNOWN';
const POOL = 'default';
const LINE = '[SHIP-EFFECT-UNKNOWN] gh pr merge 42 timed out after 120000 ms; it may have taken effect (PR #42)';

const dirs: string[] = [];
after(() => {
  for (const d of dirs) cleanup(d);
});

/** The dry-run path whose first ship ends as the GitHub path ends a merge that timed out; `during` runs inside that ship. */
class UnknownFirst extends DryRunShipPath {
  private readonly during: () => void;

  constructor(during: () => void = () => {}, outcomes: ShipOutcomeClass[] = ['effect-unknown' as ShipOutcomeClass, 'merged']) {
    super(outcomes);
    this.during = during;
  }

  override ship(req: ShipRequest): ShipResult {
    const r = super.ship(req);
    if (r.outcome !== 'merged') this.during();
    if (r.outcome !== ('effect-unknown' as ShipOutcomeClass)) return r;
    const stdout = `${LINE}\n[SAGA-FAIL]\n[SAGA-RESUME] aidlc card next ${CARD}`;
    return { ...r, receipt: { ...r.receipt, exitCode: 1, stdout }, sentinels: ['[SHIP-EFFECT-UNKNOWN]', '[SAGA-FAIL]', '[SAGA-RESUME]'], prNumber: 42, detail: LINE };
  }
}

/** The card at SHIP, its attempt recorded; `next` runs `card next` on the stored run. */
function atShip(fx: Fixture, shipPath: DryRunShipPath): { goal: Goal; next: () => ReturnType<ReturnType<Fixture['runner']>['next']> } {
  writeCard(fx, { id: CARD, title: 'ship whose merge timed out' });
  const goal = goalForCards(fx, [CARD]);
  const runner = fx.runner(shipPath);
  const card = fx.card(CARD);
  let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  assert.equal(r.directive.kind, 'prepare');
  r = runner.next(fx.goal(goal.id), card, r.run);
  assert.equal(r.directive.kind, 'build');
  runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: `dod:${CARD}`, redReceipt: `red:${CARD}`, candidateSha: candidateShaFor(CARD) });
  return { goal, next: () => runner.next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, CARD)!) };
}

const mergeOps = (fx: Fixture): OperationRecord[] => fx.ops.list({ cardId: CARD, kind: 'merge' });
const unknownResults = (fx: Fixture, goalId: string) => fx.events(goalId).filter((e) => e.type === 'OPERATION_RESULT' && e.data['outcome'] === 'effect-unknown');
const requestStates = (fx: Fixture, goalId: string) => fx.queue.list(POOL).filter((r) => r.requesters.includes(`${goalId}:${CARD}`)).map((r) => r.state);

/** What `aidlc ops reconcile <opId> --status <s>` records: the ledger result, then its journal event. */
function reconcile(fx: Fixture, goalId: string, opId: string, status: 'succeeded' | 'failed' | 'cancelled' | 'running' | 'UNKNOWN'): void {
  const rec = fx.ops.reconcile(opId, () => (status === 'UNKNOWN' ? { status, detail: 'looked up: GitHub does not say' } : { status, providerOperationId: status === 'running' ? 'gh-run-1' : undefined }), fx.now());
  fx.journal(goalId).append({ type: 'OPERATION_RECONCILED', goalId, cardId: CARD, data: { operationId: rec.id, status: rec.status } });
}

/** The next call of `method` on `object` throws, once. */
function failOnce(object: object, method: string): void {
  const target = object as Record<string, unknown>;
  target[method] = () => {
    delete target[method];
    throw new Error(`EIO: injected ${method}`);
  };
}

/** Run `body` with the first journal append of a line holding `marker` throwing, that one call only. */
function appendFailing(marker: string, body: () => void): void {
  const target = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  const real = target['appendFileSync']!;
  let fired = false;
  target['appendFileSync'] = (...args: unknown[]) => {
    if (!fired && String(args[0]).endsWith('.jsonl') && String(args[1]).includes(marker)) {
      fired = true;
      throw new Error('EIO: injected append');
    }
    return real(...args);
  };
  syncBuiltinESMExports();
  try {
    body();
  } finally {
    target['appendFileSync'] = real;
    syncBuiltinESMExports();
  }
}

test('a ship whose effect is unknown waits on its operation for aidlc ops reconcile [R5] [R6]', () => {
  const fx = makeFixture();
  try {
    const ship = new UnknownFirst();
    const { goal, next } = atShip(fx, ship);
    const attempts = fx.store.getCardRun(goal.id, CARD)!.effort?.attempts;
    const r = next();
    const [op] = mergeOps(fx);
    assert.equal(r.directive.kind, 'wait', r.directive.narration);
    if (r.directive.kind === 'wait') assert.equal(r.directive.on, `operation:${op!.id}`);
    assert.ok(r.directive.narration.includes(`aidlc ops reconcile ${op!.id} --status succeeded|failed|cancelled`), r.directive.narration);
    assert.ok(r.directive.narration.includes(`aidlc card next ${CARD}`), r.directive.narration);
    assert.deepEqual([op!.status, op!.error, op!.finishedAt], ['UNKNOWN', LINE, fx.now()]);
    const results = fx.events(goal.id).filter((e) => e.type === 'OPERATION_RESULT' && e.data['operationId'] === op!.id);
    assert.deepEqual(results.map((e) => [e.data['status'], e.data['outcome'], e.data['detail'], e.data['completed']]), [['UNKNOWN', 'effect-unknown', LINE, undefined]]);
    const stored = fx.store.getCardRun(goal.id, CARD)!;
    assert.deepEqual(stored.journalOwed ?? [], []);
    assert.equal(stored.state, 'WAIT');
    assert.deepEqual(requestStates(fx, goal.id), ['completed']);
    assert.deepEqual(fx.queue.pool(POOL).active, []);
    assert.deepEqual(stored.effort?.attempts, attempts, 'no attempt is counted');
    const again = next();
    assert.equal(again.directive.kind, 'wait');
    assert.match(again.directive.narration, /reconciling unknown operations/);
    assert.equal(ship.requests.length, 1, 'nothing ships while the operation is UNKNOWN');
  } finally {
    fx.cleanup();
  }
});

test('each persistence step of the owed result can fail and the next step recovers with no further effect [R5]', () => {
  for (const step of ['finish', 'markResult', 'append'] as const) {
    const fx = makeFixture();
    try {
      const ship = new UnknownFirst(() => {
        if (step === 'finish') failOnce(fx.store, 'updateCardRun');
        if (step === 'markResult') failOnce(fx.ops, 'markResult');
      });
      const { goal, next } = atShip(fx, ship);
      if (step === 'append') appendFailing('effect-unknown', () => assert.throws(next, /EIO: injected append/));
      else assert.throws(next, new RegExp(`EIO: injected ${step === 'finish' ? 'updateCardRun' : 'markResult'}`));
      const op = mergeOps(fx)[0]!;
      assert.deepEqual(requestStates(fx, goal.id), ['completed'], step);
      if (step === 'append') {
        assert.equal(op.status, 'UNKNOWN', step);
        assert.equal(unknownResults(fx, goal.id).length, 0, step);
      } else {
        // The operation is still issued: the card waits on it as running until the ledger shows UNKNOWN.
        assert.equal(op.status, 'issued', step);
        const waiting = next();
        assert.equal(waiting.directive.kind, 'wait', step);
        assert.match(waiting.directive.narration, new RegExp(`attached to running operation ${op.id}`), step);
        assert.equal(unknownResults(fx, goal.id).length, 0, `${step}: nothing owed is due while the ledger shows issued`);
        reconcile(fx, goal.id, op.id, 'UNKNOWN');
      }
      const recovered = next();
      assert.equal(recovered.directive.kind, 'wait', step);
      assert.match(recovered.directive.narration, /reconciling unknown operations/, step);
      // The finish write held the owed result: when it failed nothing was owed, and the operator's reconcile is the record.
      assert.deepEqual(unknownResults(fx, goal.id).map((e) => [e.data['status'], e.data['completed']]), step === 'finish' ? [] : [['UNKNOWN', true]], step);
      next();
      assert.equal(unknownResults(fx, goal.id).length, step === 'finish' ? 0 : 1, `${step}: appended once`);
      assert.equal(ship.requests.length, 1, `${step}: nothing shipped again`);
      assert.notEqual(mergeOps(fx)[0]!.status, 'failed', step);
    } finally {
      fx.cleanup();
    }
  }
  // A new candidate recorded or a stop saved during the ship stays, and the operation is UNKNOWN, never failed.
  for (const meanwhile of ['superseded', 'stopped'] as const) {
    const fx = makeFixture();
    try {
      let goalId = '';
      const ship = new UnknownFirst(() =>
        fx.store.updateCardRun(goalId, CARD, (current) =>
          meanwhile === 'superseded' ? { ...current!, candidate: { ...current!.candidate!, digest: 'newer-candidate', sha: 'sha-newer' } } : { ...current!, state: 'STOP', stop: makeStop('card', 'stopped by the operator during the ship', 'inspect', { at: fx.now(), global: false }) },
        ),
      );
      const { goal, next } = atShip(fx, ship);
      goalId = goal.id;
      const r = next();
      const stored = fx.store.getCardRun(goal.id, CARD)!;
      if (meanwhile === 'superseded') {
        assert.equal(r.directive.kind, 'wait', r.directive.narration);
        assert.equal(stored.candidate?.digest, 'newer-candidate');
      } else {
        assert.equal(r.directive.kind, 'stop', r.directive.narration);
        assert.equal(stored.stop?.detail, 'stopped by the operator during the ship');
      }
      assert.equal(mergeOps(fx)[0]!.status, 'UNKNOWN', meanwhile);
      assert.deepEqual(unknownResults(fx, goal.id).map((e) => e.data['status']), ['UNKNOWN'], meanwhile);
    } finally {
      fx.cleanup();
    }
  }
});

/** A worktree and main checkout for a GitHubShipPath with a scripted runner, under a directory the `after` hook removes. */
function scriptedShip(script: Record<string, Partial<ExecReceipt>>) {
  const root = realpathSync.native(tmpDir());
  dirs.push(root);
  const wtRoot = path.join(root, 'wt');
  mkdirSync(path.join(wtRoot, CARD, '.review'), { recursive: true });
  mkdirSync(path.join(root, '.git'), { recursive: true });
  const head = 'a'.repeat(40);
  writeFileSync(path.join(wtRoot, CARD, '.review', `${CARD}.json`), JSON.stringify({ verdict: 'pass', reasons: [], sha: head }));
  const calls: string[] = [];
  const scripted = scriptedRunner({
    'gh api user -q .login': { stdout: 'alice\n' },
    'git add -A': {},
    'git diff --cached --quiet': { exitCode: 0 },
    'git rev-parse --verify HEAD': { stdout: `${head}\n` },
    'git fetch': {},
    'git rev-parse --verify --quiet refs/remotes/origin/main^{commit}': { stdout: `${'d'.repeat(40)}\n` },
    'git merge-tree --write-tree HEAD': { stdout: `${'e'.repeat(40)}\n` },
    'git push': {},
    'gh pr create': { stdout: 'https://github.com/o/r/pull/43\n' },
    'gh api repos/o/r/commits': { stdout: JSON.stringify({ check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] }) },
    'gh pr merge': {},
    'gh pr view': { stdout: JSON.stringify({ number: 42, state: 'MERGED', headRefOid: head, baseRefName: 'main', mergeCommit: { oid: 'b'.repeat(40) } }) },
    ...script,
  });
  const runner: SyncRunner = (cmd, args, o) => {
    calls.push([cmd, ...args].join(' '));
    return scripted(cmd, args, o);
  };
  const r = new GitHubShipPath({ mainRoot: root, worktreeRoot: wtRoot, repository: 'o/r', runner, sleep: () => {} }).ship({ cardId: CARD, base: 'main', mode: 'remote' });
  return { r, calls, head };
}

/** A real git main checkout on branch `trunk` and the card's worktree with one commit, under a directory the `after` hook removes. */
function gitRepo() {
  const root = realpathSync.native(tmpDir());
  dirs.push(root);
  const main = path.join(root, 'main');
  const wtRoot = path.join(root, 'wt');
  mkdirSync(main);
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git(main, 'init', '-q', '-b', 'trunk');
  for (const [k, v] of [['user.name', 't'], ['user.email', 't@example.invalid'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(main, 'config', k!, v!);
  writeFileSync(path.join(main, '.gitignore'), '.review/\n');
  writeFileSync(path.join(main, 'base.txt'), 'base\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'base');
  const wt = path.join(wtRoot, CARD);
  git(main, 'worktree', 'add', '-q', '-b', CARD, wt);
  writeFileSync(path.join(wt, 'card.txt'), 'card\n');
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 'card');
  const head = git(wt, 'rev-parse', 'HEAD');
  mkdirSync(path.join(wt, '.review'));
  writeFileSync(path.join(wt, '.review', `${CARD}.json`), JSON.stringify({ verdict: 'pass', reasons: [], sha: head }));
  return { main, wtRoot, count: () => Number(git(main, 'rev-list', '--count', 'trunk')) };
}

test('after a reconcile the card ships again without a second effect [R6]', () => {
  for (const status of ['succeeded', 'failed', 'cancelled', 'running', 'UNKNOWN'] as const) {
    const fx = makeFixture();
    try {
      const ship = new UnknownFirst();
      const { goal, next } = atShip(fx, ship);
      next();
      const first = mergeOps(fx)[0]!;
      reconcile(fx, goal.id, first.id, status);
      const r = next();
      if (status === 'running' || status === 'UNKNOWN') {
        assert.equal(r.directive.kind, 'wait', status);
        assert.match(r.directive.narration, status === 'running' ? /attached to running operation/ : /reconciling unknown operations/, status);
        assert.equal(ship.requests.length, 1, `${status}: nothing ships`);
        assert.equal(mergeOps(fx).length, 1, status);
      } else {
        assert.equal(r.directive.kind, 'close', `${status}: ${r.directive.narration}`);
        assert.equal(ship.requests.length, 2, `${status}: one more ship`);
        const ops = mergeOps(fx);
        assert.deepEqual(ops.map((o) => [o.id === first.id, o.status]), [[true, status], [false, 'succeeded']], `${status}: a new merge intent`);
        assert.equal(fx.events(goal.id).filter((e) => e.type === 'OPERATION_INTENT').length, 2, status);
      }
    } finally {
      fx.cleanup();
    }
  }
  // Remote path: a PR GitHub reports MERGED ends the re-ship at the lookup; an open PR is reused.
  const merged = scriptedShip({ 'gh pr list': { stdout: JSON.stringify([{ number: 42, state: 'MERGED', headRefOid: 'a'.repeat(40), baseRefName: 'main' }]) } });
  assert.equal(merged.r.outcome, 'merged', merged.r.receipt.stdout);
  assert.deepEqual(merged.calls.filter((c) => c.startsWith('git push') || c.startsWith('gh pr create') || c.startsWith('gh pr merge')), []);
  const open = scriptedShip({ 'gh pr list': { stdout: JSON.stringify([{ number: 42, state: 'OPEN', headRefOid: 'a'.repeat(40), baseRefName: 'main' }]) } });
  assert.equal(open.r.outcome, 'merged', open.r.receipt.stdout);
  assert.equal(open.r.prNumber, 42);
  assert.deepEqual(open.calls.filter((c) => c.startsWith('gh pr create')), []);
  // Local mode, real git: the merge took place although its receipt timed out; the re-ship merges nothing more.
  const repo = gitRepo();
  const login = scriptedRunner({ 'gh api user -q .login': { stdout: 'alice\n' } });
  const realGit = (mergeTimesOut: boolean): SyncRunner => (cmd, args, o) => {
    if (cmd === 'gh') return login(cmd, args, o);
    const r = runSync(cmd, args, o);
    return mergeTimesOut && args[0] === 'merge' && args.includes('--no-edit') ? { ...r, exitCode: null, timedOut: true } : r;
  };
  const shipLocal = (mergeTimesOut: boolean) => new GitHubShipPath({ mainRoot: repo.main, worktreeRoot: repo.wtRoot, repository: 'o/r', runner: realGit(mergeTimesOut), sleep: () => {} }).ship({ cardId: CARD, base: 'trunk', mode: 'local' });
  const before = repo.count();
  const timedOut = shipLocal(true);
  assert.equal(timedOut.outcome, 'effect-unknown', timedOut.receipt.stdout);
  const afterMerge = repo.count();
  assert.ok(afterMerge > before, 'the timed-out merge took place');
  const again = shipLocal(false);
  assert.equal(again.outcome, 'merged', again.receipt.stdout);
  assert.equal(repo.count(), afterMerge, 'no second merge commit');
});

test('readers of the waiting card [R5] [R6]', () => {
  const fx = makeFixture();
  const clean = makeFixture();
  try {
    const ship = new UnknownFirst();
    const { goal, next } = atShip(fx, ship);
    const bounds = () => summarizeBounds([fx.goal(goal.id)], fx.store.listCardRuns(goal.id));
    const boundsBefore = bounds();
    next();
    const op = mergeOps(fx)[0]!;
    assert.ok(fx.controller.writeBoard(fx.goal(goal.id)).includes(`| [?] | ${CARD} | WAIT |`), 'the board shows the card as WAIT');
    assert.deepEqual(bounds(), boundsBefore, 'no bound fired');
    const audit = () => verifyAudit({ goalId: goal.id, journal: fx.journal(goal.id), operations: fx.ops, now: fx.now() }).findings;
    assert.deepEqual(audit().filter((f) => f.code === 'OP_UNKNOWN').map((f) => f.detail.includes(op.id)), [true]);
    reconcile(fx, goal.id, op.id, 'succeeded');
    assert.equal(next().directive.kind, 'close');
    const facts = (findings: ReturnType<typeof audit>) => findings.filter((f) => f.code.startsWith('FACT_')).map((f) => [f.code, f.detail]);
    assert.deepEqual(audit().filter((f) => f.code === 'OP_UNKNOWN'), []);
    // The same fact warnings as a fault-free dry-run ship of the card.
    const plain = atShip(clean, new DryRunShipPath(['merged']));
    assert.equal(plain.next().directive.kind, 'close');
    assert.deepEqual(facts(audit()), facts(verifyAudit({ goalId: plain.goal.id, journal: clean.journal(plain.goal.id), operations: clean.ops, now: clean.now() }).findings));
  } finally {
    fx.cleanup();
    clean.cleanup();
  }
});
