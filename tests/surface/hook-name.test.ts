// Card T1-SWEEP-HOOK-NAME: `aidlc hook <name>` with a name that is no guard fails closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHook, type HookEvent, type HookName } from '../../src/hooks/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KNOWN = 'known names: auto, production-gate, protect-paths, protect-tests, secrets-guard, verify-before-done, route-new-work';
const line = (quoted: string): string => `aidlc hook: unknown hook name ${quoted}; ${KNOWN}`;

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'aidlc-hook-name-'));
}

function editEvent(cwd: string): HookEvent {
  return { hook_event_name: 'PreToolUse', tool_name: 'Edit', cwd, tool_input: { file_path: 'tests/a.test.ts' } };
}

test('T1-SWEEP-HOOK-NAME acceptance 1: an unknown name returns exit 2 and the unknown-name line [R1]', () => {
  const cwd = tempDir();
  assert.deepEqual(runHook('protect-test' as HookName, editEvent(cwd), { cwd, env: {} }), { exitCode: 2, stderr: line('"protect-test"') });
});

test('T1-SWEEP-HOOK-NAME acceptance 1: the name is one line of printable ASCII that JSON.parse turns back into the name [R1]', () => {
  const cwd = tempDir();
  const name = 'a"b\nc\u001bd\u009beéf\u007f~ ';
  const r = runHook(name as HookName, editEvent(cwd), { cwd, env: {} });
  assert.equal(r.exitCode, 2);
  assert.equal(r.stderr, line('"a\\"b\\nc\\u001bd\\u009be\\u00e9f\\u007f~ "'));
  assert.match(r.stderr!, /^[\x20-\x7e]+$/);
  const quoted = r.stderr!.slice('aidlc hook: unknown hook name '.length, r.stderr!.length - `; ${KNOWN}`.length);
  assert.equal(JSON.parse(quoted), name);
});

/** Every path the fs calls a config load can make receive while `fn` runs (the named imports of src see the spies). */
function configPathsTouched<T>(fn: () => T): { result: T; touched: string[] } {
  const touched: string[] = [];
  const names = ['existsSync', 'lstatSync', 'statSync', 'readFileSync'] as const;
  const target = fs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const originals = names.map((n) => target[n]!);
  names.forEach((n, i) => {
    target[n] = (p: unknown, ...rest: unknown[]) => {
      touched.push(String(p));
      return originals[i]!(p, ...rest);
    };
  });
  syncBuiltinESMExports();
  try {
    const result = fn();
    return { result, touched: touched.filter((p) => p.includes('aidlc.config.json')) };
  } finally {
    names.forEach((n, i) => {
      target[n] = originals[i]!;
    });
    syncBuiltinESMExports();
  }
}

test('T1-SWEEP-HOOK-NAME acceptance 1: an unknown name never reads the hook config [R1]', () => {
  const cwd = tempDir();
  writeFileSync(path.join(cwd, 'aidlc.config.json'), '{ not json', 'utf8');
  const unknown = configPathsTouched(() => runHook('protect-test' as HookName, editEvent(cwd), { cwd, env: {} }));
  assert.deepEqual(unknown.result, { exitCode: 2, stderr: line('"protect-test"') });
  assert.deepEqual(unknown.touched, []);
  // The spy sees a config read: a known guard in the same directory reads the same file.
  const known = configPathsTouched(() => runHook('protect-tests', editEvent(cwd), { cwd, env: {} }));
  assert.ok(known.touched.length > 0, 'a known guard reads aidlc.config.json through the spied calls');
});

function cli(name: string, event: HookEvent): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [path.join(root, 'bin', 'aidlc.js'), 'hook', name], { cwd: event.cwd as string, input: JSON.stringify(event), encoding: 'utf8', env: { PATH: process.env['PATH'], SystemRoot: process.env['SystemRoot'] } });
  return { status: r.status, stderr: r.stderr };
}

test('T1-SWEEP-HOOK-NAME acceptance 2: `aidlc hook <unknown>` exits 2 with the line; a known guard still exits 0 [R2]', () => {
  const cwd = tempDir();
  const unknown = cli('protect-test', editEvent(cwd));
  assert.equal(unknown.status, 2);
  assert.equal(unknown.stderr.trim(), line('"protect-test"'));
  const known = cli('secrets-guard', { hook_event_name: 'PreToolUse', tool_name: 'Read', cwd, tool_input: { file_path: 'README.md' } });
  assert.equal(known.status, 0);
});

test('T1-SWEEP-HOOK-NAME acceptance 4: OPERATIONS states the unknown-name exit and the CHANGELOG names the card [R3]', () => {
  const ops = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8');
  assert.ok(
    ops.includes(`\`aidlc hook <name>\` runs one guard by name; a name that is no guard exits 2 with \`aidlc hook: unknown hook name <name>; ${KNOWN}\` on stderr (the name as a JSON string, every character outside printable ASCII escaped) and runs no guard, so a mistyped hook command blocks the action it is wired to until the name is fixed.`),
    'OPERATIONS states the unknown-name exit',
  );
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
  assert.match(unreleased, /^- T1-SWEEP-HOOK-NAME: `aidlc hook <name>` with a name that is no guard now exits 2 /m);
});
