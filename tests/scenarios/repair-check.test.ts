import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { makeFixture, writeCard } from './_harness.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
// Card T1-FINDING-REPRO-2 R6: the formal REVIEW_FIX narrations end with this sentence.
import { REPRO_REQUEST } from '../../src/review/repro.ts';

/** The directive text, as the card words it. */
const REPAIR_CHECK = 'Before adding code, check whether removing the code the finding names fixes the defect at every site, and remove it if so. After the repair, read the repair hunks again for what they newly break: most later findings sit on or next to those lines. List in the attempt evidence each input form and failure path the repair hunks handle (for a parser, each kind of value it can be given; for I/O, each error it can raise), each with the test that covers it.';

/** Card T0-REPAIR-FORMS R3: the Repair check paragraph and the CHANGELOG entry, as exact text. */
const OPS_PARAGRAPH = `Repair check (card T0-REPAIR-CHECK, extended by card T0-REPAIR-FORMS). The \`build\` directive of a formal repair carries one more instruction, after the repair text and before the defect class list: \`${REPAIR_CHECK}\` It is directive text, so it reaches whoever makes the repair, the main thread or an implementer. It changes no effort level, attempt count or persisted record, no gate reads it, and the pre-review (R2) repair directive does not carry it. The last sentence (card T0-REPAIR-FORMS) rests on a count from the card runs on 2026-11-10: of the findings R3 raised at decision 2 or later, 40 of 61 since 2026-10-23 and 11 of 20 since 2026-11-07 were a new defect class in a file an earlier decision had flagged and not marked \`outsideDelta\`, so inside the changes since that decision. After 15 repaired cards, count again and remove that sentence if the share did not fall.`;
const CHANGELOG_ENTRY = '- T0-REPAIR-FORMS: the repair check of a formal repair\'s `build` directive ends with one more sentence, asking the repairer to list in the attempt evidence each input form and failure path the repair hunks handle, each with the test that covers it; on the records of 2026-11-10, 40 of 61 findings R3 raised at decision 2 or later since 2026-10-23 were a new defect class inside the changes since the previous decision. No gate reads the text.';

const CLASS_TEXT = " Defect classes of this block: journal-before-save (F1 at src/t0-rc.ts:3). Fix every site of each class inside the card's allow_paths, not only the cited lines; leave a site outside allow_paths unchanged and dispute a re-raise that cites one.";

/** Runs a card with no R2 panel, as this repository does, to its first R3 block and the REVIEW_FIX build directive after it. */
async function repairAfterBlock(reason: string) {
  const fx = makeFixture({ config: { gateRequired: true, formalReview: { command: ['fake-r3', '--schema', '{schema}', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  const script = scriptedRunner({
    'git diff --name-only': { stdout: 'src/t0-rc.ts\u0000' },
    'git diff': { stdout: 'diff --git a/src/t0-rc.ts b/src/t0-rc.ts\n+export const rc = 1;\n' },
    'fake-r3': () => ({ stdout: JSON.stringify({ verdict: 'block', reasons: [reason], axes: { spec: { verdict: 'block', reasons: [reason] }, standards: { verdict: 'pass', reasons: [] } } }) + '\n' }),
  });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
  writeCard(fx, { id: 'T0-RC', title: 'repair check', allowPaths: ['src/t0-rc.ts'] });
  const goal = fx.controller.createGoal({ text: 'implement T0-RC', source: 'card', ref: 'T0-RC', affectedSurfaces: [] }, { cards: ['T0-RC'] });
  fx.controller.next(goal.id);
  fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T0-RC'] } });
  const card = fx.card('T0-RC');
  const started = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T0-RC'));
  const built = runner.recordAttempt(fx.goal(goal.id), card, started.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
  const ready = runner.next(fx.goal(goal.id), card, built);
  assert.equal(ready.directive.kind, 'review', ready.directive.narration);
  const block = await runner.formalReview(fx.goal(goal.id), card, ready.run);
  assert.equal(block.classified.outcome, 'block-defect');
  const repair = runner.next(fx.goal(goal.id), card, block.run);
  assert.equal(repair.directive.kind, 'build', repair.directive.narration);
  if (repair.directive.kind !== 'build') throw new Error('unreachable');
  return { fx, goal, run: repair.run, directive: repair.directive };
}

test('T0-REPAIR-CHECK acceptance 1: after an R3 block the build directive starts with the repair text and carries the repair check once [R1]', async () => {
  const { fx, directive } = await repairAfterBlock('[spec] 6 tests missing @ src/t0-rc.ts:1: no RED -> add a failing test');
  try {
    assert.ok(directive.narration.startsWith('Review block to repair: '), directive.narration);
    assert.equal(directive.narration.split(REPAIR_CHECK).length, 2, directive.narration);
  } finally {
    fx.cleanup();
  }
});

test('T0-REPAIR-CHECK acceptance 1: the repair check follows the whole repair text, the dispute hint included, and only the class list and the repro sentence follow it [R1]', async () => {
  const { fx, directive } = await repairAfterBlock('[standards] 9 error handling (class: journal-before-save) @ src/t0-rc.ts:3: the event is appended before the save -> save first');
  try {
    const [repairText, tail] = directive.narration.split(REPAIR_CHECK);
    assert.ok(repairText?.includes(' Open finding(s): F1;'), directive.narration);
    assert.ok(repairText?.endsWith('once every finding of the block is disputed. '), directive.narration);
    assert.equal(tail, `${CLASS_TEXT} ${REPRO_REQUEST}`);
  } finally {
    fx.cleanup();
  }
});

test('T0-REPAIR-CHECK acceptance 2: the directive effort and attempt, the effort episode and the persisted records stay as the ladder leaves them [R2]', async () => {
  const { fx, goal, run, directive } = await repairAfterBlock('[spec] 6 tests missing @ src/t0-rc.ts:1: no RED -> add a failing test');
  try {
    assert.equal(directive.effort, 'medium');
    assert.equal(directive.attempt, 2);
    assert.equal(run.effort?.baseline, 'medium');
    assert.equal(run.effort?.terminal, undefined);
    assert.deepEqual(run.effort?.attempts.map((a) => [a.n, a.effort, a.outcome]), [[1, 'medium', 'success'], [2, 'medium', 'running']]);
    assert.equal(JSON.stringify(fx.store.getCardRun(goal.id, 'T0-RC')).includes('Before adding code'), false, 'the card run does not keep the text');
    assert.equal(JSON.stringify(fx.events(goal.id)).includes('Before adding code'), false, 'the journal does not keep the text');
  } finally {
    fx.cleanup();
  }
});

test('T0-REPAIR-FORMS acceptance 3: docs/OPERATIONS.md holds the Repair check paragraph and the CHANGELOG Unreleased section the entry, each as exact text [R3]', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(read('docs/OPERATIONS.md').split('\n').includes(OPS_PARAGRAPH), `docs/OPERATIONS.md holds: ${OPS_PARAGRAPH}`);
  const changelog = read('CHANGELOG.md');
  const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
  assert.ok(unreleased.includes(CHANGELOG_ENTRY), `CHANGELOG.md Unreleased states: ${CHANGELOG_ENTRY}`);
});
