import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DryRunShipPath, ScaffoldShipPath, classifyShipOutput, type ShipOutcomeClass } from '../../src/delivery/ship.ts';
import type { ExecReceipt } from '../../src/probes/exec.ts';
import { normaliseCause } from '../../src/core/effort.ts';
import { cleanup, tmpDir } from './helpers.ts';

function receipt(stdout: string, exitCode = 1, extra: Partial<ExecReceipt> = {}): ExecReceipt {
  const now = new Date().toISOString();
  return { command: 'pwsh', args: [], cwd: '', exitCode, signal: null, timedOut: false, stdout, stderr: '', startedAt: now, finishedAt: now, durationMs: 0, outputSha256: '', ...extra };
}

// One representative sentinel per class of the (module-private) SENTINEL_MAP, in its precedence order.
const SENTINELS: Array<[string, ShipOutcomeClass]> = [
  ['[SHIP-MERGE-FAIL]', 'merge-failed'],
  ['[SHIP-BASE-SYNC-CONFLICT]', 'merge-failed'],
  ['[SHIP-BASE-SYNC-FAIL]', 'merge-failed'],
  ['[CI-GATE-TIMEOUT]', 'ci-timeout'],
  ['[CI-GATE-RED]', 'ci-red'],
  ['[CI-GATE-HEAD-MOVED]', 'ci-red'],
  ['[R3-SPEC-BLOCK]', 'review-blocked'],
  ['[R3-ROUND-CAP]', 'review-blocked'],
  ['[R3-REVIEWER-TIMEOUT]', 'review-no-verdict'],
  ['[R3-STALE-VERDICT-SHA]', 'review-no-verdict'],
  ['[R3-BAD-VERDICT-JSON]', 'review-no-verdict'],
  ['[SHIP-NO-REVIEWER]', 'no-reviewer'],
  ['[SHIP-PR-RETARGET]', 'pr-failed'],
  ['[SHIP-PUSH-FAIL]', 'push-failed'],
  ['[CARD-BUDGET-OVER]', 'budget-over'],
  ['[R3-DIFF-TOO-LARGE]', 'budget-over'],
  ['[SHIP-SCOPE-BLOCK]', 'scope-blocked'],
  ['[SHIP-SCOPE-ALLOW-EMPTY]', 'scope-blocked'],
  ['先跑：gh auth login', 'auth-failed'],
  ['缺少 RED 证据（.review\\T1-FOO.red）', 'red-missing'],
  ['检出疑似机密（见上 check-secrets）', 'secrets-blocked'],
  ['依赖许可不合规（见 docs/LICENSE-POLICY.md）', 'license-blocked'],
  ['verify: FAIL', 'verify-failed'],
  ['DoD 未通过（退出码 1）。修绿再 ship。', 'dod-failed'],
];

describe('delivery/ship (classification of the scaffold ship saga)', () => {
  it('maps every known sentinel to its outcome class', () => {
    for (const [sentinel, cls] of SENTINELS) {
      const r = classifyShipOutput(receipt(`[SAGA-FAIL] leg failed\n${sentinel}\n`));
      assert.equal(r.outcome, cls, `${sentinel} -> ${r.outcome}`);
      if (sentinel.startsWith('[')) assert.ok(r.sentinels.includes(sentinel), `sentinels should list ${sentinel}`);
    }
  });

  it('exit 0 without a saga failure is merged; exit 0 with SAGA-FAIL still classifies the sentinel', () => {
    const merged = classifyShipOutput(receipt('[SHIP-TIME] merge 3s\n[SAGA-DONE]\n', 0));
    assert.equal(merged.outcome, 'merged');
    assert.match(merged.detail, /exited 0/);
    const plain = classifyShipOutput(receipt('all good', 0));
    assert.equal(plain.outcome, 'merged');
    const contradictory = classifyShipOutput(receipt('[SAGA-FAIL]\n[CI-GATE-RED]\n', 0));
    assert.equal(contradictory.outcome, 'ci-red');
  });

  it('captures the resume command and PR number; timeouts and unknown exits are unclassified', () => {
    const r = classifyShipOutput(receipt('[SAGA-FAIL] CI-gate\n[CI-GATE-RED] job ci red\nPR #17 opened\n[SAGA-RESUME] pwsh -File scripts\\task.ps1 -TaskId T1-FOO -Phase ship -Base main\n'));
    assert.equal(r.outcome, 'ci-red');
    assert.equal(r.prNumber, 17);
    assert.equal(r.resumeCommand, 'pwsh -File scripts\\task.ps1 -TaskId T1-FOO -Phase ship -Base main');
    const timeout = classifyShipOutput(receipt('[SHIP-TIME] DoD 12s', null as unknown as number, { timedOut: true }));
    assert.equal(timeout.outcome, 'unclassified');
    assert.match(timeout.detail, /timed out; reconcile before retry/);
    const unknown = classifyShipOutput(receipt('something odd happened', 1));
    assert.equal(unknown.outcome, 'unclassified');
    assert.match(unknown.detail, /exit 1 with no known sentinel/);
  });
});

describe('delivery/ship ScaffoldShipPath (file contracts)', () => {
  const dir = tmpDir();
  const mainRoot = path.join(dir, 'repo');
  const worktreeRoot = path.join(dir, 'wt');
  after(() => cleanup(dir));

  it('readVerdict reads .review/<branch>.json and .rounds from the card worktree', () => {
    const review = path.join(worktreeRoot, 'T1-FOO', '.review');
    mkdirSync(review, { recursive: true });
    writeFileSync(path.join(review, 'T1-FOO.json'), JSON.stringify({ verdict: 'block', reasons: ['[spec] 6 tests missing'], sha: 'abc', branch: 'T1-FOO', run_status: 'success', axes: { spec: { verdict: 'block', reasons: ['tests'] }, standards: { verdict: 'pass', reasons: [] } } }), 'utf8');
    writeFileSync(path.join(review, 'T1-FOO.rounds'), '2\n', 'utf8');
    const ship = new ScaffoldShipPath({ mainRoot, worktreeRoot });
    const v = ship.readVerdict('T1-FOO');
    assert.equal(v.file, path.join(review, 'T1-FOO.json'));
    assert.equal(v.rounds, 2);
    assert.equal(v.verdict?.verdict, 'block');
    assert.equal(v.verdict?.axes?.spec?.verdict, 'block');
    assert.equal(v.verdict?.run_status, 'success');
    // malformed or wrongly-cased verdicts are not verdicts
    writeFileSync(path.join(review, 'T1-FOO.json'), JSON.stringify({ verdict: 'BLOCK', reasons: [] }), 'utf8');
    assert.equal(ship.readVerdict('T1-FOO').verdict, undefined);
    writeFileSync(path.join(review, 'T1-FOO.json'), 'prose, not json', 'utf8');
    const raw = ship.readVerdict('T1-FOO');
    assert.equal(raw.verdict, undefined);
    assert.equal(raw.raw, 'prose, not json');
    assert.deepEqual(ship.readVerdict('T2-NONE'), { file: path.join(worktreeRoot, 'T2-NONE', '.review', 'T2-NONE.json'), rounds: undefined });
  });

  it('readRedReceipt reads the RED phase receipt', () => {
    const review = path.join(worktreeRoot, 'T1-RED', '.review');
    mkdirSync(review, { recursive: true });
    writeFileSync(path.join(review, 'T1-RED.red'), JSON.stringify({ taskId: 'T1-RED', sha: '(no-commit-yet)', dodExit: 1, phase: 'red' }), 'utf8');
    const ship = new ScaffoldShipPath({ mainRoot, worktreeRoot });
    assert.deepEqual(ship.readRedReceipt('T1-RED'), { taskId: 'T1-RED', sha: '(no-commit-yet)', dodExit: 1, phase: 'red' });
    assert.equal(ship.readRedReceipt('T1-NONE'), undefined);
  });

  it('readMergeToken parses the T24 merge credential from the git common dir', () => {
    const tokens = path.join(mainRoot, '.git', 'scaffold-merged');
    mkdirSync(tokens, { recursive: true });
    writeFileSync(path.join(tokens, 'T1-FOO'), 'tip=abcdef0123456789abcdef0123456789abcdef01\nmerged_pr=#12\nutc=2026-09-11T10:00:00Z\n', 'utf8');
    writeFileSync(path.join(tokens, 'T1-LOCAL'), 'tip=1111\nmerged=2222\nutc=2026-09-11T11:00:00Z', 'utf8');
    const ship = new ScaffoldShipPath({ mainRoot, worktreeRoot });
    assert.deepEqual(ship.readMergeToken('T1-FOO'), { tip: 'abcdef0123456789abcdef0123456789abcdef01', mergedPr: 12, utc: '2026-09-11T10:00:00Z' });
    assert.deepEqual(ship.readMergeToken('T1-LOCAL'), { tip: '1111', merged: '2222', utc: '2026-09-11T11:00:00Z' });
    assert.equal(ship.readMergeToken('T1-NONE'), undefined);
  });

  it('ship() drives task.ps1 from the main checkout with preserved base and mode', () => {
    const seen: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
    const ship = new ScaffoldShipPath({
      mainRoot,
      worktreeRoot,
      pwsh: 'pwsh-test',
      runner: (cmd, args, options) => {
        seen.push({ cmd, args, cwd: options?.cwd });
        return receipt('[SAGA-DONE]\n', 0);
      },
    });
    const r = ship.ship({ cardId: 'T1-FOO', base: 'origin/main', mode: 'local', skipRed: true, noAutoMerge: true });
    assert.equal(r.outcome, 'merged');
    assert.equal(seen[0]!.cmd, 'pwsh-test');
    assert.equal(seen[0]!.cwd, mainRoot);
    assert.deepEqual(seen[0]!.args, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(mainRoot, 'scripts', 'task.ps1'), '-TaskId', 'T1-FOO', '-Phase', 'ship', '-Base', 'origin/main', '-Local', '-SkipRed', '-NoAutoMerge']);
    ship.phase('T1-FOO', 'cleanup', ['-Force']);
    assert.deepEqual(seen[1]!.args.slice(-3), ['-Phase', 'cleanup', '-Force']);
    assert.equal(ship.worktreePath('T1-FOO'), path.join(worktreeRoot, 'T1-FOO'));
  });
});

describe('delivery/ship DryRunShipPath', () => {
  it('returns scripted outcomes in order, clamping to the last one, and records requests', () => {
    const dry = new DryRunShipPath(['dod-failed', 'review-blocked', 'merged'], { verdict: 'pass', reasons: [] });
    const req = { cardId: 'T1-FOO', base: 'main', mode: 'remote' as const };
    assert.equal(dry.ship(req).outcome, 'dod-failed');
    assert.equal(dry.ship(req).outcome, 'review-blocked');
    assert.equal(dry.ship(req).outcome, 'merged');
    assert.equal(dry.ship(req).outcome, 'merged');
    assert.equal(dry.requests.length, 4);
    assert.equal(dry.ship(req).receipt.exitCode, 0);
    assert.equal(new DryRunShipPath(['ci-red']).ship(req).receipt.exitCode, 1);
    assert.equal(dry.readVerdict().verdict?.verdict, 'pass');
    assert.equal(dry.readMergeToken(), undefined);
    assert.equal(new DryRunShipPath().ship(req).outcome, 'merged');
  });
});

describe('delivery/ship failing line (T0-SHIP-FAILING-LINE-2)', () => {
  type Counted = 'dod-failed' | 'verify-failed' | 'scope-blocked' | 'budget-over';
  // The constant detail each counted outcome had before this card: the first alternative of its sentinel pattern.
  const SENT: Record<Counted, string> = {
    'dod-failed': 'sentinel DoD 未通过',
    'verify-failed': 'sentinel verify\\.ps1 未过',
    'scope-blocked': 'sentinel \\[SHIP-SCOPE-BLOCK\\]',
    'budget-over': 'sentinel \\[CARD-BUDGET-OVER\\]',
  };
  const SAGA = '[SAGA-FAIL] ship\n[SAGA-RESUME] pwsh -File scripts\\task.ps1 -TaskId T1-FOO -Phase ship -Base main';
  const dodText = (...lines: string[]) => ['=== R2 DoD 闸门（必须全绿） ===', '运行: node --test', 'TAP version 13', 'ok 1 - passes', ...lines, '# fail 1', 'DoD 未通过（退出码 1）。修绿再 ship。', SAGA].join('\n');
  const verifyText = (...lines: string[]) => ['ok 1 - the card DoD', '=== R2 verify 总闸 ===', ...lines, 'WARNING: pytest 失败（退出码 1）', 'verify: FAIL', 'verify.ps1 未过（项目级回归红）。修绿再 ship。', SAGA].join('\n');
  const TEXT: Record<'dod-failed' | 'verify-failed', (...lines: string[]) => string> = { 'dod-failed': dodText, 'verify-failed': verifyText };

  /** The one check of a counted outcome: its class, and a detail naming the line (or the constant detail when `line` is undefined). */
  function expectDetail(outcome: Counted, r: ReturnType<typeof classifyShipOutput>, line: string | undefined, label: string): void {
    assert.equal(r.outcome, outcome, `${label}: outcome`);
    assert.equal(r.detail, line === undefined ? SENT[outcome] : `${SENT[outcome]}; failing line: ${line}`, `${label}: detail`);
  }

  /** Classify a receipt: the input is never changed and the result carries it as given (T0-SHIP-FAILING-LINE R3 decision 1 F1). */
  function kept(input: ExecReceipt): ReturnType<typeof classifyShipOutput> {
    const snapshot = structuredClone(input);
    const r = classifyShipOutput(input);
    assert.deepEqual(input, snapshot, 'the input receipt is unchanged');
    assert.deepEqual(r.receipt, snapshot, 'the result carries the receipt as given');
    return r;
  }

  // Each failing-line shape R1 lists, and the line it gives: ANSI-free, normalised as causes are, encoded.
  const SHAPES: Array<[string, string]> = [
    ['not ok 3 - parses the header', 'not ok N - parses the header'],
    ['    not ok 12 - a nested case', 'not ok N - a nested case'],
    ['not ok 8 - handles \\#skip tags', 'not ok N - handles \\#skip tags'],
    ['✖ parses the header (1.234ms)', '✖ parses the header (N.Nms)'],
    ["src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.", "src/a.ts(N,N): error tsN: type 'string' is not assignable to type 'number'."],
    ["src/a.ts:3:7 - error TS2304: Cannot find name 'x'.", "src/a.ts:N:N - error tsN: cannot find name 'x'."],
    ['error TS5083: Cannot read file tsconfig.json.', 'error tsN: cannot read file tsconfig.json.'],
    ['C:\\x\\a.ts(3,7): error TS2322: y', 'c:\\x\\a.ts(N,N): error tsN: y'],
    ['--- FAIL: TestParse (0.00s)', '--- fail: testparse (N.Ns)'],
    ['FAIL  src/a.test.ts', 'fail src/a.test.ts'],
    ['FAILED tests/test_a.py::test_parse - AssertionError: x', 'failed tests/test_a.py::test_parse - assertionerror: x'],
    // A directive is a word: a description with a longer word after the hash is not one; a spec test may be named like the heading.
    ['not ok 10 - counts # todos', 'not ok N - counts # todos'],
    ['✖ failing tests are reported (2ms)', '✖ failing tests are reported (Nms)'],
    // Controls, the Unicode line separator included, are spaces before the shape is matched.
    ['✖\u2028a separated name', '✖ a separated name'],
  ];

  it('acceptance 1: a dod-failed or verify-failed receipt names its first failing test or compile line, for every shape', () => {
    for (const outcome of ['dod-failed', 'verify-failed'] as const) {
      for (const [raw, line] of SHAPES) expectDetail(outcome, kept(receipt(TEXT[outcome](raw))), line, `${outcome} ${raw}`);
      // The first failing line in receipt order, whatever its shape; stdout is read before stderr.
      const several = TEXT[outcome]('ok 2 - also passes', "src/b.ts(1,1): error TS1005: ';' expected.", 'not ok 3 - b', '✖ c (1ms)', 'FAILED tests/d.py::d');
      expectDetail(outcome, kept(receipt(several)), "src/b.ts(N,N): error tsN: ';' expected.", `${outcome} several`);
      expectDetail(outcome, kept(receipt(TEXT[outcome](), 1, { stderr: 'not ok 1 - from stderr' })), 'not ok N - from stderr', `${outcome} stderr`);
      expectDetail(outcome, kept(receipt(TEXT[outcome]('not ok 1 - from stdout'), 1, { stderr: 'not ok 2 - from stderr' })), 'not ok N - from stdout', `${outcome} stdout first`);
    }
  });

  it('acceptance 1: a passing line, a TODO or SKIP line, the spec heading and a FAIL word inside a line are never the failing line', () => {
    const NOT_FAILING = [
      'ok 1 - passes', 'not ok 4 - pending # TODO later', 'not ok 5 - no db # SKIP', 'not ok 6 - lower # todo', 'not ok 7 - tight #SKIP', 'not okay 1 - x', 'not ok', 'not ok   ',
      '✖ failing tests:', '✖ failing tests', '✖', '✖   ', '--- FAIL:', '--- FAIL:   ', 'the FAIL count is 0', 'FAIL', 'FAIL   ', 'FAILED', 'FAILURE: x', 'FAILEDx y',
      'error TS: x', 'errorTS2322: x', '# fail 1', 'failed tests/a.py::t', 'WARNING: gate 2 integration/e2e failed (exit code 1)',
      // Each shape is matched at the start of the line, in its own letter case, with its number and word boundaries.
      'not ok - no number', 'not ok 1x - y', 'ok 3 - says not ok 4 - inside', 'NOT OK 1 - x', 'suberror TS2322: x', 'Error TS2322: x', 'see --- FAIL: TestX above',
      // A TAP test line carrying another shape is still judged by the TAP rule (T0-SHIP-FAILING-LINE R3 decision 1 F3), and a TypeScript
      // diagnostic is read only at the start of the line or after a location without spaces.
      'ok 1 - error TS2322: handled', 'not ok 1 - error TS2322: pending # TODO later', 'not ok 2 - error TS2322: skipped # SKIP',
      'ok 3 - src/a.ts(1,2): error TS2322: x', 'not ok 4 - FAIL src/a.test.ts # SKIP', 'ok 5 - --- FAIL: TestX', 'not ok 6 - ✖ x # TODO',
      '# Subtest: src/a.ts(1,2): error TS2322: x', '✔ src/a.ts(1,2): error TS2322: handled (1ms)', 'reported error TS2322: in a log line',
      'C:/My Project/a.ts(1,2): error TS2322: x',
    ];
    for (const outcome of ['dod-failed', 'verify-failed'] as const) {
      for (const raw of NOT_FAILING) expectDetail(outcome, kept(receipt(TEXT[outcome](raw))), undefined, `${outcome} ${JSON.stringify(raw)}`);
      // A non-failing line before a failing one is skipped, not taken.
      expectDetail(outcome, kept(receipt(TEXT[outcome](...NOT_FAILING, 'not ok 9 - the real one'))), 'not ok N - the real one', `${outcome} after non-failing lines`);
    }
  });

  it('acceptance 2: a scope-blocked or budget-over receipt names its gate line; two budget lines that differ only in their counts are one detail', () => {
    const scope = "[SHIP-SCOPE-BLOCK] out-of-scope changes (not under the card's allow_paths): src/a.ts, docs/b.md";
    const scopeText = (gate: string) => ['[SAGA-FAIL] scope', 'not ok 1 - a DoD line is not a gate line', gate, 'Fix (L18): revert card-external changes out of this branch with a reverse commit', SAGA].join('\n');
    expectDetail('scope-blocked', kept(receipt(scopeText(scope))), "%5Bship-scope-block%5D out-of-scope changes (not under the card's allow_paths): src/a.ts, docs/b.md", 'scope block');
    expectDetail('scope-blocked', kept(receipt(scopeText("Exception: [SHIP-SCOPE-ALLOW-EMPTY] no allow_paths list items parsed from the front-matter"))), 'exception: %5Bship-scope-allow-empty%5D no allow_paths list items parsed from the front-matter', 'scope allow-empty');
    const budget = (used: number, limit: number) => `[CARD-BUDGET-OVER] this card's diff is ${used} lines against a budget of ${limit} declared on the BASE card`;
    const over = kept(receipt([budget(812, 720), SAGA].join('\n')));
    expectDetail('budget-over', over, "%5Bcard-budget-over%5D this card's diff is N lines against a budget of N declared on the base card", 'budget over');
    assert.equal(kept(receipt([budget(905, 400), SAGA].join('\n'))).detail, over.detail, 'the counts are normalised');
    expectDetail('budget-over', kept(receipt(['[R3-DIFF-TOO-LARGE] diff of 2400 lines exceeds 2000', SAGA].join('\n'))), '%5BrN-diff-too-large%5D diff of N lines exceeds N', 'diff too large');
  });

  it('acceptance 3: the failing line is a cause string only: escapes removed, controls as spaces, normalised, cut to 160 characters, encoded', () => {
    const raw = `\u001b[31m✖ [SAGA-DONE] 100% of [x]\tcase\u2028two\u0085three ${'long '.repeat(40)}(12ms)\u001b[39m`;
    const r = kept(receipt(dodText(raw)));
    const cut = normaliseCause(`✖ [SAGA-DONE] 100% of [x] case two three ${'long '.repeat(40)}(12ms)`).slice(0, 160);
    assert.equal(cut.length, 160);
    expectDetail('dod-failed', r, cut.replace(/%/g, '%25').replace(/\[/g, '%5B').replace(/\]/g, '%5D'), 'encoded');
    const line = r.detail.slice(`${SENT['dod-failed']}; failing line: `.length);
    assert.ok(!/[[\]\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(line), `no bracket or control character: ${JSON.stringify(line)}`);
    assert.ok(line.startsWith('✖ %5Bsaga-done%5D N%25 of %5Bx%5D case two three long'), line);
    // Nothing but the detail reads the line: the same receipt with a line that is not a failing line gives the same result.
    const plain = kept(receipt(dodText(raw.replace('✖', '·'))));
    expectDetail('dod-failed', plain, undefined, 'the same text, not a failing line');
    assert.deepEqual({ ...r, detail: '', receipt: undefined }, { ...plain, detail: '', receipt: undefined });
    assert.ok(r.sentinels.includes('[SAGA-DONE]') && r.resumeCommand === 'pwsh -File scripts\\task.ps1 -TaskId T1-FOO -Phase ship -Base main', 'sentinels and resume are read from the receipt as before');
  });

  it('acceptance 3: complete ANSI escape sequences are removed before the shape is matched (T0-SHIP-FAILING-LINE R3 decision 1 F2)', () => {
    const E = '\u001b';
    const WRAPPED = [
      `${E}[38:2:255:0:0mnot ok 1 - header${E}[0m`,
      `${E}[1;31mnot ok 1 - header${E}[22;39m`,
      `${E}]8;;https://example.test/a\u0007not ok 1 - header${E}]8;;\u0007`,
      `${E}]8;;https://example.test/a${E}\\not ok 1 - header${E}]8;;${E}\\`,
      `${E}[?25l${E}(Bnot ok 1 - header`,
      '\u009b31mnot ok 1 - header\u009b0m',
    ];
    for (const outcome of ['dod-failed', 'verify-failed'] as const) {
      for (const raw of WRAPPED) expectDetail(outcome, kept(receipt(TEXT[outcome](raw))), 'not ok N - header', `${outcome} ${JSON.stringify(raw)}`);
    }
  });

  it('acceptance 3: every terminal control sequence is removed from the whole receipt before it is split, so no payload line is read (T0-SHIP-FAILING-LINE R3 decision 2)', () => {
    const E = '\u001b';
    // OSC, DCS, SOS, PM and APC, with their 7-bit and 8-bit introducers; BEL, the 7-bit ST and the 8-bit ST.
    const INTRODUCERS = [`${E}]`, `${E}P`, `${E}X`, `${E}^`, `${E}_`, '\u009d', '\u0090', '\u0098', '\u009e', '\u009f'];
    const TERMINATORS = ['\u0007', `${E}\\`, '\u009c'];
    for (const outcome of ['dod-failed', 'verify-failed'] as const) {
      for (const intro of INTRODUCERS) {
        for (const end of TERMINATORS) {
          const text = TEXT[outcome](`${intro}8;;payload`, 'not ok 9 - hidden', `still payload${end}ok 2 - after`, 'not ok 1 - real');
          expectDetail(outcome, kept(receipt(text)), 'not ok N - real', `${outcome} ${JSON.stringify(intro)} ${JSON.stringify(end)}`);
        }
      }
      // CAN, SUB and the next ESC end a control string: its payload is dropped and what follows is read.
      for (const cut of ['\u0018', '\u001a', `${E}[0m`]) {
        const text = TEXT[outcome](`${E}Ppayload`, `not ok 9 - hidden${cut}not ok 3 - after the cut`, 'not ok 1 - real');
        expectDetail(outcome, kept(receipt(text)), 'not ok N - after the cut', `${outcome} cut by ${JSON.stringify(cut)}`);
      }
      // An unterminated control string removes the rest of the text; a failing line before it is still read.
      expectDetail(outcome, kept(receipt(TEXT[outcome](`${E}]8;;payload`, 'not ok 9 - hidden', 'not ok 1 - after'))), undefined, `${outcome} unterminated`);
      expectDetail(outcome, kept(receipt(TEXT[outcome]('not ok 1 - before', `${E}]8;;payload`, 'not ok 9 - hidden'))), 'not ok N - before', `${outcome} before an unterminated string`);
      expectDetail(outcome, kept(receipt(TEXT[outcome](), 1, { stderr: `${E}Ppayload\nnot ok 9 - hidden` })), undefined, `${outcome} unterminated in stderr`);
    }
  });

  it('acceptance 3: a C0 control inside a sequence is executed as the terminal parser does, so the sequence is removed whole (T0-SHIP-FAILING-LINE-2 R3 decision 1 F2)', () => {
    const E = '\u001b';
    const SI = '\u000f';
    // Each form carries C0 controls (SI, SO, DEL) inside it: 7-bit and 8-bit CSI, a charset escape, and controls
    // between ESC and the byte that picks the sequence.
    const FORMS = [`${E}[3${SI}1m`, `${E}[${SI}38:2\u000e:255;0;0m`, `${E}[3\u007f1m`, `\u009b3${SI}1m`, `${E}(${SI}B`, `${E}${SI}[31m`, `${E}${SI}]8;;https://example.test/a\u0007`, `${E}[1 ${SI}2m`, `${E}(0`, `${E}[2@`];
    for (const outcome of ['dod-failed', 'verify-failed'] as const) {
      for (const form of FORMS) {
        for (const name of ['alpha', 'beta']) {
          expectDetail(outcome, kept(receipt(TEXT[outcome](`${form}not ok 1 - ${name}`))), `not ok N - ${name}`, `${outcome} ${JSON.stringify(form)} ${name}`);
        }
        // Inside a test name no parameter or final byte of the sequence reaches the cause.
        expectDetail(outcome, kept(receipt(TEXT[outcome](`not ok 1 - alpha ${form}tail`))), 'not ok N - alpha tail', `${outcome} ${JSON.stringify(form)} in a name`);
      }
      // A line feed inside a sequence is executed, so it keeps its line; a C1 control ends a sequence, and CAN or SUB cancels it.
      expectDetail(outcome, kept(receipt(TEXT[outcome](`ok 1 - passes${E}[3\n1mnot ok 2 - two`))), 'not ok N - two', `${outcome} line feed inside a CSI`);
      expectDetail(outcome, kept(receipt(TEXT[outcome](`${E}[31\u0085not ok 3 - after a C1 control`))), 'not ok N - after a cN control', `${outcome} C1 control ends a CSI`);
      expectDetail(outcome, kept(receipt(TEXT[outcome](`${E}[31\u0018not ok 4 - after CAN`, `${E}(\u001anot ok 5 - after SUB`))), 'not ok N - after can', `${outcome} CAN cancels a CSI`);
      expectDetail(outcome, kept(receipt(TEXT[outcome](`${E}(\u001anot ok 5 - after SUB`))), 'not ok N - after sub', `${outcome} SUB cancels an escape`);
      // Inside a word: DEL inside a sequence is ignored, an executed C0 control (SI, CAN) and an executed C1 control become
      // spaces, and a character above DEL that is not a C1 control ends a sequence and is printed.
      expectDetail(outcome, kept(receipt(TEXT[outcome](`not ok 1 - al${E}[3\u007f1mpha`))), 'not ok N - alpha', `${outcome} DEL inside a word`);
      expectDetail(outcome, kept(receipt(TEXT[outcome](`not ok 1 - al${E}[3${SI}1mpha`))), 'not ok N - al pha', `${outcome} SI inside a word`);
      expectDetail(outcome, kept(receipt(TEXT[outcome](`not ok 1 - al${E}[3\u0018pha`))), 'not ok N - al pha', `${outcome} CAN inside a word`);
      expectDetail(outcome, kept(receipt(TEXT[outcome](`not ok 1 - al\u009b3\u0085pha`))), 'not ok N - al pha', `${outcome} C1 control inside a word`);
      expectDetail(outcome, kept(receipt(TEXT[outcome](`not ok 1 - caf${E}[3é`))), 'not ok N - café', `${outcome} a letter ends a CSI`);
      expectDetail(outcome, kept(receipt(TEXT[outcome](`not ok 1 - al\u009cpha`))), 'not ok N - alpha', `${outcome} a stray ST is consumed`);
    }
  });

  it('acceptance 3: the cut to 160 characters counts code points, so it never splits a character (T0-SHIP-FAILING-LINE R2 cycle 0 advisory)', () => {
    const r = kept(receipt(dodText(`✖ ${'a'.repeat(157)}\u{1F600}\u{1F600}`)));
    const line = r.detail.slice(`${SENT['dod-failed']}; failing line: `.length);
    assert.equal(line, `✖ ${'a'.repeat(157)}\u{1F600}`);
    assert.equal(Array.from(line).length, 160);
    assert.doesNotMatch(line, /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
  });

  it('acceptance 4: with no failing line the four outcomes keep their constant detail, and every other outcome keeps its detail', () => {
    expectDetail('dod-failed', kept(receipt(dodText('Error: something broke'))), undefined, 'dod no line');
    expectDetail('verify-failed', kept(receipt(verifyText('Traceback (most recent call last):'))), undefined, 'verify no line');
    expectDetail('dod-failed', kept(receipt('RED 检查失败：dod_command 退出 0（已是 GREEN）。')), undefined, 'red check');
    for (const [sentinel, cls] of SENTINELS) {
      if (cls === 'dod-failed' || cls === 'verify-failed' || cls === 'scope-blocked' || cls === 'budget-over') continue;
      const without = kept(receipt(`[SAGA-FAIL] leg failed\n${sentinel}\n`));
      const withLine = kept(receipt(`[SAGA-FAIL] leg failed\n${sentinel}\nnot ok 1 - a failing test\n✖ a failing test\n`));
      assert.equal(withLine.outcome, cls);
      assert.deepEqual({ ...withLine, receipt: undefined }, { ...without, receipt: undefined }, `${cls}: the detail and every other field are unchanged`);
      assert.doesNotMatch(withLine.detail, /failing line/);
    }
    // Merged, unclassified and timed-out results with failing lines equal those of the same receipt without them.
    for (const [text, exit, extra] of [['[SAGA-DONE]', 0, {}], ['something odd happened', 1, {}], ['something odd happened', 1, { timedOut: true }]] as const) {
      const without = kept(receipt(text, exit, extra));
      const withLine = kept(receipt(`not ok 1 - a failing test\n✖ a failing test\n${text}`, exit, extra));
      assert.deepEqual({ ...withLine, receipt: undefined }, { ...without, receipt: undefined }, `${without.outcome}: the detail and every other field are unchanged`);
      assert.doesNotMatch(withLine.detail, /failing line/, `${withLine.outcome}: ${withLine.detail}`);
    }
  });

  it('acceptance 5: docs/OPERATIONS.md and the CHANGELOG Unreleased section state the rule and its limit', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8').replace(/\r\n/g, '\n');
    const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
    assert.equal(FAILING_LINE_DOC_SENTENCES.length, 5);
    for (const sentence of FAILING_LINE_DOC_SENTENCES) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
    assert.ok(unreleased.includes(FAILING_LINE_CHANGELOG_SENTENCE), `CHANGELOG.md Unreleased states: ${FAILING_LINE_CHANGELOG_SENTENCE}`);
  });
});

/** The sentences card T0-SHIP-FAILING-LINE-2 adds to docs/OPERATIONS.md, after the ship repair paragraph. */
const FAILING_LINE_DOC_SENTENCES = [
  "The detail of a `dod-failed` or `verify-failed` ship names the first failing test or compile line of the ship output, and the detail of a `scope-blocked` or `budget-over` ship names its gate line, the first line matching the outcome's sentinel (card T0-SHIP-FAILING-LINE-2): `sentinel <sentinel>; failing line: <line>`.",
  'A failing line is a TAP `not ok <n>` line without a `# TODO` or `# SKIP` directive (a TAP `ok <n>` or `not ok <n>` line is judged by that rule alone, whatever else it carries), a node:test `✖ ` line other than the `✖ failing tests:` heading, a TypeScript diagnostic at the start of the line (`error TS<code>: `, bare or after a location without spaces such as `src/a.ts(3,7): ` or `src/a.ts:3:7 - `), a Go `--- FAIL: ` line, or a line starting with `FAIL` or `FAILED`, whitespace and more text.',
  'The line is a cause string only: every terminal control sequence is removed from the whole ship output before it is split into lines (a control string such as an OSC or a DCS through its BEL or ST, or through the end of the output when it has none), its control characters become spaces, it is normalised as causes are (lower case, digit runs as `N`), cut to 160 code points, and its brackets and percent signs are encoded, so it never forms a sentinel.',
  'Two ship failures on different lines are two causes, and the same line twice without progress stops the card as same-cause-stop; a `dod-failed` or `verify-failed` ship with no failing line keeps the constant detail `sentinel <sentinel>`, so two of them in a row are still one cause.',
  'The failing line picks the cause the ladder counts and never gates a merge: a line of another shape (a TypeScript diagnostic whose path has a space, among them) is not read, two lines that differ only in their digits or after 160 code points are one cause, a failing-shaped line printed by passing output is read as the failing line, and an unterminated control string removes the rest of the output, so a failing line printed after it is not read; each misread costs at most one attempt, a card stopped one attempt early for a person to resume, or one more attempt within the ladder.',
];
const FAILING_LINE_CHANGELOG_SENTENCE =
  '- Ship failing line, card T0-SHIP-FAILING-LINE-2 (issue #67 item 1): the cause of a `dod-failed`, `verify-failed`, `scope-blocked` or `budget-over` ship names the failing line of the ship output (the first failing test or compile line, or the gate line) instead of one constant detail per outcome, so two ship failures on different lines no longer stop the card as same-cause-stop at the second failure; the same line twice without progress still does, as do two failures with no failing line.';
