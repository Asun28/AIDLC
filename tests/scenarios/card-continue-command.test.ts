// Card T1-CONTINUE-COMMAND: `aidlc card continue` calls `GoalController.continueCard` from the command line and writes nothing itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture as fixture, writeCard, goalForCards, driveCardToDone, T0 } from './_harness.ts';
import { hostName } from '../../src/state/paths.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';

const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const CARD = 'T1-CC';
const BY = 'the owner';
const FAR = '2099-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';
const CONFIG = { config: { gateRequired: true, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false, secondPass: false } } };
/** The loop and the CLI run in one session on this host, so `aidlc card next` renews the card lease the loop took at the fixture clock. */
const SESSION = 'card-continue-command';
const makeFixture = (options: { config?: Record<string, unknown> } = CONFIG) => fixture({ ...options, actor: { session: SESSION, pid: 1, processStart: T0, host: hostName() } });
type Stored = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Act = { by?: string; decisions?: number };
const block = (file: string, text: string, reasons = [`[spec] 6 tests @ ${file}:1: ${text} -> add one`]) => JSON.stringify({ verdict: 'block', reasons, axes: { spec: { verdict: 'block', reasons }, standards: { verdict: 'pass', reasons: [] } } }) + '\n';

/** A one-card goal under a command reviewer, the moves of the loop on it, the command through the CLI and readers of the files it may not write. */
function setup(fx: ReturnType<typeof makeFixture>, ids = [CARD]) {
  const verdicts: string[] = [];
  const file = `src/${CARD.toLowerCase()}.ts`;
  const script = scriptedRunner({ 'git diff --name-only': () => ({ stdout: `${file}\u0000` }), 'git diff': () => ({ stdout: `diff --git a/${file} b/${file}\n+export const x = 1;\n` }), 'fake-r3': () => ({ stdout: verdicts.shift()! }) });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
  for (const id of ids) writeCard(fx, { id, title: 'card continue command', allowPaths: [`src/${id.toLowerCase()}.ts`] });
  const goal = goalForCards(fx, ids);
  // The CLI reads the configuration from the main root: the command reviewer of the fixture, which `continueStop` requires.
  writeFileSync(path.join(fx.tmp, 'aidlc.config.json'), JSON.stringify({ cardsDir: 'specs/tasks', shipPath: 'dry-run', worktreeRoot: path.join(fx.tmp, 'wt'), ...(fx.config.formalReview.command.length ? CONFIG.config : {}) }));
  const g = () => fx.goal(goal.id);
  const persisted = () => fx.store.getCardRun(goal.id, CARD)!;
  /** Four R3 block decisions, each with a new finding: decision 4 stops the card for review. */
  const stopCard = async () => {
    verdicts.push(...['no RED', 'no boundary row', 'no error row', 'no fault row'].map((t) => block(file, t)));
    const card = fx.card(CARD);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
    for (const n of [1, 2, 3, 4]) {
      r = runner.next(g(), card, runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: `dod:${n}`, redReceipt: 'red:1', candidateSha: `sha-${n}` }));
      r = runner.next(g(), card, (await runner.formalReview(g(), card, persisted())).run);
    }
    assert.deepEqual([r.directive.kind, persisted().stop?.reason, persisted().review.substantiveDecisions], ['stop', 'review', 4], r.directive.narration);
  };
  /** `aidlc next`, which stops the goal with the reason of its stopped card. */
  const stopGoal = (reason = 'review') => {
    const d = fx.controller.next(goal.id) as Stored;
    assert.deepEqual([d['kind'], d['stop']?.reason, g().state], ['stop', reason, 'STOP'], d['narration']);
  };
  const stopped = async () => { await stopCard(); stopGoal(); };
  /** The CLI reads the real clock, so the test sets the run's deadline. */
  const deadline = (at: string) => fx.store.updateCardRun(goal.id, CARD, (r) => ({ ...r!, deadline: at }));
  const journalFile = path.join(fx.paths.journal, `${goal.id}.jsonl`);
  const bytes = () => [fx.store.goalFile(goal.id), journalFile, fx.store.cardFile(goal.id, CARD)].map((f) => (existsSync(f) ? readFileSync(f, 'utf8') : ''));
  const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: SESSION };
  const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, ...args, '--goal', goal.id], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  const continueCli = (act: Act = {}) => cli('card', 'continue', CARD, '--by', act.by ?? BY, '--reason', 'one more repair round', ...(act.decisions === undefined ? [] : ['--decisions', String(act.decisions)]));
  return { goal, g, persisted, stopCard, stopGoal, stopped, deadline, bytes, cli, continueCli };
}
/** `body` on a fresh fixture and its setup, with the fixture removed after it. */
async function scenario(body: (s: ReturnType<typeof setup>, fx: ReturnType<typeof makeFixture>) => Promise<void>, config: { config?: Record<string, unknown> } = CONFIG, ids = [CARD]) {
  const fx = makeFixture(config);
  try {
    await body(setup(fx, ids), fx);
  } finally {
    fx.cleanup();
  }
}

test('acceptance 1: on a goal aidlc next stopped for the card\'s review stop, card continue exits 0 with the run\'s state, the continuation admitting 5, continued and readmitted; the goal is in CARDS, card next returns build and no other run exists [R1] [R2] [R4]', () => scenario(async (s, fx) => {
  await s.stopped();
  s.deadline(FAR);
  const r = s.continueCli();
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout) as Stored;
  assert.deepEqual([report['state'], report['continuation']?.by, report['continuation']?.admits, report['continued'], report['readmitted'], report['next']], ['BUILD', BY, 5, true, true, `\`aidlc card next ${CARD}\`; goal ${s.goal.id} is re-admitted (CARDS)`]);
  assert.deepEqual(report['continuation'], s.persisted().continuations.at(-1));
  assert.equal(s.g().state, 'CARDS');
  const next = s.cli('card', 'next', CARD);
  assert.deepEqual([next.status, (JSON.parse(next.stdout || '{}') as Stored)['directive']?.kind], [0, 'build'], next.stderr);
  assert.deepEqual(fx.store.listCardRuns(s.goal.id).map((run) => run.cardId), [CARD]);
}));

test('acceptance 2: each refusal exits non-zero with its cause and leaves the goal file, the card-run file and the journal byte-identical [R2] [R3]', async () => {
  const rows: Array<[name: string, prepare: (s: ReturnType<typeof setup>, fx: ReturnType<typeof makeFixture>) => Promise<unknown>, act: Act, cause: RegExp]> = [
    ['a goal stopped for time', async (s, fx) => { await s.stopCard(); fx.advance(90 * 86_400_000); s.stopGoal('time'); }, {}, /is STOP \(stop reason: time\);.*aidlc goal extend/],
    ['a DONE goal', async (s, fx) => { driveCardToDone(fx, s.goal.id, CARD); fx.controller.next(s.goal.id); fx.controller.report({ goalId: s.goal.id, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } }); }, {}, /is DONE; card commands do no card work on it/],
    ['a card with no run', async () => {}, {}, new RegExp(`card ${CARD} has no card run in goal .*; nothing to continue`)],
    ['--decisions 0', (s) => s.stopped(), { decisions: 0 }, /decisions 0 is not a whole number from 1 to 4/],
    ['a blank --by', (s) => s.stopped(), { by: ' ' }, /by is blank/],
  ];
  for (const [name, prepare, act, cause] of rows) {
    await scenario(async (s, fx) => {
      await prepare(s, fx);
      const held = s.bytes();
      const r = s.continueCli(act);
      assert.deepEqual([r.status, cause.test(r.stderr)], [1, true], `${name}: ${r.stderr}`);
      assert.deepEqual(s.bytes(), held, `${name}: the goal file, the card-run file and the journal are byte-identical`);
    }, name === 'a DONE goal' ? {} : CONFIG);
  }
});

test('acceptance 3: past the run\'s deadline the output names aidlc goal extend; with the deadline far ahead it names aidlc card next and not aidlc goal extend [R4]', async () => {
  for (const [at, extend] of [[PAST, true], [FAR, false]] as const) {
    await scenario(async (s) => {
      await s.stopped();
      s.deadline(at);
      const r = s.continueCli();
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual([r.stdout.includes(`aidlc goal extend ${s.goal.id}`), r.stdout.includes(`aidlc card next ${CARD}`), s.persisted().deadline], [extend, true, at], r.stdout);
    });
  }
});

test('acceptance 4: card continue run again on the continued run, with the goal in progress, exits non-zero with the runner\'s cause and records no second continuation [R3]', () => scenario(async (s) => {
  await s.stopped();
  s.deadline(FAR);
  assert.equal(s.continueCli().status, 0);
  assert.equal(s.g().state, 'CARDS');
  const again = s.continueCli();
  assert.deepEqual([again.status, /the card run is in BUILD, not in STOP/.test(again.stderr), s.persisted().continuations.length], [1, true, 1], again.stderr);
}));

test('R3 decision 1, F1: the human line states the run\'s state, the whole continuation, continued and readmitted as true or false, and the next command, on a re-admitted goal and on a two-card goal that is not stopped [R4]', async () => {
  for (const [ids, readmitted] of [[[CARD], true], [[CARD, 'T1-CD'], false]] as const) {
    await scenario(async (s) => {
      if (readmitted) await s.stopped(); else await s.stopCard();
      s.deadline(FAR);
      const r = s.cli('--no-json', 'card', 'continue', CARD, '--by', BY, '--reason', 'one more repair round');
      assert.equal(r.status, 0, r.stderr);
      const c = s.persisted().continuations.at(-1)!;
      for (const part of ['state=BUILD', 'continued=true', `readmitted=${readmitted}`, `continuation at ${c.at} by ${BY}: one more repair round`, `lifted stop review at ${c.stop.at}: ${c.stop.detail}`, 'decisions=1 admits=5', `aidlc card next ${CARD}`]) assert.ok(r.stdout.includes(part), `${part} in ${r.stdout}`);
    }, CONFIG, [...ids]);
  }
});
