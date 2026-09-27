import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, type Fixture } from './_harness.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { classifyShipOutput, type ShipPath, type ShipRequest, type ShipResult } from '../../src/delivery/ship.ts';
import { scriptedRunner, type ExecReceipt, type SyncRunner } from '../../src/probes/exec.ts';

// Card T0-EXIT-ZERO-NOT-MERGED (issue 76 item 3): an exit-0 ship without its adapter's merge contract is merge-unconfirmed,
// which the card machine reconciles: gh's PR view when gh answers, else the merge token.

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const MERGE_SHA = 'c'.repeat(40);
const AT = '2026-09-11T00:00:00.000Z';
/** What a claude-devops-scaffold success prints: a sentence and no sentinel. */
const SCAFFOLD_SUCCESS = 'PR #42 已 squash 合并（远端分支由仓库设置自动删；已铸 T24-MERGETOKEN 合并凭据）。';

type Token = { tip?: string; mergedPr?: number };

/** A ship path whose command exits 0 with `text`, classified by the real classifier, with a scripted merge token. */
class ExitZero implements ShipPath {
  readonly name = 'exit-zero';
  readonly requests: ShipRequest[] = [];
  private readonly text: string;
  private readonly token: Token | undefined;
  private readonly during: (() => void) | undefined;
  constructor(text: string, token?: Token, during?: () => void) {
    this.text = text;
    this.token = token;
    this.during = during;
  }
  ship(req: ShipRequest): ShipResult {
    this.requests.push(req);
    this.during?.();
    const receipt: ExecReceipt = { command: 'ship', args: [req.cardId], cwd: '', exitCode: 0, signal: null, timedOut: false, stdout: this.text, stderr: '', startedAt: AT, finishedAt: AT, durationMs: 0, outputSha256: '' };
    return classifyShipOutput(receipt);
  }
  readVerdict(): { raw?: string } {
    return {};
  }
  readMergeToken(): Token | undefined {
    return this.token;
  }
}

/** gh answers PR #42 in `state` at `head`; a MERGED view carries a merge commit whose tree git reads. */
const ghView = (state: 'OPEN' | 'MERGED' | 'CLOSED', head: string): SyncRunner =>
  scriptedRunner({
    'gh pr view 42 --repo o/r --json': { stdout: JSON.stringify({ number: 42, state, headRefOid: head, mergeCommit: state === 'MERGED' ? { oid: MERGE_SHA } : null }) },
    'git fetch': {},
    [`git rev-parse ${MERGE_SHA}^{tree}`]: { stdout: `${'d'.repeat(40)}\n` },
  });
/** gh does not answer: every call fails. */
const ghFails: SyncRunner = scriptedRunner({ 'gh pr view': { exitCode: 1, stderr: 'HTTP 502' } });

/** Build T1-SHIP to a success on HEAD, then ship it through `shipOf(goalId)` on a runner with `options`. */
function shipped(fx: Fixture, shipOf: (goalId: string) => ShipPath, options: { repository?: string; exec?: SyncRunner; shipPath?: 'github' | 'dry-run' } = {}) {
  writeCard(fx, { id: 'T1-SHIP', title: 'ship' });
  const goal = goalForCards(fx, ['T1-SHIP']);
  const card = fx.card('T1-SHIP');
  const dry = fx.runner();
  let r = dry.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-SHIP'));
  r = dry.next(fx.goal(goal.id), card, r.run);
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  const built = dry.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: HEAD });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, shipPath: options.shipPath ?? 'github', repository: options.repository }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: shipOf(goal.id), now: fx.now, runner: options.exec ?? scriptedRunner({}) });
  const out = runner.next(fx.goal(goal.id), card, built);
  const ops = fx.ops.list({ goalId: goal.id, cardId: 'T1-SHIP', kind: 'merge' });
  assert.equal(ops.length, 1, 'one merge operation');
  return { goalId: goal.id, out, op: ops[0]!, stored: fx.store.getCardRun(goal.id, 'T1-SHIP')! };
}

/** The card stopped as `tool` on a definite non-merge of PR #42 in `state` at `head`, with the operation failed. */
function assertNotMerged(s: ReturnType<typeof shipped>, state: string, head: string): void {
  assert.equal(s.out.directive.kind, 'stop', s.out.directive.narration);
  assert.equal(s.stored.state, 'STOP');
  assert.equal(s.stored.stop?.reason, 'tool');
  for (const part of ['PR #42', state, head, HEAD]) assert.ok(s.stored.stop?.detail.includes(part), `the detail names ${part}: ${s.stored.stop?.detail}`);
  assert.ok(s.stored.stop?.nextAction.includes('merge PR #42 by hand'), s.stored.stop?.nextAction);
  assert.ok(s.stored.stop?.nextAction.includes('aidlc goal resume'), s.stored.stop?.nextAction);
  assert.equal(s.op.status, 'failed');
  assert.equal(s.stored.mergeVerified, false);
  assert.notEqual(s.stored.pr?.state, 'MERGED', 'no PR is recorded as merged');
}

/** The card waits on merge-verify with the operation UNKNOWN and no PR recorded as merged. */
function assertUnknown(s: ReturnType<typeof shipped>): void {
  assert.equal(s.out.directive.kind, 'wait', s.out.directive.narration);
  if (s.out.directive.kind === 'wait') assert.equal(s.out.directive.on, `merge-verify:${s.op.id}`);
  assert.equal(s.op.status, 'UNKNOWN');
  assert.equal(s.stored.mergeVerified, false);
  assert.notEqual(s.stored.pr?.state, 'MERGED', 'no PR is recorded as merged before the merge is verified');
}

test('T0-EXIT-ZERO-NOT-MERGED acceptance 3: a scaffold success whose PR gh reads as MERGED at the candidate closes the card [R2]', () => {
  const fx = makeFixture();
  try {
    const s = shipped(fx, () => new ExitZero(SCAFFOLD_SUCCESS), { repository: 'o/r', exec: ghView('MERGED', HEAD) });
    assert.equal(s.out.directive.kind, 'close', s.out.directive.narration);
    assert.equal(s.op.status, 'succeeded');
    assert.equal(s.stored.mergeVerified, true);
  } finally {
    fx.cleanup();
  }
});

for (const [state, head, why] of [['OPEN', HEAD, 'open at the candidate'], ['CLOSED', HEAD, 'closed unmerged'], ['MERGED', OTHER, 'merged at another head']] as const) {
  test(`T0-EXIT-ZERO-NOT-MERGED acceptance 3: a ship that exits 0 without its merge contract while gh reads its PR ${why} stops the card as tool with the operation failed [R2]`, () => {
    const fx = makeFixture();
    try {
      assertNotMerged(shipped(fx, () => new ExitZero(SCAFFOLD_SUCCESS), { repository: 'o/r', exec: ghView(state, head) }), state, head);
    } finally {
      fx.cleanup();
    }
  });
}

test('T0-EXIT-ZERO-NOT-MERGED acceptance 3: gh answering wins over the merge token: a token at the candidate with the PR OPEN stops, a stale token with the PR MERGED at the candidate closes [R2]', () => {
  const fx = makeFixture();
  try {
    assertNotMerged(shipped(fx, () => new ExitZero(SCAFFOLD_SUCCESS, { tip: HEAD, mergedPr: 42 }), { repository: 'o/r', exec: ghView('OPEN', HEAD) }), 'OPEN', HEAD);
  } finally {
    fx.cleanup();
  }
  const fy = makeFixture();
  try {
    const s = shipped(fy, () => new ExitZero('all good', { tip: OTHER, mergedPr: 42 }), { repository: 'o/r', exec: ghView('MERGED', HEAD) });
    assert.equal(s.out.directive.kind, 'close', `the PR number comes from the token and gh decides: ${s.out.directive.narration}`);
    assert.equal(s.op.status, 'succeeded');
  } finally {
    fy.cleanup();
  }
});

test('T0-EXIT-ZERO-NOT-MERGED acceptance 4: when gh does not answer, a token at the candidate closes the card; a stale token or none leaves the operation UNKNOWN and the card waiting [R2]', () => {
  const cases: Array<[string, Token | undefined, { repository?: string; exec?: SyncRunner }, 'close' | 'unknown']> = [
    ['token at the candidate, gh fails', { tip: HEAD, mergedPr: 42 }, { repository: 'o/r', exec: ghFails }, 'close'],
    ['token at the candidate, no repository', { tip: HEAD }, {}, 'close'],
    ['stale token, gh fails', { tip: OTHER, mergedPr: 42 }, { repository: 'o/r', exec: ghFails }, 'unknown'],
    ['stale token, no repository', { tip: OTHER }, {}, 'unknown'],
    ['no token, gh fails', undefined, { repository: 'o/r', exec: ghFails }, 'unknown'],
    ['no token, no repository', undefined, {}, 'unknown'],
  ];
  for (const [label, token, options, expected] of cases) {
    const fx = makeFixture();
    try {
      const s = shipped(fx, () => new ExitZero(SCAFFOLD_SUCCESS, token), options);
      if (expected === 'close') {
        assert.equal(s.out.directive.kind, 'close', `${label}: ${s.out.directive.narration}`);
        assert.equal(s.op.status, 'succeeded', label);
      } else assertUnknown(s);
    } finally {
      fx.cleanup();
    }
  }
});

test('T0-EXIT-ZERO-NOT-MERGED acceptance 4: the dry-run path does not verify a merge-unconfirmed ship [R2]', () => {
  const fx = makeFixture();
  try {
    assertUnknown(shipped(fx, () => new ExitZero('all good'), { shipPath: 'dry-run' }));
  } finally {
    fx.cleanup();
  }
});

test('T0-EXIT-ZERO-NOT-MERGED acceptance 4: a merge-unconfirmed ship whose candidate is replaced during the ship leaves its operation UNKNOWN, never failed [R2]', () => {
  const fx = makeFixture();
  try {
    const s = shipped(fx, (goalId) => new ExitZero('all good', undefined, () => fx.store.updateCardRun(goalId, 'T1-SHIP', (current) => ({ ...current!, candidate: { ...current!.candidate!, digest: 'replaced-during-the-ship' } }))), { repository: 'o/r', exec: ghFails });
    assert.equal(s.out.directive.kind, 'wait', s.out.directive.narration);
    if (s.out.directive.kind === 'wait') assert.equal(s.out.directive.on, 'candidate-changed');
    assert.equal(s.op.status, 'UNKNOWN', 'the merge of the shipped candidate is an unresolved operation to reconcile');
  } finally {
    fx.cleanup();
  }
});

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

/** The sentences this card adds to docs/OPERATIONS.md. */
const OPERATIONS_SENTENCES = [
  "A ship is `merged` only on its adapter's merge contract, the `[SAGA-DONE]` sentinel without `[SAGA-FAIL]` (card T0-EXIT-ZERO-NOT-MERGED): an exit 0 without it is `merge-unconfirmed`, never a merge read from the words of the output, and a scaffold success, which prints no sentinel, is one.",
  'The card machine reconciles a `merge-unconfirmed` ship from the PR the ship reported or its merge token names: when gh answers, a PR MERGED at the candidate closes the card, and a PR OPEN, CLOSED or MERGED at another head stops it as `tool` with the operation failed (merge the PR by hand, then register a replacement card and resume the goal).',
  'Only when gh does not answer does the merge token decide: a tip at the candidate closes the card, and a stale tip or no token leaves the operation `UNKNOWN` while the card waits on `merge-verify` until the reconciliation grace ends.',
];
/** The phrase this card adds to docs/ARCHITECTURE.md (the outcome to state map). */
const ARCHITECTURE_PHRASE = "merge-unconfirmed -> CLOSE, STOP/tool or WAIT (gh's PR view first, then the merge token; card T0-EXIT-ZERO-NOT-MERGED)";
/** The CHANGELOG entry, one line under Unreleased. */
const CHANGELOG_ENTRY =
  '- Exit 0 is not a merge, card T0-EXIT-ZERO-NOT-MERGED (issue 76 item 3): `classifyShipOutput` classifies an exit-0 ship as `merged` only on the `[SAGA-DONE]` sentinel without `[SAGA-FAIL]`, where it used to accept `MERGED`, 合并 or `merged_pr=` in the text, no sentinel, or no `[SAGA-FAIL]`; any other exit 0 is the new outcome `merge-unconfirmed`, which the card machine reconciles from gh\'s PR view, then the merge token: a merge at the candidate closes the card, a PR gh reads as not merged at the candidate stops it as `tool`, and one gh cannot answer waits with the operation `UNKNOWN`. A scaffold success, which prints no sentinel, now takes that path, and `DryRunShipPath` prints `[SAGA-DONE]` on `merged`.';

test('T0-EXIT-ZERO-NOT-MERGED acceptance 5: docs/OPERATIONS.md, docs/ARCHITECTURE.md and CHANGELOG.md Unreleased state the rule [R4]', () => {
  const operations = read('docs', 'OPERATIONS.md');
  for (const sentence of OPERATIONS_SENTENCES) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
  assert.ok(read('docs', 'ARCHITECTURE.md').includes(ARCHITECTURE_PHRASE), `docs/ARCHITECTURE.md states: ${ARCHITECTURE_PHRASE}`);
  const changelog = read('CHANGELOG.md');
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  assert.ok(unreleased.split('\n').includes(CHANGELOG_ENTRY), 'CHANGELOG.md Unreleased carries the entry');
});
