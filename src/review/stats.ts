/**
 * Review statistics over persisted card runs (plan review-findings R11, R12).
 *
 * Pure over the two review ledgers of a card run and the card registry: no I/O and no clock, so the
 * same runs always produce the same summary. Every number is read off what the ledgers persist:
 * the R2 rounds carry their own duration, the R3 decisions carry a request time and land a decision
 * artifact in the run's evidence (`r3-<stem>` for invocation `r3:<stem>`, written by
 * `CardRunner.commitFormalResult`), and the findings carry their disposition, re-raises and
 * first-round-miss label.
 */
import type { CardRun, PreReviewRound, ReviewFinding, ReviewInvocation } from '../core/types.ts';

export interface R2Stats {
  /** Decided rounds: a round still reserved (`pending`) is a dispatch in flight, not a round. */
  rounds: number;
  blocks: number;
  noVerdict: number;
  quotaHolds: number;
  /** Sum of the measured round durations. */
  durationMs: number;
  /** Blocking panel angles, by name; a blocked round with no panel record counts under its reviewer. */
  blocksByPerspective: Record<string, number>;
}

export interface R3Stats {
  /** Substantive decisions the ledger counted (a no-verdict or a quota hold is not one). */
  decisions: number;
  /** Recorded block decisions, an advisory block included; the enforcement counter counts only the merge-blocking ones. */
  blocks: number;
  /** Sum of request to decision artifact over the invocations that landed one. */
  durationMs: number;
}

export interface FindingStats {
  total: number;
  pre: number;
  formal: number;
  /** Unresolved and not disputed. `open + disputed + resolved === total`. */
  open: number;
  disputed: number;
  reraised: number;
  firstRoundMiss: number;
  resolved: number;
}

/**
 * Acceptance coverage over the rounds that asked for it (`preReview.coverage: shadow`), read off the
 * `coverage` record each round retains and the findings, never off a verdict or a later classification.
 */
export interface CoverageStats {
  /** Decided rounds carrying a coverage record; a round that asked for none is not one. */
  roundsRequested: number;
  /** Of those, the rounds with no unaccounted, conflicted or inconsistent item and no malformed entry. */
  roundsComplete: number;
  /** Items no angle accounted for, summed over the rounds. */
  unaccounted: number;
  /** Items one angle called supported and another violated, summed over the rounds. */
  conflicted: number;
  /** Items a passing angle marked violated, summed over the rounds. */
  inconsistent: number;
  /**
   * Formal findings on the spec axis raised on a candidate whose last decided R2 round left an item
   * unaccounted: the question a required mode would answer, measured per candidate.
   */
  r3SpecFindingsAfterIncomplete: number;
}

export interface CardReviewStats {
  cardId: string;
  /** The goal that ran the card; absent when several goals ran it, whose runs the numbers below cover together. */
  goalId?: string;
  r2: R2Stats;
  r3: R3Stats;
  findings: FindingStats;
  coverage: CoverageStats;
  /**
   * First review request to the last pass, or to the last review when none passed, each review measured
   * to the completion its artifact records. A pass is a recorded pass of either stage: an advisory block
   * opens the ship without being one, so a card whose last decision is an advisory block measures to its
   * last pass, and to that block when nothing passed.
   */
  wallMs: number;
  family?: FamilyStats;
}

export interface FamilyStats {
  /** The predecessors this card supersedes, oldest first. */
  members: CardReviewStats[];
  /** The members and this card together. */
  totals: { r2: R2Stats; r3: R3Stats; findings: FindingStats; coverage: CoverageStats; wallMs: number };
}

/** The registry fields the family chain needs. */
export interface RegistryCard {
  id: string;
  superseded_by?: string;
}

/** One review dispatch on the card's timeline: R2 round or R3 decision. */
interface ReviewEvent {
  startedAt: string;
  endedAt: string;
  passed: boolean;
}

const ms = (iso: string): number => Date.parse(iso);

/** Counters while they are being added up: the angles live in a Map, so an angle named after an Object property is a count and not an inherited value. */
interface R2Counters extends Omit<R2Stats, 'blocksByPerspective'> {
  blocksByPerspective: Map<string, number>;
}

function emptyR2(): R2Counters {
  return { rounds: 0, blocks: 0, noVerdict: 0, quotaHolds: 0, durationMs: 0, blocksByPerspective: new Map() };
}

function sealR2(counters: R2Counters): R2Stats {
  return { ...counters, blocksByPerspective: Object.fromEntries([...counters.blocksByPerspective].sort(([a], [b]) => a.localeCompare(b))) };
}

function emptyR3(): R3Stats {
  return { decisions: 0, blocks: 0, durationMs: 0 };
}

function emptyCoverage(): CoverageStats {
  return { roundsRequested: 0, roundsComplete: 0, unaccounted: 0, conflicted: 0, inconsistent: 0, r3SpecFindingsAfterIncomplete: 0 };
}

function emptyFindings(): FindingStats {
  return { total: 0, pre: 0, formal: 0, open: 0, disputed: 0, reraised: 0, firstRoundMiss: 0, resolved: 0 };
}

/**
 * The decision artifact of a formal invocation: `commitFormalResult` writes evidence `r3-<stem>` for
 * invocation id `r3:<stem>`, with the time the decision was committed.
 */
function decidedAt(run: CardRun, invocation: ReviewInvocation): string | undefined {
  const stem = invocation.invocationId.startsWith('r3:') ? invocation.invocationId.slice(3) : invocation.invocationId;
  return run.evidence.find((e) => e.id === `r3-${stem}`)?.createdAt;
}

function countR2(rounds: readonly PreReviewRound[], into: R2Counters): R2Counters {
  for (const round of rounds) {
    if (round.outcome === 'pending') continue;
    into.rounds += 1;
    into.durationMs += round.durationMs;
    if (round.outcome === 'no-verdict') into.noVerdict += 1;
    if (round.outcome === 'quota-hold') into.quotaHolds += 1;
    if (round.outcome !== 'block') continue;
    into.blocks += 1;
    const blocking = (round.perspectives ?? []).filter((p) => p.outcome === 'block');
    for (const name of blocking.length ? blocking.map((p) => p.name) : [round.reviewer]) into.blocksByPerspective.set(name, (into.blocksByPerspective.get(name) ?? 0) + 1);
  }
  return into;
}

/** A reason's axis tag, read the way `enforceCitations` reads the reviewer's own text. */
const SPEC_TAG = /^\s*\[spec\]/i;

/**
 * The coverage of a card over every run that carries it, like every other field of `statsFor`: the
 * record each decided round retained, and the formal spec findings raised on a candidate the R2 rounds
 * left incomplete. A candidate is incomplete when the last decided round on it reported an unaccounted
 * item, so a later round that accounted for everything, or asked for no coverage at all, ends the
 * question for that candidate. The rounds of one run and the findings of another can name the same
 * candidate, so both sides are joined across the runs before they are matched: the rounds of a card are
 * requested one at a time, so `requestedAt` orders them, and the sort is stable, which keeps the order
 * a run's ledger persisted when two rounds carry the same request time. The shas live in a Map and a
 * Set, so a candidate named after an Object property is a record and not an inherited value.
 */
function countCoverage(runs: readonly CardRun[], into: CoverageStats): CoverageStats {
  const decided: PreReviewRound[] = [];
  for (const run of runs) for (const round of run.preReview.rounds) if (round.outcome !== 'pending') decided.push(round);
  for (const round of decided) {
    const coverage = round.coverage;
    if (!coverage) continue;
    into.roundsRequested += 1;
    into.unaccounted += coverage.unaccounted.length;
    into.conflicted += coverage.conflicted.length;
    into.inconsistent += coverage.inconsistent.length;
    if (!coverage.unaccounted.length && !coverage.conflicted.length && !coverage.inconsistent.length && !coverage.malformed) into.roundsComplete += 1;
  }
  const lastDecided = new Map<string, PreReviewRound>();
  for (const round of [...decided].sort((a, b) => ms(a.requestedAt) - ms(b.requestedAt))) if (round.candidateSha) lastDecided.set(round.candidateSha, round);
  const incomplete = new Set([...lastDecided].filter(([, round]) => round.coverage?.unaccounted.length).map(([sha]) => sha));
  for (const run of runs) for (const f of run.findings) if (f.stage === 'formal' && f.candidateSha && incomplete.has(f.candidateSha) && SPEC_TAG.test(f.reason)) into.r3SpecFindingsAfterIncomplete += 1;
  return into;
}

function countFindings(findings: readonly ReviewFinding[], into: FindingStats): FindingStats {
  for (const f of findings) {
    into.total += 1;
    if (f.stage === 'pre') into.pre += 1;
    else into.formal += 1;
    if (f.resolvedAt) into.resolved += 1;
    else if (f.disposition === 'disputed') into.disputed += 1;
    else into.open += 1;
    if (f.reraised.length) into.reraised += 1;
    if (f.outsideDelta) into.firstRoundMiss += 1;
  }
  return into;
}

/**
 * When a pre-review round ended: the artifact `commitPreReviewResult` writes for it
 * (`pre-review-<cycle>-<round>-<attempt>`, the attempt taken from the round's reservation id), whose
 * `createdAt` also covers the wait between the request and the reviewer (the diff, the prompt, pool
 * admission). A round with no such artifact (one still in flight, or a record from before the
 * reservation id existed) falls back to the measured reviewer runtime after the request.
 */
function roundEndedAt(run: CardRun, round: PreReviewRound): string {
  const measured = ms(round.requestedAt) + round.durationMs;
  const attempt = round.reservationId?.split('.').at(-2);
  const artifact = attempt ? run.evidence.find((e) => e.id === `pre-review-${round.cycle}-${round.round}-${attempt}`) : undefined;
  return new Date(artifact ? Math.max(measured, ms(artifact.createdAt)) : measured).toISOString();
}

function eventsOf(run: CardRun): ReviewEvent[] {
  const events: ReviewEvent[] = [];
  for (const round of run.preReview.rounds) events.push({ startedAt: round.requestedAt, endedAt: roundEndedAt(run, round), passed: round.outcome === 'pass' });
  for (const invocation of run.review.invocations) events.push({ startedAt: invocation.requestedAt, endedAt: decidedAt(run, invocation) ?? invocation.requestedAt, passed: invocation.outcome === 'pass' });
  return events;
}

/** First request to the last pass, or to the last review when none passed (an advisory block is not a pass); no reviews is zero. */
function wallOf(events: readonly ReviewEvent[]): number {
  if (!events.length) return 0;
  const start = Math.min(...events.map((e) => ms(e.startedAt)));
  const passed = events.filter((e) => e.passed);
  const end = Math.max(...(passed.length ? passed : events).map((e) => ms(e.endedAt)));
  return Math.max(0, end - start);
}

/** The summary of one card, over every run that carries it (normally one). */
function statsFor(cardId: string, runs: readonly CardRun[]): CardReviewStats {
  const r2 = emptyR2();
  const r3 = emptyR3();
  const findings = emptyFindings();
  const coverage = emptyCoverage();
  const events: ReviewEvent[] = [];
  countCoverage(runs, coverage);
  for (const run of runs) {
    countR2(run.preReview.rounds, r2);
    countFindings(run.findings, findings);
    r3.decisions += run.review.substantiveDecisions;
    for (const invocation of run.review.invocations) {
      // Every recorded block, read from the decision itself: the ledger's `substantiveBlocks` counts only the merge-blocking ones.
      if (invocation.outcome === 'block') r3.blocks += 1;
      const at = decidedAt(run, invocation);
      if (at) r3.durationMs += Math.max(0, ms(at) - ms(invocation.requestedAt));
    }
    events.push(...eventsOf(run));
  }
  const goals = [...new Set(runs.map((r) => r.goalId))];
  return { cardId, ...(goals.length === 1 ? { goalId: goals[0] } : {}), r2: sealR2(r2), r3, findings, coverage, wallMs: wallOf(events) };
}

/** Predecessors of every card: the reverse of the registry's `superseded_by` links. */
function predecessorIndex(registry: readonly RegistryCard[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const card of registry) {
    if (!card.superseded_by) continue;
    index.set(card.superseded_by, [...(index.get(card.superseded_by) ?? []), card.id]);
  }
  return index;
}

/**
 * The cards `cardId` supersedes, oldest first: the chain walked backwards level by level, then reversed,
 * so the card that started the family comes first. A card already seen is never walked twice, so a
 * `superseded_by` cycle in the registry terminates.
 */
function familyOf(cardId: string, index: Map<string, string[]>): string[] {
  const levels: string[][] = [];
  const seen = new Set([cardId]);
  let frontier = [cardId];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const predecessor of index.get(id) ?? []) {
        if (seen.has(predecessor)) continue;
        seen.add(predecessor);
        next.push(predecessor);
      }
    }
    if (next.length) levels.push([...next].sort());
    frontier = next;
  }
  return levels.reverse().flat();
}

function totalsOf(summaries: readonly CardReviewStats[]): FamilyStats['totals'] {
  const r2 = emptyR2();
  const r3 = emptyR3();
  const findings = emptyFindings();
  const coverage = emptyCoverage();
  let wallMs = 0;
  for (const s of summaries) {
    r2.rounds += s.r2.rounds;
    r2.blocks += s.r2.blocks;
    r2.noVerdict += s.r2.noVerdict;
    r2.quotaHolds += s.r2.quotaHolds;
    r2.durationMs += s.r2.durationMs;
    for (const [name, count] of Object.entries(s.r2.blocksByPerspective)) r2.blocksByPerspective.set(name, (r2.blocksByPerspective.get(name) ?? 0) + count);
    r3.decisions += s.r3.decisions;
    r3.blocks += s.r3.blocks;
    r3.durationMs += s.r3.durationMs;
    findings.total += s.findings.total;
    findings.pre += s.findings.pre;
    findings.formal += s.findings.formal;
    findings.open += s.findings.open;
    findings.disputed += s.findings.disputed;
    findings.reraised += s.findings.reraised;
    findings.firstRoundMiss += s.findings.firstRoundMiss;
    findings.resolved += s.findings.resolved;
    coverage.roundsRequested += s.coverage.roundsRequested;
    coverage.roundsComplete += s.coverage.roundsComplete;
    coverage.unaccounted += s.coverage.unaccounted;
    coverage.conflicted += s.coverage.conflicted;
    coverage.inconsistent += s.coverage.inconsistent;
    coverage.r3SpecFindingsAfterIncomplete += s.coverage.r3SpecFindingsAfterIncomplete;
    wallMs += s.wallMs;
  }
  return { r2: sealR2(r2), r3, findings, coverage, wallMs };
}

/**
 * The review statistics of every card the runs cover, by card id, each with the family it supersedes.
 * `include` adds cards that have no run yet, so a command asked about one card always answers about it.
 * `goals` narrows which cards are reported, never what the family is aggregated from: every run given
 * feeds the family, so a predecessor that ran under another goal keeps its own numbers.
 */
export function summarizeReviews(runs: readonly CardRun[], registry: readonly RegistryCard[], options: { include?: readonly string[]; goals?: readonly string[] } = {}): CardReviewStats[] {
  const byCard = new Map<string, CardRun[]>();
  for (const run of runs) byCard.set(run.cardId, [...(byCard.get(run.cardId) ?? []), run]);
  for (const id of options.include ?? []) if (!byCard.has(id)) byCard.set(id, []);
  const index = predecessorIndex(registry);
  const own = new Map([...byCard.entries()].map(([cardId, cardRuns]) => [cardId, statsFor(cardId, cardRuns)] as const));
  const goals = options.goals;
  const reported = goals ? new Set([...(options.include ?? []), ...runs.filter((run) => goals.includes(run.goalId)).map((run) => run.cardId)]) : undefined;
  const summaries: CardReviewStats[] = [];
  for (const [cardId, summary] of own) {
    if (reported && !reported.has(cardId)) continue;
    // A predecessor with no run of its own still belongs to the family, with zeros.
    const members = familyOf(cardId, index).map((id) => own.get(id) ?? statsFor(id, []));
    summaries.push(members.length ? { ...summary, family: { members, totals: totalsOf([...members, summary]) } } : summary);
  }
  return summaries.sort((a, b) => a.cardId.localeCompare(b.cardId));
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A measured duration for a reader: seconds under a minute, minutes and seconds under an hour, then hours and minutes. */
export function durationText(totalMs: number): string {
  if (totalMs < 60_000) return `${Number((totalMs / 1000).toFixed(1))}s`;
  if (totalMs < 3_600_000) return `${Math.floor(totalMs / 60_000)}m ${String(Math.floor((totalMs % 60_000) / 1000)).padStart(2, '0')}s`;
  return `${Math.floor(totalMs / 3_600_000)}h ${String(Math.floor((totalMs % 3_600_000) / 60_000)).padStart(2, '0')}m`;
}

function r2Text(s: R2Stats): string {
  const parts = [plural(s.rounds, 'round')];
  if (s.blocks) {
    const by = Object.entries(s.blocksByPerspective)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, n]) => `${name} ${n}`)
      .join(', ');
    parts.push(`${plural(s.blocks, 'block')}${by ? ` (${by})` : ''}`);
  }
  if (s.noVerdict) parts.push(`${s.noVerdict} no-verdict`);
  if (s.quotaHolds) parts.push(plural(s.quotaHolds, 'quota hold'));
  parts.push(durationText(s.durationMs));
  return `R2 ${parts.join(', ')}`;
}

function r3Text(s: R3Stats): string {
  const parts = [plural(s.decisions, 'decision')];
  if (s.blocks) parts.push(plural(s.blocks, 'block'));
  parts.push(durationText(s.durationMs));
  return `R3 ${parts.join(', ')}`;
}

function findingsText(s: FindingStats): string {
  const parts: string[] = [];
  if (s.pre) parts.push(`${s.pre} pre`);
  if (s.formal) parts.push(`${s.formal} formal`);
  if (s.open) parts.push(`${s.open} open`);
  if (s.disputed) parts.push(`${s.disputed} disputed`);
  if (s.resolved) parts.push(`${s.resolved} resolved`);
  if (s.reraised) parts.push(`${s.reraised} re-raised`);
  if (s.firstRoundMiss) parts.push(`${s.firstRoundMiss} first-round miss`);
  return `findings ${s.total}${parts.length ? `: ${parts.join(', ')}` : ''}`;
}

/** `not requested` when no round asked for coverage; otherwise the completeness of the rounds that did. */
function coverageText(s: CoverageStats): string {
  if (!s.roundsRequested) return 'coverage: not requested';
  return `coverage: ${s.roundsComplete}/${s.roundsRequested} complete, unaccounted ${s.unaccounted}, conflicted ${s.conflicted}, inconsistent ${s.inconsistent}, r3 spec findings after incomplete ${s.r3SpecFindingsAfterIncomplete}`;
}

function statsLine(label: string, s: { r2: R2Stats; r3: R3Stats; findings: FindingStats; coverage: CoverageStats; wallMs: number }): string {
  return `${label}  ${r2Text(s.r2)} | ${r3Text(s.r3)} | ${findingsText(s.findings)} | ${coverageText(s.coverage)} | wall ${durationText(s.wallMs)}`;
}

/** One line per card, each family member under the card that supersedes it, then the family total. */
export function formatReviewStats(summaries: readonly CardReviewStats[]): string {
  if (!summaries.length) return 'no card runs';
  const lines: string[] = [];
  for (const summary of summaries) {
    lines.push(statsLine(summary.cardId, summary));
    if (!summary.family) continue;
    for (const member of summary.family.members) lines.push(`  + ${statsLine(member.cardId, member)}`);
    lines.push(`  = ${statsLine(`family total (${summary.family.members.length + 1} cards)`, summary.family.totals)}`);
  }
  return lines.join('\n');
}
