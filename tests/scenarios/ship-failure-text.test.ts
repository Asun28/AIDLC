// Card T0-SHIP-FAILURE-TEXT (issue 489): a ship that stops STOP/tool on a failure sentinel keeps the sentinel line's text,
// capped and encoded, in the stop detail, so a later session can read why GitHub refused the merge.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyShipOutput, DryRunShipPath, type ShipPath, type ShipRequest, type ShipResult } from '../../src/delivery/ship.ts';
import type { ExecReceipt } from '../../src/probes/exec.ts';
import type { CardRun } from '../../src/core/types.ts';
import { candidateShaFor, goalForCards, makeFixture, writeCard } from './_harness.ts';

const receipt = (stdout: string, exitCode: number | null = 1, timedOut = false): ExecReceipt => ({ command: 'ship', args: [], cwd: '', exitCode, signal: null, timedOut, stdout, stderr: '', startedAt: '2026-09-11T00:00:00.000Z', finishedAt: '2026-09-11T00:00:00.000Z', durationMs: 1, outputSha256: '' });
const classify = (lines: string[], exitCode: number | null = 1) => classifyShipOutput(receipt(lines.join('\n'), exitCode));

/** The refused-merge line GitHubShipPath prints (src/delivery/github-ship.ts, `${named}: ${merge.stderr}`). */
const REFUSED = '[SHIP-MERGE-FAIL] PR #7 mergeable MERGEABLE (mergeStateStatus BLOCKED): X Pull request #7 is not mergeable: the base branch policy prohibits the merge';
const REFUSED_TEXT = '%5BSHIP-MERGE-FAIL%5D PR #7 mergeable MERGEABLE (mergeStateStatus BLOCKED): X Pull request #7 is not mergeable: the base branch policy prohibits the merge';

test('classifyShipOutput keeps the matched sentinel line as failureText, brackets encoded [R1]', () => {
  const rows: Array<[string, string]> = [
    [REFUSED, REFUSED_TEXT],
    ['[SHIP-MERGE-FAIL] PR #7 mergeable UNKNOWN (mergeStateStatus UNKNOWN) after 5 reads; main merges cleanly into HEAD abc after a fresh fetch: gh: refused', '%5BSHIP-MERGE-FAIL%5D PR #7 mergeable UNKNOWN (mergeStateStatus UNKNOWN) after 5 reads; main merges cleanly into HEAD abc after a fresh fetch: gh: refused'],
    ['[SHIP-MERGE-FAIL] PR #7 state OPEN after merge', '%5BSHIP-MERGE-FAIL%5D PR #7 state OPEN after merge'],
    ['[SHIP-PUSH-FAIL] ! [rejected] main -> main (fetch first)', '%5BSHIP-PUSH-FAIL%5D ! %5Brejected%5D main -> main (fetch first)'],
    ['[SHIP-PR-NUMBER-FAIL] GraphQL: a pull request already exists', '%5BSHIP-PR-NUMBER-FAIL%5D GraphQL: a pull request already exists'],
  ];
  for (const [line, text] of rows) {
    const r = classify(['ship: start', line, '[SAGA-FAIL]', '[SAGA-RESUME] aidlc card next T1-X']);
    assert.equal(r.failureText, text, line);
  }
});

test('failureText: already encoded text is unchanged, raw brackets and percent signs are encoded [R1]', () => {
  assert.equal(classify(['[SHIP-MERGE-FAIL] PR #7 %5Bx%5D 100%25 done']).failureText, '%5BSHIP-MERGE-FAIL%5D PR #7 %5Bx%5D 100%25 done');
  assert.equal(classify(['[SHIP-MERGE-FAIL] [SAGA-RESUME] x 100%']).failureText, '%5BSHIP-MERGE-FAIL%5D %5BSAGA-RESUME%5D x 100%25');
  const encoded = classify(['[SHIP-MERGE-FAIL] [SAGA-RESUME] x 100%']).failureText!;
  assert.ok(!/[[\]]/.test(encoded), encoded);
});

test('failureText: control sequences are removed and controls become spaces; the cut is 500 code points [R1]', () => {
  assert.equal(classify(['[SHIP-PUSH-FAIL] \u001b[31mrejected\u001b[0m\tby remote']).failureText, '%5BSHIP-PUSH-FAIL%5D rejected by remote');
  const long = classify([`[SHIP-PUSH-FAIL] ${'\u{1F600}'.repeat(1000)}`]).failureText!;
  assert.equal(long, `%5BSHIP-PUSH-FAIL%5D ${'\u{1F600}'.repeat(483)}`);
  assert.equal([...long.replace('%5BSHIP-PUSH-FAIL%5D ', '[SHIP-PUSH-FAIL] ')].length, 500);
  assert.ok(!/[\uD800-\uDBFF]$/.test(long), 'no split surrogate pair');
  // An escape at the 500th code point is decoded before the cut and encoded whole (R3 decision 1 F1).
  const head = '[SHIP-MERGE-FAIL] ';
  for (const [escape, kept] of [['%5B', '%5B'], ['%5D', '%5D'], ['%25', '%25']] as const) {
    const at499 = `${head}${'a'.repeat(499 - head.length)}`;
    assert.equal(classify([`${at499}${escape}tail`]).failureText, `%5BSHIP-MERGE-FAIL%5D ${'a'.repeat(499 - head.length)}${kept}`, `${escape} as the 500th code point`);
    assert.equal(classify([`${at499}a${escape}tail`]).failureText, `%5BSHIP-MERGE-FAIL%5D ${'a'.repeat(500 - head.length)}`, `${escape} past the cut`);
  }
});

test('the other fields of a result are those of main; outcomes with no sentinel rule carry no failureText [R1]', () => {
  const refused = classify([REFUSED, '[SAGA-FAIL]', '[SAGA-RESUME] aidlc card next T1-X']);
  assert.deepEqual({ outcome: refused.outcome, detail: refused.detail, sentinels: refused.sentinels, resumeCommand: refused.resumeCommand, prNumber: refused.prNumber }, { outcome: 'merge-failed', detail: 'sentinel \\[SHIP-MERGE-FAIL\\]', sentinels: ['[SHIP-MERGE-FAIL]', '[SAGA-FAIL]', '[SAGA-RESUME]'], resumeCommand: 'aidlc card next T1-X', prNumber: 7 });
  const synced = classify(['[SHIP-BASE-SYNC-MERGED] base sync: CHANGELOG.md resolved; merge abc', '[SAGA-FAIL]']);
  assert.deepEqual({ outcome: synced.outcome, detail: synced.detail, sentinels: synced.sentinels, resumeCommand: synced.resumeCommand, prNumber: synced.prNumber }, { outcome: 'merge-failed', detail: 'sentinel \\[SHIP-BASE-SYNC-MERGED\\]', sentinels: ['[SHIP-BASE-SYNC-MERGED]', '[SAGA-FAIL]'], resumeCommand: undefined, prNumber: undefined });
  assert.equal(classify(['nothing known here']).outcome, 'unclassified');
  assert.equal(classify(['nothing known here']).failureText, undefined);
  assert.equal(classify(['[SAGA-DONE]'], 0).outcome, 'merged');
  assert.equal(classify(['[SAGA-DONE]'], 0).failureText, undefined);
  assert.equal(classify(['done'], 0).outcome, 'merge-unconfirmed');
  assert.equal(classify(['done'], 0).failureText, undefined);
  const unknown = classify(['[SHIP-EFFECT-UNKNOWN] gh pr merge timed out', REFUSED]);
  assert.equal(unknown.outcome, 'effect-unknown');
  assert.equal(unknown.failureText, undefined);
});

/** A ship whose result the real classifier reads from `lines`, as every real ship path's is. */
class TextShipPath extends DryRunShipPath {
  last: ShipResult | undefined;
  private readonly lines: (cardId: string) => string[];
  constructor(lines: (cardId: string) => string[]) {
    super(['merged']);
    this.lines = lines;
  }
  override ship(req: ShipRequest): ShipResult {
    const r = super.ship(req);
    this.last = classifyShipOutput({ ...r.receipt, exitCode: 1, stdout: this.lines(req.cardId).join('\n'), stderr: '' });
    return this.last;
  }
}

/** Build T1-FT and ship it through `ship`. */
function shipped(ship: ShipPath) {
  const fx = makeFixture();
  writeCard(fx, { id: 'T1-FT', title: 'failure text' });
  const goal = goalForCards(fx, ['T1-FT']);
  const runner = fx.runner(ship);
  const card = fx.card('T1-FT');
  const g = () => fx.goal(goal.id);
  let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-FT'));
  r = runner.next(g(), card, r.run);
  const run: CardRun = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-FT') });
  return { fx, goalId: goal.id, out: runner.next(g(), card, run), again: () => runner.next(g(), card, fx.store.getCardRun(goal.id, 'T1-FT')!) };
}

test('a refused merge stops STOP/tool with the failure text in the detail, the narration and the next action [R2] [R3]', () => {
  const s = shipped(new TextShipPath((id) => [REFUSED, '[SAGA-FAIL]', `[SAGA-RESUME] aidlc card next ${id}`]));
  try {
    assert.equal(s.out.directive.kind, 'stop', s.out.directive.narration);
    const stop = s.fx.store.getCardRun(s.goalId, 'T1-FT')!.stop!;
    assert.equal(stop.reason, 'tool');
    assert.equal(stop.detail, `unclassified ship outcome (exit 1): ${JSON.stringify('sentinel \\[SHIP-MERGE-FAIL\\]')}; failure text: ${JSON.stringify(REFUSED_TEXT)}; the ship path's resume marker, a diagnostic that does not lift this stop: ${JSON.stringify('aidlc card next T1-FT')}`);
    assert.equal(s.out.directive.narration, stop.detail, 'the card next narration is the stop detail');
    assert.equal(stop.nextAction, `read the ship failure text in this stop's detail; this stop is final for card T1-FT: fix the cause, register a replacement card that carries the candidate, then run \`aidlc goal resume ${s.goalId} --reason "..." --replace '{"T1-FT":"<replacement>"}'\``);
    const again = s.again();
    assert.equal(again.directive.kind, 'stop');
    assert.deepEqual(again.run.stop, stop, 'card next returns the same stop');
    // R3: the operation record and the journal event keep main's text.
    const ops = s.fx.ops.list({ cardId: 'T1-FT', kind: 'merge' });
    assert.equal(ops.length, 1, JSON.stringify(ops));
    assert.equal(ops[0]!.error, 'merge-failed: sentinel \\[SHIP-MERGE-FAIL\\]', "the operation error is main's");
    const results = s.fx.events(s.goalId).filter((e) => e.type === 'OPERATION_RESULT');
    assert.deepEqual(results.map((e) => e.data), [{ operationId: ops[0]!.id, status: 'failed', outcome: 'merge-failed' }]);
  } finally {
    s.fx.cleanup();
  }
});

test('an unclassified ship keeps main\'s stop text; a base-sync conflict still returns BUILD with its main narration [R2] [R3]', () => {
  const s = shipped(new TextShipPath(() => ['something broke', '[SAGA-FAIL]']));
  try {
    const stop = s.fx.store.getCardRun(s.goalId, 'T1-FT')!.stop!;
    assert.equal(stop.detail, `unclassified ship outcome (exit 1): ${JSON.stringify('exit 1 with no known sentinel; STOP/tool with diagnostics')}`);
    assert.equal(stop.nextAction, `inspect the ship output and the retained receipt; this stop is final for card T1-FT: fix the cause, register a replacement card that carries the candidate, then run \`aidlc goal resume ${s.goalId} --reason "..." --replace '{"T1-FT":"<replacement>"}'\``);
  } finally {
    s.fx.cleanup();
  }
  const c = shipped(new TextShipPath(() => ['[SHIP-BASE-SYNC-CONFLICT] base sync: origin/main conflicts with HEAD abc', 'CONFLICT (content): Merge conflict in src/a.ts', '[SAGA-FAIL]']));
  try {
    assert.equal(c.out.directive.kind, 'build', c.out.directive.narration);
    if (c.out.directive.kind === 'build') assert.ok(c.out.directive.skills?.includes('merge-conflicts'));
    assert.equal(c.out.directive.narration, `Merge conflict on the base sync (${JSON.stringify('sentinel \\[SHIP-BASE-SYNC-CONFLICT\\]')}): resolve every hunk by intent with the merge-conflicts skill (merge only, never rebase), rerun the DoD and record the attempt. The merge commit is a new candidate: it costs an R2 round and, once R3 has decided, the second R3 decision.`);
    assert.equal(c.fx.store.getCardRun(c.goalId, 'T1-FT')!.pendingRepair?.detail, 'merge conflict on the base sync (sentinel \\[SHIP-BASE-SYNC-CONFLICT\\])');
  } finally {
    c.fx.cleanup();
  }
});
