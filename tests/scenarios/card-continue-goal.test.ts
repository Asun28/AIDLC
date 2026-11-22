// Card T1-CONTINUE-GOAL-2: `GoalController.continueCard` continues a card on a goal stopped for the card's review stop and re-admits it with a GOAL_STATE that carries the continuation.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs, { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture as fixture, writeCard, goalForCards, driveCardToDone, T0 } from './_harness.ts';
import { hostName } from '../../src/state/paths.ts';
import { verifyAudit } from '../../src/audit/verifier.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { Journal } from '../../src/state/journal.ts';

const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const CARD = 'T1-CG';
const SECOND = 'T1-CH';
const BY = 'the owner';
const FAR = '2099-01-01T00:00:00.000Z';
const CONFIG = { config: { gateRequired: true, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false, secondPass: false } } };
/** The loop and the CLI run in one session on this host, so `aidlc card next` renews the card lease the loop took at the fixture clock. */
const SESSION = 'card-continue-goal';
const makeFixture = (options: { config?: Record<string, unknown> } = CONFIG) => fixture({ ...options, actor: { session: SESSION, pid: 1, processStart: T0, host: hostName() } });
type Stored = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const block = (file: string, text: string, reasons = [`[spec] 6 tests @ ${file}:1: ${text} -> add one`]) => JSON.stringify({ verdict: 'block', reasons, axes: { spec: { verdict: 'block', reasons }, standards: { verdict: 'pass', reasons: [] } } }) + '\n';

/** A throw from fs.appendFileSync onto a GOAL_STATE line, or once onto a CARD_STATE line (`cardState`), or from fs.renameSync onto the goal record `record`. */
const fault: { append: boolean; cardState?: boolean; record?: string } = { append: false };
const real = { appendFileSync: fs.appendFileSync, renameSync: fs.renameSync };
const eio = () => Object.assign(new Error('EIO: injected'), { code: 'EIO' });
before(() => {
  Object.assign(fs, {
    appendFileSync: (...a: Parameters<typeof fs.appendFileSync>) => { if (fault.append && String(a[1]).includes('"type":"GOAL_STATE"')) throw eio(); if (fault.cardState && String(a[1]).includes('"type":"CARD_STATE"')) { fault.cardState = false; throw eio(); } return real.appendFileSync(...a); },
    renameSync: (from: fs.PathLike, to: fs.PathLike) => { if (fault.record && path.resolve(String(to)) === path.resolve(fault.record)) throw eio(); return real.renameSync(from, to); },
  });
  syncBuiltinESMExports();
});
after(() => { Object.assign(fs, real); syncBuiltinESMExports(); });

/** A goal of `ids` under a command reviewer, the moves of the loop on it, and readers of the files the method may write. */
function setup(fx: ReturnType<typeof makeFixture>, ids: string[] = [CARD]) {
  const verdicts: string[] = [];
  let file = '';
  const script = scriptedRunner({ 'git diff --name-only': () => ({ stdout: `${file}\u0000` }), 'git diff': () => ({ stdout: `diff --git a/${file} b/${file}\n+export const x = 1;\n` }), 'fake-r3': () => ({ stdout: verdicts.shift()! }) });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
  for (const id of ids) writeCard(fx, { id, title: `card continue goal ${id}`, allowPaths: [`src/${id.toLowerCase()}.ts`] });
  const goal = goalForCards(fx, ids);
  // The CLI reads the configuration from the main root: the command reviewer of the fixture.
  writeFileSync(path.join(fx.tmp, 'aidlc.config.json'), JSON.stringify({ cardsDir: 'specs/tasks', shipPath: 'dry-run', worktreeRoot: path.join(fx.tmp, 'wt'), ...(fx.config.formalReview.command.length ? CONFIG.config : {}) }));
  const g = () => fx.goal(goal.id);
  const persisted = (id = CARD) => fx.store.getCardRun(goal.id, id)!;
  /** Four R3 block decisions, each with a new finding: the fourth stops the card for review. */
  const stopCard = async (id = CARD) => {
    file = `src/${id.toLowerCase()}.ts`;
    verdicts.push(...['no RED', 'no boundary row', 'no error row', 'no fault row'].map((t) => block(file, t)));
    const card = fx.card(id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), id));
    for (const n of [1, 2, 3, 4]) {
      r = runner.next(g(), card, runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: `dod:${n}`, redReceipt: 'red:1', candidateSha: `${id}-sha-${n}` }));
      r = runner.next(g(), card, (await runner.formalReview(g(), card, persisted(id))).run);
    }
    assert.deepEqual([r.directive.kind, persisted(id).stop?.reason, persisted(id).review.substantiveDecisions], ['stop', 'review', 4], r.directive.narration);
  };
  /** `aidlc next`, which stops the goal with the reason of its stopped card. */
  const stopGoal = (reason = 'review') => {
    const d = fx.controller.next(goal.id) as Stored;
    assert.deepEqual([d['kind'], d['stop']?.reason, g().state, g().terminal], ['stop', reason, 'STOP', true], d['narration']);
  };
  const stopped = async () => { await stopCard(); stopGoal(); };
  /** The goal left in STOP for review by a continuation whose GOAL_STATE append failed: the card's stop is lifted, no event is journaled. */
  const failedReadmission = async () => {
    await stopped();
    fault.append = true;
    try { assert.throws(() => go(), /EIO: injected/); } finally { fault.append = false; }
    assert.deepEqual([persisted().state, g().state, readmissions()], ['BUILD', 'STOP', []]);
  };
  /** The goal record of a stop for `reason`, as `aidlc next` writes it when the first stopped card has that reason. */
  const stopFor = (reason: string, stop = g().stop!) => fx.store.saveGoal({ ...g(), state: 'STOP', terminal: true, stop: { ...stop, reason } as typeof stop });
  /** The CLI reads the real clock, so the test sets the run's deadline. */
  const deadline = (at: string) => fx.store.updateCardRun(goal.id, CARD, (r) => ({ ...r!, deadline: at }));
  const goalFile = fx.store.goalFile(goal.id);
  const journalFile = path.join(fx.paths.journal, `${goal.id}.jsonl`);
  const bytes = () => [goalFile, journalFile, ...ids.map((id) => fx.store.cardFile(goal.id, id))].map((f) => (existsSync(f) ? readFileSync(f, 'utf8') : ''));
  const events = (): Stored[] => (existsSync(journalFile) ? readFileSync(journalFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : []);
  const readmissions = () => events().filter((e) => e['type'] === 'GOAL_STATE' && e['data'].from === 'STOP').map((e) => [e['generation'], e['data']]);
  const cardStates = () => events().filter((e) => e['type'] === 'CARD_STATE' && e['data'].continuation).map((e) => e['data']);
  const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: SESSION };
  const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, ...args, '--goal', goal.id], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  const cardNext = () => { const r = cli('card', 'next', CARD); assert.equal(r.status, 0, r.stderr); return (JSON.parse(r.stdout) as Stored)['directive']?.kind; };
  const go = (act: Act = {}) => fx.controller.continueCard(runner, goal.id, fx.card(CARD), { by: BY, reason: 'one more repair round', ...act });
  const audit = () => verifyAudit({ goalId: goal.id, journal: Journal.forGoal(fx.paths.journal, goal.id), operations: fx.ops, now: fx.now() }).findings.filter((f) => f.code === 'WORK_AFTER_TERMINAL');
  return { goal, runner, verdicts, g, persisted, stopCard, stopGoal, stopped, failedReadmission, stopFor, deadline, goalFile, bytes, events, readmissions, cardStates, cardNext, go, audit };
}
type Act = { by?: string; reason?: string; decisions?: number };
const readmission = (by = BY) => [0, { from: 'STOP', to: 'CARDS', reason: `continuation of ${CARD} by ${by}`, continuation: { cardId: CARD, by } }];
/** `body` on a fresh fixture and its setup, with the fixture removed after it. */
async function scenario(body: (s: ReturnType<typeof setup>, fx: ReturnType<typeof makeFixture>) => Promise<void>, ids = [CARD], config: { config?: Record<string, unknown> } = CONFIG) {
  const fx = makeFixture(config);
  try {
    await body(setup(fx, ids), fx);
  } finally {
    fx.cleanup();
  }
}

test('acceptance 1 and 2: on a goal aidlc next stopped for the card\'s review stop, continueCard lifts the stop and re-admits the goal with one GOAL_STATE carrying the continuation; aidlc next waits on the card, card next returns build, the repair attempt is no work after terminal, and a second stop gets a second continuation [R2] [R4] [R7]', () => scenario(async (s, fx) => {
  await s.stopped();
  s.deadline(FAR);
  const r = s.go();
  assert.deepEqual([r.continued, r.readmitted, r.run.state, r.goal.state], [true, true, 'BUILD', 'CARDS']);
  const run = s.persisted();
  assert.deepEqual([run.state, run.stop, run.continuations.map((c) => [c.by, c.stop.reason, c.admits])], ['BUILD', undefined, [[BY, 'review', 5]]]);
  assert.deepEqual([s.g().state, s.g().terminal, s.g().stop, s.readmissions()], ['CARDS', false, undefined, [readmission()]]);
  const d = fx.controller.next(s.goal.id) as Stored;
  assert.deepEqual([d['kind'], d['on'], s.g().terminal], ['wait', `${CARD}:BUILD`, false], d['narration']);
  assert.equal(s.cardNext(), 'build');
  // Acceptance 2: the repair attempt goes to review, and the audit counts none of it as work after the goal's stop.
  const card = fx.card(CARD);
  const repaired = s.runner.recordAttempt(s.g(), card, s.persisted(), { outcome: 'success', dodReceipt: 'dod:5', redReceipt: 'red:1', candidateSha: `${CARD}-sha-5` });
  assert.equal(s.runner.next(s.g(), card, repaired).directive.kind, 'review');
  assert.deepEqual(s.audit(), []);
  // Decision 5 of the 5 admitted blocks and stops the run again; the goal stopped for it is re-admitted by a second continuation.
  s.verdicts.push(block('src/t1-cg.ts', 'no doc row'));
  assert.equal(s.runner.next(s.g(), card, (await s.runner.formalReview(s.g(), card, s.persisted())).run).directive.kind, 'stop');
  s.stopGoal();
  const second = s.go();
  assert.deepEqual([second.continued, second.readmitted, s.persisted().continuations.map((c) => c.admits), s.g().state, s.readmissions()], [true, true, [5, 6], 'CARDS', [readmission(), readmission()]]);
}));

test('acceptance 3: a failed GOAL_STATE append or goal write after the card\'s stop was lifted throws with the cause and leaves the goal in STOP; the next call records no second continuation, leaves one GOAL_STATE with continuation and re-admits the goal [R5] [R6]', async () => {
  for (const failing of ['append', 'record'] as const) {
    await scenario(async (s, fx) => {
      await s.stopped();
      Object.assign(fault, failing === 'append' ? { append: true } : { record: s.goalFile });
      try {
        assert.throws(() => s.go(), /EIO: injected/);
      } finally {
        Object.assign(fault, { append: false, record: undefined });
      }
      assert.deepEqual([s.persisted().state, s.persisted().continuations.length, s.g().state, s.g().stop?.reason, s.readmissions()], ['BUILD', 1, 'STOP', 'review', failing === 'append' ? [] : [readmission()]], failing);
      // Append row: a ruling's GOAL_STATE after the stop is not the continuation's, so the next call appends its own.
      const ruled = [0, { from: 'STOP', to: 'CARDS', reason: `ruling on ${CARD} by a lead`, ruling: { cardId: CARD, by: 'a lead' } }] as const;
      if (failing === 'append') Journal.forGoal(fx.paths.journal, s.goal.id).append({ type: 'GOAL_STATE', goalId: s.goal.id, generation: 0, data: ruled[1] });
      const run = s.persisted();
      const again = s.go({ by: 'someone else' });
      assert.deepEqual([again.continued, again.readmitted, s.persisted().continuations, s.g().state, s.g().terminal], [false, true, run.continuations, 'CARDS', false], failing);
      assert.deepEqual(s.readmissions(), failing === 'append' ? [ruled, readmission()] : [readmission()], `${failing}: one GOAL_STATE with continuation, with the by of the recorded continuation`);
    });
  }
});

test('acceptance 4: a failed append of the continuation\'s CARD_STATE throws with the cause and leaves the event owed and the goal in STOP; the next call re-admits the goal with no second continuation, and one aidlc card next leaves exactly one such event [R5] [R6]', () => scenario(async (s) => {
  await s.stopped();
  s.deadline(FAR);
  fault.cardState = true;
  try { assert.throws(() => s.go(), /EIO: injected/); } finally { fault.cardState = false; }
  const run = s.persisted();
  const owed = run.journalOwed?.filter((o) => o.type === 'CARD_STATE' && o.data['continuation']).map((o) => o.data);
  const data = { from: 'STOP', to: 'readmitted', continuation: { by: BY, reason: 'one more repair round', stop: 'review', decisions: 1, admits: 5 }, eventKey: owed?.[0]?.['eventKey'] };
  assert.equal(typeof data.eventKey, 'string');
  assert.deepEqual([run.state, run.continuations.length, owed, s.cardStates(), s.g().state, s.g().stop?.reason, s.readmissions()], ['BUILD', 1, [data], [], 'STOP', 'review', []]);
  const again = s.go();
  assert.deepEqual([again.continued, again.readmitted, s.persisted().continuations, s.g().state, s.readmissions(), s.cardStates()], [false, true, run.continuations, 'CARDS', [readmission()], []]);
  assert.equal(s.cardNext(), 'build');
  // `aidlc card next` delivers the owed event once, marked as completed after its act.
  assert.deepEqual(s.cardStates(), [{ ...data, completed: true }]);
}));

test('acceptance 5: each refusal throws with its cause and leaves the goal file, the card-run file and the journal byte-identical, on a stopped goal and on a goal a failed re-admission left in STOP [R1] [R3]', async () => {
  const inBuild = async (s: ReturnType<typeof setup>, fx: ReturnType<typeof makeFixture>) => { s.runner.next(s.g(), fx.card(CARD), fx.controller.ensureCardRun(s.g(), CARD)); assert.deepEqual([s.persisted().state, s.g().state, s.g().terminal], ['BUILD', 'RUN', false]); };
  const rows: Array<[name: string, prepare: (s: ReturnType<typeof setup>, fx: ReturnType<typeof makeFixture>) => Promise<unknown>, act: Act, cause: RegExp]> = [
    ['a goal stopped for time', async (s, fx) => { await s.stopCard(); fx.advance(90 * 86_400_000); s.stopGoal('time'); }, {}, /is STOP \(stop reason: time\);.*aidlc goal extend/],
    ['a DONE goal', async (s, fx) => { driveCardToDone(fx, s.goal.id, CARD); fx.controller.next(s.goal.id); fx.controller.report({ goalId: s.goal.id, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } }); assert.equal(s.g().state, 'DONE'); }, {}, /is DONE; card commands do no card work on it/],
    ['a card with no run', async () => {}, {}, new RegExp(`card ${CARD} has no card run in goal .*; nothing to continue`)],
    ['a run in BUILD on a goal that is not stopped', inBuild, {}, /the card run is in BUILD, not in STOP/],
    ['a blank by', (s) => s.stopped(), { by: ' ' }, /by is blank/],
    ['a blank reason', (s) => s.stopped(), { reason: ' ' }, /reason is blank/],
    ['decisions 0', (s) => s.stopped(), { decisions: 0 }, /decisions 0 is not a whole number from 1 to 4/],
    ['decisions 5', (s) => s.stopped(), { decisions: 5 }, /decisions 5 is not a whole number from 1 to 4/],
    ['decisions 1.5', (s) => s.stopped(), { decisions: 1.5 }, /decisions 1.5 is not a whole number from 1 to 4/],
    // The call after a failed re-admission calls no runner, so the method refuses the act itself.
    ['a blank by after a failed re-admission', (s) => s.failedReadmission(), { by: ' ' }, /by is blank/],
    ['a blank reason after a failed re-admission', (s) => s.failedReadmission(), { reason: ' ' }, /reason is blank/],
    ['decisions 0 after a failed re-admission', (s) => s.failedReadmission(), { decisions: 0 }, /decisions 0 is not a whole number from 1 to 4/],
    ['decisions 5 after a failed re-admission', (s) => s.failedReadmission(), { decisions: 5 }, /decisions 5 is not a whole number from 1 to 4/],
    ['decisions 1.5 after a failed re-admission', (s) => s.failedReadmission(), { decisions: 1.5 }, /decisions 1.5 is not a whole number from 1 to 4/],
  ];
  for (const [name, prepare, act, cause] of rows) {
    await scenario(async (s, fx) => {
      await prepare(s, fx);
      const held = s.bytes();
      assert.throws(() => s.go(act), cause, name);
      assert.deepEqual(s.bytes(), held, `${name}: the goal file, the journal and the card-run file are byte-identical`);
    }, [CARD], name === 'a DONE goal' ? {} : CONFIG);
  }
});

test('acceptance 6: a two-card goal that is not stopped gets the card\'s stop lifted and no GOAL_STATE; a goal stopped for review whose run was continued for ci, and a goal stopped for ci whose card\'s review stop is lifted, are not re-admitted [R4] [R5]', async () => {
  await scenario(async (s) => {
    await s.stopCard();
    const was = s.g();
    const r = s.go();
    assert.deepEqual([r.continued, r.readmitted, s.persisted().state, s.persisted().stop, s.g().state, s.g().terminal], [true, false, 'BUILD', undefined, was.state, false]);
    assert.deepEqual(s.events().filter((e) => e['type'] === 'GOAL_STATE' && e['data'].from === 'STOP'), []);
  }, [CARD, SECOND]);
  await scenario(async (s, fx) => {
    await s.stopped();
    const at = s.persisted().stop!.at;
    fx.store.updateCardRun(s.goal.id, CARD, (r) => ({ ...r!, state: 'BUILD', stop: undefined, continuations: [{ at, by: 'a lead', reason: 'rerun the red check', stop: { reason: 'ci', detail: 'red check', at } }] }));
    const held = s.bytes();
    assert.throws(() => s.go(), /the card run is in BUILD, not in STOP/);
    assert.deepEqual([s.bytes(), s.g().state, s.g().stop?.reason, s.readmissions()], [held, 'STOP', 'review', []]);
  });
  await scenario(async (s) => {
    await s.stopped();
    s.stopFor('ci');
    const r = s.go();
    assert.deepEqual([r.continued, r.readmitted, s.persisted().state, s.g().state, s.g().stop?.reason, s.readmissions()], [true, false, 'BUILD', 'STOP', 'ci', []]);
  });
});
