// node bench/outcome/replay.ts cases|assemble (card T1-OUTCOME-REPLAY): the recall baseline in evals/review/replay/ and bench/outcome/replay-main.json.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCardText } from '../../src/artifacts/card.ts';
import { loadProjectConfig } from '../../src/config.ts';
import { ReviewBenchCase } from '../../src/core/types.ts';
import { runSync } from '../../src/probes/exec.ts';
import { compareBenchReports, loadBenchCases } from '../../src/review/bench.ts';
import { collectCandidateDiff } from '../../src/review/pre-review.ts';
import type { FinalRow } from './adjudicate.ts';

export const AGREED = 'two-model label agreement in bench/outcome/labels.jsonl under the owner\'s rule of 2026-11-14; no person checked this case';
export const OWNER = 'the owner\'s label in the spot check of bench/outcome/labels-spotcheck.jsonl; no person checked this case';
export interface Counts { cases: number; candidates: number; triples: number; reviews: number; spendUsd: number; withoutDraft: number; notScorable: number; adjudicator: number; left: number }
export interface Plan { write: ReviewBenchCase[]; remove: string[]; counts: Counts; stop?: string }
export interface TrialCase { id: string; outcome: string; detail?: string; verdictRef?: string }
export interface Report { stage: string; policyHash: string; leftCheckouts: string[]; trialResults: Array<{ cases: TrialCase[] }> }
export interface TrialEntry { case: string; outcomes: string[]; agree: boolean; verdicts: string[]; verdictAgree: boolean; report: Report }
export type ReadDoc = (ref: string) => string | undefined;
export interface AssembleInput { status: string; head: string; run: string | undefined; trials: Record<string, string>; cases: ReviewBenchCase[]; rows: FinalRow[]; hasCommit: (sha: string) => boolean; readDoc: ReadDoc; selfCheck: (file: string) => void }

const TRIAL_REVIEWS = 30;
const QUOTA_STOP = 'not reviewed: a quota hold stopped the run';
const idOf = (r: FinalRow): string => `${r.cardId}.${r.goalId}.${r.findingId}`;
const qualifies = (r: FinalRow): boolean => (r.source === 'agreed' || r.source === 'owner') && r.final === 'true-defect';
const same = (xs: string[]): boolean => xs.every((x) => x === xs[0]);
const docOutcome = (readDoc: ReadDoc, ref: string | undefined): unknown => { try { const t = ref === undefined ? undefined : readDoc(ref); return t === undefined ? undefined : (JSON.parse(t) as { outcome?: unknown }).outcome; } catch { return undefined; } };

export function planReplay({ rows, drafts, scorable }: { rows: FinalRow[]; drafts: ReviewBenchCase[]; scorable: (c: ReviewBenchCase) => boolean }): Plan {
  const open = rows.find((r) => r.final === null && r.left === null);
  if (open) throw new Error(`row ${idOf(open)} has neither a final label nor a cause to be left out`);
  const done = drafts.find((d) => d.confirmed);
  if (done) throw new Error(`case ${done.id} is already confirmed`);
  const byId = new Map(rows.filter(qualifies).map((r) => [idOf(r), r]));
  const [write, remove] = [[] as ReviewBenchCase[], [] as string[]];
  let notScorable = 0;
  for (const d of drafts) {
    const r = d.kind === 'bug' ? byId.get(d.id) : undefined;
    const ok = r !== undefined && scorable(d);
    if (r && !ok) notScorable += 1;
    if (ok) write.push({ ...d, confirmed: true, confirmedBy: r.source === 'owner' ? OWNER : AGREED });
    else remove.push(d.id);
  }
  const ids = new Set(drafts.map((d) => d.id));
  const candidates = new Set(write.map((c) => c.candidate)).size, triples = new Set(write.map((c) => `${c.candidate} ${c.base} ${c.card.path}`)).size;
  const counts: Counts = { cases: write.length, candidates, triples, reviews: triples + TRIAL_REVIEWS, spendUsd: Math.round((triples + TRIAL_REVIEWS) * 140) / 100, withoutDraft: [...byId.keys()].filter((id) => !ids.has(id)).length, notScorable, adjudicator: rows.filter((r) => r.source === 'adjudicator').length, left: rows.filter((r) => r.left !== null).length };
  if (candidates < 10) return { write: [], remove: [], counts, stop: `the bug cases lie on ${candidates} distinct candidates, fewer than ten` };
  return { write, remove, counts };
}

export function trialCases(cases: ReviewBenchCase[]): ReviewBenchCase[] {
  const hash = (c: ReviewBenchCase): string => createHash('sha256').update(c.id, 'utf8').digest('hex');
  const seen = new Set<string>();
  return cases.filter((c) => c.kind === 'bug').map((c) => ({ c, h: hash(c) })).sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0)).map((x) => x.c)
    .filter((c) => !seen.has(c.candidate) && Boolean(seen.add(c.candidate))).slice(0, 10);
}

export function trialEntry(id: string, report: Report, readDoc: ReadDoc): TrialEntry {
  const results = report.trialResults.map((t) => t.cases.find((c) => c.id === id) ?? { id, outcome: 'absent' });
  const verdicts = results.map((c) => {
    if (c.outcome === 'hit') return 'block';
    if (c.outcome === 'no-verdict') return 'no-verdict';
    const doc = c.outcome === 'miss' ? docOutcome(readDoc, c.verdictRef) : undefined;
    if (doc === 'pass' || doc === 'block') return doc;
    throw new Error(`case ${id}: outcome ${c.outcome}${c.outcome === 'miss' ? ` with no retained verdict of pass or block at ${c.verdictRef}` : ''}`);
  });
  const outcomes = results.map((c) => c.outcome);
  return { case: id, outcomes, agree: same(outcomes), verdicts, verdictAgree: same(verdicts), report };
}

/** The refusal of a report, or undefined when it may be kept. */
function refuseReport(name: string, r: Report, readDoc: ReadDoc): string | undefined {
  if (r.stage !== 'formal' || r.leftCheckouts.length) return `${name}: stage ${r.stage} or checkouts left behind`;
  for (const c of r.trialResults.flatMap((t) => t.cases)) {
    if (c.outcome === 'error' || c.detail === QUOTA_STOP) return `${name}: case ${c.id} is an error or was not reviewed after a quota hold`;
    const doc = c.outcome === 'no-verdict' ? docOutcome(readDoc, c.verdictRef) : 'none';
    if (doc === undefined || doc === 'quota-hold') return `${name}: no-verdict case ${c.id} has no readable document or met a quota hold`;
  }
  return undefined;
}

export function assembleReplay(input: AssembleInput, write: (text: string) => void): { refusal: string } | undefined {
  const refuse = (refusal: string) => ({ refusal });
  if (input.status.trim()) return refuse(`tracked changes: ${input.status.trim()}`);
  const ids = trialCases(input.cases).map((c) => c.id);
  if (input.run === undefined) return refuse('run.json is missing');
  if (JSON.stringify(Object.keys(input.trials).sort()) !== JSON.stringify([...ids].sort())) return refuse(`trial reports ${Object.keys(input.trials).join(', ')} are not those of ${ids.join(', ')}`);
  const reports: Array<[string, Report]> = [];
  for (const [name, text] of [['run.json', input.run], ...ids.map((id) => [`trials/${id}.json`, input.trials[id]!])] as Array<[string, string]>) {
    try { reports.push([name, JSON.parse(text) as Report]); input.selfCheck(name); } catch (err) { return refuse(`${name}: ${(err as Error).message}`); }
    const why = refuseReport(name, reports.at(-1)![1], input.readDoc);
    if (why) return refuse(why);
  }
  const run = reports[0]![1], trials = reports.slice(1).map((r) => r[1]);
  const caseIds = (r: Report, i = 0): string => r.trialResults[i]!.cases.map((c) => c.id).sort().join();
  if (run.trialResults.length !== 1 || caseIds(run) !== input.cases.map((c) => c.id).sort().join()) return refuse('run.json is not one trial over the cases');
  if (trials.some((r, i) => r.trialResults.length !== 3 || [0, 1, 2].some((t) => caseIds(r, t) !== ids[i]))) return refuse('a trial report is not three trials of its one case');
  if (!same(reports.map((r) => r[1].policyHash))) return refuse('the reports differ in policyHash');
  let entries: TrialEntry[];
  try { entries = ids.map((id, i) => trialEntry(id, trials[i]!, input.readDoc)); } catch (err) { return refuse((err as Error).message); }
  const caseSet = new Set(input.cases.map((c) => c.id));
  const leftOut = { candidateGone: input.rows.filter((r) => r.candidate === null || !input.hasCommit(r.candidate)).length, trueDefectWithoutCase: input.rows.filter((r) => qualifies(r) && !caseSet.has(idOf(r))).length };
  write(`${JSON.stringify({ commit: input.head, policyHash: run.policyHash, run, trials: entries, leftOut }, null, 2)}\n`);
  return undefined;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const git = (args: string[]) => runSync('git', args, { cwd: root });
const fail = (code: number, message: string): number => (process.stderr.write(`replay: ${message}\n`), code);

function scorable(c: ReviewBenchCase, maxBytes: number): boolean {
  const card = git(['cat-file', '-p', `${c.candidate}:${c.card.path}`]);
  const parsed = card.exitCode === 0 ? parseCardText(card.stdout) : undefined;
  if (!parsed || 'error' in parsed || parsed.card.id !== c.card.id) return false;
  try { const { diff, changedPaths } = collectCandidateDiff(runSync, root, c.base, maxBytes, c.candidate, 'formalReview.maxDiffBytes'); return diff.trim() !== '' && (c.kind !== 'bug' || c.expected.every((e) => changedPaths.includes(e.file))); } catch { return false; }
}

function main(mode: string | undefined): number {
  const [dir, out] = [path.join(root, 'evals', 'review', 'replay'), path.join(root, '_local', 'outcome', 'replay')];
  const rows = readFileSync(path.join(here, 'labels-final.jsonl'), 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as FinalRow);
  const cases = loadBenchCases(dir);
  if (mode === 'cases') {
    const maxBytes = loadProjectConfig(root).config.formalReview.maxDiffBytes;
    const plan = planReplay({ rows, drafts: cases, scorable: (c) => scorable(c, maxBytes) });
    const k = plan.counts;
    process.stderr.write(`bug cases ${k.cases}, distinct candidates ${k.candidates}, candidate-base-card triples ${k.triples}, reviews ${k.reviews} (${k.triples} of the run and ${TRIAL_REVIEWS} of the trials) at 1.4 USD each: ${k.spendUsd.toFixed(2)} USD; qualifying rows with no draft ${k.withoutDraft}, qualifying drafts not scorable ${k.notScorable}, adjudicator rows ${k.adjudicator}, rows left out ${k.left}\n`);
    if (plan.stop) return fail(3, `preflight stop: ${plan.stop}`);
    for (const c of plan.write) writeFileSync(path.join(dir, `${c.id}.json`), `${JSON.stringify(ReviewBenchCase.parse(c), null, 2)}\n`);
    for (const id of plan.remove) rmSync(path.join(dir, `${id}.json`));
    return 0;
  }
  if (mode !== 'assemble') return fail(1, 'usage: node bench/outcome/replay.ts cases|assemble');
  const read = (file: string): string | undefined => (existsSync(file) ? readFileSync(file, 'utf8') : undefined);
  const names = existsSync(path.join(out, 'trials')) ? readdirSync(path.join(out, 'trials')).filter((n) => n.endsWith('.json')) : [];
  const trials = Object.fromEntries(names.map((n) => [n.slice(0, -'.json'.length), read(path.join(out, 'trials', n))!]));
  const status = git(['status', '--porcelain', '--untracked-files=no']), head = git(['rev-parse', 'HEAD']);
  if (status.exitCode !== 0 || head.exitCode !== 0) return fail(1, 'git status or git rev-parse failed');
  const result = assembleReplay({ status: status.stdout, head: head.stdout.trim(), run: read(path.join(out, 'run.json')), trials, cases, rows, hasCommit: (sha) => git(['cat-file', '-e', `${sha}^{commit}`]).exitCode === 0, readDoc: (ref) => read(path.resolve(root, ref)), selfCheck: (file) => void compareBenchReports(path.join(out, file), path.join(out, file)) }, (text) => writeFileSync(path.join(here, 'replay-main.json'), text));
  return result ? fail(1, result.refusal) : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv[2]); } catch (err) { process.exitCode = fail(1, (err as Error).message); }
}
