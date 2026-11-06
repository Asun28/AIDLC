// Card T1-VERIFY-MUTANTS: `aidlc card mutants` runs the mutants of a committed candidate under the card's DoD.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MUTATION_OPERATORS, MutantPending, MutantReport, type MutantResult } from '../../src/core/types.ts';
import { runSync, scriptedRunner, type ExecOptions, type ExecReceipt, type Runner, type SyncRunner } from '../../src/probes/exec.ts';
import { MUTANT_MAX_DEFAULT, MUTANT_TIMEOUT_DEFAULT_MS, mutantSummaryText, mutantsMarkerPath, mutantsReportPath, restoreMutants, runMutants, type MutantsDeps, type RunMutantsInput } from '../../src/review/mutants.ts';
import { goalForCards, makeFixture, writeCard } from '../scenarios/_harness.ts';

const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CARD = 'T1-M';
const DOD = 'node check';
const START = '2026-11-06T10:00:00.000Z';
const FINISH = '2026-11-06T10:05:00.000Z';

const GIT_ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false'];
function git(cwd: string, ...args: string[]): string {
  const r = runSync('git', [...GIT_ID, ...args], { cwd });
  assert.equal(r.exitCode, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

const BASE_SOURCE = 'export function seen(a: number): boolean {\n  return a === 1;\n}\n';
const SOURCE = `${BASE_SOURCE}export function fresh(a: number, b: boolean): boolean {\n  if (b) {\n    return a > 0;\n  }\n  return false;\n}\n`;
const KILLED_TEXT = 'return a >= 0;';
const BASE_DTS = 'export declare const flag: boolean;\n';
const DTS = `${BASE_DTS}export declare const other: boolean | true;\n`;
const BASE_TEST = "import './m';\n";
const TEST = `${BASE_TEST}if (true) run();\n`;
const COMMITTED: Record<string, string> = { 'src/m.ts': SOURCE, 'src/m.d.ts': DTS, 'tests/m.test.ts': TEST };

type Row = Pick<MutantResult, 'file' | 'line' | 'column' | 'operator' | 'original' | 'mutated'>;
const ROWS: Row[] = [
  { file: 'src/m.ts', line: 5, column: 7, operator: 'force-true', original: 'b', mutated: 'true' },
  { file: 'src/m.ts', line: 5, column: 7, operator: 'force-false', original: 'b', mutated: 'false' },
  { file: 'src/m.ts', line: 6, column: 14, operator: 'boundary', original: '>', mutated: '>=' },
  { file: 'src/m.ts', line: 8, column: 10, operator: 'flip-boolean', original: 'false', mutated: 'true' },
];

function write(dir: string, file: string, text: string): void {
  const target = path.join(dir, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
}

/** A base commit, then a candidate commit that changes `src/m.ts`, `src/m.d.ts` and `tests/m.test.ts`. */
function buildTemplate(dir: string): void {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'core.autocrlf', 'false');
  for (const [file, text] of [['.gitignore', '.review/\n'], ['src/m.ts', BASE_SOURCE], ['src/m.d.ts', BASE_DTS], ['tests/m.test.ts', BASE_TEST]] as const) write(dir, file, text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  for (const [file, text] of Object.entries(COMMITTED)) write(dir, file, text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'candidate');
}

let template = '';
before(() => {
  template = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-mutants-template-')));
  buildTemplate(template);
});
after(() => rmSync(template, { recursive: true, force: true }));

interface Repo {
  dir: string;
  worktree: string;
  base: string;
  candidate: string;
  marker: string;
  report: string;
  read: (file?: string) => string;
  cleanup: () => void;
}

function repo(): Repo {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-mutants-')));
  const worktree = path.join(dir, 'wt');
  cpSync(template, worktree, { recursive: true });
  return {
    dir,
    worktree,
    base: git(worktree, 'rev-parse', 'HEAD~1'),
    candidate: git(worktree, 'rev-parse', 'HEAD'),
    marker: mutantsMarkerPath(worktree, CARD),
    report: mutantsReportPath(worktree, CARD),
    read: (file = 'src/m.ts') => readFileSync(path.join(worktree, file), 'utf8'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function withRepo(body: (r: Repo) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const r = repo();
    try {
      await body(r);
    } finally {
      r.cleanup();
    }
  };
}

interface Dod {
  runner: Runner;
  calls: Array<{ command: string; args: string[]; options: ExecOptions | undefined }>;
}

/** The DoD as a scripted entry: `step` receives the 0-based call, the baseline first, and the bytes of `src/m.ts` at that call. */
function scriptedDod(r: Repo, step: (call: number, source: string) => Partial<ExecReceipt> = () => ({})): Dod {
  const calls: Dod['calls'] = [];
  const sync = scriptedRunner({ [DOD]: () => step(calls.length - 1, existsSync(path.join(r.worktree, 'src/m.ts')) ? r.read() : '') });
  return {
    calls,
    runner: async (command, args, options) => {
      calls.push({ command, args, options });
      return sync(command, args, options);
    },
  };
}

function deps(dod: Dod, progress?: (line: string) => void): MutantsDeps {
  const times = [START, FINISH];
  return { git: runSync, dod: dod.runner, now: () => times.shift() ?? FINISH, progress };
}

const input = (r: Repo, extra: Partial<RunMutantsInput> = {}): RunMutantsInput => ({ card: { id: CARD, dod_command: DOD, dod_exit: 0 }, worktree: r.worktree, base: r.base, ...extra });
/** A scripted DoD that fails on exactly the `>=` mutant. */
const killOne = (r: Repo): Dod => scriptedDod(r, (_call, source) => ({ exitCode: source.includes(KILLED_TEXT) ? 1 : 0, durationMs: 11 }));
const reportOf = (r: Repo): MutantReport => MutantReport.parse(JSON.parse(readFileSync(r.report, 'utf8')));

function assertCommitted(r: Repo): void {
  for (const [file, text] of Object.entries(COMMITTED)) assert.deepEqual(readFileSync(path.join(r.worktree, file)), Buffer.from(text), `${file} holds its committed bytes`);
  assert.equal(git(r.worktree, 'status', '--porcelain'), '', 'the worktree is clean');
}

function assertNoArtifacts(r: Repo): void {
  assert.equal(existsSync(r.marker), false, 'no marker');
  assert.equal(existsSync(r.report), false, 'no report');
}

/** Every refused run: the message, then no marker and no report. */
async function assertRefused(r: Repo, run: Promise<unknown>, message: RegExp | string): Promise<void> {
  await assert.rejects(run, (err: Error) => {
    if (typeof message === 'string') assert.ok(err.message.includes(message), err.message);
    else assert.match(err.message, message);
    return true;
  });
  assertNoArtifacts(r);
}

/** What an interrupted run leaves: the `>=` mutant in `src/m.ts` and its marker. Returns the mutated text. */
function interrupted(r: Repo): string {
  const mutated = SOURCE.replace('return a > 0;', KILLED_TEXT);
  writeFileSync(path.join(r.worktree, 'src/m.ts'), mutated);
  mkdirSync(path.dirname(r.marker), { recursive: true });
  const pending: MutantPending = { schemaVersion: 1, cardId: CARD, candidateSha: r.candidate, applied: { file: 'src/m.ts', originalBase64: Buffer.from(SOURCE).toString('base64'), originalSha256: sha256(SOURCE), mutantSha256: sha256(mutated) } };
  writeFileSync(r.marker, JSON.stringify(pending));
  return mutated;
}

const SYMLINK_OK = (() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-link-'));
  try {
    symlinkSync(path.join(dir, 'x'), path.join(dir, 'y'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

describe('runMutants (card T1-VERIFY-MUTANTS)', () => {
  test('acceptance 1: one killed mutant, the others survived, bound to HEAD, with every file restored [R2] [R4] [R6] [R7] [R11] [R12]', withRepo(async (r) => {
    const seen: string[] = [];
    const dod = scriptedDod(r, (call, source) => {
      if (call === 0) {
        assert.equal(existsSync(r.marker), false, 'the baseline runs with no marker');
        assert.equal(source, SOURCE, 'the baseline runs on the unmutated candidate');
      } else {
        const pending = MutantPending.parse(JSON.parse(readFileSync(r.marker, 'utf8')));
        assert.deepEqual(pending, { schemaVersion: 1, cardId: CARD, candidateSha: r.candidate, applied: { file: 'src/m.ts', originalBase64: Buffer.from(SOURCE).toString('base64'), originalSha256: sha256(SOURCE), mutantSha256: sha256(source) } });
        seen.push(source);
      }
      return { exitCode: source.includes(KILLED_TEXT) ? 1 : 0, durationMs: call === 0 ? 7 : 11 + call };
    });
    const lines: string[] = [];
    const out = await runMutants(input(r), deps(dod, (line) => {
      lines.push(line);
      assert.deepEqual(MutantPending.parse(JSON.parse(readFileSync(r.marker, 'utf8'))), { schemaVersion: 1, cardId: CARD, candidateSha: r.candidate }, 'the marker names no file once the file is restored');
    }));
    const report = reportOf(r);
    assert.deepEqual(report, {
      schemaVersion: 1,
      cardId: CARD,
      candidateSha: git(r.worktree, 'rev-parse', 'HEAD'),
      base: r.base,
      dodCommand: DOD,
      operators: [...MUTATION_OPERATORS],
      max: 30,
      timeoutMs: 120000,
      baselineDurationMs: 7,
      generated: 4,
      skipped: 0,
      totals: { killed: 1, survived: 3, timeout: 0 },
      startedAt: START,
      finishedAt: FINISH,
      mutants: [
        { ...ROWS[0]!, outcome: 'survived', exitCode: 0, durationMs: 12 },
        { ...ROWS[1]!, outcome: 'survived', exitCode: 0, durationMs: 13 },
        { ...ROWS[2]!, outcome: 'killed', exitCode: 1, durationMs: 14 },
        { ...ROWS[3]!, outcome: 'survived', exitCode: 0, durationMs: 15 },
      ],
    });
    assert.deepEqual(out, { report, path: r.report });
    assert.deepEqual(seen, [SOURCE.replace('if (b)', 'if (true)'), SOURCE.replace('if (b)', 'if (false)'), SOURCE.replace('return a > 0;', KILLED_TEXT), SOURCE.replace('return false;', 'return true;')], 'one mutant at a time, written from the candidate');
    assert.deepEqual(dod.calls, Array.from({ length: 5 }, () => ({ command: DOD, args: [], options: { cwd: r.worktree, shell: true, timeoutMs: 120000 } })), 'the DoD runs as one string through the shell in the worktree');
    assertCommitted(r);
    assert.equal(existsSync(r.marker), false, 'the marker is gone');
    assert.deepEqual(lines, ['mutant 1/4 src/m.ts:5:7 force-true: survived (exit 0, 12 ms)', 'mutant 2/4 src/m.ts:5:7 force-false: survived (exit 0, 13 ms)', 'mutant 3/4 src/m.ts:6:14 boundary: killed (exit 1, 14 ms)', 'mutant 4/4 src/m.ts:8:10 flip-boolean: survived (exit 0, 15 ms)']);
    assert.equal(
      mutantSummaryText(report, r.report),
      [`${CARD} mutants on ${r.candidate}: 4 of 4 run, 0 skipped: 1 killed, 3 survived, 0 timeout`, 'survived:', '  src/m.ts:5:7 force-true', '  src/m.ts:5:7 force-false', '  src/m.ts:8:10 flip-boolean', `report: ${r.report}`].join('\n'),
    );
  }));

  test('acceptance 1: the summary with no survivor lists none [R12]', withRepo(async (r) => {
    const { report } = await runMutants(input(r), deps(scriptedDod(r, (call) => ({ exitCode: call === 0 ? 0 : 1 }))));
    assert.equal(mutantSummaryText(report, r.report), [`${CARD} mutants on ${r.candidate}: 4 of 4 run, 0 skipped: 4 killed, 0 survived, 0 timeout`, `report: ${r.report}`].join('\n'));
  }));

  test('acceptance 1: the mutants come in path order and the outcome compares the exit code with dod_exit, not with 0 [R2] [R4]', withRepo(async (r) => {
    write(r.worktree, 'src/a.ts', 'export const a = true;\n');
    write(r.worktree, 'src/Z.ts', 'export const z = true;\n');
    git(r.worktree, 'add', '-A');
    git(r.worktree, 'commit', '-q', '-m', 'two more files');
    const dod = scriptedDod(r, (call) => ({ exitCode: call === 1 ? 0 : 3 }));
    const { report } = await runMutants(input(r, { card: { id: CARD, dod_command: DOD, dod_exit: 3 } }), deps(dod));
    assert.deepEqual(report.mutants.map((m) => m.file), ['src/Z.ts', 'src/a.ts', 'src/m.ts', 'src/m.ts', 'src/m.ts', 'src/m.ts'], 'code unit order');
    assert.deepEqual(report.totals, { killed: 1, survived: 5, timeout: 0 });
    assert.equal(report.mutants[0]!.outcome, 'killed', 'exit 0 differs from dod_exit 3');
  }));

  test('acceptance 1: a candidate with no source change runs the baseline, reports nothing and leaves no marker [R2] [R6] [R11]', withRepo(async (r) => {
    const dod = scriptedDod(r);
    const { report } = await runMutants(input(r, { base: r.candidate }), deps(dod));
    assert.deepEqual([report.generated, report.skipped, report.mutants, report.totals], [0, 0, [], { killed: 0, survived: 0, timeout: 0 }]);
    assert.equal(dod.calls.length, 1, 'the baseline alone runs');
    assert.equal(existsSync(r.marker), false, 'the marker is gone');
  }));

  test('acceptance 1: a base git cannot read is refused naming the range; the DoD never runs [R2]', withRepo(async (r) => {
    const dod = scriptedDod(r);
    await assertRefused(r, runMutants(input(r, { base: 'no-such-base' }), deps(dod)), `no-such-base...${r.candidate}`);
    assert.equal(dod.calls.length, 0);
    assertCommitted(r);
  }));

  test('acceptance 2: a modified tracked file is refused naming the entry; the DoD never runs [R3]', withRepo(async (r) => {
    writeFileSync(path.join(r.worktree, 'src/m.ts'), `${SOURCE}// edit\n`);
    const dod = scriptedDod(r);
    await assertRefused(r, runMutants(input(r), deps(dod)), 'src/m.ts');
    assert.equal(dod.calls.length, 0);
    assert.equal(r.read(), `${SOURCE}// edit\n`, 'the edit stays');
  }));

  test('acceptance 2: an untracked file is refused naming the entry; the DoD never runs [R3]', withRepo(async (r) => {
    write(r.worktree, 'src/new.ts', 'export {};\n');
    const dod = scriptedDod(r);
    await assertRefused(r, runMutants(input(r), deps(dod)), 'src/new.ts');
    assert.equal(dod.calls.length, 0);
  }));

  test('acceptance 2: the refusal names five entries and counts the rest [R3]', withRepo(async (r) => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) write(r.worktree, `src/new${n}.ts`, 'export {};\n');
    await assert.rejects(runMutants(input(r), deps(scriptedDod(r))), (err: Error) => {
      assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((n) => err.message.includes(`src/new${n}.ts`)), [true, true, true, true, true, false, false], err.message);
      assert.ok(err.message.includes('and 2 more'), err.message);
      return true;
    });
  }));

  test('acceptance 2: exactly five entries name no remainder [R3]', withRepo(async (r) => {
    for (const n of [1, 2, 3, 4, 5]) write(r.worktree, `src/new${n}.ts`, 'export {};\n');
    await assert.rejects(runMutants(input(r), deps(scriptedDod(r))), (err: Error) => {
      assert.ok(!err.message.includes('more'), err.message);
      return true;
    });
  }));

  test('acceptance 3: a DoD that exits 1 on the unmutated candidate is refused naming the exit code [R5]', withRepo(async (r) => {
    const dod = scriptedDod(r, () => ({ exitCode: 1 }));
    await assertRefused(r, runMutants(input(r), deps(dod)), 'exit code 1');
    assert.equal(dod.calls.length, 1, 'only the baseline ran');
    assertCommitted(r);
  }));

  test('acceptance 3: a DoD that times out on the unmutated candidate is refused naming the timeout [R5]', withRepo(async (r) => {
    const dod = scriptedDod(r, () => ({ exitCode: 0, timedOut: true }));
    await assertRefused(r, runMutants(input(r, { timeoutMs: 5000 }), deps(dod)), 'timed out after 5000 ms');
    assert.equal(dod.calls.length, 1, 'only the baseline ran');
    assertCommitted(r);
  }));

  test('acceptance 4: a mutant whose run times out is recorded timeout, in that total alone, and its file is restored [R4] [R7]', withRepo(async (r) => {
    const dod = scriptedDod(r, (call) => (call === 1 ? { exitCode: 0, timedOut: true, durationMs: 9 } : call === 2 ? { exitCode: null, timedOut: true } : call === 0 ? {} : { exitCode: 1 }));
    const { report } = await runMutants(input(r), deps(dod));
    assert.deepEqual(report.mutants.map((m) => [m.outcome, m.exitCode]), [['timeout', 0], ['timeout', null], ['killed', 1], ['killed', 1]], 'a timeout outranks the exit code');
    assert.deepEqual(report.totals, { killed: 2, survived: 0, timeout: 2 });
    assertCommitted(r);
  }));

  test('acceptance 5: max 1 runs the first mutant of the order and counts the others as skipped [R10]', withRepo(async (r) => {
    const dod = killOne(r);
    const { report } = await runMutants(input(r, { max: 1 }), deps(dod));
    assert.deepEqual(report.mutants.map(({ file, line, column, operator, original, mutated }) => ({ file, line, column, operator, original, mutated })), [ROWS[0]]);
    assert.deepEqual([report.max, report.generated, report.skipped, dod.calls.length], [1, 4, 3, 2]);
  }));

  test('acceptance 5: max equal to the generated count skips nothing [R10]', withRepo(async (r) => {
    const { report } = await runMutants(input(r, { max: 4 }), deps(killOne(r)));
    assert.deepEqual([report.mutants.length, report.skipped], [4, 0]);
  }));

  test('acceptance 5: a max or timeoutMs that is not a positive integer is refused before the git runner is called [R10]', withRepo(async (r) => {
    const never = (): never => assert.fail('the git runner is not called');
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await assert.rejects(runMutants(input(r, { max: bad }), { ...deps(scriptedDod(r)), git: never }), /--max/);
      await assert.rejects(runMutants(input(r, { timeoutMs: bad }), { ...deps(scriptedDod(r)), git: never }), /--timeout-ms/);
    }
    await assert.rejects(runMutants(input(r, { timeoutMs: 2147483648 }), { ...deps(scriptedDod(r)), git: never }), /--timeout-ms/);
    assert.equal(git(r.worktree, 'status', '--porcelain'), '');
  }));

  test('acceptance 5: the largest timeout a Node timer keeps is accepted and the defaults are the card values [R10]', withRepo(async (r) => {
    assert.deepEqual([MUTANT_MAX_DEFAULT, MUTANT_TIMEOUT_DEFAULT_MS], [30, 120000]);
    const dod = killOne(r);
    await runMutants(input(r, { timeoutMs: 2147483647, max: 1 }), deps(dod));
    assert.equal(dod.calls[0]!.options?.timeoutMs, 2147483647);
  }));

  test('acceptance 6: a DoD that throws on the first mutant rejects with that error, restored, with no marker and no report [R7]', withRepo(async (r) => {
    const boom = new Error('runner broke');
    const dod = scriptedDod(r, (call) => {
      if (call === 1) throw boom;
      return {};
    });
    await assert.rejects(runMutants(input(r), deps(dod)), (err) => err === boom);
    assertCommitted(r);
    assertNoArtifacts(r);
    assert.equal(dod.calls.length, 2, 'the run stops at the throw');
  }));

  test('acceptance 7: a DoD that rewrites the mutated file stops the run naming it; the file and the marker stay [R7]', withRepo(async (r) => {
    const dod = scriptedDod(r, (call) => {
      if (call === 1) writeFileSync(path.join(r.worktree, 'src/m.ts'), 'rewritten\n');
      return {};
    });
    await assert.rejects(runMutants(input(r), deps(dod)), /src\/m\.ts/);
    assert.equal(r.read(), 'rewritten\n');
    assert.equal(MutantPending.parse(JSON.parse(readFileSync(r.marker, 'utf8'))).applied?.file, 'src/m.ts');
    assert.equal(existsSync(r.report), false);
    assert.equal(dod.calls.length, 2, 'no later mutant runs');
  }));

  test('acceptance 7: a DoD that deletes the mutated file and one that throws after rewriting it stop naming the file, marker kept [R7]', async () => {
    for (const rewrite of [(file: string) => rmSync(file), (file: string) => writeFileSync(file, 'rewritten\n')]) {
      await withRepo(async (r) => {
        const dod = scriptedDod(r, (call) => {
          if (call === 1) {
            rewrite(path.join(r.worktree, 'src/m.ts'));
            throw new Error('runner broke');
          }
          return {};
        });
        await assert.rejects(runMutants(input(r), deps(dod)), /src\/m\.ts/);
        assert.ok(existsSync(r.marker), 'the marker stays');
      })();
    }
  });

  test('acceptance 7: a DoD that makes a commit rejects naming both shas, restored, and writes no report [R11]', withRepo(async (r) => {
    const dod = scriptedDod(r, (call) => {
      if (call === 4) git(r.worktree, 'commit', '-q', '--allow-empty', '-m', 'moved');
      return {};
    });
    await assert.rejects(runMutants(input(r), deps(dod)), (err: Error) => {
      const moved = git(r.worktree, 'rev-parse', 'HEAD');
      assert.notEqual(moved, r.candidate);
      assert.ok(err.message.includes(r.candidate) && err.message.includes(moved), err.message);
      return true;
    });
    assertCommitted(r);
    assertNoArtifacts(r);
  }));

  test('acceptance 8: a marker left by an interrupted run refuses a run naming --restore before either runner [R8]', withRepo(async (r) => {
    const held = interrupted(r);
    const never = (): never => assert.fail('no runner is called');
    await assert.rejects(runMutants(input(r), { git: never, dod: never, now: () => START }), (err: Error) => {
      assert.ok(err.message.includes(r.marker), err.message);
      assert.ok(err.message.includes(`aidlc card mutants ${CARD} --restore`), err.message);
      return true;
    });
    assert.equal(r.read(), held, 'the file stays as the interrupted run left it');
  }));

  test('acceptance 8: --restore writes the original back and deletes the marker [R9]', withRepo((r) => {
    interrupted(r);
    assert.deepEqual(restoreMutants(r.worktree, CARD), { outcome: 'restored', message: `${CARD}: restored src/m.ts and deleted ${r.marker}` });
    assertCommitted(r);
    assert.equal(existsSync(r.marker), false);
  }));

  test('acceptance 8: a marker whose file holds the original is deleted with the file untouched [R9]', withRepo((r) => {
    interrupted(r);
    writeFileSync(path.join(r.worktree, 'src/m.ts'), SOURCE);
    assert.deepEqual(restoreMutants(r.worktree, CARD), { outcome: 'original', message: `${CARD}: src/m.ts already holds the original; deleted ${r.marker}` });
    assertCommitted(r);
    assert.equal(existsSync(r.marker), false);
  }));

  test('acceptance 8: a marker with no applied mutant is deleted [R9]', withRepo((r) => {
    mkdirSync(path.dirname(r.marker), { recursive: true });
    writeFileSync(r.marker, JSON.stringify({ schemaVersion: 1, cardId: CARD, candidateSha: r.candidate }));
    assert.deepEqual(restoreMutants(r.worktree, CARD), { outcome: 'idle', message: `${CARD}: no mutant was applied; deleted ${r.marker}` });
    assertCommitted(r);
    assert.equal(existsSync(r.marker), false);
  }));

  test('acceptance 8: other bytes, a missing file, a path outside the worktree and bytes that miss their sha256 are refused, file and marker unchanged [R9]', withRepo((r) => {
    const held = interrupted(r);
    const outside = path.join(r.dir, 'outside.ts');
    writeFileSync(outside, held);
    const saved = readFileSync(r.marker, 'utf8');
    const pending = MutantPending.parse(JSON.parse(saved));
    const refused = (pattern: RegExp) => {
      const marker = readFileSync(r.marker, 'utf8');
      const file = r.read();
      assert.throws(() => restoreMutants(r.worktree, CARD), pattern);
      assert.equal(readFileSync(r.marker, 'utf8'), marker, 'the marker is unchanged');
      assert.equal(r.read(), file, 'the file is unchanged');
      assert.equal(readFileSync(outside, 'utf8'), held, 'the file outside is unchanged');
    };
    writeFileSync(path.join(r.worktree, 'src/m.ts'), 'other bytes\n');
    refused(/src\/m\.ts/);
    writeFileSync(path.join(r.worktree, 'src/m.ts'), held);
    for (const file of ['../outside.ts', outside, '.', '..']) {
      writeFileSync(r.marker, JSON.stringify({ ...pending, applied: { ...pending.applied!, file } }));
      refused(/outside the worktree/);
    }
    writeFileSync(r.marker, JSON.stringify({ ...pending, applied: { ...pending.applied!, originalBase64: Buffer.from('not the original').toString('base64') } }));
    refused(/sha256/);
    writeFileSync(r.marker, saved);
    rmSync(path.join(r.worktree, 'src/m.ts'));
    assert.throws(() => restoreMutants(r.worktree, CARD), /src\/m\.ts/);
    assert.equal(readFileSync(r.marker, 'utf8'), saved);
  }));

  test('acceptance 8: with no marker --restore reports that nothing needs restoring [R9]', withRepo((r) => {
    assert.deepEqual(restoreMutants(r.worktree, CARD), { outcome: 'nothing', message: `${CARD}: nothing needs restoring` });
    assertCommitted(r);
  }));

  test('acceptance 8: a marker that appears between the check and the first mutant refuses naming --restore and stays [R6] [R8]', withRepo(async (r) => {
    const dod = scriptedDod(r, () => {
      mkdirSync(path.dirname(r.marker), { recursive: true });
      writeFileSync(r.marker, '{}');
      return {};
    });
    await assert.rejects(runMutants(input(r), deps(dod)), /--restore/);
    assert.equal(readFileSync(r.marker, 'utf8'), '{}', "another run's marker is not deleted");
    assertCommitted(r);
  }));

  test('acceptance 11: a symlink under src gets no mutant and the file it names is untouched [R2]', { skip: !SYMLINK_OK && 'this account cannot create symlinks' }, withRepo(async (r) => {
    const outside = path.join(r.dir, 'outside.ts');
    writeFileSync(outside, 'export const flag = true;\n');
    symlinkSync(outside, path.join(r.worktree, 'src/link.ts'));
    git(r.worktree, 'add', '-A');
    git(r.worktree, 'commit', '-q', '-m', 'link');
    const dod = scriptedDod(r);
    const { report } = await runMutants(input(r), deps(dod));
    assert.deepEqual([...new Set(report.mutants.map((m) => m.file))], ['src/m.ts']);
    assert.equal(readFileSync(outside, 'utf8'), 'export const flag = true;\n');
  }));

  test('acceptance 11: a symlink checked out as a regular file under core.symlinks=false gets no mutant [R2]', withRepo(async (r) => {
    git(r.worktree, 'config', 'core.symlinks', 'false');
    write(r.worktree, 'src/link.ts', 'true');
    const blob = git(r.worktree, 'hash-object', '-w', 'src/link.ts');
    git(r.worktree, 'update-index', '--add', '--cacheinfo', `120000,${blob},src/link.ts`);
    git(r.worktree, 'commit', '-q', '-m', 'symlink placeholder');
    assert.equal(git(r.worktree, 'status', '--porcelain'), '', 'the placeholder is clean');
    const { report } = await runMutants(input(r), deps(scriptedDod(r)));
    assert.deepEqual([...new Set(report.mutants.map((m) => m.file))], ['src/m.ts']);
    assert.equal(report.generated, 4);
    assert.equal(r.read('src/link.ts'), 'true');
  }));

  test('acceptance 11: a path the tree holds as a file but the disk does not gets no mutant [R2]', withRepo(async (r) => {
    write(r.worktree, 'src/gone.ts', 'export const gone = true;\n');
    git(r.worktree, 'add', '-A');
    git(r.worktree, 'commit', '-q', '-m', 'a file');
    git(r.worktree, 'update-index', '--skip-worktree', 'src/gone.ts');
    rmSync(path.join(r.worktree, 'src/gone.ts'));
    mkdirSync(path.join(r.worktree, 'src/gone.ts'));
    assert.equal(git(r.worktree, 'status', '--porcelain'), '', 'the skipped entry reads as clean');
    const { report } = await runMutants(input(r), deps(scriptedDod(r)));
    assert.deepEqual([...new Set(report.mutants.map((m) => m.file))], ['src/m.ts']);
  }));

  test('acceptance 11: a tree git cannot list is refused naming the command; the DoD never runs [R2]', withRepo(async (r) => {
    const dod = scriptedDod(r);
    const failing: MutantsDeps['git'] = (command, args, options) => (args.includes('ls-tree') ? { ...runSync(command, args, options), exitCode: 128, stderr: 'fatal: broken tree' } : runSync(command, args, options));
    await assertRefused(r, runMutants(input(r), { ...deps(dod), git: failing }), 'fatal: broken tree');
    assert.equal(dod.calls.length, 0);
    assertCommitted(r);
  }));

  test('acceptance 11: a submodule entry under src gets no mutant [R2]', withRepo(async (r) => {
    git(r.worktree, 'update-index', '--add', '--cacheinfo', `160000,${r.candidate},src/sub.ts`);
    mkdirSync(path.join(r.worktree, 'src/sub.ts'));
    git(r.worktree, 'commit', '-q', '-m', 'submodule');
    const { report } = await runMutants(input(r), deps(scriptedDod(r)));
    assert.deepEqual([...new Set(report.mutants.map((m) => m.file))], ['src/m.ts']);
  }));

  test("acceptance 11: the user's git configuration changes neither the files nor the lines of the mutants [R2]", withRepo(async (r) => {
    // Two changed lines one unchanged line apart, a renamed and edited file, and a path git quotes by default.
    write(r.worktree, 'src/near.ts', 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
    write(r.worktree, 'src/old.ts', 'export const keep = 1;\n'.repeat(8));
    git(r.worktree, 'add', '-A');
    git(r.worktree, 'commit', '-q', '-m', 'second base');
    const base = git(r.worktree, 'rev-parse', 'HEAD');
    write(r.worktree, 'src/near.ts', 'export const a = true;\nexport const b = 2;\nexport const c = true;\n');
    renameSync(path.join(r.worktree, 'src/old.ts'), path.join(r.worktree, 'src/new.ts'));
    write(r.worktree, 'src/new.ts', `${'export const keep = 1;\n'.repeat(8)}export const fresh = true;\n`);
    write(r.worktree, 'src/café.ts', 'export const quoted = true;\n');
    git(r.worktree, 'add', '-A');
    git(r.worktree, 'commit', '-q', '-m', 'second candidate');
    const expected = [
      ['src/café.ts', 1, 'flip-boolean'],
      ['src/near.ts', 1, 'flip-boolean'],
      ['src/near.ts', 3, 'flip-boolean'],
      ['src/new.ts', 9, 'flip-boolean'],
    ];
    const plain = await runMutants(input(r, { base }), deps(scriptedDod(r)));
    assert.deepEqual(plain.report.mutants.map((m) => [m.file, m.line, m.operator]), expected);
    for (const [key, value] of [['diff.noprefix', 'true'], ['diff.mnemonicPrefix', 'true'], ['diff.interHunkContext', '3'], ['diff.context', '5'], ['diff.renames', 'false'], ['color.diff', 'always'], ['color.ui', 'always'], ['core.quotePath', 'true'], ['diff.external', 'exit 0'], ['diff.upper.textconv', "printf '' #"]] as const) git(r.worktree, 'config', key, value);
    writeFileSync(path.join(r.worktree, '.git', 'info', 'attributes'), '*.ts diff=upper\n');
    const configured = await runMutants(input(r, { base }), deps(scriptedDod(r)));
    assert.deepEqual(configured.report.mutants.map((m) => [m.file, m.line, m.operator]), expected);
    writeFileSync(path.join(r.worktree, '.git', 'info', 'attributes'), '*.ts -diff\n');
    const binary = await runMutants(input(r, { base }), deps(scriptedDod(r)));
    assert.deepEqual(binary.report.mutants.map((m) => [m.file, m.line, m.operator]), expected, 'a -diff attribute drops no file');
  }));

  test('acceptance 11: a baseline run that rewrites the first mutant\'s file stops the run naming it before any mutant, and the marker is gone [R7]', withRepo(async (r) => {
    const dod = scriptedDod(r, (call) => {
      if (call === 0) writeFileSync(path.join(r.worktree, 'src/m.ts'), 'edited during the baseline\n');
      return {};
    });
    await assertRefused(r, runMutants(input(r), deps(dod)), 'src/m.ts');
    assert.equal(r.read(), 'edited during the baseline\n', 'the edit is not overwritten');
    assert.equal(dod.calls.length, 1, 'no mutant ran');
  }));

  test("acceptance 11: a DoD that rewrites the next mutant's file stops the run naming it, the file keeps those bytes and the marker is gone [R7]", withRepo(async (r) => {
    write(r.worktree, 'src/a.ts', 'export const a = true;\n');
    write(r.worktree, 'src/b.ts', 'export const b = true;\n');
    git(r.worktree, 'add', '-A');
    git(r.worktree, 'commit', '-q', '-m', 'two files');
    const dod = scriptedDod(r, (call) => {
      if (call === 1) writeFileSync(path.join(r.worktree, 'src/b.ts'), 'edited during the sweep\n');
      return {};
    });
    await assert.rejects(runMutants(input(r, { max: 2 }), deps(dod)), /src\/b\.ts/);
    assert.equal(r.read('src/b.ts'), 'edited during the sweep\n', 'the edit is not overwritten');
    assert.equal(r.read('src/a.ts'), 'export const a = true;\n');
    assertNoArtifacts(r);
    assert.equal(dod.calls.length, 2, 'no DoD ran on the edited file');
  }));
});

describe('no read or write follows a link out of the worktree (card T1-VERIFY-MUTANTS R14)', () => {
  /** 'junction' needs no privilege on Windows; elsewhere the type is ignored and this is a symlink. */
  const link = (target: string, at: string) => symlinkSync(target, at, 'junction');
  const outsideDir = (r: Repo): string => {
    const dir = path.join(r.dir, 'outside');
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  /** Moves `src` out of the worktree and leaves a link in its place, so the file under the link keeps its bytes. */
  const swapSrc = (r: Repo): string => {
    const moved = path.join(outsideDir(r), 'src');
    renameSync(path.join(r.worktree, 'src'), moved);
    link(moved, path.join(r.worktree, 'src'));
    return path.join(moved, 'm.ts');
  };
  /** Replaces `.review` with a link to an empty directory outside. */
  const swapReview = (r: Repo): string => {
    const empty = path.join(outsideDir(r), 'review');
    mkdirSync(empty);
    rmSync(path.join(r.worktree, '.review'), { recursive: true, force: true });
    link(empty, path.join(r.worktree, '.review'));
    return empty;
  };
  const LINK_REFUSAL = /is not a directory/;
  const HARD_LINK = /has 2 hard links/;
  const NOT_REGULAR = /is not a regular file with one name/;
  /** Replaces the source with a hard link to an outside file that holds `text`, and returns the outside path. */
  const swapHardLink = (r: Repo, text: string): string => {
    const outside = path.join(outsideDir(r), 'm.ts');
    writeFileSync(outside, text);
    rmSync(path.join(r.worktree, 'src/m.ts'));
    linkSync(outside, path.join(r.worktree, 'src/m.ts'));
    return outside;
  };

  test('acceptance 12: a baseline DoD that swaps src for a link to identical bytes stops with the outside file unchanged and no marker [R14]', withRepo(async (r) => {
    let outside = '';
    const dod = scriptedDod(r, (call) => {
      if (call === 0) outside = swapSrc(r);
      return {};
    });
    await assert.rejects(runMutants(input(r), deps(dod)), LINK_REFUSAL);
    assert.equal(readFileSync(outside, 'utf8'), SOURCE, 'no mutant was written through the link');
    assert.equal(dod.calls.length, 1, 'no mutant ran');
    assertNoArtifacts(r);
  }));

  test('acceptance 12: a mutant DoD that swaps src for a link stops with the mutant left outside unchanged and the marker kept [R14]', withRepo(async (r) => {
    let outside = '';
    let held = '';
    const dod = scriptedDod(r, (call, source) => {
      if (call === 1) {
        held = source;
        outside = swapSrc(r);
      }
      return {};
    });
    await assert.rejects(runMutants(input(r), deps(dod)), LINK_REFUSAL);
    assert.equal(readFileSync(outside, 'utf8'), held, 'the restore did not write through the link');
    assert.equal(MutantPending.parse(JSON.parse(readFileSync(r.marker, 'utf8'))).applied?.file, 'src/m.ts');
    assert.equal(dod.calls.length, 2);
  }));

  test('acceptance 12: a .review link present before the run refuses before either runner [R14]', withRepo(async (r) => {
    writeFileSync(path.join(r.worktree, '.git', 'info', 'exclude'), '.review\n');
    const empty = swapReview(r);
    const never = (): never => assert.fail('no runner is called');
    await assert.rejects(runMutants(input(r), { git: never, dod: never, now: () => START }), LINK_REFUSAL);
    assert.deepEqual(readdirSync(empty), []);
  }));

  test('acceptance 12: a .review link a baseline DoD puts there stops before the marker, with nothing written outside [R14]', withRepo(async (r) => {
    let empty = '';
    const dod = scriptedDod(r, (call) => {
      if (call === 0) empty = swapReview(r);
      return {};
    });
    await assert.rejects(runMutants(input(r), deps(dod)), LINK_REFUSAL);
    assert.deepEqual(readdirSync(empty), []);
    assert.equal(r.read(), SOURCE);
    assert.equal(dod.calls.length, 1);
  }));

  test('acceptance 12: a .review link a mutant DoD puts there stops with the file restored and nothing written outside [R14]', withRepo(async (r) => {
    let empty = '';
    const dod = scriptedDod(r, (call) => {
      if (call === 1) empty = swapReview(r);
      return {};
    });
    await assert.rejects(runMutants(input(r), deps(dod)), LINK_REFUSAL);
    assert.deepEqual(readdirSync(empty), []);
    assert.equal(r.read(), SOURCE, 'the file went back before the marker was refused');
  }));

  test('acceptance 12: a stop keeps the first error when the marker cleanup is refused too [R14]', withRepo(async (r) => {
    const boom = new Error('runner broke');
    let empty = '';
    const dod = scriptedDod(r, (call) => {
      if (call === 1) {
        empty = swapReview(r);
        throw boom;
      }
      return {};
    });
    await assert.rejects(runMutants(input(r), deps(dod)), (err) => err === boom, 'the refused cleanup does not replace the error of the run');
    assert.deepEqual(readdirSync(empty), [], 'the cleanup deleted nothing through the link');
    assert.equal(r.read(), SOURCE);
  }));

  test('acceptance 12: a marker cleanup that fails after the last mutant fails the run, with no report [R14]', withRepo(async (r) => {
    const lines: string[] = [];
    const run = runMutants(input(r), deps(scriptedDod(r), (line) => {
      lines.push(line);
      if (lines.length === 4) rmSync(r.marker);
    }));
    await assert.rejects(run, /ENOENT/);
    assert.equal(lines.length, 4);
    assertNoArtifacts(r);
    assertCommitted(r);
  }));

  test('acceptance 12: a .review link that appears before the report is written stops with nothing written outside [R14]', withRepo(async (r) => {
    let empty = '';
    const times = [START];
    const dod = scriptedDod(r);
    const clock = () => {
      const next = times.shift();
      if (next) return next;
      empty = swapReview(r);
      return FINISH;
    };
    await assert.rejects(runMutants(input(r), { ...deps(dod), now: clock }), LINK_REFUSAL);
    assert.deepEqual(readdirSync(empty), []);
    assert.equal(r.read(), SOURCE);
  }));

  test('acceptance 12: restore refuses a marker that names a file through a linked parent, outside file and marker unchanged [R14]', withRepo((r) => {
    const held = interrupted(r);
    const dir = outsideDir(r);
    writeFileSync(path.join(dir, 'm.ts'), held);
    link(dir, path.join(r.worktree, 'src', 'link'));
    const pending = MutantPending.parse(JSON.parse(readFileSync(r.marker, 'utf8')));
    const saved = JSON.stringify({ ...pending, applied: { ...pending.applied!, file: 'src/link/m.ts' } });
    writeFileSync(r.marker, saved);
    assert.throws(() => restoreMutants(r.worktree, CARD), LINK_REFUSAL);
    assert.equal(readFileSync(path.join(dir, 'm.ts'), 'utf8'), held);
    assert.equal(readFileSync(r.marker, 'utf8'), saved);
  }));

  test('acceptance 12: restore refuses a .review link, the outside marker unchanged [R14]', withRepo((r) => {
    interrupted(r);
    const dir = outsideDir(r);
    const moved = path.join(dir, 'review');
    renameSync(path.join(r.worktree, '.review'), moved);
    link(moved, path.join(r.worktree, '.review'));
    const saved = readFileSync(path.join(moved, `${CARD}.mutants.pending.json`), 'utf8');
    assert.throws(() => restoreMutants(r.worktree, CARD), LINK_REFUSAL);
    assert.equal(readFileSync(path.join(moved, `${CARD}.mutants.pending.json`), 'utf8'), saved);
  }));

  test('acceptance 14: a baseline DoD that swaps a source for a hard link to identical bytes outside stops with the outside file unchanged and no marker [R16]', withRepo(async (r) => {
    let outside = '';
    const dod = scriptedDod(r, (call) => {
      if (call === 0) outside = swapHardLink(r, SOURCE);
      return {};
    });
    await assert.rejects(runMutants(input(r), deps(dod)), HARD_LINK);
    assert.equal(readFileSync(outside, 'utf8'), SOURCE, 'no mutant was written through the hard link');
    assert.equal(dod.calls.length, 1, 'no mutant ran');
    assertNoArtifacts(r);
  }));

  test('acceptance 14: a mutant DoD that swaps a source for a hard link stops with the mutant left outside unchanged and the marker kept [R16]', withRepo(async (r) => {
    let outside = '';
    let held = '';
    const dod = scriptedDod(r, (call, source) => {
      if (call === 1) {
        held = source;
        outside = swapHardLink(r, source);
      }
      return {};
    });
    await assert.rejects(runMutants(input(r), deps(dod)), HARD_LINK);
    assert.equal(readFileSync(outside, 'utf8'), held, 'the restore did not write through the hard link');
    assert.equal(MutantPending.parse(JSON.parse(readFileSync(r.marker, 'utf8'))).applied?.file, 'src/m.ts');
    assert.equal(dod.calls.length, 2);
  }));

  test('acceptance 14: a source hard linked outside is refused before the first read of a run [R16]', withRepo(async (r) => {
    const outside = swapHardLink(r, SOURCE);
    const dod = scriptedDod(r);
    await assert.rejects(runMutants(input(r), deps(dod)), HARD_LINK);
    assert.equal(dod.calls.length, 0);
    assert.equal(readFileSync(outside, 'utf8'), SOURCE);
  }));

  test('acceptance 14: restore refuses a source hard linked outside, with the outside file and the marker unchanged [R16]', withRepo((r) => {
    const held = interrupted(r);
    const outside = swapHardLink(r, held);
    const saved = readFileSync(r.marker, 'utf8');
    assert.throws(() => restoreMutants(r.worktree, CARD), HARD_LINK);
    assert.equal(readFileSync(outside, 'utf8'), held);
    assert.equal(readFileSync(r.marker, 'utf8'), saved);
  }));

  test('acceptance 14: a marker path that is a link is refused by a run before either runner and by restore, with both sides unchanged [R14]', withRepo(async (r) => {
    const dir = outsideDir(r);
    writeFileSync(path.join(dir, 'keep.txt'), 'kept\n');
    mkdirSync(path.dirname(r.marker), { recursive: true });
    link(dir, r.marker);
    const never = (): never => assert.fail('no runner is called');
    await assert.rejects(runMutants(input(r), { git: never, dod: never, now: () => START }), NOT_REGULAR);
    assert.throws(() => restoreMutants(r.worktree, CARD), NOT_REGULAR);
    assert.equal(readFileSync(path.join(dir, 'keep.txt'), 'utf8'), 'kept\n');
  }));

  /** A run and a restore each refuse the marker before reading it, and neither changes either side. */
  async function assertMarkerRefused(r: Repo, outside: string, held: string): Promise<void> {
    const saved = readFileSync(outside);
    const never = (): never => assert.fail('no runner is called');
    await assert.rejects(runMutants(input(r), { git: never, dod: never, now: () => START }), NOT_REGULAR);
    assert.throws(() => restoreMutants(r.worktree, CARD), NOT_REGULAR);
    assert.deepEqual(readFileSync(outside), saved, 'the outside marker is unchanged');
    assert.deepEqual(readFileSync(r.marker), saved, 'the marker path still reads the same bytes');
    assert.equal(r.read(), held, 'the source stays as it is');
  }

  test('acceptance 14: a marker that is a symlink to an outside file is refused by a run and by restore without reading it [R14]', { skip: !SYMLINK_OK && 'this account cannot create symlinks' }, withRepo(async (r) => {
    const held = interrupted(r);
    const outside = path.join(outsideDir(r), 'marker.json');
    writeFileSync(outside, readFileSync(r.marker));
    rmSync(r.marker);
    symlinkSync(outside, r.marker);
    await assertMarkerRefused(r, outside, held);
  }));

  test('acceptance 14: a marker hard linked to an outside file is refused by a run and by restore with both files unchanged [R14]', withRepo(async (r) => {
    const held = interrupted(r);
    const outside = path.join(outsideDir(r), 'marker.json');
    writeFileSync(outside, readFileSync(r.marker));
    rmSync(r.marker);
    linkSync(outside, r.marker);
    await assertMarkerRefused(r, outside, held);
  }));

  test('acceptance 14: a report path hard linked to an outside file leaves that file unchanged, since the report replaces the path [R14] [R16]', withRepo(async (r) => {
    const outside = path.join(outsideDir(r), 'report.json');
    writeFileSync(outside, 'outside\n');
    mkdirSync(path.dirname(r.report), { recursive: true });
    linkSync(outside, r.report);
    await runMutants(input(r), deps(scriptedDod(r)));
    assert.equal(readFileSync(outside, 'utf8'), 'outside\n');
    assert.equal(reportOf(r).cardId, CARD);
  }));

  test('acceptance 13: every git call carries --no-optional-locks and a stale stat cache leaves the index bytes alone [R15]', withRepo(async (r) => {
    utimesSync(path.join(r.worktree, 'src/m.ts'), new Date('2030-01-01T00:00:00.000Z'), new Date('2030-01-01T00:00:00.000Z'));
    const index = path.join(r.worktree, '.git', 'index');
    const saved = readFileSync(index);
    const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv | undefined }> = [];
    await runMutants(input(r, { max: 1 }), { ...deps(killOne(r)), git: (command, args, options) => {
      calls.push({ args, env: options?.env });
      return runSync(command, args, options);
    } });
    assert.ok(calls.length >= 4, 'status, head, diff and ls-tree at least');
    for (const { args, env } of calls) {
      assert.deepEqual(args.slice(0, 3), ['--no-optional-locks', '-c', 'core.fsmonitor=false'], JSON.stringify(args));
      assert.deepEqual(Object.keys(env ?? {}).filter((name) => /^git_/i.test(name)).sort(), ['GIT_ALLOW_PROTOCOL', 'GIT_NO_LAZY_FETCH'], 'no inherited GIT_ variable');
      assert.deepEqual([env?.['GIT_NO_LAZY_FETCH'], env?.['GIT_ALLOW_PROTOCOL']], ['1', '']);
    }
    assert.deepEqual(readFileSync(index), saved, 'the index was not rewritten');
  }));

  test('acceptance 13: an inherited GIT_DIFF_OPTS or GIT_DIR keeps every mutant [R15]', withRepo(async (r) => {
    for (const [name, value] of [['GIT_DIFF_OPTS', '--unified=3'], ['GIT_DIR', path.join(r.dir, 'no-such-repository')]] as const) {
      process.env[name] = value;
      try {
        const { report } = await runMutants(input(r), deps(scriptedDod(r)));
        assert.equal(report.generated, 4, `${name} changed the sweep`);
      } finally {
        delete process.env[name];
      }
    }
  }));

  test('acceptance 13: a base that starts with - is refused before the git runner [R10]', withRepo(async (r) => {
    const never = (): never => assert.fail('the git runner is not called');
    for (const base of ['--output=written-by-git', '-x']) await assert.rejects(runMutants(input(r, { base }), { ...deps(scriptedDod(r)), git: never }), /starts with -/);
    assert.equal(existsSync(path.join(r.worktree, 'written-by-git')), false);
  }));

  test('acceptance 13: in a partial clone a base blob the clone lacks is refused and never fetched, whether or not git honours GIT_NO_LAZY_FETCH [R15]', withRepo(async (r) => {
    git(r.worktree, 'config', 'uploadpack.allowFilter', 'true');
    const clone = path.join(r.dir, 'partial');
    git(r.dir, 'clone', '-q', '--filter=blob:none', pathToFileURL(r.worktree).href, clone);
    const blob = git(r.worktree, 'rev-parse', `${r.base}:src/m.ts`);
    const without = (env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(env ?? {}).filter(([name]) => name.toUpperCase() !== 'GIT_NO_LAZY_FETCH'));
    const held = (env: NodeJS.ProcessEnv) => spawnSync('git', ['cat-file', '-e', blob], { cwd: clone, encoding: 'utf8', env, windowsHide: true }).status === 0;
    const noFetch = { ...without(process.env), GIT_ALLOW_PROTOCOL: '' };
    const dod = scriptedDod(r);
    const sweep = { ...input(r), worktree: clone };
    await assert.rejects(runMutants(sweep, deps(dod)), /git diff/);
    assert.equal(held(noFetch), false, 'the sweep fetched the blob');
    const ignored: SyncRunner = (command, args, options) => runSync(command, args, { ...options, env: without(options?.env) });
    await assert.rejects(runMutants(sweep, { ...deps(dod), git: ignored }), /git diff/);
    assert.equal(held(noFetch), false, 'with the variable ignored, the sweep fetched the blob');
    assert.equal(dod.calls.length, 0, 'no DoD ran');
    assert.equal(held(without(process.env)), true, 'a plain read fetches the blob, so the fixture exercises lazy fetching');
  }));
});

describe('aidlc card mutants through the CLI (card T1-VERIFY-MUTANTS)', () => {
  const CHECK = "import { readFileSync } from 'node:fs';\nprocess.exit(readFileSync('src/c.ts', 'utf8').includes('return a >= 0;') ? 1 : 0);\n";
  const CLI_CARD = 'T1-MCLI';

  /** The harness fixture as the main checkout, a goal whose card run records a temp git repository as its worktree. */
  function cliFixture() {
    const fx = makeFixture();
    const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-mutants-cli-')));
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'core.autocrlf', 'false');
    write(dir, '.gitignore', '.review/\n');
    write(dir, 'check.mjs', CHECK);
    write(dir, 'src/c.ts', 'export const base = 1;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    const base = git(dir, 'rev-parse', 'HEAD');
    write(dir, 'src/c.ts', 'export const base = 1;\nexport function f(a: number) {\n  return a > 0;\n}\nexport const on = true;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'candidate');
    writeCard(fx, { id: CLI_CARD, title: 'a card with a real DoD', dodCommand: 'node check.mjs' });
    writeCard(fx, { id: 'T1-MNORUN', title: 'a card with no run' });
    const goal = goalForCards(fx, [CLI_CARD, 'T1-MNORUN']);
    fx.store.saveCardRun({ ...fx.controller.ensureCardRun(goal, CLI_CARD), worktree: dir, base: { ref: 'main', oid: base } });
    const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, 'card', 'mutants', ...args, '--json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-A' }, encoding: 'utf8', timeout: 120_000 });
    return { fx, dir, base, goal, cli, cleanup: () => { fx.cleanup(); rmSync(dir, { recursive: true, force: true }); } };
  }

  test('acceptance 9: the command runs the real DoD through the shell, prints the report for HEAD and leaves the run and the journal unchanged [R1] [R4] [R12]', () => {
    const f = cliFixture();
    try {
      const saved = f.fx.store.getCardRun(f.goal.id, CLI_CARD);
      const events = f.fx.events(f.goal.id);
      const r = f.cli(CLI_CARD);
      assert.equal(r.status, 0, r.stderr);
      const printed = JSON.parse(r.stdout) as MutantReport & { path: string };
      assert.equal(printed.path, mutantsReportPath(f.dir, CLI_CARD));
      assert.deepEqual(MutantReport.parse(JSON.parse(readFileSync(printed.path, 'utf8'))), MutantReport.parse(printed));
      assert.equal(printed.candidateSha, git(f.dir, 'rev-parse', 'HEAD'));
      assert.equal(printed.base, f.base);
      assert.equal(printed.dodCommand, 'node check.mjs');
      assert.deepEqual(printed.mutants.map((m) => [m.line, m.operator, m.outcome]), [[3, 'boundary', 'killed'], [5, 'flip-boolean', 'survived']]);
      assert.deepEqual(r.stderr.trim().split(/\r?\n/).map((l) => l.replace(/\d+ ms/, 'N ms')), ['mutant 1/2 src/c.ts:3:12 boundary: killed (exit 1, N ms)', 'mutant 2/2 src/c.ts:5:19 flip-boolean: survived (exit 0, N ms)']);
      assert.deepEqual(f.fx.store.getCardRun(f.goal.id, CLI_CARD), saved, 'the card run is unchanged');
      assert.deepEqual(f.fx.events(f.goal.id), events, 'the journal has no new event');
      assert.equal(git(f.dir, 'status', '--porcelain'), '');
    } finally {
      f.cleanup();
    }
  });

  test('acceptance 9: --max and --timeout-ms reach the run, --goal selects it, and a value that is no number is refused [R1] [R10]', () => {
    const f = cliFixture();
    try {
      const r = f.cli(CLI_CARD, '--max', '1', '--timeout-ms', '60000', '--goal', f.goal.id);
      assert.equal(r.status, 0, r.stderr);
      const printed = JSON.parse(r.stdout) as MutantReport;
      assert.deepEqual([printed.max, printed.timeoutMs, printed.generated, printed.skipped], [1, 60000, 2, 1]);
      for (const args of [['--max', 'many'], ['--timeout-ms', '10s']]) {
        const bad = f.cli(CLI_CARD, ...args);
        assert.notEqual(bad.status, 0);
        assert.ok(bad.stderr.includes(args[0]!), bad.stderr);
      }
    } finally {
      f.cleanup();
    }
  });

  test('acceptance 9: --restore repairs an interrupted run and reports nothing to restore after it [R9]', () => {
    const f = cliFixture();
    try {
      const source = readFileSync(path.join(f.dir, 'src/c.ts'));
      const mutated = source.toString('utf8').replace('return a > 0;', 'return a >= 0;');
      writeFileSync(path.join(f.dir, 'src/c.ts'), mutated);
      const marker = mutantsMarkerPath(f.dir, CLI_CARD);
      mkdirSync(path.dirname(marker), { recursive: true });
      writeFileSync(marker, JSON.stringify({ schemaVersion: 1, cardId: CLI_CARD, candidateSha: 'x', applied: { file: 'src/c.ts', originalBase64: source.toString('base64'), originalSha256: sha256(source), mutantSha256: sha256(mutated) } }));
      const refused = f.cli(CLI_CARD);
      assert.notEqual(refused.status, 0);
      assert.ok(refused.stderr.includes('--restore'), refused.stderr);
      const r = f.cli(CLI_CARD, '--restore');
      assert.equal(r.status, 0, r.stderr);
      assert.equal((JSON.parse(r.stdout) as { outcome: string }).outcome, 'restored');
      assert.deepEqual(readFileSync(path.join(f.dir, 'src/c.ts')), source);
      assert.equal((JSON.parse(f.cli(CLI_CARD, '--restore').stdout) as { outcome: string }).outcome, 'nothing');
    } finally {
      f.cleanup();
    }
  });

  test('acceptance 9: a card with no run, and a run whose worktree is gone, exit non-zero naming the card and write no file [R1]', () => {
    const f = cliFixture();
    try {
      const noRun = f.cli('T1-MNORUN');
      assert.notEqual(noRun.status, 0);
      assert.ok(noRun.stderr.includes('T1-MNORUN'), noRun.stderr);
      assert.equal(existsSync(path.join(f.dir, '.review')), false);
      const gone = path.join(f.dir, 'gone');
      f.fx.store.saveCardRun({ ...f.fx.store.getCardRun(f.goal.id, CLI_CARD)!, worktree: gone });
      const missing = f.cli(CLI_CARD);
      assert.notEqual(missing.status, 0);
      assert.ok(missing.stderr.includes(CLI_CARD) && missing.stderr.includes(gone), missing.stderr);
      assert.equal(existsSync(path.join(f.dir, '.review')), false);
      assert.equal(existsSync(gone), false);
      f.fx.store.saveCardRun({ ...f.fx.store.getCardRun(f.goal.id, CLI_CARD)!, worktree: undefined });
      const none = f.cli(CLI_CARD, '--restore');
      assert.notEqual(none.status, 0);
      assert.ok(none.stderr.includes(CLI_CARD), none.stderr);
    } finally {
      f.cleanup();
    }
  });
});

describe('the docs of card T1-VERIFY-MUTANTS', () => {
  const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

  test('acceptance 10: the Mutant sweep section has the usage line, the defaults, the paths and the three sentences; ARCHITECTURE and the CHANGELOG record the command [R13]', () => {
    const ops = read('docs/OPERATIONS.md');
    const start = ops.indexOf('### Mutant sweep');
    const section = ops.slice(start, ops.indexOf('\n### ', start + 1));
    for (const text of [
      'aidlc card mutants <card> [--goal <id>] [--max <n>] [--timeout-ms <n>] [--restore]',
      '`aidlc card mutants` is advisory: no gate reads its report, and a card ships without one.',
      'A run refuses a worktree with uncommitted or untracked changes before it writes any file.',
      'After an interrupted run, run `aidlc card mutants <card> --restore` before any commit: until then a source file may hold a mutant.',
      '`<worktree>/.review/<card>.mutants.json`',
      '`<worktree>/.review/<card>.mutants.pending.json`',
      '`--max` defaults to 30',
      '`--timeout-ms` defaults to 120000',
      'A repository must git-ignore `.review/`: otherwise the first report is an untracked file and the next run refuses.',
    ]) assert.ok(section.includes(text), `the Mutant sweep section states: ${text}`);
    const arch = read('docs/ARCHITECTURE.md');
    assert.ok(arch.includes('`src/review/mutant-gen.ts`'), 'ARCHITECTURE names mutant-gen.ts');
    assert.ok(arch.indexOf('`src/review/mutants.ts`') > arch.indexOf('`src/review/mutant-gen.ts`'), 'ARCHITECTURE names mutants.ts after mutant-gen.ts');
    const changelog = read('CHANGELOG.md');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
    const entry = unreleased.split('\n').find((line) => line.startsWith('- T1-VERIFY-MUTANTS-2:'));
    assert.ok(entry?.includes('`aidlc card mutants`'), 'the CHANGELOG entry names the command');
  });
});
