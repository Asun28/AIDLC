/**
 * Board view (plan v5 §5): a regenerated Markdown projection with a goal/revision header and
 * per-card status/dependencies/wave/worktree/PR/counters/blocker. It is never the only store
 * of clocks, approvals or history.
 */
import type { Card, CardRun, Goal, Lease } from '../core/types.ts';
import { effectiveGoalDeadline } from '../core/deadlines.ts';
import { selectArc, type CardOutcome } from '../core/arc.ts';
import { formatStop } from '../core/stop.ts';
import { readErrorCode } from './claims.ts';
import { asciiJson } from './bounds.ts';

const CHECKBOX: Record<string, string> = {
  todo: '[ ]',
  PREPARE: '[-]',
  BUILD: '[-]',
  SHIP: '[-]',
  REVIEW_FIX: '[R]',
  WAIT: '[?]',
  CLOSE: '[-]',
  DONE: '[x]',
  STOP: '[S]',
};

export function outcomeOf(run: CardRun | undefined, card: Card): CardOutcome {
  if (card.status === 'merged') return 'closed';
  if (!run) return 'todo';
  switch (run.state) {
    case 'DONE':
      return 'closed';
    case 'STOP':
      return 'stopped';
    case 'WAIT':
      return 'waiting';
    case 'PREPARE':
      return run.worktree ? 'running' : 'todo';
    default:
      return 'running';
  }
}

/**
 * `externalOutcomes` carries what the caller vouches for beyond this projection (a prerequisite merged under another
 * goal, from `prerequisitesClosedElsewhere`), so the Arc line reports the arc the controller decided instead of a gap
 * of the view's own making. Every projected card is written over it from its own run, and an id outside the projection
 * is no row of this board. `owners` holds the live card lease of each run stopped for ownership that the controller
 * counts as running (card T0-BOARD-OWNER-WAIT): that card's row and the Arc line show the goal's wait on its owner.
 */
export function renderBoard(goal: Goal, cards: Card[], runs: CardRun[], now: string, externalOutcomes: Record<string, CardOutcome> = {}, owners: ReadonlyMap<string, Lease> = new Map()): string {
  const runById = new Map(runs.map((r) => [r.cardId, r]));
  const outcomes: Record<string, CardOutcome> = { ...externalOutcomes };
  for (const c of cards) outcomes[c.id] = owners.has(c.id) ? 'running' : outcomeOf(runById.get(c.id), c);
  const arc = selectArc({ cards, outcomes, maxWorkers: goal.maxWorkers });
  const lines: string[] = [];
  lines.push(`# aidlc board — ${goal.id}`);
  lines.push('');
  lines.push(`- **Goal**: ${goal.revisions[goal.revisions.length - 1]?.request.text.slice(0, 140) ?? ''}`);
  lines.push(`- **Generation / revision**: ${goal.generation} / ${goal.revision}`);
  lines.push(`- **State**: ${goal.state}${goal.terminal ? ' (terminal)' : ''}`);
  lines.push(`- **Route**: size=${goal.routing.size} kind=${goal.routing.kind} target=${goal.target} modules=${goal.routing.modules.join('+')}`);
  lines.push(`- **Deadline**: ${effectiveGoalDeadline(goal.deadlines)} (created ${goal.deadlines.createdAt})`);
  lines.push(`- **Stages**: ${Object.entries(goal.stages).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  lines.push(`- **Counters**: planning=${goal.counters.planningInvocations}/2 integration-repair=${goal.counters.integrationRepairCycles}/1`);
  lines.push(`- **Arc**: verdict=${arc.verdict} workers=${arc.workers} wave=${arc.wave.join(',') || '-'} ready=${arc.ready.join(',') || '-'}`);
  if (goal.stop) lines.push(`- **STOP**: ${formatStop(goal.stop)}`);
  lines.push(`- **Rendered**: ${now} (view only; clocks, approvals and history live in .aidlc/)`);
  lines.push('');
  lines.push('| | Card | State | Depends on | Wave | Worktree | PR | Reviews | CI reruns | Attempts | Deadline | Blocker |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const card of cards) {
    const run = runById.get(card.id);
    const state = card.status === 'merged' && !run ? 'DONE' : (run?.state ?? 'todo');
    const owner = owners.get(card.id);
    const box = owner ? '[-]' : (CHECKBOX[state] ?? '[ ]');
    const wave = arc.wave.includes(card.id) ? 'next' : arc.blockedByStop.includes(card.id) ? 'blocked' : arc.waitingOn.includes(card.id) ? 'waiting' : '';
    const pr = run?.pr ? `#${run.pr.number} ${run.pr.state}` : '';
    const reviews = run ? `${run.review.substantiveDecisions}/2 blocks=${run.review.substantiveBlocks} nv=${run.review.noVerdictRetriesUsed}` : '';
    const ci = run ? `${run.ci.reruns.length}/1` : '';
    const attempts = run?.effort ? `${run.effort.attempts.filter((a) => a.outcome !== 'not-counted').length}/4${run.effort.escalationUsed ? '↑' : ''}` : '';
    const stopText = run?.stop ? `${run.stop.reason}: ${run.stop.detail}` : (run?.blocker ?? '');
    const blocker = owner ? `${stopText}; the goal waits on owner ${owner.owner.session} until ${owner.expiresAt}` : stopText;
    lines.push(`| ${box} | ${card.id} | ${owner ? `${state} (lease live)` : state} | ${card.depends_on.join(', ') || '-'} | ${wave} | ${run?.worktree ?? ''} | ${pr} | ${reviews} | ${ci} | ${attempts} | ${run?.deadline ?? ''} | ${blocker} |`);
  }
  lines.push('');
  if (arc.reasons.length) {
    lines.push('## Arc notes');
    for (const r of arc.reasons) lines.push(`- ${r}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** What `aidlc board --watch` reads, each call one record (card T1-BOARD-WATCH R2); a lease is labelled `goal` or by its card id. */
export interface WatchReads {
  goal(): Goal | undefined;
  run(cardId: string): CardRun | undefined;
  lease(label: string): Lease | undefined;
  registry(): ReadonlySet<string>;
}
/** A record as read, or the store error code it failed with (`readErrorCode`); `undefined` when there is none. */
type Got<T> = T | { unreadable: string } | undefined;
export interface WatchSnapshot {
  goalId: string;
  goal: Goal | { unreadable: string };
  runs: Map<string, Got<CardRun>>;
  leases: { label: string; lease: Got<Lease> }[];
  registry: ReadonlySet<string> | undefined; // undefined when unreadable: no card is marked
}

function attempt<T>(read: () => T | undefined): Got<T> {
  try { return read(); } catch (err) { return { unreadable: readErrorCode(err) }; }
}
/** One tick's reads: a record that cannot be read becomes its store error code (R4); nothing here writes. */
export function readWatch(goalId: string, reads: WatchReads): WatchSnapshot {
  const goal = attempt(reads.goal) ?? { unreadable: 'NOT_FOUND' };
  const cards = 'unreadable' in goal ? [] : goal.cards;
  const registry = attempt(reads.registry);
  return { goalId, goal,
    runs: new Map(cards.map((id) => [id, attempt(() => reads.run(id))])),
    leases: ['goal', ...cards].map((label) => ({ label, lease: attempt(() => reads.lease(label)) })),
    registry: registry && 'has' in registry ? registry : undefined,
  };
}

/** A plain identifier: the watch prints it as is, and `board --watch` accepts only such a goal id. */
export const PLAIN_ID = /^[A-Za-z0-9._:-]{1,64}$/;
/** The one encoding point for record text on the watch screen (R3): a plain identifier as is, anything else as escaped JSON. */
const shown = (text: string): string => (PLAIN_ID.test(text) ? text : asciiJson(text));
/** The card registry as the watch reads it: the card ids only, so no title or other card text can reach the screen (R3). */
export const watchRegistry = (cards: readonly { card: { id: string } }[]): ReadonlySet<string> => new Set(cards.map((p) => p.card.id));

/** One `aidlc board --watch` screen (Output contract of card T1-BOARD-WATCH): record text appears only as enum values, card
 *  ids, integers, ISO timestamps and `shown` identifiers, never a stop detail, next action, blocker, title or request text. */
export function renderWatch(s: WatchSnapshot, now: string): string {
  const goalId = shown(s.goalId);
  const lines = [`aidlc watch: ${goalId} at ${now} (view only; Ctrl+C ends it)`];
  const { goal } = s;
  if ('unreadable' in goal) return [...lines, `state unreadable: ${goal.unreadable}`].join('\n');
  lines.push(`Goal: ${goal.state}${goal.terminal ? ' (terminal)' : ''}, generation ${goal.generation}, revision ${goal.revision}, deadline ${effectiveGoalDeadline(goal.deadlines)}`);
  if (goal.stop) lines.push(`Stop: ${goal.stop.reason}`);
  lines.push('Cards:');
  for (const id of goal.cards) {
    const run = s.runs.get(id);
    if (run && 'unreadable' in run) lines.push(`  ${id} unreadable: ${run.unreadable}`);
    else lines.push(`  ${id} ${run?.state ?? 'todo'}${run?.stop ? ` stop ${run.stop.reason}` : ''}${run?.blocker ? ' blocker' : ''}${s.registry && !s.registry.has(id) ? ' not in the card registry' : ''}`);
  }
  if (!goal.cards.length) lines.push('  (none)');
  lines.push('Leases:');
  // A live lease is unreleased and not expired at `now`; a missing, released or expired one is no row.
  const rows = s.leases.flatMap(({ label, lease: l }) => (!l ? [] : 'unreadable' in l ? [`  ${label} unreadable: ${l.unreadable}`]
    : !l.released && Date.parse(l.expiresAt) >= Date.parse(now) ? [`  ${label} owner ${shown(l.owner.session)} host ${shown(l.owner.host)} generation ${l.generation} until ${l.expiresAt}`] : []));
  lines.push(...(rows.length ? rows : ['  (none)']), `Next: not computed (view only); run aidlc next --goal ${goalId}`);
  return lines.join('\n');
}
