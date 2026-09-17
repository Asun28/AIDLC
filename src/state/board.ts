/**
 * Board view (plan v5 §5): a regenerated Markdown projection with a goal/revision header and
 * per-card status/dependencies/wave/worktree/PR/counters/blocker. It is never the only store
 * of clocks, approvals or history.
 */
import type { Card, CardRun, Goal } from '../core/types.ts';
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
 * `externalOutcomes` carries what the caller vouches for beyond this projection (a prerequisite merged under another
 * goal, from `prerequisitesClosedElsewhere`), so the Arc line reports the arc the controller decided instead of a gap
 * of the view's own making. Every projected card is written over it from its own run, and an id outside the projection
 * is no row of this board.
 */
export function renderBoard(goal: Goal, cards: Card[], runs: CardRun[], now: string, externalOutcomes: Record<string, CardOutcome> = {}): string {
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
  lines.push('');
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
