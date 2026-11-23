// The DuckDB call of bench/outcome/run.ts (card T0-OUTCOME-DUCKDB-EPIPE): one process per query, and what each way it can end means.
import { spawnSync } from 'node:child_process';
import type { Row } from './ingest.ts';

/** The DuckDB binary could not be started; `run.ts` exits 2 on it. */
export class NoDuckdb extends Error {}

/** The fields of a `spawnSync` result that `queryDuckdb` decides on. */
export interface DuckdbResult {
  error?: Error;
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface DuckdbOptions {
  cwd: string;
  input: string;
  encoding: 'utf8';
  windowsHide: true;
  maxBuffer: number;
}

export type DuckdbSpawn = (bin: string, args: string[], options: DuckdbOptions) => DuckdbResult;

/**
 * One DuckDB process on an in-memory database, run in `cwd` with `sql` on its standard input; returns the rows it prints
 * as a JSON array, none for an empty output. `label` names the query in a failure.
 *
 * `NoDuckdb` only when no process started: an error with neither an exit code nor a signal (ENOENT, EACCES). An error
 * beside an exit code is a process that started and exited, as when it exits before its input is written (EPIPE, or
 * EOF on Windows): a failed query, reported with the exit code, what the process wrote on stderr and the error.
 */
export function queryDuckdb(bin: string, cwd: string, sql: string, label: string, spawn: DuckdbSpawn = spawnSync): Row[] {
  const r = spawn(bin, ['-json', '-bail'], { cwd, input: sql, encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  if (r.error && r.status === null && r.signal === null) throw new NoDuckdb(r.error.message);
  if (r.error || r.status !== 0) {
    const detail = r.status === null ? (r.error?.message ?? r.stderr).trim() : [r.stderr.trim(), r.error?.message].filter((part) => part).join('; ');
    throw new Error(`${bin} failed on "${label}" (exit ${String(r.status)}): ${detail}`);
  }
  return r.stdout.trim() === '' ? [] : (JSON.parse(r.stdout) as Row[]);
}
