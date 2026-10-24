import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, goalForCards, candidateShaFor, T0, type Fixture } from './_harness.ts';
import { addMs } from '../../src/core/types.ts';

// T0-LESSON-DUP: `aidlc card close --lesson` records a lesson the file already holds under another date once, and the
// close directive says the flag writes the line itself.

const CARD = 'T0-DUP';
const TEXT = 'NEVER write the lesson line twice (source: lesson-dup scenario)';
const TODAY = T0.slice(0, 10);
const LINE = `- ${TODAY} ${CARD}: ${TEXT}`;
const FIVE = { metadata: true, docSync: true, findings: true, evidence: true, cleanup: true };
const LESSON_HINT = `Record the lesson step with \`aidlc card close ${CARD} --lesson "<NEVER|ALWAYS|NOTE> <rule> (source: <ref>)"\`, which appends the line to docs/LESSONS.md itself (do not write it by hand), or \`--skip-lesson "<why>"\`; --all never records it.`;

/** A card of a fresh goal driven to CLOSE (merge verified, all six closure steps missing). */
function atClose(fx: Fixture) {
  writeCard(fx, { id: CARD, title: 'closes with a lesson' });
  const goal = goalForCards(fx, [CARD]);
  const runner = fx.runner();
  const card = fx.card(CARD);
  let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  r = runner.next(fx.goal(goal.id), card, r.run);
  assert.equal(r.directive.kind, 'build');
  const built = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok', redReceipt: 'red:ok', candidateSha: candidateShaFor(CARD) });
  r = runner.next(fx.goal(goal.id), card, built);
  assert.equal(r.directive.kind, 'close', r.directive.narration);
  return { goalId: goal.id, runner, card, close: r };
}

function writeLessons(fx: Fixture, lines: string[]): string {
  const file = path.join(fx.repo.mainRoot, 'docs', 'LESSONS.md');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `# Lessons\n\n## Lessons\n\n${lines.map((l) => `${l}\n`).join('')}`, 'utf8');
  return file;
}

test('T0-LESSON-DUP acceptance 1: a lesson line written by hand under another date is recorded with no second line [R1]', () => {
  const fx = makeFixture();
  try {
    const { goalId, runner, card, close } = atClose(fx);
    const marked = runner.markClosure(fx.goal(goalId), card, close.run, FIVE);
    const hand = `- ${addMs(T0, 86_400_000).slice(0, 10)} ${CARD}: ${TEXT}`;
    const file = writeLessons(fx, [hand]);
    const before = readFileSync(file, 'utf8');
    const recorded = runner.markClosure(fx.goal(goalId), card, marked, { lessons: true }, { lessonText: TEXT });
    assert.equal(recorded.closure.lessons, true);
    assert.equal(readFileSync(file, 'utf8'), before, 'the file is unchanged: the hand-written line is the only line for the lesson');
    assert.deepEqual(readFileSync(file, 'utf8').split('\n').filter((l) => l.includes(`${CARD}: ${TEXT}`)), [hand]);
    const retained = fx.events(goalId).filter((e) => e.type === 'EVIDENCE_RETAINED' && e.cardId === CARD);
    assert.equal(retained.at(-1)?.data['lesson'], hand, 'the existing line is journaled as the lesson');
    assert.equal(retained.filter((e) => 'lessonPending' in e.data).length, 0, 'no append was pending');
    assert.equal(runner.next(fx.goal(goalId), card, recorded).directive.kind, 'done');
  } finally {
    fx.cleanup();
  }
});

test('T0-LESSON-DUP acceptance 2: a line of another card, kind, rule or source does not count; one line is appended, dated today in UTC [R2]', () => {
  const fx = makeFixture();
  try {
    const { goalId, runner, card, close } = atClose(fx);
    const marked = runner.markClosure(fx.goal(goalId), card, close.run, FIVE);
    const others = [
      `- 2026-09-10 ${CARD}: NEVER write some other rule (source: lesson-dup scenario)`,
      `- 2026-09-10 ${CARD}: ALWAYS write the lesson line twice (source: lesson-dup scenario)`,
      `- 2026-09-10 ${CARD}: NEVER write the lesson line twice (source: another source)`,
      `- 2026-09-10 T0-OTHER: ${TEXT}`,
    ];
    const file = writeLessons(fx, others);
    const before = readFileSync(file, 'utf8');
    const recorded = runner.markClosure(fx.goal(goalId), card, marked, { lessons: true }, { lessonText: TEXT });
    assert.equal(recorded.closure.lessons, true);
    assert.equal(readFileSync(file, 'utf8'), `${before}${LINE}\n`, 'every earlier line is unchanged and one line is appended');
    assert.equal(fx.events(goalId).filter((e) => e.type === 'EVIDENCE_RETAINED' && e.cardId === CARD).at(-1)?.data['lesson'], LINE);
  } finally {
    fx.cleanup();
  }
});

test('T0-LESSON-DUP acceptance 3: the close directive leaves the lesson step out of the steps done by hand and says --lesson writes the line [R3]', () => {
  const fx = makeFixture();
  try {
    const { goalId, runner, card, close } = atClose(fx);
    if (close.directive.kind === 'close') assert.deepEqual(close.directive.missing, ['metadata', 'docSync', 'findings', 'evidence', 'cleanup', 'lessons']);
    assert.equal(
      close.directive.narration,
      `Merge verified. Complete only the missing closure steps (metadata, docSync, findings, evidence, cleanup) through the existing approved metadata procedure, then mark them with \`aidlc card close ${CARD} --metadata\`. ${LESSON_HINT}`,
    );
    const marked = runner.markClosure(fx.goal(goalId), card, close.run, FIVE);
    const open = runner.next(fx.goal(goalId), card, marked);
    assert.equal(open.directive.kind, 'close');
    if (open.directive.kind === 'close') assert.deepEqual(open.directive.missing, ['lessons']);
    assert.equal(open.directive.narration, `Merge verified. ${LESSON_HINT}`);
  } finally {
    fx.cleanup();
  }
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LESSONS_ANCHOR = 'when a review block or an incident taught a rule the playbook did not state.';
const OPERATIONS_SENTENCE = '`aidlc card close --lesson` appends that line itself, so it is not written by hand; a line the file already holds for the same card, kind, rule and source counts as written under any date, and the step appends nothing (card T0-LESSON-DUP).';
const CHANGELOG_SENTENCES = [
  '- T0-LESSON-DUP (bugfix): `aidlc card close --lesson` appends no second line for a lesson that docs/LESSONS.md already holds for the same card, kind, rule and source under another date, and the close directive says the flag writes the line itself instead of listing the lesson step among the steps completed by hand.',
  'Before, a line written by hand and then recorded with `--lesson` was appended twice whenever its date was not the UTC date of the close.',
];

/** The Doc text sentences of the card that the two documents do not carry where the card puts them. */
function missingDocText(operations: string, changelog: string): string[] {
  const missing: string[] = [];
  if (!operations.includes(`${LESSONS_ANCHOR} ${OPERATIONS_SENTENCE}`)) missing.push(OPERATIONS_SENTENCE);
  const start = changelog.indexOf('## Unreleased');
  const end = start < 0 ? -1 : changelog.indexOf('\n## ', start + 1);
  const unreleased = start < 0 ? '' : changelog.slice(start, end < 0 ? undefined : end);
  if (!unreleased.includes(`\n${CHANGELOG_SENTENCES[0]}`)) missing.push(CHANGELOG_SENTENCES[0]!);
  for (const sentence of CHANGELOG_SENTENCES.slice(1)) if (!unreleased.includes(sentence)) missing.push(sentence);
  return missing;
}

test('T0-LESSON-DUP acceptance 4: docs/OPERATIONS.md and the CHANGELOG Unreleased section carry each Doc text sentence [R4]', () => {
  const operations = readFileSync(path.join(ROOT, 'docs', 'OPERATIONS.md'), 'utf8');
  const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.deepEqual(missingDocText(operations, changelog), []);
  assert.deepEqual(missingDocText(operations.replace(OPERATIONS_SENTENCE, ''), changelog), [OPERATIONS_SENTENCE], 'removing the OPERATIONS sentence fails');
  for (const sentence of CHANGELOG_SENTENCES) {
    assert.deepEqual(missingDocText(operations, changelog.replace(sentence, '')), [sentence], `removing a CHANGELOG sentence fails: ${sentence}`);
  }
});
