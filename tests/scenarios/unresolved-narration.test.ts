// Card T0-UNRESOLVED-NARRATION: the wait of `aidlc next` on unresolved operations names each operation, tells an issued or
// running one (may still be running) from an intended or UNKNOWN one (no recorded outcome), and asks to check before
// recording; what `next` decides is unchanged.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, type TestContext } from 'node:test';
import { makeFixture, writeCard, goalForCards, actorA, actorB, T0 } from './_harness.ts';
import { cleanup } from '../infra/helpers.ts';
import { Journal, setActorForTests } from '../../src/state/journal.ts';
import { resourceKeys } from '../../src/coordination/lease.ts';
import { OperationKind, MINUTE_MS, addMs } from '../../src/core/types.ts';
import type { Directive } from '../../src/loop/directive.ts';

type Fx = ReturnType<typeof makeFixture>;
type Shape = 'intended' | 'issued' | 'running' | 'UNKNOWN' | 'succeeded' | 'failed' | 'cancelled';
interface Row {
  kind: (typeof OperationKind.options)[number];
  m: number;
  shape: Shape;
  cardId?: string;
}

const GRACE_END = '2026-09-11T12:05:00.000Z';
const HEAD = (n: number) => `No new mutation is admitted while ${n} operation(s) of this goal are unresolved.`;
const CMD = (id: string) => `\`aidlc ops reconcile ${id} --status <succeeded|failed|running|cancelled|UNKNOWN>\``;
const card = (cardId: string | undefined) => (cardId ? `, card ${cardId}` : '');
const MAY = (id: string, kind: string, status: string, cardId?: string) => `Operation ${id} (${kind}, ${status}${card(cardId)}) may still be running; check the issuing command and provider before recording its current outcome with ${CMD(id)}.`;
const NONE = (id: string, kind: string, status: string, cardId?: string) => `Operation ${id} (${kind}, ${status}${card(cardId)}) has no recorded outcome; check the issuing command and provider before recording its current outcome with ${CMD(id)}.`;

interface Spies {
  unresolvedCalls: () => number;
  resetCalls: () => void;
  saveGoal: () => number;
  append: () => number;
  writeBoard: () => number;
}

interface Setup {
  fx: Fx;
  goalId: string;
  ids: string[];
  spies: Spies;
}

/** A fresh T1 goal in RUN with the rows written to the ledger, then the spies installed; everything is removed in `t.after`. */
function setup(t: TestContext, rows: Row[]): Setup {
  const fx = makeFixture();
  const journalAppend = Journal.prototype.append;
  t.after(() => {
    Journal.prototype.append = journalAppend;
    delete (fx.ops as { unresolved?: unknown }).unresolved;
    delete (fx.store as { saveGoal?: unknown }).saveGoal;
    delete (fx.controller as { writeBoard?: unknown }).writeBoard;
    setActorForTests(actorA);
    cleanup(fx.tmp);
  });
  writeCard(fx, { id: 'T1-A', title: 'first' });
  writeCard(fx, { id: 'T1-B', title: 'second' });
  const goalId = goalForCards(fx, ['T1-A', 'T1-B'], { size: 'T1' }).id;
  const ids: string[] = [];
  for (const row of rows) {
    const at = addMs(T0, -row.m * MINUTE_MS);
    const intent = { kind: row.kind, goalId, target: 'main', ownerGeneration: 0, timeoutMs: 60_000, ...(row.cardId === undefined ? {} : { cardId: row.cardId }) };
    const id = fx.ops.recordIntent(intent, at).id;
    ids.push(id);
    if (row.shape === 'issued') fx.ops.markIssued(id, undefined, at);
    else if (row.shape === 'running') fx.ops.markRunning(id, at);
    else if (row.shape === 'UNKNOWN') {
      fx.ops.markIssued(id, undefined, at);
      fx.ops.markResult(id, 'UNKNOWN', { error: 'gh did not answer' }, at);
    } else if (row.shape !== 'intended') fx.ops.markResult(id, row.shape, {}, at);
  }
  let calls = 0;
  const realUnresolved = fx.ops.unresolved.bind(fx.ops);
  fx.ops.unresolved = (g: string, c?: string) => {
    calls += 1;
    const all = realUnresolved(g, c);
    return calls === 1 ? all : all.slice(1);
  };
  let saves = 0;
  const realSave = fx.store.saveGoal.bind(fx.store);
  fx.store.saveGoal = (g) => {
    saves += 1;
    return realSave(g);
  };
  let appends = 0;
  Journal.prototype.append = function (this: Journal, input: Parameters<Journal['append']>[0]) {
    appends += 1;
    return journalAppend.call(this, input);
  };
  let boards = 0;
  const realBoard = (fx.controller as unknown as { writeBoard: (...a: unknown[]) => unknown }).writeBoard.bind(fx.controller);
  (fx.controller as unknown as { writeBoard: (...a: unknown[]) => unknown }).writeBoard = (...a: unknown[]) => {
    boards += 1;
    return realBoard(...a);
  };
  return { fx, goalId, ids, spies: { unresolvedCalls: () => calls, resetCalls: () => void (calls = 0), saveGoal: () => saves, append: () => appends, writeBoard: () => boards } };
}

/** `next` once, asserting one ledger read and no write; returns the directive. */
function readOnlyNext(s: Setup): Directive {
  const { fx, goalId, spies } = s;
  const bytes = readFileSync(fx.store.goalFile(goalId), 'utf8');
  const events = fx.events(goalId);
  spies.resetCalls();
  const [saves, appends, boards] = [spies.saveGoal(), spies.append(), spies.writeBoard()];
  const directive = fx.controller.next(goalId);
  assert.equal(spies.unresolvedCalls(), 1, 'one ledger read');
  assert.equal(spies.saveGoal(), saves, 'no goal save');
  assert.equal(spies.append(), appends, 'no journal append');
  assert.equal(spies.writeBoard(), boards, 'no board write');
  assert.equal(readFileSync(fx.store.goalFile(goalId), 'utf8'), bytes, 'goal file unchanged');
  assert.deepEqual(fx.events(goalId), events, 'journal unchanged');
  assert.deepEqual(fx.store.listCardRuns(goalId), [], 'no card dispatched');
  return directive;
}

function assertWait(d: Directive, ids: string[], narration: string): void {
  assert.equal(d.kind, 'wait');
  if (d.kind !== 'wait') return;
  assert.equal(d.on, `reconcile:${ids.join(',')}`);
  assert.equal(d.until, GRACE_END);
  assert.equal(d.pollSeconds, 60);
  assert.equal(d.narration, narration);
}

test('an issued or a running operation may still be running, and the goal still waits on it', async (t) => {
  await t.test('control: no record, run-card', (u) => {
    const s = setup(u, []);
    assert.equal(s.fx.controller.next(s.goalId).kind, 'run-card');
  });
  await t.test('(a) an issued merge past its timeout', (u) => {
    const s = setup(u, [{ kind: 'merge', m: 30, shape: 'issued', cardId: 'T1-A' }]);
    const id = s.ids[0]!;
    assertWait(
      readOnlyNext(s),
      [id],
      `No new mutation is admitted while 1 operation(s) of this goal are unresolved. Operation ${id} (merge, issued, card T1-A) may still be running; check the issuing command and provider before recording its current outcome with \`aidlc ops reconcile ${id} --status <succeeded|failed|running|cancelled|UNKNOWN>\`.`,
    );
  });
  await t.test('(b) a running ci-rerun', (u) => {
    const s = setup(u, [{ kind: 'ci-rerun', m: 20, shape: 'running', cardId: 'T1-B' }]);
    const id = s.ids[0]!;
    assertWait(
      readOnlyNext(s),
      [id],
      `No new mutation is admitted while 1 operation(s) of this goal are unresolved. Operation ${id} (ci-rerun, running, card T1-B) may still be running; check the issuing command and provider before recording its current outcome with \`aidlc ops reconcile ${id} --status <succeeded|failed|running|cancelled|UNKNOWN>\`.`,
    );
  });
});

test('an UNKNOWN operation has no recorded outcome', (t) => {
  const s = setup(t, [{ kind: 'merge', m: 30, shape: 'UNKNOWN', cardId: 'T1-A' }]);
  const id = s.ids[0]!;
  assertWait(
    readOnlyNext(s),
    [id],
    `No new mutation is admitted while 1 operation(s) of this goal are unresolved. Operation ${id} (merge, UNKNOWN, card T1-A) has no recorded outcome; check the issuing command and provider before recording its current outcome with \`aidlc ops reconcile ${id} --status <succeeded|failed|running|cancelled|UNKNOWN>\`.`,
  );
});

test('an intended operation has no recorded outcome, and a card id is written as stored', async (t) => {
  const rows: Array<[string, Row, string, string | undefined]> = [
    ['(a) no card id', { kind: 'deploy', m: 30, shape: 'intended' }, 'deploy', undefined],
    ['(b) an empty card id', { kind: 'review', m: 30, shape: 'intended', cardId: '' }, 'review', undefined],
    ['(c) a white-space card id', { kind: 'merge', m: 30, shape: 'intended', cardId: ' ' }, 'merge', ' '],
    ['(d) a card the goal does not project', { kind: 'merge', m: 30, shape: 'intended', cardId: 'T9-OTHER' }, 'merge', 'T9-OTHER'],
  ];
  for (const [name, row, kind, stored] of rows) {
    await t.test(name, (u) => {
      const s = setup(u, [row]);
      const id = s.ids[0]!;
      const shown = stored === undefined ? '' : `, card ${stored}`;
      assertWait(readOnlyNext(s), [id], `${HEAD(1)} Operation ${id} (${kind}, intended${shown}) has no recorded outcome; check the issuing command and provider before recording its current outcome with ${CMD(id)}.`);
    });
  }
});

const MIXED: Row[] = [
  { kind: 'merge', m: 50, shape: 'UNKNOWN', cardId: 'T1-B' },
  { kind: 'merge', m: 45, shape: 'succeeded', cardId: 'T1-A' },
  { kind: 'merge', m: 40, shape: 'issued', cardId: 'T1-A' },
  { kind: 'deploy', m: 30, shape: 'intended' },
  { kind: 'review', m: 25, shape: 'failed', cardId: 'T1-B' },
  { kind: 'ci-rerun', m: 20, shape: 'running', cardId: 'T1-A' },
  { kind: 'deploy', m: 15, shape: 'cancelled' },
];
const mixedNarration = (ids: string[]) => {
  const [o1, o2, o3, o4] = [ids[0]!, ids[2]!, ids[3]!, ids[5]!];
  return `${HEAD(4)} ${NONE(o1, 'merge', 'UNKNOWN', 'T1-B')} ${MAY(o2, 'merge', 'issued', 'T1-A')} ${NONE(o3, 'deploy', 'intended')} ${MAY(o4, 'ci-rerun', 'running', 'T1-A')}`;
};

test('several unresolved operations are named in ledger order, each with its class', async (t) => {
  await t.test('(a) four unresolved among terminal ones', (u) => {
    const s = setup(u, MIXED);
    const open = [s.ids[0]!, s.ids[2]!, s.ids[3]!, s.ids[5]!];
    assertWait(readOnlyNext(s), open, mixedNarration(s.ids));
  });
  await t.test('(b) all twelve kinds', (u) => {
    const kinds = OperationKind.options;
    assert.equal(kinds.length, 12);
    const s = setup(
      u,
      kinds.map((kind, i) => ({ kind, m: 60 - i, shape: 'intended' as const })),
    );
    const sentences = s.ids.map((id, i) => NONE(id, kinds[i]!, 'intended'));
    assert.equal(kinds[0], 'deploy');
    assert.equal(kinds[11], 'other');
    assertWait(readOnlyNext(s), s.ids, `${HEAD(12)} ${sentences.join(' ')}`);
  });
});

test('what next decides around the narration is unchanged', async (t) => {
  await t.test('(a) terminal before reconciliation', async (u) => {
    for (const [label, patch] of [
      ['terminal flag', { terminal: true }],
      ['DONE', { state: 'DONE' }],
      ['STOP', { state: 'STOP' }],
    ] as const) {
      await u.test(label, (v) => {
        const s = setup(v, MIXED);
        const goal = s.fx.goal(s.goalId);
        s.fx.store.saveGoal({ ...goal, ...patch } as typeof goal);
        s.spies.resetCalls();
        const d = s.fx.controller.next(s.goalId);
        assert.equal(s.spies.unresolvedCalls(), 0, 'no ledger read');
        if (label === 'DONE') assert.equal(d.kind, 'done');
        else {
          assert.equal(d.kind, 'stop');
          assert.equal(d.narration, 'Goal is terminal. Late wakeups do no new work.');
        }
      });
    }
  });
  await t.test('(b) all terminal: run-card', (u) => {
    const s = setup(u, MIXED);
    const at = addMs(T0, -10 * MINUTE_MS);
    s.fx.ops.markResult(s.ids[0]!, 'failed', {}, at);
    s.fx.ops.markResult(s.ids[2]!, 'succeeded', {}, at);
    s.fx.ops.markResult(s.ids[3]!, 'cancelled', {}, at);
    s.fx.ops.markResult(s.ids[5]!, 'failed', {}, at);
    assert.equal(s.fx.controller.next(s.goalId).kind, 'run-card');
  });
  await t.test('(c) inside the grace, still waiting', (u) => {
    const s = setup(u, MIXED);
    const open = [s.ids[0]!, s.ids[2]!, s.ids[3]!, s.ids[5]!];
    const atT0 = readOnlyNext(s);
    assert.equal(atT0.kind, 'wait');
    s.fx.advance(Date.parse('2026-09-11T12:01:00.000Z') - Date.parse(s.fx.now()));
    assertWait(readOnlyNext(s), open, atT0.narration);
    assert.equal(s.fx.goal(s.goalId).state, 'RUN');
  });
  await t.test('(d) at the end of the grace, STOP', (u) => {
    const s = setup(u, MIXED);
    const open = [s.ids[0]!, s.ids[2]!, s.ids[3]!, s.ids[5]!];
    s.fx.advance(Date.parse(GRACE_END) - Date.parse(s.fx.now()));
    const d = s.fx.controller.next(s.goalId);
    assert.equal(d.kind, 'stop');
    if (d.kind !== 'stop') return;
    assert.equal(d.narration, 'Reconciliation grace expired.');
    assert.equal(d.stop.reason, 'time');
    assert.equal(d.stop.detail, 'reconciliation grace expired with unresolved operations');
    assert.deepEqual(d.stop.unresolvedOperations, open);
    assert.equal(s.fx.goal(s.goalId).state, 'STOP');
  });
  await t.test('(e) reconciliation before ownership', (u) => {
    const s = setup(u, [{ kind: 'merge', m: 30, shape: 'issued', cardId: 'T1-A' }]);
    setActorForTests(actorB);
    const first = s.fx.controller.next(s.goalId);
    assert.equal(first.kind, 'wait');
    assert.equal(first.kind === 'wait' ? first.on : '', `reconcile:${s.ids[0]}`);
    s.fx.ops.markResult(s.ids[0]!, 'succeeded', {}, addMs(T0, -10 * MINUTE_MS));
    const second = s.fx.controller.next(s.goalId);
    assert.equal(second.kind, 'wait');
    assert.equal(second.kind === 'wait' ? second.on : '', 'owner:win-A');
  });
  await t.test('(f) the deadline before ownership', (u) => {
    const s = setup(u, []);
    s.fx.advance(Date.parse('2026-09-11T12:00:00.000Z') - Date.parse(s.fx.now()));
    s.fx.leases.takeover(resourceKeys.goal(s.fx.repo.key, s.goalId), () => ({ reconciled: true, unresolvedOperations: [] }), { actor: actorB, now: s.fx.now(), operation: 'coordinate' });
    setActorForTests(actorA);
    const d = s.fx.controller.next(s.goalId);
    assert.equal(d.kind, 'stop');
    assert.equal(d.kind === 'stop' ? d.stop.reason : '', 'time');
  });
});

