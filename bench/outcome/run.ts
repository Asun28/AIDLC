// node bench/outcome/run.ts (cards T1-OUTCOME-INGEST and T1-OUTCOME-USAGE): writes the outcome tables as JSONL, runs bench/outcome/views/*.sql
// in name order through the DuckDB CLI and prints each view named summary_* as one JSON line. See bench/outcome/README.md.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadProjectConfig, resolveWorktreeRoot } from '../../src/config.ts';
import { resolveRepoIdentity, resolveStatePaths } from '../../src/state/paths.ts';
import { COLUMNS, ingestState, writeTables, type Row, type Tables } from './ingest.ts';
import { attribute, claudeUsage, codexUsage, priceOf, reviewLogUsage, USAGE_COLUMNS, type Prices } from './usage.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const viewsDir = path.join(here, 'views');

/** The DuckDB binary could not be started; exit code 2. */
class NoDuckdb extends Error {}

function main(): number {
  const { values } = parseArgs({ options: { state: { type: 'string' }, cards: { type: 'string' }, out: { type: 'string' }, duckdb: { type: 'string' }, 'claude-dir': { type: 'string', multiple: true }, 'codex-dir': { type: 'string' }, 'no-usage': { type: 'boolean' } } });
  const mainRoot = (): string => resolveRepoIdentity().mainRoot;
  const stateDir = path.resolve(values.state ?? resolveStatePaths().root);
  const cardsDir = path.resolve(values.cards ?? path.join(mainRoot(), loadProjectConfig(mainRoot()).config.cardsDir));
  const outDir = path.resolve(values.out ?? path.join(mainRoot(), '_local', 'outcome'));

  const state = ingestState({ stateDir, cardsDir });
  const tables: Record<string, Row[]> = state;
  const readOnly = [stateDir, cardsDir];
  if (!values['no-usage']) {
    const worktreeRoot = path.resolve(resolveWorktreeRoot(loadProjectConfig(mainRoot()).config, mainRoot()));
    // Claude Code keeps the logs of a directory under its absolute path with every character but letters and digits as "-".
    const projectDir = (dir: string): string => path.join(os.homedir(), '.claude', 'projects', path.resolve(dir).replace(/[^A-Za-z0-9]/g, '-'));
    const worktrees = (): string[] => (statSync(worktreeRoot, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(worktreeRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(worktreeRoot, e.name)).sort() : []);
    const claudeDirs = values['claude-dir']?.map((dir) => path.resolve(dir)) ?? [mainRoot(), ...worktrees()].map(projectDir);
    const codexDir = path.resolve(values['codex-dir'] ?? path.join(os.homedir(), '.codex', 'sessions'));
    const read = [claudeUsage(claudeDirs, state.cards.map((card) => String(card['id']))), codexUsage(codexDir), reviewLogUsage(stateDir)];
    const prices = JSON.parse(readFileSync(path.join(here, 'prices.json'), 'utf8')) as Prices;
    tables['usage'] = attribute(read.flatMap((u) => u.rows), state, worktreeRoot).map((row) => ({ ...row, costUsd: priceOf(row, prices) }));
    tables['usage_errors'] = read.flatMap((u) => u.errors);
    // writeTables writes the tables COLUMNS names, so the two usage tables are added to it for this run.
    Object.assign(COLUMNS, USAGE_COLUMNS);
    readOnly.push(...claudeDirs, codexDir);
  }
  // The only write of this script: writeTables refuses an outDir inside a directory this run reads before it creates anything.
  writeTables(tables as Tables, outDir, readOnly);
  process.stderr.write(`outcome: ${Object.entries(tables).map(([name, rows]) => `${name} ${rows.length}`).join(', ')}; written to ${outDir}\n`);

  // A given path (absolute, or holding a separator) is resolved here, against the invocation directory, since the child
  // runs in outDir. A bare name is left to the lookup of the operating system.
  const bin = values.duckdb !== undefined && /[\\/]/.test(values.duckdb) ? path.resolve(values.duckdb) : (values.duckdb ?? 'duckdb');
  const views = readdirSync(viewsDir).filter((name) => name.endsWith('.sql') && !(values['no-usage'] && name === '20-cost.sql')).sort().map((name) => readFileSync(path.join(viewsDir, name), 'utf8')).join('\n');
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
