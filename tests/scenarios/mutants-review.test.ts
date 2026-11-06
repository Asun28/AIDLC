// Card T1-VERIFY-MUTANTS-PROMPT: the R3 prompt lists the survivors of the candidate's report, the report never gates, and an attempt refuses while a marker exists.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { MUTATION_OPERATORS, MutantReport, type CardRun, type MutantResult } from '../../src/core/types.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { mutantsMarkerPath, mutantsReportPath } from '../../src/review/mutants.ts';
import { T0, makeFixture, writeCard, type Fixture } from './_harness.ts';

const CARD = 'T1-MUT';
const SHA = 'sha-t1-mut';
const FILE = `src/${CARD.toLowerCase()}.ts`;
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const ROOT = path.resolve(import.meta.dirname, '..', '..');

const mutant = (line: number, outcome: MutantResult['outcome'], original: string, mutated: string): MutantResult => ({ file: FILE, line, column: 3, operator: 'boundary', original, mutated, outcome, exitCode: outcome === 'survived' ? 0 : 1, durationMs: 5 });
const SURVIVED = mutant(4, 'survived', '<', '<=');
const SURVIVED_EMPTY = { ...mutant(9, 'survived', 'record(a);', ''), operator: 'drop-statement' as const };
const KILLED = mutant(6, 'killed', '>', '>=');
const LINE_ONE = `- ${JSON.stringify(`${FILE}:4:3 boundary: < -> <=`)}`;
const LINE_TWO = `- ${JSON.stringify(`${FILE}:9:3 drop-statement: record(a); -> (nothing)`)}`;

function reportText(candidateSha: string): string {
  return JSON.stringify(MutantReport.parse({ schemaVersion: 1, cardId: CARD, candidateSha, base: 'main', dodCommand: 'node --test', operators: [...MUTATION_OPERATORS], max: 30, timeoutMs: 120000, baselineDurationMs: 7, generated: 3, skipped: 0, totals: { killed: 1, survived: 2, timeout: 0 }, startedAt: T0, finishedAt: T0, mutants: [SURVIVED, KILLED, SURVIVED_EMPTY] }));
}

interface Setup {
  fx: Fixture;
  runner: CardRunner;
  ship: DryRunShipPath;
  goalId: string;
  prompts: string[];
  report: string;
  marker: string;
}

function setup(): Setup {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2', '{instructions}'], reviewer: 'fake-r2', rounds: 1, timeoutMs: 1000, onExhausted: 'ship', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  writeFileSync(path.join(fx.repo.mainRoot, 'REVIEW.md'), '# Review instructions\n', 'utf8');
  const prompts: string[] = [];
  const script = scriptedRunner({
    'git diff --name-only': { stdout: `${FILE}\u0000` },
    'git diff': { stdout: `diff --git a/${FILE} b/${FILE}\n+export const x = 1;\n` },
    'fake-r2': () => ({ stdout: PASS }),
    'fake-r3': (args) => {
      prompts.push(args[0] ?? '');
      return { stdout: PASS };
    },
  });
  const ship = new DryRunShipPath(['merged']);
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
  writeCard(fx, { id: CARD, title: 'a card with a mutant report' });
  const goal = fx.controller.createGoal({ text: `implement ${CARD}`, source: 'card', ref: CARD, affectedSurfaces: [] }, { cards: [CARD] });
  fx.controller.next(goal.id);
  fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: [CARD] } });
  return { fx, runner, ship, goalId: goal.id, prompts, report: mutantsReportPath(fx.repo.mainRoot, CARD), marker: mutantsMarkerPath(fx.repo.mainRoot, CARD) };
}

function withSetup(body: (s: Setup) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const s = setup();
    try {
      await body(s);
    } finally {
      s.fx.cleanup();
    }
  };
}

function writeReport(s: Setup, text: string): void {
  mkdirSync(path.dirname(s.report), { recursive: true });
  writeFileSync(s.report, text);
}

/** Drives the card to its first R3 decision, passed by the scripted reviewer, and returns the section of that prompt with the run. */
async function firstDecision(s: Setup): Promise<{ section: string; run: CardRun }> {
  const { fx, runner, goalId } = s;
  const g = () => fx.goal(goalId);
  const card = fx.card(CARD);
  let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
  const attempted = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod', redReceipt: 'red', candidateSha: SHA });
  r = runner.next(g(), card, attempted);
  assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
  const round = await runner.preReview(g(), card, r.run);
  r = runner.next(g(), card, round.run);
  assert.equal(r.directive.kind, 'review', r.directive.narration);
  const decided = await runner.formalReview(g(), card, r.run);
  assert.equal(decided.classified.outcome, 'pass');
  assert.equal(decided.run.review.substantiveDecisions, 1, 'the decision is recorded');
  const prompt = s.prompts.at(-1)!;
  const start = prompt.indexOf('## Surviving mutants');
  assert.ok(start >= 0, 'the formal prompt has the section');
  return { section: prompt.slice(start, prompt.indexOf('## Candidate')), run: decided.run };
}

const entriesOf = (section: string): string[] => section.trimEnd().split('\n').slice(2);

/** A card with this report ships through the dry run and reaches CLOSE with the merge verified. */
function assertShips(s: Setup, run: CardRun): void {
  const r = s.runner.next(s.fx.goal(s.goalId), s.fx.card(CARD), run);
  assert.equal(r.directive.kind, 'close', r.directive.narration);
  assert.equal(r.run.mergeVerified, true);
  assert.equal(s.ship.requests.length, 1);
}

describe('the survivors of the candidate reach the R3 prompt (card T1-VERIFY-MUTANTS-PROMPT)', () => {
  test('acceptance 3: a report for the pinned candidate puts exactly its two survivors in the formal prompt [R1] [R2]', withSetup(async (s) => {
    writeReport(s, reportText(SHA));
    const { section } = await firstDecision(s);
    assert.deepEqual(entriesOf(section), [LINE_ONE, LINE_TWO]);
  }));

  test('acceptance 3: a report for another candidate puts - none there and the decision is recorded [R1] [R2]', withSetup(async (s) => {
    writeReport(s, reportText('sha-other'));
    const { section } = await firstDecision(s);
    assert.deepEqual(entriesOf(section), ['- none']);
  }));

  test('acceptance 3: a file that does not parse, as JSON and as a report, puts - none there [R1] [R2]', async () => {
    for (const text of ['{ not json', JSON.stringify({ cardId: CARD, candidateSha: SHA, mutants: [SURVIVED] })]) {
      await withSetup(async (s) => {
        writeReport(s, text);
        const { section } = await firstDecision(s);
        assert.deepEqual(entriesOf(section), ['- none'], text);
      })();
    }
  });

  test('acceptance 3: a report reached through a linked .review puts - none there [R1]', withSetup(async (s) => {
    const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-mutants-outside-')));
    try {
      writeFileSync(path.join(dir, `${CARD}.mutants.json`), reportText(SHA));
      symlinkSync(dir, path.dirname(s.report), 'junction');
      const { section } = await firstDecision(s);
      assert.deepEqual(entriesOf(section), ['- none']);
    } finally {
      rmSync(path.dirname(s.report), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  }));

  test('acceptance 3: a report with a second hard link puts - none there [R1]', withSetup(async (s) => {
    const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-mutants-outside-')));
    try {
      const outside = path.join(dir, 'report.json');
      writeFileSync(outside, reportText(SHA));
      mkdirSync(path.dirname(s.report), { recursive: true });
      linkSync(outside, s.report);
      const { section } = await firstDecision(s);
      assert.deepEqual(entriesOf(section), ['- none']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }));

  test('acceptance 3: a report written during the review never changes what that reviewer receives, since it is read before the dispatch [R1]', withSetup(async (s) => {
    const { fx, runner, goalId } = s;
    const g = () => fx.goal(goalId);
    const card = fx.card(CARD);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
    const attempted = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod', redReceipt: 'red', candidateSha: SHA });
    r = runner.next(g(), card, attempted);
    const round = await runner.preReview(g(), card, r.run);
    r = runner.next(g(), card, round.run);
    const reviews = fx.queue;
    let written = false;
    const enqueue = reviews.enqueue.bind(reviews);
    reviews.enqueue = ((...args: Parameters<typeof enqueue>) => {
      writeReport(s, reportText(SHA));
      written = true;
      return enqueue(...args);
    }) as typeof enqueue;
    await runner.formalReview(g(), card, r.run);
    assert.ok(written, 'the fixture wrote the report at the first mutation');
    const prompt = s.prompts.at(-1)!;
    assert.deepEqual(entriesOf(prompt.slice(prompt.indexOf('## Surviving mutants'), prompt.indexOf('## Candidate'))), ['- none']);
  }));
});

describe('the report never gates (card T1-VERIFY-MUTANTS-PROMPT)', () => {
  test('acceptance 4: a card with no mutant report passes R2 and R3 and reaches CLOSE with the merge verified [R5]', withSetup(async (s) => {
    assert.equal(existsSync(s.report), false);
    const { run } = await firstDecision(s);
    assertShips(s, run);
  }));

  test('acceptance 4: a card whose current report lists survivors passes R2 and R3 and reaches CLOSE with the merge verified [R5]', withSetup(async (s) => {
    writeReport(s, reportText(SHA));
    const { run, section } = await firstDecision(s);
    assert.equal(entriesOf(section).length, 2, 'the survivors reached the reviewer');
    assertShips(s, run);
  }));
});

describe('card attempt refuses while a marker exists (card T1-VERIFY-MUTANTS-PROMPT)', () => {
  const OUTCOMES = [
    { outcome: 'success', dodReceipt: 'dod', redReceipt: 'red', candidateSha: SHA },
    { outcome: 'fail', cause: 'the test failed' },
    { outcome: 'not-counted', notCountedReason: 'expected-red' },
  ] as const;

  /** Every outcome refuses naming the marker and --restore, with the stored run and the journal unchanged. */
  function assertRefused(s: Setup, marker: string): void {
    const { fx, runner, goalId } = s;
    const card = fx.card(CARD);
    const run = runner.next(fx.goal(goalId), card, fx.controller.ensureCardRun(fx.goal(goalId), CARD)).run;
    const saved = fx.store.getCardRun(goalId, CARD);
    const events = fx.events(goalId);
    for (const attempt of OUTCOMES) {
      assert.throws(() => runner.recordAttempt(fx.goal(goalId), card, run, attempt), (err: Error) => {
        assert.ok(err.message.includes(marker), err.message);
        assert.ok(err.message.includes(`aidlc card mutants ${CARD} --restore`), err.message);
        return true;
      }, attempt.outcome);
      assert.deepEqual(fx.store.getCardRun(goalId, CARD), saved, `${attempt.outcome}: the run is unchanged`);
      assert.deepEqual(fx.events(goalId), events, `${attempt.outcome}: the journal gains no event`);
    }
  }

  test('acceptance 5: with a marker under the review checkout every outcome refuses, and once it is removed the same success is recorded [R6]', withSetup((s) => {
    mkdirSync(path.dirname(s.marker), { recursive: true });
    writeFileSync(s.marker, '{}');
    assertRefused(s, s.marker);
    rmSync(s.marker);
    const { fx, runner, goalId } = s;
    const run = runner.recordAttempt(fx.goal(goalId), fx.card(CARD), fx.store.getCardRun(goalId, CARD)!, OUTCOMES[0]);
    assert.equal(run.dodReceipt, 'dod');
    assert.equal(run.candidate?.sha, SHA);
  }));

  test('acceptance 5: the marker is read under the run\'s worktree when it has one, not under the main checkout [R6]', withSetup((s) => {
    const worktree = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-mutants-wt-')));
    try {
      const { fx, runner, goalId } = s;
      const card = fx.card(CARD);
      const run = runner.next(fx.goal(goalId), card, fx.controller.ensureCardRun(fx.goal(goalId), CARD)).run;
      fx.store.saveCardRun({ ...run, worktree });
      const marker = mutantsMarkerPath(worktree, CARD);
      mkdirSync(path.dirname(marker), { recursive: true });
      writeFileSync(marker, '{}');
      assertRefused(s, marker);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  }));

  test('acceptance 5: a dangling link at the marker path refuses too, since only whether something is there is read [R6]', withSetup((s) => {
    const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-mutants-gone-')));
    mkdirSync(path.dirname(s.marker), { recursive: true });
    symlinkSync(dir, s.marker, 'junction');
    renameSync(dir, `${dir}-moved`);
    try {
      assertRefused(s, s.marker);
    } finally {
      rmSync(s.marker, { recursive: true, force: true });
      rmSync(`${dir}-moved`, { recursive: true, force: true });
    }
  }));
});

describe('the docs of card T1-VERIFY-MUTANTS-PROMPT', () => {
  const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

  test('acceptance 7: the Mutant sweep section has the two sentences, ARCHITECTURE names the survivors among the formal prompt inputs and the CHANGELOG has the entry [R7]', () => {
    const ops = read('docs/OPERATIONS.md');
    const start = ops.indexOf('### Mutant sweep');
    const section = ops.slice(start, ops.indexOf('\n### ', start + 1));
    for (const text of [
      'The formal review (R3) prompt lists the surviving mutants of a report whose candidate is the candidate under review under `## Surviving mutants`, as advisory evidence that never blocks by itself.',
      '`aidlc card attempt` refuses while `.review/<card>.mutants.pending.json` exists: finish the sweep or run `aidlc card mutants <card> --restore` first.',
    ]) assert.ok(section.includes(text), `the Mutant sweep section states: ${text}`);
    const arch = read('docs/ARCHITECTURE.md');
    assert.ok(arch.includes("the surviving mutants of the current candidate's report"), 'ARCHITECTURE names the prompt input');
    const changelog = read('CHANGELOG.md');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
    assert.ok(unreleased.split('\n').some((line) => line.startsWith('- T1-VERIFY-MUTANTS-PROMPT:')), 'the CHANGELOG entry');
  });
});
