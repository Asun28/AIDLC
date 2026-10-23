// Card T1-REVIEW-RESPONSES: the kind of a dispute through CardRunner, the journal and the CLI.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, goalForCards } from './_harness.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRun } from '../../src/core/types.ts';

/** The CLI from the sources, never a compiled build that may be stale. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));

test('acceptance 3: CardRunner.disputeFinding stores the given kind, wrong when none is given, and FINDING_DISPUTED carries it as data.kind [R1] [R3]', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-r2', '{instructions}'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'ship', shell: false } } });
  try {
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-dk.ts\u0000' },
      'git diff': { stdout: 'diff --git a/src/t1-dk.ts b/src/t1-dk.ts\n+export const dk = 1;\n' },
      'fake-r2': () => ({ stdout: '{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-dk.ts:1: no RED -> add a failing test first","[standards] 9 naming @ src/t1-dk.ts:2: unclear name -> rename"]}\n' }),
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-DK', title: 'dispute kinds' });
    const goal = goalForCards(fx, ['T1-DK']);
    const card = fx.card('T1-DK');
    const g = () => fx.goal(goal.id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-DK'));
    const run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    const blocked = await runner.preReview(g(), card, r.run);
    assert.deepEqual(blocked.run.findings.map((f) => f.id), ['F1', 'F2'], 'the round blocked with two cited reasons');

    const one = runner.disputeFinding(g(), card, blocked.run, 'F1', 'a one-line rename the follow-up card owns', 'not-worth-fixing');
    assert.equal(one.findings.find((f) => f.id === 'F1')?.disputes.at(-1)?.kind, 'not-worth-fixing');
    const two = runner.disputeFinding(g(), card, one, 'F2', 'the name is the one the card fixes');
    assert.equal(two.findings.find((f) => f.id === 'F2')?.disputes.at(-1)?.kind, 'wrong');
    assert.equal(fx.store.getCardRun(goal.id, 'T1-DK')?.findings.find((f) => f.id === 'F1')?.disputes.at(-1)?.kind, 'not-worth-fixing', 'the stored run keeps the kind');

    const events = fx.events(goal.id).filter((e) => e.type === 'FINDING_DISPUTED');
    assert.deepEqual(events.map((e) => [e.data['finding'], e.data['kind']]), [['F1', 'not-worth-fixing'], ['F2', 'wrong']]);
  } finally {
    fx.cleanup();
  }
});

test('acceptance 4: the CLI refuses an unknown --kind before it writes anything, records --kind intentional, and review findings names the kind of the latest dispute, an absent kind as wrong [R1] [R2] [R5]', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-DK', title: 'dispute kinds' });
    const goal = goalForCards(fx, ['T1-DK']);
    const now = fx.now();
    fx.store.saveCardRun(
      CardRun.parse({
        goalId: goal.id,
        cardId: 'T1-DK',
        cardRevision: 0,
        goalGeneration: 0,
        state: 'BUILD',
        startedAt: now,
        deadline: '2026-12-31T00:00:00.000Z',
        updatedAt: now,
        findings: [
          { id: 'F1', stage: 'pre', cycle: 0, round: 1, reason: '[spec] 6 tests @ src/t1-dk.ts:1: no RED -> add one', raisedAt: now, disposition: 'open' },
          { id: 'F2', stage: 'pre', cycle: 0, round: 1, reason: '[standards] 9 naming @ src/t1-dk.ts:2: unclear -> rename', raisedAt: now, disposition: 'disputed', disputes: [{ at: now, note: 'the name is the one the card fixes', afterReraises: 0 }] },
        ],
      }),
    );
    const seed = fx.store.getCardRun(goal.id, 'T1-DK');
    const eventsBefore = fx.events(goal.id);
    // No session variable of the calling environment reaches the CLI: CI sets none.
    const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: fx.paths.root };
    delete env['CLAUDE_CODE_SESSION_ID'];
    delete env['AIDLC_SESSION'];
    const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, ...args], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 60_000, windowsHide: true });

    const refused = cli('review', 'dispute', 'T1-DK', 'F1', '--note', 'the test is tests/t1-dk.test.ts', '--kind', 'maybe', '--goal', goal.id);
    assert.notEqual(refused.status, 0, 'an unknown kind is refused');
    for (const kind of ['wrong', 'intentional', 'not-worth-fixing']) assert.ok(refused.stderr.includes(kind), `stderr names ${kind}: ${refused.stderr}`);
    assert.deepEqual(fx.store.getCardRun(goal.id, 'T1-DK'), seed, 'the stored run is unchanged');
    assert.deepEqual(fx.events(goal.id), eventsBefore, 'nothing is journaled');
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'FINDING_DISPUTED').length, 0);

    const recorded = cli('review', 'dispute', 'T1-DK', 'F1', '--note', 'the test is tests/t1-dk.test.ts', '--kind', 'intentional', '--goal', goal.id);
    assert.equal(recorded.status, 0, recorded.stderr);
    const payload = JSON.parse(recorded.stdout) as { finding: { disputes: Array<{ kind?: string }> } };
    assert.equal(payload.finding.disputes.at(-1)?.kind, 'intentional');

    const listed = cli('--no-json', 'review', 'findings', 'T1-DK', '--goal', goal.id);
    assert.equal(listed.status, 0, listed.stderr);
    const lines = listed.stdout.split(/\r?\n/);
    assert.match(lines.find((l) => l.startsWith('F1')) ?? '', /last note \(intentional\): the test is tests\/t1-dk\.test\.ts$/);
    assert.match(lines.find((l) => l.startsWith('F2')) ?? '', /last note \(wrong\): the name is the one the card fixes$/);
  } finally {
    fx.cleanup();
  }
});
