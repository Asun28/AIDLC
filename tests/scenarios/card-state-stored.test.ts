import assert from 'node:assert/strict';
import fs, { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, candidateShaFor, actorA, actorB, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { DEFAULT_LEASE_TTL_MS } from '../../src/coordination/lease.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { MINUTE_MS, type JournalEvent } from '../../src/core/types.ts';

// Card T0-CARD-STATE-STORED (issue 511): the CARD_STATE of a SHIP or PREPARE selection names the state each card-run write of
// its branch stores and is journaled after that write. Interleavings are injected by wrapping the store's write methods,
// never by timing.

const CARD = 'T1-A';

const states = (events: JournalEvent[]) => events.filter((e) => e.type === 'CARD_STATE' && e.cardId === CARD);
const transitions = (events: JournalEvent[], from: string, to: string) => states(events).filter((e) => e.data['from'] === from && e.data['to'] === to);
const toState = (events: JournalEvent[], to: string) => states(events).filter((e) => e.data['to'] === to);

/** A landed card-run write: the state before and after it, and the journal length right after it landed. */
type Landed = { from: string | undefined; to: string; journal: number };

/**
 * Wrap `fx.store.updateCardRun`, which `saveCardRun` calls too: `before` runs once, right before the first write of the
 * card, and every write that lands is recorded with the state it replaced and the journal length once it landed.
 */
function wrapWrites(fx: Fixture, goalId: string, hooks: { before?: () => void } = {}): Landed[] {
  const real = fx.store.updateCardRun.bind(fx.store);
  const landed: Landed[] = [];
  let fired = false;
  fx.store.updateCardRun = (g, c, change, within) => {
    if (!fired && hooks.before && c === CARD) {
      fired = true;
      hooks.before();
    }
    let from: string | undefined;
    const saved = real(g, c, (current) => {
      from = current?.state;
      return change(current);
    }, within);
    if (c === CARD) landed.push({ from, to: saved.state, journal: fx.events(goalId).length });
    return saved;
  };
  return landed;
}

/** A card driven to BUILD with a successful attempt, so the next `card next` selects SHIP and ships through `shipPath`. */
function builtCandidate(fx: Fixture, shipPath: DryRunShipPath): { goalId: string; runner: CardRunner } {
  writeCard(fx, { id: CARD, title: 'a' });
  const goal = goalForCards(fx, [CARD]);
  const runner = fx.runner(shipPath);
  let r = runner.next(fx.goal(goal.id), fx.card(CARD), fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  r = runner.next(fx.goal(goal.id), fx.card(CARD), r.run);
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  runner.recordAttempt(fx.goal(goal.id), fx.card(CARD), r.run, { outcome: 'success', dodReceipt: `dod:${CARD}`, redReceipt: `red:${CARD}`, candidateSha: candidateShaFor(CARD) });
  return { goalId: goal.id, runner };
}

/** Each CARD_STATE of `events` from index `start` matches, in order, a landed write that changed the state, and follows it. */
function assertStoredChanges(events: JournalEvent[], start: number, landed: Landed[]): void {
  const changes = landed.filter((w) => w.from !== undefined && w.from !== w.to);
  const journaled = states(events.slice(start));
  assert.deepEqual(journaled.map((e) => [e.data['from'], e.data['to']]), changes.map((w) => [w.from, w.to]), 'one CARD_STATE per change of the stored state, naming that change');
  journaled.forEach((e, i) => assert.ok(events.indexOf(e) >= changes[i]!.journal, `the CARD_STATE ${String(e.data['from'])} to ${String(e.data['to'])} follows the write that stored it`));
}

for (const outcome of ['merged', 'auth-failed'] as const) {
  test(`T0-CARD-STATE-STORED acceptance 1: a ship (${outcome}) journals the state each of its writes stored, after that write, and no SHIP the record never held [R1] [R2] [R5]`, () => {
    const fx = makeFixture({ actor: actorA });
    try {
      const { goalId, runner } = builtCandidate(fx, new DryRunShipPath([outcome]));
      const before = fx.store.getCardRun(goalId, CARD)!;
      assert.equal(before.state, 'BUILD');
      const start = fx.events(goalId).length;
      const landed = wrapWrites(fx, goalId);
      runner.next(fx.goal(goalId), fx.card(CARD), before);
      const events = fx.events(goalId);
      const stored = landed.map((w) => w.to);
      if (!stored.includes('SHIP')) assert.deepEqual(toState(events.slice(start), 'SHIP'), [], 'no CARD_STATE to SHIP when no write stored SHIP');
      assertStoredChanges(events, start, landed);
      if (outcome === 'merged') {
        assert.equal(fx.store.getCardRun(goalId, CARD)!.state, 'CLOSE');
        const closes = transitions(events, 'BUILD', 'CLOSE');
        assert.equal(closes.length, 1, 'exactly one BUILD to CLOSE');
        assert.deepEqual(Object.keys(closes[0]!.data).sort(), ['eventKey', 'from', 'reason', 'to'], 'the data of an owed CARD_STATE, without completed');
        assert.equal(closes[0]!.data['reason'], 'merge verified; complete only missing closure steps', 'the reason of the close directive the merge leads to');
      }
      for (const e of states(events.slice(start))) {
        if (e.data['to'] === 'STOP') assert.equal(e.data['reason'], fx.store.getCardRun(goalId, CARD)!.stop?.detail, 'a STOP carries its stop detail');
        assert.doesNotMatch(String(e.data['reason']), /action stored/, 'no reason made up from the state names');
      }
    } finally {
      setActorForTests(actorA);
      fx.cleanup();
    }
  });
}

test('T0-CARD-STATE-STORED acceptance 2: a refused first ship write (the WAIT of an unreconciled CI rerun) leaves no CARD_STATE; the next card next journals one for its landed write [R2] [R3]', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const { goalId, runner } = builtCandidate(fx, new DryRunShipPath(['merged']));
    const built = fx.store.getCardRun(goalId, CARD)!;
    fx.store.saveCardRun({ ...built, ci: { reruns: [{ runId: 'r1', attempt: 1, candidate: candidateShaFor(CARD), requestedAt: fx.now(), outcome: 'requested' }] } });
    const start = fx.events(goalId).length;
    wrapWrites(fx, goalId, { before: () => fx.store.updateCardRun(goalId, CARD, (current) => ({ ...current!, blocker: 'written meanwhile' })) });
    assert.throws(() => runner.next(fx.goal(goalId), fx.card(CARD), fx.store.getCardRun(goalId, CARD)!), /changed since it was read/, 'the WAIT save is refused as stale');
    assert.deepEqual(states(fx.events(goalId).slice(start)), [], 'the refused call journals no CARD_STATE');
    const r = runner.next(fx.goal(goalId), fx.card(CARD), fx.store.getCardRun(goalId, CARD)!);
    assert.equal(r.directive.kind, 'wait', r.directive.narration);
    const journaled = states(fx.events(goalId).slice(start));
    assert.deepEqual(journaled.map((e) => [e.data['from'], e.data['to']]), [['BUILD', 'WAIT']], 'one CARD_STATE, for the landed WAIT write');
    assert.equal(r.directive.kind === 'wait' && r.directive.on, 'ci-rerun');
    assert.equal(journaled[0]!.data['reason'], 'ci-rerun', 'the reason of the WAIT directive the write leads to');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

/** A card session B prepared and built, its lease expired, and the clock past it; session A dispatches next. */
function expiredB(): { fx: Fixture; goalId: string } {
  const fx = makeFixture({ actor: actorA });
  writeCard(fx, { id: CARD, title: 'print hello' });
  const goal = goalForCards(fx, [CARD]);
  setActorForTests(actorB);
  fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!);
  assert.equal(fx.store.getCardRun(goal.id, CARD)?.state, 'BUILD');
  fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
  setActorForTests(actorA);
  return { fx, goalId: goal.id };
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
}


/** A goal projecting the card in a real git repository, with `card next` on the github ship path (prepare-worktree.test.ts). */
function githubRepo(fx: Fixture): { goalId: string; worktree: string; next: () => ReturnType<CardRunner['next']> } {
  writeCard(fx, { id: CARD, title: 'a' });
  const goal = goalForCards(fx, [CARD]);
  writeFileSync(path.join(fx.tmp, '.gitignore'), '.aidlc/\nwt/\n');
  git(fx.tmp, ['init', '-q', '-b', 'main']);
  git(fx.tmp, ['add', '-A']);
  git(fx.tmp, ['commit', '-q', '-m', 'base']);
  mkdirSync(path.join(fx.tmp, 'wt'), { recursive: true });
  const root = realpathSync.native(path.join(fx.tmp, 'wt'));
  const mainRoot = realpathSync.native(fx.tmp);
  const runner = new CardRunner({ paths: fx.paths, repo: { ...fx.repo, mainRoot, worktreeRoot: mainRoot }, config: { ...fx.config, shipPath: 'github', worktreeRoot: root }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now });
  const next = () => runner.next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD) ?? fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  return { goalId: goal.id, worktree: path.join(root, CARD), next };
}

test('T0-CARD-STATE-STORED acceptance 3, expired lease: PREPARE stores STOP and journals one CARD_STATE to STOP with the stop detail, none to PREPARE [R2] [R5]', () => {
  const { fx, goalId } = expiredB();
  try {
    const start = fx.events(goalId).length;
    const r = fx.runner().next(fx.goal(goalId), fx.card(CARD), fx.store.getCardRun(goalId, CARD)!);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    const stored = fx.store.getCardRun(goalId, CARD)!;
    assert.equal(stored.state, 'STOP');
    const events = fx.events(goalId).slice(start);
    const stops = toState(events, 'STOP');
    assert.equal(stops.length, 1, 'one CARD_STATE to STOP');
    assert.equal(stops[0]!.data['reason'], stored.stop?.detail, 'the reason is the stop detail');
    assert.deepEqual(toState(events, 'PREPARE'), [], 'none to PREPARE, a state the record never held');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-CARD-STATE-STORED acceptance 3, attach: a PREPARE that attaches an existing worktree stores BUILD and journals one CARD_STATE to BUILD, none to PREPARE [R2] [R5]', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const { goalId, worktree, next } = githubRepo(fx);
    const first = next();
    assert.equal(first.directive.kind === 'prepare' && first.directive.action, 'start', first.directive.narration);
    git(fx.tmp, ['worktree', 'add', '-q', '-b', CARD, worktree]);
    const start = fx.events(goalId).length;
    const attach = next();
    assert.equal(attach.directive.kind === 'prepare' && attach.directive.action, 'attach', attach.directive.narration);
    assert.equal(fx.store.getCardRun(goalId, CARD)?.state, 'BUILD');
    const journaled = states(fx.events(goalId).slice(start));
    assert.deepEqual(journaled.map((e) => [e.data['from'], e.data['to']]), [['PREPARE', 'BUILD']], 'one CARD_STATE to BUILD, none to PREPARE');
    assert.match(String(journaled[0]!.data['reason']), /^attach /, 'the reason of the attach decision');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-CARD-STATE-STORED acceptance 3, start: a PREPARE that starts a worktree from a run stored in BUILD journals one CARD_STATE to PREPARE [R2] [R5]', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const { goalId, next } = githubRepo(fx);
    const run = fx.controller.ensureCardRun(fx.goal(goalId), CARD);
    fx.store.saveCardRun({ ...run, state: 'BUILD' });
    const start = fx.events(goalId).length;
    const r = next();
    assert.equal(r.directive.kind === 'prepare' && r.directive.action, 'start', r.directive.narration);
    assert.equal(fx.store.getCardRun(goalId, CARD)?.state, 'PREPARE');
    assert.deepEqual(states(fx.events(goalId).slice(start)).map((e) => [e.data['from'], e.data['to']]), [['BUILD', 'PREPARE']], 'one CARD_STATE to PREPARE');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

/** Make `fs.appendFileSync` throw on CARD_STATE lines: once, or on every one while `persistent` is set. */
function failStateAppends(persistent: boolean): { restore: () => void; fired: () => number } {
  const real = fs.appendFileSync;
  let fired = 0;
  fs.appendFileSync = ((...args: Parameters<typeof fs.appendFileSync>) => {
    if ((persistent || fired === 0) && String(args[1]).includes('"type":"CARD_STATE"')) {
      fired += 1;
      throw Object.assign(new Error('EIO: injected fault on a CARD_STATE line'), { code: 'EIO' });
    }
    return real(...args);
  }) as typeof fs.appendFileSync;
  syncBuiltinESMExports();
  return { restore: () => { fs.appendFileSync = real; syncBuiltinESMExports(); }, fired: () => fired };
}

for (const persistent of [false, true]) {
  test(`T0-CARD-STATE-STORED acceptance 4: a ${persistent ? 'persistent' : 'one-shot'} CARD_STATE append fault after the merged ship result landed: card next returns CLOSE, settles the ship, leaves the event owed and undelivered, and the next card next appends it once, completed [R4]`, () => {
    const fx = makeFixture({ actor: actorA });
    let fault = { restore: () => undefined as void, fired: () => 0 };
    try {
      const { goalId, runner } = builtCandidate(fx, new DryRunShipPath(['merged']));
      fault = failStateAppends(persistent);
      const r = runner.next(fx.goal(goalId), fx.card(CARD), fx.store.getCardRun(goalId, CARD)!);
      fault.restore();
      assert.ok(fault.fired() >= 1, 'the fault fired');
      assert.equal(r.directive.kind, 'close', r.directive.narration);
      const stored = fx.store.getCardRun(goalId, CARD)!;
      assert.equal(stored.state, 'CLOSE', 'the result write landed');
      assert.deepEqual(fx.ops.list({ goalId, cardId: CARD, kind: 'merge' }).map((o) => o.status), ['succeeded'], 'the merge operation is settled');
      assert.deepEqual(fx.queue.list().map((q) => q.state), ['completed'], 'the pool request is completed');
      assert.deepEqual(transitions(fx.events(goalId), 'BUILD', 'CLOSE'), [], 'the command journals no BUILD to CLOSE');
      const owed = (stored.journalOwed ?? []).filter((o) => o.type === 'CARD_STATE' && o.data['to'] === 'CLOSE');
      assert.equal(owed.length, 1, 'one CARD_STATE owed on the run');
      runner.next(fx.goal(goalId), fx.card(CARD), fx.store.getCardRun(goalId, CARD)!);
      const closes = transitions(fx.events(goalId), 'BUILD', 'CLOSE');
      assert.equal(closes.length, 1, 'the next card next appends it once');
      assert.equal(closes[0]!.data['completed'], true, 'marked completed');
      assert.equal(closes[0]!.data['eventKey'], owed[0]!.key);
      runner.next(fx.goal(goalId), fx.card(CARD), fx.store.getCardRun(goalId, CARD)!);
      assert.equal(transitions(fx.events(goalId), 'BUILD', 'CLOSE').length, 1, 'a third card next appends none');
    } finally {
      fault.restore();
      setActorForTests(actorA);
      fx.cleanup();
    }
  });
}
const OUTCOMES = ['merged', 'dod-failed', 'verify-failed', 'scope-blocked', 'budget-over', 'license-blocked', 'secrets-blocked', 'review-blocked', 'review-no-verdict', 'ci-red', 'ci-timeout', 'push-failed', 'pr-failed', 'merge-failed', 'auth-failed', 'no-reviewer', 'red-missing', 'merge-unconfirmed', 'effect-unknown', 'unclassified'] as const;

test('T0-CARD-STATE-STORED R3 decision 2: from a record stored in SHIP, every ship outcome journals each stored change with the reason of the directive it leads to, never the selection reason for another state, and no second CLOSE to DONE [R2] [R5]', () => {
  for (const outcome of OUTCOMES) {
    const fx = makeFixture({ actor: actorA });
    try {
      const { goalId, runner } = builtCandidate(fx, new DryRunShipPath([outcome]));
      // A record already stored in SHIP (a ship stopped at the driver boundary): every change the ship makes leaves SHIP.
      fx.store.saveCardRun({ ...fx.store.getCardRun(goalId, CARD)!, state: 'SHIP' });
      const start = fx.events(goalId).length;
      const landed = wrapWrites(fx, goalId);
      let r: ReturnType<CardRunner['next']> | undefined;
      try {
        r = runner.next(fx.goal(goalId), fx.card(CARD), fx.store.getCardRun(goalId, CARD)!);
      } catch {
        /* a throwing outcome is judged by its writes alone */
      }
      const events = fx.events(goalId);
      assertStoredChanges(events, start, landed);
      const stored = fx.store.getCardRun(goalId, CARD)!;
      for (const e of states(events.slice(start))) {
        const to = String(e.data['to']);
        const reason = String(e.data['reason']);
        if (to === 'STOP') assert.equal(reason, stored.stop?.detail, `${outcome}: a STOP carries its stop detail`);
        else if (to !== 'SHIP') assert.notEqual(reason, 'dispatch/resume the existing ship path with preserved base and mode', `${outcome}: ${to} does not carry the SHIP selection reason (${reason})`);
        if (to === 'WAIT' && r?.directive.kind === 'wait' && stored.state === 'WAIT') assert.equal(reason, r.directive.on, `${outcome}: a WAIT carries its directive's on`);
      }
      assert.ok(transitions(events, 'CLOSE', 'DONE').length <= 1, `${outcome}: at most one CLOSE to DONE`);
    } finally {
      setActorForTests(actorA);
      fx.cleanup();
    }
  }
});
test('T0-CARD-STATE-STORED R3 decision 2: a merged ship whose closure is already complete journals one CLOSE to DONE, from close, not a second one from the DONE write [R5]', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const { goalId, runner } = builtCandidate(fx, new DryRunShipPath(['merged']));
    const built = fx.store.getCardRun(goalId, CARD)!;
    fx.store.saveCardRun({ ...built, closure: Object.fromEntries(Object.keys(built.closure).map((k) => [k, true])) as typeof built.closure });
    runner.next(fx.goal(goalId), fx.card(CARD), fx.store.getCardRun(goalId, CARD)!);
    assert.equal(fx.store.getCardRun(goalId, CARD)!.state, 'DONE', 'the close completes the card');
    assert.equal(transitions(fx.events(goalId), 'CLOSE', 'DONE').length, 1, 'one CLOSE to DONE');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});