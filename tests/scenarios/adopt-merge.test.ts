// Card T0-ADOPT-EXTERNAL-MERGE (issue 358): a merge made outside a ship operation of the loop is verified from gh and git
// and adopted, so a goal whose arc-verified counted a card merged outside the loop reaches DONE.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs, { readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { makeStop } from '../../src/core/stop.ts';
import type { CardRun } from '../../src/core/types.ts';
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
  type Row = { name: string; card?: string; exec?: (fx: Fixture, goalId: string) => SyncRunner; config?: Record<string, unknown>; arrange?: (fx: Fixture, goalId: string) => void; message: RegExp };
  const rows: Row[] = [
    { name: '(a) a card outside the goal', card: 'T0-OUTSIDE', arrange: (fx, goalId) => fx.store.saveCardRun({ ...fx.store.getCardRun(goalId, SHIPPED)!, cardId: 'T0-OUTSIDE', revision: 0 }), message: /T0-OUTSIDE is not listed in goal/ },
    { name: '(b) a merge already verified', arrange: (fx, goalId) => fx.store.saveCardRun({ ...fx.store.getCardRun(goalId, SHIPPED)!, mergeVerified: true }), message: /merge is already verified/ },
    { name: '(c) an unresolved operation', arrange: (fx, goalId) => {
      const op = fx.ops.recordIntent({ kind: 'merge', goalId, cardId: SHIPPED, target: 'main', candidateDigest: 'dg-shipped', ownerGeneration: 0, timeoutMs: 60_000, effects: ['merge'] }, T0);
      fx.ops.markResult(op.id, 'UNKNOWN', {}, T0);
    }, message: /unresolved operation op-/ },
    { name: '(d) a live card lease of another session', arrange: (fx) => {
      setActorForTests(actorB);
      fx.leases.claim(resourceKeys.card(fx.repo.key, SHIPPED), { operation: 'card:T0-SHIPPED:build', now: T0 });
      setActorForTests(actorA);
    }, message: /card lease is held by session win-B/ },
    { name: '(e) no repository', config: { repository: undefined }, message: /no repository is configured/ },
    { name: '(f) no branch', arrange: (fx, goalId) => {
      fx.store.saveCardRun({ ...fx.store.getCardRun(goalId, SHIPPED)!, branch: undefined });
      const file = path.join(fx.cardsDir, `${SHIPPED}.md`);
      writeFileSync(file, readFileSync(file, 'utf8').replace(/^branch: .*\r?\n/m, ''), 'utf8');
    }, message: /names no branch/ },
    { name: '(g) gh pr list fails', exec: () => probes(SHIPPED, { listFails: true }), message: /PR #41.*gh/ },
    { name: '(g) the PR is not of the branch', exec: () => probes(SHIPPED, { list: [{ number: 40, state: 'MERGED', headRefOid: HEAD, baseRefName: 'main', url: '' }] }), message: /PR #41 is not a PR of branch T0-SHIPPED into main/ },
    { name: '(h) gh pr view fails', exec: () => probes(SHIPPED, { viewFails: true }), message: /PR #41.*gh/ },
    { name: '(h) another number', exec: () => probes(SHIPPED, { view: { number: 42 } }), message: /PR #41.*number/ },
    { name: '(h) open', exec: () => probes(SHIPPED, { view: { state: 'OPEN' } }), message: /PR #41 is OPEN, not MERGED/ },
    { name: '(h) another base', exec: () => probes(SHIPPED, { view: { baseRefName: 'develop' } }), message: /PR #41.*base develop/ },
    { name: '(h) a head that is no object id', exec: () => probes(SHIPPED, { view: { headRefOid: 'A'.repeat(40) } }), message: /PR #41.*head/ },
    { name: '(h) no merge commit', exec: () => probes(SHIPPED, { view: { mergeCommit: null } }), message: /PR #41.*merge commit/ },
    { name: '(i) the fetch fails', exec: () => probes(SHIPPED, { fetchExit: 1 }), message: /PR #41.*fetch/ },
    { name: '(i) the merge commit is not on the base', exec: () => probes(SHIPPED, { containsExit: 1 }), message: /PR #41.*not on origin\/main/ },
    { name: '(i) no tree', exec: () => probes(SHIPPED, { noTree: true }), message: /PR #41.*tree/ },
    { name: 'R3 the in-lock re-read', exec: (fx, goalId) => probes(SHIPPED, { during: () => fx.store.saveCardRun({ ...fx.store.getCardRun(goalId, SHIPPED)!, mergeVerified: true }) }), message: /merge is already verified/ },
  ];
  for (const row of rows) {
    const { fx, goalId } = setup();
    try {
      row.arrange?.(fx, goalId);
      const id = row.card ?? SHIPPED;
      if (row.card) writeCard(fx, { id: row.card, title: 'outside the goal' });
      const before = JSON.stringify(fx.store.getCardRun(goalId, id));
      const events = fx.events(goalId).length;
      assert.throws(() => adopt(fx, goalId, id, row.exec?.(fx, goalId) ?? probes(id), row.config), row.message, row.name);
      if (!row.name.startsWith('R3')) assert.equal(JSON.stringify(fx.store.getCardRun(goalId, id)), before, `${row.name}: the run is unchanged`);
      else assert.equal(fx.store.getCardRun(goalId, id)!.state, 'SHIP', `${row.name}: the adoption wrote nothing`);
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
    const kept = (r: CardRun) => ({ closure: r.closure, review: r.review, preReview: r.preReview, findings: r.findings, effort: r.effort, candidate: r.candidate, dodReceipt: r.dodReceipt, ownerGeneration: r.ownerGeneration, evidence: r.evidence });
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

test('T0-ADOPT-EXTERNAL-MERGE acceptance 5: the CLI refuses an adoption it cannot start [R1]', () => {
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
  } finally {
    fx.cleanup();
  }
});
