import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { Card } from '../../src/core/types.ts';
import { PERSPECTIVES, buildReviewPrompt, finalizeReview } from '../../src/review/pre-review.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
/** The advisory-tag line every review prompt already carries; the two lines of this card follow it. */
const TAGGED = 'A reason tagged [question] or [suggestion], the tag opening the reason (after the axis tag if any) or opening its text after the location, is advisory in both stages: it is retained and shown to the author, never a block, and it needs no location; a pass may carry such reasons.';
/** The two lines card T0-R2-PASS-NOTES adds to every review prompt (issue #82). */
const PASS_NOTES = 'A pass that carries notes lists each note once, in the top-level `reasons`, and leaves the `reasons` of both axes empty, so the verdict line stays short.';
const BALANCE = 'Before you send the verdict line, check that it is one complete JSON document: every `{` and `[` is closed by its `}` or `]`, and the line ends with the `}` that closes the document. A line one closing brace short does not parse and returns no verdict.';
const MARKER = '=== answer ===';
/**
 * The answers after `=== answer ===` of the two edge-cases rounds issue #82 retained, byte for byte (goal
 * g-20260926103738-6d05ad, evidence T0-GOAL-CARD-COUNT.pre.0.1.1.3e172325.edge-cases-log and
 * T0-GOAL-CARD-COUNT.pre.1.1.1.e111e31b.edge-cases-log): a pass with each note twice, one closing brace short.
 */
const RETAINED: readonly string[] = [
  "{\"verdict\":\"pass\",\"reasons\":[\"[standards] [suggestion] @ src/core/router.ts:60: `input.knownCardIds ?? []` silently degrades the new multi-card branch to the old first-ref/cardCount-1 behaviour when the known id list is missing or empty on a failed registry read; a request naming several real ids then gets the 3 h deadline instead of arc without any error. -> make the known list required for this route, or fail loudly when multiple T-digit tokens are present but the known set is unavailable.\",\"[standards] [question] @ src/core/router.ts:167: the `namedCards.length > 1` branch has no `kind` guard, so a release/migration or card-amendment text that names two known card ids would also get `arc`/`card-loop` and `cardCount` unknown, skipping its normal branch. -> confirm those kinds cannot yield two known ids, or gate the branch to the intended request kinds.\"],\"axes\":{\"spec\":{\"verdict\":\"pass\",\"reasons\":[]},\"standards\":{\"verdict\":\"pass\",\"reasons\":[\"[standards] [suggestion] @ src/core/router.ts:60: `input.knownCardIds ?? []` silently degrades the new multi-card branch to the old first-ref/cardCount-1 behaviour when the known id list is missing or empty on a failed registry read; a request naming several real ids then gets the 3 h deadline instead of arc without any error. -> make the known list required for this route, or fail loudly when multiple T-digit tokens are present but the known set is unavailable.\",\"[standards] [question] @ src/core/router.ts:167: the `namedCards.length > 1` branch has no `kind` guard, so a release/migration or card-amendment text that names two known card ids would also get `arc`/`card-loop` and `cardCount` unknown, skipping its normal branch. -> confirm those kinds cannot yield two known ids, or gate the branch to the intended request kinds.\"]}}",
  "{\"verdict\":\"pass\",\"reasons\":[\"[standards] [question] @ src/core/router.ts:60: when a text names one known and one unknown card id and the unknown token appears first (e.g. 'implement T9-UNKNOWN then T3-API'), namedCards filters out the unknown and leaves length 1, so the multi-card branch is skipped and the existing first-token ref= path selects T9-UNKNOWN as the card. The acceptance test only covers the known-first order; if the known id must be the card, derive ref= from namedCards/known ids and add the reversed-order case.\",\"[standards] [question] @ src/loop/controller.ts:126: if options.cards is supplied for a route whose routing.cardCount is 'unknown' (several named cards), explicitCards.length overrides the routed unknown count and can set cardCount=1 (3 h limit), bypassing the multi-card arc path. Confirm this combination is unreachable, or guard it so options.cards cannot turn an unknown count numeric.\"],\"axes\":{\"spec\":{\"verdict\":\"pass\",\"reasons\":[]},\"standards\":{\"verdict\":\"pass\",\"reasons\":[\"[standards] [question] @ src/core/router.ts:60: when a text names one known and one unknown card id and the unknown token appears first (e.g. 'implement T9-UNKNOWN then T3-API'), namedCards filters out the unknown and leaves length 1, so the multi-card branch is skipped and the existing first-token ref= path selects T9-UNKNOWN as the card. The acceptance test only covers the known-first order; if the known id must be the card, derive ref= from namedCards/known ids and add the reversed-order case.\",\"[standards] [question] @ src/loop/controller.ts:126: if options.cards is supplied for a route whose routing.cardCount is 'unknown' (several named cards), explicitCards.length overrides the routed unknown count and can set cardCount=1 (3 h limit), bypassing the multi-card arc path. Confirm this combination is unreachable, or guard it so options.cards cannot turn an unknown count numeric.\"]}}",
];

/** One angle's stdout (a reasoning section, the marker, the answer) read by the unchanged reader. */
function readAnswer(answer: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-pass-notes-'));
  try {
    const stdout = `=== reasoning ===\nThe review.\n${MARKER}\n${answer}\n`;
    const at = '2026-09-26T00:00:00.000Z';
    const receipt = { command: 'deepseek', args: [], cwd: dir, exitCode: 0, signal: null, timedOut: false, stdout, stderr: '', startedAt: at, finishedAt: at, durationMs: 0, outputSha256: createHash('sha256').update(stdout).digest('hex') };
    const fin = finalizeReview(receipt, { reviewDir: dir, fileStem: 'angle', head: 'sha-1', reviewer: 'deepseek-v4-pro', perspective: 'edge-cases', answerMarker: MARKER });
    return { outcome: fin.outcome, runStatus: fin.runStatus, verdict: fin.verdict?.verdict, advisory: fin.advisory ?? [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('a pass with notes and the verdict line balance (T0-R2-PASS-NOTES, issue #82)', () => {
  test('every pre and formal prompt, a single pass and each angle, coverage on and off, carries the notes line and the balance line right after the advisory-tag line [R1]', () => {
    const card = { id: 'T1-X', title: 't', allow_paths: ['src/x.ts'], tdd: true, dod_command: 'npm test', acceptance: ['1. x. [dod arm 1]'] } as unknown as Card;
    const input = { reviewPolicy: 'policy', card, base: 'main', head: 'h', changedPaths: ['src/x.ts'], diff: '+x\n', priorFindings: [], round: 1, maxRounds: 2, includeDiff: true };
    let prompts = 0;
    for (const stage of ['pre', 'formal'] as const) {
      for (const perspective of [undefined, ...Object.keys(PERSPECTIVES)]) {
        for (const coverage of [false, true]) {
          const key = `${stage}/${perspective ?? 'single'}/coverage ${coverage}`;
          const lines = buildReviewPrompt({ ...input, stage, perspective, coverage }).split('\n');
          const at = lines.indexOf(TAGGED);
          assert.ok(at >= 0, `${key}: the advisory-tag line`);
          assert.equal(lines[at + 1], PASS_NOTES, `${key}: the notes line follows it`);
          assert.equal(lines[at + 2], BALANCE, `${key}: the balance line follows the notes line`);
          assert.equal(lines.filter((l) => l === PASS_NOTES || l === BALANCE).length, 2, `${key}: each line once`);
          prompts += 1;
        }
      }
    }
    assert.equal(prompts, 2 * (1 + Object.keys(PERSPECTIVES).length) * 2);
  });

  test('each retained answer is one closing brace short and the unchanged reader still reads it as no-verdict / malformed, never repaired [R2]', () => {
    assert.equal(RETAINED.length, 2);
    for (const [i, answer] of RETAINED.entries()) {
      assert.ok(answer.endsWith('."]}}'), `answer ${i + 1} ends with the axes closed and the root open`);
      assert.throws(() => JSON.parse(answer), SyntaxError, `answer ${i + 1} does not parse`);
      assert.equal((JSON.parse(`${answer}}`) as { verdict: string }).verdict, 'pass', `answer ${i + 1} parses with one brace appended, which only this test does`);
      assert.deepEqual(readAnswer(answer), { outcome: 'no-verdict', runStatus: 'malformed', verdict: undefined, advisory: [] }, `answer ${i + 1}: the reader is unchanged, so the retained answer stays malformed (expected)`);
    }
  });

  test('the notes of each retained answer, written once in the top-level reasons with both axes empty, read as a pass whose advisory notes are those notes, on a shorter line [R2]', () => {
    for (const [i, answer] of RETAINED.entries()) {
      const retained = JSON.parse(`${answer}}`) as { reasons: string[]; axes: { spec: { reasons: string[] }; standards: { reasons: string[] } } };
      assert.equal(retained.reasons.length, 2, `answer ${i + 1} carries two notes`);
      assert.deepEqual(retained.axes.standards.reasons, retained.reasons, `answer ${i + 1} writes each note twice`);
      const asked = JSON.stringify({ verdict: 'pass', reasons: retained.reasons, axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'pass', reasons: [] } } });
      assert.deepEqual(readAnswer(asked), { outcome: 'pass', runStatus: 'success', verdict: 'pass', advisory: retained.reasons }, `answer ${i + 1} as the prompt asks`);
      assert.ok(asked.length < answer.length, `answer ${i + 1}: ${asked.length} < ${answer.length} characters`);
    }
  });

  test('docs/OPERATIONS.md and the CHANGELOG Unreleased section state the two prompt lines and the unchanged reader [R3]', () => {
    const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
    const opsSentences = [
      'Every review prompt also says that a pass that carries notes lists each note once, in the top-level `reasons`, with the `reasons` of both axes empty, and asks the reviewer to check, before it sends the verdict line, that the line is one complete JSON document (card T0-R2-PASS-NOTES).',
      'The R2 edge-cases angle twice returned a pass that wrote each note in both places, on one line of about 1,800 characters that ended one closing brace short, so the document did not parse and the round had no verdict (issue #82).',
      'The `deepseek` command has no JSON output mode that would hold R2 to the verdict schema, so the rule is in the prompt; the reader is unchanged and never repairs a document one brace short, which still leaves no verdict.',
    ];
    const operations = read('docs', 'OPERATIONS.md');
    for (const sentence of opsSentences) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
    const changelog = read('CHANGELOG.md');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
    const entry = '- R2 pass notes, card T0-R2-PASS-NOTES (issue #82): every review prompt says that a pass that carries notes lists each note once, in the top-level `reasons`, with the `reasons` of both axes empty, and asks the reviewer to check that the verdict line is one complete JSON document before sending it; the `deepseek` command has no JSON output mode, and the reader still leaves no verdict for a document one brace short and never repairs it.';
    assert.ok(unreleased.includes(entry), `CHANGELOG.md Unreleased states: ${entry}`);
  });
});
