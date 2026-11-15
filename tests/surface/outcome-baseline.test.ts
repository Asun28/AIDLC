// Card T1-OUTCOME-REPORT: docs/reliability/baseline.md reports the numbers of the five committed bench/outcome files, each in a table
// row that names its file and expression and is checked against it, and CHANGELOG.md carries the goal's one entry under Unreleased.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DOC = path.join(ROOT, 'docs', 'reliability', 'baseline.md');
const FILES = ['summary.json', 'labels.jsonl', 'labels-final.jsonl', 'adjudication.json', 'replay-main.json'] as const;
type SourceFile = (typeof FILES)[number];
const HEADINGS = ['Method', 'Sources and gaps', 'Outcome', 'Review convergence', 'Cost', 'Finding labels', 'Recall baseline',
  'Verdict instability', 'What these numbers do not show'];
const HEADER = '| Measure | Value | Source |';
const SEPARATOR = /^\|( *:?-+:? *\|){3}$/;
const SOURCE_CELL = /^`(summary\.json|labels\.jsonl|labels-final\.jsonl|adjudication\.json|replay-main\.json)` `([^`]*)`$/;
const ENTRY =
  "- reliability-baseline-2 (cards T1-OUTCOME-FIRST-DECISION, T1-OUTCOME-LABELS-2, T1-OUTCOME-SUMMARY, T1-OUTCOME-ADJUDICATE, T1-OUTCOME-REPLAY-2 and T1-OUTCOME-REPORT, merged in place of T1-OUTCOME-BASELINE; T1-OUTCOME-LABELS-2 replaced T1-OUTCOME-LABELS and T1-OUTCOME-REPLAY-2 replaced T1-OUTCOME-REPLAY): `summary_review_convergence` (bench/outcome/views/10-cards.sql) counts a card's first formal decision and its decisions to a pass in date order and leaves out second passes and base-sync decisions; it counted every merge-blocking block of the card before, so a second-pass or base-sync block made a first decision that passed count as a block. `node bench/outcome/run.ts --summary <file>` writes the main checkout's commit, the run time, the row count of every table and the rows of every summary view once every view has run, and `bench/outcome/summary.json` is one such run on the main checkout. `bench/outcome/labels.jsonl` holds a row for each merge-blocking formal finding of a fixed selection of replaced cards, clean cards and second-pass blocks, with a label from Claude and a label from a model of another vendor where the finding's candidate commit could be read and a row marked left out where it could not, and `bench/outcome/labels-final.jsonl` gives each row that is not left out its final label: the common label, the owner's, or where the two differ the label of a third model call that saw both answers; `bench/outcome/adjudication.json` holds that adjudicator's agreement with the owner on a seeded sample the owner labelled blind, and the adjudicator's labels are not used as truth. `evals/review/replay/` holds confirmed bug cases made from the findings that both models or the owner labelled true defects, and no clean case, and `bench/outcome/replay-main.json` is the recall baseline: one bench run of the formal stage on main's reviewer over them and three trials of ten of them. `docs/reliability/baseline.md` reports these numbers, each with its source, and the measured gaps, with no target. No behaviour of the loop changes.";

const lines = (text: string) => text.split('\n').map((line) => line.replace(/\r$/, ''));
function docLines(): string[] {
  assert.ok(existsSync(DOC), 'docs/reliability/baseline.md exists');
  return lines(readFileSync(DOC, 'utf8'));
}
/** The JSON document of a source file; a .jsonl file is the array of its parsed non-blank lines. */
function documentOf(file: SourceFile): unknown {
  const text = readFileSync(path.join(ROOT, 'bench', 'outcome', file), 'utf8');
  return file.endsWith('.jsonl') ? lines(text).filter((l) => l.trim() !== '').map((l) => JSON.parse(l)) : JSON.parse(text);
}

/** The source value of an expression (pointer, optional filter, optional tail), by body section Source expressions of the card. */
function resolve(file: SourceFile, expr: string): number | null {
  const parts = /^([^[\].#]*)(?:\[([^\]]*)\])?((?:[.#].*)?)$/.exec(expr);
  if (!parts) throw new Error('the expression does not parse');
  const [, pointer = '', filter, tail = ''] = parts;
  if (file.endsWith('.jsonl') && pointer !== '') throw new Error(`a ${file} expression has no pointer`);
  if (pointer !== '' && !pointer.startsWith('/')) throw new Error('the pointer does not start with /');
  let at: unknown = documentOf(file);
  for (const raw of pointer === '' ? [] : pointer.slice(1).split('/')) {
    const token = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    const ok = Array.isArray(at) ? /^(0|[1-9]\d*)$/.test(token) && Number(token) < at.length : at !== null && typeof at === 'object' && Object.hasOwn(at, token);
    if (!ok) throw new Error(`the pointer does not resolve at ${token}`);
    at = (at as Record<string, unknown>)[token];
  }
  if (at === null || typeof at === 'number') {
    if (filter !== undefined || tail !== '') throw new Error('a filter or tail on a number or null');
    return at;
  }
  if (!Array.isArray(at)) throw new Error('the pointer names neither a number, null nor an array');
  const conditions = (filter ?? '').split(',').map((c) => c.trim()).filter((c) => c !== '');
  const kept = (at as Record<string, unknown>[]).filter((el) => conditions.every((c) => {
    const eq = c.indexOf('=');
    if (eq < 1) throw new Error(`the condition ${c} does not parse`);
    const [field, v] = [c.slice(0, eq), c.slice(eq + 1)];
    if (v === 'null') return el[field] === null || el[field] === undefined;
    return v.startsWith('$') ? el[field] === el[v.slice(1)] : String(el[field]) === v;
  }));
  if (tail === '') return kept.length;
  const column = tail.slice(1);
  if (tail.startsWith('#')) return new Set(kept.map((el) => JSON.stringify(el[column]))).size;
  if (kept.length === 0) throw new Error('a sum over no element');
  const values = kept.map((el) => el[column]);
  if (values.some((v) => v !== null && typeof v !== 'number')) throw new Error('a sum over a value that is not a number');
  const numbers = values.filter((v): v is number => typeof v === 'number');
  return numbers.length === 0 ? null : numbers.reduce((a, b) => a + b, 0);
}

interface Row { line: string; value: string; file: SourceFile; expr: string }
/** The source rows of the document's tables, and every table line that is neither the header, its separator nor a source row. */
function tableRows(doc: string[]): { rows: Row[]; bad: string[] } {
  const rows: Row[] = [];
  const bad: string[] = [];
  for (const line of doc.filter((l) => l.startsWith('|') && l !== HEADER && !SEPARATOR.test(l))) {
    const cells = line.endsWith('|') ? line.slice(1, -1).split('|').map((cell) => cell.trim()) : [];
    const source = cells.length === 3 ? SOURCE_CELL.exec(cells[2] ?? '') : null;
    if (source) rows.push({ line, value: cells[1] ?? '', file: source[1] as SourceFile, expr: source[2] ?? '' });
    else bad.push(line);
  }
  return { rows, bad };
}
/** Why a row's value does not equal its source value by R2, or null when it does. */
function mismatch(row: Row): string | null {
  let source: number | null;
  try {
    source = resolve(row.file, row.expr);
  } catch (error) {
    return `${(error as Error).message}: ${row.line}`;
  }
  if (row.value === 'null') return source === null ? null : `null is not ${source}: ${row.line}`;
  if (!/^-?\d+(\.\d+)?%?$/.test(row.value) || typeof source !== 'number') return `not a decimal number or no number at the source: ${row.line}`;
  const shown = row.value.replace(/%$/, '');
  const places = shown.includes('.') ? shown.length - shown.indexOf('.') - 1 : 0;
  const expected = row.value.endsWith('%') ? source * 100 : source;
  return Math.abs(Number(shown) - expected) <= 0.5 * 10 ** -places + 1e-9 ? null : `${row.value} is not ${expected}: ${row.line}`;
}

const LABELS = ['true-defect', 'out-of-card-scope', 'speculative', 'reviewer-misread', 'ambiguous-card'];
const REQUIRED: Record<SourceFile, () => string[]> = {
  'summary.json': () => [
    ...'cards first_decision_pass_share mean_decisions_to_pass two_or_more_blocks_share stop_review_share'.split(' ').map((c) => `/views/summary_review_convergence/0/${c}`),
    ...'card_attempts failed successor_rate'.split(' ').map((c) => `/views/summary_successor_rate/0/${c}`),
    ...'accepted pr_success_rate accepted_strict pr_success_rate_strict'.split(' ').map((c) => `/views/summary_pr_success/0/${c}`),
    ...`/views/summary_lead_time[measure=lead_p50].hours /views/summary_lead_time[measure=lead_p90].hours /views/summary_lead_time_pr/0/p50_hours
      /views/summary_lead_time_pr/0/p90_hours /views/summary_ci/0/rerun_share /views/summary_ci/0/first_attempt_failed_share
      /views/summary_cost_by_stage[cards=merged].cost_usd /views/summary_cost_by_stage[cards=superseded].cost_usd /views/summary_superseded_spend/0/cost_usd
      /views/summary_cost_per_card/0/p50_usd /views/summary_cost_per_card/0/p90_usd /views/summary_unattributed[measure=unattributed].requests
      /views/summary_unattributed[measure=unattributed].token_share /views/summary_unattributed[measure=unpriced].requests
      /views/summary_cost_by_stage.cost_usd /tables/ingest_errors /tables/usage_errors /tables/github_errors`.split(/\s+/),
  ],
  'labels.jsonl': () => [
    ...'[] #cardId [left=null,labelA=$labelB] [ownerRuled=true] [final=null]'.split(' '),
    ...LABELS.map((l) => `[final=${l}]`),
    ...[...new Set((documentOf('labels.jsonl') as { group: string }[]).map((r) => r.group))].flatMap((g) => [`[group=${g}]`, `[group=${g}]#cardId`]),
  ],
  'labels-final.jsonl': () => [
    ...'[source=agreed] [source=owner] [source=adjudicator] [source=null] [source=agreed,final=true-defect] [source=owner,final=true-defect]'.split(' '),
    '[source=owner,final=$labelB]',
    ...LABELS.map((l) => `[source=adjudicator,final=${l}]`),
  ],
  'adjudication.json': () => '/adjudicated /spotCheck/sample /spotCheck/agree /spotCheck/errorRate /spendUsd'.split(' '),
  'replay-main.json': () => `/run/cases /run/totals/hits /run/totals/misses /run/totals/recall /run/totals/noVerdict /trials[verdictAgree=true]
    /trials[agree=true] /leftOut/trueDefectWithoutCase /leftOut/candidateGone`.split(/\s+/),
};

test('T1-OUTCOME-REPORT acceptance 1: baseline.md has the title, the nine headings in order and no banned character', () => {
  const doc = docLines();
  assert.equal(doc[0], '# Reliability baseline');
  assert.deepEqual(doc.filter((line) => line.startsWith('## ')), HEADINGS.map((h) => `## ${h}`));
  assert.deepEqual(doc.filter((line) => /[—「」]/.test(line)), [], 'no em dash and no corner bracket');
});

test('T1-OUTCOME-REPORT acceptance 2: every table row of baseline.md names its source and its value equals it', () => {
  const { rows, bad } = tableRows(docLines());
  assert.deepEqual(bad, [], 'every table line is the header, its separator or a row naming its source');
  assert.deepEqual(rows.map(mismatch).filter((m) => m !== null), [], 'every value equals its source value');
  assert.deepEqual(FILES.filter((file) => !rows.some((row) => row.file === file)), [], 'each of the five files is the source of a row');
});

test("T1-OUTCOME-REPORT acceptance 3: baseline.md holds the required rows, names the commit, date and command of the run and says the adjudicator's labels are not used as truth", () => {
  const doc = docLines();
  const { rows } = tableRows(doc);
  const missing = FILES.flatMap((file) => REQUIRED[file]().filter((expr) => !rows.some((r) => r.file === file && r.expr === expr)).map((e) => `${file} ${e}`));
  assert.deepEqual(missing, [], 'each required expression is the source of a row');
  const finalWithoutSource = rows.filter((r) => r.file === 'labels-final.jsonl' && r.expr.includes('final=') && !r.expr.includes('source='));
  assert.deepEqual(finalWithoutSource.map((r) => r.line), [], 'no labels-final.jsonl row filters on final without source');
  const cleanRows = rows.filter((r) => r.file === 'replay-main.json' && /clean|falseBlock/.test(r.expr));
  assert.deepEqual(cleanRows.map((r) => r.line), [], 'no replay-main.json row reads a clean-case or false-block figure');
  const summary = documentOf('summary.json') as { commit: string; ranAt: string };
  const text = doc.join('\n');
  assert.deepEqual([summary.commit, summary.ranAt.slice(0, 10), 'run.ts --summary'].filter((s) => !text.includes(s)), [], 'commit, date and command');
  const from = doc.indexOf('## Finding labels');
  const next = doc.findIndex((line, i) => i > from && line.startsWith('## '));
  assert.ok(from >= 0 && doc.slice(from + 1, next === -1 ? undefined : next).join('\n').includes('not used as truth'), 'Finding labels: not used as truth');
});

test('T1-OUTCOME-REPORT acceptance 4: CHANGELOG.md carries the goal entry once, between the Unreleased heading and the next heading', () => {
  const log = lines(readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'));
  assert.equal(log.filter((line) => line === '## Unreleased').length, 1, 'one Unreleased heading');
  assert.equal(log.filter((line) => line === ENTRY).length, 1, 'the entry stands once');
  const [unreleased, at] = [log.indexOf('## Unreleased'), log.indexOf(ENTRY)];
  const next = log.findIndex((line, i) => i > unreleased && line.startsWith('## '));
  assert.ok(next > unreleased && at > unreleased && at < next, 'the entry stands between Unreleased and the next heading');
  assert.deepEqual([log[at - 1], log[at + 1]], ['', ''], 'a blank line directly before and after the entry');
});
