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
/** gh answers PR 42 with `json` as it is, whatever its shape. */
const ghRaw = (json: unknown): SyncRunner =>
  scriptedRunner({ 'gh pr view 42 --repo o/r --json': { stdout: JSON.stringify(json) }, 'git fetch': {}, [`git rev-parse ${MERGE_SHA}^{tree}`]: { stdout: `${'d'.repeat(40)}\n` } });
/** gh does not answer: every call fails. */
const ghFails: SyncRunner = scriptedRunner({ 'gh pr view': { exitCode: 1, stderr: 'HTTP 502' } });

/** Build T1-SHIP to a success on HEAD, then ship it through `shipOf(goalId)` on a runner with `options`. */
function shipped(fx: Fixture, shipOf: (goalId: string) => ShipPath, options: { repository?: string; exec?: SyncRunner; shipPath?: 'github' | 'dry-run'; candidateSha?: string | null } = {}) {
  writeCard(fx, { id: 'T1-SHIP', title: 'ship' });
  const goal = goalForCards(fx, ['T1-SHIP']);
  const card = fx.card('T1-SHIP');
  const dry = fx.runner();
  let r = dry.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-SHIP'));
  r = dry.next(fx.goal(goal.id), card, r.run);
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  const sha = options.candidateSha === null ? undefined : (options.candidateSha ?? HEAD);
  const built = dry.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: sha });
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

test('T0-EXIT-ZERO-NOT-MERGED-3 acceptance 3: a token at the candidate is the scaffold merge contract and closes whatever gh answers (the local merge, the PR OPEN); over a stale token gh decides [R2]', () => {
  const fx = makeFixture();
  try {
    const s = shipped(fx, () => new ExitZero(SCAFFOLD_SUCCESS, { tip: HEAD }), { repository: 'o/r', exec: ghView('OPEN', HEAD) });
    assert.equal(s.out.directive.kind, 'close', `the scaffold local merge closes: ${s.out.directive.narration}`);
    assert.equal(s.op.status, 'succeeded');
  } finally {
    fx.cleanup();
  }
  const fy = makeFixture();
  try {
    const s = shipped(fy, () => new ExitZero('all good', { tip: OTHER, mergedPr: 42 }), { repository: 'o/r', exec: ghView('MERGED', HEAD) });
    assert.equal(s.out.directive.kind, 'close', `the PR number comes from the token and gh decides: ${s.out.directive.narration}`);
    assert.equal(s.op.status, 'succeeded');
    assert.deepEqual([s.stored.pr?.number, s.stored.pr?.state, s.stored.pr?.headRefOid], [42, 'MERGED', HEAD], 'the recorded head is the candidate that passed verification, never the stale tip (R3 decision 1 F5)');
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

test('T0-EXIT-ZERO-NOT-MERGED acceptance 4: an unusable gh answer ({}, MERGED without a head, another PR, no number, an unknown state) counts as gh not answering: the token decides, else UNKNOWN (R3 decision 1 F3 and F4) [R2]', () => {
  const unusable: Array<[string, unknown]> = [
    ['{}', {}],
    ['MERGED without a head', { number: 42, state: 'MERGED' }],
    ['another PR MERGED at the candidate', { number: 99, state: 'MERGED', headRefOid: HEAD, mergeCommit: { oid: MERGE_SHA } }],
    ['no number', { state: 'MERGED', headRefOid: HEAD, mergeCommit: { oid: MERGE_SHA } }],
    ['an empty head', { number: 42, state: 'OPEN', headRefOid: '' }],
    ['an unknown state', { number: 42, state: 'DRAFT', headRefOid: HEAD }],
  ];
  for (const [label, json] of unusable) {
    const fx = makeFixture();
    try {
      const s = shipped(fx, () => new ExitZero(SCAFFOLD_SUCCESS), { repository: 'o/r', exec: ghRaw(json) });
      assertUnknown(s);
      assert.equal(s.stored.stop, undefined, `${label}: an unusable answer is no evidence of a non-merge`);
    } finally {
      fx.cleanup();
    }
    const fy = makeFixture();
    try {
      const s = shipped(fy, () => new ExitZero(SCAFFOLD_SUCCESS, { tip: HEAD, mergedPr: 42 }), { repository: 'o/r', exec: ghRaw(json) });
      assert.equal(s.out.directive.kind, 'close', `${label}: the token at the candidate decides: ${s.out.directive.narration}`);
      const result = fy.events(s.goalId).find((e) => e.type === 'OPERATION_RESULT' && e.data['operationId'] === s.op.id);
      assert.equal(result?.data['pr'], undefined, `${label}: no fact is taken from an unusable answer`);
    } finally {
      fy.cleanup();
    }
  }
});

test('T0-EXIT-ZERO-NOT-MERGED-2 acceptance 4: a run with no candidate sha whose PR gh answers MERGED waits with the operation UNKNOWN and the missing sha named; answered OPEN it still stops as tool (T0-EXIT-ZERO-NOT-MERGED base-sync R3 decision F1) [R2]', () => {
  const fx = makeFixture();
  try {
    const s = shipped(fx, () => new ExitZero(SCAFFOLD_SUCCESS), { repository: 'o/r', exec: ghView('MERGED', HEAD), candidateSha: null });
    assert.equal(s.stored.candidate?.sha, undefined, 'the run keeps no candidate sha');
    assertUnknown(s);
    assert.equal(s.stored.stop, undefined, 'a head gh reports cannot be refuted without a candidate sha');
    if (s.out.directive.kind === 'wait') assert.match(s.out.directive.narration, /no candidate sha/);
    assert.match(s.op.error ?? '', /no candidate sha/);
  } finally {
    fx.cleanup();
  }
  const fy = makeFixture();
  try {
    const s = shipped(fy, () => new ExitZero(SCAFFOLD_SUCCESS), { repository: 'o/r', exec: ghView('OPEN', HEAD), candidateSha: null });
    assert.equal(s.stored.stop?.reason, 'tool', 'an open PR is a non-merge whatever the candidate');
    assert.ok(s.stored.stop?.detail.includes('(no candidate sha)'), s.stored.stop?.detail);
    assert.equal(s.op.status, 'failed');
  } finally {
    fy.cleanup();
  }
});

test('T0-EXIT-ZERO-NOT-MERGED-3 acceptance 4: the dry-run path, which merges nothing, verifies a merge-unconfirmed ship as main verified a merged one, whatever gh answers [R2]', () => {
  for (const options of [{ shipPath: 'dry-run' as const }, { shipPath: 'dry-run' as const, repository: 'o/r', exec: ghView('OPEN', HEAD) }, { shipPath: 'dry-run' as const, repository: 'o/r', exec: ghView('CLOSED', OTHER), candidateSha: null }]) {
    const fx = makeFixture();
    try {
      const s = shipped(fx, () => new ExitZero('all good'), options);
      assert.equal(s.out.directive.kind, 'close', s.out.directive.narration);
      assert.equal(s.op.status, 'succeeded');
    } finally {
      fx.cleanup();
    }
  }
});

test('T0-EXIT-ZERO-NOT-MERGED acceptance 4: a merged ship keeps its verification: [SAGA-DONE] closes on the dry-run path, and with gh reading its PR OPEN it waits with the operation UNKNOWN rather than stopping [R2] [R3]', () => {
  const fx = makeFixture();
  try {
    const s = shipped(fx, () => new ExitZero('[SAGA-DONE]'), { shipPath: 'dry-run' });
    assert.equal(s.out.directive.kind, 'close', s.out.directive.narration);
  } finally {
    fx.cleanup();
  }
  const fy = makeFixture();
  try {
    const s = shipped(fy, () => new ExitZero('PR #42\n[SAGA-DONE]'), { repository: 'o/r', exec: ghView('OPEN', HEAD) });
    assert.equal(s.out.directive.kind, 'wait', s.out.directive.narration);
    assert.equal(s.op.status, 'UNKNOWN');
    assert.equal(s.stored.stop, undefined, 'a merged ship is never stopped by the merge-unconfirmed rule');
  } finally {
    fy.cleanup();
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
  "A ship is `merged` only on its adapter's merge contract, the `[SAGA-DONE]` sentinel beside no failure marker, neither `[SAGA-FAIL]` nor a bracketed sentinel of the sentinel map (card T0-EXIT-ZERO-NOT-MERGED): an exit 0 without it is `merge-unconfirmed`, never a merge read from the words of the output, and a scaffold success, which prints no sentinel, is one.",
  "Every exit-0 receipt that was read as merged before is now either `merged` or `merge-unconfirmed`, and every receipt that was read as a failure keeps its failure class (card T0-EXIT-ZERO-NOT-MERGED-3): `[SAGA-DONE]` beside a failure marker, a failure sentinel without `[SAGA-FAIL]`, and a merge word (MERGED, 合并, `merged_pr=`) beside `[SAGA-FAIL]` are all `merge-unconfirmed`, since the words only route a receipt to verification, while an exit 0 that reports `[SAGA-FAIL]` with no merge word or `[SAGA-DONE]` keeps its failure class, or stays `unclassified`.",
  'The card machine reconciles a `merge-unconfirmed` ship from the PR the ship reported or its merge token names: a merge token whose tip is the candidate closes the card whatever gh answers, since it is the scaffold\'s merge contract, and otherwise, when gh answers, a PR MERGED at the candidate closes the card, and a PR OPEN, CLOSED or MERGED at another head stops it as `tool` with the operation failed (merge the PR by hand, then register a replacement card and resume the goal).',
  'gh answers only with a PR view whose number is the PR asked for, whose state is OPEN, MERGED or CLOSED and whose head is named; any other answer counts as none.',
  'A run with no candidate sha can neither verify nor refute the head gh reports, so a PR gh reads as MERGED leaves the operation `UNKNOWN` and the card waiting on `merge-verify`, naming the missing sha (card T0-EXIT-ZERO-NOT-MERGED-2).',
  'When gh does not answer, a stale token or none leaves the operation `UNKNOWN` while the card waits on `merge-verify` until the reconciliation grace ends. On the dry-run path, which merges nothing, a `merge-unconfirmed` ship is verified as a `merged` one is (card T0-EXIT-ZERO-NOT-MERGED-3).',
];
/** The phrase this card adds to docs/ARCHITECTURE.md (the outcome to state map). */
const ARCHITECTURE_PHRASE = "merge-unconfirmed -> CLOSE, STOP/tool or WAIT (a merge token at the candidate first, then gh's PR view; card T0-EXIT-ZERO-NOT-MERGED-3)";
/** The CHANGELOG entry, one line under Unreleased. */
const CHANGELOG_ENTRY =
  '- Exit 0 is not a merge, card T0-EXIT-ZERO-NOT-MERGED (issue 76 item 3): `classifyShipOutput` classifies an exit-0 ship as `merged` only on the `[SAGA-DONE]` sentinel beside no failure marker, where it used to accept `MERGED`, 合并 or `merged_pr=` in the text, no sentinel, or no `[SAGA-FAIL]`; every other exit 0 that was read as merged before (`[SAGA-DONE]` beside a failure marker, a merge word, no sentinel, no `[SAGA-FAIL]`) is the new outcome `merge-unconfirmed`, and a receipt read as a failure keeps its class, which the card machine reconciles from a merge token at the candidate, then gh\'s PR view (counted only when it names the PR asked for, a known state and a head): a merge at the candidate closes the card, a PR gh reads as not merged at the candidate stops it as `tool`, and one gh cannot answer waits with the operation `UNKNOWN`. A scaffold success, which prints no sentinel, now takes that path, and `DryRunShipPath` prints `[SAGA-DONE]` on `merged`.';

test('T0-EXIT-ZERO-NOT-MERGED acceptance 5: docs/OPERATIONS.md, docs/ARCHITECTURE.md and CHANGELOG.md Unreleased state the rule [R4]', () => {
  const operations = read('docs', 'OPERATIONS.md');
  for (const sentence of OPERATIONS_SENTENCES) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
  assert.ok(read('docs', 'ARCHITECTURE.md').includes(ARCHITECTURE_PHRASE), `docs/ARCHITECTURE.md states: ${ARCHITECTURE_PHRASE}`);
  const changelog = read('CHANGELOG.md');
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  assert.ok(unreleased.split('\n').includes(CHANGELOG_ENTRY), 'CHANGELOG.md Unreleased carries the entry');
});
