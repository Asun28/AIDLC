// Card T1-FINDING-REPRO: `aidlc review repro` runs the author's repro of a finding at the reviewed candidate and at the
// current one, in temporary checkouts with a new empty state directory, and records both exits on the finding.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, goalForCards, candidateShaFor, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { CardRun, ReviewFinding, type Verdict } from '../../src/core/types.ts';
// Namespace import: the module is new, so each test fails at its first use rather than at link time.
import * as repro from '../../src/review/repro.ts';

/** The CLI from the sources, never a compiled build that may be stale. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));

/** The R6 sentence as the card states it, written out here so the shared constant is checked against an independent copy. */
const R6_SENTENCE =
  'For each fixed finding of the Bugs or Security pass, record `aidlc review repro <cardId> <findingId> --argv \'<JSON array>\' --files <paths>` with the test that catches it, and attach one to a `wrong` dispute; a repro is evidence for the next decision and changes no gate.';

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * A repository with a reviewed candidate holding a bug (`sum` subtracts) and a repair commit that fixes it and adds the
 * test that catches it, plus a symbolic link committed in the repair (mode 120000, written through the index so no
 * filesystem link is needed on Windows).
 */
function makeRepo(fx: Fixture): { dir: string; reviewed: string; current: string } {
  const dir = path.join(fx.tmp, 'repo');
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  mkdirSync(path.join(dir, 'tests'), { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'repro@example.invalid');
  git(dir, 'config', 'user.name', 'repro');
  git(dir, 'config', 'core.autocrlf', 'false');
  writeFileSync(path.join(dir, 'src', 'sum.mjs'), 'export const sum = (a, b) => a - b;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'reviewed: sum with a bug');
  const reviewed = git(dir, 'rev-parse', 'HEAD');
  writeFileSync(path.join(dir, 'src', 'sum.mjs'), 'export const sum = (a, b) => a + b;\n');
  writeFileSync(path.join(dir, 'tests', 'sum.test.mjs'), "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { sum } from '../src/sum.mjs';\ntest('sum adds', () => assert.equal(sum(1, 2), 3));\n");
  git(dir, 'add', '-A');
  const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: 'sum.test.mjs', encoding: 'utf8', windowsHide: true }).stdout.trim();
  git(dir, 'update-index', '--add', '--cacheinfo', `120000,${blob},tests/link.mjs`);
  git(dir, 'commit', '-q', '-m', 'repair: sum adds, with its test');
  const current = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'reset', '-q', '--hard');
  return { dir, reviewed, current };
}

const NOW = '2026-09-11T00:00:00.000Z';

/** A card run in REVIEW_FIX on `current`, with F1 raised on `reviewed`, F2 raised without a candidate sha. */
function seedRun(fx: Fixture, goalId: string, cardId: string, shas: { reviewed: string; current?: string }): CardRun {
  return fx.store.saveCardRun(
    CardRun.parse({
      goalId,
      cardId,
      cardRevision: 0,
      goalGeneration: 0,
      state: 'REVIEW_FIX',
      startedAt: NOW,
      deadline: '2026-12-31T00:00:00.000Z',
      updatedAt: NOW,
      ...(shas.current ? { candidate: { sha: shas.current, dirty: false, untracked: [], digest: `digest-${shas.current}` } } : {}),
      redReceipt: 'red:1',
      dodReceipt: 'dod:2',
      blockedReceipt: { dodReceipt: 'dod:1', candidateDigest: `digest-${shas.reviewed}`, stage: 'formal', round: 1, candidateSha: shas.reviewed },
      effort: { taskId: cardId, role: 'implementer', baseline: 'medium', ladder: ['medium', 'high'], attempts: [{ n: 1, effort: 'medium', startedAt: NOW, finishedAt: NOW, outcome: 'success' }, { n: 2, effort: 'medium', startedAt: NOW, outcome: 'running' }] },
      review: { substantiveDecisions: 1, substantiveBlocks: 1, scriptCounter: 1, noVerdictRetriesUsed: 0, invocations: [] },
      findings: [
        { id: 'F1', stage: 'formal', round: 1, reason: '[spec] 1 @ src/sum.mjs:1: sum subtracts -> add', candidateSha: shas.reviewed, raisedAt: NOW, disposition: 'open', revision: 2 },
        { id: 'F2', stage: 'formal', round: 1, reason: '[standards] 4 @ src/sum.mjs:1: naming -> rename', raisedAt: NOW, disposition: 'open' },
      ],
    }),
  );
}

function setup() {
  const fx = makeFixture();
  writeCard(fx, { id: 'T1-REPRO', title: 'repro fixture' });
  writeCard(fx, { id: 'T1-NOCAND', title: 'a run with no candidate' });
  const goal = goalForCards(fx, ['T1-REPRO', 'T1-NOCAND']);
  const repo = makeRepo(fx);
  seedRun(fx, goal.id, 'T1-REPRO', repo);
  seedRun(fx, goal.id, 'T1-NOCAND', { reviewed: repo.reviewed });
  const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: fx.paths.root };
  delete env['CLAUDE_CODE_SESSION_ID'];
  delete env['AIDLC_SESSION'];
  // A nested `node --test` that inherits this runner's context reports to it and exits 0 whatever its tests do.
  delete env['NODE_TEST_CONTEXT'];
  const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, '--json', ...args], { cwd: repo.dir, env, encoding: 'utf8', timeout: 120_000, windowsHide: true });
  const worktrees = () => git(repo.dir, 'worktree', 'list', '--porcelain').split(/\r?\n/).filter((l) => l.startsWith('worktree '));
  return { fx, goal, repo, cli, worktrees };
}

test('acceptance 1: review repro with --files naming the repair\'s test records a non-zero exit at the reviewed sha, 0 at the repair and reproduced, leaves no temporary checkout, and a later repro replaces the record [R2] [R3]', () => {
  const { fx, goal, repo, cli, worktrees } = setup();
  try {
    const argv = [process.execPath, '--test', 'tests/sum.test.mjs'];
    const r = cli('review', 'repro', 'T1-REPRO', 'F1', '--argv', JSON.stringify(argv), '--files', 'tests/sum.test.mjs', '--goal', goal.id);
    assert.equal(r.status, 0, r.stderr);
    const f1 = fx.store.getCardRun(goal.id, 'T1-REPRO')!.findings.find((f) => f.id === 'F1')!;
    assert.ok(f1.repro, 'the finding carries a repro record');
    assert.deepEqual(f1.repro.argv, argv);
    assert.deepEqual(f1.repro.files, ['tests/sum.test.mjs']);
    assert.equal(f1.repro.reviewed.sha, repo.reviewed);
    assert.equal(f1.repro.current.sha, repo.current);
    assert.equal(f1.repro.reviewed.timedOut, false);
    assert.notEqual(f1.repro.reviewed.exitCode, 0, 'the test fails on the reviewed code');
    assert.notEqual(f1.repro.reviewed.exitCode, null);
    assert.deepEqual({ exitCode: f1.repro.current.exitCode, timedOut: f1.repro.current.timedOut }, { exitCode: 0, timedOut: false });
    assert.equal(f1.repro.reproduced, true);
    assert.deepEqual(worktrees().length, 1, `only the repository itself is listed: ${worktrees().join(' | ')}`);

    // A check that passes on both commits is recorded with its exits and reproduced false, replacing the first record.
    const both = [process.execPath, '-e', 'process.exit(0)'];
    const again = cli('review', 'repro', 'T1-REPRO', 'f1', '--argv', JSON.stringify(both), '--goal', goal.id);
    assert.equal(again.status, 0, again.stderr);
    const replaced = fx.store.getCardRun(goal.id, 'T1-REPRO')!.findings.find((f) => f.id === 'F1')!.repro!;
    assert.deepEqual(replaced.argv, both);
    assert.deepEqual(replaced.files, []);
    assert.deepEqual([replaced.reviewed.exitCode, replaced.current.exitCode, replaced.reproduced], [0, 0, false]);
    assert.equal(worktrees().length, 1);

    // A record written before this card parses unchanged: no repro key appears.
    const old = ReviewFinding.parse({ id: 'F3', stage: 'pre', cycle: 0, round: 1, reason: 'x', raisedAt: NOW });
    assert.equal('repro' in old, false);
  } finally {
    fx.cleanup();
  }
});

test('acceptance 2 and 10: each refusal of R1 exits 1 before any run and writes nothing to the card run [R1] [R7]', () => {
  const { fx, goal, repo, cli, worktrees } = setup();
  try {
    const marker = path.join(fx.tmp, 'ran.txt');
    const argv = JSON.stringify([process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`]);
    const before = fx.store.getCardRun(goal.id, 'T1-REPRO');
    const beforeNoCand = fx.store.getCardRun(goal.id, 'T1-NOCAND');
    const events = fx.events(goal.id);
    const cases: Array<[string, string[]]> = [
      ['an unknown finding', ['T1-REPRO', 'F9', '--argv', argv]],
      ['a finding with no candidateSha', ['T1-REPRO', 'F2', '--argv', argv]],
      ['a card run with no current candidate', ['T1-NOCAND', 'F1', '--argv', argv]],
      ['a card with no run', ['T1-NONE', 'F1', '--argv', argv]],
      ['an argv that is not JSON', ['T1-REPRO', 'F1', '--argv', 'node -e 1']],
      ['an empty argv', ['T1-REPRO', 'F1', '--argv', '[]']],
      ['an argv with a number', ['T1-REPRO', 'F1', '--argv', '["node",1]']],
      ['an argv that is an object', ['T1-REPRO', 'F1', '--argv', '{"0":"node"}']],
      ['an argv that is a string', ['T1-REPRO', 'F1', '--argv', '"node"']],
      ['an absolute posix path', ['T1-REPRO', 'F1', '--argv', argv, '--files', '/tests/sum.test.mjs']],
      ['an absolute native path', ['T1-REPRO', 'F1', '--argv', argv, '--files', path.join(repo.dir, 'tests', 'sum.test.mjs')]],
      ['a path with ..', ['T1-REPRO', 'F1', '--argv', argv, '--files', 'tests/../src/sum.mjs']],
      ['a path under .aidlc', ['T1-REPRO', 'F1', '--argv', argv, '--files', '.aidlc/cards/x.json']],
      ['a path under ./.aidlc', ['T1-REPRO', 'F1', '--argv', argv, '--files', './.aidlc/cards/x.json']],
      ['a path missing from the current candidate', ['T1-REPRO', 'F1', '--argv', argv, '--files', 'tests/sum.test.mjs,tests/none.test.mjs']],
      ['an empty path', ['T1-REPRO', 'F1', '--argv', argv, '--files', 'tests/sum.test.mjs,']],
      ['a symbolic link in the current candidate', ['T1-REPRO', 'F1', '--argv', argv, '--files', 'tests/link.mjs']],
    ];
    for (const [label, args] of cases) {
      const r = cli('review', 'repro', ...args, '--goal', goal.id);
      assert.equal(r.status, 1, `${label}: exit 1 (${r.stderr})`);
      assert.match(r.stderr, /^aidlc: /, `${label}: the refusal is reported: ${r.stderr}`);
      assert.equal(existsSync(marker), false, `${label}: the argv never ran`);
      assert.deepEqual(fx.store.getCardRun(goal.id, 'T1-REPRO'), before, `${label}: the card run is unchanged`);
      assert.deepEqual(fx.store.getCardRun(goal.id, 'T1-NOCAND'), beforeNoCand, `${label}: the other run is unchanged`);
      assert.equal(fx.store.getCardRun(goal.id, 'T1-NONE'), undefined, `${label}: no card run is created`);
      assert.deepEqual(fx.events(goal.id), events, `${label}: nothing is journaled`);
      assert.equal(worktrees().length, 1, `${label}: no temporary checkout`);
    }
  } finally {
    fx.cleanup();
  }
});

test('acceptance 10: each run sees AIDLC_STATE_DIR naming a new empty directory that is gone after the repro, also when the argv fails or times out [R2]', async () => {
  const { fx, goal, repo, worktrees } = setup();
  try {
    const script = (out: string, tail: string) =>
      [process.execPath, '-e', `const fs=require('node:fs');const d=process.env.AIDLC_STATE_DIR;fs.writeFileSync(${JSON.stringify(out)}+'-'+require('node:crypto').randomUUID(),JSON.stringify({d,exists:fs.existsSync(d),entries:fs.readdirSync(d),cwd:process.cwd()}));${tail}`];
    const outDir = path.join(fx.tmp, 'seen');
    mkdirSync(outDir);
    const cases: Array<[string, string, (rec: NonNullable<ReviewFinding['repro']>) => void]> = [
      ['passes', 'process.exit(0)', (rec) => assert.deepEqual([rec.reviewed.exitCode, rec.current.exitCode], [0, 0])],
      ['fails', 'process.exit(3)', (rec) => assert.deepEqual([rec.reviewed.exitCode, rec.current.exitCode, rec.reproduced], [3, 3, false])],
      ['times out', 'setTimeout(() => {}, 60000)', (rec) => assert.deepEqual([rec.reviewed.timedOut, rec.current.timedOut, rec.reproduced], [true, true, false])],
    ];
    for (const [label, tail, check] of cases) {
      const out = path.join(outDir, label.replace(/ /g, '-'));
      const result = await repro.runRepro({ root: repo.dir, store: fx.store, cardId: 'T1-REPRO', findingId: 'F1', goalId: goal.id, argv: JSON.stringify(script(out, tail)), timeoutMs: 4_000 });
      check(result.repro);
      const seen = (await import('node:fs')).readdirSync(outDir).filter((n) => n.startsWith(path.basename(out) + '-')).map((n) => JSON.parse(readFileSync(path.join(outDir, n), 'utf8')) as { d: string; exists: boolean; entries: string[]; cwd: string });
      assert.equal(seen.length, 2, `${label}: two runs`);
      assert.notEqual(seen[0]!.d, seen[1]!.d, `${label}: a new directory per run`);
      for (const s of seen) {
        assert.equal(s.exists, true, `${label}: the directory exists during the run`);
        assert.deepEqual(s.entries, [], `${label}: and is empty`);
        assert.notEqual(path.resolve(s.d), path.resolve(fx.paths.root), `${label}: never the caller's state directory`);
        assert.equal(existsSync(s.d), false, `${label}: removed afterwards`);
        assert.notEqual(path.resolve(s.cwd).toLowerCase(), path.resolve(repo.dir).toLowerCase(), `${label}: never the main checkout`);
        assert.equal(existsSync(s.cwd), false, `${label}: the temporary checkout is removed`);
      }
      assert.equal(worktrees().length, 1, `${label}: no checkout left listed`);
    }
    for (const files of ['.aidlc/state.json', 'tests/link.mjs']) {
      await assert.rejects(repro.runRepro({ root: repo.dir, store: fx.store, cardId: 'T1-REPRO', findingId: 'F1', goalId: goal.id, argv: JSON.stringify(script(path.join(outDir, 'refused'), 'process.exit(0)')), files, timeoutMs: 4_000 }), `${files} is refused`);
    }
    assert.equal((await import('node:fs')).readdirSync(outDir).filter((n) => n.startsWith('refused')).length, 0, 'a refused path runs nothing');
  } finally {
    fx.cleanup();
  }
});

test('acceptance 5: the run\'s state, substantiveDecisions, attempts and receipts are equal before and after a repro, and the finding keeps its disposition and revision [R7]', () => {
  const { fx, goal, cli } = setup();
  try {
    const pick = (run: CardRun) => ({ state: run.state, review: run.review, effort: run.effort, redReceipt: run.redReceipt, dodReceipt: run.dodReceipt, blockedReceipt: run.blockedReceipt, candidate: run.candidate, stop: run.stop, journalOwed: run.journalOwed, f1: { ...run.findings.find((f) => f.id === 'F1')!, repro: undefined }, f2: run.findings.find((f) => f.id === 'F2') });
    const before = pick(fx.store.getCardRun(goal.id, 'T1-REPRO')!);
    const events = fx.events(goal.id);
    const r = cli('review', 'repro', 'T1-REPRO', 'F1', '--argv', JSON.stringify([process.execPath, '-e', 'process.exit(1)']), '--goal', goal.id);
    assert.equal(r.status, 0, r.stderr);
    const after = fx.store.getCardRun(goal.id, 'T1-REPRO')!;
    assert.ok(after.findings.find((f) => f.id === 'F1')?.repro, 'the repro is recorded');
    assert.deepEqual(pick(after), before);
    assert.equal(after.review.substantiveDecisions, 1);
    assert.equal(after.findings.find((f) => f.id === 'F1')?.revision, 2, 'the finding revision does not move');
    assert.deepEqual(fx.events(goal.id), events, 'nothing is journaled');
  } finally {
    fx.cleanup();
  }
});

test('acceptance 3: the next formal prompt holds the repro line inside ## Prior findings with the argv quoted, and a finding without a repro has no such line [R4]', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '--schema', '{schema}', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
    const reasons = ['[spec] 6 tests @ src/t1-rp.ts:1: sum subtracts -> add', '[standards] 9 naming @ src/t1-rp.ts:2: unclear -> rename'];
    const r3: string[] = [JSON.stringify({ verdict: 'block', reasons, axes: { spec: { verdict: 'block', reasons: [reasons[0]] }, standards: { verdict: 'block', reasons: [reasons[1]] } } }) + '\n'];
    const prompts: string[] = [];
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-rp.ts\u0000' },
      'git diff': { stdout: 'diff --git a/src/t1-rp.ts b/src/t1-rp.ts\n+export const rp = 1;\n' },
      'fake-r2': () => ({ stdout: PASS }),
      'fake-r3': (args) => {
        prompts.push(args.at(-1)!);
        return { stdout: r3.shift() ?? PASS };
      },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged', 'merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-RP', title: 'repro prompt', allowPaths: ['src/t1-rp.ts'] });
    const goal = goalForCards(fx, ['T1-RP']);
    const g = () => fx.goal(goal.id);
    const card = fx.card('T1-RP');
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-RP'));
    let run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(g(), card, run);
    r = runner.next(g(), card, (await runner.preReview(g(), card, r.run)).run);
    const block = await runner.formalReview(g(), card, r.run);
    assert.deepEqual(block.run.findings.map((f) => f.id), ['F1', 'F2']);
    const repair = runner.next(g(), card, block.run);
    run = runner.recordAttempt(g(), card, repair.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-2' });
    // The record `review repro` writes, with an argv carrying a quote and a newline.
    const argv = ['node', '--test', 'tests/a "b".test.ts', 'x\ny'];
    fx.store.updateCardRun(goal.id, 'T1-RP', (current) => ({ ...current!, findings: current!.findings.map((f) => (f.id === 'F1' ? { ...f, repro: { argv, files: ['tests/a "b".test.ts'], reviewed: { sha: 'sha-1', exitCode: 1, timedOut: false }, current: { sha: 'sha-2', exitCode: 0, timedOut: false }, at: fx.now(), reproduced: true } } : f)) }));
    run = fx.store.getCardRun(goal.id, 'T1-RP')!;
    r = runner.next(g(), card, run);
    r = runner.next(g(), card, (await runner.preReview(g(), card, r.run)).run);
    await runner.formalReview(g(), card, r.run);
    const prompt2 = prompts[1] ?? '';
    const section = prompt2.slice(prompt2.indexOf('## Prior findings'));
    const body = section.slice(0, section.indexOf('\n## ', 3) === -1 ? undefined : section.indexOf('\n## ', 3));
    const lines = body.split('\n');
    const expected = '  - F1 repro (quoted evidence): argv "[\\"node\\",\\"--test\\",\\"tests/a \\\\\\"b\\\\\\".test.ts\\",\\"x\\\\ny\\"]"; exit 1 at the reviewed candidate, exit 0 at the current candidate; reproduced.';
    assert.ok(lines.includes(expected), `the repro line is in Prior findings:\n${body}`);
    assert.equal(lines.filter((l) => l.includes(' repro (quoted evidence)')).length, 1, 'F2 has no repro line');
    assert.ok(!lines.some((l) => l.startsWith('  - F2 repro')));
    assert.ok(lines.findIndex((l) => l === expected) > lines.findIndex((l) => l.startsWith('- F1 (')), 'the line follows F1');
  } finally {
    fx.cleanup();
  }
});

test('acceptance 4: the review-fix directive after a formal block and the REVIEW_FIX build directive after it end with the R6 sentence [R6]', () => {
  assert.equal(repro.REPRO_REQUEST, R6_SENTENCE, 'the shared sentence is the card\'s');
  assert.ok(!/class/i.test(R6_SENTENCE));
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello', tier: 'S', reviewGate: 'codex {verdict:pass}', acceptance: ['1. hello() returns hello. [dod arm 1]'] });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const verdict: Verdict = { verdict: 'block', reasons: ['[spec] 6 tests missing @ src/hello.ts'], axes: { spec: { verdict: 'block', reasons: ['tests missing'] }, standards: { verdict: 'pass', reasons: [] } }, sha: candidateShaFor('T1-HELLO'), run_status: 'success' };
    const runner = fx.runner(new DryRunShipPath(['review-blocked', 'review-blocked'], verdict));
    const card = fx.card('T1-HELLO');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    const blocked = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(blocked.directive.kind, 'review-fix');
    assert.ok(blocked.directive.narration.endsWith(`. ${R6_SENTENCE}`), blocked.directive.narration);
    const build = runner.next(fx.goal(goal.id), card, blocked.run);
    assert.equal(build.directive.kind, 'build');
    assert.ok(build.directive.narration.endsWith(`. ${R6_SENTENCE}`), build.directive.narration);
  } finally {
    fx.cleanup();
  }
});
