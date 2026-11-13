// Card T1-REVIEW-RULE-2 (replaces T1-REVIEW-RULE): `aidlc review rule` records the owner's ruling on a finding of the R3 decision that stopped a card.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs, { readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, goalForCards } from './_harness.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { ruleFinding } from '../../src/core/review-policy.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';

/** The CLI from the sources, never a compiled build that may be stale. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const FILE = 'src/t1-rr.ts';
const block = (...texts: string[]): string => {
  const reasons = texts.map((text, i) => `[spec] 6 tests @ ${FILE}:${i + 1}: ${text}`);
  return JSON.stringify({ verdict: 'block', reasons, axes: { spec: { verdict: 'block', reasons }, standards: { verdict: 'pass', reasons: [] } } }) + '\n';
};
/** A stored record as the file holds it; the test reads the card-run file and the journal file, the two things a ruling may write. */
type Stored = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const OWNER = ['--by', 'the owner', '--reason', 'the row is tests/t1-rr.test.ts:9'];
const finding = (run: Stored, id: string): Stored => run['findings'].find((f: Stored) => f['id'] === id);

/** The faults of tests/scenarios/fault-points.test.ts, switched on by a test: a throw from fs.renameSync onto the card-run record, and from fs.appendFileSync onto a FINDING_RULED line of the goal journal. */
const fault = { record: false, append: false };
const real = { append: fs.appendFileSync, rename: fs.renameSync };
before(() => {
  (fs as unknown as Stored)['appendFileSync'] = (...args: Parameters<typeof fs.appendFileSync>) => {
    if (fault.append && typeof args[1] === 'string' && args[1].includes('"type":"FINDING_RULED"')) throw Object.assign(new Error('EIO: injected'), { code: 'EIO' });
    return real.append(...args);
  };
  (fs as unknown as Stored)['renameSync'] = (from: fs.PathLike, to: fs.PathLike) => {
    if (fault.record && String(to).endsWith('T1-RR.json')) throw Object.assign(new Error('EIO: injected'), { code: 'EIO' });
    return real.rename(from, to);
  };
  syncBuiltinESMExports();
});
after(() => {
  fs.appendFileSync = real.append;
  fs.renameSync = real.rename;
  syncBuiltinESMExports();
});

/** A card run a command reviewer stopped at R3 decision 2, with readers of its card-run file and journal and the CLI on its state. */
async function stopped(fx: ReturnType<typeof makeFixture>) {
  // Decision 1 on sha-1 raises F1 to F3. Decision 2 on sha-2 re-raises the disputed F1 and F2, which stops the card; F3 is
  // disputed while decision 2 runs, so that decision neither re-raises nor resolves it.
  const verdicts = [block('no RED -> add one', 'no boundary row -> add one', 'no error row -> add one'), block('still no RED (re:F1) -> add one', 'still no boundary row (re:F2) -> add one')];
  let during: (() => void) | undefined;
  const script = scriptedRunner({
    'git diff --name-only': { stdout: `${FILE}\u0000` },
    'git diff': { stdout: `diff --git a/${FILE} b/${FILE}\n+export const x = 1;\n` },
    'fake-r3': () => { during?.(); return { stdout: verdicts.shift()! }; },
  });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
  writeCard(fx, { id: 'T1-RR', title: 'review rule', allowPaths: [FILE] });
  const goal = goalForCards(fx, ['T1-RR']);
  const card = fx.card('T1-RR');
  const g = () => fx.goal(goal.id);
  const persisted = () => fx.store.getCardRun(goal.id, 'T1-RR')!;
  let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-RR'));
  r = runner.next(g(), card, runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' }));
  assert.equal(r.directive.kind, 'review', r.directive.narration);
  r = runner.next(g(), card, (await runner.formalReview(g(), card, r.run)).run);
  r = runner.next(g(), card, runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-2' }));
  assert.equal(r.directive.kind, 'review', r.directive.narration);
  for (const id of ['F1', 'F2']) runner.disputeFinding(g(), card, persisted(), id, 'the row exists');
  during = () => void runner.disputeFinding(g(), card, persisted(), 'F3', 'answered while decision 2 ran');
  r = runner.next(g(), card, (await runner.formalReview(g(), card, persisted())).run);
  assert.equal(r.directive.kind, 'stop', r.directive.narration);
  assert.deepEqual([persisted().state, persisted().stop?.reason], ['STOP', 'review']);
  assert.match(persisted().review.invocations.at(-1)?.stopReview ?? '', /re-raised unresolved finding\(s\) F1, F2/);
  assert.deepEqual(persisted().findings.map((f) => [f.id, f.candidateSha, f.reraised.map((x) => x.candidateSha), Boolean(f.resolvedAt)]), [['F1', 'sha-1', ['sha-2'], false], ['F2', 'sha-1', ['sha-2'], false], ['F3', 'sha-1', [], false]]);

  const runFile = fx.store.cardFile(goal.id, 'T1-RR');
  const journalFile = path.join(fx.paths.journal, `${goal.id}.jsonl`);
  const bytes = () => [readFileSync(runFile, 'utf8'), readFileSync(journalFile, 'utf8')];
  const stored = (): Stored => JSON.parse(readFileSync(runFile, 'utf8'));
  const events = (): Stored[] => readFileSync(journalFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  /** The FINDING_RULED events of the journal as `[cardId, data]`. */
  const ruled = () => events().filter((e) => e['type'] === 'FINDING_RULED').map((e) => [e['cardId'], e['data']]);
  // No session variable of the calling environment reaches the CLI: CI sets none.
  const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: fx.paths.root };
  delete env['CLAUDE_CODE_SESSION_ID'];
  delete env['AIDLC_SESSION'];
  const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, ...args, '--goal', goal.id], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  const rule = (...args: string[]) => cli('review', 'rule', 'T1-RR', ...args);
  /** `CardRunner.ruleFinding` on the stored run, with the fixture clock. */
  const ruleByRunner = (id: string, ruling: { decision: 'rejected' | 'deferred'; by: string; reason: string }) => runner.ruleFinding(g(), card, id, ruling);
  return { runner, goal, card, g, persisted, runFile, bytes, stored, events, ruled, cli, rule, ruleByRunner };
}

test('acceptance 1, 2, 3 and 5: review rule records a ruling and a FINDING_RULED event on a finding of the stopping R3 decision, refuses every other case without a write, and leaves the stop as it was [R1] [R2] [R3] [R5] [R6]', async () => {
  const fx = makeFixture({ config: { gateRequired: true, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const { runFile, bytes, stored, events, cli, rule, ruleByRunner } = await stopped(fx);
    const stopOf = () => {
      const next = cli('card', 'next', 'T1-RR');
      assert.equal(next.status, 0, next.stderr);
      return (JSON.parse(next.stdout) as Stored)['directive'];
    };
    const stopBefore = stopOf();
    assert.deepEqual([stopBefore.kind, stopBefore.stop.reason], ['stop', 'review']);
    const was = stored();
    const eventsBefore = events().length;

    // Acceptance 1 and 2, through the CLI: --defer --issue 12 on the second finding, its id in lower case.
    const deferred = rule('f2', '--defer', '--issue', '12', ...OWNER);
    assert.equal(deferred.status, 0, deferred.stderr);
    const f2 = finding(stored(), 'F2');
    assert.match(f2['ruling'].at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.deepEqual(f2['ruling'], { at: f2['ruling'].at, by: 'the owner', decision: 'deferred', reason: 'the row is tests/t1-rr.test.ts:9', issue: 12 });
    assert.equal(f2['revision'], finding(was, 'F2')['revision'] + 1);
    assert.equal(events().length, eventsBefore + 1, 'one more journal event');
    const ruledF2 = events().at(-1)!;
    // The event carries the key of its owed entry (`eventKey`, card T0-JOURNAL-FAULT-EVENTS) beside the finding id and the ruling.
    assert.equal(typeof ruledF2['data'].eventKey, 'string');
    assert.deepEqual([ruledF2['type'], ruledF2['cardId'], ruledF2['data']], ['FINDING_RULED', 'T1-RR', { finding: 'F2', ruling: f2['ruling'], eventKey: ruledF2['data'].eventKey }]);

    // Acceptance 3: each row is refused with its condition named, and the card-run file and the journal keep their bytes.
    const rows: Array<[name: string, args: string[], names: RegExp, seed?: (run: Stored) => void]> = [
      ['neither flag', ['F1', ...OWNER], /exactly one of --reject and --defer/],
      ['both flags', ['F1', '--reject', '--defer', ...OWNER], /exactly one of --reject and --defer/],
      ['blank --by', ['F1', '--reject', '--by', ' ', '--reason', 'why'], /--by is blank/],
      ['blank --reason', ['F1', '--reject', '--by', 'the owner', '--reason', ' '], /--reason is blank/],
      ['--issue with --reject', ['F1', '--reject', '--issue', '12', ...OWNER], /--issue is given only with --defer/],
      ['--issue 0', ['F1', '--defer', '--issue', '0', ...OWNER], /--issue is digits only, above 0/],
      ['--issue 1.5', ['F1', '--defer', '--issue', '1.5', ...OWNER], /--issue is digits only, above 0/],
      ['an unknown finding id', ['F9', '--reject', ...OWNER], /no finding F9/],
      ['a finding already ruled', ['F2', '--reject', ...OWNER], /F2 is already ruled/],
      ['a resolved finding', ['F1', '--reject', ...OWNER], /F1 is resolved/, (run) => { finding(run, 'F1')['resolvedAt'] = '2026-09-11T00:30:00.000Z'; }],
      ['an advisory finding', ['F1', '--reject', ...OWNER], /F1 is advisory/, (run) => { finding(run, 'F1')['advisory'] = true; }],
      ['a finding of an earlier decision, not re-raised', ['F3', '--reject', ...OWNER], /F3 is not a finding the stopping decision raised or re-raised/],
      ['a run in REVIEW_FIX', ['F1', '--reject', ...OWNER], /is in REVIEW_FIX, not stopped for review/, (run) => { run['state'] = 'REVIEW_FIX'; delete run['stop']; }],
      ['a run stopped for time', ['F1', '--reject', ...OWNER], /is stopped for time, not stopped for review/, (run) => { run['stop'].reason = 'time'; }],
      ['a run without a stopping decision', ['F1', '--reject', ...OWNER], /no R3 decision of the run carries stopReview/, (run) => { for (const i of run['review'].invocations) delete i.stopReview; }],
      ['a candidate digest that differs', ['F1', '--reject', ...OWNER], /candidate digest sha-3 is not that of the stopping decision/, (run) => { run['candidate'].digest = 'sha-3'; }],
    ];
    const original = readFileSync(runFile, 'utf8');
    for (const [name, args, names, seed] of rows) {
      if (seed) {
        const run = stored();
        seed(run);
        writeFileSync(runFile, JSON.stringify(run, null, 2), 'utf8');
      }
      const held = bytes();
      const refused = rule(...args);
      assert.equal(refused.status, 1, `${name}: exits 1: ${refused.stderr}`);
      assert.match(refused.stderr, names, name);
      assert.deepEqual(bytes(), held, `${name}: the card-run file and the journal are byte-identical`);
      writeFileSync(runFile, original, 'utf8');
    }

    // Acceptance 1 and 2, through CardRunner with the fixture's fixed clock: a rejection of the first finding.
    fx.advance(3_600_000);
    ruleByRunner('f1', { decision: 'rejected', by: 'the owner', reason: 'the RED is tests/t1-rr.test.ts:3' });
    const now = stored();
    assert.deepEqual(finding(now, 'F1')['ruling'], { at: '2026-09-11T01:00:00.000Z', by: 'the owner', decision: 'rejected', reason: 'the RED is tests/t1-rr.test.ts:3' });
    assert.equal(events().length, eventsBefore + 2, 'one more journal event');
    const ruledF1 = events().at(-1)!;
    assert.deepEqual([ruledF1['type'], ruledF1['cardId'], ruledF1['data']], ['FINDING_RULED', 'T1-RR', { finding: 'F1', ruling: finding(now, 'F1')['ruling'], eventKey: ruledF1['data'].eventKey }]);

    // Acceptance 5, with nothing substituted (R3 decision 1 of T1-REVIEW-RULE, F4). The store's own fields of every write: the run's revision
    // rises by one per ruling and updatedAt is a later write time. The owed entry of the latest ruling is the delivered event.
    assert.equal(now['revision'], was['revision'] + 2);
    assert.match(now['updatedAt'], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.ok(now['updatedAt'] > was['updatedAt'], `${now['updatedAt']} is after ${was['updatedAt']}`);
    assert.deepEqual(now['journalOwed'], [{ key: ruledF1['data'].eventKey, type: 'FINDING_RULED', generation: ruledF1['generation'], data: ruledF1['data'] }]);
    // Every other field of the run is equal, and every field of the ruled findings but `ruling` and `revision` (one higher).
    const rest = ({ revision: _r, updatedAt: _u, journalOwed: _o, findings: _f, ...other }: Stored): Stored => other;
    assert.deepEqual(rest(now), rest(was));
    for (const id of ['F1', 'F2']) {
      const { ruling, revision, ...same } = finding(now, id);
      const { revision: revisionWas, ...sameWas } = finding(was, id);
      assert.ok(ruling, `${id} is ruled`);
      assert.deepEqual([revision, same], [revisionWas + 1, sameWas]);
    }
    assert.deepEqual(finding(now, 'F3'), finding(was, 'F3'));
    // Decision 2 re-raised the disputed F1 and F2, which reopened them; F3 keeps the dispute recorded while it ran.
    assert.deepEqual([now['state'], now['stop'].reason, ...now['findings'].map((f: Stored) => f['disposition'])], ['STOP', 'review', 'open', 'open', 'disputed']);
    assert.deepEqual(stopOf(), stopBefore, 'card next returns the same stop');
  } finally {
    fx.cleanup();
  }
});

test('acceptance 1, 2 and 6: --reject through the CLI persists rejected; a failed card-run write rules and journals nothing; a failed FINDING_RULED append keeps the ruling and card next delivers the event once [R1] [R3] [R4]', async () => {
  const fx = makeFixture({ config: { gateRequired: true, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const { runner, card, g, persisted, bytes, stored, ruled, rule, ruleByRunner } = await stopped(fx);
    const by = { by: 'the owner', reason: 'the row is tests/t1-rr.test.ts:9' };

    // The card-run write fails: the command throws, nothing is ruled and nothing is journaled.
    const held = bytes();
    fault.record = true;
    try {
      assert.throws(() => ruleByRunner('F1', { decision: 'rejected', ...by }), /EIO: injected/);
    } finally {
      fault.record = false;
    }
    assert.deepEqual(bytes(), held, 'the card-run file and the journal are byte-identical');

    // R3 decision 1 of T1-REVIEW-RULE, F2: a successful --reject through the CLI persists `rejected`, and the event carries it.
    const revisionWas = finding(stored(), 'F1')['revision'];
    const rejected = rule('F1', '--reject', ...OWNER);
    assert.equal(rejected.status, 0, rejected.stderr);
    const f1 = finding(stored(), 'F1')['ruling'];
    assert.match(f1.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.equal(finding(stored(), 'F1')['revision'], revisionWas + 1);
    assert.deepEqual([f1.decision, f1.by, f1.reason, 'issue' in f1], ['rejected', 'the owner', 'the row is tests/t1-rr.test.ts:9', false]);
    assert.deepEqual(ruled().map(([cardId, data]) => [cardId, data.finding, data.ruling]), [['T1-RR', 'F1', f1]]);

    // The FINDING_RULED append fails after the write: the ruling stands and the event is owed, not journaled.
    fault.append = true;
    try {
      assert.throws(() => ruleByRunner('F2', { decision: 'deferred', ...by }), /EIO: injected/);
    } finally {
      fault.append = false;
    }
    const f2 = finding(stored(), 'F2')['ruling'];
    assert.deepEqual(f2, { at: fx.now(), decision: 'deferred', ...by });
    assert.equal(ruled().length, 1, 'no event for F2 yet');
    assert.deepEqual(stored()['journalOwed'].map((o: Stored) => [o['type'], o['data'].finding]), [['FINDING_RULED', 'F2']]);
    // A rerun is refused as already ruled and journals nothing; `card next` on the stopped run delivers the owed event, once.
    assert.throws(() => ruleByRunner('F2', { decision: 'deferred', ...by }), /F2 is already ruled/);
    assert.equal(ruled().length, 1);
    for (const pass of [1, 2]) {
      const next = runner.next(g(), card, persisted());
      assert.equal(next.directive.kind, 'stop', `card next ${pass} returns the stop`);
      assert.deepEqual(ruled().map(([cardId, data]) => [cardId, data.finding, data.ruling, data.completed]), [['T1-RR', 'F1', f1, undefined], ['T1-RR', 'F2', f2, true]], `after card next ${pass}: exactly one FINDING_RULED per ruling`);
    }
  } finally {
    fx.cleanup();
  }
});

test('acceptance 4: the stopping decision is the latest invocation that carries stopReview, not the first one that does and not the last invocation [R2]', () => {
  // R3 decision 1 of T1-REVIEW-RULE, F3. Three invocations on three candidates, each with its own finding: stops on sha-a and on sha-b, then a
  // later invocation on sha-c without stopReview. The right source is sha-b: only F2 can be ruled, and only on candidate d-b.
  const invocation = (n: string, stopReview?: string) => ({ invocationId: `i-${n}`, candidateDigest: `d-${n}`, candidateSha: `sha-${n}`, base: 'main', policyVersion: 'REVIEW.md@5', reviewer: 'fake-r3', requestedAt: '2026-09-11T00:00:00.000Z', outcome: 'block', ...(stopReview ? { stopReview } : {}) });
  const raised = (id: string, n: string) => ({ id, stage: 'formal', round: 1, reason: `[spec] 6 tests @ ${FILE}:1: ${id}`, candidateSha: `sha-${n}`, raisedAt: '2026-09-11T00:00:00.000Z', disposition: 'open', disputes: [], reraised: [], revision: 0 });
  const run = (digest: string) => ({ state: 'STOP', stop: { reason: 'review' }, candidate: { digest }, review: { invocations: [invocation('a', 'first stop'), invocation('b', 'second stop'), invocation('c')] }, findings: [raised('F1', 'a'), raised('F2', 'b'), raised('F3', 'c')] }) as unknown as Parameters<typeof ruleFinding>[0];
  const ruling = { at: '2026-09-11T01:00:00.000Z', by: 'the owner', decision: 'rejected' as const, reason: 'it does not hold' };
  assert.deepEqual(ruleFinding(run('d-b'), 'F2', ruling).map((f) => [f.id, f.ruling?.decision, f.revision]), [['F1', undefined, 0], ['F2', 'rejected', 1], ['F3', undefined, 0]]);
  for (const id of ['F1', 'F3']) assert.throws(() => ruleFinding(run('d-b'), id, ruling), new RegExp(`${id} is not a finding the stopping decision raised or re-raised`));
  assert.throws(() => ruleFinding(run('d-a'), 'F1', ruling), /candidate digest d-a is not that of the stopping decision \(d-b\)/);
  assert.throws(() => ruleFinding(run('d-c'), 'F3', ruling), /candidate digest d-c is not that of the stopping decision \(d-b\)/);
});
