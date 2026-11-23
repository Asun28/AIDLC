import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GitHubShipPath, prBody } from '../../src/delivery/github-ship.ts';
import { scriptedRunner, type ExecReceipt } from '../../src/probes/exec.ts';
import { tmpDir } from './helpers.ts';

const HEAD = 'a'.repeat(40);
const OTHER = 'c'.repeat(40);
const FIXED = 'Closed loop: worktree + TDD + independent review. DoD in specs/tasks/T1-A.md.';
const PASS = 'Card: specs/tasks/T1-A.md. Formal review: pass.';
const NO_PASS = 'Card: specs/tasks/T1-A.md. Formal review: no pass recorded for this commit.';
/** A valid summary: the nine headings in order, one sentence under each. */
const LINES = [
  '### What',
  'The ship writes the pull request text from the card.',
  '### Why / Intent',
  'A person must see what the change does.',
  '### How / Behaviour',
  'The ship reads the summary and sends it to GitHub.',
  '### System impact',
  'Only the GitHub ship path changes.',
  '### Security',
  'The text can notify no account.',
  '### Tests and review',
  'Six new tests pass.',
  '### Risk',
  'Low. A card with no summary keeps the old text.',
  '### Ownership',
  'Card T1-A.',
  '### Docs',
  'The operations guide has a new paragraph.',
];
const SUMMARY = LINES.join('\n');
const HEAD_LINES = ['---', 'id: T1-A', '---', '', '# T1-A', '', '## Deliverable', 'One thing.', ''];
/** A card text: the lines before the summary, its heading line, the summary lines, then what follows. */
const card = (lines: string[], rest: string[] = ['', '## Attempt evidence', 'A table.'], eol = '\n', heading = '## PR summary'): string => [...HEAD_LINES, heading, ...lines, ...rest].join(eol) + eol;
/** The summary lines with the line at `at` replaced by `put`. */
const swap = (at: string, put: string[], lines: string[] = LINES): string[] => lines.flatMap((l) => (l === at ? put : [l]));
/** Lines of `total` characters once joined: the valid summary, then one line of filler under Docs. */
const sized = (total: number, fill = 'x'): string[] => [...LINES, fill.repeat(total - SUMMARY.length - 1)];
const exchanged = swap('### Risk', ['### Security'], swap('### Security', ['### Risk']));
const noSecurityText = swap('The text can notify no account.', ['', '  \t']);

describe('T0-PR-SUMMARY: prBody', () => {
  test('acceptance 1: a valid summary is the body, then a rule and the line that names the card and the review [R1]', () => {
    const texts: Array<[string, string]> = [
      ['a section follows', card(LINES)],
      ['the summary ends the text', card(LINES, [])],
      ['every line ends with a carriage return and a line feed', card(LINES, undefined, '\r\n')],
      ['a level-1 heading follows', card(LINES, ['# Other', 'x'])],
      ['the heading line has trailing white space', card(LINES, undefined, '\n', '## PR summary \t')],
      ['a second summary follows the first', card(LINES, ['## PR summary', '### What', 'Other.'])],
    ];
    for (const [name, text] of texts) {
      assert.deepEqual(prBody(text, 'T1-A', true), { body: `${SUMMARY}\n\n---\n${PASS}` }, name);
      assert.deepEqual(prBody(text, 'T1-A', false), { body: `${SUMMARY}\n\n---\n${NO_PASS}` }, name);
    }
    assert.deepEqual(prBody(card(['', 'Intro line.', ...LINES]), 'T1-A', true), { body: `Intro line.\n${SUMMARY}\n\n---\n${PASS}` }, 'text before the first heading is part of the body');
    assert.deepEqual(prBody(card(swap('### Risk', ['### Risk  '])), 'T1-A', true), { body: `${swap('### Risk', ['### Risk  ']).join('\n')}\n\n---\n${PASS}` }, 'a heading with trailing white space is that heading');
    const full = sized(4000);
    assert.equal(full.join('\n').length, 4000);
    assert.deepEqual(prBody(card(full), 'T1-A', true), { body: `${full.join('\n')}\n\n---\n${PASS}` }, '4000 characters are within the limit');
  });

  test('acceptance 2: each other text gets the fixed line and the first reason that applies [R2]', () => {
    const cases: Array<[string, string | undefined, string]> = [
      ['an undefined text', undefined, 'no card file'],
      ['no summary line', HEAD_LINES.join('\n'), 'no PR summary section'],
      ['an indented summary line', card(LINES, undefined, '\n', '  ## PR summary'), 'no PR summary section'],
      ['a summary line with more text', card(LINES, undefined, '\n', '## PR summary notes'), 'no PR summary section'],
      ['no Risk heading', card(LINES.filter((l) => l !== '### Risk')), 'the headings are not the nine in order'],
      ['Risk and Security exchanged', card(exchanged), 'the headings are not the nine in order'],
      ['What twice', card([...LINES, '### What', 'Again.']), 'the headings are not the nine in order'],
      ['a tenth heading', card([...LINES, '### Notes', 'More.']), 'the headings are not the nine in order'],
      ['a heading in another case', card(swap('### Risk', ['### risk'])), 'the headings are not the nine in order'],
      ['only blank lines under Security', card(noSecurityText), 'no text under a heading'],
      ['Docs ends the summary', card(LINES.slice(0, -1)), 'no text under a heading'],
      ['4001 characters', card(sized(4001)), 'over 4000 characters'],
      ['the character @', card(swap('Card T1-A.', ['Card T1-A, by @someone.'])), 'the character @'],
      ['exchanged headings, no text under one and the character @', card(swap('Card T1-A.', ['@someone'], exchanged).slice(0, -1)), 'the headings are not the nine in order'],
      ['no text under Security and 4001 characters', card([...noSecurityText, 'x'.repeat(4001)]), 'no text under a heading'],
      ['4001 characters and the character @', card(sized(4001, '@')), 'over 4000 characters'],
    ];
    for (const [name, text, reason] of cases) assert.deepEqual(prBody(text, 'T1-A', true), { body: FIXED, reason }, name);
  });
});

const SCRIPT: Record<string, Partial<ExecReceipt>> = {
  'gh api user -q .login': { stdout: 'alice\n' },
  'git add -A': {},
  'git diff --cached --quiet': {},
  'git rev-parse --verify HEAD': { stdout: HEAD + '\n' },
  'git fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main': {},
  'git rev-parse --verify --quiet refs/remotes/origin/main^{commit}': { stdout: 'd'.repeat(40) + '\n' },
  'git merge-tree --write-tree HEAD': { stdout: 'e'.repeat(40) + '\n' },
  'git push': {},
  'gh pr list': { stdout: '[]' },
  'gh pr create': { stdout: 'https://github.com/o/r/pull/42\n' },
  'gh api repos/o/r/commits': { stdout: JSON.stringify({ check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] }) },
  'gh pr merge': {},
  'gh pr view': { stdout: JSON.stringify({ number: 42, state: 'MERGED', headRefOid: HEAD, baseRefName: 'main', mergedAt: '2026-09-11T00:00:00.000Z', mergeCommit: { oid: 'b'.repeat(40) } }) },
};
const PASS_VERDICT = { verdict: 'pass', reasons: [], sha: HEAD };

/** One remote ship of T1-A in a new fixture: the result, the arguments of each `gh pr create`, and the output lines. */
function shipOnce(opts: { verdict?: Record<string, unknown> | string; cardText?: string; requireVerdict?: boolean; script?: Record<string, Partial<ExecReceipt>> }) {
  const root = tmpDir('aidlc-prsum-');
  const wt = path.join(root, 'wt', 'T1-A');
  mkdirSync(path.join(wt, '.review'), { recursive: true });
  mkdirSync(path.join(wt, 'specs', 'tasks'), { recursive: true });
  mkdirSync(path.join(root, '.git'), { recursive: true });
  if (opts.verdict !== undefined) writeFileSync(path.join(wt, '.review', 'T1-A.json'), typeof opts.verdict === 'string' ? opts.verdict : JSON.stringify(opts.verdict));
  if (opts.cardText !== undefined) writeFileSync(path.join(wt, 'specs', 'tasks', 'T1-A.md'), opts.cardText);
  const creates: string[][] = [];
  const base = scriptedRunner({ ...SCRIPT, ...opts.script });
  const runner: typeof base = (cmd, args, o) => {
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') creates.push(args);
    return base(cmd, args, o);
  };
  const r = new GitHubShipPath({ mainRoot: root, worktreeRoot: path.join(root, 'wt'), repository: 'o/r', runner, sleep: () => {}, requireVerdict: opts.requireVerdict }).ship({ cardId: 'T1-A', base: 'main', mode: 'remote' });
  return { r, creates, lines: r.receipt.stdout.split('\n') };
}
/** The arguments of the one `gh pr create` of a ship, with this body. */
const createArgs = (body: string): string[][] => [['pr', 'create', '--repo', 'o/r', '--base', 'main', '--head', 'T1-A', '--title', 'feat: [T1-A]', '--body', body]];
/** The `PR body:` lines of an output, each with the line after it. */
const bodyLines = (lines: string[]): string[][] => lines.flatMap((l, i) => (l.startsWith('PR body:') ? [[l, lines[i + 1] ?? '']] : []));

describe('T0-PR-SUMMARY: the GitHub ship', () => {
  test('acceptance 3: a card with a summary gives the pull request that text, and the output says so before the number [R3] [R4] [R5]', () => {
    const s = shipOnce({ verdict: PASS_VERDICT, cardText: card(LINES) });
    assert.equal(s.r.outcome, 'merged', s.r.receipt.stdout);
    assert.deepEqual(s.creates, createArgs(`${SUMMARY}\n\n---\n${PASS}`));
    assert.deepEqual(bodyLines(s.lines), [['PR body: the PR summary of the card', 'PR #42']]);
  });

  test('acceptance 4: no card file, or a summary that holds @, gives the fixed line and its reason [R3] [R4]', () => {
    const none = shipOnce({ verdict: PASS_VERDICT });
    assert.equal(none.r.outcome, 'merged', none.r.receipt.stdout);
    assert.deepEqual(none.creates, createArgs(FIXED));
    assert.deepEqual(bodyLines(none.lines), [['PR body: the fixed line (no card file)', 'PR #42']]);
    const at = shipOnce({ verdict: PASS_VERDICT, cardText: card(swap('Card T1-A.', ['Card T1-A, by @someone.'])) });
    assert.equal(at.r.outcome, 'merged', at.r.receipt.stdout);
    assert.deepEqual(at.creates, createArgs(FIXED));
    assert.deepEqual(bodyLines(at.lines), [['PR body: the fixed line (the character @)', 'PR #42']]);
  });

  test('acceptance 5: the last line says pass only for a pass verdict of the head whose review completed [R3]', () => {
    const noPass: Array<[string, Record<string, unknown> | string | undefined]> = [
      ['no verdict file', undefined],
      ['a verdict file that does not parse', '{not json'],
      ['a pass for another commit', { verdict: 'pass', reasons: [], sha: OTHER }],
      ['a pass for the head whose run_status is tool_error', { ...PASS_VERDICT, run_status: 'tool_error' }],
      ['a block for another commit', { verdict: 'block', reasons: ['[spec] 1 x'], sha: OTHER }],
    ];
    for (const [name, verdict] of noPass) {
      const s = shipOnce({ verdict, cardText: card(LINES), requireVerdict: false });
      assert.equal(s.r.outcome, 'merged', `${name}: ${s.r.receipt.stdout}`);
      assert.deepEqual(s.creates, createArgs(`${SUMMARY}\n\n---\n${NO_PASS}`), name);
    }
    for (const verdict of [{ verdict: 'pass', reasons: [] }, { ...PASS_VERDICT, run_status: 'success' }]) {
      assert.deepEqual(shipOnce({ verdict, cardText: card(LINES) }).creates, createArgs(`${SUMMARY}\n\n---\n${PASS}`), JSON.stringify(verdict));
    }
  });

  test('acceptance 6: a ship that creates no pull request writes no PR body line [R5]', () => {
    const reused = shipOnce({ verdict: PASS_VERDICT, cardText: card(LINES), script: { 'gh pr list': { stdout: JSON.stringify([{ number: 8, state: 'OPEN', headRefOid: HEAD, baseRefName: 'main' }]) } } });
    assert.deepEqual([reused.r.outcome, reused.r.prNumber, reused.creates.length], ['merged', 8, 0], reused.r.receipt.stdout);
    const failed = shipOnce({ verdict: PASS_VERDICT, cardText: card(LINES), script: { 'gh pr create': { exitCode: 1, stderr: 'refused' } } });
    assert.deepEqual([failed.r.outcome, failed.creates.length], ['pr-failed', 1], failed.r.receipt.stdout);
    const unreviewed = shipOnce({ cardText: card(LINES) });
    assert.deepEqual([unreviewed.r.outcome, unreviewed.creates.length], ['review-no-verdict', 0], unreviewed.r.receipt.stdout);
    for (const s of [reused, failed, unreviewed]) assert.deepEqual(bodyLines(s.lines), [], s.r.receipt.stdout);
  });
});
