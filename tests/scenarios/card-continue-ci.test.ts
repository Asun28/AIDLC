// Card T1-CONTINUE-CI: `aidlc card continue` returns a run stopped for ci to BUILD with the diagnosed failure a counted attempt.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs, { readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture as fixture, writeCard, goalForCards, InjectedShipPath, T0 } from './_harness.ts';
import { hostName } from '../../src/state/paths.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';

type Stored = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const CARD = 'T1-CC';
const FILE = 'src/t1-cc.ts';
const BY = 'the owner';
const REASON = 'diagnosed: a fixture leak';
const CAUSE = `continuation by ${BY}: ${REASON}`;
const SESSION = 'card-continue-ci';
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const TRANSIENT = '[CI-GATE-LOG] actions/runs/12345/job/456\nError: read ECONNRESET while fetching artifact\n[CI-GATE-RED] [{"name":"build","conclusion":"failure"}]\n[CI-GATE-STEP] {"check":"build","job":"456","step":{"number":1,"name":"Set up job","conclusion":"failure"}}';
const UNCLASSIFIED = '[CI-GATE-RED] job failed: https://github.com/o/r/actions/runs/555 ... the runner lost contact';
const CONFIG = { gateRequired: true, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false, secondPass: false } };

/** The faults of tests/scenarios/fault-points.test.ts: a throw from fs.renameSync onto the card-run record, and from fs.appendFileSync onto the goal journal (`promoted`: onto a promoted ATTEMPT_STARTED line only). */
const fault = { record: false, append: false, promoted: false };
const real = { appendFileSync: fs.appendFileSync, renameSync: fs.renameSync };
const eio = () => Object.assign(new Error('EIO: injected'), { code: 'EIO' });
before(() => {
  Object.assign(fs, {
    appendFileSync: (...a: Parameters<typeof fs.appendFileSync>) => { if (String(a[0]).endsWith('.jsonl') && (fault.append || (fault.promoted && String(a[1]).includes('"promoted":true')))) throw eio(); return real.appendFileSync(...a); },
    renameSync: (from: fs.PathLike, to: fs.PathLike) => { if (fault.record && String(to).endsWith(`${CARD}.json`)) throw eio(); return real.renameSync(from, to); },
  });
  syncBuiltinESMExports();
});
after(() => { Object.assign(fs, real); syncBuiltinESMExports(); });

/** `body` on a one-card goal whose ship used its CI rerun and then failed CI unclassified: the run is in STOP for ci and so is the goal. */
async function scenario(body: (s: Awaited<ReturnType<typeof setup>>) => Promise<void> | void) {
  const fx = fixture({ config: CONFIG, actor: { session: SESSION, pid: 1, processStart: T0, host: hostName() } });
  try {
    await body(await setup(fx));
  } finally {
    Object.assign(fault, { record: false, append: false, promoted: false });
    fx.cleanup();
  }
}
async function setup(fx: ReturnType<typeof fixture>) {
  const ship = new InjectedShipPath(['ci-red', 'ci-red', 'ci-red'], TRANSIENT);
  const script = scriptedRunner({ 'git diff --name-only': { stdout: `${FILE}\u0000` }, 'git diff': { stdout: `diff --git a/${FILE} b/${FILE}\n+export const x = 1;\n` }, 'fake-r3': { stdout: PASS } });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
  writeCard(fx, { id: CARD, title: 'card continue ci', allowPaths: [FILE] });
  const goal = goalForCards(fx, [CARD]);
  writeFileSync(path.join(fx.tmp, 'aidlc.config.json'), JSON.stringify({ cardsDir: 'specs/tasks', shipPath: 'dry-run', worktreeRoot: path.join(fx.tmp, 'wt'), ...CONFIG }));
  const card = fx.card(CARD);
  const g = () => fx.goal(goal.id);
  const persisted = () => fx.store.getCardRun(goal.id, CARD)!;
  const next = () => runner.next(g(), card, persisted()).directive as Stored;
  const runFile = fx.store.cardFile(goal.id, CARD);
  const journalFile = path.join(fx.paths.journal, `${goal.id}.jsonl`);
  const events = (type?: string): Stored[] => readFileSync(journalFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => !type || e['type'] === type);
  const attempt = (sha: string) => runner.recordAttempt(g(), card, persisted(), { outcome: 'success', dodReceipt: `dod:${sha}`, redReceipt: 'red:1', candidateSha: sha });
  /** The R3 pass and the ship: returns the directive after the ship. */
  const reviewed = async () => { await runner.formalReview(g(), card, persisted()); return next(); };
  runner.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
  attempt('sha-1');
  assert.equal(next()['kind'], 'review');
  assert.equal((await reviewed())['kind'], 'ship', 'the transient failure takes the rerun');
  runner.ciReconcile(g(), card, persisted(), '12345', () => ({ status: 'completed', conclusion: 'success', attempt: 2 }));
  Object.assign(ship, { stdoutText: UNCLASSIFIED });
  assert.deepEqual([next()['kind'], persisted().stop?.reason, persisted().ci.reruns.length], ['stop', 'ci', 1]);
  assert.deepEqual([(fx.controller.next(goal.id) as Stored)['stop']?.reason, g().state], ['ci', 'STOP']);
  // The CLI reads the real clock, so the deadline is far ahead of it.
  fx.store.updateCardRun(goal.id, CARD, (r) => ({ ...r!, deadline: '2099-01-01T00:00:00.000Z' }));
  const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: SESSION };
  const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, ...args, '--goal', goal.id], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  const stored = (): Stored => JSON.parse(readFileSync(runFile, 'utf8'));
  /** `aidlc audit verify` on the goal: a clean exit, the goal's report with a verified, non-empty journal chain and no WORK_AFTER_TERMINAL. */
  const audited = () => {
    const r = cli('audit', 'verify', '--json');
    assert.deepEqual([r.status, r.signal, r.error], [0, null, undefined], `${r.stdout}${r.stderr}`);
    const reports = JSON.parse(r.stdout) as Stored[];
    assert.deepEqual(reports.map((x) => [x['goalId'], x['journal'].ok, x['journal'].events > 0, x['findings'].filter((f: Stored) => f['code'] === 'WORK_AFTER_TERMINAL')]), [[goal.id, true, true, []]]);
  };
  return {
    goal, g, persisted, next, attempt, reviewed, events, cli, stored, audited,
    continueCli: (...extra: string[]) => cli(...extra, 'card', 'continue', CARD, '--by', BY, '--reason', REASON),
    go: () => runner.continueStop(g(), card, { by: BY, reason: REASON }),
    seed: (change: (run: Stored) => void) => { const run = stored(); change(run); writeFileSync(runFile, JSON.stringify(run, null, 2), 'utf8'); },
    bytes: () => [fx.store.goalFile(goal.id), journalFile, runFile].map((f) => readFileSync(f, 'utf8')),
  };
}
const R2 = ['ci', 'review', 'findings', 'candidate', 'redReceipt', 'deadline'];
const pick = (run: Stored) => R2.map((k) => run[k]);
const strip = (e: Stored) => { const { eventKey: _key, ...data } = e['data']; return data; };
/** The run's effort attempts rebuilt from its first one, one per [outcome, cause, progress]; the episode is open unless the last is a success. */
const reshape = (run: Stored, ...rows: Array<[string, string?, boolean?]>) => { const a = run['effort'].attempts[0]; run['effort'].attempts = rows.map(([outcome, cause, progress], i) => ({ ...a, n: i + 1, outcome, cause, progress: !!progress, ...(outcome === 'running' ? { finishedAt: undefined } : {}) })); if (rows.at(-1)![0] !== 'success') delete run['effort'].terminal; };

test('acceptance 1, 2, 3 and 5: card continue on a ci stop counts the bound success as a failed attempt with the act as its cause, keeps every R2 field, re-admits the goal; card next builds attempt 2, the repair is reviewed, and a second unclassified failure stops for ci with the rerun ledger kept [R1] [R2] [R4]', () => scenario(async (s) => {
  const was = s.stored();
  const r = s.continueCli();
  assert.equal(r.status, 0, r.stderr);
  const now = s.stored();
  assert.deepEqual([now['state'], 'stop' in now, 'blocker' in now, 'dodReceipt' in now, 'blockedReceipt' in now, now['continuations'].length, now['continuations'][0].stop.reason], ['BUILD', false, false, false, false, 1, 'ci']);
  assert.deepEqual(now['effort'].attempts.map((a: Stored) => [a.n, a.outcome, a.cause]), [[1, 'fail', CAUSE]]);
  assert.deepEqual(pick(now), pick(was));
  assert.equal(s.g().state, 'CARDS');
  assert.deepEqual(s.events('GOAL_STATE').filter((e) => e['data'].continuation).map((e) => e['data'].continuation), [{ cardId: CARD, by: BY }]);
  assert.deepEqual(s.events('CARD_STATE').filter((e) => e['data'].continuation).map(strip), [{ from: 'STOP', to: 'readmitted', continuation: { by: BY, reason: REASON, stop: 'ci' } }]);
  assert.deepEqual(s.events('ATTEMPT_FINISHED').filter((e) => e['data'].refutedBy === 'continuation').map(strip), [{ n: 1, outcome: 'fail', cause: CAUSE, refutedBy: 'continuation' }]);
  const build = JSON.parse(s.cli('card', 'next', CARD).stdout)['directive'];
  assert.deepEqual([build.kind, build.attempt], ['build', 2]);
  s.attempt('sha-2');
  assert.equal(JSON.parse(s.cli('card', 'next', CARD).stdout)['directive'].kind, 'review');
  assert.equal((await s.reviewed())['kind'], 'stop');
  assert.deepEqual([s.persisted().stop?.reason, s.persisted().ci.reruns.slice(0, 1)], ['ci', was['ci'].reruns]);
  s.audited();
}));

test('acceptance 4: a ladder that admits no attempt, --decisions 1 and a run with no effort episode are each refused with their cause, the goal file, the card-run file and the journal byte-identical [R3]', async () => {
  const rows: Array<[string, (run: Stored) => void, string[], RegExp]> = [
    ['ladder', (run) => reshape(run, ['fail', CAUSE], ['success']), [], /the effort ladder admits no repair attempt: same-cause-stop/],
    ['escalation past the deadline', (run) => { reshape(run, ['fail', 'a'], ['fail', 'b'], ['success', undefined, true]); run['deadline'] = '2020-01-01T00:00:00.000Z'; }, [], /the effort ladder admits no repair attempt: exhausted: escalation requires/],
    ['decisions', () => {}, ['--decisions', '1'], /decisions 1 is given/],
    ['no effort episode', (run) => { delete run['effort']; }, [], /no effort episode/],
  ];
  for (const [name, change, extra, cause] of rows) {
    await scenario((s) => {
      s.seed(change);
      const held = s.bytes();
      const r = s.cli('card', 'continue', CARD, '--by', BY, '--reason', REASON, ...extra);
      assert.deepEqual([r.status, cause.test(r.stderr)], [1, true], `${name}: ${r.stderr}`);
      assert.deepEqual(s.bytes(), held, name);
    });
  }
});

test('acceptance 5, fault rows: a failed card-run write changes no byte; a failed journal append keeps the continuation and the next card next appends each owed event once [R4]', () => scenario((s) => {
  const held = s.bytes();
  fault.record = true; assert.throws(() => s.go(), /EIO: injected/); fault.record = false;
  assert.deepEqual(s.bytes().slice(1), held.slice(1));
  fault.append = true; assert.throws(() => s.go(), /EIO: injected/); fault.append = false;
  assert.deepEqual([s.persisted().continuations.length, s.events('CARD_STATE').filter((e) => e['data'].continuation).length], [1, 0]);
  s.next();
  assert.deepEqual([s.events('CARD_STATE').filter((e) => e['data'].continuation).length, s.events('ATTEMPT_FINISHED').filter((e) => e['data'].refutedBy === 'continuation').length], [1, 1]);
}));

test('guard rows: inside the deadline the ladder escalates the repair, and a run whose last settled attempt failed owes no ATTEMPT_FINISHED [R1] [R4]', async () => {
  const rows: Array<[Array<[string, string?, boolean?]>, string, number]> = [[[['fail', 'a'], ['fail', 'b'], ['success', undefined, true]], 'high', 1], [[['fail', 'a']], 'medium', 0]];
  for (const [shape, effort, refuted] of rows) {
    await scenario((s) => {
      s.seed((run) => reshape(run, ...shape));
      s.go();
      assert.deepEqual([s.next()['effort'], s.events('ATTEMPT_FINISHED').filter((e) => e['data'].refutedBy === 'continuation').length], [effort, refuted]);
    });
  }
});

test('R3 decision 1, F1 and F2: a running repair the ladder promotes is owed its ATTEMPT_STARTED by the act and appended once by the next card next, after the GOAL_STATE re-admission, also when that append failed once; the audit is clean [R4]', async () => {
  for (const failFirst of [false, true]) {
    await scenario((s) => {
      // No public path builds a run stopped for ci with a running repair: the record is seeded through the store.
      s.seed((run) => reshape(run, ['fail', 'a'], ['fail', 'b'], ['success', undefined, true], ['running']));
      assert.equal(s.continueCli().status, 0);
      const promoted = (e: Stored) => e['type'] === 'ATTEMPT_STARTED' && e['data'].promoted === true;
      const data = { n: 4, effort: 'high', escalated: true, promoted: true, from: 'medium', reason: 'ship-failure' };
      const now = s.stored();
      assert.deepEqual([now['effort'].attempts.map((a: Stored) => [a.n, a.outcome, a.cause, a.effort]), now['effort'].escalationUsed, now['effort'].terminal], [[[1, 'fail', 'a', 'medium'], [2, 'fail', 'b', 'medium'], [3, 'fail', CAUSE, 'medium'], [4, 'running', undefined, 'high']], true, undefined]);
      assert.deepEqual(now['journalOwed'].filter(promoted).map(strip), [data]);
      assert.equal(s.events().filter(promoted).length, 0, 'the act leaves the promotion owed');
      if (failFirst) { fault.promoted = true; assert.throws(() => s.next(), /EIO: injected/); fault.promoted = false; assert.equal(s.events().filter(promoted).length, 0); }
      assert.equal(s.cli('card', 'next', CARD).status, 0);
      assert.deepEqual(s.events().filter(promoted).map(strip), [{ ...data, completed: true }]);
      const ours = s.events().filter((e) => e['data'].continuation || e['data'].refutedBy === 'continuation' || promoted(e)).map((e) => e['type']);
      assert.deepEqual(ours, ['CARD_STATE', 'ATTEMPT_FINISHED', 'GOAL_STATE', 'ATTEMPT_STARTED']);
      s.audited();
    });
  }
});

test('acceptance 8: the JSON output and the human line hold the state, the continuation with no decisions or admits, continued, readmitted and the next command; --help names review and ci [R6]', async () => {
  for (const human of [false, true]) {
    await scenario((s) => {
      const r = s.continueCli(...(human ? ['--no-json'] : []));
      assert.equal(r.status, 0, r.stderr);
      const c = s.persisted().continuations[0]!;
      for (const word of ['decisions', 'admits', 'undefined']) assert.ok(!r.stdout.includes(word), `${word} in ${r.stdout}`);
      if (!human) {
        const report = JSON.parse(r.stdout);
        assert.deepEqual([report.state, report.continuation, report.continued, report.readmitted], ['BUILD', { at: c.at, by: BY, reason: REASON, stop: c.stop }, true, true]);
        return assert.match(report.next, new RegExp(`aidlc card next ${CARD}`));
      }
      for (const part of ['state=BUILD', 'continued=true', 'readmitted=true', `continuation at ${c.at} by ${BY}: ${REASON}`, `lifted stop ci at ${c.stop.at}: ${c.stop.detail}`, `aidlc card next ${CARD}`]) assert.ok(r.stdout.includes(part), `${part} in ${r.stdout}`);
    });
  }
  const help = spawnSync(process.execPath, [MAIN, 'card', 'continue', '--help'], { encoding: 'utf8', windowsHide: true }).stdout;
  assert.match(help, /\breview\b.*\bci\b/s);
});
