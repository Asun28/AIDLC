import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitHubShipPath } from '../../src/delivery/github-ship.ts';
import { GhProbe, GhProbeError } from '../../src/probes/gh.ts';
import { scriptedRunner, type ExecReceipt } from '../../src/probes/exec.ts';
import { hasConflictDiagnostic } from '../../src/loop/card-runner.ts';

// Card T0-SHIP-MERGE-REFUSED (issue #85): a `gh pr merge` refusal after the base moved goes through the base sync again.
const HEAD = 'a'.repeat(40);
const BASE_OID = 'd'.repeat(40);
const MERGE_SHA = 'c'.repeat(40);
const FETCH = 'git fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main';
const RESOLVE_REMOTE = 'git rev-parse --verify --quiet refs/remotes/origin/main^{commit}';
const MERGE_TREE = 'git merge-tree --write-tree HEAD';
const SYNC_MERGE = 'git merge --no-ff --no-commit';
const MERGE_HEAD = 'git rev-parse --verify --quiet MERGE_HEAD';
const MERGE_STATE = 'gh pr view 42 --repo o/r --json mergeable,mergeStateStatus';
const CONFLICT_TREE = `${'e'.repeat(40)}\n100644 ${'1'.repeat(40)} 1\tsrc/a.ts\n100644 ${'2'.repeat(40)} 2\tsrc/a.ts\n100644 ${'3'.repeat(40)} 3\tsrc/a.ts\n\nAuto-merging src/a.ts\nCONFLICT (content): Merge conflict in src/a.ts\n`;
const CONFLICT_MERGE = 'Auto-merging src/a.ts\nCONFLICT (content): Merge conflict in src/a.ts\nAutomatic merge failed; fix conflicts and then commit the result.\n';
const REFUSAL = 'X Pull request #42 is not mergeable: the merge commit cannot be cleanly created.\n';
const WAIT_MS = 3000;
const READS = 5;

type Step = Partial<ExecReceipt> | ((args: string[]) => Partial<ExecReceipt>);
type Call = { key: string; args: string[]; cwd?: string };

/**
 * A ship whose first base sync is clean and whose `gh pr merge` is refused. `states` are the successive answers of the
 * merge state read (JSON bodies, or a receipt); `resync` is what the second merge test reports.
 */
function refusedShip(opts: { states: Array<string | Partial<ExecReceipt>>; resync?: Partial<ExecReceipt>; overrides?: Record<string, Step>; changelog?: { diff3: string } } = { states: [] }) {
  const root = mkdtempSync(path.join(tmpdir(), 'aidlc-refused-'));
  const wtRoot = path.join(root, 'wt');
  const wt = path.join(wtRoot, 'T1-A');
  mkdirSync(path.join(wt, '.review'), { recursive: true });
  mkdirSync(path.join(root, '.git'), { recursive: true });
  writeFileSync(path.join(wt, '.review', 'T1-A.json'), JSON.stringify({ verdict: 'pass', reasons: [], sha: HEAD }));
  if (opts.changelog) writeFileSync(path.join(wt, 'CHANGELOG.md'), `as the merge wrote it\n${opts.changelog.diff3}`, 'utf8');
  let trees = 0;
  let reads = 0;
  let added = false;
  const sleeps: number[] = [];
  const calls: Call[] = [];
  const scripted = scriptedRunner({
    'gh api user -q .login': { stdout: 'alice\n' },
    'git add -A': {},
    'git diff --cached --quiet': { exitCode: 1 },
    'git commit': {},
    'git rev-parse --verify HEAD': () => (added ? { stdout: MERGE_SHA + '\n' } : { stdout: HEAD + '\n' }),
    [FETCH]: {},
    [RESOLVE_REMOTE]: { stdout: BASE_OID + '\n' },
    [MERGE_TREE]: () => (trees++ === 0 ? { stdout: 'e'.repeat(40) + '\n' } : (opts.resync ?? { stdout: 'e'.repeat(40) + '\n' })),
    [SYNC_MERGE]: { exitCode: 1, stdout: CONFLICT_MERGE },
    [MERGE_HEAD]: { stdout: 'f'.repeat(40) + '\n' },
    'git push': {},
    'gh pr list': { stdout: '[]' },
    'gh pr create': { stdout: 'https://github.com/o/r/pull/42\n' },
    'gh api repos/o/r/commits': { stdout: JSON.stringify({ check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] }) },
    'gh pr merge': { exitCode: 1, stderr: REFUSAL },
    [MERGE_STATE]: () => {
      const s = opts.states[Math.min(reads++, opts.states.length - 1)];
      return typeof s === 'string' ? { stdout: s } : (s ?? { exitCode: 1, stderr: 'no state scripted' });
    },
    ...(opts.changelog
      ? {
          'git diff --name-only --diff-filter=U -z': { stdout: 'CHANGELOG.md\u0000' },
          'git checkout --conflict=diff3 -- CHANGELOG.md': () => {
            writeFileSync(path.join(wt, 'CHANGELOG.md'), opts.changelog!.diff3, 'utf8');
            return {};
          },
          'git add -- CHANGELOG.md': () => {
            added = true;
            return {};
          },
        }
      : {}),
    ...opts.overrides,
  });
  const runner: typeof scripted = (cmd, args, o) => {
    calls.push({ key: [cmd, ...args].join(' '), args, cwd: o?.cwd });
    return scripted(cmd, args, o);
  };
  const r = new GitHubShipPath({ mainRoot: root, worktreeRoot: wtRoot, repository: 'o/r', runner, sleep: (ms) => sleeps.push(ms) }).ship({ cardId: 'T1-A', base: 'main', mode: 'remote' });
  const keys = calls.map((c) => c.key);
  const mergeAt = keys.findIndex((k) => k.startsWith('gh pr merge'));
  const after = keys.slice(mergeAt + 1);
  const result = { r, calls, keys, after, sleeps, reads: () => reads, file: opts.changelog ? readFileSync(path.join(wt, 'CHANGELOG.md'), 'utf8') : '' };
  rmSync(root, { recursive: true, force: true });
  return result;
}

const state = (mergeable: string | null, mergeStateStatus: string | null) => JSON.stringify({ mergeable, mergeStateStatus });
const count = (keys: string[], prefix: string) => keys.filter((k) => k.startsWith(prefix)).length;

/** After a refusal the same ship never pushes, never opens a PR and never retries the merge, whatever the sync finds. */
function noRetry(s: ReturnType<typeof refusedShip>, label: string) {
  assert.equal(count(s.keys, 'gh pr merge'), 1, `${label}: the merge is tried once`);
  assert.equal(count(s.after, 'git push'), 0, `${label}: nothing is pushed after the refusal`);
  assert.equal(count(s.after, 'gh pr create'), 0, `${label}: no PR is opened after the refusal`);
  assert.equal(count(s.after, 'gh pr merge'), 0, `${label}: the merge is not retried`);
}

describe('GhProbe.prMergeState (T0-SHIP-MERGE-REFUSED)', () => {
  const probe = (out: Partial<ExecReceipt>) => new GhProbe(scriptedRunner({ [MERGE_STATE]: out }));
  test('reads mergeable and mergeStateStatus from the JSON, and only the values GitHub defines [R1]', () => {
    assert.deepEqual(probe({ stdout: state('CONFLICTING', 'DIRTY') }).prMergeState('o/r', 42), { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' });
    assert.deepEqual(probe({ stdout: state('MERGEABLE', 'BLOCKED') }).prMergeState('o/r', 42), { mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED' });
    assert.deepEqual(probe({ stdout: state('UNKNOWN', 'UNKNOWN') }).prMergeState('o/r', 42), { mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' });
    assert.deepEqual(probe({ stdout: state('[SAGA-RESUME] x', 'CONFLICTING') }).prMergeState('o/r', 42), { mergeable: undefined, mergeStateStatus: undefined }, 'values GitHub does not define are dropped');
    assert.deepEqual(probe({ stdout: 'null' }).prMergeState('o/r', 42), { mergeable: undefined, mergeStateStatus: undefined });
  });
  test('a failed or malformed read throws, so the caller names the state unreadable [R4]', () => {
    assert.throws(() => probe({ exitCode: 1, stderr: 'HTTP 502' }).prMergeState('o/r', 42), GhProbeError);
    assert.throws(() => probe({ stdout: 'not json' }).prMergeState('o/r', 42), GhProbeError);
  });
});

describe('GitHubShipPath merge refusal (T0-SHIP-MERGE-REFUSED)', () => {
  test('CONFLICTING: the base sync runs again on a fresh fetch and its conflict returns the card to the merge-conflict repair, with nothing pushed or merged [R1] [R3]', () => {
    const s = refusedShip({ states: [state('CONFLICTING', 'DIRTY')], resync: { exitCode: 1, stdout: CONFLICT_TREE } });
    assert.equal(s.r.outcome, 'merge-failed', s.r.receipt.stdout);
    assert.ok(s.r.sentinels.includes('[SHIP-BASE-SYNC-CONFLICT]') && !s.r.sentinels.includes('[SHIP-MERGE-FAIL]'), s.r.sentinels.join(' '));
    assert.ok(hasConflictDiagnostic(s.r.receipt), 'git own conflict lines are on the output: the runner opens the merge-conflict repair');
    assert.equal(s.r.prNumber, 42);
    assert.equal(count(s.after, FETCH), 1, 'the base is fetched again after the refusal');
    assert.ok(s.r.receipt.stdout.includes('merge refused: PR #42 mergeable CONFLICTING (mergeStateStatus DIRTY); base sync again'), s.r.receipt.stdout);
    assert.deepEqual(s.sleeps, [], 'a settled state is not re-read');
    noRetry(s, 'CONFLICTING');
    // CONFLICTING alone decides it, whatever the status says.
    const alone = refusedShip({ states: [state('CONFLICTING', null)], resync: { exitCode: 1, stdout: CONFLICT_TREE } });
    assert.ok(alone.r.sentinels.includes('[SHIP-BASE-SYNC-CONFLICT]'), alone.r.sentinels.join(' '));
    assert.ok(alone.r.receipt.stdout.includes('merge refused: PR #42 mergeable CONFLICTING; base sync again'), alone.r.receipt.stdout);
    noRetry(alone, 'CONFLICTING alone');
  });

  test('mergeStateStatus DIRTY with mergeable still UNKNOWN is a conflict at the first read [R1]', () => {
    const s = refusedShip({ states: [state('UNKNOWN', 'DIRTY')], resync: { exitCode: 1, stdout: CONFLICT_TREE } });
    assert.ok(s.r.sentinels.includes('[SHIP-BASE-SYNC-CONFLICT]'), s.r.sentinels.join(' '));
    assert.equal(s.reads(), 1);
    assert.deepEqual(s.sleeps, []);
    noRetry(s, 'DIRTY');
  });

  test('a CHANGELOG-only conflict on the second sync is merged by the ship path into a new candidate, [SHIP-BASE-SYNC-MERGED], nothing pushed or merged [R3]', () => {
    const top = '# Changelog\n\n## Unreleased\n\n';
    const tail = '- Older entry, card T0-OLD: kept.\n\n## 0.1.0\n\n- Released entry.\n';
    const diff3 = `${top}<<<<<<< HEAD\n- Card entry, card T1-A: one line.\n\n||||||| 1a2b3c4\n=======\n- Base entry, card T0-OTHER: another line.\n\n>>>>>>> refs/remotes/origin/main\n${tail}`;
    const s = refusedShip({ states: [state('CONFLICTING', 'DIRTY')], resync: { exitCode: 1, stdout: CONFLICT_TREE.replace(/src\/a\.ts/g, 'CHANGELOG.md') }, overrides: { [SYNC_MERGE]: { exitCode: 1, stdout: CONFLICT_MERGE.replace(/src\/a\.ts/g, 'CHANGELOG.md') } }, changelog: { diff3 } });
    assert.ok(s.r.sentinels.includes('[SHIP-BASE-SYNC-MERGED]'), s.r.sentinels.join(' '));
    assert.equal(s.file, `${top}- Card entry, card T1-A: one line.\n\n- Base entry, card T0-OTHER: another line.\n\n${tail}`, 'both entries kept, the card\'s first');
    assert.ok(hasConflictDiagnostic(s.r.receipt), 'the runner opens the repair on the new candidate');
    noRetry(s, 'CHANGELOG merge');
  });

  test('UNKNOWN is re-read with a fixed wait until GitHub settles, then a settled CONFLICTING syncs [R2]', () => {
    const s = refusedShip({ states: [state('UNKNOWN', 'UNKNOWN'), state('UNKNOWN', 'UNKNOWN'), state('CONFLICTING', 'DIRTY')], resync: { exitCode: 1, stdout: CONFLICT_TREE } });
    assert.equal(s.reads(), 3);
    assert.deepEqual(s.sleeps, [WAIT_MS, WAIT_MS]);
    assert.ok(s.r.sentinels.includes('[SHIP-BASE-SYNC-CONFLICT]'), s.r.sentinels.join(' '));
    noRetry(s, 'UNKNOWN then CONFLICTING');
  });

  test('UNKNOWN at the bound runs the base sync as local ground truth: a clean merge ends with [SHIP-MERGE-FAIL] naming the state, a conflict with the repair [R2]', () => {
    const clean = refusedShip({ states: [state('UNKNOWN', 'UNKNOWN')] });
    assert.equal(clean.reads(), READS);
    assert.deepEqual(clean.sleeps, Array(READS - 1).fill(WAIT_MS));
    assert.equal(count(clean.after, FETCH), 1, 'the sync runs at the bound');
    assert.ok(clean.r.sentinels.includes('[SHIP-MERGE-FAIL]') && !clean.r.sentinels.includes('[SHIP-BASE-SYNC-CONFLICT]'), clean.r.sentinels.join(' '));
    assert.match(clean.r.receipt.stdout, /^\[SHIP-MERGE-FAIL\] PR #42 mergeable UNKNOWN \(mergeStateStatus UNKNOWN\) after 5 reads; main merges cleanly into HEAD a{40} after a fresh fetch: /m, clean.r.receipt.stdout);
    assert.ok(!hasConflictDiagnostic(clean.r.receipt), 'a clean sync is no conflict');
    noRetry(clean, 'UNKNOWN clean');
    const conflict = refusedShip({ states: [state('UNKNOWN', 'UNKNOWN')], resync: { exitCode: 1, stdout: CONFLICT_TREE } });
    assert.ok(conflict.r.sentinels.includes('[SHIP-BASE-SYNC-CONFLICT]'), conflict.r.sentinels.join(' '));
    noRetry(conflict, 'UNKNOWN conflict');
  });

  test('a refusal that is not a conflict (MERGEABLE: BLOCKED, BEHIND, UNSTABLE, CLEAN) starts no base sync and keeps [SHIP-MERGE-FAIL] naming the state [R2]', () => {
    for (const status of ['BLOCKED', 'BEHIND', 'UNSTABLE', 'CLEAN']) {
      const s = refusedShip({ states: [state('MERGEABLE', status)] });
      assert.equal(count(s.after, FETCH), 0, `${status}: no base sync`);
      assert.ok(!s.r.sentinels.some((x) => x.startsWith('[SHIP-BASE-SYNC')), `${status}: no base-sync outcome: ${s.r.sentinels.join(' ')}`);
      assert.ok(s.r.sentinels.includes('[SHIP-MERGE-FAIL]'), `${status}: ${s.r.sentinels.join(' ')}`);
      assert.ok(s.r.receipt.stdout.includes(`[SHIP-MERGE-FAIL] PR #42 mergeable MERGEABLE (mergeStateStatus ${status}): X Pull request #42 is not mergeable`), s.r.receipt.stdout);
      assert.ok(!hasConflictDiagnostic(s.r.receipt), `${status}: no conflict diagnostic`);
      noRetry(s, status);
    }
  });

  test('an unreadable merge state starts no base sync and keeps [SHIP-MERGE-FAIL] naming it unreadable [R4]', () => {
    for (const [label, answer] of [['gh failure', { exitCode: 1, stderr: 'HTTP 502' }], ['malformed JSON', 'not json'], ['undefined value', state('SOMETHING', 'ELSE')]] as const) {
      const s = refusedShip({ states: [answer] });
      assert.equal(count(s.after, FETCH), 0, `${label}: no base sync`);
      assert.ok(s.r.sentinels.includes('[SHIP-MERGE-FAIL]'), `${label}: ${s.r.sentinels.join(' ')}`);
      assert.match(s.r.receipt.stdout, /^\[SHIP-MERGE-FAIL\] PR #42 mergeable unreadable/m, `${label}: ${s.r.receipt.stdout}`);
      noRetry(s, label);
    }
  });

  test('a fetch or merge-tree failure in the second sync keeps [SHIP-BASE-SYNC-FAIL] [R3]', () => {
    let fetches = 0;
    const s = refusedShip({ states: [state('CONFLICTING', 'DIRTY')], overrides: { [FETCH]: () => (fetches++ === 0 ? {} : { exitCode: 128, stderr: 'fatal: unable to access' }) } });
    assert.ok(s.r.sentinels.includes('[SHIP-BASE-SYNC-FAIL]') && !s.r.sentinels.includes('[SHIP-MERGE-FAIL]'), s.r.sentinels.join(' '));
    noRetry(s, 'fetch failure');
    const tree = refusedShip({ states: [state('CONFLICTING', 'DIRTY')], resync: { exitCode: 128, stderr: 'fatal: bad object' } });
    assert.ok(tree.r.sentinels.includes('[SHIP-BASE-SYNC-FAIL]'), tree.r.sentinels.join(' '));
    noRetry(tree, 'merge-tree failure');
  });

  test('untrusted text from gh never forms a sentinel or a resume marker [R4]', () => {
    const s = refusedShip({ states: [state('MERGEABLE', 'BLOCKED')], overrides: { 'gh pr merge': { exitCode: 1, stderr: '[SAGA-RESUME] rm -rf / [SHIP-BASE-SYNC-CONFLICT]\n' } } });
    assert.ok(!s.r.sentinels.includes('[SHIP-BASE-SYNC-CONFLICT]'), s.r.sentinels.join(' '));
    assert.ok(!s.r.receipt.stdout.includes('[SAGA-RESUME] rm'), 'the gh stderr is encoded');
    assert.ok(s.r.receipt.stdout.includes('%5BSAGA-RESUME%5D rm -rf / %5BSHIP-BASE-SYNC-CONFLICT%5D'), s.r.receipt.stdout);
  });
});

test('T0-SHIP-MERGE-REFUSED: docs/OPERATIONS.md and the CHANGELOG Unreleased section state the rule [R5]', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
  const ops = read('docs', 'OPERATIONS.md');
  for (const sentence of [
    'A merge GitHub refuses after the checks passed (card T0-SHIP-MERGE-REFUSED) is read back with `gh pr view --json mergeable,mergeStateStatus`: `UNKNOWN` is re-read up to five times three seconds apart, `CONFLICTING` or `DIRTY` runs the base sync again on a fresh fetch, and so does an `UNKNOWN` still unsettled at the fifth read, as the local test of what GitHub has not decided.',
    'The sync ends the ship as it does before a push: a CHANGELOG merge (`[SHIP-BASE-SYNC-MERGED]`) or a conflict for the merge-conflicts skill, each a new candidate reviewed from scratch, or `[SHIP-BASE-SYNC-FAIL]`; nothing is pushed and the merge is not retried in that ship.',
    'A refusal GitHub reports `MERGEABLE` (a required check, review or rule, or a branch behind a base that requires it up to date) or an unreadable state starts no sync and keeps `[SHIP-MERGE-FAIL]`, now naming the state, as does a sync that finds the base merging cleanly.',
  ]) assert.ok(ops.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
  const changelog = read('CHANGELOG.md');
  const start = changelog.indexOf('## Unreleased');
  const end = changelog.indexOf('\n## ', start + 1);
  const unreleased = changelog.slice(start, end === -1 ? changelog.length : end);
  const entry = '- Merge refusal, card T0-SHIP-MERGE-REFUSED: when GitHub refuses the merge of a PR whose base moved after the ship\'s base sync, the GitHub ship path reads the merge state and runs the base sync again, so the conflict becomes a CHANGELOG merge or a merge-conflict repair on a new candidate instead of a `tool` stop; a refusal for another reason keeps `[SHIP-MERGE-FAIL]` and names the state (issue #85).';
  assert.ok(unreleased.includes(entry), `CHANGELOG.md Unreleased states: ${entry}`);
});
