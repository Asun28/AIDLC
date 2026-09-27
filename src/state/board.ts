/**
 * Board view (plan v5 §5): a regenerated Markdown projection with a goal/revision header and
 * per-card status/dependencies/wave/worktree/PR/counters/blocker. It is never the only store
 * of clocks, approvals or history.
 */
import { BoundFired, BoundName, StopReason, type Card, type CardRun, type Goal, type JournalEvent } from '../core/types.ts';
import { effectiveGoalDeadline } from '../core/deadlines.ts';
import { selectArc, type CardOutcome } from '../core/arc.ts';
import { formatStop } from '../core/stop.ts';

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
 * The Bounds line (card T1-BOUND-TELEMETRY): per bound fired in any journal, in the Limits table order, the firings and the
 * first terminal event of the goal after each, `GOAL_DONE` or a `GOAL_STOPPED` with a stop reason, else open.
 */
export function boundsLine(journals: JournalEvent[][]): string {
  const tally = new Map<BoundName, Map<string, number>>();
  for (const events of journals) events.forEach((e, i) => {
    const bound = e.type === 'BOUND_FIRED' ? BoundFired.safeParse(e.data).data?.bound : undefined;
    if (!bound) return;
    const end = events.slice(i + 1).find((t) => t.type === 'GOAL_DONE' || (t.type === 'GOAL_STOPPED' && StopReason.safeParse(t.data['reason']).success));
    const outcome = !end ? 'open' : end.type === 'GOAL_DONE' ? 'DONE' : `STOP/${String(end.data['reason'])}`;
    const counts = tally.get(bound) ?? new Map([['DONE', 0], ['open', 0]]);
    tally.set(bound, counts.set(outcome, (counts.get(outcome) ?? 0) + 1));
  });
  const parts = BoundName.options.filter((b) => tally.has(b)).map((b) => {
    const counts = tally.get(b)!;
    // Code-unit order puts DONE first, the STOP/<reason> entries next and open last.
    return `${b} ${[...counts.values()].reduce((n, c) => n + c, 0)} (${[...counts.keys()].sort().map((k) => `${k} ${counts.get(k)}`).join(', ')})`;
  });
  return `Bounds: ${parts.join('; ') || 'none fired'}`;
}

/**
 * `externalOutcomes` carries what the caller vouches for beyond this projection (a prerequisite merged under another
 * goal, from `prerequisitesClosedElsewhere`), so the Arc line reports the arc the controller decided instead of a gap
 * of the view's own making. Every projected card is written over it from its own run, and an id outside the projection
 * is no row of this board.
 */
export function renderBoard(goal: Goal, cards: Card[], runs: CardRun[], now: string, externalOutcomes: Record<string, CardOutcome> = {}, journals: JournalEvent[][] = []): string {
  const runById = new Map(runs.map((r) => [r.cardId, r]));
  const outcomes: Record<string, CardOutcome> = { ...externalOutcomes };
  for (const c of cards) outcomes[c.id] = outcomeOf(runById.get(c.id), c);
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
  lines.push(`- **Counters**: planning=${goal.counters.planningInvocations}/2 integration-repair=${goal.counters.integrationRepairCycles}/1 lifecycle-repair=${goal.counters.lifecycleRepairCycles}/1`);
  lines.push(`- **Arc**: verdict=${arc.verdict} workers=${arc.workers} wave=${arc.wave.join(',') || '-'} ready=${arc.ready.join(',') || '-'}`);
  if (goal.stop) lines.push(`- **STOP**: ${formatStop(goal.stop)}`);
  lines.push(`- **Rendered**: ${now} (view only; clocks, approvals and history live in .aidlc/)`);
  lines.push('', boundsLine(journals), '');
  lines.push('| | Card | State | Depends on | Wave | Worktree | PR | Reviews | CI reruns | Attempts | Deadline | Blocker |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const card of cards) {
    const run = runById.get(card.id);
    const state = card.status === 'merged' && !run ? 'DONE' : (run?.state ?? 'todo');
    const box = CHECKBOX[state] ?? '[ ]';
    const wave = arc.wave.includes(card.id) ? 'next' : arc.blockedByStop.includes(card.id) ? 'blocked' : arc.waitingOn.includes(card.id) ? 'waiting' : '';
    const pr = run?.pr ? `#${run.pr.number} ${run.pr.state}` : '';
    const reviews = run ? `${run.review.substantiveDecisions}/2 blocks=${run.review.substantiveBlocks} nv=${run.review.noVerdictRetriesUsed}` : '';
    const ci = run ? `${run.ci.reruns.length}/1` : '';
    const attempts = run?.effort ? `${run.effort.attempts.filter((a) => a.outcome !== 'not-counted').length}/4${run.effort.escalationUsed ? '↑' : ''}` : '';
    const blocker = run?.stop ? `${run.stop.reason}: ${run.stop.detail}` : (run?.blocker ?? '');
    lines.push(`| ${box} | ${card.id} | ${state} | ${card.depends_on.join(', ') || '-'} | ${wave} | ${run?.worktree ?? ''} | ${pr} | ${reviews} | ${ci} | ${attempts} | ${run?.deadline ?? ''} | ${blocker} |`);
  }
  lines.push('');
  if (arc.reasons.length) {
    lines.push('## Arc notes');
    for (const r of arc.reasons) lines.push(`- ${r}`);
    lines.push('');
  }
  return lines.join('\n');
}
