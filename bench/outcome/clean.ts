// node bench/outcome/clean.ts (card T1-REPLAY-CLEAN): the confirmed clean cases of the reviewer bench in evals/review/clean/, from the drafts of `aidlc review bench export --clean --dir _local/clean-drafts`.
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
export const WANT = 15;
/** The facts of one draft that R1 of card T1-REPLAY-CLEAN decides on. */
export interface CleanFacts { cardStatus: string | undefined; supersededBy: string | undefined; scorable: boolean; replayCandidate: boolean }
export interface CleanSelection { cases: ReviewBenchCase[]; eligible: number; shortBy?: number }

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export function selectClean(drafts: ReviewBenchCase[], facts: (d: ReviewBenchCase) => CleanFacts): CleanSelection {
  const firstOfCard = new Map<string, ReviewBenchCase>();
  for (const d of drafts) {
    const f = facts(d);
    if (d.kind !== 'clean' || f.cardStatus !== 'merged' || f.supersededBy !== undefined || !f.scorable || f.replayCandidate) continue;
    const held = firstOfCard.get(d.card.id);
    if (!held || d.id < held.id) firstOfCard.set(d.card.id, d);
  }
  const ordered = [...firstOfCard.values()].map((d) => ({ d, h: sha256(d.id) })).sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0)).map((x) => x.d);
  const seen = new Set<string>();
  const cases = ordered.filter((d) => !seen.has(d.candidate) && Boolean(seen.add(d.candidate))).slice(0, WANT).map((d): ReviewBenchCase => ({ ...d, confirmed: true, confirmedBy: CLEAN_RULE }));
  return cases.length < WANT ? { cases, eligible: ordered.length, shortBy: WANT - cases.length } : { cases, eligible: ordered.length };
}

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..', '..');
const fail = (code: number, message: string): number => (process.stderr.write(`clean: ${message}\n`), code);

/** The bench's own checks of a clean case (src/review/bench.ts, `reviewIn`), as bench/outcome/replay.ts `scorable` makes them, without a checkout. */
function scorable(c: ReviewBenchCase, maxBytes: number): boolean {
  const card = runSync('git', ['cat-file', '-p', `${c.candidate}:${c.card.path}`], { cwd: root }), parsed = card.exitCode === 0 ? parseCardText(card.stdout) : undefined;
  if (!parsed || 'error' in parsed || parsed.card.id !== c.card.id) return false;
  try { return collectCandidateDiff(runSync, root, c.base, maxBytes, c.candidate, 'formalReview.maxDiffBytes').diff.trim() !== ''; } catch { return false; }
}

function main(): number {
  const [drafts, out] = [path.join(root, '_local', 'clean-drafts'), path.join(root, 'evals', 'review', 'clean')];
  if (existsSync(out) && readdirSync(out).length > 0) return fail(2, `${path.relative(root, out)} already holds a file; nothing written`);
  if (!existsSync(drafts)) return fail(1, `no drafts in ${path.relative(root, drafts)}: run aidlc review bench export --clean --dir _local/clean-drafts first`);
  const [cases, replay, maxBytes] = [loadBenchCases(drafts), new Set(loadBenchCases(path.join(root, 'evals', 'review', 'replay')).map((c) => c.candidate)), loadProjectConfig(root).config.formalReview.maxDiffBytes];
  const facts = (d: ReviewBenchCase): CleanFacts => {
    const file = path.join(root, 'specs', 'tasks', `${d.card.id}.md`);
    const parsed = existsSync(file) ? parseCardText(readFileSync(file, 'utf8'), file, { strict: false }) : undefined;
    const card = parsed && !('error' in parsed) ? parsed.card : undefined;
    const base = { cardStatus: card?.status, supersededBy: card?.superseded_by, replayCandidate: replay.has(d.candidate) };
    return { ...base, scorable: base.cardStatus === 'merged' && base.supersededBy === undefined && !base.replayCandidate && scorable(d, maxBytes) };
  };
  const result = selectClean(cases, facts);
  mkdirSync(out, { recursive: true });
  for (const c of result.cases) writeFileSync(path.join(out, `${c.id}.json`), `${JSON.stringify(ReviewBenchCase.parse(c), null, 2)}\n`);
  process.stdout.write(`drafts ${cases.length}, eligible drafts ${result.eligible}, written cases ${result.cases.length}${result.shortBy ? `, short of ${WANT} by ${result.shortBy}` : ''}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (err) { process.exitCode = fail(1, (err as Error).message); }
}
