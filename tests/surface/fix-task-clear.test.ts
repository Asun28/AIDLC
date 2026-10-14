import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOOK_CONFIG, fixTaskMarker, protectTests } from '../../src/hooks/index.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The CLI from the sources (what `npm run dev` runs), never a compiled build that may be stale. */
const MAIN = path.join(root, 'src', 'cli', 'main.ts');

/** A temp git repository with its own state directory; the environment is built here, so no AIDLC_FIX_TASK of the caller leaks in. */
function repo(): { cwd: string; stateDir: string; env: NodeJS.ProcessEnv; marker: string } {
  const cwd = mkdtempSync(path.join(tmpdir(), 'aidlc-fix-task-'));
  const init = spawnSync('git', ['init', '-q'], { cwd, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const stateDir = path.join(cwd, 'state');
  const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'], SystemRoot: process.env['SystemRoot'], AIDLC_STATE_DIR: stateDir, AIDLC_SESSION: 'fix-task-test' };
  return { cwd, stateDir, env, marker: path.join(stateDir, 'fix-task') };
}

function cli(r: { cwd: string; env: NodeJS.ProcessEnv }, ...args: string[]) {
  return spawnSync(process.execPath, [MAIN, ...args, '--json'], { cwd: r.cwd, env: r.env, encoding: 'utf8', timeout: 60_000 });
}

const editTest = { tool_input: { file_path: 'tests/foo.test.ts' } };

test('T1-SWEEP2-FIX-TASK acceptance 1: `card fix-task --clear` deletes the marker, so fixTaskMarker returns undefined and protect-tests admits a test edit again [R1]', () => {
  const r = repo();
  const set = cli(r, 'card', 'fix-task', 'T1-X');
  assert.equal(set.status, 0, set.stderr);
  assert.equal(fixTaskMarker(r.cwd, r.env), 'T1-X');
  assert.equal(protectTests(editTest, r.cwd, r.env, DEFAULT_HOOK_CONFIG).exitCode, 0, 'a deny is reported as JSON on stdout');
  assert.match(protectTests(editTest, r.cwd, r.env, DEFAULT_HOOK_CONFIG).stdout ?? '', /"permissionDecision":"deny"/);

  const clear = cli(r, 'card', 'fix-task', '--clear');
  assert.equal(clear.status, 0, clear.stderr);
  assert.equal(existsSync(r.marker), false, 'the marker file is gone after --clear');
  assert.equal(fixTaskMarker(r.cwd, r.env), undefined);
  assert.deepEqual(protectTests(editTest, r.cwd, r.env, DEFAULT_HOOK_CONFIG), { exitCode: 0 });
});

test('T1-SWEEP2-FIX-TASK acceptance 2: `--clear` with no marker exits 0 and creates no file; an empty marker made by hand still reads as active [R1]', () => {
  const r = repo();
  const clear = cli(r, 'card', 'fix-task', '--clear');
  assert.equal(clear.status, 0, clear.stderr);
  assert.equal(existsSync(r.marker), false, '--clear creates no marker');

  mkdirSync(r.stateDir, { recursive: true });
  writeFileSync(r.marker, '', 'utf8');
  assert.equal(fixTaskMarker(r.cwd, r.env), 'fix-task', 'a marker file that exists is active, empty or not');
});

test('T1-SWEEP2-FIX-TASK acceptance 3: CardRunner has no setFixTaskMarker, ARCHITECTURE names the CLI as the only writer, and the CHANGELOG names the card [R2] [R3]', () => {
  assert.equal('setFixTaskMarker' in CardRunner.prototype, false);
  const row = readFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8').split('\n').find((l) => l.startsWith('| `fix-task` |'));
  assert.ok(row, 'the state table has a fix-task row');
  assert.equal(row, '| `fix-task` | active fix-task marker read by the protect-tests hook; written by CLI `card fix-task`, deleted by `card fix-task --clear` | CLI `card fix-task` |');
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
  assert.ok(
    unreleased.includes('- T1-SWEEP2-FIX-TASK (bugfix): `aidlc card fix-task --clear` deletes the `fix-task` marker instead of writing an empty one, which the protect-tests hook read as an active fix task, so test files now unlock after a clear. The uncalled `CardRunner.setFixTaskMarker`, which cleared the same way, is removed. A stale empty marker left by an earlier `--clear` still locks: run `aidlc card fix-task --clear` once more to remove it.'),
    'the CHANGELOG Unreleased section names the card, the fix, the removed method and the stale-marker recovery',
  );
});
