// Card T0-ADOPT-EXTERNAL-MERGE (issue 358): a merge made outside a ship operation of the loop is verified from gh and git
// and adopted, so a goal whose arc-verified counted a card merged outside the loop reaches DONE.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs, { writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { makeStop } from '../../src/core/stop.ts';
import { CardRun } from '../../src/core/types.ts';
import { adoptMergeReport } from '../../src/cli/main.ts';
import { resourceKeys } from '../../src/coordination/lease.ts';
import { scriptedRunner, type SyncRunner } from '../../src/probes/exec.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { actorA, actorB, makeFixture, writeCard, goalForCards, T0, type Fixture } from './_harness.ts';

const BIN = fileURLToPath(new URL('../../bin/aidlc.js', import.meta.url));
const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const MERGE = 'c'.repeat(40);
const TREE = 'd'.repeat(40);
const MERGED_AT = '2026-09-10T12:00:00Z';
const STOPPED = 'T0-STOPPED';
const SHIPPED = 'T0-SHIPPED';
const PR = 41;

const realAppend = fs.appendFileSync;
const realRename = fs.renameSync;
let failingEvent: string | undefined;
let failingRecord: string | undefined;
before(() => {
  (fs as unknown as Record<string, unknown>)['appendFileSync'] = (...args: Parameters<typeof fs.appendFileSync>) => {
    if (failingEvent && typeof args[1] === 'string' && args[1].includes(`"type":"${failingEvent}"`)) throw Object.assign(new Error('EIO: injected'), { code: 'EIO' });
    return realAppend(...args);
  };
  (fs as unknown as Record<string, unknown>)['renameSync'] = (from: fs.PathLike, to: fs.PathLike) => {
    if (failingRecord && String(to).endsWith(`${failingRecord}.json`)) throw Object.assign(new Error('EIO: injected'), { code: 'EIO' });
    return realRename(from, to);
  };
  syncBuiltinESMExports();
});
after(() => {
  fs.appendFileSync = realAppend;
  fs.renameSync = realRename;
  syncBuiltinESMExports();
});

type Probe = { list?: unknown; view?: Record<string, unknown>; listFails?: boolean; viewFails?: boolean; fetchExit?: number; containsExit?: number; noTree?: boolean; during?: () => void };
/** gh and git as an adoption of PR 41 of `branch` into main reads them; `o` replaces one answer. */
function probes(branch: string, o: Probe = {}): SyncRunner {
  const view = { number: PR, state: 'MERGED', headRefOid: HEAD, baseRefName: 'main', mergedAt: MERGED_AT, mergeCommit: { oid: MERGE }, url: `https://github.com/o/r/pull/${PR}`, ...o.view };
  const list = o.list ?? [{ number: PR, state: 'MERGED', headRefOid: HEAD, baseRefName: 'main', mergedAt: MERGED_AT, url: '' }];
  return scriptedRunner({
    [`gh pr list --repo o/r --state all --head ${branch} --base main`]: o.listFails ? { exitCode: 1, stderr: 'HTTP 502' } : { stdout: JSON.stringify(list) },
    [`gh pr view ${PR} --repo o/r`]: o.viewFails ? { exitCode: 1, stderr: 'HTTP 502' } : { stdout: JSON.stringify(view) },
    'git fetch': { exitCode: o.fetchExit ?? 0 },
    [`git merge-base --is-ancestor ${MERGE} origin/main`]: { exitCode: o.containsExit ?? 0 },
    [`git rev-parse ${MERGE}^{tree}`]: () => {
      o.during?.();
      return o.noTree ? { exitCode: 128, stderr: 'bad object' } : { stdout: `${TREE}\n` };
    },
  });
}
const runnerWith = (fx: Fixture, exec: SyncRunner, config: Record<string, unknown> = {}) => new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, ...config }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, now: fx.now, runner: exec });

/** The goal of issue 358: two cards with registry status merged, one run stopped for good, one left in SHIP. */
function setup() {
  const fx = makeFixture({ config: { repository: 'o/r' } });
  writeCard(fx, { id: STOPPED, title: 'merged by hand after a final stop' });
  writeCard(fx, { id: SHIPPED, title: 'shipped outside the loop' });
  const goalId = goalForCards(fx, [STOPPED, SHIPPED]).id;
  // Both PRs merge outside the loop after intake, and the registry records it.
  writeCard(fx, { id: STOPPED, title: 'merged by hand after a final stop', status: 'merged' });
  writeCard(fx, { id: SHIPPED, title: 'shipped outside the loop', status: 'merged' });
  const stop = makeStop('tool', 'unclassified ship outcome (exit 1)', 'inspect the ship output', { at: T0, global: false, finalFor: { goalId, cardId: STOPPED } });
  const fresh = (id: string) => fx.controller.ensureCardRun(fx.goal(goalId), id);
  fx.store.saveCardRun({ ...fresh(STOPPED), state: 'STOP', stop, branch: STOPPED, candidate: { sha: OTHER, dirty: false, untracked: [], digest: 'dg-stopped' } });
  fx.store.saveCardRun({ ...fresh(SHIPPED), state: 'SHIP', branch: SHIPPED, candidate: { sha: HEAD, dirty: false, untracked: [], digest: 'dg-shipped' } });
  return { fx, goalId, run: (id: string) => fx.store.getCardRun(goalId, id)! };
}
/** A merge operation of SHIPPED in `status`, its id returned. */
function openOp(fx: Fixture, goalId: string, status: 'intended' | 'issued' | 'running' | 'UNKNOWN', key: string): string {
  const op = fx.ops.recordIntent({ kind: 'merge', goalId, cardId: SHIPPED, target: 'main', candidateDigest: `dg-${key}`, ownerGeneration: 0, timeoutMs: 60_000, effects: ['merge'] }, T0);
  if (status === 'intended') return op.id;
  fx.ops.markIssued(op.id, undefined, T0);
  if (status === 'running') fx.ops.markRunning(op.id, T0);
  if (status === 'UNKNOWN') fx.ops.markResult(op.id, 'UNKNOWN', {}, T0);
  return op.id;
}
/** Another session claims the card lease of SHIPPED. */
function foreignLease(fx: Fixture): void {
  setActorForTests(actorB);
  try {
    fx.leases.claim(resourceKeys.card(fx.repo.key, SHIPPED), { operation: 'card:T0-SHIPPED:build', now: T0 });
  } finally {
    setActorForTests(actorA);
  }
}
const adopt = (fx: Fixture, goalId: string, id: string, exec: SyncRunner = probes(id), config: Record<string, unknown> = {}) => runnerWith(fx, exec, config).adoptMerge(fx.goal(goalId), fx.card(id), fx.store.getCardRun(goalId, id)!, PR);
const adopted = (fx: Fixture, goalId: string) => fx.events(goalId).filter((e) => e.type === 'MERGE_ADOPTED');

test('T0-ADOPT-EXTERNAL-MERGE acceptance 1: issue 358 - a goal in CLOSE reaches DONE after each card merged outside the loop is adopted [R3] [R5] [R6]', () => {
  const { fx, goalId, run } = setup();
  try {
    assert.equal(fx.controller.next(goalId).kind, 'verify-arc');
    fx.controller.report({ goalId, generation: 0, result: 'arc-verified', data: { evidence: 'registry merged' } });
    const close = fx.controller.next(goalId);
    assert.equal(close.kind, 'close');
    for (const id of [STOPPED, SHIPPED]) assert.ok((close as { missing: string[] }).missing.includes(`${id}: merge not verified`), JSON.stringify(close));
    assert.throws(() => runnerWith(fx, probes(STOPPED)).markClosure(fx.goal(goalId), fx.card(STOPPED), run(STOPPED), { metadata: true }), /without a verified merge/);
    for (const id of [STOPPED, SHIPPED]) {
      const exec = probes(id);
      const after = adopt(fx, goalId, id, exec);
      assert.equal(after.state, 'CLOSE');
      assert.equal(after.mergeVerified, true);
      assert.equal(after.stop, undefined);
      assert.deepEqual(after.pr, { number: PR, state: 'MERGED', headRefOid: HEAD, baseRefName: 'main', mergeCommit: MERGE, mergedAt: MERGED_AT, url: `https://github.com/o/r/pull/${PR}` });
      const runner = runnerWith(fx, exec);
      let r = runner.next(fx.goal(goalId), fx.card(id), run(id));
      assert.equal(r.directive.kind, 'close', r.directive.narration);
      const closed = runner.markClosure(fx.goal(goalId), fx.card(id), r.run, { metadata: true, docSync: true, findings: true, evidence: true, cleanup: true, lessons: true }, { skipped: 'fixture: no rule learned' });
      r = runner.next(fx.goal(goalId), fx.card(id), closed);
      assert.equal(r.directive.kind, 'done', r.directive.narration);
    }
    assert.equal(fx.controller.next(goalId).kind, 'done');
  } finally {
    fx.cleanup();
  }
});

test('T0-ADOPT-EXTERNAL-MERGE acceptance 2: every refusal of adopt-merge leaves the run and the journal as they were [R2] [R3]', () => {
  type Row = { name: string; card?: string; noBranch?: boolean; mutatesRun?: boolean; exec?: (fx: Fixture, goalId: string) => SyncRunner; config?: Record<string, unknown>; arrange?: (fx: Fixture, goalId: string) => string[] | void; message: RegExp };
  /** The run as the concurrent writer of the merge-verified row left it. */
  let meanwhile: string | undefined;
  const oids = [['short', 'a'.repeat(39)], ['long', 'a'.repeat(41)], ['non-hex', `g${'a'.repeat(39)}`], ['uppercase', 'A'.repeat(40)]] as const;
  const rows: Row[] = [
    ...(['intended', 'issued', 'running', 'UNKNOWN'] as const).map((status): Row => ({ name: `(c) an ${status} operation`, arrange: (fx, goalId) => [openOp(fx, goalId, status, status)], message: /unresolved operation op-.*aidlc ops reconcile/ })),
    { name: '(c) two operations', arrange: (fx, goalId) => [openOp(fx, goalId, 'issued', 'one'), openOp(fx, goalId, 'UNKNOWN', 'two')], message: /unresolved operation op-.*, op-.*aidlc ops reconcile/ },
    { name: "(c) an operation of the card under another goal", arrange: (fx) => [openOp(fx, 'g-20260910000000-000000', 'running', 'other-goal')], message: /unresolved operation op-.*aidlc ops reconcile/ },
    ...oids.map(([kind, value]): Row => ({ name: `(h) a ${kind} head`, exec: () => probes(SHIPPED, { view: { headRefOid: value } }), message: new RegExp(`PR #41: gh reports head "${value}"`) })),
    ...oids.map(([kind, value]): Row => ({ name: `(h) a ${kind} merge commit`, exec: () => probes(SHIPPED, { view: { mergeCommit: { oid: value } } }), message: new RegExp(`PR #41: gh reports merge commit "${value}"`) })),
    { name: 'R3 a lease claimed while gh and git are asked', exec: (fx) => probes(SHIPPED, { during: () => foreignLease(fx) }), message: /card lease is held by session win-B/ },
    { name: 'R3 an operation recorded while gh and git are asked', exec: (fx, goalId) => probes(SHIPPED, { during: () => void openOp(fx, goalId, 'issued', 'late') }), message: /unresolved operation op-/ },
    // A ship admitted meanwhile has only its intent recorded; it issues later outside both locks.
    { name: 'R3 a ship intent recorded while gh and git are asked', exec: (fx, goalId) => probes(SHIPPED, { during: () => void openOp(fx, goalId, 'intended', 'intent') }), message: /unresolved operation op-/ },
    { name: '(a) a card outside the goal', card: 'T0-OUTSIDE', arrange: (fx, goalId) => void fx.store.saveCardRun({ ...fx.store.getCardRun(goalId, SHIPPED)!, cardId: 'T0-OUTSIDE', revision: 0 }), message: /T0-OUTSIDE is not listed in goal/ },
    // gh fails here, so only a refusal made before gh is asked names the verified merge.
    { name: '(b) a merge already verified', exec: () => probes(SHIPPED, { listFails: true }), arrange: (fx, goalId) => void fx.store.saveCardRun({ ...fx.store.getCardRun(goalId, SHIPPED)!, mergeVerified: true }), message: /merge is already verified/ },
    { name: '(d) a live card lease of another session', arrange: (fx) => foreignLease(fx), message: /card lease is held by session win-B/ },
    { name: '(e) no repository', config: { repository: undefined }, message: /no repository is configured/ },
    // The card parser defaults `branch` to the id, so an empty branch reaches the method only as its argument.
    { name: '(f) no branch', noBranch: true, arrange: (fx, goalId) => void fx.store.saveCardRun({ ...fx.store.getCardRun(goalId, SHIPPED)!, branch: undefined }), message: /names no branch/ },
    { name: '(g) gh pr list fails', exec: () => probes(SHIPPED, { listFails: true }), message: /PR #41.*gh/ },
    { name: '(g) the PR is not of the branch', exec: () => probes(SHIPPED, { list: [{ number: 40, state: 'MERGED', headRefOid: HEAD, baseRefName: 'main', url: '' }] }), message: /PR #41 is not a PR of branch T0-SHIPPED into main/ },
    { name: '(h) gh pr view fails', exec: () => probes(SHIPPED, { viewFails: true }), message: /PR #41.*gh/ },
    { name: '(h) another number', exec: () => probes(SHIPPED, { view: { number: 42 } }), message: /PR #41.*number/ },
    { name: '(h) open', exec: () => probes(SHIPPED, { view: { state: 'OPEN' } }), message: /PR #41 is OPEN, not MERGED/ },
    { name: '(h) another base', exec: () => probes(SHIPPED, { view: { baseRefName: 'develop' } }), message: /PR #41.*base develop/ },
    { name: '(h) no merge commit', exec: () => probes(SHIPPED, { view: { mergeCommit: null } }), message: /PR #41: gh reports merge commit null/ },
    { name: '(i) the fetch fails', exec: () => probes(SHIPPED, { fetchExit: 1 }), message: /PR #41.*fetch/ },
    { name: '(i) the merge commit is not on the base', exec: () => probes(SHIPPED, { containsExit: 1 }), message: /PR #41.*not on origin\/main/ },
    { name: '(i) no tree', exec: () => probes(SHIPPED, { noTree: true }), message: /PR #41.*tree/ },
    // A section another writer holds: the write waits on the card lease's lock and gives up, so it is made inside that section.
    { name: 'R3 the card lease section is held', arrange: (fx) => void writeFileSync(`${fx.leases.file(resourceKeys.card(fx.repo.key, SHIPPED))}.lock`, `pid=${process.pid} at=${T0} nonce=test`), message: /LOCKED: locked by another writer.*leases/ },
    { name: 'R3 a merge verified while gh and git are asked', mutatesRun: true, exec: (fx, goalId) => probes(SHIPPED, { during: () => void (meanwhile = JSON.stringify(fx.store.saveCardRun({ ...fx.store.getCardRun(goalId, SHIPPED)!, mergeVerified: true }))) }), message: /merge is already verified/ },
  ];
  for (const row of rows) {
    const { fx, goalId } = setup();
    try {
      const ids = row.arrange?.(fx, goalId) ?? [];
      const id = row.card ?? SHIPPED;
      if (row.card) writeCard(fx, { id: row.card, title: 'outside the goal' });
      const before = JSON.stringify(fx.store.getCardRun(goalId, id));
      const events = fx.events(goalId).length;
      const exec = row.exec?.(fx, goalId) ?? probes(id);
      const call = row.noBranch ? () => runnerWith(fx, exec).adoptMerge(fx.goal(goalId), { ...fx.card(id), branch: '' }, fx.store.getCardRun(goalId, id)!, PR) : () => adopt(fx, goalId, id, exec, row.config);
      let thrown: Error | undefined;
      assert.throws(call, (e: unknown) => ((thrown = e as Error), true), row.name);
      assert.match(thrown!.message, row.message, row.name);
      for (const op of ids) assert.ok(thrown!.message.includes(op), `${row.name}: names ${op}`);
      // A row whose concurrent writer changed the run compares with the record as that writer left it.
      assert.equal(JSON.stringify(fx.store.getCardRun(goalId, id)), row.mutatesRun ? meanwhile : before, `${row.name}: the adoption wrote nothing`);
      assert.equal(fx.events(goalId).length, events, `${row.name}: the journal is unchanged`);
    } finally {
      setActorForTests(actorA);
      fx.cleanup();
    }
  }
});

test('T0-ADOPT-EXTERNAL-MERGE acceptance 3: the MERGE_ADOPTED event carries the merge facts and what it superseded [R3] [R4] [R6] [R7]', () => {
  const { fx, goalId, run } = setup();
  try {
    const kept = (r: CardRun) => ({ closure: r.closure, review: r.review, preReview: r.preReview, findings: r.findings, effort: r.effort, candidate: r.candidate, dodReceipt: r.dodReceipt, redReceipt: r.redReceipt, ownerGeneration: r.ownerGeneration, evidence: r.evidence });
    const stoppedBefore = run(STOPPED);
    const stopped = adopt(fx, goalId, STOPPED);
    assert.deepEqual(kept(stopped), kept(stoppedBefore));
    const shipped = adopt(fx, goalId, SHIPPED);
    const [first, second] = adopted(fx, goalId);
    assert.equal(first!.cardId, STOPPED);
    assert.equal(first!.generation, 0);
    const { eventKey, ...data } = first!.data;
    assert.equal(typeof eventKey, 'string');
    assert.deepEqual(data, { pr: PR, headSha: HEAD, mergeSha: MERGE, tree: TREE, branch: STOPPED, base: 'main', candidateSha: OTHER, headMatchesCandidate: false, priorState: 'STOP', priorStop: 'tool' });
    assert.equal(second!.data['headMatchesCandidate'], true, 'the SHIP run whose candidate is the head');
    assert.equal(second!.data['priorStop'], null);
    assert.equal(shipped.journalOwed?.some((o) => o.type === 'MERGE_ADOPTED') ?? false, true, 'the event is owed in the write');
    const bare = setup();
    try {
      bare.fx.store.saveCardRun({ ...bare.run(SHIPPED), candidate: undefined });
      adopt(bare.fx, bare.goalId, SHIPPED);
      const [event] = adopted(bare.fx, bare.goalId);
      assert.equal(event!.data['candidateSha'], null);
      assert.equal(event!.data['headMatchesCandidate'], false);
    } finally {
      bare.fx.cleanup();
    }
    // Every field R3 keeps, seeded away from its default, and a blocker R3 removes.
    const seeded = setup();
    try {
      const base = seeded.run(SHIPPED);
      const effort = { taskId: SHIPPED, role: 'implementer', baseline: 'medium', ladder: ['medium', 'high'], attempts: [{ n: 1, effort: 'medium', startedAt: T0, finishedAt: T0, outcome: 'success', progress: true, checksGained: ['dod'] }], terminal: 'succeeded' };
      const finding = { id: 'F1', stage: 'formal', round: 1, reason: '[spec] a reason', raisedAt: T0, disposition: 'disputed', disputes: [{ at: T0, note: 'answered' }] };
      seeded.fx.store.saveCardRun(CardRun.parse({ ...base, blocker: 'a blocker', closure: { ...base.closure, docSync: true, findings: true }, review: { ...base.review, substantiveDecisions: 1, substantiveBlocks: 1, scriptCounter: 2, noVerdictRetriesUsed: 1 }, preReview: { ...base.preReview, handoffs: [{ cycle: 1, candidateDigest: 'dg-shipped', at: T0 }] }, findings: [finding], effort, dodReceipt: 'dod: exit 0', redReceipt: 'red:1', ownerGeneration: 3, evidence: [{ id: 'e1', kind: 'dod-receipt', createdAt: T0 }] }));
      const before = seeded.run(SHIPPED);
      assert.equal(before.blocker, 'a blocker');
      const after = adopt(seeded.fx, seeded.goalId, SHIPPED);
      assert.deepEqual(kept(after), kept(before));
      assert.equal(after.blocker, undefined);
    } finally {
      seeded.fx.cleanup();
    }
  } finally {
    fx.cleanup();
  }
});

test('T0-ADOPT-EXTERNAL-MERGE acceptance 4: a failed run write changes nothing, and a lost append is delivered once by card next [R3]', () => {
  const { fx, goalId, run } = setup();
  try {
    const before = JSON.stringify(run(SHIPPED));
    const events = fx.events(goalId).length;
    failingRecord = SHIPPED;
    try {
      assert.throws(() => adopt(fx, goalId, SHIPPED), /EIO/);
    } finally {
      failingRecord = undefined;
    }
    assert.equal(JSON.stringify(run(SHIPPED)), before);
    assert.equal(fx.events(goalId).length, events);
    assert.equal(adopt(fx, goalId, SHIPPED).state, 'CLOSE', 'a second call succeeds');

    failingEvent = 'MERGE_ADOPTED';
    try {
      assert.throws(() => adopt(fx, goalId, STOPPED), /EIO/);
    } finally {
      failingEvent = undefined;
    }
    const owed = run(STOPPED).journalOwed?.find((o) => o.type === 'MERGE_ADOPTED');
    assert.equal(run(STOPPED).state, 'CLOSE');
    assert.ok(owed, 'the event stays owed');
    runnerWith(fx, probes(STOPPED)).next(fx.goal(goalId), fx.card(STOPPED), run(STOPPED));
    const delivered = adopted(fx, goalId).filter((e) => e.cardId === STOPPED);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0]!.data['eventKey'], owed.data['eventKey']);
  } finally {
    failingRecord = undefined;
    failingEvent = undefined;
    fx.cleanup();
  }
});

test('T0-ADOPT-EXTERNAL-MERGE acceptance 5: the CLI refuses an adoption it cannot start, and reports one it made [R1]', () => {
  const fx = makeFixture({ config: { repository: 'o/r' } });
  try {
    writeCard(fx, { id: SHIPPED, title: 'shipped outside the loop' });
    const goalId = goalForCards(fx, [SHIPPED]).id;
    const cli = (...args: string[]) => spawnSync(process.execPath, [BIN, ...args], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-A' }, encoding: 'utf8', timeout: 60_000 });
    const runs = () => fx.store.listCardRuns(goalId).length;
    const before = { events: fx.events(goalId).length, runs: runs() };
    const noRun = cli('card', 'adopt-merge', SHIPPED, '--pr', '7', '--goal', goalId);
    assert.equal(noRun.status, 1, noRun.stderr);
    assert.match(noRun.stderr, /aidlc card next T0-SHIPPED --goal g-/);
    for (const pr of ['0', 'x']) {
      const bad = cli('card', 'adopt-merge', SHIPPED, '--pr', pr, '--goal', goalId);
      assert.equal(bad.status, 1, `--pr ${pr}: ${bad.stderr}`);
      assert.match(bad.stderr, /--pr/);
    }
    assert.deepEqual({ events: fx.events(goalId).length, runs: runs() }, before);
    const pr = { number: PR, state: 'MERGED' as const, headRefOid: HEAD, baseRefName: 'main', mergeCommit: MERGE };
    const report = adoptMergeReport(SHIPPED, goalId, { ...fx.controller.ensureCardRun(fx.goal(goalId), SHIPPED), state: 'CLOSE', mergeVerified: true, pr });
    const next = `aidlc card next ${SHIPPED} --goal ${goalId}`;
    assert.deepEqual(report.json, { state: 'CLOSE', mergeVerified: true, pr, next });
    for (const part of ['state=CLOSE', 'mergeVerified=true', `PR #${PR}`, MERGE, next]) assert.ok(report.text.includes(part), `the text names ${part}: ${report.text}`);
  } finally {
    fx.cleanup();
  }
});

test("T0-ADOPT-EXTERNAL-MERGE acceptance 8: the run's branch wins, and an absent or empty run branch falls back to the card's [R2]", () => {
  for (const [label, runBranch, asked] of [['a run branch that differs', 'feature/other', 'feature/other'], ['no run branch', undefined, SHIPPED], ['an empty run branch', '', SHIPPED]] as const) {
    const { fx, goalId, run } = setup();
    try {
      fx.store.saveCardRun({ ...run(SHIPPED), branch: runBranch });
      adopt(fx, goalId, SHIPPED, probes(asked));
      assert.equal(adopted(fx, goalId)[0]!.data['branch'], asked, label);
    } finally {
      fx.cleanup();
    }
  }
});

test('T0-ADOPT-EXTERNAL-MERGE acceptance 9: an adopted remote scaffold card under an advisory gate selects CLOSE [R9]', () => {
  const { fx, goalId, run } = setup();
  try {
    const config = { shipPath: 'scaffold', gateRequired: false };
    const before = runnerWith(fx, probes(SHIPPED), config).next(fx.goal(goalId), fx.card(SHIPPED), run(SHIPPED));
    assert.equal(before.directive.kind, 'stop', before.directive.narration);
    assert.match(before.directive.narration, /blocking independent review path/);
    runnerWith(fx, probes(SHIPPED), config).adoptMerge(fx.goal(goalId), fx.card(SHIPPED), run(SHIPPED), PR);
    const after = runnerWith(fx, probes(SHIPPED), config).next(fx.goal(goalId), fx.card(SHIPPED), run(SHIPPED));
    assert.equal(after.directive.kind, 'close', after.directive.narration);
  } finally {
    fx.cleanup();
  }
});

test('T0-ADOPT-EXTERNAL-MERGE acceptance 10: a ship whose gates passed before an adoption dispatches nothing [R10]', () => {
  const fx = makeFixture({ config: { repository: 'o/r' } });
  try {
    writeCard(fx, { id: SHIPPED, title: 'shipped outside the loop' });
    const goalId = goalForCards(fx, [SHIPPED]).id;
    const shipPath = new DryRunShipPath(['merged']);
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, now: fx.now, runner: probes(SHIPPED), shipPath });
    let r = runner.next(fx.goal(goalId), fx.card(SHIPPED), fx.controller.ensureCardRun(fx.goal(goalId), SHIPPED));
    r = runner.next(fx.goal(goalId), fx.card(SHIPPED), r.run);
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    const built = runner.recordAttempt(fx.goal(goalId), fx.card(SHIPPED), r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: HEAD });
    // The real adoption runs when this `card next` first opens the card lease's lock: the run is read, no intent is recorded.
    const lockFile = `${fx.leases.file(resourceKeys.card(fx.repo.key, SHIPPED))}.lock`;
    const realOpen = fs.openSync;
    let pending = true;
    (fs as unknown as Record<string, unknown>)['openSync'] = (...args: Parameters<typeof fs.openSync>) => {
      if (pending && String(args[0]) === lockFile) {
        pending = false;
        adopt(fx, goalId, SHIPPED);
      }
      return realOpen(...args);
    };
    syncBuiltinESMExports();
    let out: ReturnType<CardRunner['next']>;
    try {
      out = runner.next(fx.goal(goalId), fx.card(SHIPPED), built);
    } finally {
      fs.openSync = realOpen;
      syncBuiltinESMExports();
    }
    assert.equal(pending, false, 'the adoption ran inside the card next');
    assert.equal(out.directive.kind, 'wait', out.directive.narration);
    assert.equal((out.directive as { on?: string }).on, 'record-changed');
    assert.equal(shipPath.requests.length, 0, 'the ship path received no request');
    assert.deepEqual(fx.ops.list({ goalId, cardId: SHIPPED, kind: 'merge' }).map((o) => o.status), ['cancelled']);
    const stored = fx.store.getCardRun(goalId, SHIPPED)!;
    assert.equal(stored.state, 'CLOSE');
    assert.equal(stored.mergeVerified, true);
  } finally {
    fx.cleanup();
  }
});
