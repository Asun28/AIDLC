// node bench/outcome/replay.ts cases|assemble --commit <sha> (cards T1-OUTCOME-REPLAY, T1-OUTCOME-REPLAY-2):the recall baseline in evals/review/replay/ and bench/outcome/replay-main.json.
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
export interface Report { stage: string; policyHash: string; leftCheckouts: string[]; cases?: TrialCase[]; trialResults: Array<{ cases: TrialCase[] }> }
export interface TrialEntry { case: string; outcomes: string[]; agree: boolean; verdicts: string[]; verdictAgree: boolean; report: Report }
export type ReadDoc = (ref: string) => string | undefined;
export interface AssembleInput { status: string; commit: string | undefined; run:string | undefined; trials: Record<string, string>; cases: ReviewBenchCase[]; rows: FinalRow[]; hasCommit: (sha: string) => boolean; readDoc: ReadDoc; selfCheck: (file: string) => void }

const TRIAL_REVIEWS = 30;
const idOf = (r: FinalRow): string => `${r.cardId}.${r.goalId}.${r.findingId}`;
const qualifies = (r: FinalRow): boolean => (r.source === 'agreed' || r.source === 'owner') && r.final === 'true-defect';
const same = (xs: string[]): boolean => xs.every((x) => x === xs[0]);
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const KEEP = ['id', 'kind', 'confirmed', 'outcome', 'runStatus', 'detail', 'durationMs'];
/** R8: the report with every case result, in `cases` and in each `trialResults` element, cut to the keys of KEEP it has, in that order. */
function reduce(r: Report): Report {
  const cut = (cs: TrialCase[]): TrialCase[] => cs.map((c) => Object.fromEntries(KEEP.filter((k) => k in c).map((k) => [k, (c as unknown as Record<string, unknown>)[k]])) as unknown as TrialCase);
  return { ...r, ...(r.cases ? { cases: cut(r.cases) } : {}), trialResults: r.trialResults.map((t) => ({ ...t, cases: cut(t.cases) })) };
}
/** The `outcome` of the retained verdict document at `ref`; undefined when it is missing or unreadable. */
const docOutcome = (readDoc: ReadDoc, ref: string | undefined): unknown => { try { const t = ref === undefined ? undefined : readDoc(ref); return t === undefined ? undefined : (JSON.parse(t) as { outcome?: unknown }).outcome; } catch { return undefined; } };

export function planReplay({ rows, drafts, scorable }: { rows: FinalRow[]; drafts: ReviewBenchCase[]; scorable: (c: ReviewBenchCase) => boolean }): Plan {
  const [open, done] = [rows.find((r) => r.final === null && r.left === null), drafts.find((d) => d.confirmed)];
  if (open || done) throw new Error(open ? `row ${idOf(open)} has neither a final label nor a cause to be left out` : `case ${done!.id} is already confirmed`);
  const [byId, write, remove] = [new Map(rows.filter(qualifies).map((r) => [idOf(r), r])), [] as ReviewBenchCase[], [] as string[]];
  let notScorable = 0;
  for (const d of drafts) {
    const r = d.kind === 'bug' ? byId.get(d.id) : undefined, ok = r !== undefined && scorable(d);
    notScorable += r && !ok ? 1 : 0;
    if (ok) write.push({ ...d, confirmed: true, confirmedBy: r.source === 'owner' ? OWNER : AGREED });
    else remove.push(d.id);
  }
  const [ids, candidates, triples] = [new Set(drafts.map((d) => d.id)), new Set(write.map((c) => c.candidate)).size, new Set(write.map((c) => `${c.candidate} ${c.base} ${c.card.path}`)).size];
  const counts: Counts = { cases: write.length, candidates, triples, reviews: triples + TRIAL_REVIEWS, spendUsd: Math.round((triples + TRIAL_REVIEWS) * 140) / 100, withoutDraft: [...byId.keys()].filter((id) => !ids.has(id)).length, notScorable, adjudicator: rows.filter((r) => r.source === 'adjudicator').length, left: rows.filter((r) => r.left !== null).length };
  return candidates < 10 ? { write: [], remove: [], counts, stop: `the bug cases lie on ${candidates} distinct candidates, fewer than ten` } : { write, remove, counts };
}

export function trialCases(cases: ReviewBenchCase[]): ReviewBenchCase[] {
  const [hash, seen] = [(c: ReviewBenchCase): string => createHash('sha256').update(c.id, 'utf8').digest('hex'), new Set<string>()];
  const byHash = cases.filter((c) => c.kind === 'bug').map((c) => ({ c, h: hash(c) })).sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0)).map((x) => x.c);
  return byHash.filter((c) => !seen.has(c.candidate) && Boolean(seen.add(c.candidate))).slice(0, 10);
}

export function trialEntry(id: string, report: Report, readDoc: ReadDoc): TrialEntry {
  const outcomes = report.trialResults.map((t) => t.cases.find((c) => c.id === id) ?? { id, outcome: 'absent' }).map((c) => c.outcome);
  const verdicts = report.trialResults.map((t, i) => {
    const doc = outcomes[i] === 'hit' ? 'block' : outcomes[i] === 'no-verdict' ? 'no-verdict' : outcomes[i] === 'miss' ? docOutcome(readDoc, t.cases.find((c) => c.id === id)?.verdictRef) : undefined;
    if (typeof doc === 'string' && ['pass', 'block', 'no-verdict'].includes(doc) && (doc !== 'no-verdict' || outcomes[i] !== 'miss')) return doc;
    throw new Error(`case ${id}: trial ${i + 1} has outcome ${outcomes[i]}${outcomes[i] === 'miss' ? ' and no retained verdict of pass or block' : ''}`);
  });
  return { case: id, outcomes, agree: same(outcomes), verdicts, verdictAgree: same(verdicts), report };
}

/** The refusal of R8 for one report, or undefined when it may be kept. */
function refuseReport(name: string, r: Report, readDoc: ReadDoc): string | undefined {
  if (r.stage !== 'formal' || r.leftCheckouts.length) return `${name}: stage ${r.stage} or checkouts left behind`;
  const bad = r.trialResults.flatMap((t) => t.cases).find((c) => c.outcome === 'error' || c.detail === 'not reviewed: a quota hold stopped the run' || (c.outcome === 'no-verdict' && [undefined, 'quota-hold'].includes(docOutcome(readDoc, c.verdictRef) as string)));
  return bad && `${name}: case ${bad.id} is an error, was not reviewed after a quota hold, or is a no-verdict with no readable document or one that met a quota hold`;
}

export function assembleReplay(input: AssembleInput, write: (text: string) => void): { refusal: string } | undefined {
  const [refuse, ids] = [(refusal: string) => ({ refusal }), trialCases(input.cases).map((c) => c.id)];
  if (input.commit === undefined || !input.hasCommit(input.commit)) return refuse(`--commit ${input.commit ?? '(missing)'} is not a commit of this repository`);
  if (input.status.trim()) return refuse(`tracked changes: ${input.status.trim()}`);
  if (input.run === undefined) return refuse('run.json is missing');
  if (Object.keys(input.trials).sort().join() !== [...ids].sort().join()) return refuse(`trial reports ${Object.keys(input.trials).join(', ')} are not those of ${ids.join(', ')}`);
  const reports: Report[] = [];
  for (const [name, text] of [['run.json', input.run], ...ids.map((id) => [`trials/${id}.json`, input.trials[id]!])] as Array<[string, string]>) {
    try { reports.push(JSON.parse(text) as Report); input.selfCheck(name); } catch (err) { return refuse(`${name}: ${(err as Error).message}`); }
    const why = refuseReport(name, reports.at(-1)!, input.readDoc);
    if (why) return refuse(why);
  }
  const [run, trials] = [reports[0]!, reports.slice(1)], caseIds = (r: Report, i: number): string => r.trialResults[i]!.cases.map((c) => c.id).sort().join();
  if (run.trialResults.length !== 1 || caseIds(run, 0) !== input.cases.map((c) => c.id).sort().join()) return refuse('run.json is not one trial over the cases');
  if (trials.some((r, i) => r.trialResults.length !== 3 || [0, 1, 2].some((t) => caseIds(r, t) !== ids[i]))) return refuse('a trial report is not three trials of its one case');
  if (!same(reports.map((r) => r.policyHash))) return refuse('the reports differ in policyHash');
  let entries: TrialEntry[];
  try { entries = ids.map((id, i) => trialEntry(id, trials[i]!, input.readDoc)); } catch (err) { return refuse((err as Error).message); }
  const caseSet = new Set(input.cases.map((c) => c.id));
  const leftOut = { candidateGone: input.rows.filter((r) => r.candidate === null || !input.hasCommit(r.candidate)).length, trueDefectWithoutCase: input.rows.filter((r) => qualifies(r) && !caseSet.has(idOf(r))).length };
  const hashes = { run: sha256(input.run), ...Object.fromEntries(ids.map((id) => [id, sha256(input.trials[id]!)])) };
  write(`${JSON.stringify({ commit: input.commit, policyHash: run.policyHash, reports: hashes, run: reduce(run), trials: entries.map((e) => ({ ...e, report: reduce(e.report) })), leftOut }, null, 2)}\n`);
  return undefined;
}

const [here, fail] = [path.dirname(fileURLToPath(import.meta.url)), (code: number, message: string): number => (process.stderr.write(`replay: ${message}\n`), code)];
const root = path.resolve(here, '..', '..'), git = (args: string[]) => runSync('git', args, { cwd: root });

/** The bench's own checks of a case (src/review/bench.ts, `reviewIn`), without a checkout. */
function scorable(c: ReviewBenchCase, maxBytes: number): boolean {
  const card = git(['cat-file', '-p', `${c.candidate}:${c.card.path}`]), parsed = card.exitCode === 0 ? parseCardText(card.stdout) : undefined;
  if (!parsed || 'error' in parsed || parsed.card.id !== c.card.id) return false;
  try { const { diff, changedPaths } = collectCandidateDiff(runSync, root, c.base, maxBytes, c.candidate, 'formalReview.maxDiffBytes'); return diff.trim() !== '' && (c.kind !== 'bug' || c.expected.every((e) => changedPaths.includes(e.file))); } catch { return false; }
}

function main(mode: string | undefined): number {
  const [dir, out, read] = [path.join(root, 'evals', 'review', 'replay'), path.join(root, '_local', 'outcome', 'replay'), (file: string): string | undefined => (existsSync(file) ? readFileSync(file, 'utf8') : undefined)];
  const [rows, cases] = [readFileSync(path.join(here, 'labels-final.jsonl'), 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as FinalRow), loadBenchCases(dir)];
  if (mode === 'cases') {
    const maxBytes = loadProjectConfig(root).config.formalReview.maxDiffBytes, plan = planReplay({ rows, drafts: cases, scorable: (c) => scorable(c, maxBytes) }), k = plan.counts;
    process.stderr.write(`bug cases ${k.cases}, distinct candidates ${k.candidates}, candidate-base-card triples ${k.triples}, reviews ${k.reviews} (${k.triples} of the run and ${TRIAL_REVIEWS} of the trials) at 1.4 USD each: ${k.spendUsd.toFixed(2)} USD; qualifying rows with no draft ${k.withoutDraft}, qualifying drafts not scorable ${k.notScorable}, adjudicator rows ${k.adjudicator}, rows left out ${k.left}\n`);
    if (plan.stop) return fail(3, `preflight stop: ${plan.stop}`);
    for (const c of plan.write) writeFileSync(path.join(dir, `${c.id}.json`), `${JSON.stringify(ReviewBenchCase.parse(c), null, 2)}\n`);
    for (const id of plan.remove) rmSync(path.join(dir, `${id}.json`));
    return 0;
  }
  if (mode !== 'assemble') return fail(1, 'usage: node bench/outcome/replay.ts cases|assemble --commit <sha>');
  const names = existsSync(path.join(out, 'trials')) ? readdirSync(path.join(out, 'trials')).filter((n) => n.endsWith('.json')) : [];
  const [status, at] = [git(['status', '--porcelain', '--untracked-files=no']), process.argv.indexOf('--commit')];
  if (status.exitCode !== 0) return fail(1, 'git status failed');
  const trials = Object.fromEntries(names.map((n) => [n.slice(0, -'.json'.length), read(path.join(out, 'trials', n))!]));
  const result = assembleReplay({ status: status.stdout, commit: at > 0 ? process.argv[at + 1] : undefined, run: read(path.join(out, 'run.json')), trials, cases, rows, hasCommit: (sha) => git(['cat-file', '-e', `${sha}^{commit}`]).exitCode === 0, readDoc: (ref) => read(path.resolve(root, ref)), selfCheck: (file) => void compareBenchReports(path.join(out, file), path.join(out, file)) }, (text) => writeFileSync(path.join(here, 'replay-main.json'), text));
  return result ? fail(1, result.refusal) : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv[2]); } catch (err) { process.exitCode = fail(1, (err as Error).message); }
}
