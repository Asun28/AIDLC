/**
 * Board view (plan v5 §5): a regenerated Markdown projection with a goal/revision header and
 * per-card status/dependencies/wave/worktree/PR/counters/blocker. It is never the only store
 * of clocks, approvals or history. It also reads and journals the bound firings (card T1-BOUND-TELEMETRY).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BoundFired, BoundName, JournalEvent, StopReason, type BoundEntry, type Card, type CardRun, type Goal } from '../core/types.ts';
import { Journal } from './journal.ts';
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
 * The Bounds line: per bound, in the Limits table order, its distinct firings (a key the journal holds twice counts once) and
 * for each the goal's first `GOAL_DONE`, or `GOAL_STOPPED` with a stop reason, after the key's first entry, else open.
 */
export function boundsLine(journals: JournalEvent[][], damaged: string[] = []): string {
  const tally = new Map<BoundName, Map<string, number>>();
  const seen = new Set<string>();
  for (const events of journals) events.forEach((e, i) => {
    const fired = e.type === 'BOUND_FIRED' ? BoundFired.safeParse(e.data).data : undefined;
    if (!fired || seen.has(fired.key)) return;
    seen.add(fired.key);
    const end = events.slice(i + 1).find((t) => t.type === 'GOAL_DONE' || (t.type === 'GOAL_STOPPED' && StopReason.safeParse(t.data['reason']).success));
    const outcome = !end ? 'open' : end.type === 'GOAL_DONE' ? 'DONE' : `STOP/${String(end.data['reason'])}`;
    const counts = tally.get(fired.bound) ?? new Map([['DONE', 0], ['open', 0]]);
    tally.set(fired.bound, counts.set(outcome, (counts.get(outcome) ?? 0) + 1));
  });
  const parts = BoundName.options.filter((b) => tally.has(b)).map((b) => {
    const counts = tally.get(b)!;
    // Code-unit order puts DONE first, the STOP/<reason> entries next and open last.
    return `${b} ${[...counts.values()].reduce((n, c) => n + c, 0)} (${[...counts.keys()].sort().map((k) => `${k} ${counts.get(k)}`).join(', ')})`;
  });
  const incomplete = damaged.length ? `; incomplete: lines that do not parse in ${damaged.map((d) => JSON.stringify(d)).join(', ')}` : '';
  return `Bounds: ${parts.join('; ') || 'none fired'}${incomplete}`;
}

/** What `read` returns, or undefined when it throws. */
function orUndefined<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** The events of one journal file that parse, read one line at a time; `damaged` when a line does not or the file cannot be read. */
function readEvents(file: string): { events: JournalEvent[]; damaged: boolean } {
  const lines = orUndefined(() => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()) : []));
  if (!lines) return { events: [], damaged: true };
  const events = lines.flatMap((line) => orUndefined(() => [JournalEvent.parse(JSON.parse(line))]) ?? []);
  return { events, damaged: events.length < lines.length };
}

/** Journals a firing once per key. The caller runs it under the lock that guards the save of the stop it causes, before that save. */
export function journalFiring(journal: Journal, entry: BoundEntry): void {
  if (!readEvents(journal.file).events.some((e) => e.type === 'BOUND_FIRED' && e.data['key'] === entry.data.key)) journal.append(entry);
}

/** The Bounds line over every goal journal file in `dir`, whatever the goal records say; a journal with lines that do not parse, or a `dir` that cannot be listed, is named. */
export function boundsOfJournals(dir: string): string {
  const host = path.basename(Journal.host(dir).file);
  const listed = orUndefined(() => (existsSync(dir) ? readdirSync(dir) : []));
  if (!listed) return boundsLine([], [path.basename(dir)]);
  const files = listed.filter((f) => f.endsWith('.jsonl') && f !== host).sort();
  const read = files.map((f) => ({ name: f.slice(0, -'.jsonl'.length), ...readEvents(path.join(dir, f)) }));
  return boundsLine(read.map((r) => r.events), read.filter((r) => r.damaged).map((r) => r.name));
}

/**
 * `externalOutcomes` carries what the caller vouches for beyond this projection (a prerequisite merged under another
 * goal, from `prerequisitesClosedElsewhere`), so the Arc line reports the arc the controller decided instead of a gap
 * of the view's own making. Every projected card is written over it from its own run, and an id outside the projection
 * is no row of this board.
 */
export function renderBoard(goal: Goal, cards: Card[], runs: CardRun[], now: string, externalOutcomes: Record<string, CardOutcome> = {}, bounds = boundsLine([])): string {
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
  lines.push('', bounds, '');
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
