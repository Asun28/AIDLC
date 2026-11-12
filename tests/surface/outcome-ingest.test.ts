// Card T1-OUTCOME-INGEST: the outcome tables read from the state directory and the registry (bench/outcome/), and their views.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestState, writeTables, type Row, type Tables } from '../../bench/outcome/ingest.ts';
import { tmpDir } from '../infra/helpers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const temps: string[] = [];
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A temporary directory by its canonical path (the Windows runner's temp directory is an 8.3 short path), removed after the tests. */
function tempDir(): string {
  const dir = realpathSync.native(tmpDir('aidlc-outcome-'));
  temps.push(dir);
  return dir;
}

function put(file: string, text: string): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

const cardText = (id: string, status: string, extra = ''): string => `---\nid: ${id}\ntitle: ${id}\nstatus: ${status}\nallow_paths:\n  - src/x.ts\ndod_command: npm test\n${extra}---\n\n# ${id}\n`;
const run = (goalId: string, cardId: string, state: string, startedAt: string, extra: object): object => ({ goalId, cardId, cardRevision: 0, goalGeneration: 0, state, startedAt, deadline: '2026-02-01T00:00:00Z', updatedAt: '2026-01-04T00:00:00Z', ...extra });
const formal = (n: number, outcome: string, extra: object): object => ({ invocationId: `i${n}`, candidateDigest: `d${n}`, base: 'main', policyVersion: '1', reviewer: 'codex', requestedAt: `2026-01-03T0${n}:00:00Z`, outcome, candidateSha: `sha${n}`, decision: n, ...extra });
const event = (ts: string, type: string, goalId: string, cardId: string, data: object): string => JSON.stringify({ seq: 0, ts, type, goalId, cardId, generation: 0, data });

/** A merged run with one formal pass, a stopped run with two merge-blocking blocks and three findings, and a run with one pre round of three angles. */
function fixture(): { stateDir: string; cardsDir: string } {
  const dir = tempDir();
  const stateDir = path.join(dir, 'state');
  const cardsDir = path.join(dir, 'tasks');
  put(path.join(cardsDir, 'T1-MERGED.md'), cardText('T1-MERGED', 'merged'));
  put(path.join(cardsDir, 'T1-STOPPED.md'), cardText('T1-STOPPED', 'todo', 'superseded_by: T1-MERGED\ndepends_on: [T1-MERGED]\ntdd: false\nbudget: 120\n'));
  put(path.join(cardsDir, '_TEMPLATE.md'), 'not a card');
  const round = { round: 1, cycle: 0, reviewer: 'deepseek', candidateDigest: 'd0', candidateSha: 'sha0', requestedAt: '2026-01-01T01:00:00Z', outcome: 'block', perspectives: [{ name: 'bugs', outcome: 'pass' }, { name: 'security', outcome: 'block' }, { name: 'compliance', outcome: 'pass' }] };
  put(path.join(stateDir, 'cards', 'g-a', 'T1-MERGED.json'), JSON.stringify(run('g-a', 'T1-MERGED', 'BUILD', '2026-01-01T00:00:00Z', { preReview: { rounds: [round] } })));
  put(path.join(stateDir, 'cards', 'g-b', 'T1-MERGED.json'), JSON.stringify(run('g-b', 'T1-MERGED', 'DONE', '2026-01-02T00:00:00Z', { mergeVerified: true, pr: { number: 7, state: 'MERGED' }, review: { substantiveDecisions: 1, invocations: [formal(1, 'pass', { requestedAt: '2026-01-02T03:00:00Z', secondPass: true })] } })));
  const findings = [
    { id: 'F1', stage: 'formal', round: 1, reason: 'first @ src/x.ts:3', file: 'src/x.ts', class: 'off-by-one', candidateSha: 'sha1', raisedAt: '2026-01-03T01:10:00Z', resolvedAt: '2026-01-03T02:10:00Z' },
    { id: 'F2', stage: 'formal', round: 1, reason: 'second', raisedAt: '2026-01-03T01:10:00Z', disposition: 'disputed', disputes: [{ at: '2026-01-03T01:30:00Z', note: 'intended' }], advisory: true },
    { id: 'F3', stage: 'pre', cycle: 1, round: 2, perspective: 'bugs', reason: 'third', raisedAt: '2026-01-03T01:40:00Z', reraised: [{ stage: 'formal', round: 2, at: '2026-01-03T02:10:00Z', reason: 'third again' }], outsideDelta: true },
  ];
  const stop = { reason: 'card', detail: 'review stopped for a ruling', nextAction: 'rule', global: false, at: '2026-01-03T02:10:00Z' };
  put(path.join(stateDir, 'cards', 'g-c', 'T1-STOPPED.json'), JSON.stringify(run('g-c', 'T1-STOPPED', 'STOP', '2026-01-03T00:00:00Z', { stop, findings, review: { substantiveDecisions: 2, substantiveBlocks: 2, invocations: [formal(1, 'block', { mergeBlocking: true }), formal(2, 'block', { baseSync: true, stopReview: 'F3 raised again' })] } })));
  const b = (ts: string, type: string, data: object): string => event(`2026-01-02T${ts}Z`, type, 'g-b', 'T1-MERGED', data);
  put(path.join(stateDir, 'journal', 'g-b.jsonl'), [b('00:00:00', 'CARD_STATE', { to: 'PREPARE' }), b('00:30:00', 'CARD_STATE', { from: 'PREPARE', to: 'BUILD' }), b('00:30:00', 'ATTEMPT_STARTED', { n: 1 }), b('01:00:00', 'NOTE', {}), b('02:30:00', 'ATTEMPT_FINISHED', { outcome: 'success' }), b('02:30:00', 'CARD_STATE', { to: 'SHIP' }), b('06:00:00', 'CARD_STATE', { to: 'CLOSE' }), b('06:15:00', 'CARD_STATE', { to: 'DONE' })].join('\n') + '\n');
  const c = (ts: string, type: string, cardId: string, data: object): string => event(`2026-01-03T${ts}Z`, type, 'g-c', cardId, data);
  put(path.join(stateDir, 'journal', 'g-c.jsonl'), [c('00:00:00', 'CARD_STATE', 'T1-STOPPED', { to: 'BUILD' }), c('00:20:00', 'CARD_STATE', 'T1-OTHER', { to: 'PREPARE' }), c('00:20:00', 'ATTEMPT_STARTED', 'T1-OTHER', { n: 1 }), c('00:50:00', 'ATTEMPT_FINISHED', 'T1-STOPPED', { outcome: 'fail' }), c('01:00:00', 'CARD_STATE', 'T1-STOPPED', { to: 'STOP' })].join('\n') + '\n');
  return { stateDir, cardsDir };
}

const decision = (goalId: string, cardId: string, stage: string, outcome: string, rest: Row): Row => ({ goalId, cardId, stage, outcome, mergeBlocking: null, reviewer: 'codex', requestedAt: '', candidateSha: null, secondPass: null, baseSync: null, stopReview: false, decision: null, round: null, cycle: null, angles: [], ...rest });
const finding = (id: string, rest: Row): Row => ({ goalId: 'g-c', cardId: 'T1-STOPPED', id, stage: 'formal', round: 1, cycle: null, perspective: null, file: null, class: null, candidateSha: null, raisedAt: '2026-01-03T01:10:00Z', disposition: 'open', disputes: 0, reraises: 0, resolvedAt: null, advisory: null, outsideDelta: null, reason: '', ...rest });
const span = (goalId: string, cardId: string, state: string, startTs: string, endTs: string | null): Row => ({ goalId, cardId, state, startTs, endTs });

test('T1-OUTCOME-INGEST acceptance 1: ingestState returns the card, card-run, review, finding, state-span and attempt rows of the state directory and the registry [R1] [R2] [R3] [R4] [R5] [R6]', () => {
  const t = ingestState(fixture());
  assert.deepEqual(t.cards, [
    { id: 'T1-MERGED', status: 'merged', superseded_by: null, depends_on: [], tdd: true, budget: null },
    { id: 'T1-STOPPED', status: 'todo', superseded_by: 'T1-MERGED', depends_on: ['T1-MERGED'], tdd: false, budget: 120 },
  ]);
  const cardRun = (goalId: string, cardId: string, state: string, startedAt: string, rest: Row): Row => ({ goalId, cardId, startedAt, state, mergeVerified: false, prNumber: null, stopReason: null, stopDetail: null, substantiveDecisions: 0, substantiveBlocks: 0, updatedAt: '2026-01-04T00:00:00Z', ...rest });
  assert.deepEqual(t.card_runs, [
    cardRun('g-a', 'T1-MERGED', 'BUILD', '2026-01-01T00:00:00Z', {}),
    cardRun('g-b', 'T1-MERGED', 'DONE', '2026-01-02T00:00:00Z', { mergeVerified: true, prNumber: 7, substantiveDecisions: 1 }),
    cardRun('g-c', 'T1-STOPPED', 'STOP', '2026-01-03T00:00:00Z', { stopReason: 'card', stopDetail: 'review stopped for a ruling', substantiveDecisions: 2, substantiveBlocks: 2 }),
  ]);
  assert.deepEqual(t.review_decisions, [
    decision('g-a', 'T1-MERGED', 'pre', 'block', { reviewer: 'deepseek', requestedAt: '2026-01-01T01:00:00Z', candidateSha: 'sha0', round: 1, cycle: 0, angles: [{ angle: 'bugs', outcome: 'pass' }, { angle: 'security', outcome: 'block' }, { angle: 'compliance', outcome: 'pass' }] }),
    decision('g-b', 'T1-MERGED', 'formal', 'pass', { requestedAt: '2026-01-02T03:00:00Z', candidateSha: 'sha1', secondPass: true, decision: 1 }),
    decision('g-c', 'T1-STOPPED', 'formal', 'block', { mergeBlocking: true, requestedAt: '2026-01-03T01:00:00Z', candidateSha: 'sha1', decision: 1 }),
    decision('g-c', 'T1-STOPPED', 'formal', 'block', { requestedAt: '2026-01-03T02:00:00Z', candidateSha: 'sha2', baseSync: true, stopReview: true, decision: 2 }),
  ]);
  assert.deepEqual(t.findings, [
    finding('F1', { file: 'src/x.ts', class: 'off-by-one', candidateSha: 'sha1', resolvedAt: '2026-01-03T02:10:00Z', reason: 'first @ src/x.ts:3' }),
    finding('F2', { disposition: 'disputed', disputes: 1, advisory: true, reason: 'second' }),
    finding('F3', { stage: 'pre', round: 2, cycle: 1, perspective: 'bugs', raisedAt: '2026-01-03T01:40:00Z', reraises: 1, outsideDelta: true, reason: 'third' }),
  ]);
  assert.deepEqual(t.state_spans, [
    span('g-b', 'T1-MERGED', 'PREPARE', '2026-01-02T00:00:00Z', '2026-01-02T00:30:00Z'),
    span('g-b', 'T1-MERGED', 'BUILD', '2026-01-02T00:30:00Z', '2026-01-02T02:30:00Z'),
    span('g-b', 'T1-MERGED', 'SHIP', '2026-01-02T02:30:00Z', '2026-01-02T06:00:00Z'),
    span('g-b', 'T1-MERGED', 'CLOSE', '2026-01-02T06:00:00Z', '2026-01-02T06:15:00Z'),
    span('g-b', 'T1-MERGED', 'DONE', '2026-01-02T06:15:00Z', null),
    span('g-c', 'T1-STOPPED', 'BUILD', '2026-01-03T00:00:00Z', '2026-01-03T01:00:00Z'),
    span('g-c', 'T1-OTHER', 'PREPARE', '2026-01-03T00:20:00Z', null),
    span('g-c', 'T1-STOPPED', 'STOP', '2026-01-03T01:00:00Z', null),
  ]);
  assert.deepEqual(t.attempts, [
    { goalId: 'g-b', cardId: 'T1-MERGED', outcome: 'success', endTs: '2026-01-02T02:30:00Z', startTs: '2026-01-02T00:30:00Z' },
    { goalId: 'g-c', cardId: 'T1-STOPPED', outcome: 'fail', endTs: '2026-01-03T00:50:00Z', startTs: null },
  ]);
  assert.deepEqual(t.ingest_errors, []);
});

test('T1-OUTCOME-INGEST acceptance 2: a rejected card, two unreadable card runs and a journal line that is not JSON become four ingest_errors rows beside the valid rows [R7]', () => {
  const { stateDir, cardsDir } = fixture();
  const noId = put(path.join(cardsDir, 'T1-NOID.md'), cardText('T1-NOID', 'todo').replace('id: T1-NOID\n', ''));
  const bad = put(path.join(stateDir, 'cards', 'g-c', 'T1-BAD.json'), '{');
  const empty = put(path.join(stateDir, 'cards', 'g-c', 'T1-EMPTY.json'), '{}');
  const journal = put(path.join(stateDir, 'journal', 'g-x.jsonl'), [event('2026-01-05T00:00:00Z', 'CARD_STATE', 'g-x', 'T1-X', { to: 'BUILD' }), 'not json', event('2026-01-05T01:00:00Z', 'CARD_STATE', 'g-x', 'T1-X', { to: 'STOP' })].join('\n') + '\n');
  const t = ingestState({ stateDir, cardsDir });
  assert.deepEqual(t.ingest_errors.map(({ problem: _problem, ...rest }) => rest), [
    { source: 'card', path: noId, line: null },
    { source: 'card_run', path: bad, line: null },
    { source: 'card_run', path: empty, line: null },
    { source: 'journal', path: journal, line: 2 },
  ]);
  const problems = t.ingest_errors.map((e) => String(e['problem']));
  assert.match(problems[0]!, /^card schema violation: id: /);
  assert.equal(problems[1], 'not JSON');
  assert.match(problems[2]!, /^CardRun: goalId: /);
  assert.equal(problems[3], 'not JSON');
  assert.deepEqual(t.cards.map((c) => c['id']), ['T1-MERGED', 'T1-STOPPED']);
  assert.deepEqual(t.card_runs.map((r) => `${String(r['goalId'])}/${String(r['cardId'])}`), ['g-a/T1-MERGED', 'g-b/T1-MERGED', 'g-c/T1-STOPPED']);
  assert.deepEqual(t.state_spans.slice(-2), [span('g-x', 'T1-X', 'BUILD', '2026-01-05T00:00:00Z', '2026-01-05T01:00:00Z'), span('g-x', 'T1-X', 'STOP', '2026-01-05T01:00:00Z', null)]);
});

test('T1-OUTCOME-INGEST acceptance 3: writeTables writes the same bytes for the same rows in reversed order, and a zero-byte file for an empty table [R8]', () => {
  const tables = ingestState(fixture());
  const reversed = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => Object.fromEntries(Object.entries(row).reverse())).reverse()])) as Tables;
  const [first, second] = [path.join(tempDir(), 'out'), tempDir()];
  writeTables(tables, first);
  writeTables(reversed, second);
  for (const name of Object.keys(tables)) assert.equal(readFileSync(path.join(second, `${name}.jsonl`), 'utf8'), readFileSync(path.join(first, `${name}.jsonl`), 'utf8'), name);
  assert.equal(readFileSync(path.join(second, 'cards.jsonl'), 'utf8'), '{"id":"T1-MERGED","status":"merged","superseded_by":null,"depends_on":[],"tdd":true,"budget":null}\n{"id":"T1-STOPPED","status":"todo","superseded_by":"T1-MERGED","depends_on":["T1-MERGED"],"tdd":false,"budget":120}\n');
  assert.equal(readFileSync(path.join(second, 'attempts.jsonl'), 'utf8').split('\n')[1], '{"goalId":"g-c","cardId":"T1-STOPPED","outcome":"fail","endTs":"2026-01-03T00:50:00Z","startTs":null}');
  assert.equal(statSync(path.join(first, 'ingest_errors.jsonl')).size, 0);
});

/** Runs `node bench/outcome/run.ts` over the fixture in an environment without the variables aidlc reads, in every letter case. */
function runOutcome(duckdb: string): { status: number | null; stdout: string; stderr: string; out: string } {
  const { stateDir, cardsDir } = fixture();
  const out = path.join(tempDir(), 'out');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('AIDLC_') && k.toUpperCase() !== 'NODE_OPTIONS'));
  const r = spawnSync(process.execPath, [path.join(root, 'bench', 'outcome', 'run.ts'), '--state', stateDir, '--cards', cardsDir, '--out', out, '--duckdb', duckdb, '--no-usage', '--no-github'], { cwd: root, env, encoding: 'utf8', windowsHide: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out };
}

test('T1-OUTCOME-INGEST acceptance 4: run.ts with a DuckDB path that cannot be started exits 2, names the install command and has written the tables [R9]', () => {
  const r = runOutcome(path.join(tempDir(), 'missing-duckdb.exe'));
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /winget install DuckDB\.cli/);
  assert.ok(existsSync(path.join(r.out, 'cards.jsonl')), 'cards.jsonl is written before DuckDB is started');
});

const duckdb = process.env['DUCKDB_BIN'] ?? (spawnSync('duckdb', ['--version'], { windowsHide: true }).status === 0 ? 'duckdb' : undefined);

test('T1-OUTCOME-INGEST acceptance 5: run.ts prints the successor rate, the review convergence and the lead time of the fixture [R9] [R10] [R11] [R12]', { skip: duckdb === undefined ? 'no duckdb binary' : false }, () => {
  const r = runOutcome(duckdb!);
  assert.equal(r.status, 0, r.stderr);
  const views = new Map(r.stdout.trim().split('\n').map((line) => JSON.parse(line) as { view: string; rows: Row[] }).map((v) => [v.view, v.rows]));
  assert.deepEqual([...views.keys()], ['summary_lead_time', 'summary_review_convergence', 'summary_stop_reasons', 'summary_successor_rate']);
  assert.deepEqual(views.get('summary_successor_rate'), [{ card_attempts: 2, failed: 1, merged: 1, successor_rate: 0.5 }]);
  assert.deepEqual(views.get('summary_review_convergence'), [{ cards: 2, first_decision_pass_share: 0.5, two_or_more_blocks_share: 0.5, mean_decisions_to_pass: 1, stop_review_share: 0.5 }]);
  assert.deepEqual(views.get('summary_lead_time'), [
    { measure: 'lead_p50', state: null, hours: 6, n: 1 },
    { measure: 'lead_p90', state: null, hours: 6, n: 1 },
    { measure: 'state_total', state: 'BUILD', hours: 3, n: 2 },
    { measure: 'state_total', state: 'CLOSE', hours: 0.25, n: 1 },
    { measure: 'state_total', state: 'PREPARE', hours: 0.5, n: 1 },
    { measure: 'state_total', state: 'SHIP', hours: 3.5, n: 1 },
  ]);
  assert.deepEqual(views.get('summary_stop_reasons'), [{ stopReason: 'card', runs: 1 }]);
});

// Repair of R3 decision 1 (F1 to F6): absent inputs, where output may be written, the --duckdb path and the successor chain.
const emptyTables = (): Tables => ({ cards: [], card_runs: [], review_decisions: [], findings: [], state_spans: [], attempts: [], ingest_errors: [] });
const missingBin = (): string => path.join(tempDir(), 'missing-duckdb.exe');

/** `node bench/outcome/run.ts <args>` from `cwd`, in the environment of `runOutcome`. */
function spawnRun(args: string[], cwd: string = root): { status: number | null; stderr: string } {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('AIDLC_') && k.toUpperCase() !== 'NODE_OPTIONS'));
  const r = spawnSync(process.execPath, [path.join(root, 'bench', 'outcome', 'run.ts'), ...args, '--no-usage', '--no-github'], { cwd, env, encoding: 'utf8', windowsHide: true });
  return { status: r.status, stderr: r.stderr };
}

test('T1-OUTCOME-INGEST acceptance 7: an absent registry, card-run directory or journal directory is one ingest_errors row each, beside the rows of the directories that exist [R14]', () => {
  const { stateDir, cardsDir } = fixture();
  const gone = path.join(tempDir(), 'gone');
  const noState = ingestState({ stateDir: gone, cardsDir });
  assert.deepEqual(noState.ingest_errors, [
    { source: 'card_run', path: path.join(gone, 'cards'), line: null, problem: 'missing directory' },
    { source: 'journal', path: path.join(gone, 'journal'), line: null, problem: 'missing directory' },
  ]);
  assert.deepEqual(noState.cards.map((c) => c['id']), ['T1-MERGED', 'T1-STOPPED']);
  const noCards = ingestState({ stateDir, cardsDir: put(path.join(gone, 'a-file'), 'x') });
  assert.deepEqual(noCards.ingest_errors, [{ source: 'card', path: path.join(gone, 'a-file'), line: null, problem: 'missing directory' }]);
  assert.deepEqual([noCards.card_runs.length, noCards.state_spans.length, noCards.attempts.length], [3, 8, 2]);
  mkdirSync(path.join(stateDir, 'cards', 'g-empty'));
  assert.deepEqual(ingestState({ stateDir, cardsDir }).ingest_errors, [], 'a goal directory without card runs is no error');
});

test('T1-OUTCOME-INGEST acceptance 8: run.ts exits 1 and creates nothing for an --out inside the state directory or the registry, by a ..name or through a link [R15]', () => {
  const { stateDir, cardsDir } = fixture();
  const link = path.join(tempDir(), 'link');
  symlinkSync(stateDir, link, 'junction');
  const cases: [out: string, created: string][] = [
    [path.join(stateDir, '..out'), path.join(stateDir, '..out')],
    [path.join(cardsDir, '..out'), path.join(cardsDir, '..out')],
    [path.join(link, 'new', 'deeper'), path.join(stateDir, 'new')],
    [stateDir, path.join(stateDir, 'cards.jsonl')],
  ];
  for (const [out, created] of cases) {
    const r = spawnRun(['--state', stateDir, '--cards', cardsDir, '--out', out, '--duckdb', missingBin()]);
    assert.equal(r.status, 1, `${out}: ${r.stderr}`);
    assert.match(r.stderr, /refusing to write/, out);
    assert.equal(existsSync(created), false, `${created} was created`);
  }
  const beside = path.join(path.dirname(stateDir), 'state..out');
  assert.equal(spawnRun(['--state', stateDir, '--cards', cardsDir, '--out', beside, '--duckdb', missingBin()]).status, 2, 'a directory beside the state directory is written');
  assert.ok(existsSync(path.join(beside, 'cards.jsonl')));
});

test('T1-OUTCOME-INGEST acceptance 9: writeTables replaces a link at an output name and leaves the file it points to unchanged [R15]', (t) => {
  const { stateDir, cardsDir } = fixture();
  const out = tempDir();
  const [card, cardRun] = [path.join(cardsDir, 'T1-MERGED.md'), path.join(stateDir, 'cards', 'g-b', 'T1-MERGED.json')];
  const before = [readFileSync(card, 'utf8'), readFileSync(cardRun, 'utf8')];
  linkSync(card, path.join(out, 'cards.jsonl'));
  let symlinked = true;
  try {
    symlinkSync(cardRun, path.join(out, 'attempts.jsonl'), 'file');
  } catch (err) {
    // Windows refuses a file symlink without the privilege; the hard link above still runs there, and Linux never skips.
    if (process.platform !== 'win32' || (err as NodeJS.ErrnoException).code !== 'EPERM') throw err;
    symlinked = false;
    t.diagnostic('file symlink assertion skipped: no symlink privilege on this Windows account');
  }
  writeTables(ingestState({ stateDir, cardsDir }), out);
  assert.deepEqual([readFileSync(card, 'utf8'), readFileSync(cardRun, 'utf8')], before);
  assert.match(readFileSync(path.join(out, 'cards.jsonl'), 'utf8'), /^\{"id":"T1-MERGED"/);
  if (symlinked) assert.equal(lstatSync(path.join(out, 'attempts.jsonl')).isSymbolicLink(), false);
  assert.match(readFileSync(path.join(out, 'attempts.jsonl'), 'utf8'), /^\{"goalId":"g-b"/);
});

test('T1-OUTCOME-INGEST acceptance 10: run.ts starts a relative --duckdb path from the invocation directory, not from the output directory [R16]', () => {
  const { stateDir, cardsDir } = fixture();
  // Node stands in for the binary: started from its own directory it rejects the DuckDB flags, which is exit 1, not exit 2.
  const r = spawnRun(['--state', stateDir, '--cards', cardsDir, '--out', path.join(tempDir(), 'out'), '--duckdb', `.${path.sep}${path.basename(process.execPath)}`], path.dirname(process.execPath));
  assert.equal(r.status, 1, r.stderr);
  assert.doesNotMatch(r.stderr, /winget install/);
});

test('T1-OUTCOME-INGEST acceptance 11: card_family reaches the end of a chain of 60 cards, stops a cycle on the repeated id, and ends on a name the registry does not hold [R10]', { skip: duckdb === undefined ? 'no duckdb binary' : false }, () => {
  const out = tempDir();
  const cardRow = (id: string, superseded_by: string | null): Row => ({ id, status: 'todo', superseded_by, depends_on: [], tdd: true, budget: null });
  const chain = Array.from({ length: 60 }, (_, i) => cardRow(`T1-C${i}`, i < 59 ? `T1-C${i + 1}` : null));
  writeTables({ ...emptyTables(), cards: [...chain, cardRow('T1-X', 'T1-Y'), cardRow('T1-Y', 'T1-X'), cardRow('T1-SELF', 'T1-SELF'), cardRow('T1-E', 'T1-GONE')] }, out);
  const sql = readFileSync(path.join(root, 'bench', 'outcome', 'views', '10-cards.sql'), 'utf8');
  const r = spawnSync(duckdb!, ['-json', '-bail'], { cwd: out, input: `${sql}\nSELECT * FROM card_family WHERE id IN ('T1-C0', 'T1-C57', 'T1-C59', 'T1-X', 'T1-Y', 'T1-SELF', 'T1-E') ORDER BY id;\n`, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [
    { id: 'T1-C0', last_card: 'T1-C59', steps: 59 },
    { id: 'T1-C57', last_card: 'T1-C59', steps: 2 },
    { id: 'T1-C59', last_card: 'T1-C59', steps: 0 },
    { id: 'T1-E', last_card: 'T1-GONE', steps: 1 },
    { id: 'T1-SELF', last_card: 'T1-SELF', steps: 0 },
    { id: 'T1-X', last_card: 'T1-Y', steps: 1 },
    { id: 'T1-Y', last_card: 'T1-X', steps: 1 },
  ]);
});
