/**
 * Card T0-EXEC-SYNC-TREE-KILL: the callers that run long commands through the synchronous runner opt
 * in to the tree kill (`killTree: true`), the git and gh probes do not, and the docs state the rule.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ScaffoldShipPath } from '../../src/delivery/ship.ts';
import { OperationBinding, executeOperation, lookupOperation } from '../../src/delivery/ops.ts';
import { EvalCase, runEval } from '../../src/evals/runner.ts';
import { MockProvider } from '../../src/providers/mock.ts';
import { GitProbe } from '../../src/probes/git.ts';
import { GhProbe } from '../../src/probes/gh.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import type { ExecOptions, SyncRunner } from '../../src/probes/exec.ts';

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
    executeOperation(OperationBinding.parse({ role: 'deploy', command: ['deploy-tool', 'up'] }), 'staging', { runner });
    executeOperation(OperationBinding.parse({ role: 'deploy', command: ['deploy-tool', 'up'], timeoutMs: 4321 }), 'staging', { runner });
    assert.deepEqual(optIn(options), [[true, 1_800_000], [true, 4321]]);
  });

  it('acceptance 4: lookupOperation passes killTree with its 5 min timeout', () => {
    const { runner, options } = recording('succeeded');
    lookupOperation(OperationBinding.parse({ role: 'status', command: ['deploy-tool', 'up'], statusLookup: ['deploy-tool', 'status', '{id}'] }), 'op-1', runner);
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

/** The sentences this card puts in place of the synchronous-runner sentence of T0-EXEC-TREE-KILL in docs/OPERATIONS.md. */
const OPERATIONS_SENTENCES = [
  'The scaffold ship script, ops bindings and status lookups, and eval command checks, which the synchronous runner runs, are ended at their timeout with their whole process tree through a helper process: `runSync` with `killTree` starts `node` on `src/probes/exec-tree-helper.ts`, which runs the command with the async runner and its tree kill and prints the receipt (card T0-EXEC-SYNC-TREE-KILL).',
  'The git and gh probes (60 s and 120 s, run on every command) still end only the root of a timed-out command, so a descendant of such a command keeps running after its receipt returns.',
];
/** The sentence of T0-EXEC-TREE-KILL this card replaces. */
const OLD_OPERATIONS_SENTENCE = 'The synchronous runner (git, gh, the scaffold ship script, ops bindings, eval commands) still ends only the root of a timed-out command, so a descendant of such a command keeps running after its receipt returns.';
const ARCHITECTURE_CLAUSE = ' and `runSync` with `killTree` running the command under `exec-tree-helper.ts`, which applies that tree kill,';
const CHANGELOG_ENTRY =
  '- T0-EXEC-SYNC-TREE-KILL (bugfix): a command the synchronous runner `runSync` times out with `killTree` set (the scaffold ship script, ops bindings and status lookups, eval command checks) is ended with its whole process tree: `runSync` runs it under a helper node process, `src/probes/exec-tree-helper.ts`, which starts it with the async runner and its tree kill and prints the receipt. Before, a timed-out scaffold ship script, ops binding or eval command left its descendants running after aidlc exited: a 1500 ms timeout returned at 1518 ms with the sleeper of the test fixture still running. The git and gh probes and the GitHub ship path\'s git calls are left as they were: a timed-out call still ends only its root, and they start no helper.';

const readDoc = (path: string): string => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const sentencesOf = (text: string): string[] => text.split(/(?<=\.)\s+(?=[A-Z`])/);

/** Whether every text this card adds is present whole and the replaced sentence is gone. */
function docsHold(ops: string, architecture: string, changelog: string): boolean {
  const paragraph = ops.split('\n').find((line) => line.startsWith('`command` is argv (the prompt arrives on stdin;')) ?? '';
  if (!OPERATIONS_SENTENCES.every((s) => paragraph.includes(` ${s}`))) return false;
  if (ops.includes(OLD_OPERATIONS_SENTENCE)) return false;
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
      [ARCHITECTURE_CLAUSE, () => docsHold(ops, architecture.replace(ARCHITECTURE_CLAUSE, ','), changelog)],
      ...sentencesOf(CHANGELOG_ENTRY).map((s): [string, () => boolean] => [s, () => docsHold(ops, architecture, changelog.replace(s, ''))]),
    ];
    // 2 OPERATIONS sentences, the old sentence, the ARCHITECTURE clause, 3 CHANGELOG sentences.
    assert.equal(breaks.length, 7);
    for (const [text, holds] of breaks) assert.equal(holds(), false, `this change still passes: ${text}`);
  });
});
