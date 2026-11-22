// Card T1-AMEND-COMMAND: `aidlc card amend` calls `CardRunner.amendCard` from the command line and writes nothing itself.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs, { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture as fixture, writeCard, goalForCards, InjectedShipPath, T0, type CardSpec } from './_harness.ts';
import { hostName } from '../../src/state/paths.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { runCliInProcess } from '../infra/cli-inprocess.ts';

type Stored = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const [CARD, FILE, BY, REASON] = ['T1-AC', 'src/t1-ac.ts', 'the owner', 'requirement reworded'];
const SESSION = 'card-amend-command';
const FAR = '2099-01-01T00:00:00.000Z';
const SPEC: CardSpec = { id: CARD, title: 'card amend command', allowPaths: [FILE], requirements: ['R1. The amend shall hold.'], acceptance: ['1. amend holds. [R1]'], budget: 80 };
const [REQUIREMENTS, ACCEPTANCE] = [{ requirements: ['R1. The amend shall hold twice.'] }, { acceptance: ['1. amend holds twice. [R1]'] }];
const CONFIG = { gateRequired: true, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false, secondPass: false } };
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const TRANSIENT = '[CI-GATE-LOG] actions/runs/12345/job/456\nError: read ECONNRESET while fetching artifact\n[CI-GATE-RED] [{"name":"build","conclusion":"failure"}]\n[CI-GATE-STEP] {"check":"build","job":"456","step":{"number":1,"name":"Set up job","conclusion":"failure"}}';
const UNCLASSIFIED = '[CI-GATE-RED] job failed: https://github.com/o/r/actions/runs/555 ... the runner lost contact';
const block = (text: string) => { const reasons = [`[spec] 6 tests @ ${FILE}:1: ${text} -> add one`]; return JSON.stringify({ verdict: 'block', reasons, axes: { spec: { verdict: 'block', reasons }, standards: { verdict: 'pass', reasons: [] } } }) + '\n'; };
const CONTINUE = `aidlc card continue ${CARD}`;

/** The fault of tests/scenarios/card-amend.test.ts, thrown once: fs.appendFileSync onto a NOTE line with an amendment of the goal journal. */
const fault = { append: false };
const real = { appendFileSync: fs.appendFileSync };
before(() => {
  Object.assign(fs, { appendFileSync: (...a: Parameters<typeof fs.appendFileSync>) => { if (fault.append && String(a[0]).endsWith('.jsonl') && String(a[1]).includes('"amendment"')) { fault.append = false; throw Object.assign(new Error('EIO: injected'), { code: 'EIO' }); } return real.appendFileSync(...a); } });
  syncBuiltinESMExports();
});
after(() => { Object.assign(fs, real); syncBuiltinESMExports(); });

/** A one-card goal under a command reviewer, the loop's moves on it, the command through the CLI and readers of the files it may not write. */
function setup(fx: ReturnType<typeof fixture>) {
  const verdicts: string[] = [];
  const ship = new InjectedShipPath(['ci-red', 'ci-red'], TRANSIENT);
  const script = scriptedRunner({ 'git diff --name-only': () => ({ stdout: `${FILE}\u0000` }), 'git diff': () => ({ stdout: `diff --git a/${FILE} b/${FILE}\n+export const x = 1;\n` }), 'fake-r3': () => ({ stdout: verdicts.shift()! }) });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
  writeCard(fx, SPEC);
  const goal = goalForCards(fx, [CARD]);
  writeFileSync(path.join(fx.tmp, 'aidlc.config.json'), JSON.stringify({ cardsDir: 'specs/tasks', shipPath: 'dry-run', worktreeRoot: path.join(fx.tmp, 'wt'), ...CONFIG }));
  const g = () => fx.goal(goal.id);
  const card = () => fx.card(CARD);
  const persisted = () => fx.store.getCardRun(goal.id, CARD)!;
  const next = () => runner.next(g(), card(), persisted()).directive as Stored;
  const attempt = (sha: string) => runner.recordAttempt(g(), card(), persisted(), { outcome: 'success', dodReceipt: `dod:${sha}`, redReceipt: 'red:1', candidateSha: sha });
  /** The run started and in BUILD, its deadline ahead of the real clock the CLI reads. */
  const started = () => {
    runner.next(g(), card(), fx.controller.ensureCardRun(g(), CARD));
    assert.equal(next()['kind'], 'build');
    fx.store.updateCardRun(goal.id, CARD, (r) => ({ ...r!, deadline: FAR }));
  };
  /** Four R3 block decisions: the fourth stops the card for review, and `aidlc next` stops the goal for it. */
  const stoppedForReview = async () => {
    started();
    verdicts.push(...['no RED', 'no boundary row', 'no error row', 'no fault row'].map(block));
    for (const n of [1, 2, 3, 4]) { attempt(`sha-${n}`); next(); await runner.formalReview(g(), card(), persisted()); }
    assert.deepEqual([next()['kind'], persisted().stop?.reason, persisted().state], ['stop', 'review', 'STOP']);
    assert.deepEqual([(fx.controller.next(goal.id) as Stored)['stop']?.reason, g().state], ['review', 'STOP']);
  };
  /** An R3 pass, a ship whose transient CI failure takes the rerun, then an unclassified failure: the card stops for ci. */
  const stoppedForCi = async () => {
    started();
    verdicts.push(PASS);
    attempt('sha-1'); assert.equal(next()['kind'], 'review'); await runner.formalReview(g(), card(), persisted());
    assert.equal(next()['kind'], 'ship');
    runner.ciReconcile(g(), card(), persisted(), '12345', () => ({ status: 'completed', conclusion: 'success', attempt: 2 }));
    Object.assign(ship, { stdoutText: UNCLASSIFIED });
    assert.deepEqual([next()['kind'], persisted().stop?.reason, persisted().state], ['stop', 'ci', 'STOP']);
  };
  const changeCard = (delta: Partial<CardSpec>) => writeCard(fx, { ...SPEC, ...delta });
  const runFile = fx.store.cardFile(goal.id, CARD);
  const journalFile = path.join(fx.paths.journal, `${goal.id}.jsonl`);
  const bytes = () => [runFile, journalFile].map((f) => (existsSync(f) ? readFileSync(f, 'utf8') : ''));
  const amendmentNotes = () => readFileSync(journalFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Stored).filter((e) => e['type'] === 'NOTE' && e['data']?.amendment);
  const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: SESSION };
  const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, ...args, '--goal', goal.id], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  const amendArgs = (by = BY) => ['card', 'amend', CARD, '--by', by, '--reason', REASON];
  const amendCli = (by = BY, human = false) => cli(...(human ? ['--no-json'] : []), ...amendArgs(by));
  const amendInProcess = () => runCliInProcess([...amendArgs(), '--goal', goal.id], { cwd: fx.tmp, env });
  return { goal, g, persisted, started, stoppedForReview, stoppedForCi, changeCard, bytes, amendmentNotes, cli, amendCli, amendInProcess };
}
async function scenario(body: (s: ReturnType<typeof setup>, fx: ReturnType<typeof fixture>) => Promise<void>) {
  const fx = fixture({ config: CONFIG, actor: { session: SESSION, pid: 1, processStart: T0, host: hostName() } });
  try { await body(setup(fx), fx); } finally { fault.append = false; fx.cleanup(); }
}
/** The parts of the human line: the run's state and every field of the amendment by value. */
const humanParts = (state: string, a: Stored) => [`${CARD} state=${state};`, `amendment revision ${a['revision']} at ${a['at']} by ${a['by']}: ${a['reason']};`, `changed=${a['changed'].join(',')}`, `invalidated=${a['invalidated'].join(',') || 'none'}`];

test('acceptance 1: on a goal stopped for review with its card in STOP for review, after the requirements changed, card amend exits 0; the run holds the amendment, the stop and its state; the JSON output and the human line hold the state, the whole amendment and aidlc card continue; no other run exists [R1] [R2] [R4]', async () => {
  for (const human of [false, true]) {
    await scenario(async (s, fx) => {
      await s.stoppedForReview();
      const was = s.persisted();
      s.changeCard(REQUIREMENTS);
      const r = s.amendCli(BY, human);
      assert.equal(r.status, 0, r.stderr);
      const now = s.persisted();
      const a = now.amendments[0]!;
      assert.deepEqual(now.amendments, [{ at: a.at, by: BY, reason: REASON, revision: 1, changed: ['requirements'], invalidated: ['review'] }]);
      assert.ok(!Number.isNaN(Date.parse(a.at)) && a.at !== T0, a.at);
      assert.deepEqual([now.state, now.stop, s.g().state], ['STOP', was.stop, 'STOP']);
      if (human) {
        for (const part of [...humanParts('STOP', a), CONTINUE]) assert.ok(r.stdout.includes(part), `${part} in ${r.stdout}`);
      } else {
        const report = JSON.parse(r.stdout) as Stored;
        assert.deepEqual([report['cardId'], report['state'], report['amendment']], [CARD, 'STOP', { at: a.at, by: BY, reason: REASON, revision: 1, changed: ['requirements'], invalidated: ['review'] }]);
        assert.ok(String(report['next']).includes(CONTINUE), report['next']);
      }
      assert.deepEqual(fx.store.listCardRuns(s.goal.id).map((run) => run.cardId), [CARD]);
    });
  }
});

test('acceptance 2: on a run that is not stopped the JSON output and the human line hold the run\'s state and the whole amendment and do not name aidlc card continue; a run in STOP for ci names it in both [R4]', async () => {
  for (const human of [false, true]) {
    for (const ci of [false, true]) {
      await scenario(async (s) => {
        if (ci) await s.stoppedForCi(); else s.started();
        const state = ci ? 'STOP' : 'BUILD';
        s.changeCard(ACCEPTANCE);
        const r = s.amendCli(BY, human);
        assert.equal(r.status, 0, r.stderr);
        const a = s.persisted().amendments[0]!;
        const expected = { at: a.at, by: BY, reason: REASON, revision: 1, changed: ['acceptance'], invalidated: ['dod', 'review'] };
        assert.deepEqual([s.persisted().state, s.persisted().amendments], [state, [expected]]);
        if (human) for (const part of humanParts(state, expected)) assert.ok(r.stdout.includes(part), `${part} in ${r.stdout}`);
        else assert.deepEqual([(JSON.parse(r.stdout) as Stored)['state'], (JSON.parse(r.stdout) as Stored)['amendment']], [state, expected]);
        assert.equal(r.stdout.includes('aidlc card continue'), ci, r.stdout);
        if (!ci) assert.ok(r.stdout.includes(`aidlc card next ${CARD}`), r.stdout);
      });
    }
  }
});

test('acceptance 3: a card with no run, a contract equal to the card\'s and a blank --by each exit non-zero with the runner\'s cause and leave the card-run file and the journal byte-identical [R3]', async () => {
  const rows: Array<[name: string, prepare: (s: ReturnType<typeof setup>) => void, by: string, cause: RegExp]> = [
    ['a card with no run', (s) => s.changeCard(REQUIREMENTS), BY, new RegExp(`card ${CARD} has no card run in goal .*; nothing to amend`)],
    ['a contract equal to the card\'s', (s) => s.started(), BY, /the run's contract equals the card's: no contract field changed/],
    ['a blank --by', (s) => { s.started(); s.changeCard(REQUIREMENTS); }, ' ', /by is blank: name who amends the card/],
  ];
  for (const [name, prepare, by, cause] of rows) {
    await scenario(async (s, fx) => {
      prepare(s);
      const held = s.bytes();
      const r = s.amendCli(by);
      assert.deepEqual([r.status, cause.test(r.stderr)], [1, true], `${name}: ${r.stderr}`);
      assert.deepEqual(s.bytes(), held, `${name}: the card-run file and the journal are byte-identical`);
      assert.deepEqual(fx.store.listCardRuns(s.goal.id).map((run) => run.cardId), name === 'a card with no run' ? [] : [CARD], name);
    });
  }
});

test('acceptance 7: when the NOTE append fails after the write, card amend exits non-zero with the cause, the amendment stays and the event stays owed; one card next appends it once, and card amend again is refused [R7]', () => scenario(async (s) => {
  s.started();
  s.changeCard(ACCEPTANCE);
  fault.append = true;
  const r = await s.amendInProcess();
  assert.deepEqual([r.status, r.stderr.includes('EIO: injected')], [1, true], r.stderr);
  const run = s.persisted();
  const data = { by: BY, reason: REASON, revision: 1, changed: ['acceptance'], invalidated: ['dod', 'review'] };
  assert.deepEqual(run.amendments, [{ at: run.amendments[0]!.at, ...data }]);
  assert.deepEqual((run.journalOwed ?? []).filter((o) => o.type === 'NOTE').map((o) => o.data['amendment']), [data]);
  assert.equal(s.amendmentNotes().length, 0);
  const next = s.cli('card', 'next', CARD);
  assert.equal(next.status, 0, next.stderr);
  assert.deepEqual(s.amendmentNotes().map((e) => e['data']['amendment']), [data]);
  const again = s.amendCli();
  assert.deepEqual([again.status, /the run's contract equals the card's/.test(again.stderr), s.amendmentNotes().length, s.persisted().amendments.length], [1, true, 1, 1], again.stderr);
}));
