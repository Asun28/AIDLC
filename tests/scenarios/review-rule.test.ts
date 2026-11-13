// Card T1-REVIEW-RULE: `aidlc review rule` records the owner's ruling on a finding of the R3 decision that stopped a card.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, goalForCards } from './_harness.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
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

test('acceptance 1 to 4: review rule records a ruling and a FINDING_RULED event on a finding of the stopping R3 decision, refuses every other case without a write, and leaves the stop as it was [R1] [R2] [R3] [R4] [R5]', async () => {
  const fx = makeFixture({ config: { gateRequired: true, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
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
    const finding = (run: Stored, id: string): Stored => run['findings'].find((f: Stored) => f['id'] === id);
    // No session variable of the calling environment reaches the CLI: CI sets none.
    const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: fx.paths.root };
    delete env['CLAUDE_CODE_SESSION_ID'];
    delete env['AIDLC_SESSION'];
    const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, ...args, '--goal', goal.id], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
    const rule = (...args: string[]) => cli('review', 'rule', 'T1-RR', ...args);
    const stopOf = () => {
      const next = cli('card', 'next', 'T1-RR');
      assert.equal(next.status, 0, next.stderr);
      return (JSON.parse(next.stdout) as Stored)['directive'];
    };
    const stopBefore = stopOf();
    assert.deepEqual([stopBefore.kind, stopBefore.stop.reason], ['stop', 'review']);
    const before = stored();
    const eventsBefore = events().length;

    // Acceptance 1 and 2, through the CLI: --defer --issue 12 on the second finding, its id in lower case.
    const deferred = rule('f2', '--defer', '--issue', '12', ...OWNER);
    assert.equal(deferred.status, 0, deferred.stderr);
    const f2 = finding(stored(), 'F2');
    assert.match(f2['ruling'].at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.deepEqual(f2['ruling'], { at: f2['ruling'].at, by: 'the owner', decision: 'deferred', reason: 'the row is tests/t1-rr.test.ts:9', issue: 12 });
    assert.equal(f2['revision'], finding(before, 'F2')['revision'] + 1);
    assert.equal(events().length, eventsBefore + 1, 'one more journal event');
    const ruledF2 = events().at(-1)!;
    assert.deepEqual([ruledF2['type'], ruledF2['cardId'], ruledF2['data']], ['FINDING_RULED', 'T1-RR', { finding: 'F2', ruling: f2['ruling'] }]);

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
    (runner as unknown as { ruleFinding: (goal: unknown, card: unknown, id: string, ruling: Stored) => unknown }).ruleFinding(g(), card, 'f1', { decision: 'rejected', by: 'the owner', reason: 'the RED is tests/t1-rr.test.ts:3' });
    const after = stored();
    assert.deepEqual(finding(after, 'F1')['ruling'], { at: '2026-09-11T01:00:00.000Z', by: 'the owner', decision: 'rejected', reason: 'the RED is tests/t1-rr.test.ts:3' });
    assert.equal(finding(after, 'F1')['revision'], finding(before, 'F1')['revision'] + 1);
    assert.equal(events().length, eventsBefore + 2, 'one more journal event');
    const ruledF1 = events().at(-1)!;
    assert.deepEqual([ruledF1['type'], ruledF1['cardId'], ruledF1['data']], ['FINDING_RULED', 'T1-RR', { finding: 'F1', ruling: finding(after, 'F1')['ruling'] }]);

    // Acceptance 4: apart from the two rulings and the store's own revision and updatedAt of every write, the run is the run before.
    for (const id of ['F1', 'F2']) {
      delete finding(after, id)['ruling'];
      finding(after, id)['revision'] -= 1;
    }
    assert.deepEqual({ ...after, revision: before['revision'], updatedAt: before['updatedAt'] }, before);
    // Decision 2 re-raised the disputed F1 and F2, which reopened them; F3 keeps the dispute recorded while it ran.
    assert.deepEqual([after['state'], after['stop'].reason, ...after['findings'].map((f: Stored) => f['disposition'])], ['STOP', 'review', 'open', 'open', 'disputed']);
    assert.deepEqual(stopOf(), stopBefore, 'card next returns the same stop');
  } finally {
    fx.cleanup();
  }
});
