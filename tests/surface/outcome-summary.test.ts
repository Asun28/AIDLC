// Card T1-OUTCOME-SUMMARY: run.ts --summary writes the commit, the run time, the row count of every table and the rows of
// every summary view to one JSON file once every view has run, and bench/outcome/summary.json is that file from one full run.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLUMNS, GITHUB_COLUMNS, USAGE_COLUMNS } from '../../bench/outcome/ingest.ts';
import { resolveRepoIdentity } from '../../src/state/paths.ts';
import { cleanup, tmpDir } from '../infra/helpers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const temps: string[] = [];
after(() => temps.forEach((dir) => cleanup(dir)));

const duckdb = process.env['DUCKDB_BIN'] ?? (spawnSync('duckdb', ['--version'], { windowsHide: true }).status === 0 ? 'duckdb' : undefined);

/** A temporary directory by its canonical path (the Windows runner's temp directory is an 8.3 short path), removed after the tests. */
function tempDir(): string {
  const dir = realpathSync.native(tmpDir('aidlc-summary-'));
  temps.push(dir);
  return dir;
}

function put(file: string, text: string): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

const RAN_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const cardText = (id: string, status: string): string => `---\nid: ${id}\ntitle: ${id}\nstatus: ${status}\nallow_paths:\n  - src/x.ts\ndod_command: npm test\n---\n\n# ${id}\n`;
const run = (goalId: string, cardId: string, state: string, startedAt: string): object => ({ goalId, cardId, cardRevision: 0, goalGeneration: 0, state, startedAt, deadline: '2026-02-01T00:00:00Z', updatedAt: '2026-01-04T00:00:00Z' });

/** A registry with one card T1-A and a state directory with its one card run and an empty journal directory (acceptance detail, item 2). */
function fixture(): { dir: string; state: string; cards: string; out: string } {
  const dir = tempDir();
  const state = path.join(dir, 'state');
  const cards = path.join(dir, 'tasks');
  put(path.join(cards, 'T1-A.md'), cardText('T1-A', 'todo'));
  put(path.join(state, 'cards', 'g-a', 'T1-A.json'), JSON.stringify(run('g-a', 'T1-A', 'BUILD', '2026-01-01T00:00:00Z')));
  mkdirSync(path.join(state, 'journal'), { recursive: true });
  return { dir, state, cards, out: path.join(dir, 'out') };
}

/** `node bench/outcome/run.ts <args> --no-usage --no-github` without the variables named AIDLC_*, GIT_* or NODE_OPTIONS, in every letter case. */
function runOutcome(args: string[], cwd: string = root, extraEnv: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('AIDLC_') && !k.toUpperCase().startsWith('GIT_') && k.toUpperCase() !== 'NODE_OPTIONS'));
  const r = spawnSync(process.execPath, [path.join(root, 'bench', 'outcome', 'run.ts'), ...args, '--no-usage', '--no-github'], { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8', windowsHide: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Every string at any depth of `value`. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

test('T1-OUTCOME-SUMMARY acceptance 1: bench/outcome/summary.json holds the commit, the run time, the row count of every table and every summary view of one full run', () => {
  const file = path.join(root, 'bench', 'outcome', 'summary.json');
  assert.ok(existsSync(file), 'bench/outcome/summary.json exists');
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { commit: unknown; ranAt: unknown; tables: Record<string, unknown>; views: Record<string, unknown> };
  assert.deepEqual(Object.keys(doc), ['commit', 'ranAt', 'tables', 'views']);
  assert.match(String(doc.commit), /^[0-9a-f]{40}$/);
  assert.equal(typeof doc.ranAt, 'string');
  assert.match(doc.ranAt as string, RAN_AT);
  assert.equal(new Date(doc.ranAt as string).toISOString(), doc.ranAt);
  assert.deepEqual(Object.keys(doc.tables).sort(), Object.keys({ ...COLUMNS, ...USAGE_COLUMNS, ...GITHUB_COLUMNS }).sort());
  for (const [name, count] of Object.entries(doc.tables)) assert.ok(Number.isSafeInteger(count) && (count as number) >= 0, `${name}: ${String(count)}`);
  assert.deepEqual(Object.keys(doc.views), [
    'summary_cache_share', 'summary_ci', 'summary_cost_by_stage', 'summary_cost_per_card', 'summary_lead_time', 'summary_lead_time_pr', 'summary_pr_success',
    'summary_reconcile', 'summary_review_convergence', 'summary_stop_reasons', 'summary_successor_rate', 'summary_superseded_spend', 'summary_unattributed',
  ]);
  for (const [view, rows] of Object.entries(doc.views)) {
    assert.ok(Array.isArray(rows), `${view} is an array`);
    for (const row of rows as unknown[]) assert.ok(row !== null && typeof row === 'object' && !Array.isArray(row), `${view}: every row is an object`);
  }
  const convergence = doc.views['summary_review_convergence'] as Record<string, unknown>[];
  assert.equal(convergence.length, 1);
  assert.deepEqual(Object.keys(convergence[0]!), ['cards', 'first_decision_pass_share', 'two_or_more_blocks_share', 'mean_decisions_to_pass', 'stop_review_share']);
  const successor = doc.views['summary_successor_rate'] as Record<string, unknown>[];
  const prSuccess = doc.views['summary_pr_success'] as Record<string, unknown>[];
  assert.equal(successor[0]?.['card_attempts'], prSuccess[0]?.['card_attempts']);
  assert.deepEqual(strings(doc.views).filter((s) => /[\\/]/.test(s)), [], 'no string of a view holds a path separator');
});

test('T1-OUTCOME-SUMMARY acceptance 2: run.ts --summary writes the document after every view has run, and a view that fails after others printed leaves an existing summary as it was', { skip: duckdb === undefined ? 'no duckdb binary' : false }, () => {
  const f = fixture();
  const summary = path.join(f.dir, 'new', 'summary.json');
  const r = runOutcome(['--state', f.state, '--cards', f.cards, '--out', f.out, '--duckdb', duckdb!, '--summary', summary]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(path.join(f.dir, 'new')), 'the directory of the summary was created');
  const text = readFileSync(summary, 'utf8');
  const doc = JSON.parse(text) as { commit: string; ranAt: string; tables: Record<string, number>; views: Record<string, unknown[]> };
  assert.equal(text, `${JSON.stringify(doc, null, 2)}\n`);
  assert.deepEqual(Object.keys(doc), ['commit', 'ranAt', 'tables', 'views']);
  assert.deepEqual(Object.entries(doc.tables), [['cards', 1], ['card_runs', 1], ['review_decisions', 0], ['findings', 0], ['state_spans', 0], ['attempts', 0], ['ingest_errors', 0]]);
  const printed = r.stdout.trim().split('\n').map((line) => JSON.parse(line) as { view: string; rows: unknown[] }).map((v) => [v.view, v.rows]);
  assert.deepEqual(printed.map(([view]) => view), ['summary_lead_time', 'summary_review_convergence', 'summary_stop_reasons', 'summary_successor_rate']);
  assert.deepEqual(Object.entries(doc.views), printed);
  const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: resolveRepoIdentity(root).mainRoot, encoding: 'utf8', windowsHide: true });
  assert.equal(head.status, 0, head.stderr);
  assert.equal(doc.commit, head.stdout.trim());
  assert.match(doc.ranAt, RAN_AT);

  // A state with no card run: summary_successor_rate divides 0 by 0 and fails after three views have printed.
  const dir = tempDir();
  const keep = put(path.join(dir, 'keep.json'), 'old\n');
  mkdirSync(path.join(dir, 'state'));
  mkdirSync(path.join(dir, 'tasks'));
  const failed = runOutcome(['--state', path.join(dir, 'state'), '--cards', path.join(dir, 'tasks'), '--out', path.join(dir, 'out'), '--duckdb', duckdb!, '--summary', keep]);
  assert.equal(failed.status, 1, failed.stderr);
  assert.deepEqual(failed.stdout.trim().split('\n').map((line) => (JSON.parse(line) as { view: string }).view), ['summary_lead_time', 'summary_review_convergence', 'summary_stop_reasons']);
  assert.equal(readFileSync(keep, 'utf8'), 'old\n');
});

test('T1-OUTCOME-SUMMARY acceptance 3: a DuckDB binary that cannot be started leaves an existing summary as it was, and either refusal writes neither a summary nor a table', () => {
  const missing = (dir: string): string => path.join(dir, 'missing-duckdb.exe');

  const a = fixture();
  const keep = put(path.join(a.dir, 'keep.json'), 'old\n');
  const noDuckdb = runOutcome(['--state', a.state, '--cards', a.cards, '--out', a.out, '--duckdb', missing(a.dir), '--summary', keep]);
  assert.equal(noDuckdb.status, 2, noDuckdb.stderr);
  assert.equal(readFileSync(keep, 'utf8'), 'old\n');

  const b = fixture();
  const inState = path.join(b.state, 'summary.json');
  const refused = runOutcome(['--state', b.state, '--cards', b.cards, '--out', b.out, '--duckdb', missing(b.dir), '--summary', inState]);
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /refusing to write/);
  assert.ok(!existsSync(inState), 'no summary in the state directory');
  assert.ok(!existsSync(path.join(b.out, 'cards.jsonl')), 'no table written');

  const c = fixture();
  const outside = tempDir();
  const s = path.join(c.dir, 's.json');
  const noRepo = runOutcome(['--state', c.state, '--cards', c.cards, '--out', c.out, '--duckdb', missing(c.dir), '--summary', s], outside, { GIT_CEILING_DIRECTORIES: path.dirname(outside) });
  assert.equal(noRepo.status, 1, noRepo.stderr);
  assert.match(noRepo.stderr, /outcome: --summary: git rev-parse in /);
  assert.ok(!existsSync(s), 'no summary written');
  assert.ok(!existsSync(path.join(c.out, 'cards.jsonl')), 'no table written');
});
