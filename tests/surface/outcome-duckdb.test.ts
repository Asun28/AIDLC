// Card T0-OUTCOME-DUCKDB-EPIPE (issue 435): what queryDuckdb (bench/outcome/duckdb.ts) makes of each way its process can end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { NoDuckdb, queryDuckdb, type DuckdbResult, type DuckdbSpawn } from '../../bench/outcome/duckdb.ts';
import { tmpDir } from '../infra/helpers.ts';

/** Node stands in for the binary: it rejects `-json`, writes `bad option: -json` and exits 9 without reading its input. */
const NODE = process.execPath;
const LABEL = 'SELECT 1;';
const failedOnNode = `${NODE} failed on "${LABEL}" (exit 9): `;
const dir = realpathSync.native(tmpDir('aidlc-outcome-duckdb-'));

/** The error `call` throws; the test fails when `call` returns. */
function thrown(call: () => unknown): Error {
  try {
    call();
  } catch (err) {
    return err as Error;
  }
  return assert.fail('queryDuckdb returned');
}

test('acceptance 1: a binary that exits before a 1 MiB input is written is a failed query with its exit code, its stderr and the write error, not a binary that cannot be started [R2] [R3]', () => {
  // Larger than a pipe buffer: the write cannot end before the exit, so the write error does not depend on scheduling.
  const err = thrown(() => queryDuckdb(NODE, dir, 'x'.repeat(1 << 20), LABEL));
  assert.equal(err instanceof NoDuckdb, false, err.message);
  assert.ok(err.message.startsWith(failedOnNode), err.message);
  const detail = err.message.slice(failedOnNode.length);
  assert.match(detail, /bad option: -json/);
  assert.ok([`; spawnSync ${NODE} EPIPE`, `; spawnSync ${NODE} EOF`].some((end) => detail.endsWith(end)), detail);
});

test('acceptance 2: a path that names no file cannot be started; node with a one-line input is a failed query, whichever of its exit and the write came first [R2] [R3]', () => {
  const missing = thrown(() => queryDuckdb(path.join(dir, 'missing-duckdb.exe'), dir, `${LABEL}\n`, LABEL));
  assert.ok(missing instanceof NoDuckdb, missing.message);
  assert.match(missing.message, /ENOENT/);

  const failed = thrown(() => queryDuckdb(NODE, dir, `${LABEL}\n`, LABEL));
  assert.equal(failed instanceof NoDuckdb, false, failed.message);
  assert.ok(failed.message.startsWith(failedOnNode), failed.message);
  assert.match(failed.message, /bad option: -json/);
});

test('acceptance 3: with a scripted spawn, the call, the rows of a result and every failure: an exit with a write error, no process, a signal, an exit code [R1] [R2] [R3]', () => {
  const result = (over: Partial<DuckdbResult>): DuckdbResult => ({ status: 0, signal: null, stdout: '', stderr: '', ...over });
  const calls: unknown[][] = [];
  const scripted = (r: DuckdbResult): DuckdbSpawn => (...args) => {
    calls.push(args);
    return r;
  };

  assert.deepEqual(queryDuckdb('duck', 'out', 'SQL', LABEL, scripted(result({ stdout: '[{"a":1},{"a":2}]\n' }))), [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(calls, [['duck', ['-json', '-bail'], { cwd: 'out', input: 'SQL', encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 }]]);
  for (const stdout of ['', ' \n\t']) assert.deepEqual(queryDuckdb('duck', 'out', 'SQL', LABEL, scripted(result({ stdout }))), [], JSON.stringify(stdout));

  const write = new Error('spawnSync duck EPIPE');
  const failed = (status: number | null, detail: string): string => `duck failed on "${LABEL}" (exit ${String(status)}): ${detail}`;
  const failures: Array<[name: string, r: DuckdbResult, noDuckdb: boolean, message: string]> = [
    ['an error with status 9 and a stderr', result({ error: write, status: 9, stderr: ' bad option \n' }), false, failed(9, 'bad option; spawnSync duck EPIPE')],
    ['an error with status 9 and an empty stderr', result({ error: write, status: 9 }), false, failed(9, 'spawnSync duck EPIPE')],
    ['an error with status 0', result({ error: write, stderr: 'read nothing' }), false, failed(0, 'read nothing; spawnSync duck EPIPE')],
    ['an error with no status and no signal', result({ error: new Error('spawnSync duck ENOENT'), status: null }), true, 'spawnSync duck ENOENT'],
    ['an error with no status and the signal SIGTERM', result({ error: new Error('spawnSync duck ENOBUFS'), status: null, signal: 'SIGTERM', stderr: 'partial' }), false, failed(null, 'spawnSync duck ENOBUFS')],
    ['a signal without an error', result({ status: null, signal: 'SIGKILL', stderr: ' killed \n' }), false, failed(null, 'killed')],
    ['status 1 without an error', result({ status: 1, stderr: ' Parser Error \n' }), false, failed(1, 'Parser Error')],
  ];
  for (const [name, r, noDuckdb, message] of failures) {
    const err = thrown(() => queryDuckdb('duck', 'out', 'SQL', LABEL, scripted(r)));
    assert.deepEqual([err instanceof NoDuckdb, err.message], [noDuckdb, message], name);
  }
});
