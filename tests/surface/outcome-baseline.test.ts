// Card T1-OUTCOME-REPORT: docs/reliability/baseline.md reports the numbers of the five committed bench/outcome files, each in a table
// row that names its file and expression and is checked against it, and CHANGELOG.md carries the goal's one entry under Unreleased.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DOC = path.join(ROOT, 'docs', 'reliability', 'baseline.md');
const OUTCOME = path.join(ROOT, 'bench', 'outcome');
const FILES = ['summary.json', 'labels.jsonl', 'labels-final.jsonl', 'adjudication.json', 'replay-main.json'] as const;
type SourceFile = (typeof FILES)[number];

const HEADINGS = [
  'Method',
  'Sources and gaps',
  'Outcome',
  'Review convergence',
  'Cost',
  'Finding labels',
  'Recall baseline',
  'Verdict instability',
  'What these numbers do not show',
];
const HEADER = '| Measure | Value | Source |';
const SEPARATOR = /^\|( *:?-+:? *\|){3}$/;
const SOURCE_CELL = /^`(summary\.json|labels\.jsonl|labels-final\.jsonl|adjudication\.json|replay-main\.json)` `([^`]*)`$/;
const VALUE_CELL = /^-?\d+(\.\d+)?%?$/;

const ENTRY =
  '- reliability-baseline-2 (cards T1-OUTCOME-FIRST-DECISION, T1-OUTCOME-LABELS-2, T1-OUTCOME-SUMMARY, T1-OUTCOME-ADJUDICATE, T1-OUTCOME-REPLAY-2 and T1-OUTCOME-REPORT, merged in place of T1-OUTCOME-BASELINE; T1-OUTCOME-LABELS-2 replaced T1-OUTCOME-LABELS and T1-OUTCOME-REPLAY-2 replaced T1-OUTCOME-REPLAY): `summary_review_convergence` (bench/outcome/views/10-cards.sql) counts a card\'s first formal decision and its decisions to a pass in date order and leaves out second passes and base-sync decisions; it counted every merge-blocking block of the card before, so a second-pass or base-sync block made a first decision that passed count as a block. `node bench/outcome/run.ts --summary <file>` writes the main checkout\'s commit, the run time, the row count of every table and the rows of every summary view once every view has run, and `bench/outcome/summary.json` is one such run on the main checkout. `bench/outcome/labels.jsonl` holds a row for each merge-blocking formal finding of a fixed selection of replaced cards, clean cards and second-pass blocks, with a label from Claude and a label from a model of another vendor where the finding\'s candidate commit could be read and a row marked left out where it could not, and `bench/outcome/labels-final.jsonl` gives each row that is not left out its final label: the common label, the owner\'s, or where the two differ the label of a third model call that saw both answers; `bench/outcome/adjudication.json` holds that adjudicator\'s agreement with the owner on a seeded sample the owner labelled blind, and the adjudicator\'s labels are not used as truth. `evals/review/replay/` holds confirmed bug cases made from the findings that both models or the owner labelled true defects, and no clean case, and `bench/outcome/replay-main.json` is the recall baseline: one bench run of the formal stage on main\'s reviewer over them and three trials of ten of them. `docs/reliability/baseline.md` reports these numbers, each with its source, and the measured gaps, with no target. No behaviour of the loop changes.';

const lines = (text: string) => text.split('\n').map((line) => line.replace(/\r$/, ''));

function docLines(): string[] {
  assert.ok(existsSync(DOC), 'docs/reliability/baseline.md exists');
  return lines(readFileSync(DOC, 'utf8'));
}

const documents = new Map<SourceFile, unknown>();
/** The JSON document of a source file; a .jsonl file is the array of its parsed non-blank lines. */
function documentOf(file: SourceFile): unknown {
  if (!documents.has(file)) {
    const text = readFileSync(path.join(OUTCOME, file), 'utf8');
    const doc = file.endsWith('.jsonl') ? lines(text).filter((line) => line.trim() !== '').map((line) => JSON.parse(line)) : JSON.parse(text);
    documents.set(file, doc);
  }
  return documents.get(file);
}

interface Expression {
  pointer: string;
  conditions: string[] | null;
  tail: string;
}

/** Splits an expression into its pointer, its filter conditions (null without a filter) and its tail. */
function parseExpression(expr: string): Expression {
  const match = /^([^[\].#]*)(?:\[([^\]]*)\])?((?:[.#].*)?)$/.exec(expr);
  if (!match) throw new Error(`expression does not parse: ${expr}`);
  const [, pointer = '', filter, tail = ''] = match;
  const conditions = filter === undefined ? null : filter.split(',').map((c) => c.trim()).filter((c) => c !== '');
  return { pointer, conditions, tail };
}

/** The expression with spaces around its conditions removed, so that two spellings of one expression compare equal. */
function canonical(expr: string): string {
  const { pointer, conditions, tail } = parseExpression(expr);
  return `${pointer}${conditions === null ? '' : `[${conditions.join(',')}]`}${tail}`;
}

function resolvePointer(doc: unknown, pointer: string): unknown {
  if (pointer === '') return doc;
  if (!pointer.startsWith('/')) throw new Error(`pointer does not start with /: ${pointer}`);
  let at: unknown = doc;
  for (const raw of pointer.slice(1).split('/')) {
    const token = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(at)) {
      if (!/^(0|[1-9]\d*)$/.test(token) || Number(token) >= at.length) throw new Error(`pointer ${pointer} does not resolve at ${token}`);
      at = at[Number(token)];
    } else if (at !== null && typeof at === 'object' && Object.hasOwn(at, token)) {
      at = (at as Record<string, unknown>)[token];
    } else {
      throw new Error(`pointer ${pointer} does not resolve at ${token}`);
    }
  }
  return at;
}

function holds(element: Record<string, unknown>, condition: string): boolean {
  const eq = condition.indexOf('=');
  if (eq < 1) throw new Error(`condition does not parse: ${condition}`);
  const field = condition.slice(0, eq);
  const value = condition.slice(eq + 1);
  const actual = element[field];
  if (value === 'null') return actual === null || actual === undefined;
  if (value.startsWith('$')) return actual === element[value.slice(1)];
  return String(actual) === value;
}

/** The source value of an expression in a file, by body section Source expressions of the card. */
function resolve(file: SourceFile, expr: string): number | null {
  const { pointer, conditions, tail } = parseExpression(expr);
  if (file.endsWith('.jsonl') && pointer !== '') throw new Error(`a ${file} expression has no pointer: ${expr}`);
  const at = resolvePointer(documentOf(file), pointer);
  if (at === null || typeof at === 'number') {
    if (conditions !== null || tail !== '') throw new Error(`a filter or tail on a number or null: ${expr}`);
    return at;
  }
  if (!Array.isArray(at)) throw new Error(`the pointer of ${expr} is neither a number, null nor an array`);
  const kept = (at as Record<string, unknown>[]).filter((el) => (conditions ?? []).every((c) => holds(el, c)));
  if (tail === '') return kept.length;
  const column = tail.slice(1);
  if (tail.startsWith('#')) return new Set(kept.map((el) => JSON.stringify(el[column]))).size;
  if (kept.length === 0) throw new Error(`a sum over no element: ${expr}`);
  let sum: number | null = null;
  for (const el of kept) {
    const v = el[column];
    if (v === null) continue;
    if (typeof v !== 'number') throw new Error(`a sum over a value that is not a number: ${expr}`);
    sum = (sum ?? 0) + v;
  }
  return sum;
}

interface Row {
  line: string;
  measure: string;
  value: string;
  file: SourceFile;
  expr: string;
}

/** Every table line of the document; throws on a line that is neither header, separator nor a source row. */
function tableRows(doc: string[]): { rows: Row[]; problems: string[] } {
  const rows: Row[] = [];
  const problems: string[] = [];
  doc.forEach((line, i) => {
    if (!line.startsWith('|')) return;
    const previous = doc[i - 1] ?? '';
    if (!previous.startsWith('|') && line !== HEADER) problems.push(`a table starts without the header: ${line}`);
    if (line === HEADER) {
      if (!SEPARATOR.test(doc[i + 1] ?? '')) problems.push(`the header is not followed by a separator row: ${line}`);
      return;
    }
    if (SEPARATOR.test(line)) {
      if (previous !== HEADER) problems.push(`a separator row does not follow the header: ${line}`);
      return;
    }
    if (!line.endsWith('|')) return void problems.push(`a row does not end with |: ${line}`);
    const cells = line.slice(1, -1).split('|').map((cell) => cell.trim());
    if (cells.length !== 3) return void problems.push(`a row does not have three cells: ${line}`);
    const source = SOURCE_CELL.exec(cells[2] ?? '');
    if (!source) return void problems.push(`a source cell does not name a file and an expression: ${line}`);
    rows.push({ line, measure: cells[0] ?? '', value: cells[1] ?? '', file: source[1] as SourceFile, expr: source[2] ?? '' });
  });
  return { rows, problems };
}

/** Why a row's value cell does not equal its source value by R2, or null when it does. */
function valueMismatch(row: Row): string | null {
  let source: number | null;
  try {
    source = resolve(row.file, row.expr);
  } catch (error) {
    return `${(error as Error).message}: ${row.line}`;
  }
  if (row.value === 'null') return source === null ? null : `null against ${source}: ${row.line}`;
  if (!VALUE_CELL.test(row.value)) return `the value cell is not a decimal number: ${row.line}`;
  if (typeof source !== 'number') return `the source value is not a number: ${row.line}`;
  const percent = row.value.endsWith('%');
  const shown = percent ? row.value.slice(0, -1) : row.value;
  const places = shown.includes('.') ? shown.length - shown.indexOf('.') - 1 : 0;
  const expected = percent ? source * 100 : source;
  const diff = Math.abs(Number(shown) - expected);
  return diff <= 0.5 * 10 ** -places + 1e-9 ? null : `${row.value} differs from ${expected}: ${row.line}`;
}

function groupsOf(): string[] {
  const rows = documentOf('labels.jsonl') as { group: string }[];
  return [...new Set(rows.map((row) => row.group))];
}

const REQUIRED: Record<SourceFile, () => string[]> = {
  'summary.json': () => [
    ...['cards', 'first_decision_pass_share', 'mean_decisions_to_pass', 'two_or_more_blocks_share', 'stop_review_share'].map(
      (column) => `/views/summary_review_convergence/0/${column}`,
    ),
    ...['card_attempts', 'failed', 'successor_rate'].map((column) => `/views/summary_successor_rate/0/${column}`),
    ...['accepted', 'pr_success_rate', 'accepted_strict', 'pr_success_rate_strict'].map((column) => `/views/summary_pr_success/0/${column}`),
    '/views/summary_lead_time[measure=lead_p50].hours',
    '/views/summary_lead_time[measure=lead_p90].hours',
    '/views/summary_lead_time_pr/0/p50_hours',
    '/views/summary_lead_time_pr/0/p90_hours',
    '/views/summary_ci/0/rerun_share',
    '/views/summary_ci/0/first_attempt_failed_share',
    '/views/summary_cost_by_stage[cards=merged].cost_usd',
    '/views/summary_cost_by_stage[cards=superseded].cost_usd',
    '/views/summary_superseded_spend/0/cost_usd',
    '/views/summary_cost_per_card/0/p50_usd',
    '/views/summary_cost_per_card/0/p90_usd',
    '/views/summary_unattributed[measure=unattributed].requests',
    '/views/summary_unattributed[measure=unattributed].token_share',
    '/views/summary_unattributed[measure=unpriced].requests',
    '/views/summary_cost_by_stage.cost_usd',
    '/tables/ingest_errors',
    '/tables/usage_errors',
    '/tables/github_errors',
  ],
  'labels.jsonl': () => [
    '[]',
    '#cardId',
    '[left=null,labelA=$labelB]',
    '[ownerRuled=true]',
    '[final=null]',
    '[final=true-defect]',
    '[final=out-of-card-scope]',
    '[final=speculative]',
    '[final=reviewer-misread]',
    '[final=ambiguous-card]',
    ...groupsOf().flatMap((g) => [`[group=${g}]`, `[group=${g}]#cardId`]),
  ],
  'labels-final.jsonl': () => [
    '[source=agreed]',
    '[source=owner]',
    '[source=adjudicator]',
    '[source=null]',
    '[source=agreed,final=true-defect]',
    '[source=owner,final=true-defect]',
    '[source=owner,final=$labelB]',
    '[source=adjudicator,final=true-defect]',
    '[source=adjudicator,final=out-of-card-scope]',
    '[source=adjudicator,final=speculative]',
    '[source=adjudicator,final=reviewer-misread]',
    '[source=adjudicator,final=ambiguous-card]',
  ],
  'adjudication.json': () => ['/adjudicated', '/spotCheck/sample', '/spotCheck/agree', '/spotCheck/errorRate', '/spendUsd'],
  'replay-main.json': () => [
    '/run/cases',
    '/run/totals/hits',
    '/run/totals/misses',
    '/run/totals/recall',
    '/run/totals/noVerdict',
    '/trials[verdictAgree=true]',
    '/trials[agree=true]',
    '/leftOut/trueDefectWithoutCase',
    '/leftOut/candidateGone',
  ],
};

test('T1-OUTCOME-REPORT acceptance 1: baseline.md has the title, the nine headings in order and no banned character', () => {
  const doc = docLines();
  assert.equal(doc[0], '# Reliability baseline');
  assert.deepEqual(
    doc.filter((line) => line.startsWith('## ')),
    HEADINGS.map((h) => `## ${h}`),
  );
  assert.deepEqual(
    doc.flatMap((line, i) => (/[—「」]/.test(line) ? [i + 1] : [])),
    [],
    'no em dash and no corner bracket',
  );
});

test('T1-OUTCOME-REPORT acceptance 2: every table row of baseline.md names its source and its value equals it', () => {
  const { rows, problems } = tableRows(docLines());
  assert.deepEqual(problems, [], 'every table line is the header, its separator or a source row');
  const mismatches = rows.map(valueMismatch).filter((m) => m !== null);
  assert.deepEqual(mismatches, [], 'every value equals its source value');
  assert.deepEqual(
    FILES.filter((file) => !rows.some((row) => row.file === file)),
    [],
    'each of the five files is the source of a row',
  );
});

test('T1-OUTCOME-REPORT acceptance 3: baseline.md holds the required rows, names the commit, date and command of the run and says the adjudicator\'s labels are not used as truth', () => {
  const doc = docLines();
  const { rows } = tableRows(doc);
  const missing = FILES.flatMap((file) => {
    const present = new Set(rows.filter((row) => row.file === file).map((row) => canonical(row.expr)));
    return REQUIRED[file]()
      .filter((expr) => !present.has(canonical(expr)))
      .map((expr) => `${file} ${expr}`);
  });
  assert.deepEqual(missing, [], 'each required expression is the source of a row');
  assert.deepEqual(
    rows.filter((row) => row.file === 'labels-final.jsonl' && row.expr.includes('final=') && !row.expr.includes('source=')).map((row) => row.line),
    [],
    'no labels-final.jsonl row filters on final without source',
  );
  assert.deepEqual(
    rows.filter((row) => row.file === 'replay-main.json' && /clean|falseBlock/.test(row.expr)).map((row) => row.line),
    [],
    'no replay-main.json row reads a clean-case or false-block figure',
  );
  const summary = documentOf('summary.json') as { commit: string; ranAt: string };
  const text = doc.join('\n');
  assert.ok(text.includes(summary.commit), 'the commit of summary.json');
  assert.ok(text.includes(summary.ranAt.slice(0, 10)), 'the date of the run');
  assert.ok(text.includes('run.ts --summary'), 'the command that wrote summary.json');
  const from = doc.indexOf('## Finding labels');
  assert.ok(from >= 0, 'the Finding labels section exists');
  const next = doc.findIndex((line, i) => i > from && line.startsWith('## '));
  const section = doc.slice(from + 1, next === -1 ? undefined : next).join('\n');
  assert.ok(section.includes('not used as truth'), 'Finding labels says the adjudicator\'s labels are not used as truth');
});

test('T1-OUTCOME-REPORT acceptance 4: CHANGELOG.md carries the goal entry once, between the Unreleased heading and the next heading', () => {
  const log = lines(readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'));
  assert.equal(log.filter((line) => line === '## Unreleased').length, 1, 'one Unreleased heading');
  assert.equal(log.filter((line) => line === ENTRY).length, 1, 'the entry stands once');
  const unreleased = log.indexOf('## Unreleased');
  const next = log.findIndex((line, i) => i > unreleased && line.startsWith('## '));
  assert.ok(next > unreleased, 'a heading follows Unreleased');
  const at = log.indexOf(ENTRY);
  assert.ok(at > unreleased && at < next, 'the entry stands within the Unreleased section');
  assert.deepEqual([log[at - 1], log[at + 1]], ['', ''], 'a blank line directly before and after the entry');
});
