import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Card T0-BASE-SYNC-JSDOC: the comments of the three symbols T0-BASE-SYNC-REVIEW extended describe the base-sync reviewer.
const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...parts: string[]): string => readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

/** The JSDoc that ends directly above `at` (only whitespace between), flattened to one line; fails when there is none. */
function jsdocAbove(source: string, at: number, what: string): string {
  assert.ok(at > 0, `${what} is in the source`);
  const end = source.lastIndexOf('*/', at);
  const start = source.lastIndexOf('/**', end);
  assert.ok(start >= 0 && end > start && source.slice(end + 2, at).trim() === '', `${what} is preceded directly by its JSDoc`);
  return source
    .slice(start + 3, end)
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('T0-BASE-SYNC-JSDOC', () => {
  const runner = read('src', 'loop', 'card-runner.ts');
  const types = read('src', 'core', 'types.ts');

  it('formalPool names the base-sync reviewer\'s own pool and the primary and fallback layout (acceptance 1) [R1]', () => {
    // The whole comment, so removing or changing any of its sentences fails (R3 decision 1).
    assert.equal(
      jsdocAbove(runner, runner.indexOf('  private formalPool('), 'formalPool'),
      "The review pool a formal reviewer queues in. The base-sync reviewer always queues in its own pool, `<pool>/<reviewer>`, since its quota is its own. The primary and the fallback queue in the goal's pool, or with a fallback configured in one pool each (`<pool>/<reviewer>`), since a quota hold resets the whole pool it lands in and the two reviewers hold separate quotas. The ship's own admission stays in the goal's pool either way.",
    );
  });

  it('formalReviewerFor names the lookup by the recorded name, base-sync reviewer first (acceptance 1) [R2]', () => {
    assert.equal(
      jsdocAbove(runner, runner.indexOf('  private formalReviewerFor('), 'formalReviewerFor'),
      'The settings of the formal reviewer an invocation names, looked up by the name it records: the base-sync reviewer under its own name, else the configured fallback under its own name, else the primary.',
    );
  });

  it('CandidateInfo.baseSync names both markings (acceptance 1) [R3]', () => {
    const schema = types.indexOf('export const CandidateInfo = z.object({');
    const field = types.indexOf('  baseSync: z.boolean().optional(),', schema);
    assert.ok(schema > 0 && field > schema && field < types.indexOf('export type CandidateInfo', schema), 'baseSync is a field of CandidateInfo');
    assert.equal(
      jsdocAbove(types, field, 'CandidateInfo.baseSync'),
      'A base-sync candidate (T0-BASE-SYNC-REVIEW): recorded by the successful attempt that cleared a merge-conflict repair, the merge of a moved base, and by the successful attempt that repairs a base-sync candidate no R3 decision has decided yet (an R2 block after the merge), since the base moved all the same.',
    );
  });

  it('CHANGELOG.md Unreleased carries the entry under the card id (acceptance 3) [R4]', () => {
    const changelog = read('CHANGELOG.md');
    const start = changelog.indexOf('## Unreleased');
    const end = changelog.indexOf('\n## ', start + 1);
    const unreleased = changelog.slice(start, end === -1 ? changelog.length : end);
    const sentence = "- Base-sync JSDoc, card T0-BASE-SYNC-JSDOC: the comments of `formalPool`, `formalReviewerFor` and `CandidateInfo.baseSync` now name the base-sync reviewer's own review pool, its lookup by the recorded reviewer name and the marking of an undecided base-sync candidate's repair; no code changed (issue #65).";
    assert.ok(unreleased.includes(sentence), `CHANGELOG.md Unreleased states: ${sentence}`);
  });
});
