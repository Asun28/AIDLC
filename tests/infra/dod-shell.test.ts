// Card T0-DOD-SCAFFOLD-SHELL (issue 348): on the scaffold ship path the loop-run DoD of `card attempt` and the DoD runs of
// `card mutants` run the card's dod_command through `pwsh -NoProfile -Command` with the scaffold's two preferences, as the
// scaffold ship's DoD leg does; the github and dry-run paths keep the platform shell, and loopDod names the shell.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { runSync, scriptedRunner, type ExecOptions, type ExecReceipt } from '../../src/probes/exec.ts';
import { dodCall, runMutants } from '../../src/review/mutants.ts';
import type { CardRun, LoopDod } from '../../src/core/types.ts';
import { goalForCards, makeFixture, writeCard } from '../scenarios/_harness.ts';
import { changelogSince010 } from './changelog.ts';
import { tmpDir } from './helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
/** The payload prefix of the scaffold's `Get-ScaffoldDodPayload` (scripts/_cards.ps1), from the card's R1. */
const PREFIX = "$ErrorActionPreference='Stop'; $PSNativeCommandUseErrorActionPreference=$true; ";
const WT = path.join('C:', 'wt', 'CARD');
const TIMEOUT = 60_000;
/** A DoD receipt that exits 0, for the scripted DoD runs. */
const receipt = (command: string, args: string[], options?: ExecOptions): ExecReceipt => ({ command, args, cwd: options?.cwd ?? '', exitCode: 0, signal: null, timedOut: false, stdout: 'ok\n', stderr: '', startedAt: '2026-11-17T01:00:00.000Z', finishedAt: '2026-11-17T01:00:01.000Z', durationMs: 5, outputSha256: '' });

describe('dodCall by ship path [R1]', () => {
  test('scaffold: pwsh -NoProfile -Command with the two preferences, no shell option', () => {
    const dod = 'npm test; exit 0';
    const call = dodCall({ dod_command: dod }, WT, 5000, 'scaffold');
    assert.deepEqual(call, ['pwsh', ['-NoProfile', '-Command', PREFIX + dod], { cwd: WT, timeoutMs: 5000 }]);
    assert.equal('shell' in call[2], false, 'the scaffold call has no shell key');
  });

  test('github and dry-run: the dod_command as one string through the platform shell', () => {
    for (const ship of ['github', 'dry-run'] as const) assert.deepEqual(dodCall({ dod_command: 'npm test' }, WT, 5000, ship), ['npm test', [], { cwd: WT, shell: true, timeoutMs: 5000 }], ship);
  });
});

/** The issue 348 DoD shape: a preference, double- and single-quoted strings, a `$` variable, a foreach block, `;` separators. */
const ISSUE_348 = `$ErrorActionPreference = 'Stop'; $names = @("alpha", 'beta'); $n = 0; foreach ($x in $names) { $n += $x.Length }; Write-Output "count $n"; Write-Output '[DOD-PASS]'; exit 0`;

function inTemp(body: (dir: string) => void): () => void {
  return () => {
    const dir = realpathSync.native(tmpDir('aidlc-dod-shell-'));
    try {
      body(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
const viaScaffold = (dir: string, dod: string): ExecReceipt => runSync(...dodCall({ dod_command: dod }, dir, TIMEOUT, 'scaffold'));

describe('a real pwsh through the scaffold call [R1]', () => {
  test('the issue 348 DoD shape exits 0 and prints [DOD-PASS]', inTemp((dir) => {
    const r = viaScaffold(dir, ISSUE_348);
    assert.equal(r.exitCode, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('[DOD-PASS]'), r.stdout);
    assert.ok(r.stdout.includes('count 9'), r.stdout);
  }));

  test('a native command that exits 3, then exit 0, exits nonzero (the native-command preference applies)', inTemp((dir) => {
    const r = viaScaffold(dir, `node -e "process.exit(3)"; exit 0`);
    assert.equal(r.timedOut, false);
    assert.notEqual(r.exitCode, 0, r.stdout + r.stderr);
  }));

  test('a dod that ends exit 4 exits 4', inTemp((dir) => {
    assert.equal(viaScaffold(dir, `Write-Output 'x'; exit 4`).exitCode, 4);
  }));

  test('on win32 the issue 348 DoD shape through the platform call does not exit 0 (the reported symptom)', { skip: process.platform !== 'win32' }, inTemp((dir) => {
    const r = runSync(...dodCall({ dod_command: ISSUE_348 }, dir, TIMEOUT, 'github'));
    assert.notEqual(r.exitCode, 0, r.stdout + r.stderr);
  }));
});

const CARD = 'T0-DS';
const HEAD = 'c'.repeat(40);
const DOD = 'Write-Output ok; exit 0';

/** A card at BUILD whose runner has a scaffold config and records every call; a non-git call returns exit 0. */
function scaffoldAtBuild() {
  const fx = makeFixture();
  writeCard(fx, { id: CARD, title: 'dod shell', allowPaths: ['src/t0-ds.ts'], dodCommand: DOD });
  const goalId = goalForCards(fx, [CARD]).id;
  const card = fx.card(CARD);
  const g = () => fx.goal(goalId);
  const dry = fx.runner();
  let r = dry.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
  assert.equal(r.directive.kind, 'prepare', r.directive.narration);
  r = dry.next(g(), card, r.run);
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  const worktree = r.run.worktree!;
  mkdirSync(worktree, { recursive: true });
  const script = scriptedRunner({
    'git rev-parse --verify HEAD': { stdout: `${HEAD}\n` },
    'git status --porcelain=v1 --untracked-files=all': { stdout: '' },
  });
  const calls: [string, string[], ExecOptions | undefined][] = [];
  const recording = (command: string, args: string[], opts?: ExecOptions): ExecReceipt => {
    calls.push([command, args, opts]);
    return command === 'git' ? script(command, args, opts) : receipt(command, args, opts);
  };
  const config = { ...fx.config, shipPath: 'scaffold' as const };
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: recording });
  const run = () => fx.store.getCardRun(goalId, CARD)!;
  const succeed = () => runner.recordAttempt(g(), card, run(), { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1' });
  return { fx, goalId, worktree, succeed, nonGit: () => calls.filter((c) => c[0] !== 'git') };
}
const loopDodOf = (run: CardRun) => (run.effort!.attempts.at(-1) as { loopDod?: LoopDod & Record<string, unknown> }).loopDod;

function statusLine(fx: ReturnType<typeof makeFixture>, goalId: string): string {
  const r = spawnSync(process.execPath, [MAIN, 'card', 'status', CARD, '--goal', goalId, '--no-json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-A' }, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  const line = r.stdout.split(/\r?\n/).find((l) => l.startsWith('loopDod='));
  assert.ok(line, r.stdout);
  return line;
}

describe('the loop-run DoD on the scaffold path [R2] [R3]', () => {
  test('a success runs the scaffold call once with the tree kill and records shell pwsh', () => {
    const c = scaffoldAtBuild();
    try {
      const rec = loopDodOf(c.succeed());
      assert.ok(rec?.ran, 'the attempt carries a loopDod that ran');
      assert.equal(rec.shell, 'pwsh');
      assert.deepEqual(c.nonGit(), [['pwsh', ['-NoProfile', '-Command', PREFIX + DOD], { cwd: c.worktree, timeoutMs: 540000, killTree: true }]]);
    } finally {
      c.fx.cleanup();
    }
  });

  test('a stored loopDod without shell parses and card status prints the same loopDod= line', () => {
    const c = scaffoldAtBuild();
    try {
      c.succeed();
      const before = statusLine(c.fx, c.goalId);
      const file = c.fx.store.cardFile(c.goalId, CARD);
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { effort: { attempts: { loopDod?: Record<string, unknown> }[] } };
      const stored = raw.effort.attempts.at(-1)!.loopDod!;
      assert.equal(stored['shell'], 'pwsh', 'the stored record carried shell before it is removed');
      delete stored['shell'];
      writeFileSync(file, JSON.stringify(raw, null, 2), 'utf8');
      const parsed = loopDodOf(c.fx.store.getCardRun(c.goalId, CARD)!);
      assert.ok(parsed?.ran, 'the record without shell parses');
      assert.equal('shell' in parsed, false);
      assert.equal(statusLine(c.fx, c.goalId), before);
    } finally {
      c.fx.cleanup();
    }
  });
});

const GIT_ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false'];
function git(cwd: string, ...args: string[]): string {
  const r = runSync('git', [...GIT_ID, ...args], { cwd });
  assert.equal(r.exitCode, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A base commit and a candidate whose src/m.ts adds one `if (b) return 1;` line: three mutants (drop-statement, force-true, force-false). */
function sweep(ship: 'scaffold' | 'github') {
  return async () => {
    const dir = realpathSync.native(tmpDir('aidlc-dod-shell-mutants-'));
    try {
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
      const calls: unknown[] = [];
      const dod = async (command: string, args: string[], options?: ExecOptions): Promise<ExecReceipt> => {
        calls.push([command, args, options]);
        return receipt(command, args, options);
      };
      const times = ['2026-11-17T01:00:00.000Z', '2026-11-17T01:01:00.000Z'];
      const { report } = await runMutants({ card: { id: CARD, dod_command: DOD, dod_exit: 0 }, worktree: dir, base, shipPath: ship }, { git: runSync, dod, now: () => times.shift() ?? '2026-11-17T01:01:00.000Z' });
      assert.equal(report.mutants.length, 3, 'three mutants ran');
      const expected = ship === 'scaffold' ? ['pwsh', ['-NoProfile', '-Command', PREFIX + DOD], { cwd: dir, timeoutMs: 120000 }] : [DOD, [], { cwd: dir, shell: true, timeoutMs: 120000 }];
      assert.deepEqual(calls, [expected, expected, expected, expected], 'the unmutated candidate and each mutant');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

describe('runMutants passes the ship path to the DoD call [R2]', () => {
  test('scaffold: the scaffold call on the unmutated candidate and on each mutant', sweep('scaffold'));
  test('github: the platform call', sweep('github'));
});

const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const OPS = [
  'DoD shell on the scaffold ship path (card T0-DOD-SCAFFOLD-SHELL, issue 348).',
  "When the configured `shipPath` is `scaffold`, the loop-run DoD of `aidlc card attempt <card> --outcome success` and the DoD runs of `aidlc card mutants` run the card's `dod_command` as the scaffold ship's DoD leg runs it: the program `pwsh` with the arguments `-NoProfile`, `-Command` and the payload `$ErrorActionPreference='Stop'; $PSNativeCommandUseErrorActionPreference=$true; ` followed by the `dod_command` (the text `Get-ScaffoldDodPayload` of the scaffold's scripts/_cards.ps1 builds), in the card worktree and with no platform shell.",
  'On the `github` and `dry-run` paths both commands run the `dod_command` as one string through the platform shell, as before, and on every path the timeout, the tree kill, the sweep\'s outcome rule and its report are unchanged.',
  "The `loopDod` record of a DoD that ran names the shell in `shell`: `pwsh` for the scaffold call and `platform` for the platform-shell call. A record written before this card has no `shell`, still parses, and `aidlc card status` prints its `loopDod=` line as before.",
];
const MUTANTS_SENTENCE = 'On the scaffold ship path it runs the `dod_command` through `pwsh -NoProfile -Command` with the payload prefix of the scaffold ship instead, as the loop-run DoD does (card T0-DOD-SCAFFOLD-SHELL).';
const CHANGELOG =
  "- T0-DOD-SCAFFOLD-SHELL (bugfix, issue 348): on a repository whose `shipPath` is `scaffold`, the loop-run DoD of `aidlc card attempt --outcome success` and the DoD runs of `aidlc card mutants` run the card's `dod_command` through `pwsh -NoProfile -Command` with the payload prefix `$ErrorActionPreference='Stop'; $PSNativeCommandUseErrorActionPreference=$true; `, as the scaffold ship's DoD leg does. Before, both ran it through the platform shell, so on Windows `cmd.exe` refused a PowerShell DoD and the record held exit code 255. The `loopDod` record names the shell that ran the DoD in `shell` (`pwsh` or `platform`); a record written before this change has no `shell` and still parses. The `github` and `dry-run` paths are unchanged.";

describe('docs carry the rule [R4]', () => {
  test('OPERATIONS.md: each sentence of the DoD shell paragraph, and the mutants sentence after the platform-shell sentence', () => {
    const text = read('docs/OPERATIONS.md');
    for (const sentence of OPS) assert.equal(text.split(sentence).length, 2, `OPERATIONS.md holds once: ${sentence}`);
    assert.ok(text.includes(`${OPS.join(' ')}\n`), 'the four sentences form one paragraph');
    assert.ok(text.includes(`in the worktree, once on the unmutated candidate and then once per mutant with only that mutant applied. ${MUTANTS_SENTENCE} `), 'the mutants sentence follows the platform-shell sentence');
  });

  test('CHANGELOG.md: the entry under Unreleased', () => {
    const part = changelogSince010(read('CHANGELOG.md'));
    const unreleased = part.slice(0, part.indexOf('\n## ', 1));
    assert.ok(unreleased.split('\n').includes(CHANGELOG), 'the entry stands as one line under Unreleased');
  });
});
