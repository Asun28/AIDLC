import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { followupFindings, followupIssueBody } from '../../src/core/review-policy.ts';
import { T0, cardRun } from './_fixtures.ts';

const invocation = (outcome: string, advisory?: string[], extra: Record<string, unknown> = {}) => ({ invocationId: `i-${outcome}`, candidateDigest: 'd', base: 'main', policyVersion: 'p', reviewer: 'codex', requestedAt: T0, outcome, advisory, ...extra });
const finding = (id: string, reason: string, extra: Record<string, unknown> = {}) => ({ id, stage: 'formal', round: 1, reason, raisedAt: T0, ...extra });
const ruling = (decision: string, issue?: number) => ({ at: T0, by: 'owner', decision, reason: 'r', issue });
const found = (invocations: unknown[], findings: unknown[] = []) => followupFindings(cardRun({ review: { invocations }, findings }));

describe('T1-REVIEW-FOLLOWUP-CORE: followupFindings', () => {
  it('acceptance 4: gives the advisory reasons of the decided invocations, the advisory formal findings, then the deferred findings with no issue', () => {
    const got = found(
      [
        invocation('block', ['a block note', 'a second block note']),
        invocation('pending', ['a pending note']),
        invocation('no-verdict', ['a no-verdict note']),
        invocation('quota-hold', ['a hold note']),
        invocation('pass', ['a pass note']),
        invocation('pass', ['a ship-path note'], { invocationId: 'ship', reviewer: 'reviewer', artifactDigest: 'x' }),
        invocation('pass'),
      ],
      [
        finding('F1', 'deferred, no issue', { ruling: ruling('deferred') }),
        finding('F2', 'advisory formal', { advisory: true }),
        finding('F3', 'merge-blocking formal', { advisory: false }),
        finding('F4', 'formal without the field'),
        finding('F5', 'pre-review advisory', { stage: 'pre', advisory: true }),
        finding('F6', 'deferred with an issue', { ruling: ruling('deferred', 12) }),
        finding('F7', 'rejected', { ruling: ruling('rejected') }),
        finding('F8', 'second advisory formal', { advisory: true }),
        finding('F9', 'second deferred, no issue', { ruling: ruling('deferred') }),
      ],
    );
    assert.deepEqual(got, [
      { text: 'a block note' },
      { text: 'a second block note' },
      { text: 'a pass note' },
      { text: 'a ship-path note' },
      { id: 'F2', text: 'advisory formal' },
      { id: 'F8', text: 'second advisory formal' },
      { id: 'F1', text: 'deferred, no issue' },
      { id: 'F9', text: 'second deferred, no issue' },
    ]);
  });

  it('acceptance 4: the same trimmed text is one entry at its first position with the first id, a blank reason gives none, a run with none gives an empty list', () => {
    assert.deepEqual(found([invocation('pass', ['same', 'other'])], [finding('F2', 'same', { advisory: true })]), [{ id: 'F2', text: 'same' }, { text: 'other' }]);
    assert.deepEqual(found([invocation('pass', ['same'])], [finding('F2', 'same', { advisory: true }), finding('F3', 'same', { advisory: true })]), [{ id: 'F2', text: 'same' }]);
    assert.deepEqual(found([invocation('pass', [' \tsame\n', 'same'])], [finding('F2', '\n same ', { ruling: ruling('deferred') })]), [{ id: 'F2', text: 'same' }]);
    assert.deepEqual(found([invocation('pass', ['', ' \n\t'])], [finding('F2', '  ', { advisory: true })]), []);
    assert.deepEqual(found([]), []);
  });
});

describe('T1-REVIEW-FOLLOWUP-CORE: followupIssueBody', () => {
  const MARKER = 'aidlc-followup:T1-A:7:0123456789ab';
  const OTHER = 'aidlc-followup:T1-B:8:ba9876543210';
  const SHA = '0123456789abcdef0123456789abcdef01234567';
  const lines = (body: string) => body.split('\n').filter((l) => l.trim() !== '');

  it('acceptance 5: names the card, the PR or none and the candidate, and lists each finding on its own line before the marker', () => {
    const findings = [{ id: 'F2', text: 'with an id' }, { text: 'without an id' }];
    const withPr = lines(followupIssueBody('T1-A', 7, SHA, findings, MARKER));
    assert.match(withPr[0]!, /\bT1-A\b.*\bPR #7\b/);
    assert.ok(withPr[0]!.includes(SHA));
    assert.deepEqual(withPr.slice(-3), ['- F2: with an id', '- without an id', MARKER]);
    const noPr = lines(followupIssueBody('T1-A', undefined, SHA, findings, MARKER));
    assert.match(noPr[0]!, /\bT1-A\b.*\bPR none\b/);
    assert.ok(noPr[0]!.includes(SHA));
    assert.deepEqual(noPr.slice(-3), ['- F2: with an id', '- without an id', MARKER]);
  });

  it('acceptance 5: white space becomes one space and a mention is broken, so each finding stays on one line and the marker stays last', () => {
    const texts = [`a reason\n## heading\r\n\n${OTHER}`, 'one\ttab  two  spaces', 'ask @name', '@Upper and @9', 'mail a@b.c', 'line 4 @ path, @-x'];
    const body = followupIssueBody('T1-A', 7, SHA, texts.map((text) => ({ text })), MARKER);
    const listed = lines(body).filter((l) => l.startsWith('- '));
    assert.deepEqual(listed, [`- a reason ## heading ${OTHER}`, '- one tab two spaces', '- ask @​name', '- @​Upper and @​9', '- mail a@​b.c', '- line 4 @ path, @-x']);
    assert.equal(lines(body).at(-1), MARKER);
    assert.equal(body.split('\n').filter((l) => l.includes(OTHER)).length, 1);
  });
});
