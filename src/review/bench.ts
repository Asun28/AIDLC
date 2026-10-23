/**
 * The reviewer bench (card T1-REVIEW-BENCH): `aidlc review bench run` scores a stage's configured primary reviewer on the
 * cases under `evals/review/`. Each distinct candidate is reviewed once, in a detached temporary checkout that is always
 * removed, the way the card runner reviews a first R2 round or a first R3 decision: the prompt and the run come from
 * `buildReviewPrompt` and `runReviewPanel`, and this module adds no prompt text of its own. A bug case is a hit when a
 * cited block reason lands inside an expected window; a clean case is a false block when the review blocks.
 *
 * The bench stays outside the loop: it reads no goal, card run, journal or review queue, writes nothing under the state
 * directory, and nothing in the loop or in CI reads its scores.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseCardText } from '../artifacts/card.ts';
import { lessonsPath, reviewLessons, type ReviewLessons } from '../artifacts/lessons.ts';
import { loadProjectConfig, type ProjectConfig } from '../config.ts';
import { selectReviewEffortFromDiff } from '../core/review-effort.ts';
import { FINDING_LOCATION, classifyVerdict, findingLocation } from '../core/review-policy.ts';
import { MAX_SUBSTANTIVE_REVIEW_DECISIONS, ReviewBenchCase, type RunStatus } from '../core/types.ts';
import { run, runSync, type Runner, type SyncRunner } from '../probes/exec.ts';
import { COVERAGE_ANGLE, buildReviewPrompt, citedReasonsOf, collectCandidateDiff, materialiseVerdictSchema, pathAllowed, policyHash, runReviewPanel, type PanelResult } from './pre-review.ts';

export type BenchOutcome = 'hit' | 'miss' | 'pass' | 'false-block' | 'no-verdict' | 'error';

export interface BenchCaseResult {
  id: string;
  kind: 'bug' | 'clean';
  confirmed: boolean;
  outcome: BenchOutcome;
  runStatus?: RunStatus;
  /** The cited reasons of a block (`citedReasonsOf` over the candidate's changed paths); empty otherwise. */
  cited: string[];
  /** For a hit: the cited reason and the expected site (file and line) it landed on. */
  matched?: { reason: string; file: string; line: number };
  detail?: string;
  verdictRef?: string;
  logRef?: string;
  durationMs: number;
}

export interface BenchTotals {
  bugCases: number;
  hits: number;
  misses: number;
  /** hits / (hits + misses); null when both are 0. */
  recall: number | null;
  cleanCases: number;
  cleanPasses: number;
  falseBlocks: number;
  /** false blocks / (clean passes + false blocks); null when both are 0. */
  falseBlockRate: number | null;
  noVerdict: number;
  errors: number;
  skippedUnconfirmed: number;
}

export interface ReviewBenchReport {
  stage: 'pre' | 'formal';
  reviewer: string;
  policyHash: string;
  /** Temporary checkouts the bench could not remove; the command exits 1 when any is listed. */
  leftCheckouts: string[];
  cases: BenchCaseResult[];
  totals: BenchTotals;
}

export interface ReviewBenchOptions {
  /** The root of the checkout the command runs in: REVIEW.md, aidlc.config.json and docs/LESSONS.md are read here. */
  root: string;
  stage: 'pre' | 'formal';
  /** The case directory, resolved against `root`; default `evals/review`. */
  dir?: string;
  caseId?: string;
  includeUnconfirmed?: boolean;
  /** The reviewer runner; default `run`. */
  runner?: Runner;
  /** The git runner; default `runSync`. */
  git?: SyncRunner;
  /** Where the temporary checkouts go; default the OS temp directory. */
  tmpRoot?: string;
}

/** The `*.json` files directly inside `dir`, in file-name order, each a `ReviewBenchCase` whose `id` is its file name. */
export function loadBenchCases(dir: string): ReviewBenchCase[] {
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name)
    .sort();
  return names.map((name) => {
    const file = path.join(dir, name);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`${file}: not JSON (${(err as Error).message})`);
    }
    const parsed = ReviewBenchCase.safeParse(raw);
    if (!parsed.success) throw new Error(`${file}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'case'}: ${i.message}`).join('; ')}`);
    if (`${parsed.data.id}.json` !== name) throw new Error(`${file}: id ${parsed.data.id} differs from the file name`);
    return parsed.data;
  });
}

/** What every review of one bench run shares. */
interface BenchContext {
  root: string;
  stage: 'pre' | 'formal';
  config: ProjectConfig;
  reviewPolicy: string;
  hash: string;
  lessons: ReviewLessons;
  runner: Runner;
  git: SyncRunner;
  tmpRoot: string;
  reviewDir: string;
  leftCheckouts: string[];
}

/** Score the stage's primary reviewer on the selected cases; throws, before any review, on a refusal. */
export async function runReviewBench(o: ReviewBenchOptions): Promise<ReviewBenchReport> {
  const policyFile = path.join(o.root, 'REVIEW.md');
  if (!existsSync(policyFile)) throw new Error(`no REVIEW.md in ${o.root}: the reviewer bench reviews with this checkout's policy`);
  const { config } = loadProjectConfig(o.root);
  const reviewer = o.stage === 'pre' ? config.preReview : config.formalReview;
  if (!reviewer.command.length) throw new Error(`${o.stage === 'pre' ? 'preReview' : 'formalReview'}.command is not configured (aidlc.config.json): there is no reviewer to score`);
  const dir = path.resolve(o.root, o.dir ?? path.join('evals', 'review'));
  if (!existsSync(dir)) throw new Error(`no case directory ${dir}`);
  const all = loadBenchCases(dir);
  if (o.caseId !== undefined && !all.some((c) => c.id === o.caseId)) throw new Error(`no case ${o.caseId} in ${dir}`);
  const pool = o.caseId !== undefined ? all.filter((c) => c.id === o.caseId) : all;
  const selected = pool.filter((c) => o.includeUnconfirmed || c.confirmed);
  const reviewPolicy = readFileSync(policyFile, 'utf8');
  const ctx: BenchContext = { root: o.root, stage: o.stage, config, reviewPolicy, hash: policyHash(reviewPolicy), lessons: reviewLessons(lessonsPath(o.root)), runner: o.runner ?? run, git: o.git ?? runSync, tmpRoot: o.tmpRoot ?? tmpdir(), reviewDir: path.join(o.root, '.review', 'bench'), leftCheckouts: [] };
  // One review per distinct candidate, base and card path, one after another, scoring every case of it.
  const groups = new Map<string, ReviewBenchCase[]>();
  for (const c of selected) {
    const key = `${c.candidate} ${c.base} ${c.card.path}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const results = new Map<string, BenchCaseResult>();
  let n = 0;
  for (const cases of groups.values()) {
    n += 1;
    for (const r of await reviewGroup(ctx, cases, n)) results.set(r.id, r);
  }
  const ordered = selected.map((c) => results.get(c.id)!);
  return { stage: o.stage, reviewer: reviewer.reviewer, policyHash: ctx.hash, leftCheckouts: ctx.leftCheckouts, cases: ordered, totals: totalsOf(ordered, pool.length - selected.length) };
}

const errorOf = (c: ReviewBenchCase, detail: string): BenchCaseResult => ({ id: c.id, kind: c.kind, confirmed: c.confirmed, outcome: 'error', cited: [], detail, durationMs: 0 });

/** Review one candidate in a detached temporary checkout, removed whatever the review did. */
async function reviewGroup(ctx: BenchContext, cases: ReviewBenchCase[], n: number): Promise<BenchCaseResult[]> {
  const { candidate } = cases[0]!;
  let holder: string | undefined;
  try {
    holder = mkdtempSync(path.join(ctx.tmpRoot, 'aidlc-review-bench-'));
    // The long, canonical form, so the path git records compares equal to the one the cleanup looks for.
    holder = realpathSync.native(holder);
    const checkout = path.join(holder, 'checkout');
    const add = ctx.git('git', ['worktree', 'add', '--detach', checkout, candidate], { cwd: ctx.root });
    if (add.exitCode !== 0) return cases.map((c) => errorOf(c, `no checkout of ${candidate}: ${add.stderr.trim() || `git worktree add exit ${add.exitCode}`}`));
    return await reviewIn(ctx, cases, checkout, n);
  } catch (err) {
    return cases.map((c) => errorOf(c, (err as Error).message));
  } finally {
    if (holder) removeCheckout(ctx, holder);
  }
}

/** Paths compared as the OS compares them: resolved, and without letter case on Windows. */
const samePath = (a: string, b: string): boolean => {
  const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
};

/**
 * `git worktree remove --force`, else delete the directory and `git worktree prune`. The checkout is reported in
 * `leftCheckouts` unless every step is confirmed: the directory is gone, a prune the failed remove needed exited 0, and
 * `git worktree list --porcelain` exited 0 without naming it.
 */
function removeCheckout(ctx: BenchContext, holder: string): void {
  const checkout = path.join(holder, 'checkout');
  const removed = ctx.git('git', ['worktree', 'remove', '--force', checkout], { cwd: ctx.root });
  try {
    rmSync(holder, { recursive: true, force: true });
  } catch {
    // reported below
  }
  const pruned = removed.exitCode === 0 || ctx.git('git', ['worktree', 'prune'], { cwd: ctx.root }).exitCode === 0;
  const listed = ctx.git('git', ['worktree', 'list', '--porcelain'], { cwd: ctx.root });
  const named = listed.exitCode !== 0 || listed.stdout.split(/\r?\n/).some((l) => l.startsWith('worktree ') && samePath(l.slice('worktree '.length), checkout));
  if (existsSync(holder) || !pruned || named) ctx.leftCheckouts.push(checkout);
}

async function reviewIn(ctx: BenchContext, cases: ReviewBenchCase[], checkout: string, n: number): Promise<BenchCaseResult[]> {
  const { candidate, base, card: ref } = cases[0]!;
  const cardFile = path.join(checkout, ...ref.path.split('/'));
  if (!existsSync(cardFile)) return cases.map((c) => errorOf(c, `card file ${ref.path} is absent at ${candidate}`));
  const parsed = parseCardText(readFileSync(cardFile, 'utf8'), cardFile);
  if ('error' in parsed) return cases.map((c) => errorOf(c, `card file ${ref.path} does not parse: ${parsed.error}`));
  const card = parsed.card;
  const pre = ctx.stage === 'pre';
  const cfg = pre ? ctx.config.preReview : ctx.config.formalReview;
  const { changedPaths, diff } = collectCandidateDiff(ctx.git, checkout, base, cfg.maxDiffBytes, candidate, pre ? 'preReview.maxDiffBytes' : 'formalReview.maxDiffBytes');
  if (!diff.trim()) return cases.map((c) => errorOf(c, `no committed diff ${base}...${candidate}`));
  const unscorable = (c: ReviewBenchCase): string | undefined => {
    if (c.card.id !== card.id) return `card file ${ref.path} names ${card.id}, not ${c.card.id}`;
    const missing = c.kind === 'bug' ? c.expected.find((e) => !changedPaths.includes(e.file)) : undefined;
    return missing ? `expected file ${missing.file} is not changed by ${base}...${candidate}` : undefined;
  };
  if (cases.every((c) => unscorable(c) !== undefined)) return cases.map((c) => errorOf(c, unscorable(c)!));
  const includeDiff = !cfg.command.some((a) => a.includes('{instructions}'));
  const common = { reviewPolicy: ctx.reviewPolicy, lessons: ctx.lessons, card, base, head: candidate, changedPaths, diff, priorFindings: [], includeDiff, round: 1 };
  const retention = { runner: ctx.runner, command: cfg.command, cwd: checkout, timeoutMs: cfg.timeoutMs, shell: cfg.shell, reviewDir: ctx.reviewDir, fileStem: `${card.id}.bench-${ctx.stage}.${n}.${candidate.slice(0, 12)}`, head: candidate, reviewer: cfg.reviewer, changedPaths, policyHash: ctx.hash };
  const vars = { cwd: checkout, base, head: candidate, card: card.id };
  let panel: PanelResult;
  if (pre) {
    const r2 = ctx.config.preReview;
    const coverage = r2.coverage === 'shadow' && r2.perspectives.includes(COVERAGE_ANGLE);
    const promptFor = (perspective?: string) => buildReviewPrompt({ ...common, stage: 'pre', perspective, coverage, maxRounds: Math.max(r2.rounds, 1) });
    panel = await runReviewPanel({ ...retention, perspectives: r2.perspectives, promptFor, vars, coverage: coverage ? { expected: card.acceptance.length } : undefined, answerMarker: r2.answerMarker });
  } else {
    const r3 = ctx.config.formalReview;
    const effort = r3.command.some((a) => a.includes('{effort}')) ? selectReviewEffortFromDiff(r3.effort, diff, changedPaths, pathAllowed) : undefined;
    const schema = materialiseVerdictSchema(ctx.reviewDir);
    const promptFor = () => buildReviewPrompt({ ...common, stage: 'formal', advisoryNotes: [], maxRounds: Math.max(MAX_SUBSTANTIVE_REVIEW_DECISIONS, 1) });
    panel = await runReviewPanel({ ...retention, perspectives: [], promptFor, vars: { ...vars, schema, ...(effort ? { effort } : {}) } });
  }
  const bound = bindToCandidate(panel, candidate, card.id);
  return cases.map((c) => {
    const reason = unscorable(c);
    return reason ? errorOf(c, reason) : score(c, bound, changedPaths);
  });
}

/** The file and line range a cited reason names: the `:n` or `:n-m` that ends its `FINDING_LOCATION` match. */
function citedSite(reason: string): { file: string; from: number; to: number } | undefined {
  const file = findingLocation(reason);
  const range = /:(\d+)(?:-(\d+))?$/.exec(FINDING_LOCATION.exec(reason)?.[0] ?? '');
  if (!file || !range) return undefined;
  const a = Number(range[1]);
  const b = range[2] === undefined ? a : Number(range[2]);
  return { file, from: Math.min(a, b), to: Math.max(a, b) };
}

/**
 * The review result with the binding rule of the loop's R3 classification (`classifyFormal` in src/loop/card-runner.ts,
 * mirrored because the bench imports nothing from src/loop/): an absent sha or branch binds to this candidate and card,
 * `classifyVerdict` makes a verdict bound to another sha a no-verdict, and one bound to another branch is a no-verdict too.
 * The bench applies it to both stages, so a stale verdict never scores as a pass, a hit, a miss or a false block.
 */
function bindToCandidate(panel: PanelResult, candidate: string, cardId: string): PanelResult {
  if ((panel.outcome !== 'pass' && panel.outcome !== 'block') || !panel.verdict) return panel;
  const verdict = { ...panel.verdict, sha: panel.verdict.sha ?? candidate, branch: panel.verdict.branch ?? cardId, run_status: panel.runStatus };
  const classified = classifyVerdict(verdict, { candidateSha: candidate });
  if (classified.stale) return { ...panel, outcome: 'no-verdict', runStatus: classified.runStatus ?? 'malformed', reasons: classified.reasons, verdict: undefined };
  if (verdict.branch !== cardId) return { ...panel, outcome: 'no-verdict', runStatus: 'malformed', reasons: [`stale verdict branch ${verdict.branch}`], verdict: undefined };
  return panel;
}

function score(c: ReviewBenchCase, panel: PanelResult, changedPaths: string[]): BenchCaseResult {
  const cited = panel.outcome === 'block' && panel.verdict ? citedReasonsOf(panel.verdict, changedPaths) : [];
  const common = { id: c.id, kind: c.kind, confirmed: c.confirmed, runStatus: panel.runStatus, cited, verdictRef: panel.verdictRef, logRef: panel.logRef, durationMs: panel.durationMs };
  if (panel.outcome === 'no-verdict' || panel.outcome === 'quota-hold') return { ...common, outcome: 'no-verdict', detail: panel.reasons.join('; ') || panel.runStatus };
  if (c.kind === 'clean') return { ...common, outcome: panel.outcome === 'block' ? 'false-block' : 'pass' };
  for (const reason of cited) {
    const at = citedSite(reason);
    const site = at && c.expected.find((e) => e.file === at.file && at.from <= e.line + e.window && at.to >= e.line - e.window);
    if (site) return { ...common, outcome: 'hit', matched: { reason, file: site.file, line: site.line } };
  }
  return { ...common, outcome: 'miss' };
}

function totalsOf(cases: BenchCaseResult[], skippedUnconfirmed: number): BenchTotals {
  const count = (outcome: BenchOutcome) => cases.filter((c) => c.outcome === outcome).length;
  const [hits, misses, cleanPasses, falseBlocks] = [count('hit'), count('miss'), count('pass'), count('false-block')];
  return {
    bugCases: cases.filter((c) => c.kind === 'bug').length,
    hits,
    misses,
    recall: hits + misses ? hits / (hits + misses) : null,
    cleanCases: cases.filter((c) => c.kind === 'clean').length,
    cleanPasses,
    falseBlocks,
    falseBlockRate: cleanPasses + falseBlocks ? falseBlocks / (cleanPasses + falseBlocks) : null,
    noVerdict: count('no-verdict'),
    errors: count('error'),
    skippedUnconfirmed,
  };
}

/** The line form: one line per case and a totals line. */
export function formatBenchReport(r: ReviewBenchReport): string {
  const rate = (x: number | null) => (x === null ? '-' : x.toFixed(2));
  const t = r.totals;
  const lines = r.cases.map((c) => `${c.id} ${c.kind} ${c.outcome}${c.runStatus ? ` (${c.runStatus})` : ''}${c.matched ? ` at ${c.matched.file}:${c.matched.line}` : ''}${c.detail ? `: ${c.detail}` : ''}`);
  lines.push(`${r.stage} ${r.reviewer}: recall ${rate(t.recall)} (${t.hits}/${t.hits + t.misses}), false-block rate ${rate(t.falseBlockRate)} (${t.falseBlocks}/${t.cleanPasses + t.falseBlocks}), no verdict ${t.noVerdict}, errors ${t.errors}, unconfirmed skipped ${t.skippedUnconfirmed}`);
  if (r.leftCheckouts.length) lines.push(`checkouts left behind: ${r.leftCheckouts.join(', ')}`);
  return lines.join('\n');
}
