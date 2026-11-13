import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parseCardText, renderCard } from '../../src/artifacts/card.ts';
import type { Card } from '../../src/core/types.ts';
import { buildReviewPrompt } from '../../src/review/pre-review.ts';
import { changelogSince010 } from '../infra/changelog.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

/** Card T0-EDGE-SCOPE R2: the template line, as the card words it. */
const TEMPLATE_LINE = '  # A card that reads input or adds I/O names in these items each input form and failure path it handles; non_goals names each form it leaves out and what the code does with it (refuse, ignore or fail closed).';
const TEMPLATES = ['specs/tasks/_TEMPLATE.md', 'templates/cards/_TEMPLATE.md'];

/** Card T0-EDGE-SCOPE R3: the Edge scope paragraph and the CHANGELOG entry, as exact text. */
const OPS_PARAGRAPH = "Edge scope (card T0-EDGE-SCOPE). The Card contract section of the R2 and R3 prompts lists the card's `requirements` after `allow_paths`, one per line under `- requirements:`; a card without requirements gets no such line. Both card templates ask, in the `acceptance:` block, that a card that reads input or adds I/O name in its items each input form and failure path it handles, and in `non_goals` each form it leaves out with what the code does with it. Measured on 2026-11-10 from the card runs: of 80 cards that change `src/` and reached R3 since 2026-10-23, 46 were blocked at the first R3 decision, with 141 findings (1.76 per card), and 53 of the 79 most recent first-decision findings on any card, read by hand, named an input form, an environment setting or a failure path. After 15 more reviewed cards that change `src/`, count again and remove the template line if the first-decision findings per card did not fall.";
const CHANGELOG_ENTRY = "- T0-EDGE-SCOPE: the Card contract section of the R2 and R3 prompts lists the card's `requirements`, and both card templates ask a card that reads input or adds I/O to name in its acceptance items each input form and failure path it handles, and in `non_goals` each form it leaves out with what the code does with it; on the records of 2026-11-10, 46 of 80 cards that change `src/` were blocked at the first R3 decision, and 53 of the 79 most recent first-decision findings named an input form, an environment setting or a failure path.";
const REVIEW_PRE_FIELDS = 'the card (acceptance, requirements, allow_paths, non_goals, forbid, tier, diagnosis)';

const R1 = 'R1. The gate shall refuse a candidate without a DoD receipt.';
const R2 = 'R2. The gate shall name the missing receipt in its refusal.';

function cardFrom(text: string): Card {
  const parsed = parseCardText(text, 'T1-GATE.md');
  assert.ok(!('error' in parsed), `the fixture card parses: ${'error' in parsed ? parsed.error : ''}`);
  return parsed.card;
}

const rendered = (requirements?: string[]) => renderCard({ id: 'T1-GATE', title: 'gate the ship', allowPaths: ['src/gate.ts'], dodCommand: 'node --test tests/gate.test.ts', acceptance: ['1. the gate holds. [R1] [R2] [dod arm 1]'], nonGoals: ['a second gate'], deliverable: 'gate', worktreeRoot: 'D:\\wt', ...(requirements ? { requirements } : {}) });

const prompt = (card: Card, stage: 'pre' | 'formal') => buildReviewPrompt({ stage, includeDiff: true, reviewPolicy: 'policy', card, base: 'main@abc', head: 'def456', changedPaths: ['src/gate.ts'], diff: '+x\n', priorFindings: [], round: 1, maxRounds: 2 });

describe('T0-EDGE-SCOPE', () => {
  test('acceptance 1: both stages list the requirements directly after allow_paths; without them the prompt is byte-equal; an absent key and an empty list add no line [R1]', () => {
    const withReq = cardFrom(rendered([R1, R2]));
    assert.deepEqual(withReq.requirements, [R1, R2], 'the fixture card carries both requirements');
    const noKey = cardFrom(rendered());
    assert.equal(noKey.requirements, undefined, 'the fixture has no requirements key');
    const emptyText = rendered().replace(/^dod_exit: 0$/m, 'dod_exit: 0\nrequirements: []');
    assert.ok(emptyText.includes('\nrequirements: []\n'), 'the empty-list fixture carries the key');
    const empty = cardFrom(emptyText);
    for (const stage of ['pre', 'formal'] as const) {
      const lines = prompt(withReq, stage).split('\n');
      const at = lines.indexOf('- allow_paths: src/gate.ts');
      assert.ok(at > 0, `${stage}: the card contract carries allow_paths`);
      assert.deepEqual(lines.slice(at + 1, at + 4), ['- requirements:', `  ${R1}`, `  ${R2}`], `${stage}: the requirements follow allow_paths`);
      assert.equal(lines.filter((l) => l === '- requirements:').length, 1, `${stage}: one requirements line`);
      const without = [...lines.slice(0, at + 1), ...lines.slice(at + 4)].join('\n');
      assert.equal(without, prompt(noKey, stage), `${stage}: removing the three lines gives the prompt of the card without requirements`);
      assert.equal(prompt({ ...withReq, requirements: undefined }, stage), prompt(noKey, stage), `${stage}: only the requirements differ between the two fixtures`);
      for (const card of [noKey, empty]) assert.ok(!prompt(card, stage).split('\n').includes('- requirements:'), `${stage}: no requirements line for ${JSON.stringify(card.requirements)}`);
      assert.equal(prompt(empty, stage), prompt(noKey, stage), `${stage}: an empty list renders as an absent key`);
    }
  });

  test('acceptance 2: each card template carries the template line once, directly after the Doc text comment, and still parses [R2]', () => {
    for (const file of TEMPLATES) {
      const lines = read(file).split('\n');
      assert.equal(lines.filter((l) => l === TEMPLATE_LINE).length, 1, `${file}: the template line once`);
      const acceptance = lines.findIndex((l) => l.startsWith('acceptance:'));
      const firstItem = lines.findIndex((l, i) => i > acceptance && l.startsWith('  - 1.'));
      const doc = lines.findIndex((l) => l.startsWith('  # Doc text is proved with'));
      assert.ok(acceptance >= 0 && doc > acceptance && firstItem > doc + 1, `${file}: the Doc text comment and the template line sit in the acceptance block, before its items`);
      assert.equal(lines[doc + 1], TEMPLATE_LINE, `${file}: the template line follows the Doc text comment`);
      const parsed = parseCardText(read(file).replace(/T\?-EXAMPLE/g, 'T0-EXAMPLE'), 'T0-EXAMPLE.md');
      assert.ok(!('error' in parsed), `${file}: the template parses once its id is real`);
    }
  });

  test('acceptance 3: OPERATIONS holds the Edge scope paragraph and lists requirements among the prompt fields; the CHANGELOG Unreleased section holds the entry [R3]', () => {
    const ops = read('docs/OPERATIONS.md');
    assert.ok(ops.split('\n').includes(OPS_PARAGRAPH), 'the Edge scope paragraph, exact');
    const size = ops.indexOf('\nCard size (card T0-CARD-SIZE).');
    assert.ok(size >= 0 && ops.indexOf(OPS_PARAGRAPH) > size, 'the paragraph follows the Card size paragraph');
    assert.ok(ops.includes(REVIEW_PRE_FIELDS), 'the aidlc review pre sentence lists requirements');
    const changelog = read('CHANGELOG.md');
    const unreleased = changelogSince010(changelog);
    assert.ok(unreleased.split('\n').includes(CHANGELOG_ENTRY), 'the CHANGELOG entry, exact');
  });
});
