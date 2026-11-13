// Card T1-REVIEW-RULE-GOAL-2: `aidlc review rule` runs on a goal stopped for review, and the ruling that lifts the card's stop re-admits the goal.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs, { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, goalForCards, driveCardToDone, candidateShaFor, T0 } from './_harness.ts';
import * as aidlc from '../../src/cli/main.ts';
import { verifyAudit } from '../../src/audit/verifier.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { Journal } from '../../src/state/journal.ts';

/** The CLI from the sources, never a compiled build that may be stale. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const CARD = 'T1-RG';
const SECOND = 'T1-RH';
const REASON = 'the row is tests/t1-rg.test.ts:9';
const CONFIG = { config: { gateRequired: true, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false, secondPass: true } } };
type Stored = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const fileOf = (id: string) => `src/${id.toLowerCase()}.ts`;
const block = (file: string, texts: string[]): string => {
  const reasons = texts.map((text, i) => `[spec] 6 tests @ ${file}:${i + 1}: ${text}`);
  return JSON.stringify({ verdict: 'block', reasons, axes: { spec: { verdict: 'block', reasons }, standards: { verdict: 'pass', reasons: [] } } }) + '\n';
};

/** The faults of acceptance 10, switched on by a test: a throw from fs.appendFileSync onto a GOAL_STATE line of the goal journal, and from fs.renameSync onto the goal record `record`. */
const fault: { append: boolean; record?: string } = { append: false };
/** An overlapping command (R3 decision 1, F2): `run` is called once, right after the next read of the file `at` returns. */
const overlap: { at?: string; run?: () => void } = {};
const real = { append: fs.appendFileSync, rename: fs.renameSync, read: fs.readFileSync };
before(() => {
  (fs as unknown as Stored)['readFileSync'] = (...args: Parameters<typeof fs.readFileSync>) => {
    const out = real.read(...args);
    if (overlap.at && typeof args[0] === 'string' && path.resolve(args[0]) === path.resolve(overlap.at)) {
      overlap.at = undefined;
      overlap.run!();
    }
    return out;
  };
  (fs as unknown as Stored)['appendFileSync'] = (...args: Parameters<typeof fs.appendFileSync>) => {
    if (fault.append && typeof args[1] === 'string' && args[1].includes('"type":"GOAL_STATE"')) throw Object.assign(new Error('EIO: injected'), { code: 'EIO' });
    return real.append(...args);
  };
  (fs as unknown as Stored)['renameSync'] = (from: fs.PathLike, to: fs.PathLike) => {
    if (fault.record && path.resolve(String(to)) === path.resolve(fault.record)) throw Object.assign(new Error('EIO: injected'), { code: 'EIO' });
    return real.rename(from, to);
  };
  syncBuiltinESMExports();
});
after(() => {
  fs.appendFileSync = real.append;
  fs.renameSync = real.rename;
  fs.readFileSync = real.read;
  syncBuiltinESMExports();
});

/** A goal of `ids` with a command reviewer, and readers of the goal record, the card-run records and the journal: the files a ruling may write. */
function setup(fx: ReturnType<typeof makeFixture>, ids: string[] = [CARD]) {
  const verdicts: string[] = [];
  const reviews = { count: 0 };
  let file = '';
  /** Called while the reviewer runs, as another window acts during a decision. */
  const during: { fn?: () => void } = {};
  const script = scriptedRunner({
    'git diff --name-only': () => ({ stdout: `${file}\u0000` }),
    'git diff': () => ({ stdout: `diff --git a/${file} b/${file}\n+export const x = 1;\n` }),
    'fake-r3': () => { reviews.count += 1; during.fn?.(); return { stdout: verdicts.shift()! }; },
  });
  const ship = new DryRunShipPath(ids.map(() => 'merged' as const));
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
  for (const id of ids) writeCard(fx, { id, title: `review rule goal ${id}`, allowPaths: [fileOf(id)] });
  const goal = goalForCards(fx, ids);
  const g = () => fx.goal(goal.id);
  const persisted = (id = CARD) => fx.store.getCardRun(goal.id, id)!;
  /** The loop stops card `id` at R3 decision 2: decision 1 raises F1, decision 2 re-raises the disputed F1 and raises F2. Returns the card's stop directive. */
  const stopCard = async (id = CARD) => {
    file = fileOf(id);
    verdicts.push(block(file, ['no RED -> add one']), block(file, ['still no RED (re:F1) -> add one', 'no doc row -> add one']));
    const card = fx.card(id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), id));
    for (const n of [1, 2]) {
      r = runner.next(g(), card, runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: `dod:${n}`, redReceipt: 'red:1', candidateSha: `${id}-sha-${n}` }));
      assert.equal(r.directive.kind, 'review', r.directive.narration);
      if (n === 2) runner.disputeFinding(g(), card, persisted(id), 'F1', 'the row exists');
      r = runner.next(g(), card, (await runner.formalReview(g(), card, persisted(id))).run);
    }
    assert.deepEqual([r.directive.kind, persisted(id).stop?.reason, persisted(id).findings.map((f) => f.id)], ['stop', 'review', ['F1', 'F2']], r.directive.narration);
    return r.directive as Stored;
  };
  /** `aidlc next` on the goal, which stops it with the reason of its stopped card. */
  const stopGoal = (reason = 'review') => {
    const d = fx.controller.next(goal.id) as Stored;
    assert.deepEqual([d['kind'], d['stop']?.reason, g().state, g().terminal], ['stop', reason, 'STOP', true], d['narration']);
  };
  const goalFile = fx.store.goalFile(goal.id);
  const journalFile = path.join(fx.paths.journal, `${goal.id}.jsonl`);
  const bytes = () => [goalFile, journalFile, ...ids.map((id) => fx.store.cardFile(goal.id, id))].map((f) => readFileSync(f, 'utf8'));
  const goalRec = (): Stored => JSON.parse(readFileSync(goalFile, 'utf8'));
  const events = (): Stored[] => readFileSync(journalFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const count = (type: string) => events().filter((e) => e['type'] === type).length;
  /** The journal's GOAL_STATE events out of STOP, as `[generation, data]`. */
  const readmissions = () => events().filter((e) => e['type'] === 'GOAL_STATE' && e['data'].from === 'STOP').map((e) => [e['generation'], e['data']]);
  const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: fx.paths.root };
  delete env['CLAUDE_CODE_SESSION_ID'];
  delete env['AIDLC_SESSION'];
  const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, ...args, '--goal', goal.id], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  const ruleCli = (finding: string, by: string, ...flags: string[]) => cli('review', 'rule', CARD, finding, ...(flags.length ? flags : ['--reject']), '--by', by, '--reason', REASON);
  /** `GoalController.ruleFinding`, the method `aidlc review rule` calls, with the fixture clock. */
  const rule = (finding: string, by: string, id = CARD, decision: 'rejected' | 'deferred' = 'rejected') => fx.controller.ruleFinding(runner, goal.id, fx.card(id), finding, { decision, by, reason: REASON });
  /** `card next` through the runner, with the fixture clock and the dry-run ship path. */
  const next = (id = CARD) => runner.next(g(), fx.card(id), persisted(id));
  /** `aidlc next` after a re-admission: a wait on the card in SHIP, the goal out of STOP, and no second dispatch of any card. */
  const assertWaits = (id = CARD) => {
    const d = fx.controller.next(goal.id) as Stored;
    assert.deepEqual([d['kind'], d['on'], d['goalState'], g().terminal, count('CARD_DISPATCHED')], ['wait', `${id}:SHIP`, 'WAIT', false, ids.length], d['narration']);
  };
  /** The `WORK_AFTER_TERMINAL` findings of `aidlc audit verify`, by the function the command calls on the goal's journal and operations. */
  const audit = () => verifyAudit({ goalId: goal.id, journal: Journal.forGoal(fx.paths.journal, goal.id), operations: fx.ops, now: fx.now() }).findings.filter((f) => f.code === 'WORK_AFTER_TERMINAL');
  return { goal, runner, ship, reviews, during, journalFile, g, persisted, stopCard, stopGoal, goalFile, bytes, goalRec, events, count, readmissions, cli, ruleCli, rule, next, assertWaits, audit };
}
const readmission = (cardId: string, by: string) => [0, { from: 'STOP', to: 'CARDS', reason: `ruling on ${cardId} by ${by}`, ruling: { cardId, by } }];

test('acceptance 1, 2, 4, 5 and 6: on a goal aidlc next stopped for review, the first ruling leaves the goal in STOP and review dispute refused; the lifting ruling re-admits the goal with one GOAL_STATE carrying the ruling; aidlc next waits on the card in SHIP, card next ships the unchanged candidate and the audit counts no work after the stop [R1] [R2] [R3] [R4] [R5]', async () => {
  const fx = makeFixture(CONFIG);
  try {
    const s = await setup(fx);
    // Acceptance 6: the stop an R3 block decision records.
    const stop = (await s.stopCard())['stop'];
    for (const part of ['aidlc review rule', '--reject', '--defer', "the owner's"]) assert.ok(stop.nextAction.includes(part), `the nextAction names ${part}: ${stop.nextAction}`);
    s.stopGoal();
    // Acceptance 1: another card command is still refused, and a ruling that leaves F2 unruled writes no goal record and no GOAL_STATE.
    const held = s.bytes();
    const dispute = s.cli('review', 'dispute', CARD, 'F2', '--note', 'the row exists');
    assert.equal(dispute.status, 1, dispute.stdout);
    assert.match(dispute.stderr, /is STOP \(stop reason: review\); card commands do no card work on it/);
    assert.deepEqual(s.bytes(), held, 'the refused dispute writes nothing');
    const first = s.ruleCli('F1', 'a lead');
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual([s.bytes()[0], s.persisted().state, s.persisted().findings[0]?.ruling?.by, s.count('FINDING_RULED'), s.readmissions()], [held[0], 'STOP', 'a lead', 1, []]);
    // Acceptance 5: the JSON output carries the ruling, and the line the command prints for a terminal names it on the finding's own line.
    const listed = (JSON.parse(s.cli('review', 'findings', CARD).stdout) as Stored)['findings'] as Stored[];
    assert.deepEqual(listed.map((f) => [f['id'], f['ruling'] && [f['ruling'].decision, f['ruling'].by, f['ruling'].reason]]), [['F1', ['rejected', 'a lead', REASON]], ['F2', undefined]]);
    assert.deepEqual(listed.map((f) => aidlc.findingLine(f as Parameters<typeof aidlc.findingLine>[0]).split('\n')[0]!.includes('ruled rejected by a lead')), [true, false]);
    // Acceptance 2: the lifting ruling, by another name than the first. The goal record is compared whole: `stop` gone, `terminal`, `state` and the store's `updatedAt` moved.
    const was = s.goalRec();
    const lift = s.ruleCli('f2', 'the owner', '--defer', '--issue', '7');
    assert.equal(lift.status, 0, lift.stderr);
    assert.match(lift.stdout, /goal .* is re-admitted/);
    const now = s.goalRec();
    const { stop: _stop, ...rest } = was;
    const expected: Stored = { ...rest, terminal: false, state: 'CARDS', updatedAt: now['updatedAt'] };
    assert.deepEqual(now, expected);
    assert.ok(now['updatedAt'] > was['updatedAt'], `${now['updatedAt']} is after ${was['updatedAt']}`);
    assert.deepEqual([now['revision'], now['generation'], 'stop' in now], [was['revision'], was['generation'], false]);
    assert.deepEqual(s.readmissions(), [readmission(CARD, 'the owner')]);
    assert.ok(aidlc.findingLine(s.persisted().findings[1] as Parameters<typeof aidlc.findingLine>[0]).split('\n')[0]!.includes(`ruled deferred (issue 7) by the owner: ${REASON}`));
    s.assertWaits();
    const shipped = s.next();
    assert.deepEqual([shipped.directive.kind, s.ship.requests.map((q) => q.candidateSha), s.persisted().state, s.persisted().mergeVerified, s.reviews.count], ['close', [`${CARD}-sha-2`], 'CLOSE', true, 2], shipped.directive.narration);
    // `aidlc card next` through the CLI is admitted on the re-admitted goal: exit 0 and the card's own directive, not the goal refusal.
    const admitted = s.cli('card', 'next', CARD);
    assert.deepEqual([admitted.status, (JSON.parse(admitted.stdout || '{}') as Stored)['directive']?.kind], [0, 'close'], admitted.stderr);
    // Acceptance 4: the ship issued an operation after the GOAL_STOPPED, and the audit counts none of it.
    const types = s.events().map((e) => e['type'] as string);
    assert.ok(types.lastIndexOf('OPERATION_ISSUED') > types.lastIndexOf('GOAL_STOPPED'), types.join(','));
    assert.deepEqual(s.audit(), []);
  } finally {
    fx.cleanup();
  }
});

test('acceptance 4, journal rows: a GOAL_STATE from STOP to CARDS ends a stop for review only when it carries the ruling and is of the stop\'s generation; a stop for another reason is as before [R3]', () => {
  const fx = makeFixture();
  try {
    const ruling = { cardId: CARD, by: 'the owner' };
    const rows: Array<[name: string, stopGeneration: number, reason: string, data: Stored, counted: number]> = [
      ['a stop for review, the event with ruling', 0, 'review', { ruling }, 0],
      ['a stop for review, the event without ruling', 0, 'review', {}, 1],
      ['a stop for review, a ruling that names no by', 0, 'review', { ruling: { cardId: CARD } }, 1],
      ['a stop for risk, the event with ruling', 0, 'risk', { ruling }, 1],
      ['a stop for review in generation 1, the event with ruling in generation 0', 1, 'review', { ruling }, 1],
      ['a stop for time, the event without ruling', 0, 'time', {}, 0],
    ];
    for (const [name, stopGeneration, reason, data, counted] of rows) {
      const goalId = `g-row-${rows.findIndex((r) => r[0] === name)}`;
      const journal = Journal.forGoal(fx.paths.journal, goalId);
      journal.append({ type: 'GOAL_STOPPED', goalId, generation: stopGeneration, data: { reason } });
      journal.append({ type: 'GOAL_STATE', goalId, generation: 0, data: { from: 'STOP', to: 'CARDS', ...data } });
      journal.append({ type: 'CARD_DISPATCHED', goalId, generation: stopGeneration, data: { childRef: `card:${CARD}` } });
      const found = verifyAudit({ goalId, journal, now: T0 }).findings.filter((f) => f.code === 'WORK_AFTER_TERMINAL').map((f) => f.detail);
      assert.deepEqual(found, counted ? [`${counted} mutation event(s) after terminal disposition`] : [], name);
    }
  } finally {
    fx.cleanup();
  }
});

test('acceptance 3: review rule exits non-zero and writes nothing on a DONE goal, a cancelled goal and a goal stopped for time [R1]', async () => {
  for (const row of ['DONE', 'cancelled', 'time'] as const) {
    // The DONE goal is reached by the loop with no command reviewer: its card merges and the arc is verified.
    const fx = makeFixture(row === 'DONE' ? {} : CONFIG);
    try {
      const s = await setup(fx);
      if (row === 'DONE') {
        driveCardToDone(fx, s.goal.id, CARD);
        assert.equal(fx.controller.next(s.goal.id).kind, 'verify-arc');
        fx.controller.report({ goalId: s.goal.id, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } });
      } else {
        await s.stopCard();
        if (row === 'cancelled') fx.controller.report({ goalId: s.goal.id, generation: 0, result: 'cancel', data: { detail: 'stopped by the user' } });
        else {
          // The goal's own deadline passes before `aidlc next` reads the stopped card.
          fx.advance(90 * 86_400_000);
          s.stopGoal('time');
        }
      }
      const names = row === 'DONE' ? /is DONE; card commands do no card work on it/ : new RegExp(`is STOP \\(stop reason: ${row}\\); card commands do no card work on it`);
      assert.deepEqual([s.g().state, s.g().stop?.reason], row === 'DONE' ? ['DONE', undefined] : ['STOP', row]);
      const held = s.bytes();
      const refused = s.ruleCli('F1', 'the owner');
      assert.equal(refused.status, 1, `${row}: ${refused.stdout}`);
      assert.match(refused.stderr, names, row);
      assert.throws(() => s.rule('F1', 'the owner'), names, row);
      assert.deepEqual(s.bytes(), held, `${row}: the goal record, the journal and the card run are byte-identical`);
    } finally {
      fx.cleanup();
    }
  }
});

test('acceptance 10: a failed GOAL_STATE append or goal write at the lifting ruling leaves the stop lifted and the goal in STOP; the ruling made again completes the re-admission with the by of the lift, writes no ruling and leaves exactly one GOAL_STATE [R2] [R8]', async () => {
  for (const failing of ['append', 'record'] as const) {
    const fx = makeFixture(CONFIG);
    try {
      const s = await setup(fx);
      await s.stopCard();
      s.stopGoal();
      s.rule('F1', 'a lead');
      Object.assign(fault, failing === 'append' ? { append: true } : { record: s.goalFile });
      try {
        assert.throws(() => s.rule('F2', 'the owner'), /EIO: injected/);
      } finally {
        Object.assign(fault, { append: false, record: undefined });
      }
      // The lift is in the card run with both rulings journaled; the goal record is as the stop left it. The append comes first, so only the failed goal write leaves the event.
      const lifted = s.persisted();
      assert.deepEqual([lifted.state, lifted.stop, lifted.review.invocations.at(-2)?.stopLifted?.by, s.count('FINDING_RULED')], ['SHIP', undefined, 'the owner', 2]);
      assert.deepEqual([s.goalRec()['state'], s.goalRec()['terminal'], s.goalRec()['stop'].reason], ['STOP', true, 'review']);
      assert.deepEqual(s.readmissions(), failing === 'append' ? [] : [readmission(CARD, 'the owner')]);
      // A finding the lifted decision does not hold is no rerun: refused as before, with nothing written.
      const held = s.bytes();
      assert.throws(() => s.rule('F9', 'the owner'), /is in SHIP, not stopped for review/);
      assert.deepEqual(s.bytes(), held);
      // The rerun: the same ruling again (record row), or another ruled finding of the lifted decision, F1 ruled by a lead, with another `by` and decision (append row): the event carries the by of the lift.
      const again = failing === 'append' ? s.rule('f1', 'someone else', CARD, 'deferred') : s.rule('F2', 'the owner');
      assert.deepEqual([again.ruled, again.goal.state, s.bytes()[2], s.count('FINDING_RULED')], [false, 'CARDS', held[2], 2], 'no ruling is written: the card run keeps its bytes');
      assert.deepEqual([s.goalRec()['state'], s.goalRec()['terminal'], 'stop' in s.goalRec()], ['CARDS', false, false]);
      assert.deepEqual(s.readmissions(), [readmission(CARD, 'the owner')], 'exactly one GOAL_STATE from STOP to CARDS');
      // Once the goal is re-admitted the same call is refused and appends nothing.
      assert.throws(() => s.rule('F2', 'the owner'), /is in SHIP, not stopped for review/);
      assert.equal(s.readmissions().length, 1);
      s.assertWaits();
      if (failing === 'record') {
        // `aidlc card next` through the CLI, on the real clock, is admitted by the goal and stops the card at its own deadline (2026-09-11): the ruling moved none.
        const late = s.cli('card', 'next', CARD);
        assert.deepEqual([late.status, (JSON.parse(late.stdout || '{}') as Stored)['directive']?.stop?.reason, s.ship.requests.length], [0, 'time', 0], late.stderr);
        continue;
      }
      assert.deepEqual([s.next().directive.kind, s.ship.requests.map((q) => q.candidateSha)], ['close', [`${CARD}-sha-2`]]);
      assert.deepEqual(s.audit(), []);
    } finally {
      fx.cleanup();
    }
  }
});

test('R8, the goal\'s last GOAL_STOPPED: a goal aidlc next stopped again on a second card is re-admitted by that card\'s lifting ruling with a GOAL_STATE of its own [R2] [R8]', async () => {
  const fx = makeFixture(CONFIG);
  try {
    const s = await setup(fx, [CARD, SECOND]);
    await s.stopCard(CARD);
    await s.stopCard(SECOND);
    s.stopGoal();
    for (const id of ['F1', 'F2']) s.rule(id, 'the owner');
    // The first card ships and closes; `aidlc next` then stops the goal on the second card, which is still stopped for review.
    assert.equal(s.next().directive.kind, 'close');
    s.runner.markClosure(s.g(), fx.card(CARD), s.persisted(), { metadata: true, docSync: true, findings: true, evidence: true, cleanup: true, lessons: true }, { skipped: 'fixture: no rule learned' });
    assert.equal(s.next().directive.kind, 'done');
    s.stopGoal();
    assert.deepEqual([s.count('GOAL_STOPPED'), s.readmissions()], [2, [readmission(CARD, 'the owner')]]);
    // The event of the first re-admission is before the last GOAL_STOPPED: the second lift appends its own.
    for (const id of ['F1', 'F2']) s.rule(id, 'a second owner', SECOND);
    assert.deepEqual([s.g().state, s.g().terminal, s.readmissions()], ['CARDS', false, [readmission(CARD, 'the owner'), readmission(SECOND, 'a second owner')]]);
    s.assertWaits(SECOND);
    assert.deepEqual([s.next(SECOND).directive.kind, s.ship.requests.map((q) => q.candidateSha)], ['close', [`${CARD}-sha-2`, `${SECOND}-sha-2`]]);
    assert.deepEqual(s.audit(), []);
  } finally {
    fx.cleanup();
  }
});

test('R3 decision 1, F1: a resume, or a resume and a cancellation, that lands between the lifting ruling and the re-admission stands: the goal record is the one that write left, and no GOAL_STATE out of STOP is appended [R2]', async () => {
  for (const cancelled of [false, true]) {
    const fx = makeFixture(CONFIG);
    try {
      const s = await setup(fx);
      await s.stopCard();
      s.stopGoal();
      s.rule('F1', 'a lead');
      // The other command lands after the ruling's card-run write and before the re-admission reads the goal.
      let landed = '';
      const racing = {
        ruleFinding: (...args: Parameters<CardRunner['ruleFinding']>) => {
          const run = s.runner.ruleFinding(...args);
          fx.controller.report({ goalId: s.goal.id, generation: 0, result: 'resume', data: { reason: 'the owner continues' } });
          if (cancelled) fx.controller.report({ goalId: s.goal.id, generation: 1, result: 'cancel', data: { detail: 'stopped by the user' } });
          landed = s.bytes()[0]!;
          return run;
        },
      };
      const r = fx.controller.ruleFinding(racing, s.goal.id, fx.card(CARD), 'F2', { decision: 'rejected', by: 'the owner', reason: REASON });
      assert.deepEqual([s.g().generation, s.g().state, s.g().stop?.reason], cancelled ? [1, 'STOP', 'cancelled'] : [1, 'WAIT', undefined]);
      assert.deepEqual([s.bytes()[0], s.readmissions(), r.readmitted, s.persisted().state], [landed, [], false, 'SHIP'], 'the goal record keeps the bytes the other command wrote');
    } finally {
      fx.cleanup();
    }
  }
});

test('R3 decision 1, F2: a recovery call that overlaps another, after its journal scan and before its append, is refused on the goal lock and appends nothing: exactly one GOAL_STATE from STOP to CARDS [R8]', async () => {
  const fx = makeFixture(CONFIG);
  try {
    const s = await setup(fx);
    await s.stopCard();
    s.stopGoal();
    s.rule('F1', 'a lead');
    fault.append = true;
    try {
      assert.throws(() => s.rule('F2', 'the owner'), /EIO: injected/);
    } finally {
      fault.append = false;
    }
    assert.deepEqual([s.persisted().state, s.g().state, s.readmissions()], ['SHIP', 'STOP', []]);
    // Recovery A scans the journal; recovery B runs whole at that point, before A appends.
    let second = 'not run';
    Object.assign(overlap, { at: s.journalFile, run: () => { try { second = `completed: ${s.rule('F2', 'the owner').goal.state}`; } catch (err) { second = (err as Error).message; } } });
    const first = s.rule('F1', 'the owner');
    assert.match(second, /locked/i, 'the overlapping call waits on the goal lock and is refused');
    assert.deepEqual([first.readmitted, s.g().state, s.readmissions()], [true, 'CARDS', [readmission(CARD, 'the owner')]]);
    // Run again after the first has finished, the second call finds the goal re-admitted and appends nothing.
    assert.throws(() => s.rule('F2', 'the owner'), /is in SHIP, not stopped for review/);
    assert.equal(s.readmissions().length, 1);
  } finally {
    fx.cleanup();
  }
});

const GUIDANCE = ['aidlc review rule', '--reject', '--defer', "the owner's"];
test('R3 decision 1, F3 and F4: the stop of a recorded R3 block decision names the ruling on every path that makes it: a decision that landed as history behind a newer candidate, and a ship-path block; a stop with no verdict keeps its text [R5]', async () => {
  // F3. While decision 2 runs, another window records a newer candidate (the store update of tests/scenarios/t0-flow.test.ts:1995): the
  // decision is committed as history, and the next `card next` materializes its stop from the recorded `stopReview`.
  const fx = makeFixture(CONFIG);
  try {
    const s = await setup(fx);
    s.during.fn = () => {
      if (s.reviews.count === 2) fx.store.updateCardRun(s.goal.id, CARD, (current) => ({ ...current!, candidate: { sha: 'sha-3', dirty: false, untracked: [], digest: 'sha-3' }, dodReceipt: 'dod:3' }));
    };
    const stop = (await s.stopCard())['stop'];
    assert.deepEqual([s.persisted().candidate?.digest, typeof s.persisted().review.invocations.at(-1)?.stopReview], ['sha-3', 'string']);
    for (const part of GUIDANCE) assert.ok(stop.nextAction.includes(part), `history: the nextAction names ${part}: ${stop.nextAction}`);
    assert.equal(stop.nextAction.split('aidlc review rule').length, 2, 'the guidance is given once');
    assert.deepEqual(s.next().directive, { kind: 'stop', cardId: CARD, stop, narration: 'review allowance exhausted' }, 'a later card next returns the same stop');
  } finally {
    fx.cleanup();
  }
  // F4 and the stop that is not rulable: a ship-path reviewer (no formalReview.command) blocks twice, or returns no verdict twice.
  const BLOCK = { verdict: 'block' as const, reasons: ['[spec] 6 tests missing @ src/t1-rg.ts'], axes: { spec: { verdict: 'block' as const, reasons: ['tests missing'] }, standards: { verdict: 'pass' as const, reasons: [] } }, sha: candidateShaFor(CARD), run_status: 'success' as const };
  for (const outcome of ['review-blocked', 'review-no-verdict'] as const) {
    const ship = makeFixture();
    try {
      writeCard(ship, { id: CARD, title: 'review rule goal', tier: 'S', reviewGate: 'codex {verdict:pass}', acceptance: ['1. x is 1. [dod arm 1]'] });
      const goal = goalForCards(ship, [CARD]);
      const runner = ship.runner(new DryRunShipPath([outcome, outcome], outcome === 'review-blocked' ? BLOCK : undefined));
      const g = () => ship.goal(goal.id);
      const card = ship.card(CARD);
      let r = runner.next(g(), card, runner.next(g(), card, ship.controller.ensureCardRun(g(), CARD)).run);
      r = runner.next(g(), card, runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor(CARD) }));
      if (outcome === 'review-blocked') {
        r = runner.next(g(), card, r.run);
        r = runner.next(g(), card, runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-repaired' }));
      } else r = runner.next(g(), card, r.run);
      assert.deepEqual([r.directive.kind, r.run.stop?.reason], ['stop', 'review'], r.directive.narration);
      const nextAction = r.run.stop!.nextAction;
      if (outcome === 'review-blocked') for (const part of GUIDANCE) assert.ok(nextAction.includes(part), `ship path: the nextAction names ${part}: ${nextAction}`);
      else assert.equal(nextAction, 'preserve raw output; never pass; hand off for adjudication', 'no verdict: nothing to rule on, the text is as before');
    } finally {
      ship.cleanup();
    }
  }
});
