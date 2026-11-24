import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GitHubShipPath, prBody, shipWroteBody } from '../../src/delivery/github-ship.ts';
import { scriptedRunner, type ExecReceipt } from '../../src/probes/exec.ts';
import { tmpDir } from './helpers.ts';
import { shipPathFor } from '../../src/loop/card-runner.ts';
import { ProjectConfig } from '../../src/config.ts';

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
      ['the summary ends the text with no line feed', card(LINES, []).slice(0, -1)],
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
    const detail = swap('Card T1-A.', ['Card T1-A.', '#### Detail', '###x']);
    assert.deepEqual(prBody(card(detail), 'T1-A', true), { body: `${detail.join('\n')}\n\n---\n${PASS}` }, 'a line that starts with four hashes, or with three and no space, is text');
    const full = sized(4000);
    assert.equal(full.join('\n').length, 4000);
    assert.deepEqual(prBody(card(full), 'T1-A', true), { body: `${full.join('\n')}\n\n---\n${PASS}` }, '4000 characters are within the limit');
  });

  test('acceptance 2: each other text gets the fixed line and the first reason that applies [R2]', () => {
    const cases: Array<[string, string | undefined, string]> = [
      ['an undefined text', undefined, 'no card file'],
      ['an empty text', '', 'no PR summary section'],
      ['no summary line', HEAD_LINES.join('\n'), 'no PR summary section'],
      ['an indented summary line', card(LINES, undefined, '\n', '  ## PR summary'), 'no PR summary section'],
      ['a summary line with more text', card(LINES, undefined, '\n', '## PR summary notes'), 'no PR summary section'],
      ['no Risk heading', card(LINES.filter((l) => l !== '### Risk')), 'the headings are not the nine in order'],
      ['no Docs heading', card(LINES.slice(0, -2)), 'the headings are not the nine in order'],
      ['no heading', card(['Text alone.']), 'the headings are not the nine in order'],
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
      ['a NUL character', card(swap('Card T1-A.', ['Card T1-A.\0'])), 'a NUL character'],
      ['the character @ and a NUL character', card(swap('Card T1-A.', ['\0 by @someone.'])), 'the character @'],
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
    // A NUL character can be no argument of a process: the ship sends the fixed line and goes on.
    const nul = shipOnce({ verdict: PASS_VERDICT, cardText: card(swap('Card T1-A.', ['Card T1-A.\0'])) });
    assert.equal(nul.r.outcome, 'merged', nul.r.receipt.stdout);
    assert.deepEqual(nul.creates, createArgs(FIXED));
    assert.deepEqual(bodyLines(nul.lines), [['PR body: the fixed line (a NUL character)', 'PR #42']]);
  });

  test('acceptance 5: the last line says pass only for a pass verdict of the head whose review completed [R3]', () => {
    const noPass: Array<[string, Record<string, unknown> | string | undefined]> = [
      ['no verdict file', undefined],
      ['a verdict file that does not parse', '{not json'],
      ['a pass for another commit', { verdict: 'pass', reasons: [], sha: OTHER }],
      ['a pass whose sha is the empty string', { verdict: 'pass', reasons: [], sha: '' }],
      ['a pass for the head whose run_status is tool_error', { ...PASS_VERDICT, run_status: 'tool_error' }],
      ['a pass for the head whose run_status is the empty string', { ...PASS_VERDICT, run_status: '' }],
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
    // R3 decision 1, F1: with the default requireVerdict the gates take an empty sha as none, so the ship reaches the create call; the line still says no pass.
    const empty = shipOnce({ verdict: { verdict: 'pass', reasons: [], sha: '' }, cardText: card(LINES) });
    assert.equal(empty.r.outcome, 'merged', empty.r.receipt.stdout);
    assert.deepEqual(empty.creates, createArgs(`${SUMMARY}\n\n---\n${NO_PASS}`));
  });

  test('acceptance 6: a ship that creates no pull request writes no PR body line [R5]', () => {
    // The case of an open pull request that the ship uses again moved to T0-PR-SUMMARY-REUSED acceptance 2, which writes its text.
    const failed = shipOnce({ verdict: PASS_VERDICT, cardText: card(LINES), script: { 'gh pr create': { exitCode: 1, stderr: 'refused' } } });
    assert.deepEqual([failed.r.outcome, failed.creates.length], ['pr-failed', 1], failed.r.receipt.stdout);
    const unreviewed = shipOnce({ cardText: card(LINES) });
    assert.deepEqual([unreviewed.r.outcome, unreviewed.creates.length], ['review-no-verdict', 0], unreviewed.r.receipt.stdout);
    // A create call that fails in another way returns no number either: an exit 0 with no pull request address, and a timeout.
    const noNumber = shipOnce({ verdict: PASS_VERDICT, cardText: card(LINES), script: { 'gh pr create': { stdout: 'no address\n' } } });
    assert.deepEqual([noNumber.r.outcome, noNumber.creates.length], ['pr-failed', 1], noNumber.r.receipt.stdout);
    const timedOut = shipOnce({ verdict: PASS_VERDICT, cardText: card(LINES), script: { 'gh pr create': { timedOut: true, exitCode: 1 } } });
    assert.deepEqual([timedOut.r.outcome, timedOut.creates.length], ['effect-unknown', 1], timedOut.r.receipt.stdout);
    for (const s of [failed, unreviewed, noNumber, timedOut]) assert.deepEqual(bodyLines(s.lines), [], s.r.receipt.stdout);
  });
});

/** One remote ship of T1-A whose card file sits at `fileDir` in the worktree, with the `cardsDir` option given only when `opts` has the key. */
function shipFrom(fileDir: string, opts: { cardsDir?: string }, cardText = card(LINES)) {
  const root = tmpDir('aidlc-prsum-dir-');
  const wt = path.join(root, 'wt', 'T1-A');
  mkdirSync(path.join(wt, '.review'), { recursive: true });
  mkdirSync(path.join(wt, fileDir), { recursive: true });
  mkdirSync(path.join(root, '.git'), { recursive: true });
  writeFileSync(path.join(wt, '.review', 'T1-A.json'), JSON.stringify(PASS_VERDICT));
  writeFileSync(path.join(wt, fileDir, 'T1-A.md'), cardText);
  const creates: string[][] = [];
  const base = scriptedRunner(SCRIPT);
  const runner: typeof base = (cmd, args, o) => {
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') creates.push(args);
    return base(cmd, args, o);
  };
  const r = new GitHubShipPath({ mainRoot: root, worktreeRoot: path.join(root, 'wt'), repository: 'o/r', runner, sleep: () => {}, ...opts }).ship({ cardId: 'T1-A', base: 'main', mode: 'remote' });
  return { r, creates, lines: r.receipt.stdout.split('\n') };
}

describe('T0-PR-SUMMARY-CARDS-DIR: the configured cards directory', () => {
  const DIR_FIXED = 'Closed loop: worktree + TDD + independent review. DoD in docs/cards/T1-A.md.';
  const DIR_PASS = 'Card: docs/cards/T1-A.md. Formal review: pass.';
  const DIR_NO_PASS = 'Card: docs/cards/T1-A.md. Formal review: no pass recorded for this commit.';

  test('acceptance 1: prBody names the card path of the cards directory it is given, and specs/tasks when it is given none [R1]', () => {
    assert.deepEqual(prBody(card(LINES), 'T1-A', true, 'docs/cards'), { body: `${SUMMARY}\n\n---\n${DIR_PASS}` });
    assert.deepEqual(prBody(card(LINES), 'T1-A', false, 'docs/cards'), { body: `${SUMMARY}\n\n---\n${DIR_NO_PASS}` });
    assert.deepEqual(prBody(undefined, 'T1-A', true, 'docs/cards'), { body: DIR_FIXED, reason: 'no card file' });
    assert.deepEqual(prBody(card(swap('Card T1-A.', ['@someone'])), 'T1-A', true, 'docs/cards'), { body: DIR_FIXED, reason: 'the character @' });
    for (const [text, reviewed] of [[card(LINES), true], [card(LINES), false], [undefined, true], [HEAD_LINES.join('\n'), true]] as const) {
      const three = prBody(text, 'T1-A', reviewed);
      assert.deepEqual(prBody(text, 'T1-A', reviewed, undefined), three);
      assert.ok(three.body.includes('specs/tasks/T1-A.md') && !three.body.includes('docs/cards'), three.body);
    }
  });

  test('acceptance 2: the ship reads the card file from its cardsDir and the body names that path [R2] [R4]', () => {
    const dir = shipFrom('docs/cards', { cardsDir: 'docs/cards' });
    assert.equal(dir.r.outcome, 'merged', dir.r.receipt.stdout);
    assert.deepEqual(dir.creates, createArgs(`${SUMMARY}\n\n---\n${DIR_PASS}`));
    assert.deepEqual(bodyLines(dir.lines), [['PR body: the PR summary of the card', 'PR #42']]);
    const elsewhere = shipFrom('specs/tasks', { cardsDir: 'docs/cards' });
    assert.equal(elsewhere.r.outcome, 'merged', elsewhere.r.receipt.stdout);
    assert.deepEqual(elsewhere.creates, createArgs(DIR_FIXED));
    assert.deepEqual(bodyLines(elsewhere.lines), [['PR body: the fixed line (no card file)', 'PR #42']]);
    for (const [name, opts] of [['no cardsDir key', {}], ['cardsDir undefined', { cardsDir: undefined }]] as const) {
      const plain = shipFrom('specs/tasks', opts);
      assert.equal(plain.r.outcome, 'merged', `${name}: ${plain.r.receipt.stdout}`);
      assert.deepEqual(plain.creates, createArgs(`${SUMMARY}\n\n---\n${PASS}`), name);
      assert.deepEqual(bodyLines(plain.lines), [['PR body: the PR summary of the card', 'PR #42']], name);
    }
    // Apart from the --body value, the calls of a ship from another directory are those of the default one.
    const strip = (calls: string[][]) => calls.map((a) => a.slice(0, -1));
    assert.deepEqual(strip(dir.creates), strip(shipFrom('specs/tasks', {}).creates));
  });

  test('acceptance 3: shipPathFor gives the GitHub ship path the configured cardsDir [R3]', () => {
    const runner = scriptedRunner({});
    const other = shipPathFor(ProjectConfig.parse({ shipPath: 'github', repository: 'o/r', cardsDir: 'docs/cards' }), tmpDir('aidlc-prsum-cfg-'), runner);
    assert.ok(other instanceof GitHubShipPath);
    assert.equal(other.options.cardsDir, 'docs/cards');
    const plain = shipPathFor(ProjectConfig.parse({ shipPath: 'github', repository: 'o/r' }), tmpDir('aidlc-prsum-cfg-'), runner);
    assert.ok(plain instanceof GitHubShipPath);
    assert.equal(plain.options.cardsDir, 'specs/tasks');
  });
});

/** The listing of one pull request 8 for T1-A in the given state. */
const listed = (state: 'OPEN' | 'MERGED'): Partial<ExecReceipt> => ({ stdout: JSON.stringify([{ number: 8, state, headRefOid: HEAD, baseRefName: 'main', ...(state === 'MERGED' ? { mergedAt: '2026-09-11T00:00:00.000Z' } : {}) }]) });
const isBodyView = (args: string[]): boolean => args[0] === 'pr' && args[1] === 'view' && args.includes('--json') && args[args.indexOf('--json') + 1] === 'body';

/**
 * One remote ship of T1-A with every gh call recorded. By default `gh pr list` lists open pull request 8, the view of its
 * text prints `current` as its body, and `gh pr edit` exits 0; `view` and `edit` replace those receipts.
 */
function shipReused(opts: { current?: unknown; cardText?: string; verdict?: Record<string, unknown>; view?: Partial<ExecReceipt>; edit?: Partial<ExecReceipt>; script?: Record<string, Partial<ExecReceipt>> }) {
  const root = tmpDir('aidlc-prsum-reused-');
  const wt = path.join(root, 'wt', 'T1-A');
  mkdirSync(path.join(wt, '.review'), { recursive: true });
  mkdirSync(path.join(wt, 'specs', 'tasks'), { recursive: true });
  mkdirSync(path.join(root, '.git'), { recursive: true });
  if (opts.verdict !== undefined) writeFileSync(path.join(wt, '.review', 'T1-A.json'), JSON.stringify(opts.verdict));
  if (opts.cardText !== undefined) writeFileSync(path.join(wt, 'specs', 'tasks', 'T1-A.md'), opts.cardText);
  const merged = SCRIPT['gh pr view']!;
  const base = scriptedRunner({
    ...SCRIPT,
    'gh pr list': listed('OPEN'),
    'gh pr view': (args) => (isBodyView(args) ? (opts.view ?? { stdout: JSON.stringify({ body: opts.current }) }) : merged),
    'gh pr edit': opts.edit ?? {},
    ...opts.script,
  });
  const calls: string[][] = [];
  const runner: typeof base = (cmd, args, o) => {
    if (cmd === 'gh') calls.push(args);
    return base(cmd, args, o);
  };
  const r = new GitHubShipPath({ mainRoot: root, worktreeRoot: path.join(root, 'wt'), repository: 'o/r', runner, sleep: () => {} }).ship({ cardId: 'T1-A', base: 'main', mode: 'remote' });
  const lines = r.receipt.stdout.split('\n');
  return {
    r,
    lines,
    views: calls.filter(isBodyView),
    edits: calls.filter((a) => a[0] === 'pr' && a[1] === 'edit'),
    creates: calls.filter((a) => a[0] === 'pr' && a[1] === 'create'),
    merges: calls.filter((a) => a[0] === 'pr' && a[1] === 'merge'),
  };
}
const VIEW_ARGS = [['pr', 'view', '8', '--repo', 'o/r', '--json', 'body']];
const editArgs = (body: string): string[][] => [['pr', 'edit', '8', '--repo', 'o/r', '--body', body]];
const NEW_BODY = `${SUMMARY}\n\n---\n${PASS}`;
/** The output lines that start with a bracket: the sentinels. */
const bracketed = (lines: string[]): string[] => lines.filter((l) => l.startsWith('['));

describe('T0-PR-SUMMARY-REUSED: the text of an open pull request the ship uses again', () => {
  test('acceptance 1: shipWroteBody is true only for the fixed line or a text whose last line is the Card: line [R1]', () => {
    const summaryPass = `${SUMMARY}\n\n---\n${PASS}`;
    const summaryNoPass = `${SUMMARY}\n\n---\n${NO_PASS}`;
    const yes: Array<[string, string, string | undefined]> = [
      ['the fixed line', FIXED, undefined],
      ['the fixed line of docs/cards', 'Closed loop: worktree + TDD + independent review. DoD in docs/cards/T1-A.md.', 'docs/cards'],
      ['the fixed line of specs/tasks under docs/cards', FIXED, 'docs/cards'],
      ['a summary with the pass line', summaryPass, undefined],
      ['a summary with the no-pass line', summaryNoPass, undefined],
      ['a summary with the pass line of docs/cards', `${SUMMARY}\n\n---\nCard: docs/cards/T1-A.md. Formal review: pass.`, 'docs/cards'],
      ['a summary with the no-pass line of specs/tasks under docs/cards', summaryNoPass, 'docs/cards'],
    ];
    for (const [name, body, dir] of yes) {
      const forms: Array<[string, string]> = [
        ['as is', body],
        ['CRLF', body.replace(/\n/g, '\r\n')],
        ['a trailing newline and spaces', `${body}\n  \n `],
        ['CRLF and a trailing CRLF', `${body.replace(/\n/g, '\r\n')}\r\n`],
      ];
      for (const [form, text] of forms) assert.equal(shipWroteBody(text, 'T1-A', dir), true, `${name}, ${form}`);
    }
    const no: Array<[string, string, string | undefined]> = [
      ['the empty string', '', undefined],
      ['a text a person wrote', 'Fixes the ship.\n\nThanks.', undefined],
      ['a Card: line that is not the last line', `${summaryPass}\n\nEdited by hand.`, undefined],
      ['a Card: line of T1-B', `${SUMMARY}\n\n---\nCard: specs/tasks/T1-B.md. Formal review: pass.`, undefined],
      ['the fixed line of T1-B', 'Closed loop: worktree + TDD + independent review. DoD in specs/tasks/T1-B.md.', undefined],
      ['a Card: line with another review word', `${SUMMARY}\n\n---\nCard: specs/tasks/T1-A.md. Formal review: block.`, undefined],
      ['a fixed line of other/T1-A.md under docs/cards', 'Closed loop: worktree + TDD + independent review. DoD in other/T1-A.md.', 'docs/cards'],
      ['a Card: line of docs/cards with no cardsDir', `${SUMMARY}\n\n---\nCard: docs/cards/T1-A.md. Formal review: pass.`, undefined],
      ['the fixed line after another word', `Note: ${FIXED}`, undefined],
    ];
    for (const [name, body, dir] of no) assert.equal(shipWroteBody(body, 'T1-A', dir), false, name);
  });

  test('acceptance 2: a ship that uses open pull request 8 writes the new text over a text the ship wrote [R2] [R3]', () => {
    const s = shipReused({ verdict: PASS_VERDICT, cardText: card(LINES), current: FIXED });
    assert.deepEqual([s.r.outcome, s.r.prNumber, s.creates.length], ['merged', 8, 0], s.r.receipt.stdout);
    assert.deepEqual(s.views, VIEW_ARGS);
    assert.deepEqual(s.edits, editArgs(NEW_BODY));
    assert.deepEqual(bodyLines(s.lines), [['PR body: updated, the PR summary of the card', 'PR #8']]);
    const none = shipReused({ verdict: PASS_VERDICT, current: NEW_BODY });
    assert.deepEqual([none.r.outcome, none.r.prNumber, none.creates.length], ['merged', 8, 0], none.r.receipt.stdout);
    assert.deepEqual(none.views, VIEW_ARGS);
    assert.deepEqual(none.edits, editArgs(FIXED));
    assert.deepEqual(bodyLines(none.lines), [['PR body: updated, the fixed line (no card file)', 'PR #8']]);
  });

  test('acceptance 3: the same text, or a text a person wrote, is not written [R2] [R3]', () => {
    const same = shipReused({ verdict: PASS_VERDICT, cardText: card(LINES), current: `${NEW_BODY.replace(/\n/g, '\r\n')}\r\n` });
    assert.equal(same.r.outcome, 'merged', same.r.receipt.stdout);
    assert.deepEqual([same.views, same.edits], [VIEW_ARGS, []]);
    assert.deepEqual(bodyLines(same.lines), [['PR body: unchanged', 'PR #8']]);
    const person = shipReused({ verdict: PASS_VERDICT, cardText: card(LINES), current: 'Fixes the ship.\n\nThanks.' });
    assert.equal(person.r.outcome, 'merged', person.r.receipt.stdout);
    assert.deepEqual([person.views, person.edits], [VIEW_ARGS, []]);
    assert.deepEqual(bodyLines(person.lines), [['PR body: kept (the current text was not written by the ship)', 'PR #8']]);
  });

  test('acceptance 4: a failed read or edit is one line, and the ship goes on to the merge [R3] [R4]', () => {
    const ok = shipReused({ verdict: PASS_VERDICT, cardText: card(LINES), current: FIXED });
    const READ = 'PR body: not updated (could not read the current text: ';
    const EDIT = 'PR body: not updated (gh pr edit ';
    const cases: Array<[string, Parameters<typeof shipReused>[0], string, number]> = [
      ['a view that exits 1', { view: { exitCode: 1, stderr: 'HTTP 502\n[SAGA-FAIL] x' } }, READ, 0],
      ['a view that times out', { view: { timedOut: true, exitCode: null } }, READ, 0],
      ['a view that prints no JSON', { view: { stdout: '{not json' } }, READ, 0],
      ['a view whose body is a number', { current: 7 }, READ, 0],
      ['an edit that exits 1', { current: FIXED, edit: { exitCode: 1, stderr: '[SAGA-FAIL] boom' } }, EDIT, 1],
      ['an edit that times out', { current: FIXED, edit: { timedOut: true, exitCode: null } }, EDIT, 1],
    ];
    for (const [name, opts, prefix, edits] of cases) {
      const s = shipReused({ verdict: PASS_VERDICT, cardText: card(LINES), ...opts });
      assert.deepEqual([s.r.outcome, s.r.prNumber, s.merges.length, s.edits.length], ['merged', 8, 1, edits], `${name}: ${s.r.receipt.stdout}`);
      const body = bodyLines(s.lines);
      const line = body[0]?.[0] ?? '';
      const next = body[0]?.[1];
      assert.equal(body.length, 1, `${name}: ${s.r.receipt.stdout}`);
      assert.ok(line.startsWith(prefix), `${name}: ${line}`);
      assert.equal(next, 'PR #8', name);
      assert.ok(!line.includes('['), `${name}: ${line}`);
      assert.deepEqual(bracketed(s.lines), bracketed(ok.lines), name);
    }
  });

  test('acceptance 5: a ship that creates the pull request, finds it merged or ends before the push neither reads nor writes its text [R5]', () => {
    const fresh = { 'gh pr list': { stdout: '[]' } };
    const cases: Array<[string, Parameters<typeof shipReused>[0], string]> = [
      ['a new pull request', { verdict: PASS_VERDICT, cardText: card(LINES), script: fresh }, 'merged'],
      ['a create call that exits 1', { verdict: PASS_VERDICT, cardText: card(LINES), script: { ...fresh, 'gh pr create': { exitCode: 1, stderr: 'refused' } } }, 'pr-failed'],
      ['no verdict', { cardText: card(LINES), script: fresh }, 'review-no-verdict'],
      ['a create call with no address', { verdict: PASS_VERDICT, cardText: card(LINES), script: { ...fresh, 'gh pr create': { stdout: 'no address\n' } } }, 'pr-failed'],
      ['a create call that times out', { verdict: PASS_VERDICT, cardText: card(LINES), script: { ...fresh, 'gh pr create': { timedOut: true, exitCode: 1 } } }, 'effect-unknown'],
      ['pull request 8 merged', { verdict: PASS_VERDICT, cardText: card(LINES), current: FIXED, script: { 'gh pr list': listed('MERGED') } }, 'merged'],
      ['a push that exits 1', { verdict: PASS_VERDICT, cardText: card(LINES), current: FIXED, script: { 'git push': { exitCode: 1, stderr: 'rejected' } } }, 'push-failed'],
    ];
    for (const [name, opts, outcome] of cases) {
      const s = shipReused(opts);
      assert.equal(s.r.outcome, outcome, `${name}: ${s.r.receipt.stdout}`);
      assert.deepEqual([s.views, s.edits], [[], []], name);
      const expected = name === 'a new pull request' ? [['PR body: the PR summary of the card', 'PR #42']] : [];
      assert.deepEqual(bodyLines(s.lines), expected, name);
    }
  });
});
