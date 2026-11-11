/**
 * Card T0-EXEC-SYNC-TREE-KILL: the callers that run long commands through the synchronous runner opt
 * in to the tree kill (`killTree: true`), the git and gh probes do not, and the docs state the rule.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SpawnSyncOptions } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ScaffoldShipPath } from '../../src/delivery/ship.ts';
import { OperationBinding, executeOperation, lookupOperation } from '../../src/delivery/ops.ts';
import { EvalCase, runEval } from '../../src/evals/runner.ts';
import { MockProvider } from '../../src/providers/mock.ts';
import { GitProbe } from '../../src/probes/git.ts';
import { GhProbe } from '../../src/probes/gh.ts';
import { createRunSync, ok, runSync, scriptedRunner } from '../../src/probes/exec.ts';
import type { ExecOptions, SpawnSyncFn, SyncRunner } from '../../src/probes/exec.ts';

/** A runner that records the options of every call and answers exit 0 with `stdout`. */
function recording(stdout = ''): { runner: SyncRunner; options: (ExecOptions | undefined)[] } {
  const options: (ExecOptions | undefined)[] = [];
  const inner = scriptedRunner({ node: { stdout }, git: { stdout }, gh: { stdout }, 'deploy-tool': { stdout } });
  return { options, runner: (command, args, o) => (options.push(o), inner(command, args, o)) };
}

/** killTree and timeoutMs of each recorded call. */
const optIn = (options: (ExecOptions | undefined)[]): [boolean | undefined, number | undefined][] => options.map((o) => [o?.killTree, o?.timeoutMs]);

describe('T0-EXEC-SYNC-TREE-KILL callers of the synchronous runner [R3] [R4]', () => {
  it('acceptance 4: ScaffoldShipPath.phase passes killTree with its 60 min default and with a timeout it is given', () => {
    const { runner, options } = recording();
    const ship = new ScaffoldShipPath({ mainRoot: '/main', worktreeRoot: '/wt', runner });
    ship.phase('C-1', 'ship');
    ship.phase('C-1', 'ship', [], 1234);
    assert.deepEqual(optIn(options), [[true, 3_600_000], [true, 1234]]);
  });

  it("acceptance 4: executeOperation passes killTree with the binding's timeoutMs, 30 min by default", () => {
    const { runner, options } = recording();
    executeOperation(OperationBinding.parse({ role: 'deploy', command: ['deploy-tool', 'up'] }), 'staging', { root: '/main', runner });
    executeOperation(OperationBinding.parse({ role: 'deploy', command: ['deploy-tool', 'up'], timeoutMs: 4321 }), 'staging', { root: '/main', runner });
    assert.deepEqual(optIn(options), [[true, 1_800_000], [true, 4321]]);
  });

  it('acceptance 4: lookupOperation passes killTree with its 5 min timeout', () => {
    const { runner, options } = recording('succeeded');
    lookupOperation(OperationBinding.parse({ role: 'status', command: ['deploy-tool', 'up'], statusLookup: ['deploy-tool', 'status', '{id}'] }), 'op-1', '/main', runner);
    assert.deepEqual(optIn(options), [[true, 300_000]]);
  });

  it("acceptance 4: a runEval command check passes killTree with the check's timeoutMs, 10 min by default", async () => {
    const { runner, options } = recording();
    const evalCase = EvalCase.parse({ id: 'e', prompt: 'x', checks: [{ type: 'command', command: ['node', '-v'] }, { type: 'command', command: ['node', '-v'], timeoutMs: 777 }] });
    await runEval(evalCase, new MockProvider({}), { cwd: '/repo', runner, skipModel: true });
    assert.deepEqual(optIn(options), [[true, 600_000], [true, 777]]);
  });

  it('acceptance 4: GitProbe and GhProbe calls pass no killTree', () => {
    const { runner, options } = recording('[]');
    new GitProbe(runner).status('/repo');
    new GhProbe(runner).checkRuns('o/r', 'abc', '/repo');
    new GhProbe(runner).login('/repo');
    assert.equal(options.length, 3);
    assert.deepEqual(options.map((o) => o !== undefined && 'killTree' in o), [false, false, false]);
  });
});

/** The sentence of the card's 2026-11-05 amendment. */
const UNSUPPORTED_TIMEOUT_SENTENCE = 'A `killTree` call whose `timeoutMs` is not a whole number from 1 to 2 147 483 647, the largest delay a Node timer keeps, starts nothing and returns a receipt with `exitCode` null and stderr beginning `[tree helper error] unsupported timeoutMs`.';
/** The sentences this card puts in place of the synchronous-runner sentence of T0-EXEC-TREE-KILL in docs/OPERATIONS.md. */
const OPERATIONS_SENTENCES = [
  "The scaffold ship script, ops bindings and status lookups, and eval command checks, which the synchronous runner runs, are ended at their timeout with their whole process tree through a helper process: `runSync` with `killTree` starts `node` on `src/probes/exec-tree-helper.ts`, which runs the command with the async runner and its tree kill under runSync's 64 MiB output limit and prints the receipt as a JSON header line followed by the output bytes (card T0-EXEC-SYNC-TREE-KILL).",
  'The git and gh probes (60 s and 120 s, run on every command) still end only the root of a timed-out command, so a descendant of such a command keeps running after its receipt returns.',
  UNSUPPORTED_TIMEOUT_SENTENCE,
];
/** The sentence of T0-EXEC-TREE-KILL this card replaces. */
const OLD_OPERATIONS_SENTENCE = 'The synchronous runner (git, gh, the scaffold ship script, ops bindings, eval commands) still ends only the root of a timed-out command, so a descendant of such a command keeps running after its receipt returns.';
/** The sentence UNSUPPORTED_TIMEOUT_SENTENCE replaces (amendment of 2026-11-05). */
const OLD_DIRECT_PATH_SENTENCE = 'A `killTree` call whose `timeoutMs` is not a whole number from 1 to 2 147 483 647, the largest delay a Node timer keeps, runs on the direct path as a call without `killTree` does and ends only the root of a timed-out command.';
const ARCHITECTURE_CLAUSE = ' and `runSync` with `killTree` running the command under `exec-tree-helper.ts`, which applies that tree kill,';
/** The clause of the CHANGELOG entry that supersedes the T0-EXEC-TREE-KILL entry's runSync note, which that card's doc test still pins. */
const CHANGELOG_SUPERSEDES = ', superseding the note of the T0-EXEC-TREE-KILL entry that `runSync` still ends only the root of a timed-out command';
const CHANGELOG_ENTRY =
  '- T0-EXEC-SYNC-TREE-KILL (bugfix), superseding the note of the T0-EXEC-TREE-KILL entry that `runSync` still ends only the root of a timed-out command: a command the synchronous runner `runSync` times out with `killTree` set (the scaffold ship script, ops bindings and status lookups, eval command checks) is ended with its whole process tree: `runSync` runs it under a helper node process, `src/probes/exec-tree-helper.ts`, which starts it with the async runner and its tree kill under the same 64 MiB output limit (the new optional `maxBuffer` of the async runner, set only by the helper) and prints the receipt as a JSON header line followed by the output bytes. Before, a timed-out scaffold ship script, ops binding or eval command left its descendants running after aidlc exited: a 1500 ms timeout returned at 1518 ms with the sleeper of the test fixture still running. A `killTree` call whose `timeoutMs` is not a whole number from 1 to 2 147 483 647 starts nothing and returns a receipt with `exitCode` null and stderr beginning `[tree helper error] unsupported timeoutMs`. The git and gh probes and the GitHub ship path\'s git calls are left as they were: a timed-out call still ends only its root, and they start no helper.';

const readDoc = (path: string): string => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const sentencesOf = (text: string): string[] => text.split(/(?<=\.)\s+(?=[A-Z`])/);

/** Whether every text this card adds is present whole and the replaced sentence is gone. */
function docsHold(ops: string, architecture: string, changelog: string): boolean {
  const paragraph = ops.split('\n').find((line) => line.startsWith('`command` is argv (the prompt arrives on stdin;')) ?? '';
  if (!OPERATIONS_SENTENCES.every((s) => paragraph.includes(` ${s}`))) return false;
  if (ops.includes(OLD_OPERATIONS_SENTENCE) || ops.includes(OLD_DIRECT_PATH_SENTENCE)) return false;
  const probes = architecture.split('\n').find((line) => line.startsWith('`src/probes/` gathers evidence.')) ?? '';
  if (!probes.includes(" `exec.ts` runs commands and returns receipts (exit, output digest, timing), the async runner ending a timed-out command's whole process tree" + ARCHITECTURE_CLAUSE + ' with a scripted runner for tests. ')) return false;
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  return unreleased.split('\n').includes(CHANGELOG_ENTRY);
}

describe('T0-EXEC-SYNC-TREE-KILL docs [R5] [R6] [R7]', () => {
  it('acceptance 6: OPERATIONS.md, ARCHITECTURE.md and the CHANGELOG Unreleased section carry each sentence, the old OPERATIONS sentence is gone, and removing any one sentence or restoring the old one fails', () => {
    const [ops, architecture, changelog] = [readDoc('docs/OPERATIONS.md'), readDoc('docs/ARCHITECTURE.md'), readDoc('CHANGELOG.md')];
    assert.ok(docsHold(ops, architecture, changelog), 'the doc texts this card adds are present whole and the replaced sentence is gone');
    const breaks: [string, () => boolean][] = [
      ...OPERATIONS_SENTENCES.map((s): [string, () => boolean] => [s, () => docsHold(ops.replace(s, ''), architecture, changelog)]),
      ['the old sentence restored', () => docsHold(ops.replace(OPERATIONS_SENTENCES[1]!, `${OPERATIONS_SENTENCES[1]!} ${OLD_OPERATIONS_SENTENCE}`), architecture, changelog)],
      ['the direct-path sentence restored', () => docsHold(ops.replace(UNSUPPORTED_TIMEOUT_SENTENCE, `${UNSUPPORTED_TIMEOUT_SENTENCE} ${OLD_DIRECT_PATH_SENTENCE}`), architecture, changelog)],
      [ARCHITECTURE_CLAUSE, () => docsHold(ops, architecture.replace(ARCHITECTURE_CLAUSE, ','), changelog)],
      [CHANGELOG_SUPERSEDES, () => docsHold(ops, architecture, changelog.replace(CHANGELOG_SUPERSEDES, ''))],
      ...sentencesOf(CHANGELOG_ENTRY).map((s): [string, () => boolean] => [s, () => docsHold(ops, architecture, changelog.replace(s, ''))]),
    ];
    // 3 OPERATIONS sentences, the 2 replaced sentences, the ARCHITECTURE clause, the CHANGELOG superseding clause, 4 CHANGELOG sentences.
    assert.equal(breaks.length, 11);
    for (const [text, holds] of breaks) assert.equal(holds(), false, `this change still passes: ${text}`);
  });
});

type Start = { command: string; args: string[]; timeout: number | undefined };

/** A process starter that records each start and answers exit 0 with stdout `started`, in the encoding asked for. */
function recordingSpawn(): { spawner: SpawnSyncFn; starts: Start[] } {
  const starts: Start[] = [];
  const spawner = (command: string, args: string[], options: SpawnSyncOptions) => {
    starts.push({ command, args, timeout: options.timeout });
    const as = (v: string) => (options.encoding === 'buffer' ? Buffer.from(v) : v);
    return { pid: 1, output: [], status: 0, signal: null, stdout: as('started'), stderr: as('') };
  };
  return { starts, spawner: spawner as unknown as SpawnSyncFn };
}

const HELPER = fileURLToPath(new URL('../../src/probes/exec-tree-helper.ts', import.meta.url));

describe('T0-EXEC-SYNC-TREE-KILL-2 a timeoutMs the helper cannot honour starts nothing [R3]', () => {
  for (const timeoutMs of [2_147_483_648, 0, 1.5, NaN]) {
    it(`acceptance 7: killTree with timeoutMs ${timeoutMs} starts no process and returns exit null, not ok, stderr beginning [tree helper error] unsupported timeoutMs`, () => {
      const { spawner, starts } = recordingSpawn();
      const r = createRunSync(spawner)('deploy', ['--to', 'staging'], { cwd: '/work', timeoutMs, killTree: true });
      assert.deepEqual(starts, []);
      assert.equal(r.exitCode, null);
      assert.equal(ok(r), false);
      assert.match(r.stderr, /^\[tree helper error\] unsupported timeoutMs/);
      assert.deepEqual([r.command, r.args, r.cwd, r.signal, r.timedOut, r.stdout], ['deploy', ['--to', 'staging'], '/work', null, false, '']);
      assert.match(r.outputSha256, /^[a-f0-9]{64}$/);
    });
  }

  it('acceptance 7: killTree with no timeoutMs runs the direct path', () => {
    const { spawner, starts } = recordingSpawn();
    const r = createRunSync(spawner)('git', ['status'], { killTree: true });
    assert.deepEqual(starts, [{ command: 'git', args: ['status'], timeout: undefined }]);
    assert.deepEqual([r.exitCode, r.stdout], [0, 'started']);
  });

  for (const [name, options] of [
    ['no killTree', {}],
    ['killTree false', { killTree: false }],
  ] as [string, ExecOptions][]) {
    for (const timeoutMs of [2_147_483_648, 0, 1.5, NaN]) {
      it(`acceptance 7: ${name} with timeoutMs ${timeoutMs} still spawns the command itself with that timeout`, () => {
        const { spawner, starts } = recordingSpawn();
        const r = createRunSync(spawner)('git', ['status'], { ...options, timeoutMs });
        assert.deepEqual(starts, [{ command: 'git', args: ['status'], timeout: timeoutMs }]);
        assert.deepEqual([r.exitCode, r.stdout], [0, 'started']);
      });
    }
  }

  for (const timeoutMs of [1, 2_147_483_647]) {
    it(`acceptance 7: killTree with timeoutMs ${timeoutMs}, an end of the supported range, starts the helper with that timeout's backstop`, () => {
      const { spawner, starts } = recordingSpawn();
      createRunSync(spawner)('deploy', [], { timeoutMs, killTree: true });
      assert.deepEqual(starts, [{ command: process.execPath, args: [HELPER], timeout: timeoutMs + 17_000 }]);
    });
  }

  it('acceptance 7: docs/OPERATIONS.md holds the sentence of the 2026-11-05 amendment', () => {
    assert.ok(readDoc('docs/OPERATIONS.md').includes(UNSUPPORTED_TIMEOUT_SENTENCE));
  });
});

describe('T0-EXEC-SYNC-TREE-KILL-2 acceptance 8', () => {
  it('a command that cannot start under killTree returns at once, not at its timeoutMs, and is no timeout', () => {
    const started = performance.now();
    const receipt = runSync('aidlc-no-such-command', [], { killTree: true, timeoutMs: 60_000 });
    assert.ok(performance.now() - started < 30_000, 'it returned before its timeoutMs');
    assert.equal(ok(receipt), false);
    assert.equal(receipt.timedOut, false);
    assert.match(receipt.stderr, /\[spawn error\].*ENOENT/);
  });
});
