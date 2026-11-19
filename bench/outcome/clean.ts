// node bench/outcome/clean.ts [--extend] (cards T1-REPLAY-CLEAN, T1-BENCH-CLEAN-40-2): the confirmed clean cases of the reviewer bench in evals/review/clean/, from the drafts of `aidlc review bench export --clean --dir _local/clean-drafts`.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCardText } from '../../src/artifacts/card.ts';
import { loadProjectConfig } from '../../src/config.ts';
import { ReviewBenchCase } from '../../src/core/types.ts';
import { runSync } from '../../src/probes/exec.ts';
import { loadBenchCases } from '../../src/review/bench.ts';
import { collectCandidateDiff } from '../../src/review/pre-review.ts';

export const CLEAN_RULE = 'a clean draft of a card run whose first R3 decision passed, whose card file has status merged and no superseded_by, scorable and on no candidate of evals/review/replay/, one per card (the smallest id), taken in sha256 order of the id with distinct candidates, the first 15; no person checked this case';
export const WANT = 40;
/** The facts of one draft that R1 of card T1-REPLAY-CLEAN decides on. */
export interface CleanFacts { cardStatus: string | undefined; supersededBy: string | undefined; scorable: boolean; replayCandidate: boolean }
export interface CleanSelection { cases: ReviewBenchCase[]; eligible: number; shortBy?: number }

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Keeps `existing` as given, then adds drafts by the rule until the set holds WANT confirmed cases (card T1-BENCH-CLEAN-40-2). */
export function selectClean(drafts: ReviewBenchCase[], facts: (d: ReviewBenchCase) => CleanFacts, existing: ReviewBenchCase[] = []): CleanSelection {
  const firstOfCard = new Map<string, ReviewBenchCase>();
  for (const d of drafts) {
    const f = facts(d);
    if (d.kind !== 'clean' || f.cardStatus !== 'merged' || f.supersededBy !== undefined || !f.scorable || f.replayCandidate) continue;
    const held = firstOfCard.get(d.card.id);
    if (!held || d.id < held.id) firstOfCard.set(d.card.id, d);
  }
  const ordered = [...firstOfCard.values()].map((d) => ({ d, h: sha256(d.id) })).sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0)).map((x) => x.d);
  const seen = new Set(existing.map((c) => c.candidate)), heldCards = new Set(existing.map((c) => c.card.id));
  const kept = existing.filter((c) => c.confirmed).length;
  const added = ordered.filter((d) => !heldCards.has(d.card.id) && !seen.has(d.candidate) && Boolean(seen.add(d.candidate))).slice(0, Math.max(0, WANT - kept)).map((d): ReviewBenchCase => ({ ...d, confirmed: true, confirmedBy: CLEAN_RULE }));
  const cases = [...existing, ...added], confirmed = kept + added.length;
  return confirmed < WANT ? { cases, eligible: ordered.length, shortBy: WANT - confirmed } : { cases, eligible: ordered.length };
}

/** Writes the cases `select` adds to the cases already in `out`; without `extend` a non-empty `out` is refused before `select` runs. */
export function writeClean(out: string, extend: boolean, select: (existing: ReviewBenchCase[]) => CleanSelection): { refused: string } | { result: CleanSelection; written: string[] } {
  if (!extend && existsSync(out) && readdirSync(out).length > 0) return { refused: `${out} already holds a file; nothing written (--extend keeps its cases and adds to them)` };
  const existing = existsSync(out) ? loadBenchCases(out) : [], held = new Set(existing.map((c) => c.id));
  const result = select(existing), written: string[] = [];
  mkdirSync(out, { recursive: true });
  for (const c of result.cases.filter((x) => !held.has(x.id))) {
    writeFileSync(path.join(out, `${c.id}.json`), `${JSON.stringify(ReviewBenchCase.parse(c), null, 2)}\n`, { flag: 'wx' });
    written.push(c.id);
  }
  return { result, written };
}

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..', '..');
const fail = (code: number, message: string): number => (process.stderr.write(`clean: ${message}\n`), code);

/** The bench's own checks of a clean case (src/review/bench.ts, `reviewIn`), as bench/outcome/replay.ts `scorable` makes them, without a checkout. */
function scorable(c: ReviewBenchCase, maxBytes: number): boolean {
  const card = runSync('git', ['cat-file', '-p', `${c.candidate}:${c.card.path}`], { cwd: root }), parsed = card.exitCode === 0 ? parseCardText(card.stdout) : undefined;
  if (!parsed || 'error' in parsed || parsed.card.id !== c.card.id) return false;
  try { return collectCandidateDiff(runSync, root, c.base, maxBytes, c.candidate, 'formalReview.maxDiffBytes').diff.trim() !== ''; } catch { return false; }
}

function main(extend: boolean): number {
  const [drafts, out] = [path.join(root, '_local', 'clean-drafts'), path.join(root, 'evals', 'review', 'clean')];
  let draftCount = 0;
  const run = writeClean(out, extend, (existing) => {
    if (!existsSync(drafts)) throw new Error(`no drafts in ${path.relative(root, drafts)}: run aidlc review bench export --clean --dir _local/clean-drafts first`);
    const cases = loadBenchCases(drafts);
    draftCount = cases.length;
    return selectClean(cases, factsOf(), existing);
  });
  if ('refused' in run) return fail(2, run.refused.replace(out, path.relative(root, out)));
  const { result, written } = run;
  process.stdout.write(`drafts ${draftCount}, eligible drafts ${result.eligible}, kept cases ${result.cases.length - written.length}, written cases ${written.length}${result.shortBy ? `, short of ${WANT} by ${result.shortBy}` : ''}\n`);
  return 0;
}

function factsOf(): (d: ReviewBenchCase) => CleanFacts {
  const [replay, maxBytes] = [new Set(loadBenchCases(path.join(root, 'evals', 'review', 'replay')).map((c) => c.candidate)), loadProjectConfig(root).config.formalReview.maxDiffBytes];
  return (d: ReviewBenchCase): CleanFacts => {
    const file = path.join(root, 'specs', 'tasks', `${d.card.id}.md`);
    const parsed = existsSync(file) ? parseCardText(readFileSync(file, 'utf8'), file, { strict: false }) : undefined;
    const card = parsed && !('error' in parsed) ? parsed.card : undefined;
    return { cardStatus: card?.status, supersededBy: card?.superseded_by, scorable: scorable(d, maxBytes), replayCandidate: replay.has(d.candidate) };
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.includes('--extend')); } catch (err) { process.exitCode = fail(1, (err as Error).message); }
}
