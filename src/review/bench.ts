/**
 * The reviewer bench (card T1-REVIEW-BENCH): `aidlc review bench run` scores a stage's configured primary reviewer on the
 * cases under `evals/review/`. Each distinct candidate is reviewed once, in a detached temporary checkout that is always
 * removed, the way the card runner reviews a first R2 round or a first R3 decision: the prompt and the run come from
 * `buildReviewPrompt` and `runReviewPanel`, and this module adds no prompt text of its own. A bug case is a hit when a
 * cited block reason lands inside an expected window; a clean case is a false block when the review blocks.
 *
 * The bench stays outside the loop: it reads no goal, card run, journal or review queue, writes nothing under the state
 * directory, and nothing in the loop or in CI reads its scores.
 *
 * `aidlc review bench export` (card T1-REVIEW-BENCH-EXPORT) drafts unconfirmed cases from card runs that `src/cli/main.ts`
 * reads and hands to `exportBenchCases`, and pins each candidate under `refs/aidlc/bench/`. Its git calls are `cat-file`,
 * `merge-base`, `rev-parse`, `symbolic-ref` and `update-ref` on those refs alone, none of which fetches an object.
 */
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseCardText } from '../artifacts/card.ts';
import { lessonsPath, reviewLessons, type ReviewLessons } from '../artifacts/lessons.ts';
import { loadProjectConfig, type ProjectConfig } from '../config.ts';
import { selectReviewEffortFromDiff } from '../core/review-effort.ts';
import { FINDING_LOCATION, classifyVerdict, findingLocation } from '../core/review-policy.ts';
import { MAX_SUBSTANTIVE_REVIEW_DECISIONS, ReviewBenchCase, type CardRun, type ReviewFinding, type RunStatus } from '../core/types.ts';
import { run, runSync, type Runner, type SyncRunner } from '../probes/exec.ts';
import { COVERAGE_ANGLE, buildReviewPrompt, changedLineRanges, citedReasonsOf, collectCandidateDiff, materialiseVerdictSchema, pathAllowed, policyHash, runReviewPanel, type PanelResult } from './pre-review.ts';

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
  /** Present only when the run selected no case, so an empty report never reads as a scored run. */
  note?: string;
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
  // A case named on purpose never scores nothing in silence: an unconfirmed one needs the flag that admits it.
  if (o.caseId !== undefined && !o.includeUnconfirmed && !pool[0]!.confirmed) throw new Error(`case ${o.caseId} is not confirmed: confirm it (evals/review/README.md) or pass --include-unconfirmed`);
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
  const skipped = pool.length - selected.length;
  const note = selected.length ? undefined : `no case selected: the case directory holds no ${o.includeUnconfirmed ? '' : 'confirmed '}case${skipped ? ` (${skipped} unconfirmed left out; --include-unconfirmed scores them)` : ''}; nothing was scored`;
  return { stage: o.stage, reviewer: reviewer.reviewer, policyHash: ctx.hash, leftCheckouts: ctx.leftCheckouts, ...(note ? { note } : {}), cases: ordered, totals: totalsOf(ordered, skipped) };
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

/** Whether `target`, links followed, is `dir` or lies under it; both exist. */
function resolvesInside(dir: string, target: string): boolean {
  const inside = path.relative(realpathSync.native(dir), realpathSync.native(target));
  return !(inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside));
}

/** One git step whose failure the caller handles; a runner that throws counts as a step that failed, so the steps after it still run. */
function gitStep(ctx: Pick<BenchContext, 'git' | 'root'>, args: string[]): ReturnType<SyncRunner> | undefined {
  try {
    return ctx.git('git', args, { cwd: ctx.root });
  } catch {
    return undefined;
  }
}

/**
 * `git worktree remove --force`, else delete the directory and `git worktree prune`. The checkout is reported in
 * `leftCheckouts` unless every step is confirmed: the directory is gone, a prune the failed remove needed exited 0, and
 * `git worktree list --porcelain` exited 0 without naming it.
 */
function removeCheckout(ctx: BenchContext, holder: string): void {
  const checkout = path.join(holder, 'checkout');
  const removed = gitStep(ctx, ['worktree', 'remove', '--force', checkout]);
  try {
    rmSync(holder, { recursive: true, force: true });
  } catch {
    // reported below
  }
  const pruned = removed?.exitCode === 0 || gitStep(ctx, ['worktree', 'prune'])?.exitCode === 0;
  const listed = gitStep(ctx, ['worktree', 'list', '--porcelain']);
  const named = !listed || listed.exitCode !== 0 || listed.stdout.split(/\r?\n/).some((l) => l.startsWith('worktree ') && samePath(l.slice('worktree '.length), checkout));
  if (existsSync(holder) || !pruned || named) ctx.leftCheckouts.push(checkout);
}

async function reviewIn(ctx: BenchContext, cases: ReviewBenchCase[], checkout: string, n: number): Promise<BenchCaseResult[]> {
  const { candidate, base, card: ref } = cases[0]!;
  const cardFile = path.join(checkout, ...ref.path.split('/'));
  if (!existsSync(cardFile)) return cases.map((c) => errorOf(c, `card file ${ref.path} is absent at ${candidate}`));
  // The candidate decides what this path is, so a link out of the checkout is refused before the read.
  if (!resolvesInside(checkout, cardFile)) return cases.map((c) => errorOf(c, `card file ${ref.path} resolves outside the checkout`));
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
  const retention = { runner: ctx.runner, command: cfg.command, cwd: checkout, timeoutMs: cfg.timeoutMs, shell: cfg.shell, reviewDir: ctx.reviewDir, fileStem: `${card.id}.bench-${ctx.stage}.${n}.${candidate.slice(0, 12)}`, head: candidate, reviewer: cfg.reviewer, changedPaths, changedLines: changedLineRanges(diff, changedPaths), policyHash: ctx.hash };
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
  const bound = ctx.stage === 'formal' ? bindToCandidate(panel, candidate, card.id) : panel;
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
 * The formal stage alone applies it: the loop records an R2 round's outcome without reading its binding, and so does the bench.
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

export interface BenchExportOptions {
  /** The root of the checkout the command runs in: the case directory and `aidlc.config.json` are read here. */
  root: string;
  /** The card runs `src/cli/main.ts` read for the selected goals. */
  runs: CardRun[];
  /** Keep this card's runs alone; required for bug drafts, so a person exports one card's findings at a time. */
  cardId?: string;
  /** Draft clean cases and no bug case. */
  clean?: boolean;
  /** The case directory, resolved against `root`; default `evals/review`. */
  dir?: string;
  /** The state directory: a case directory that resolves to it or under it is refused, since the export writes nothing there. */
  stateDir?: string;
  /** The git runner; default `runSync`. */
  git?: SyncRunner;
}

export interface BenchExportWritten {
  id: string;
  file: string;
  kind: 'bug' | 'clean';
  candidate: string;
  base: string;
  ref: string;
}

export interface BenchExportReport {
  written: BenchExportWritten[];
  /** Ids whose case file already existed: its bytes are kept and it gets no ref. */
  existing: string[];
  /** Findings and runs that give no reviewable case; `source` is the finding id or `clean`. */
  skipped: Array<{ card: string; goal: string; source: string; detail: string }>;
  /** Cases left unwritten: a ref naming another commit, or a ref step that failed. The command exits 1 when any is listed. */
  pinConflicts: Array<{ id: string; ref: string; candidate: string; detail: string }>;
}

/** What every draft of one export shares. */
interface ExportContext {
  root: string;
  dir: string;
  config: ProjectConfig;
  git: SyncRunner;
  /** The `-c` options that turn every hook off for an `update-ref`. */
  noHooks: string[];
  report: BenchExportReport;
}

/** One draft before its commits are checked: what the kind adds to the shared fields. */
interface DraftInput {
  source: string;
  candidate: string | undefined;
  origin: string;
  note: string;
  expected?: unknown[];
  /** Why this source can give no case whatever the commits are. */
  unusable?: string;
}

/** The old value that makes `git update-ref` create a ref and refuse one that exists. */
const NO_REF = '0'.repeat(40);
const SITE_WINDOW = 5;
const MAX_SITE_WINDOW = 50;

const oneLine = (text: string) => text.trim().replace(/\s+/g, ' ');

/** The class of a draft, from the reason text alone: its `(class: <slug>)` tag, else its REVIEW.md dimension, else `unclassified`. */
function draftClass(reason: string): string {
  const tag = /\(class: ?([^)]*)\)/i.exec(reason)?.[1]?.toLowerCase();
  if (tag !== undefined && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(tag)) return tag;
  const dimension = /\[(?:spec|standards)\]\s*(\d+)\b/i.exec(reason)?.[1];
  return dimension === undefined ? 'unclassified' : `dim-${dimension}`;
}

/** The checks of R5 and the parse of the case; a string is the cause of a skip. */
function buildDraft(ctx: ExportContext, run: CardRun, id: string, d: DraftInput): ReviewBenchCase | string {
  if (d.unusable) return d.unusable;
  const candidate = d.candidate;
  if (!candidate) return 'no candidateSha recorded';
  const git = (args: string[]) => ctx.git('git', args, { cwd: ctx.root });
  if (git(['cat-file', '-e', `${candidate}^{commit}`]).exitCode !== 0) return `candidate ${candidate} is not in the object store`;
  const from = run.base?.oid || run.base?.ref || ctx.config.base;
  const merged = git(['merge-base', from, candidate]);
  if (merged.exitCode !== 0) return `git merge-base ${from} ${candidate} failed: ${oneLine(merged.stderr)}`;
  const base = merged.stdout.trim();
  if (base === candidate) return `candidate ${candidate} is an ancestor of ${from}, so it has no diff`;
  const cardPath = path.posix.join(ctx.config.cardsDir, `${run.cardId}.md`);
  if (git(['cat-file', '-e', `${candidate}:${cardPath}`]).exitCode !== 0) return `no card file ${cardPath} in candidate ${candidate}`;
  const shared = { id, candidate, base, card: { id: run.cardId, path: cardPath }, confirmed: false, origin: d.origin, note: d.note };
  const parsed = ReviewBenchCase.safeParse(d.expected ? { kind: 'bug', ...shared, expected: d.expected } : { kind: 'clean', ...shared });
  return parsed.success ? parsed.data : parsed.error.issues.map((i) => `${i.path.join('.') || 'case'}: ${i.message}`).join('; ');
}

/**
 * Create a case file exclusively; false when it exists. The path is checked first, since a link swapped in during the
 * export would carry the write elsewhere, and a write that fails removes what it created, since a later export would
 * report a partial file as an existing case.
 */
function createCase(ctx: ExportContext, file: string, text: string): boolean {
  if (realpathSync.native(ctx.dir) !== ctx.dir) throw new Error(`case directory ${ctx.dir} no longer resolves to itself`);
  let fd: number;
  try {
    fd = openSync(file, 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
  try {
    try {
      writeFileSync(fd, text);
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    rmSync(file, { force: true });
    throw err;
  }
  return true;
}

/** Write one draft unless its file exists, it gives no reviewable case, or its ref is symbolic or names another commit (R5 to R7). */
function writeDraft(ctx: ExportContext, run: CardRun, d: DraftInput): void {
  const { report } = ctx;
  const id = `${run.cardId}.${run.goalId}.${d.source}`;
  const file = path.join(ctx.dir, `${id}.json`);
  if (existsSync(file)) {
    report.existing.push(id);
    return;
  }
  const draft = buildDraft(ctx, run, id, d);
  if (typeof draft === 'string') {
    report.skipped.push({ card: run.cardId, goal: run.goalId, source: d.source, detail: draft });
    return;
  }
  const { candidate, base } = draft;
  const ref = `refs/aidlc/bench/${id}`;
  const conflict = (detail: string) => void report.pinConflicts.push({ id, ref, candidate, detail });
  const symbolic = ctx.git('git', ['symbolic-ref', '-q', ref], { cwd: ctx.root });
  if (symbolic.exitCode === 0) return conflict(`${ref} is a symbolic ref to ${symbolic.stdout.trim()}`);
  if (symbolic.exitCode !== 1) return conflict(`git symbolic-ref failed: ${oneLine(symbolic.stderr)}`);
  const pin = ctx.git('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: ctx.root });
  if (pin.exitCode !== 0 && pin.exitCode !== 1) return conflict(`git rev-parse failed: ${oneLine(pin.stderr)}`);
  const pinned = pin.exitCode === 0 ? pin.stdout.trim() : undefined;
  if (pinned !== undefined && pinned !== candidate) return conflict(`${ref} names ${pinned}`);
  if (!createCase(ctx, file, JSON.stringify(draft, null, 2) + '\n')) {
    report.existing.push(id);
    return;
  }
  if (pinned === undefined) {
    const created = gitStep(ctx, [...ctx.noHooks, 'update-ref', '--no-deref', ref, candidate, NO_REF]);
    if (created?.exitCode !== 0) {
      // A later export gives an existing file no ref, so a case kept here would stay unpinned for good.
      let detail = `git update-ref failed: ${created ? oneLine(created.stderr) : 'git did not run'}`;
      try {
        rmSync(file);
      } catch (err) {
        detail += `; ${file} stays unpinned: ${(err as Error).message}`;
      }
      return conflict(detail);
    }
  }
  report.written.push({ id, file, kind: draft.kind, candidate, base, ref });
}

/** The draft of a formal finding: its site comes from the reason, the way a cited reason's site does in a run. */
function bugDraft(run: CardRun, f: ReviewFinding): DraftInput {
  const site = citedSite(f.reason);
  return {
    source: f.id,
    candidate: f.candidateSha,
    origin: `${run.cardId} ${f.id} (goal ${run.goalId})`,
    note: `R3 decision ${f.round}, ${f.disposition}${f.resolvedAt ? ', resolved' : ''}: ${f.reason}`,
    ...(site ? { expected: [{ file: site.file, line: site.from, window: Math.min(MAX_SITE_WINDOW, Math.max(SITE_WINDOW, site.to - site.from)), class: draftClass(f.reason) }] } : { unusable: 'the reason cites no :n line' }),
  };
}

/** The draft of a run whose first decided R3 invocation passed; undefined for any other run. */
function cleanDraft(run: CardRun): DraftInput | undefined {
  const first = run.review.invocations.find((i) => i.outcome === 'pass' || i.outcome === 'block');
  if (first?.outcome !== 'pass') return undefined;
  return { source: 'clean', candidate: first.candidateSha, origin: `${run.cardId} clean (goal ${run.goalId})`, note: `R3 decision 1 passed (${first.reviewer})` };
}

/** The export writes only case files and refs, so neither may land under the state directory. */
function refuseStateOverlap(root: string, dir: string, stateDir: string, git: SyncRunner): void {
  if (resolvesInside(stateDir, dir)) throw new Error(`case directory ${dir} is under the state directory ${stateDir}`);
  const common = git('git', ['rev-parse', '--git-common-dir'], { cwd: root });
  if (common.exitCode !== 0) throw new Error(`git rev-parse --git-common-dir failed: ${oneLine(common.stderr)}`);
  const refs = path.resolve(root, common.stdout.trim(), 'refs');
  if (resolvesInside(stateDir, refs) || resolvesInside(refs, stateDir)) throw new Error(`the refs directory ${refs} and the state directory ${stateDir} overlap`);
}

/**
 * The `-c` options that turn every hook off for one command and change no config file. `core.hooksPath` covers a hooks
 * directory; a hook defined by `hook.<name>.event` (git 2.54 and later) still runs under it, so each one is disabled by name.
 */
function noHookOptions(root: string, git: SyncRunner): string[] {
  const named = git('git', ['config', '--null', '--name-only', '--get-regexp', '^hook\\..*\\.event$'], { cwd: root });
  if (named.exitCode !== 0 && named.exitCode !== 1) throw new Error(`git config failed: ${oneLine(named.stderr)}`);
  const keys = named.stdout.split('\0').filter(Boolean);
  return ['-c', 'core.hooksPath=/dev/null', ...keys.flatMap((key) => ['-c', `${key.slice(0, -'.event'.length)}.enabled=false`])];
}

/** Draft cases from the card runs; throws, before any draft, on a refusal. Changes only new case files and refs under `refs/aidlc/bench/`. */
export function exportBenchCases(o: BenchExportOptions): BenchExportReport {
  if (o.cardId === undefined && !o.clean) throw new Error('--card is required without --clean');
  const named = path.resolve(o.root, o.dir ?? path.join('evals', 'review'));
  if (!statSync(named, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`no case directory ${named}`);
  // Everything below uses the resolved path, so a link retargeted during the export changes nothing.
  const dir = realpathSync.native(named);
  const runner = o.git ?? runSync;
  // A git that ignores the first variable still tries a lazy fetch, and the second makes that fetch fail on any transport.
  const git: SyncRunner = (command, args, options) => runner(command, args, { ...options, env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: 'none' } });
  if (o.stateDir !== undefined && existsSync(o.stateDir)) refuseStateOverlap(o.root, dir, o.stateDir, git);
  const ctx: ExportContext = { root: o.root, dir, config: loadProjectConfig(o.root).config, git, noHooks: noHookOptions(o.root, git), report: { written: [], existing: [], skipped: [], pinConflicts: [] } };
  const runs = o.runs.filter((r) => o.cardId === undefined || r.cardId === o.cardId).sort((a, b) => a.goalId.localeCompare(b.goalId) || a.cardId.localeCompare(b.cardId));
  for (const run of runs) {
    const drafts = o.clean ? [cleanDraft(run)].filter((d) => d !== undefined) : run.findings.filter((f) => f.stage === 'formal').map((f) => bugDraft(run, f));
    for (const d of drafts) writeDraft(ctx, run, d);
  }
  return ctx.report;
}

/** The line form of an export: one line per entry. */
export function formatBenchExport(r: BenchExportReport): string {
  const lines = [
    ...r.written.map((w) => `written ${w.id} ${w.kind} ${w.candidate} ${w.file}`),
    ...r.existing.map((id) => `existing ${id}`),
    ...r.skipped.map((s) => `skipped ${s.card} ${s.goal} ${s.source}: ${s.detail}`),
    ...r.pinConflicts.map((c) => `pin conflict ${c.id}: ${c.detail}`),
  ];
  return lines.length ? lines.join('\n') : 'nothing to export';
}

/** The line form: one line per case and a totals line. */
export function formatBenchReport(r: ReviewBenchReport): string {
  const rate = (x: number | null) => (x === null ? '-' : x.toFixed(2));
  const t = r.totals;
  const lines = r.note ? [r.note] : [];
  lines.push(...r.cases.map((c) => `${c.id} ${c.kind} ${c.outcome}${c.runStatus ? ` (${c.runStatus})` : ''}${c.matched ? ` at ${c.matched.file}:${c.matched.line}` : ''}${c.detail ? `: ${c.detail}` : ''}`));
  lines.push(`${r.stage} ${r.reviewer}: recall ${rate(t.recall)} (${t.hits}/${t.hits + t.misses}), false-block rate ${rate(t.falseBlockRate)} (${t.falseBlocks}/${t.cleanPasses + t.falseBlocks}), no verdict ${t.noVerdict}, errors ${t.errors}, unconfirmed skipped ${t.skippedUnconfirmed}`);
  if (r.leftCheckouts.length) lines.push(`checkouts left behind: ${r.leftCheckouts.join(', ')}`);
  return lines.join('\n');
}
