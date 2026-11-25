// Card T0-DOD-SCAFFOLD-SHELL-4 (issue 348): on the scaffold ship path the loop-run DoD of `card attempt` and the DoD runs of
// `card mutants` run the card's dod_command through `pwsh -NoProfile -Command` with the scaffold's two preferences, as the
// scaffold ship's DoD leg does; the github and dry-run paths keep the platform shell, and loopDod names the shell.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { runSync, scriptedRunner, type ExecOptions, type ExecReceipt } from '../../src/probes/exec.ts';
import { dodCall, mutantsReportPath, runMutants } from '../../src/review/mutants.ts';
import type { CardRun, LoopDod } from '../../src/core/types.ts';
import { goalForCards, makeFixture, writeCard } from '../scenarios/_harness.ts';
import { fragmentEntry } from './changelog.ts';
import { tmpDir } from './helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
/** The payload prefix of the scaffold's `Get-ScaffoldDodPayload` (scripts/_cards.ps1), from the card's R1. */
const PREFIX = "$ErrorActionPreference='Stop'; $PSNativeCommandUseErrorActionPreference=$true; ";
const CARD = 'T0-DS';
const DOD = 'Write-Output ok; exit 0';
const scaffold = (dod: string, cwd: string, timeoutMs: number) => ['pwsh', ['-NoProfile', '-Command', PREFIX + dod], { cwd, timeoutMs }];
const platform = (dod: string, cwd: string, timeoutMs: number) => [dod, [], { cwd, shell: true, timeoutMs }];
/** A DoD receipt that exits 0, for the scripted DoD runs. */
const receipt = (command: string, args: string[], options?: ExecOptions): ExecReceipt => ({ command, args, cwd: options?.cwd ?? '', exitCode: 0, signal: null, timedOut: false, stdout: 'ok\n', stderr: '', startedAt: '2026-11-17T01:00:00.000Z', finishedAt: '2026-11-17T01:00:01.000Z', durationMs: 5, outputSha256: '' });

async function inTemp(body: (dir: string) => unknown): Promise<void> {
  const dir = tmpDir('aidlc-dod-shell-');
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function git(cwd: string, ...args: string[]): string {
  const r = runSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd });
  assert.equal(r.exitCode, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
/** A base commit and a candidate whose src/m.ts adds `if (b) return 1;`: three mutants (drop-statement, force-true, force-false). Returns the base. */
function candidateRepo(dir: string): string {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'core.autocrlf', 'false');
  writeFileSync(path.join(dir, '.gitignore'), '.review/\n');
  mkdirSync(path.join(dir, 'src'));
  writeFileSync(path.join(dir, 'src', 'm.ts'), 'export const a = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  writeFileSync(path.join(dir, 'src', 'm.ts'), 'export const a = 1;\nexport function f(b: boolean): number {\n  if (b) return 1;\n  return 0;\n}\n');
  git(dir, 'commit', '-q', '-am', 'candidate');
  return base;
}

test('dodCall: scaffold is pwsh with the two preferences and no shell key; github and dry-run are the platform shell [R1]', () => {
  const wt = path.join('C:', 'wt', 'CARD');
  const call = dodCall({ dod_command: 'npm test; exit 0' }, wt, 5000, 'scaffold');
  assert.deepEqual(call, scaffold('npm test; exit 0', wt, 5000));
  assert.equal('shell' in call[2], false, 'the scaffold call has no shell key');
  for (const ship of ['github', 'dry-run'] as const) assert.deepEqual(dodCall({ dod_command: 'npm test' }, wt, 5000, ship), platform('npm test', wt, 5000), ship);
});

/** The issue 348 DoD shape: a preference, double- and single-quoted strings, a `$` variable, a foreach block, `;` separators. */
const ISSUE_348 = `$ErrorActionPreference = 'Stop'; $names = @("alpha", 'beta'); $n = 0; foreach ($x in $names) { $n += $x.Length }; Write-Output "count $n"; Write-Output '[DOD-PASS]'; exit 0`;
const PWSH_ROWS: [string, string, 'scaffold' | 'github', (r: ExecReceipt) => void][] = [
  ['the issue 348 DoD shape exits 0 and prints [DOD-PASS]', ISSUE_348, 'scaffold', (r) => assert.deepEqual([r.exitCode, r.stdout.includes('[DOD-PASS]'), r.stdout.includes('count 9')], [0, true, true], r.stdout + r.stderr)],
  ['a native command that exits 3, then exit 0, exits nonzero (the native-command preference applies)', 'node -e "process.exit(3)"; exit 0', 'scaffold', (r) => assert.deepEqual([r.timedOut, r.exitCode === 0], [false, false], r.stdout + r.stderr)],
  ['a dod that ends exit 4 exits 4', "Write-Output 'x'; exit 4", 'scaffold', (r) => assert.equal(r.exitCode, 4)],
];
// The reported symptom: cmd.exe does not run the issue 348 shape to exit 0.
if (process.platform === 'win32') PWSH_ROWS.push(['on win32 the issue 348 DoD shape through the platform call does not exit 0', ISSUE_348, 'github', (r) => assert.notEqual(r.exitCode, 0, r.stdout + r.stderr)]);

describe('a real pwsh through the DoD call [R1]', () => {
  for (const [name, dod, ship, check] of PWSH_ROWS) test(name, () => inTemp((dir) => check(runSync(...dodCall({ dod_command: dod }, dir, 60_000, ship)))));
});

/** A card at BUILD whose runner has a scaffold config and records every call; a non-git call returns exit 0. */
function scaffoldAtBuild() {
  const fx = makeFixture();
  writeCard(fx, { id: CARD, title: 'dod shell', allowPaths: ['src/t0-ds.ts'], dodCommand: DOD });
  const goalId = goalForCards(fx, [CARD]).id;
  const card = fx.card(CARD);
  const g = () => fx.goal(goalId);
  const dry = fx.runner();
  let r = dry.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
  r = dry.next(g(), card, r.run);
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  const worktree = r.run.worktree!;
  mkdirSync(worktree, { recursive: true });
  const script = scriptedRunner({ 'git rev-parse --verify HEAD': { stdout: `${'c'.repeat(40)}\n` }, 'git status --porcelain=v1 --untracked-files=all': { stdout: '' } });
  const calls: [string, string[], ExecOptions | undefined][] = [];
  const recording = (command: string, args: string[], opts?: ExecOptions): ExecReceipt => (calls.push([command, args, opts]), command === 'git' ? script(command, args, opts) : receipt(command, args, opts));
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, shipPath: 'scaffold' }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: recording });
  const succeed = () => runner.recordAttempt(g(), card, fx.store.getCardRun(goalId, CARD)!, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1' });
  const statusLine = () => {
    const s = spawnSync(process.execPath, [MAIN, 'card', 'status', CARD, '--goal', goalId, '--no-json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-A' }, encoding: 'utf8', timeout: 60_000 });
    assert.equal(s.status, 0, s.stderr);
    return s.stdout.split(/\r?\n/).find((l) => l.startsWith('loopDod='));
  };
  return { fx, goalId, worktree, succeed, statusLine, nonGit: () => calls.filter((c) => c[0] !== 'git') };
}
const loopDodOf = (run: CardRun) => (run.effort!.attempts.at(-1) as { loopDod?: LoopDod & Record<string, unknown> }).loopDod;
async function withScaffold(body: (c: ReturnType<typeof scaffoldAtBuild>) => void): Promise<void> {
  const c = scaffoldAtBuild();
  try {
    body(c);
  } finally {
    c.fx.cleanup();
  }
}

describe('the loop-run DoD on the scaffold path [R2] [R3]', () => {
  test('a success runs the scaffold call once with the tree kill and records shell pwsh', () => withScaffold((c) => {
    const rec = loopDodOf(c.succeed());
    assert.deepEqual([rec?.ran, rec?.shell], [true, 'pwsh']);
    assert.deepEqual(c.nonGit(), [['pwsh', ['-NoProfile', '-Command', PREFIX + DOD], { cwd: c.worktree, timeoutMs: 540000, killTree: true }]]);
  }));

  test('a stored loopDod without shell parses and card status prints the same loopDod= line', () => withScaffold((c) => {
    c.succeed();
    const before = c.statusLine();
    assert.match(before ?? '', /^loopDod=attempt 1 exit=0 /);
    const file = c.fx.store.cardFile(c.goalId, CARD);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { effort: { attempts: { loopDod?: Record<string, unknown> }[] } };
    const stored = raw.effort.attempts.at(-1)!.loopDod!;
    assert.equal(stored['shell'], 'pwsh', 'the stored record carried shell before it is removed');
    delete stored['shell'];
    writeFileSync(file, JSON.stringify(raw, null, 2), 'utf8');
    const parsed = loopDodOf(c.fx.store.getCardRun(c.goalId, CARD)!);
    assert.deepEqual([parsed?.ran, parsed && 'shell' in parsed], [true, false], 'the record without shell parses');
    assert.equal(c.statusLine(), before);
  }));
});

describe('card mutants passes the ship path to the DoD call [R2]', () => {
  for (const ship of ['scaffold', 'github'] as const) {
    test(`runMutants given ${ship}: the ${ship === 'scaffold' ? 'scaffold' : 'platform'} call on the unmutated candidate and on each mutant`, () => inTemp(async (dir) => {
      const base = candidateRepo(dir);
      const calls: unknown[] = [];
      const dod = async (command: string, args: string[], options?: ExecOptions) => (calls.push([command, args, options]), receipt(command, args, options));
      const times = ['2026-11-17T01:00:00.000Z', '2026-11-17T01:01:00.000Z'];
      const { report } = await runMutants({ card: { id: CARD, dod_command: DOD, dod_exit: 0 }, worktree: dir, base, shipPath: ship }, { git: runSync, dod, now: () => times.shift() ?? '2026-11-17T01:01:00.000Z' });
      const expected = (ship === 'scaffold' ? scaffold : platform)(DOD, dir, 120000);
      assert.deepEqual([report.mutants.length, calls], [3, [expected, expected, expected, expected]]);
    }));
  }

  test('aidlc card mutants on a scaffold config runs a PowerShell-only DoD through pwsh, exits 0 and writes its report', () => inTemp((dir) => {
    const fx = makeFixture();
    try {
      const base = candidateRepo(dir);
      // A DoD that cmd.exe and /bin/sh do not run to exit 0: `$ok` and `if (...) { }` are PowerShell only.
      const dod = "$ok = (Get-Content src/m.ts -Raw).Contains('if (b) return 1;'); if ($ok) { exit 0 } else { exit 1 }";
      writeFileSync(path.join(fx.tmp, 'aidlc.config.json'), JSON.stringify({ cardsDir: 'specs/tasks', shipPath: 'scaffold', base: 'main', mode: 'remote' }));
      writeCard(fx, { id: CARD, title: 'a PowerShell DoD', dodCommand: dod });
      const goal = goalForCards(fx, [CARD]);
      fx.store.saveCardRun({ ...fx.controller.ensureCardRun(goal, CARD), worktree: dir, base: { ref: 'main', oid: base } });
      const r = spawnSync(process.execPath, [MAIN, 'card', 'mutants', CARD, '--json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-A' }, encoding: 'utf8', timeout: 300_000 });
      assert.equal(r.status, 0, r.stderr);
      const printed = JSON.parse(r.stdout) as { path: string; mutants: { operator: string; outcome: string }[] };
      assert.deepEqual([printed.path, existsSync(printed.path)], [mutantsReportPath(dir, CARD), true]);
      assert.deepEqual(printed.mutants.map((m) => [m.operator, m.outcome]), [['drop-statement', 'killed'], ['force-true', 'killed'], ['force-false', 'killed']]);
    } finally {
      fx.cleanup();
    }
  }));
});

const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const OPS = [
  'DoD shell on the scaffold ship path (card T0-DOD-SCAFFOLD-SHELL-4, issue 348, replaces T0-DOD-SCAFFOLD-SHELL-3, which replaced T0-DOD-SCAFFOLD-SHELL-2 and T0-DOD-SCAFFOLD-SHELL).',
  "When the configured `shipPath` is `scaffold`, the loop-run DoD of `aidlc card attempt <card> --outcome success` and the DoD runs of `aidlc card mutants` run the card's `dod_command` as the scaffold ship's DoD leg runs it: the program `pwsh` with the arguments `-NoProfile`, `-Command` and the payload `$ErrorActionPreference='Stop'; $PSNativeCommandUseErrorActionPreference=$true; ` followed by the `dod_command` (the text `Get-ScaffoldDodPayload` of the scaffold's scripts/_cards.ps1 builds), in the card worktree and with no platform shell.",
  "On the `github` and `dry-run` paths both commands run the `dod_command` as one string through the platform shell, as before, and on every path the timeout, the tree kill, the sweep's outcome rule and its report are unchanged.",
  'The `loopDod` record of a DoD that ran names the shell in `shell`: `pwsh` for the scaffold call and `platform` for the platform-shell call. A record written before this card has no `shell`, still parses, and `aidlc card status` prints its `loopDod=` line as before.',
];
const MUTANTS_SENTENCE = 'On the scaffold ship path it runs the `dod_command` through `pwsh -NoProfile -Command` with the payload prefix of the scaffold ship instead, as the loop-run DoD does (card T0-DOD-SCAFFOLD-SHELL-4).';
const FRAGMENT =
  "- T0-DOD-SCAFFOLD-SHELL-4 (bugfix, issue 348): on a repository whose `shipPath` is `scaffold`, the loop-run DoD of `aidlc card attempt --outcome success` and the DoD runs of `aidlc card mutants` run the card's `dod_command` through `pwsh -NoProfile -Command` with the payload prefix `$ErrorActionPreference='Stop'; $PSNativeCommandUseErrorActionPreference=$true; `, as the scaffold ship's DoD leg does. Before, both ran it through the platform shell, so on Windows `cmd.exe` refused a PowerShell DoD and the record held exit code 255. The `loopDod` record names the shell that ran the DoD in `shell` (`pwsh` or `platform`); a record written before this change has no `shell` and still parses. The `github` and `dry-run` paths are unchanged.";

describe('docs carry the rule [R4]', () => {
  test('OPERATIONS.md: each sentence of the DoD shell paragraph, its place, and the mutants sentence after the platform-shell sentence', () => {
    const text = read('docs/OPERATIONS.md');
    for (const sentence of OPS) assert.equal(text.split(sentence).length, 2, `OPERATIONS.md holds once: ${sentence}`);
    const lines = text.split('\n');
    const at = lines.indexOf(OPS.join(' '));
    assert.ok(at > 0, 'the four sentences form one paragraph');
    assert.deepEqual([lines[at + 1], lines[at + 2]?.startsWith('A DoD receipt names the command')], ['', true], 'the DoD receipt paragraph follows it');
    assert.ok(text.includes(`in the worktree, once on the unmutated candidate and then once per mutant with only that mutant applied. ${MUTANTS_SENTENCE} `), 'the mutants sentence follows the platform-shell sentence');
  });

  test('the fragment changelog.d/T0-DOD-SCAFFOLD-SHELL-4.md holds the entry, and CHANGELOG.md holds none of the card ids', () => {
    assert.equal(fragmentEntry(ROOT, 'T0-DOD-SCAFFOLD-SHELL-4'), FRAGMENT);
    assert.equal(read('CHANGELOG.md').includes('T0-DOD-SCAFFOLD-SHELL'), false);
  });
});
