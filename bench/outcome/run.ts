// node bench/outcome/run.ts (card T1-OUTCOME-INGEST): writes the outcome tables as JSONL, runs bench/outcome/views/*.sql
// in name order through the DuckDB CLI and prints each view named summary_* as one JSON line. See bench/outcome/README.md.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadProjectConfig } from '../../src/config.ts';
import { resolveRepoIdentity, resolveStatePaths } from '../../src/state/paths.ts';
import { COLUMNS, ingestState, writeTables, type Row, type TableName } from './ingest.ts';

const viewsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'views');

/** The DuckDB binary could not be started; exit code 2. */
class NoDuckdb extends Error {}

function main(): number {
  const { values } = parseArgs({ options: { state: { type: 'string' }, cards: { type: 'string' }, out: { type: 'string' }, duckdb: { type: 'string' } } });
  const mainRoot = (): string => resolveRepoIdentity().mainRoot;
  const stateDir = path.resolve(values.state ?? resolveStatePaths().root);
  const cardsDir = path.resolve(values.cards ?? path.join(mainRoot(), loadProjectConfig(mainRoot()).config.cardsDir));
  const outDir = path.resolve(values.out ?? path.join(mainRoot(), '_local', 'outcome'));

  const tables = ingestState({ stateDir, cardsDir });
  // The only write of this script: writeTables refuses an outDir inside either directory before it creates anything.
  writeTables(tables, outDir, [stateDir, cardsDir]);
  process.stderr.write(`outcome: ${(Object.keys(COLUMNS) as TableName[]).map((name) => `${name} ${tables[name].length}`).join(', ')}; written to ${outDir}\n`);

  // A given path (absolute, or holding a separator) is resolved here, against the invocation directory, since the child
  // runs in outDir. A bare name is left to the lookup of the operating system.
  const bin = values.duckdb !== undefined && /[\\/]/.test(values.duckdb) ? path.resolve(values.duckdb) : (values.duckdb ?? 'duckdb');
  const views = readdirSync(viewsDir).filter((name) => name.endsWith('.sql')).sort().map((name) => readFileSync(path.join(viewsDir, name), 'utf8')).join('\n');
  /** One DuckDB process on an in-memory database: every view file, then `select`, whose rows it prints as a JSON array. */
  const query = (select: string): Row[] => {
    const r = spawnSync(bin, ['-json', '-bail'], { cwd: outDir, input: `${views}\n${select}\n`, encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
    if (r.error && r.signal === null) throw new NoDuckdb(r.error.message);
    if (r.error || r.status !== 0) throw new Error(`${bin} failed on "${select}" (exit ${String(r.status)}): ${(r.error?.message ?? r.stderr).trim()}`);
    return r.stdout.trim() === '' ? [] : (JSON.parse(r.stdout) as Row[]);
  };
  try {
    const summaries = query("SELECT view_name FROM duckdb_views() WHERE NOT internal AND starts_with(view_name, 'summary_') ORDER BY view_name;");
    for (const { view_name: view } of summaries) process.stdout.write(`${JSON.stringify({ view, rows: query(`SELECT * FROM "${String(view)}";`) })}\n`);
  } catch (err) {
    if (!(err instanceof NoDuckdb)) throw err;
    process.stderr.write(`outcome: the DuckDB binary "${bin}" cannot be started (${err.message}). Install it with "winget install DuckDB.cli" or pass --duckdb <path>. The tables are in ${outDir}.\n`);
    return 2;
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  process.stderr.write(`outcome: ${(err as Error).message}\n`);
  process.exitCode = 1;
}
