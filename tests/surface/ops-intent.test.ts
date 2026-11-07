import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(root, 'bin', 'aidlc.js');

const temps: string[] = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A temp git repository with its own state directory and one goal. */
function repo(): { cwd: string; stateDir: string; env: NodeJS.ProcessEnv; goal: string } {
  const cwd = mkdtempSync(path.join(tmpdir(), 'aidlc-ops-intent-'));
  temps.push(cwd);
  assert.equal(spawnSync('git', ['init', '-q'], { cwd, encoding: 'utf8' }).status, 0);
  const stateDir = path.join(cwd, 'state');
  const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'], SystemRoot: process.env['SystemRoot'], AIDLC_STATE_DIR: stateDir, AIDLC_SESSION: 'ops-intent-test' };
  const created = spawnSync(process.execPath, [BIN, 'goal', 'new', 'a small change', '--size', 'T0', '--json'], { cwd, env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(created.status, 0, created.stderr);
  return { cwd, stateDir, env, goal: (JSON.parse(created.stdout) as { goal: string }).goal };
}

function cli(r: { cwd: string; env: NodeJS.ProcessEnv }, ...args: string[]) {
  return spawnSync(process.execPath, [BIN, ...args, '--json'], { cwd: r.cwd, env: r.env, encoding: 'utf8', timeout: 60_000 });
}

function operationFiles(r: { stateDir: string }): string[] {
  const dir = path.join(r.stateDir, 'operations');
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : [];
}

function journalText(r: { stateDir: string; goal: string }): string {
  const dir = path.join(r.stateDir, 'journal');
  return readdirSync(dir).filter((name) => name.includes(r.goal)).map((name) => readFileSync(path.join(dir, name), 'utf8')).join('');
}

test('T0-OPS-INTENT-KIND acceptance 2: an unsupported --kind exits nonzero, names the value and a kind, writes nothing and leaves `next` working', () => {
  const r = repo();
  const refused = cli(r, 'ops', 'intent', '--goal', r.goal, '--kind', 'cleanup', '--target', 't');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /cleanup/);
  assert.match(refused.stderr, /deploy/);
  assert.deepEqual(operationFiles(r), []);
  assert.doesNotMatch(journalText(r), /OPERATION_INTENT/);
  const next = cli(r, 'next', '--goal', r.goal);
  assert.equal(next.status, 0, next.stderr);
});

for (const value of ['abc', '0']) {
  test(`T0-OPS-INTENT-KIND acceptance 3: --timeout-ms ${value} exits nonzero and writes no operation file`, () => {
    const r = repo();
    const refused = cli(r, 'ops', 'intent', '--goal', r.goal, '--kind', 'other', '--target', 't', '--timeout-ms', value);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /--timeout-ms/);
    assert.deepEqual(operationFiles(r), []);
  });
}

test('T0-OPS-INTENT-KIND acceptance 4: a supported kind still records one intended operation', () => {
  const r = repo();
  const recorded = cli(r, 'ops', 'intent', '--goal', r.goal, '--kind', 'other', '--target', 't');
  assert.equal(recorded.status, 0, recorded.stderr);
  const files = operationFiles(r);
  assert.equal(files.length, 1);
  assert.equal((JSON.parse(readFileSync(path.join(r.stateDir, 'operations', files[0]!), 'utf8')) as { status: string }).status, 'intended');
});
