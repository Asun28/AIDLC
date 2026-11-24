// Card T1-REVIEW-FOLLOWUP-ISSUE-2: `card close --followups` records the GitHub issue of the advisory and deferred findings of a
// merged card, with at most one issue submission per run. gh is scripted at its boundary; no test reaches GitHub.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvidenceStore } from '../../src/audit/manifest.ts';
import { DEFAULT_LEASE_TTL_MS, resourceKeys } from '../../src/coordination/lease.ts';
import type { CardRun, ReviewFinding, ReviewInvocation } from '../../src/core/types.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner, type CardDirective } from '../../src/loop/card-runner.ts';
import { runSync, scriptedRunner, type ExecReceipt, type SyncRunner } from '../../src/probes/exec.ts';
import { Journal, setActorForTests } from '../../src/state/journal.ts';
import { hostName, shortKey } from '../../src/state/paths.ts';
import { tmpDir } from '../infra/helpers.ts';
import { actorA, actorB, candidateShaFor, goalForCards, makeFixture, T0, writeCard, type Fixture } from './_harness.ts';

const CARD = 'T1-FUP';
const REPO = 'acme/widgets';
const SHA = candidateShaFor(CARD);
const MARKER = 'aidlc-finding:T1-FUP:42:sha-t1-fup:review-followups';
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const ALL = { metadata: true, docSync: true, findings: true, evidence: true, cleanup: true, followups: true };
const DISPOSED = ['followupIssue', 'followupNote', 'followupPending'] as const;

const invocation = (id: string, outcome: ReviewInvocation['outcome'], advisory: string[]): ReviewInvocation => ({ invocationId: id, candidateDigest: 'digest-1', base: 'main', policyVersion: 'v1', reviewer: 'primary', requestedAt: T0, outcome, advisory });
const finding = (id: string, reason: string, extra: Partial<ReviewFinding>): ReviewFinding => ({ id, stage: 'formal', round: 1, reason, raisedAt: T0, disposition: 'open', disputes: [], reraised: [], revision: 0, ...extra });

const stored = (fx: Fixture, goalId: string): CardRun => fx.store.getCardRun(goalId, CARD)!;
/** The record as its file holds it, so an absent key is told from one the schema gives. */
const raw = (fx: Fixture, goalId: string): Record<string, unknown> => JSON.parse(readFileSync(fx.store.cardFile(goalId, CARD), 'utf8')) as Record<string, unknown>;
const patch = (fx: Fixture, goalId: string, change: Partial<CardRun>): CardRun => fx.store.updateCardRun(goalId, CARD, (run) => ({ ...run!, ...change }));
const cardKey = (fx: Fixture): string => resourceKeys.card(fx.repo.key, CARD);

/** The card driven to CLOSE on the dry-run path, every closure step missing. */
function atClose(fx: Fixture, findings = true): string {
  writeCard(fx, { id: CARD, title: 'files follow-ups' });
  const goalId = goalForCards(fx, [CARD]).id;
  const runner = fx.runner();
  const card = fx.card(CARD);
  let r = runner.next(fx.goal(goalId), card, fx.controller.ensureCardRun(fx.goal(goalId), CARD));
  r = runner.next(fx.goal(goalId), card, r.run);
  r = runner.next(fx.goal(goalId), card, runner.recordAttempt(fx.goal(goalId), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok', redReceipt: 'red:ok', candidateSha: SHA }));
  assert.equal(r.directive.kind, 'close', r.directive.narration);
  if (!findings) return goalId;
  patch(fx, goalId, {
    pr: { number: 42, state: 'MERGED', headRefOid: 'head-of-the-pr', baseRefName: 'main' },
    review: { ...r.run.review, invocations: [invocation('r3:1', 'pass', ['Name the unit.'])] },
    findings: [finding('F1', 'Split the helper.', { advisory: true }), finding('F2', 'Cache the config.', { ruling: { at: T0, by: 'owner', decision: 'deferred', reason: 'later' } }), finding('F3', 'Already fixed.', {})],
  });
  return goalId;
}

const bodyFor = (sha: string, marker: string): string => `Review follow-ups of card ${CARD}, PR #42, candidate ${sha}.\n\n- Name the unit.\n- F1: Split the helper.\n- F2: Cache the config.\n\n${marker}\n`;

interface Call {
  kind: 'list' | 'label' | 'submit';
  args: string[];
  cwd?: string;
  input?: string;
}
interface Gh {
  /** The issues the list call prints, in this order. */
  issues: Array<{ number: number; body: string | null; pull_request?: unknown }>;
  /** Issues a submit made that the list call does not print yet. */
  unlisted: Array<{ number: number; body: string }>;
  calls: Call[];
  /** Runs inside the call, before it answers. */
  during: Partial<Record<Call['kind'], () => void>>;
  /** Replaces the answer of the call. */
  answer: Partial<Record<Call['kind'], Partial<ExecReceipt>>>;
  runner: SyncRunner;
  kinds: () => Call['kind'][];
}

/** gh at its boundary. A submit files issue 101 (then 102) whatever it answers, unlisted when its answer is replaced. */
function ghOf(issues: Gh['issues'] = []): Gh {
  const gh: Gh = {
    issues,
    unlisted: [],
    calls: [],
    during: {},
    answer: {},
    kinds: () => gh.calls.map((c) => c.kind),
    runner: (command, args, options) => {
      const kind = args[0] === 'api' ? 'list' : args[0] === 'label' ? 'label' : 'submit';
      assert.equal(command, 'gh');
      assert.ok(kind !== 'submit' || (args[0] === 'issue' && args[1] === 'create'), `unexpected gh ${args.join(' ')}`);
      gh.calls.push({ kind, args, cwd: options?.cwd, input: options?.input });
      gh.during[kind]?.();
      let stdout = '';
      if (kind === 'list') {
        const page = Number(/[?&]page=(\d+)$/.exec(args[1]!)![1]);
        stdout = JSON.stringify(gh.issues.slice((page - 1) * 100, page * 100));
      }
      if (kind === 'submit') {
        const number = 100 + gh.kinds().filter((k) => k === 'submit').length;
        (gh.answer.submit ? gh.unlisted : gh.issues).push({ number, body: options?.input ?? '' });
        stdout = `https://github.com/${REPO}/issues/${number}\n`;
      }
      return scriptedRunner({ gh: { stdout, ...gh.answer[kind] } })(command, args, options);
    },
  };
  return gh;
}

type Config = { shipPath?: 'github' | 'dry-run' | 'scaffold'; repository?: string };
function closing(fx: Fixture, exec: SyncRunner, config: Config = {}): CardRunner {
  return new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, shipPath: 'github', repository: REPO, ...config }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), runner: exec, now: fx.now });
}

type Disposition = Parameters<CardRunner['markClosure']>[4];
const close = (fx: Fixture, goalId: string, exec: SyncRunner, flags: Partial<CardRun['closure']> = { followups: true }, disposition: Disposition = {}, config: Config = {}): CardRun => closing(fx, exec, config).markClosure(fx.goal(goalId), fx.card(CARD), stored(fx, goalId), flags, disposition);
const skip = (fx: Fixture, goalId: string, why: string, exec: SyncRunner = ghOf().runner): CardRun => close(fx, goalId, exec, {}, { skipFollowups: why });
const next = (fx: Fixture, goalId: string): CardDirective => fx.runner().next(fx.goal(goalId), fx.card(CARD), stored(fx, goalId)).directive;

function refusal(body: () => unknown): string {
  try {
    body();
  } catch (err) {
    return (err as Error).message;
  }
  return assert.fail('expected a refusal');
}

/** A fixture whose card is at CLOSE, removed after the body. */
function withClose(body: (fx: Fixture, goalId: string) => void, findings = true): void {
  const fx = makeFixture();
  try {
    body(fx, atClose(fx, findings));
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
}

/** The step is recorded with `issue`, with the note it holds (none given: no note), and nothing is pending. */
function recorded(fx: Fixture, goalId: string, issue: number | null, note?: string | RegExp): void {
  const run = raw(fx, goalId);
  assert.equal((run['closure'] as Record<string, unknown>)['followups'], true);
  assert.equal(run['followupIssue'], issue);
  assert.equal('followupPending' in run, false, 'no pending record');
  if (note === undefined) assert.equal('followupNote' in run, false, 'no note');
  else if (typeof note === 'string') assert.equal(run['followupNote'], note);
  else assert.match(String(run['followupNote']), note);
}

/** The step is open and nothing of it is stored, or exactly `pending` is. */
function open(fx: Fixture, goalId: string, pending?: CardRun['followupPending']): void {
  const run = raw(fx, goalId);
  assert.equal((run['closure'] as Record<string, unknown>)['followups'], false, 'the step is open');
  assert.equal('followupIssue' in run, false);
  assert.equal('followupNote' in run, false);
  assert.deepEqual(run['followupPending'], pending);
}

const PENDING = { repository: REPO, marker: MARKER, at: T0, by: actorA.session };

test('T1-REVIEW-FOLLOWUP-ISSUE-2 acceptance 1: one list, one label and one submit call in the main checkout, after --all removed the worktree too, then the number and the step [R6] [R7] [R11] [R14]', () => {
  const git = (cwd: string, ...args: string[]): void => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  };
  for (const all of [false, true]) {
    withClose((fx, goalId) => {
      const gh = ghOf([{ number: 9, body: 'another card\n\naidlc-finding:T1-OTHER:3:abc:review-followups' }]);
      let pendingAtSubmit: unknown;
      gh.during.submit = () => (pendingAtSubmit = stored(fx, goalId).followupPending);
      if (all) {
        writeFileSync(path.join(fx.tmp, '.gitignore'), '.aidlc/\n.review/\nwt/\n');
        git(fx.tmp, 'init', '-q', '-b', 'main');
        git(fx.tmp, 'add', '-A');
        git(fx.tmp, 'commit', '-q', '-m', 'base');
        mkdirSync(path.join(fx.tmp, 'wt'), { recursive: true });
        const root = realpathSync.native(path.join(fx.tmp, 'wt'));
        const worktree = path.join(root, CARD);
        git(fx.tmp, 'worktree', 'add', '-q', '-b', CARD, worktree);
        const evidence = new EvidenceStore(fx.paths.evidence, goalId);
        evidence.retain(evidence.load(goalId, 0, 0, T0), { id: `${CARD}.verdict`, kind: 'review-verdict', content: '{"verdict":"pass"}\n', cardId: CARD });
        gh.during.list = () => assert.equal(existsSync(worktree), false, 'the worktree is gone before the first gh call');
        const exec: SyncRunner = (command, args, options) => (command === 'gh' ? gh.runner : runSync)(command, args, options);
        const runner = new CardRunner({ paths: fx.paths, repo: { ...fx.repo, isGit: true }, config: { ...fx.config, shipPath: 'github', repository: REPO, worktreeRoot: root }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), runner: exec, now: fx.now });
        const marked = runner.markClosure(fx.goal(goalId), fx.card(CARD), stored(fx, goalId), ALL);
        assert.deepEqual(marked.closure, { ...ALL, lessons: false });
      } else {
        const marked = close(fx, goalId, gh.runner);
        assert.deepEqual([marked.followupIssue, marked.closure.followups, marked.closure.metadata], [101, true, false]);
      }
      assert.deepEqual(gh.calls.map((c) => [c.kind, c.cwd, c.input]), [['list', fx.tmp, undefined], ['label', fx.tmp, undefined], ['submit', fx.tmp, bodyFor(SHA, MARKER)]]);
      const [list, label, submit] = gh.calls.map((c) => c.args);
      assert.deepEqual(list, ['api', `repos/${REPO}/issues?labels=review-followup&state=all&per_page=100&page=1`]);
      assert.deepEqual(label!.slice(0, 5), ['label', 'create', 'review-followup', '--repo', REPO]);
      assert.deepEqual(submit, ['issue', 'create', '--repo', REPO, '--title', `Review follow-ups: ${CARD}`, '--label', 'review-followup', '--body-file', '-']);
      assert.deepEqual(pendingAtSubmit, PENDING, 'the pending record is stored before the submit');
      recorded(fx, goalId, 101);
      const event = fx.events(goalId).filter((e) => e.type === 'EVIDENCE_RETAINED').at(-1)!;
      assert.equal(event.data['followupIssue'], 101, 'the journal names the issue');
      assert.equal((event.data['closure'] as Record<string, unknown>)['followups'], true);
    });
  }
  // The body lists the findings of the record the reservation wrote, not those read before the gh calls.
  withClose((fx, goalId) => {
    const gh = ghOf();
    gh.during.label = () => void patch(fx, goalId, { findings: [...stored(fx, goalId).findings, finding('F4', 'Raised meanwhile.', { advisory: true })] });
    close(fx, goalId, gh.runner);
    assert.ok(gh.calls.at(-1)!.input!.includes('\n- F4: Raised meanwhile.\n'), gh.calls.at(-1)!.input);
  });
});

test('T1-REVIEW-FOLLOWUP-ISSUE-2 acceptance 2: the issue of the run is the lowest whose last line that is not empty is the marker; a marker elsewhere is not it [R6]', () => {
  const others = Array.from({ length: 100 }, (_, n) => ({ number: 1000 - n, body: 'another issue' }));
  const ended = (number: number) => ({ number, body: `Review follow-ups\n\n- old\n\n${MARKER}` });
  for (const [name, issues, number] of [
    ['on the second page', [...others, ended(55)], 55],
    ['two, the lower number listed last', [ended(70), ...others, ended(60)], 60],
    ['two, the lower number listed first', [ended(60), ended(70)], 60],
    ['with empty lines after it and the line ends of GitHub', [{ number: 7, body: `a\r\n\r\n${MARKER}\r\n\r\n` }], 7],
  ] as const) {
    withClose((fx, goalId) => {
      const gh = ghOf([...issues]);
      assert.equal(close(fx, goalId, gh.runner).followupIssue, number, name);
      assert.ok(gh.kinds().every((k) => k === 'list'), `${name}: ${gh.kinds().join(', ')}`);
      recorded(fx, goalId, number);
    });
  }
  for (const [name, body] of [
    ['inside a finding', `- the reviewer quoted ${MARKER}\n\naidlc-finding:T1-OTHER:1:abc:review-followups`],
    ['after other text on the last line', `text\n\nsee ${MARKER}`],
    ['with more characters after it', `text\n\n${MARKER}-2`],
    ['with a space after it', `text\n\n${MARKER} `],
    ['in other letter case', `text\n\n${MARKER.toUpperCase()}`],
    ['above the last line', `${MARKER}\n\na line below`],
    ['in no body', null],
  ] as const) {
    withClose((fx, goalId) => {
      const gh = ghOf([{ number: 5, body }]);
      close(fx, goalId, gh.runner);
      assert.deepEqual(gh.kinds(), ['list', 'label', 'submit'], name);
      recorded(fx, goalId, 101);
    });
  }
  withClose((fx, goalId) => {
    const gh = ghOf([{ ...ended(5), pull_request: {} }]);
    close(fx, goalId, gh.runner);
    recorded(fx, goalId, 101);
  });
});

test('T1-REVIEW-FOLLOWUP-ISSUE-2 acceptance 3: another ship path, no repository and no finding each record null and the note with no gh call, and a recorded step stays as it is [R3] [R4]', () => {
  for (const [name, config, findings, note] of [
    ['dry-run', { shipPath: 'dry-run' }, true, /ship path is dry-run/],
    ['scaffold', { shipPath: 'scaffold' }, true, /ship path is scaffold/],
    ['no repository', { repository: undefined }, true, /no repository is configured/],
    ['no finding', {}, false, /no advisory or deferred finding/],
  ] as Array<[string, Config, boolean, RegExp]>) {
    withClose((fx, goalId) => {
      const gh = ghOf();
      close(fx, goalId, gh.runner, { followups: true }, {}, config);
      recorded(fx, goalId, null, note);
      const before = raw(fx, goalId);
      const events = fx.events(goalId).length;
      // The repository is set; the recorded step is not opened again.
      close(fx, goalId, gh.runner);
      skip(fx, goalId, 'another reason', gh.runner);
      assert.deepEqual(gh.calls, [], name);
      assert.deepEqual(raw(fx, goalId), before, `${name}: the record is unchanged`);
      assert.equal(fx.events(goalId).length, events, `${name}: nothing is journaled`);
    }, findings);
  }
  // With an issue recorded, the other steps are done and the issue stays.
  withClose((fx, goalId) => {
    const gh = ghOf();
    close(fx, goalId, gh.runner);
    close(fx, goalId, gh.runner, { docSync: true, followups: true });
    skip(fx, goalId, 'too late', gh.runner);
    assert.deepEqual(gh.kinds(), ['list', 'label', 'submit']);
    assert.equal(stored(fx, goalId).closure.docSync, true);
    recorded(fx, goalId, 101);
  });
});

test('T1-REVIEW-FOLLOWUP-ISSUE-2 acceptance 4: a stored closure without the key has the step done, a new run has it open, and both close narrations name it [R1] [R2] [R3] [R16]', () => {
  withClose((fx, goalId) => {
    assert.equal(stored(fx, goalId).closure.followups, false, 'a run created now starts with the step open');
    const directive = next(fx, goalId);
    assert.ok(directive.kind === 'close' && directive.missing.includes('followups'), JSON.stringify(directive));
    assert.match(directive.narration, /--followups/);
    assert.match(directive.narration, /--skip-followups/);
    // The record as main wrote it: the key is absent from the stored closure.
    const { followups: _key, ...closure } = raw(fx, goalId)['closure'] as Record<string, boolean>;
    writeFileSync(fx.store.cardFile(goalId, CARD), JSON.stringify({ ...raw(fx, goalId), closure }));
    const historical = next(fx, goalId);
    assert.ok(historical.kind === 'close' && !historical.missing.includes('followups'), JSON.stringify(historical));
    assert.doesNotMatch(historical.narration, /followups/);
    const gh = ghOf();
    // The evidence and cleanup steps of the github path need a git repository, so they are done on the dry-run path.
    const { followups: _step, ...five } = ALL;
    close(fx, goalId, gh.runner, { followups: true });
    close(fx, goalId, gh.runner, { ...five, followups: true }, {}, { shipPath: 'dry-run' });
    close(fx, goalId, gh.runner, { lessons: true }, { skipped: 'no rule learned' });
    assert.deepEqual(gh.calls, []);
    for (const key of DISPOSED) assert.equal(key in raw(fx, goalId), false, key);
    assert.equal(next(fx, goalId).kind, 'done');
  });
  withClose((fx, goalId) => {
    // The registry records the merge, so the goal verifies its arc while the closure is open.
    writeCard(fx, { id: CARD, title: 'files follow-ups', status: 'merged' });
    assert.equal(fx.controller.next(goalId).kind, 'verify-arc');
    fx.controller.report({ goalId, generation: 0, result: 'arc-verified', data: { evidence: 'ok' } });
    const directive = fx.controller.next(goalId);
    assert.ok(directive.kind === 'close' && directive.missing.includes(`${CARD}: closure.followups`), JSON.stringify(directive));
    assert.match(directive.narration, /status\/doc_sync\/findings\/evidence\/cleanup\/followups\/lessons/);
  });
});

test('T1-REVIEW-FOLLOWUP-ISSUE-2 acceptance 5: the marker takes the sha of the candidate, else of the PR, and a run with neither fails with no gh call [R5]', () => {
  const HEAD = 'a'.repeat(40);
  const MERGE = 'c'.repeat(40);
  const fx = makeFixture({ config: { repository: REPO } });
  try {
    writeCard(fx, { id: CARD, title: 'merged by hand' });
    const goalId = goalForCards(fx, [CARD]).id;
    fx.store.saveCardRun({ ...fx.controller.ensureCardRun(fx.goal(goalId), CARD), state: 'SHIP', branch: CARD });
    const pr = { number: 42, state: 'MERGED', headRefOid: HEAD, baseRefName: 'main', mergedAt: '2026-09-10T12:00:00Z', url: '' };
    const probes = scriptedRunner({ 'gh pr list': { stdout: JSON.stringify([pr]) }, 'gh pr view': { stdout: JSON.stringify({ ...pr, mergeCommit: { oid: MERGE } }) }, 'git fetch': {}, 'git merge-base': {}, 'git rev-parse': { stdout: `${'d'.repeat(40)}\n` } });
    closing(fx, probes).adoptMerge(fx.goal(goalId), fx.card(CARD), stored(fx, goalId), 42);
    assert.equal(stored(fx, goalId).candidate, undefined, 'an adopted merge records no candidate');
    assert.equal(next(fx, goalId).kind, 'close');
    patch(fx, goalId, { findings: [finding('F1', 'Split the helper.', { advisory: true })] });
    const gh = ghOf();
    close(fx, goalId, gh.runner);
    const marker = `aidlc-finding:${CARD}:42:${HEAD.slice(0, 12)}:review-followups`;
    assert.equal(gh.calls.at(-1)!.input, `Review follow-ups of card ${CARD}, PR #42, candidate ${HEAD}.\n\n- F1: Split the helper.\n\n${marker}\n`);
    recorded(fx, goalId, 101);
  } finally {
    fx.cleanup();
  }
  withClose((differing, goalId) => {
    assert.notEqual(stored(differing, goalId).candidate!.sha, stored(differing, goalId).pr!.headRefOid);
    const gh = ghOf();
    close(differing, goalId, gh.runner);
    assert.equal(gh.calls.at(-1)!.input, bodyFor(SHA, MARKER), 'the candidate is used, not the PR head');
  });
  for (const pr of [undefined, { number: 42, state: 'MERGED' as const }, { number: 42, state: 'MERGED' as const, headRefOid: '' }]) {
    withClose((neither, goalId) => {
      patch(neither, goalId, { candidate: undefined, pr });
      const gh = ghOf();
      assert.match(refusal(() => close(neither, goalId, gh.runner)), /^followups: .*neither a candidate nor a PR head/);
      assert.deepEqual(gh.calls, []);
      open(neither, goalId);
      skip(neither, goalId, 'no sha to mark an issue with', gh.runner);
      recorded(neither, goalId, null, 'no sha to mark an issue with');
    });
  }
});

test('T1-REVIEW-FOLLOWUP-ISSUE-2 acceptance 6: a failed list or label call leaves the step open with no pending record and the other steps done; the next call files one issue [R7] [R13]', () => {
  for (const [name, kind, answer] of [
    ['a list that fails', 'list', { exitCode: 1, stderr: 'HTTP 502' }],
    ['a list that times out', 'list', { exitCode: 0, timedOut: true, stdout: '[]' }],
    ['a list that is not JSON', 'list', { stdout: '<html>' }],
    ['a list of another form', 'list', { stdout: '{"message":"Not Found"}' }],
    ['a label call that fails', 'label', { exitCode: 1, stderr: 'HTTP 403' }],
    ['a label call that times out', 'label', { exitCode: 0, timedOut: true }],
  ] as Array<[string, Call['kind'], Partial<ExecReceipt>]>) {
    withClose((fx, goalId) => {
      const gh = ghOf();
      gh.answer[kind] = answer;
      assert.match(refusal(() => close(fx, goalId, gh.runner, { metadata: true, docSync: true, findings: true, followups: true })), /^followups: /, name);
      assert.ok(!gh.kinds().includes('submit'), name);
      open(fx, goalId);
      const { metadata, docSync, findings } = stored(fx, goalId).closure;
      assert.deepEqual({ metadata, docSync, findings }, { metadata: true, docSync: true, findings: true }, `${name}: the other steps are recorded`);
      assert.match(readFileSync(path.join(fx.cardsDir, `${CARD}.md`), 'utf8'), /^status: merged$/m, `${name}: the metadata step is done`);
      gh.answer = {};
      close(fx, goalId, gh.runner);
      assert.equal(gh.kinds().filter((k) => k === 'submit').length, 1, name);
      recorded(fx, goalId, 101);
    });
  }
  // All flags of --all, with a failed step beside the follow-ups: both parts are in the message and the rest is done.
  withClose((fx, goalId) => {
    const gh = ghOf();
    gh.answer.list = { exitCode: 1, stderr: 'HTTP 502' };
    assert.match(refusal(() => close(fx, goalId, gh.runner, ALL)), /^evidence: .*; followups: /s);
    open(fx, goalId);
    assert.deepEqual(stored(fx, goalId).closure, { metadata: true, docSync: true, findings: true, evidence: false, cleanup: false, lessons: false, followups: false });
  });
  // A step that fails beside follow-ups that succeed.
  withClose((fx, goalId) => {
    const gh = ghOf();
    assert.match(refusal(() => close(fx, goalId, gh.runner, ALL)), /^evidence: /);
    recorded(fx, goalId, 101);
    assert.equal(stored(fx, goalId).closure.evidence, false);
  });
});

test('T1-REVIEW-FOLLOWUP-ISSUE-2 acceptance 7: a submit of unknown outcome is never repeated; the next close fails with the recovery until the issue is listed, then records it [R6] [R9] [R15]', () => {
  for (const [name, answer] of [
    ['times out', { exitCode: 0, timedOut: true, stdout: `https://github.com/${REPO}/issues/101\n` }],
    ['exits 1', { exitCode: 1, stderr: 'timeout reading the response' }],
    ['prints no issue URL', { stdout: 'created\n' }],
    ['prints the URL of another repository', { stdout: 'https://github.com/acme/other/issues/101\n' }],
  ] as Array<[string, Partial<ExecReceipt>]>) {
    for (const between of ['nothing', 'card next', 'another repository', 'another ship path', 'no repository', 'another candidate', 'no candidate and no PR', 'no finding'] as const) {
      withClose((fx, goalId) => {
        const label = `${name}, then ${between}`;
        const gh = ghOf();
        gh.answer.submit = answer;
        assert.match(refusal(() => close(fx, goalId, gh.runner)), /^followups: /, label);
        open(fx, goalId, PENDING);
        let config: Config = {};
        if (between === 'card next') {
          assert.equal(next(fx, goalId).kind, 'close', label);
          assert.equal(stored(fx, goalId).state, 'CLOSE', label);
        }
        if (between === 'another repository') config = { repository: 'acme/moved' };
        if (between === 'another ship path') config = { shipPath: 'dry-run' };
        if (between === 'no repository') config = { repository: undefined };
        if (between === 'another candidate') patch(fx, goalId, { candidate: { ...stored(fx, goalId).candidate!, sha: 'another-sha' } });
        if (between === 'no candidate and no PR') patch(fx, goalId, { candidate: undefined, pr: undefined });
        if (between === 'no finding') patch(fx, goalId, { review: { ...stored(fx, goalId).review, invocations: [] }, findings: [] });
        const message = refusal(() => close(fx, goalId, gh.runner, { followups: true }, {}, config));
        assert.match(message, /^followups: /, label);
        for (const part of [REPO, MARKER, T0, actorA.session, `card close ${CARD} --followups`, `card close ${CARD} --skip-followups "<why>"`]) assert.ok(message.includes(part), `${label}: ${part} in ${message}`);
        open(fx, goalId, PENDING);
        gh.issues.push(...gh.unlisted);
        close(fx, goalId, gh.runner, { followups: true }, {}, config);
        assert.deepEqual(gh.kinds(), ['list', 'label', 'submit', 'list', 'list'], label);
        assert.ok(gh.calls.every((c) => c.args.join(' ').includes(REPO)), `${label}: every call names the pending repository`);
        recorded(fx, goalId, 101);
      });
    }
  }
});

/** What another command does to the goal, the lease or the run while a gh call of the close runs. */
const meanwhile: Record<string, (fx: Fixture, goalId: string) => void> = {
  'goal cancelled': (fx, goalId) => void fx.controller.report({ goalId, generation: fx.goal(goalId).generation, result: 'cancel', data: { detail: 'cancelled' } }),
  'goal at another generation': (fx, goalId) => void fx.store.saveGoal({ ...fx.goal(goalId), generation: fx.goal(goalId).generation + 1 }),
  'lease expired': (fx) => void fx.advance(DEFAULT_LEASE_TTL_MS + 1000),
  'lease taken over': (fx, goalId) => {
    fx.advance(DEFAULT_LEASE_TTL_MS + 1000);
    setActorForTests(actorB);
    try {
      assert.equal(next(fx, goalId).kind, 'close');
    } finally {
      setActorForTests(actorA);
    }
  },
  'lease taken over, the run not yet': (fx) => {
    fx.advance(DEFAULT_LEASE_TTL_MS + 1000);
    setActorForTests(actorB);
    try {
      fx.leases.takeover(cardKey(fx), () => ({ reconciled: true, unresolvedOperations: [] }), { now: fx.now() });
    } finally {
      setActorForTests(actorA);
    }
  },
  'lease released': (fx, goalId) => fx.leases.release(cardKey(fx), stored(fx, goalId).ownerGeneration!),
  'owner generation of the run moved': (fx, goalId) => void patch(fx, goalId, { ownerGeneration: stored(fx, goalId).ownerGeneration! + 1 }),
  'run no longer in CLOSE': (fx, goalId) => void patch(fx, goalId, { state: 'WAIT' }),
  'merge no longer verified': (fx, goalId) => void patch(fx, goalId, { mergeVerified: false }),
  'pending record of another close': (fx, goalId) => void patch(fx, goalId, { followupPending: { repository: REPO, marker: MARKER, at: T0, by: 'win-C' } }),
  'step recorded by another close': (fx, goalId) => void patch(fx, goalId, { closure: { ...stored(fx, goalId).closure, followups: true }, followupIssue: 77 }),
  'step skipped': (fx, goalId) => void skip(fx, goalId, 'the owner files it'),
};

test('T1-REVIEW-FOLLOWUP-ISSUE-2 acceptance 8: a reservation is refused and nothing is submitted once the goal, the lease, the run or the step changed during the list or the label call [R8]', () => {
  for (const during of ['list', 'label'] as const) {
    for (const [name, act] of Object.entries(meanwhile)) {
      withClose((fx, goalId) => {
        const gh = ghOf();
        let written: Record<string, unknown> | undefined;
        gh.during[during] = () => {
          act(fx, goalId);
          written = raw(fx, goalId);
        };
        assert.match(refusal(() => close(fx, goalId, gh.runner)), /^followups: /, `${during}, ${name}`);
        assert.ok(!gh.kinds().includes('submit'), `${during}, ${name}: ${gh.kinds().join(', ')}`);
        assert.deepEqual(raw(fx, goalId), written, `${during}, ${name}: the record is as the other command wrote it`);
      });
    }
  }
  // The fence of the reservation reads the clock again while both locks are held.
  withClose((fx, goalId) => {
    const gh = ghOf();
    const update = fx.leases.update.bind(fx.leases);
    fx.leases.update = (key, change, within) =>
      update(key, (lease) => {
        assert.ok(existsSync(`${fx.store.cardFile(goalId, CARD)}.lock`), 'the card-run lock is held around the lease lock');
        fx.advance(DEFAULT_LEASE_TTL_MS + 1000);
        return change(lease);
      }, within);
    assert.match(refusal(() => close(fx, goalId, gh.runner)), /^followups: .*lease expired/);
    assert.deepEqual(gh.kinds(), ['list', 'label']);
    open(fx, goalId);
  });
});

test('T1-REVIEW-FOLLOWUP-ISSUE-2 acceptance 9: a disposition refused after the number is known leaves the record as it is and names the number; the next close records the issue from the list [R11] [R12]', () => {
  for (const [name, act] of Object.entries(meanwhile)) {
    if (name === 'pending record of another close') continue;
    withClose((fx, goalId) => {
      const gh = ghOf();
      let written: Record<string, unknown> | undefined;
      gh.during.submit = () => {
        act(fx, goalId);
        written = raw(fx, goalId);
      };
      assert.match(refusal(() => close(fx, goalId, gh.runner)), /^followups: .*#101\b/s, name);
      assert.deepEqual(gh.kinds(), ['list', 'label', 'submit'], name);
      assert.deepEqual(raw(fx, goalId), written, `${name}: the record is as the other command wrote it`);
      gh.during = {};
      if (name === 'goal cancelled') {
        fx.controller.report({ goalId, generation: 0, result: 'resume', data: { reason: 'the owner asked' } });
        assert.equal(next(fx, goalId).kind, 'close', name);
      } else if (name === 'lease taken over') setActorForTests(actorB);
      else return;
      close(fx, goalId, gh.runner);
      assert.deepEqual(gh.kinds(), ['list', 'label', 'submit', 'list'], name);
      recorded(fx, goalId, 101);
    });
  }
  // A lookup that gave the number while the other command ran: named, no label or submit call, the record unchanged.
  for (const name of ['goal cancelled', 'lease taken over', 'step skipped']) {
    withClose((fx, goalId) => {
      const gh = ghOf([{ number: 55, body: MARKER }]);
      let written: Record<string, unknown> | undefined;
      gh.during.list = () => {
        meanwhile[name]!(fx, goalId);
        written = raw(fx, goalId);
      };
      assert.match(refusal(() => close(fx, goalId, gh.runner)), /^followups: .*#55\b/s, name);
      assert.deepEqual(gh.kinds(), ['list'], name);
      assert.deepEqual(raw(fx, goalId), written, name);
    });
  }
  // A pending record of another marker, stored during the lookup, belongs to the close that stored it.
  withClose((fx, goalId) => {
    const gh = ghOf([{ number: 55, body: MARKER }]);
    const other = { repository: 'acme/moved', marker: 'another', at: T0, by: 'win-C' };
    gh.during.list = () => void patch(fx, goalId, { followupPending: other });
    assert.match(refusal(() => close(fx, goalId, gh.runner)), /^followups: .*#55\b/s);
    open(fx, goalId, other);
  });
  // A null disposition never removes the pending record another close stored after this one read the run.
  withClose((fx, goalId) => {
    const update = fx.store.updateCardRun.bind(fx.store);
    let first = true;
    fx.store.updateCardRun = (g, c, change, within) => {
      if (first) {
        first = false;
        update(g, c, (run) => ({ ...run!, followupPending: PENDING }));
      }
      return update(g, c, change, within);
    };
    assert.match(refusal(() => close(fx, goalId, ghOf().runner, { followups: true }, {}, { repository: undefined })), /^followups: /);
    open(fx, goalId, PENDING);
  });
  // A close of other flags and a card next between the pending record and the record of the step lose no field.
  withClose((fx, goalId) => {
    const gh = ghOf();
    gh.during.submit = () => {
      fx.runner().markClosure(fx.goal(goalId), fx.card(CARD), stored(fx, goalId), { docSync: true, findings: true });
      assert.equal(next(fx, goalId).kind, 'close');
      assert.deepEqual(stored(fx, goalId).followupPending, PENDING, 'neither loses the pending record');
    };
    close(fx, goalId, gh.runner, { metadata: true, followups: true });
    recorded(fx, goalId, 101);
    assert.deepEqual(stored(fx, goalId).closure, { metadata: true, docSync: true, findings: true, evidence: false, cleanup: false, lessons: false, followups: true });
  });
  // A write of other flags merges into the record it finds, under a fence of that moment.
  for (const expire of [false, true]) {
    withClose((fx, goalId) => {
      const proto = Journal.prototype as { append: Journal['append'] };
      const append = proto.append;
      let once = true;
      proto.append = function (this: Journal, event) {
        if (once && event.type === 'EVIDENCE_RETAINED') {
          once = false;
          patch(fx, goalId, { closure: { ...stored(fx, goalId).closure, findings: true }, followupPending: PENDING });
          if (expire) fx.advance(DEFAULT_LEASE_TTL_MS + 1000);
        }
        return append.call(this, event);
      };
      try {
        const mark = () => fx.runner().markClosure(fx.goal(goalId), fx.card(CARD), stored(fx, goalId), { docSync: true });
        if (expire) assert.match(refusal(mark), /lease expired/);
        else mark();
      } finally {
        proto.append = append;
      }
      const run = stored(fx, goalId);
      assert.deepEqual([run.closure.docSync, run.closure.findings, run.followupPending], [!expire, true, PENDING]);
    });
  }
});

test('T1-REVIEW-FOLLOWUP-ISSUE-2 acceptance 10: --skip-followups records null and the trimmed note with no gh call, and the refusals of the options and of a raw patch write nothing [R10] [R13] [R17]', () => {
  for (const pending of [false, true]) {
    withClose((fx, goalId) => {
      if (pending) patch(fx, goalId, { followupPending: PENDING });
      const gh = ghOf();
      const marked = close(fx, goalId, gh.runner, { docSync: true }, { skipFollowups: '  filed by hand as issue 8 \n' });
      assert.deepEqual(gh.calls, []);
      recorded(fx, goalId, null, 'filed by hand as issue 8');
      assert.deepEqual([marked.closure.docSync, marked.closure.metadata, marked.closure.followups], [true, false, true]);
    });
  }
  withClose((fx, goalId) => {
    const before = raw(fx, goalId);
    const events = fx.events(goalId).length;
    for (const why of ['', '   ', '\t\n']) assert.match(refusal(() => skip(fx, goalId, why)), /--skip-followups needs/);
    assert.match(refusal(() => close(fx, goalId, ghOf().runner, { followups: true, docSync: true }, { skipFollowups: 'why' })), /--skip-followups .*--followups/);
    for (const key of DISPOSED) {
      for (const value of [undefined, null, 5, 'text', PENDING]) {
        for (const data of [{ [key]: value }, { run: { [key]: value } }]) {
          assert.match(refusal(() => fx.controller.report({ goalId, generation: 0, result: 'card-result', cardId: CARD, data })), new RegExp(`^${key} is loop-owned`), `${key} ${String(value)}`);
        }
      }
    }
    assert.deepEqual(raw(fx, goalId), before);
    assert.equal(fx.events(goalId).length, events);
  });
});

/** A fixture the CLI can close: the lease of this host never expires and is held under the key the CLI gives the directory. */
function withCli(config: Record<string, unknown>, body: (fx: Fixture, goalId: string, cli: (...args: string[]) => { status: number | null; stdout: string; stderr: string }) => void): void {
  const fx = makeFixture({ actor: { ...actorA, host: hostName() } });
  try {
    const goalId = atClose(fx);
    const lease = fx.leases.heartbeat(cardKey(fx), stored(fx, goalId).ownerGeneration!, { now: '2099-01-01T00:00:00.000Z' });
    const key = resourceKeys.card(shortKey(realpathSync.native(fx.tmp)), CARD);
    if (key !== lease.resourceKey) fx.leases.update(key, () => ({ ...lease, resourceKey: key }));
    writeFileSync(path.join(fx.tmp, 'aidlc.config.json'), JSON.stringify({ worktreeRoot: path.join(fx.tmp, 'wt'), cardsDir: 'specs/tasks', base: 'main', ...config }));
    // PATH, in any spelling, names an empty directory: no path of the command reaches gh.
    const env: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(process.env)) if (!/^(path|aidlc_.*|claude_code_session_id|node_options|release_approval)$/i.test(name)) env[name] = value;
    Object.assign(env, { PATH: tmpDir('aidlc-nopath-'), AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: actorA.session });
    body(fx, goalId, (...args) => spawnSync(process.execPath, [MAIN, 'card', 'close', CARD, '--goal', goalId, ...args], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 120_000, windowsHide: true }));
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
}

test('T1-REVIEW-FOLLOWUP-ISSUE-2 acceptance 10, CLI: the flags, the refusals before any write and the failed step [R10] [R13]', () => {
  withCli({ shipPath: 'github', repository: REPO }, (fx, goalId, cli) => {
    const before = raw(fx, goalId);
    const events = fx.events(goalId).length;
    for (const [args, message] of [
      [['--skip-followups'], /argument missing/],
      [['--skip-followups', ''], /--skip-followups needs/],
      [['--skip-followups', '  '], /--skip-followups needs/],
      [['--skip-followups', '--doc-sync'], /--skip-followups needs/],
      [['--skip-followups', 'why', '--followups'], /--skip-followups .*--followups/],
      [['--skip-followups', 'why', '--all'], /--skip-followups .*--all/],
      [['--all', '--skip-followups', 'why'], /--skip-followups .*--all/],
    ] as Array<[string[], RegExp]>) {
      const r = cli(...args);
      assert.equal(r.status, 1, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, message, args.join(' '));
      assert.deepEqual(raw(fx, goalId), before, args.join(' '));
      assert.equal(fx.events(goalId).length, events, args.join(' '));
    }
    // No candidate and no PR head: the step fails before any gh call, the other flag is recorded.
    patch(fx, goalId, { candidate: undefined, pr: undefined });
    const failed = cli('--followups', '--doc-sync');
    assert.notEqual(failed.status, 0, failed.stdout);
    assert.match(failed.stderr, /^aidlc: followups: /m);
    open(fx, goalId);
    assert.equal(stored(fx, goalId).closure.docSync, true);
    const skipped = cli('--skip-followups', ' filed by hand ');
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.equal(JSON.parse(skipped.stdout).followups, true);
    recorded(fx, goalId, null, 'filed by hand');
  });
  for (const flag of ['--followups', '--all']) {
    withCli({ shipPath: 'dry-run' }, (fx, goalId, cli) => {
      const r = cli(flag);
      assert.equal(r.status, 0, `${flag}: ${r.stderr}`);
      const others = flag === '--all';
      assert.deepEqual(JSON.parse(r.stdout), { metadata: others, docSync: others, findings: others, evidence: others, cleanup: others, lessons: false, followups: true }, flag);
      recorded(fx, goalId, null, /ship path is dry-run/);
    });
  }
});
