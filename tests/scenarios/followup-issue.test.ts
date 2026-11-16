import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { actorA, actorB, candidateShaFor, goalForCards, makeFixture, T0, writeCard, type Fixture } from './_harness.ts';
import { resourceKeys } from '../../src/coordination/lease.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { scriptedRunner, type SyncRunner } from '../../src/probes/exec.ts';
import { hostName, shortKey } from '../../src/state/paths.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { CardRun, type ReviewFinding, type ReviewInvocation } from '../../src/core/types.ts';

// T1-REVIEW-FOLLOWUP-ISSUE: `card close --followups` files one GitHub issue labelled review-followup per merged card run,
// listing its advisory and deferred formal findings, and finds it again by the marker on its last line. gh is scripted.

const CARD = 'T1-FUP';
const REPO = 'acme/widgets';
const SHA = candidateShaFor(CARD);
const MARKER = 'aidlc-finding:T1-FUP:42:sha-t1-fup:review-followups';
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));

/** The card driven to CLOSE on the dry-run path of the harness: merge verified, every closure step missing. */
function atClose(fx: Fixture): { goalId: string; run: CardRun } {
  writeCard(fx, { id: CARD, title: 'files follow-ups' });
  const goal = goalForCards(fx, [CARD]);
  const runner = fx.runner();
  const card = fx.card(CARD);
  let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  r = runner.next(fx.goal(goal.id), card, r.run);
  const built = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok', redReceipt: 'red:ok', candidateSha: SHA });
  r = runner.next(fx.goal(goal.id), card, built);
  assert.equal(r.directive.kind, 'close', r.directive.narration);
  return { goalId: goal.id, run: r.run };
}

const invocation = (id: string, outcome: ReviewInvocation['outcome'], advisory?: string[]): ReviewInvocation => ({ invocationId: id, candidateDigest: 'digest-1', base: 'main', policyVersion: 'v1', reviewer: 'primary', requestedAt: T0, outcome, ...(advisory ? { advisory } : {}) });
const finding = (id: string, reason: string, extra: Partial<ReviewFinding> = {}): ReviewFinding => ({ id, stage: 'formal', round: 1, reason, raisedAt: T0, disposition: 'open', disputes: [], reraised: [], revision: 0, ...extra });
const deferred = (issue?: number): ReviewFinding['ruling'] => ({ at: T0, by: 'owner', decision: 'deferred', reason: 'later', ...(issue ? { issue } : {}) });

/** The run's PR and its review record: two decided advisory reasons, one pending, and findings of every kind R2 names or leaves out. */
function withFindings(fx: Fixture, goalId: string): CardRun {
  const run = fx.store.getCardRun(goalId, CARD)!;
  return fx.store.saveCardRun(
    CardRun.parse({
      ...run,
      pr: { number: 42, state: 'MERGED', headRefOid: SHA, baseRefName: 'main' },
      review: { ...run.review, invocations: [invocation('r3:1', 'block', ['Name the unit in the timeout message.', '  Prefer a Map for the lookup.  ']), invocation('r3:2', 'pending', ['A pending note.']), invocation('ship:1', 'pass', ['Name the unit in the timeout message.'])] },
      findings: [
        finding('F1', 'Split the helper.', { advisory: true }),
        finding('F2', 'Prefer a Map for the lookup.', { advisory: true }),
        finding('F3', 'A pre-review note.', { stage: 'pre', cycle: 0, advisory: true }),
        finding('F4', 'Cache the parsed config.', { ruling: deferred() }),
        finding('F5', 'Already tracked.', { ruling: deferred(7) }),
        finding('F6', 'Rejected.', { ruling: { at: T0, by: 'owner', decision: 'rejected', reason: 'wrong' } }),
        finding('F7', 'A blocking finding.'),
        finding('F8', 'Split the helper.', { advisory: true }),
      ],
    }),
  );
}

interface Tracker {
  issues: Array<{ number: number; body: string }>;
  calls: Array<{ args: string[]; input?: string }>;
  created: Array<{ title: string; label: string; body: string }>;
}

/** gh at its boundary: the issues API prints the tracker by pages of 100, label create succeeds, issue create adds an issue and prints its URL. */
function gh(tracker: Tracker, fail: { list?: boolean; create?: 'refused' | 'lost' } = {}, onList?: () => void, onCreate?: () => void): SyncRunner {
  let body = '';
  const scripted = scriptedRunner({
    'gh api repos/': (args) => {
      if (fail.list) return { exitCode: 1, stderr: 'HTTP 502' };
      const page = Number(/[?&]page=(\d+)$/.exec(args[1]!)![1]);
      return { stdout: JSON.stringify(tracker.issues.slice((page - 1) * 100, page * 100)) };
    },
    'gh label create': {},
    'gh issue create': (args) => {
      if (fail.create === 'refused') return { exitCode: 1, stderr: 'HTTP 502' };
      const number = 100 + tracker.issues.length + 1;
      tracker.issues.push({ number, body });
      tracker.created.push({ title: args[args.indexOf('--title') + 1]!, label: args[args.indexOf('--label') + 1]!, body });
      return fail.create === 'lost' ? { exitCode: 1, stderr: 'timeout reading the response' } : { stdout: `https://github.com/${REPO}/issues/${number}\n` };
    },
  });
  return (command, args, options) => {
    tracker.calls.push({ args: [command, ...args], input: options?.input });
    if (args[0] === 'api') onList?.();
    if (args[0] === 'issue' && args[1] === 'create') onCreate?.();
    body = options?.input ?? '';
    return scripted(command, args, options);
  };
}

const tracker = (issues: Tracker['issues'] = []): Tracker => ({ issues, calls: [], created: [] });

function closing(fx: Fixture, runner: SyncRunner, config: { shipPath?: 'github' | 'dry-run'; repository?: string } = {}): CardRunner {
  const shipPath = config.shipPath ?? 'github';
  const repository = 'repository' in config ? config.repository : REPO;
  return new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, shipPath, repository }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), runner, now: fx.now });
}

const followups = (fx: Fixture, goalId: string, runner: CardRunner) => runner.markClosure(fx.goal(goalId), fx.card(CARD), fx.store.getCardRun(goalId, CARD)!, { followups: true });

test('T1-REVIEW-FOLLOWUP-ISSUE acceptance 1: a merged run with advisory and deferred findings files one issue with the marker, the label and each finding, and records its number', () => {
  const fx = makeFixture();
  try {
    const { goalId } = atClose(fx);
    withFindings(fx, goalId);
    const t = tracker([{ number: 9, body: 'another card\n\naidlc-finding:T1-OTHER:3:abc:review-followups' }]);
    const marked = followups(fx, goalId, closing(fx, gh(t)));
    assert.equal(t.created.length, 1, 'one issue filed');
    const [issue] = t.created;
    assert.equal(issue!.title, 'Review follow-ups: T1-FUP');
    assert.equal(issue!.label, 'review-followup');
    const lines = issue!.body.trimEnd().split('\n');
    assert.deepEqual(lines.filter((l) => l.startsWith('- ')), ['- Name the unit in the timeout message.', '- F2: Prefer a Map for the lookup.', '- F1: Split the helper.', '- F4: Cache the parsed config.']);
    assert.equal(lines.at(-1), MARKER, 'the marker is the last line');
    for (const named of ['T1-FUP', '#42', SHA]) assert.ok(issue!.body.includes(named), `the body names ${named}`);
    const list = t.calls.find((c) => c.args[1] === 'api');
    assert.ok(list && list.args[2]!.startsWith(`repos/${REPO}/issues?labels=review-followup&state=all`), 'the lookup lists by label');
    assert.ok(!t.calls.some((c) => c.args.includes('search') || c.args.includes('--search')), 'no search query');
    assert.equal(marked.closure.followups, true);
    assert.equal(marked.followupIssue, 102);
    const stored = fx.store.getCardRun(goalId, CARD)!;
    assert.equal(stored.closure.followups, true);
    assert.equal(stored.followupIssue, 102);
    assert.equal(stored.closure.metadata, false, 'no other step is recorded');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FOLLOWUP-ISSUE acceptance 2: an issue already holding the marker is recorded and none is filed; a failed create leaves the step unset, and the retry files once', () => {
  const found = makeFixture();
  try {
    const { goalId } = atClose(found);
    withFindings(found, goalId);
    const t = tracker([{ number: 9, body: 'aidlc-finding:T1-OTHER:3:abc:review-followups' }, { number: 55, body: `Review follow-ups of T1-FUP\n\n- old\n\n${MARKER}` }]);
    const marked = followups(found, goalId, closing(found, gh(t)));
    assert.equal(t.created.length, 0, 'nothing filed');
    assert.ok(!t.calls.some((c) => c.args[1] === 'label' || (c.args[1] === 'issue' && c.args[2] === 'create')), 'no create call');
    assert.equal(marked.followupIssue, 55);
    assert.equal(found.store.getCardRun(goalId, CARD)!.closure.followups, true);
  } finally {
    found.cleanup();
  }
  for (const failure of [{ list: true }, { create: 'refused' }, { create: 'lost' }] as const) {
    const fx = makeFixture();
    try {
      const { goalId } = atClose(fx);
      withFindings(fx, goalId);
      const before = fx.store.getCardRun(goalId, CARD)!;
      const t = tracker();
      assert.throws(() => followups(fx, goalId, closing(fx, gh(t, failure))), 'list' in failure ? /gh api repos\// : /gh issue create/);
      assert.deepEqual(fx.store.getCardRun(goalId, CARD), before, `${JSON.stringify(failure)}: the run is unchanged`);
      const retried = followups(fx, goalId, closing(fx, gh(t)));
      assert.equal(t.created.length, 1, `${JSON.stringify(failure)}: one issue in all`);
      assert.equal(retried.followupIssue, t.issues[0]!.number);
      assert.equal(retried.closure.followups, true);
    } finally {
      fx.cleanup();
    }
  }
});

test('T1-REVIEW-FOLLOWUP-ISSUE acceptance 3: no issue on another ship path, without a repository, or with no follow-up finding; the step is recorded with a note', () => {
  const cases = [
    { name: 'dry-run ship path', config: { shipPath: 'dry-run' as const }, seed: true, note: /ship path/ },
    { name: 'no repository', config: { repository: undefined }, seed: true, note: /repository/ },
    { name: 'no follow-up finding', config: {}, seed: false, note: /no advisory or deferred finding/ },
  ];
  for (const c of cases) {
    const fx = makeFixture();
    try {
      const { goalId } = atClose(fx);
      if (c.seed) withFindings(fx, goalId);
      const t = tracker();
      const marked = followups(fx, goalId, closing(fx, gh(t), c.config));
      assert.deepEqual(t.calls, [], `${c.name}: no gh call`);
      assert.equal(marked.closure.followups, true, c.name);
      assert.equal(marked.followupIssue, null, c.name);
      assert.match(marked.followupNote ?? '', c.note, c.name);
      assert.equal(fx.store.getCardRun(goalId, CARD)!.followupIssue, null, c.name);
    } finally {
      fx.cleanup();
    }
  }
  // The flag and `--all` reach the step through the CLI (dry-run ship path: no gh call).
  for (const flag of ['--followups', '--all']) {
    const fx = makeFixture({ actor: { ...actorA, host: hostName() } });
    try {
      const { goalId, run } = atClose(fx);
      const lease = fx.leases.heartbeat(resourceKeys.card(fx.repo.key, CARD), run.ownerGeneration!, { now: '2099-01-01T00:00:00.000Z' });
      const cliKey = resourceKeys.card(shortKey(realpathSync.native(fx.tmp)), CARD);
      if (cliKey !== lease.resourceKey) fx.leases.update(cliKey, () => ({ ...lease, resourceKey: cliKey }));
      writeFileSync(path.join(fx.tmp, 'aidlc.config.json'), JSON.stringify({ shipPath: 'dry-run', worktreeRoot: path.join(fx.tmp, 'wt'), cardsDir: 'specs/tasks', base: 'main' }));
      const out = spawnSync(process.execPath, [MAIN, 'card', 'close', CARD, '--goal', goalId, flag, '--json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: actorA.session }, encoding: 'utf8', timeout: 120_000 });
      assert.equal(out.status, 0, `${flag}: ${out.stderr}`);
      assert.equal(JSON.parse(out.stdout).followups, true, `${flag} records the step`);
      assert.equal(fx.store.getCardRun(goalId, CARD)!.followupIssue, null, flag);
    } finally {
      fx.cleanup();
    }
  }
});

test('T1-REVIEW-FOLLOWUP-ISSUE acceptance 4: a stored run without the key parses with the step done, a new run starts without it, and close lists it as missing', () => {
  const fx = makeFixture();
  try {
    const { goalId, run } = atClose(fx);
    assert.equal(run.closure.followups, false, 'a run created now starts without the step');
    const r = fx.runner().next(fx.goal(goalId), fx.card(CARD), run);
    assert.equal(r.directive.kind, 'close');
    if (r.directive.kind === 'close') {
      assert.ok(r.directive.missing.includes('followups'), r.directive.missing.join(', '));
      assert.match(r.directive.narration, /--followups/);
    }
    // A record written before the step: the key is absent from the file.
    const file = fx.store.cardFile(goalId, CARD);
    const historic = (state: string) => {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> & { closure: Record<string, boolean> };
      const { followups: _dropped, ...closure } = raw.closure;
      writeFileSync(file, JSON.stringify({ ...raw, state, closure: Object.fromEntries(Object.keys(closure).map((k) => [k, true])) }));
    };
    historic('CLOSE');
    const closing = fx.store.getCardRun(goalId, CARD)!;
    assert.equal(closing.closure.followups, true, 'a stored run without the key parses with the step done');
    assert.equal(fx.runner().next(fx.goal(goalId), fx.card(CARD), closing).directive.kind, 'done', 'a closing run gains no step');
    historic('DONE');
    const done = fx.runner().next(fx.goal(goalId), fx.card(CARD), fx.store.getCardRun(goalId, CARD)!);
    assert.equal(done.directive.kind, 'done', 'a historical DONE run stays DONE');
    assert.equal(fx.store.getCardRun(goalId, CARD)!.state, 'DONE');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FOLLOWUP-ISSUE R3 decision 1 F2: a marked issue on the second page of the label is recorded and none is filed', () => {
  const fx = makeFixture();
  try {
    const { goalId } = atClose(fx);
    withFindings(fx, goalId);
    const issues = Array.from({ length: 150 }, (_, n) => ({ number: n + 1, body: n === 120 ? `old\n\n${MARKER}` : `issue ${n + 1}` }));
    const t = tracker(issues);
    assert.equal(followups(fx, goalId, closing(fx, gh(t))).followupIssue, 121);
    assert.equal(t.created.length, 0, 'nothing filed');
    assert.deepEqual(t.calls.map((c) => /page=(\d+)$/.exec(c.args[2]!)?.[1]), ['1', '2'], 'both pages read');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FOLLOWUP-ISSUE R3 decision 1 F3: a lease that expires during the lookup is not taken over while the reservation is open, and the old closer files no issue', () => {
  const fx = makeFixture();
  try {
    const { goalId, run } = atClose(fx);
    withFindings(fx, goalId);
    const t = tracker();
    let takeover = '';
    // The lease expires and another session runs card next: during the lookup here, during the create below.
    const expireAndTakeOver = () => {
      fx.advance(Date.parse(fx.leases.read(resourceKeys.card(fx.repo.key, CARD))!.expiresAt) - Date.parse(fx.now()) + 60_000);
      setActorForTests(actorB);
      try {
        takeover = fx.runner().next(fx.goal(goalId), fx.card(CARD), fx.store.getCardRun(goalId, CARD)!).directive.narration;
      } finally {
        setActorForTests(actorA);
      }
    };
    const runner = gh(t, {}, expireAndTakeOver);
    assert.throws(() => followups(fx, goalId, closing(fx, runner)), /followups: .*lease expired/);
    assert.match(takeover, /takeover refused/, 'the open reservation blocks the takeover');
    assert.equal(fx.leases.read(resourceKeys.card(fx.repo.key, CARD))!.generation, run.ownerGeneration, 'the lease keeps its generation');
    assert.equal(t.created.length, 0, 'no issue filed after the lease expired');
    assert.equal(fx.store.getCardRun(goalId, CARD)!.closure.followups, false);
    assert.deepEqual(fx.ops.list({ goalId, cardId: CARD }).filter((o) => o.target === MARKER).map((o) => o.status), ['failed'], 'the reservation is resolved');
  } finally {
    fx.cleanup();
  }
  const during = makeFixture();
  try {
    const { goalId } = atClose(during);
    withFindings(during, goalId);
    const t = tracker();
    const expire = () => during.advance(Date.parse(during.leases.read(resourceKeys.card(during.repo.key, CARD))!.expiresAt) - Date.parse(during.now()) + 60_000);
    assert.throws(() => followups(during, goalId, closing(during, gh(t, {}, undefined, expire))), /followups: .*lease expired/, 'a lease that expires during the create records nothing');
    assert.equal(t.created.length, 1);
    assert.equal(during.store.getCardRun(goalId, CARD)!.closure.followups, false);
  } finally {
    during.cleanup();
  }
});

test('T1-REVIEW-FOLLOWUP-ISSUE R3 decision 1 F4: a step first recorded without a repository records the issue and drops the note once the repository is set', () => {
  const fx = makeFixture();
  try {
    const { goalId } = atClose(fx);
    withFindings(fx, goalId);
    const t = tracker();
    assert.match(followups(fx, goalId, closing(fx, gh(t), { repository: undefined })).followupNote ?? '', /repository/);
    const filed = followups(fx, goalId, closing(fx, gh(t)));
    assert.equal(filed.followupIssue, 101);
    assert.equal(fx.store.getCardRun(goalId, CARD)!.followupNote, undefined, 'the note of the skip is gone');
  } finally {
    fx.cleanup();
  }
});
