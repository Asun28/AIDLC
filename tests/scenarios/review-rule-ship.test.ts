// Card T1-REVIEW-RULE-SHIP: the ruling that settles the last merge-blocking finding of the stopping R3 decision lifts the card's stop, and the candidate that decision reviewed ships as passed by ruling.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs, { readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, goalForCards } from './_harness.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';

/** The CLI from the sources, never a compiled build that may be stale. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const FILE = 'src/t1-rs.ts';
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
/** A command reviewer with the second pass on: a ruled pass must get none (R4). */
const CONFIG = { config: { gateRequired: true, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false, secondPass: true } } };
type Stored = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const OWNER = ['--by', 'the owner', '--reason', 'the row is tests/t1-rs.test.ts:9'];
const BY = { by: 'the owner', reason: 'the row is tests/t1-rs.test.ts:9' };
/** Decision 1 raises F1; decision 2, on the repaired candidate, re-raises the disputed F1, which stops the card: the stopping decision holds one finding. */
const RERAISE = [['no RED -> add one'], ['still no RED (re:F1) -> add one']];

/** The faults of tests/scenarios/fault-points.test.ts, switched on by a test: a throw from fs.renameSync onto the card-run record, and from fs.appendFileSync onto a goal journal line of the named event type. */
const fault: { record: boolean; append?: 'FINDING_RULED' | 'REVIEW_DECIDED' } = { record: false };
const real = { append: fs.appendFileSync, rename: fs.renameSync };
before(() => {
  (fs as unknown as Stored)['appendFileSync'] = (...args: Parameters<typeof fs.appendFileSync>) => {
    if (fault.append && typeof args[1] === 'string' && args[1].includes(`"type":"${fault.append}"`)) throw Object.assign(new Error('EIO: injected'), { code: 'EIO' });
    return real.append(...args);
  };
  (fs as unknown as Stored)['renameSync'] = (from: fs.PathLike, to: fs.PathLike) => {
    if (fault.record && String(to).endsWith('T1-RS.json')) throw Object.assign(new Error('EIO: injected'), { code: 'EIO' });
    return real.rename(from, to);
  };
  syncBuiltinESMExports();
});
after(() => {
  fs.appendFileSync = real.append;
  fs.renameSync = real.rename;
  syncBuiltinESMExports();
});

/** A card run a command reviewer stopped at R3: one block per entry of `blocks`, each on its own candidate (sha-1, sha-2, ...); `dispute` is disputed before the last decision. */
async function stopped(fx: ReturnType<typeof makeFixture>, blocks: string[][], dispute: string[] = []) {
  const verdicts = blocks.map((texts) => {
    const reasons = texts.map((text, i) => `[spec] 6 tests @ ${FILE}:${i + 1}: ${text}`);
    return JSON.stringify({ verdict: 'block', reasons, axes: { spec: { verdict: 'block', reasons }, standards: { verdict: 'pass', reasons: [] } } }) + '\n';
  });
  const reviews = { count: 0 };
  const script = scriptedRunner({
    'git diff --name-only': { stdout: `${FILE}\u0000` },
    'git diff': { stdout: `diff --git a/${FILE} b/${FILE}\n+export const x = 1;\n` },
    'fake-r3': () => { reviews.count += 1; return { stdout: verdicts.shift()! }; },
  });
  const ship = new DryRunShipPath(['merged']);
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
  writeCard(fx, { id: 'T1-RS', title: 'review rule ship', allowPaths: [FILE] });
  const goal = goalForCards(fx, ['T1-RS']);
  const card = fx.card('T1-RS');
  const g = () => fx.goal(goal.id);
  const persisted = () => fx.store.getCardRun(goal.id, 'T1-RS')!;
  let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-RS'));
  for (let n = 1; n <= blocks.length; n++) {
    r = runner.next(g(), card, runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: `dod:${n}`, redReceipt: 'red:1', candidateSha: `sha-${n}` }));
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    if (n === blocks.length) for (const id of dispute) runner.disputeFinding(g(), card, persisted(), id, 'the row exists');
    r = runner.next(g(), card, (await runner.formalReview(g(), card, persisted())).run);
  }
  assert.deepEqual([r.directive.kind, persisted().state, persisted().stop?.reason, persisted().review.substantiveDecisions], ['stop', 'STOP', 'review', blocks.length], r.directive.narration);

  const runFile = fx.store.cardFile(goal.id, 'T1-RS');
  const journalFile = path.join(fx.paths.journal, `${goal.id}.jsonl`);
  const bytes = () => [readFileSync(runFile, 'utf8'), readFileSync(journalFile, 'utf8')];
  const stored = (): Stored => JSON.parse(readFileSync(runFile, 'utf8'));
  /** Rewrite a field of the stored run, as a test sets a deadline or a candidate. */
  const seed = (change: (run: Stored) => void) => { const run = stored(); change(run); writeFileSync(runFile, JSON.stringify(run, null, 2), 'utf8'); };
  const events = (): Stored[] => readFileSync(journalFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  /** The journal's FINDING_RULED events and its REVIEW_DECIDED events of a ruled pass, in order, as `[type, completed]`. */
  const rulingEvents = () => events().filter((e) => e['type'] === 'FINDING_RULED' || (e['type'] === 'REVIEW_DECIDED' && e['data'].ruled)).map((e) => [e['type'], e['data'].completed]);
  // No session variable of the calling environment reaches the CLI: CI sets none.
  const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: fx.paths.root };
  delete env['CLAUDE_CODE_SESSION_ID'];
  delete env['AIDLC_SESSION'];
  const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, ...args, '--goal', goal.id], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  /** `CardRunner.ruleFinding` on the stored run, with the fixture clock. */
  const rule = (id: string, decision: 'rejected' | 'deferred', issue?: number) => runner.ruleFinding(g(), card, id, { decision, ...BY, ...(issue ? { issue } : {}) });
  /** `card next` through the runner, with the fixture clock and the dry-run ship path. */
  const next = () => runner.next(g(), card, persisted());
  /** The run after `card next` shipped candidate `sha`: one dispatch of the dry-run ship, merged, and no review beyond the `decisions` that stopped the card. */
  const assertShipped = (kind: string, sha: string, decisions: number) => {
    assert.equal(kind, 'close', 'card next returns the directive of the merged ship, never review or stop');
    assert.deepEqual(ship.requests.map((q) => q.candidateSha), [sha], 'one ship, of the unchanged candidate');
    assert.deepEqual([persisted().state, persisted().mergeVerified, persisted().candidate?.sha, reviews.count, persisted().review.substantiveDecisions], ['CLOSE', true, sha, decisions, decisions]);
    assert.equal(persisted().review.invocations.some((i) => i.secondPass || i.outcome === 'pending'), false, 'no second pass and no reservation');
  };
  return { ship, persisted, runFile, bytes, stored, seed, events, rulingEvents, cli, rule, next, assertShipped };
}

test('acceptance 1, 2, 4 and 5: on a run stopped at R3 decision 4 with two findings, the first ruling leaves the stop and the second lifts it, moves no counter, receipt or deadline, owes one REVIEW_DECIDED, and the unchanged candidate ships with its canonical pass [R1] [R2] [R3] [R4] [R5] [R6]', async () => {
  const fx = makeFixture(CONFIG);
  try {
    const { stored, events, rulingEvents, rule, next, assertShipped } = await stopped(fx, [['no RED -> add one'], ['no boundary row -> add one'], ['no error row -> add one'], ['no fault row -> add one', 'no doc row -> add one']]);
    const was = stored();
    const stopping = was['review'].invocations.findIndex((i: Stored) => i.stopReview);
    assert.deepEqual(was['findings'].filter((f: Stored) => f['candidateSha'] === 'sha-4').map((f: Stored) => f['id']), ['F4', 'F5']);
    const fixed = (run: Stored) => [run['review'].substantiveDecisions, run['review'].substantiveBlocks, run['review'].noVerdictRetriesUsed, run['dodReceipt'], run['redReceipt'], run['deadline']];
    assert.deepEqual(fixed(was), [4, 4, 0, 'dod:4', 'red:1', '2026-09-11T03:00:00.000Z']);

    // The first ruling leaves F5 unruled: the run stays stopped and no invocation changes.
    rule('F4', 'rejected');
    const first = stored();
    assert.deepEqual([first['state'], first['stop'], first['review']], ['STOP', was['stop'], was['review']]);
    assert.deepEqual(rulingEvents(), [['FINDING_RULED', undefined]]);

    // The second ruling settles the last finding: the same update lifts the stop.
    fx.advance(3_600_000);
    rule('f5', 'deferred', 7);
    const now = stored();
    const lifted = now['review'].invocations[stopping];
    const pass = now['review'].invocations.at(-1);
    assert.deepEqual(lifted, { ...was['review'].invocations[stopping], stopLifted: { at: '2026-09-11T01:00:00.000Z', by: 'the owner' } });
    assert.deepEqual(pass, { invocationId: `ruling:${lifted.invocationId}`, candidateDigest: lifted.candidateDigest, candidateSha: 'sha-4', base: 'main', policyVersion: lifted.policyVersion, reviewer: 'ruling:the owner', requestedAt: '2026-09-11T01:00:00.000Z', outcome: 'pass', ruled: true });
    assert.deepEqual([lifted.candidateDigest, now['candidate'].digest, now['state'], 'stop' in now], [was['candidate'].digest, was['candidate'].digest, 'SHIP', false]);
    assert.deepEqual(fixed(now), [4, 4, 0, 'dod:4', 'red:1', '2026-09-11T03:00:00.000Z']);
    // Every invocation but the stopping one is as it was, the pass is the only new one, and so is every field of the run but the ones the lift and the store move.
    assert.deepEqual(now['review'].invocations.filter((_: Stored, i: number) => i !== stopping), [...was['review'].invocations.filter((_: Stored, i: number) => i !== stopping), pass]);
    const rest = ({ revision: _r, updatedAt: _u, journalOwed: _o, findings: _f, state: _s, stop: _t, blocker: _b, review: { invocations: _i, ...ledger }, ...other }: Stored): Stored => ({ ...other, ledger });
    assert.deepEqual(rest(now), rest(was));
    assert.equal(now['revision'], was['revision'] + 2);

    // Acceptance 5: after the last FINDING_RULED, exactly one REVIEW_DECIDED, of the ruled pass, with `ruled` and `by` in its persisted data.
    assert.deepEqual(rulingEvents(), [['FINDING_RULED', undefined], ['FINDING_RULED', undefined], ['REVIEW_DECIDED', undefined]]);
    const decided = events().at(-1)!;
    assert.deepEqual([decided['type'], decided['cardId'], decided['data']], ['REVIEW_DECIDED', 'T1-RS', { invocationId: pass.invocationId, reviewer: 'ruling:the owner', candidateDigest: lifted.candidateDigest, candidateSha: 'sha-4', outcome: 'pass', ruled: true, by: 'the owner', ruledFindings: ['F4', 'F5'], eventKey: decided['data'].eventKey }]);
    assert.deepEqual(now['journalOwed'].map((o: Stored) => [o['type'], o['data']]), [['FINDING_RULED', events().at(-2)!['data']], ['REVIEW_DECIDED', decided['data']]]);

    // Acceptance 2: card next ships the unchanged candidate; with decision 4 used, any review directive would be a stop.
    assertShipped(next().directive.kind, 'sha-4', 4);
    assert.deepEqual(rulingEvents().map(([type]) => type), ['FINDING_RULED', 'FINDING_RULED', 'REVIEW_DECIDED']);
    // Acceptance 4: the canonical document is a pass for the candidate sha, with one advisory entry per ruled finding.
    const doc: Stored = JSON.parse(readFileSync(path.join(fx.tmp, '.review', 'T1-RS.json'), 'utf8'));
    assert.deepEqual([doc['verdict'], doc['sha'], doc['reasons'], doc['invocationId'], doc['reviewer']], ['pass', 'sha-4', [], pass.invocationId, 'ruling:the owner']);
    assert.deepEqual(doc['advisory'], [
      `F4 ruled rejected by the owner: the row is tests/t1-rs.test.ts:9; the finding: [spec] 6 tests @ ${FILE}:1: no fault row -> add one`,
      `F5 ruled deferred (issue 7) by the owner: the row is tests/t1-rs.test.ts:9; the finding: [spec] 6 tests @ ${FILE}:2: no doc row -> add one`,
    ]);
  } finally {
    fx.cleanup();
  }
});

test('acceptance 3 and 6: on a run stopped at decision 2 by a re-raise, one ruling through the CLI lifts the stop, its output names aidlc card next and not aidlc goal extend while the deadline is ahead, and the candidate ships with no second pass [R1] [R3] [R4] [R7]', async () => {
  const fx = makeFixture(CONFIG);
  try {
    const { stored, seed, cli, next, assertShipped } = await stopped(fx, RERAISE, ['F1']);
    seed((run) => { run['deadline'] = '2999-01-01T00:00:00.000Z'; });
    const ruled = cli('review', 'rule', 'T1-RS', 'F1', '--reject', ...OWNER);
    assert.equal(ruled.status, 0, ruled.stderr);
    assert.match(ruled.stdout, /aidlc card next T1-RS/);
    assert.doesNotMatch(ruled.stdout, /aidlc goal extend/);
    const now = stored();
    const [lifted, pass] = now['review'].invocations.slice(-2);
    assert.match(lifted.stopLifted?.at ?? '', ISO);
    assert.deepEqual([lifted.stopLifted, typeof lifted.stopReview], [{ at: lifted.stopLifted.at, by: 'the owner' }, 'string']);
    assert.deepEqual([pass.outcome, pass.ruled, pass.reviewer, pass.candidateSha, pass.candidateDigest, pass.requestedAt], ['pass', true, 'ruling:the owner', 'sha-2', lifted.candidateDigest, lifted.stopLifted.at]);
    assert.deepEqual([now['state'], 'stop' in now, now['review'].substantiveDecisions, now['review'].substantiveBlocks, now['review'].noVerdictRetriesUsed, now['dodReceipt'], now['redReceipt'], now['deadline']], ['SHIP', false, 2, 2, 0, 'dod:2', 'red:1', '2999-01-01T00:00:00.000Z']);
    // Two decisions are used, so without the ruled pass a second pass would be due on a passed candidate (formalReview.secondPass).
    assertShipped(next().directive.kind, 'sha-2', 2);
  } finally {
    fx.cleanup();
  }
});

test('acceptance 6: with the card deadline in the past the output of the lifting ruling names aidlc goal extend, the deadline is not moved, and aidlc card next stops for time [R2] [R7]', async () => {
  const fx = makeFixture(CONFIG);
  try {
    const { ship, stored, seed, cli } = await stopped(fx, RERAISE, ['F1']);
    seed((run) => { run['deadline'] = '2000-01-01T00:00:00.000Z'; });
    const ruled = cli('review', 'rule', 'T1-RS', 'F1', '--defer', ...OWNER);
    assert.equal(ruled.status, 0, ruled.stderr);
    assert.match(ruled.stdout, /aidlc card next T1-RS/);
    assert.match(ruled.stdout, /aidlc goal extend/);
    assert.deepEqual([stored()['state'], stored()['deadline']], ['SHIP', '2000-01-01T00:00:00.000Z']);
    const after = cli('card', 'next', 'T1-RS');
    assert.equal(after.status, 0, after.stderr);
    const directive = (JSON.parse(after.stdout) as Stored)['directive'];
    assert.deepEqual([directive.kind, directive.stop.reason, ship.requests.length], ['stop', 'time', 0]);
  } finally {
    fx.cleanup();
  }
});

test('acceptance 7: after the lift a candidate other than the one the stopping decision reviewed gets no ship from the ruled pass [R4]', async () => {
  const fx = makeFixture(CONFIG);
  try {
    const { ship, stored, seed, rule, next } = await stopped(fx, RERAISE, ['F1']);
    rule('F1', 'rejected');
    assert.equal(stored()['state'], 'SHIP');
    // A commit on the branch after the lift: the run's candidate is sha-3, which no decision reviewed.
    seed((run) => { run['candidate'] = { ...run['candidate'], sha: 'sha-3', digest: 'sha-3' }; });
    const directive = next().directive;
    // Both decisions are used, so the review sha-3 needs stops the card by the allowance rule.
    assert.deepEqual([directive.kind, directive.kind === 'stop' ? directive.stop.reason : undefined, ship.requests.length], ['stop', 'review', 0], directive.narration);
  } finally {
    fx.cleanup();
  }
});

test('acceptance 5, fault rows: a failed card-run write at the lifting ruling changes nothing; a failed append of either owed event keeps the lift, and card next delivers each event once [R6]', async () => {
  for (const append of ['FINDING_RULED', 'REVIEW_DECIDED'] as const) {
    const fx = makeFixture(CONFIG);
    try {
      const { bytes, stored, rulingEvents, rule, next, assertShipped } = await stopped(fx, RERAISE, ['F1']);
      // The card-run write fails: the command throws, and the card-run file and the journal keep their bytes.
      const held = bytes();
      fault.record = true;
      try {
        assert.throws(() => rule('F1', 'rejected'), /EIO: injected/);
      } finally {
        fault.record = false;
      }
      assert.deepEqual(bytes(), held, 'the card-run file and the journal are byte-identical');

      // The append fails after the write: the lift is in the run, and the events not appended are owed.
      fault.append = append;
      try {
        assert.throws(() => rule('F1', 'rejected'), /EIO: injected/);
      } finally {
        fault.append = undefined;
      }
      const now = stored();
      assert.deepEqual([now['state'], 'stop' in now, now['review'].invocations.at(-2).stopLifted?.by, now['review'].invocations.at(-1).ruled], ['SHIP', false, 'the owner', true], `${append}: the lift stands`);
      assert.deepEqual(now['journalOwed'].map((o: Stored) => o['type']), ['FINDING_RULED', 'REVIEW_DECIDED']);
      assert.deepEqual(rulingEvents(), append === 'FINDING_RULED' ? [] : [['FINDING_RULED', undefined]], `${append}: nothing past the failed append`);
      // Two card next calls: the first delivers what is owed and ships, and neither appends an event twice.
      const kind = next().directive.kind;
      next();
      assert.deepEqual(rulingEvents(), append === 'FINDING_RULED' ? [['FINDING_RULED', true], ['REVIEW_DECIDED', true]] : [['FINDING_RULED', undefined], ['REVIEW_DECIDED', true]], `${append}: exactly one FINDING_RULED and one ruled REVIEW_DECIDED`);
      assertShipped(kind, 'sha-2', 2);
    } finally {
      fx.cleanup();
    }
  }
});
