// node bench/outcome/run.ts (cards T1-OUTCOME-INGEST, T1-OUTCOME-USAGE, T1-OUTCOME-GITHUB and T1-OUTCOME-SUMMARY): writes the outcome tables as JSONL, runs
// bench/outcome/views/*.sql in name order through the DuckDB CLI and prints each view named summary_* as one JSON line; with --summary
// it then writes the commit, the run time, the table row counts and every view's rows to one JSON file.
// See bench/outcome/README.md.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadProjectConfig, resolveWorktreeRoot } from '../../src/config.ts';
import { runSync, type SyncRunner } from '../../src/probes/exec.ts';
import { resolveRepoIdentity, resolveStatePaths } from '../../src/state/paths.ts';
import { githubTables } from './github.ts';
import { assertWritable, ingestState, writeTables, type Row } from './ingest.ts';
import { attribute, claudeUsage, codexUsage, priceOf, reviewLogUsage, type Prices } from './usage.ts';

/** The view file that reads the GitHub tables; not run with --no-github, which does not write them. */
const GITHUB_VIEWS = '30-github.sql';
/** The view file that reads the usage tables; not run with --no-usage, which does not write them. */
const USAGE_VIEWS = '20-cost.sql';

const here = path.dirname(fileURLToPath(import.meta.url));
const viewsDir = path.join(here, 'views');

/** The DuckDB binary could not be started; exit code 2. */
class NoDuckdb extends Error {}

function main(): number {
  const ranAt = new Date().toISOString();
  const { values } = parseArgs({ options: { summary: { type: 'string' }, state: { type: 'string' }, cards: { type: 'string' }, out: { type: 'string' }, duckdb: { type: 'string' }, 'claude-dir': { type: 'string', multiple: true }, 'codex-dir': { type: 'string' }, 'no-usage': { type: 'boolean' }, 'no-github': { type: 'boolean' } } });
  const usage = values['no-usage'] !== true;
  const github = values['no-github'] !== true;
  const mainRoot = (): string => resolveRepoIdentity().mainRoot;
  const stateDir = path.resolve(values.state ?? resolveStatePaths().root);
  const cardsDir = path.resolve(values.cards ?? path.join(mainRoot(), loadProjectConfig(mainRoot()).config.cardsDir));
  const outDir = path.resolve(values.out ?? path.join(mainRoot(), '_local', 'outcome'));

  let tables: Parameters<typeof writeTables>[0] = ingestState({ stateDir, cardsDir });
  const readOnly = [stateDir, cardsDir];
  if (usage) {
    const worktreeRoot = path.resolve(resolveWorktreeRoot(loadProjectConfig(mainRoot()).config, mainRoot()));
    // Claude Code keeps the logs of a directory under its absolute path with every character but letters and digits as "-".
    const projectDir = (): string => path.join(os.homedir(), '.claude', 'projects', path.resolve(mainRoot()).replace(/[^A-Za-z0-9]/g, '-'));
    const claudeDirs = values['claude-dir']?.map((dir) => path.resolve(dir)) ?? [projectDir()];
    const codexDir = path.resolve(values['codex-dir'] ?? path.join(os.homedir(), '.codex', 'sessions'));
    const read = [claudeUsage(claudeDirs, tables.cards.map((card) => String(card['id']))), codexUsage(codexDir), reviewLogUsage(stateDir)];
    const prices = JSON.parse(readFileSync(path.join(here, 'prices.json'), 'utf8')) as Prices;
    tables.usage = attribute(read.flatMap((u) => u.rows), tables, worktreeRoot);
    for (const row of tables.usage) row['costUsd'] = priceOf(row, prices);
    tables.usage_errors = read.flatMap((u) => u.errors);
    readOnly.push(...claudeDirs, codexDir);
  }
  if (github) {
    // The main checkout is resolved here, in the invocation directory, and every gh and git child runs in it.
    const repoRoot = mainRoot();
    const config = loadProjectConfig(repoRoot).config;
    const runner: SyncRunner = (command, args, options) => runSync(command, args, { ...options, cwd: repoRoot });
    tables = { ...tables, ...githubTables(runner, config.repository, config.base, config.github.requiredChecks) };
  }
  // --summary: its one git call, then the output rule of writeTables for its directory, both before anything is created.
  const summaryPath = values.summary === undefined ? undefined : path.resolve(values.summary);
  let commit = '';
  if (summaryPath !== undefined) {
    const repoRoot = mainRoot();
    const head = runSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: repoRoot, timeoutMs: 120000 });
    commit = head.stdout.trim();
    if (head.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(commit)) throw new Error(`--summary: git rev-parse in ${repoRoot} exited ${String(head.exitCode)}: ${head.stderr.split(/\r?\n/)[0] ?? ''}`);
    assertWritable(path.dirname(summaryPath), readOnly, realpathSync.native);
  }
  // The table write of this script: writeTables refuses an outDir inside a directory this run reads before it creates anything.
  writeTables(tables, outDir, readOnly);
  process.stderr.write(`outcome: ${Object.entries(tables as Record<string, Row[]>).map(([name, rows]) => `${name} ${rows.length}`).join(', ')}; written to ${outDir}\n`);

  // A given path (absolute, or holding a separator) is resolved here, against the invocation directory, since the child
  // runs in outDir. A bare name is left to the lookup of the operating system.
  const bin = values.duckdb !== undefined && /[\\/]/.test(values.duckdb) ? path.resolve(values.duckdb) : (values.duckdb ?? 'duckdb');
  const views = readdirSync(viewsDir).filter((name) => name.endsWith('.sql') && (usage || name !== USAGE_VIEWS) && (github || name !== GITHUB_VIEWS)).sort().map((name) => readFileSync(path.join(viewsDir, name), 'utf8')).join('\n');
  /** One DuckDB process on an in-memory database: every view file, then `select`, whose rows it prints as a JSON array. */
  const query = (select: string): Row[] => {
    const r = spawnSync(bin, ['-json', '-bail'], { cwd: outDir, input: `${views}\n${select}\n`, encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
    if (r.error && r.signal === null) throw new NoDuckdb(r.error.message);
    if (r.error || r.status !== 0) throw new Error(`${bin} failed on "${select}" (exit ${String(r.status)}): ${(r.error?.message ?? r.stderr).trim()}`);
    return r.stdout.trim() === '' ? [] : (JSON.parse(r.stdout) as Row[]);
  };
  try {
    const summaries = query("SELECT view_name FROM duckdb_views() WHERE NOT internal AND starts_with(view_name, 'summary_') ORDER BY view_name;");
    const viewRows: Record<string, Row[]> = {};
    for (const { view_name: view } of summaries) {
      const rows = query(`SELECT * FROM "${String(view)}";`);
      viewRows[String(view)] = rows;
      process.stdout.write(`${JSON.stringify({ view, rows })}\n`);
    }
    if (summaryPath !== undefined) {
      // Written only once every view has printed. The entry is removed and the file created exclusively, as writeTables writes a table.
      const counts = Object.fromEntries(Object.entries(tables as Record<string, Row[]>).map(([name, rows]) => [name, rows.length]));
      mkdirSync(path.dirname(summaryPath), { recursive: true });
      rmSync(summaryPath, { force: true });
      writeFileSync(summaryPath, `${JSON.stringify({ commit, ranAt, tables: counts, views: viewRows }, null, 2)}\n`, { flag: 'wx' });
    }
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
