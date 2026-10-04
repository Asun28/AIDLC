/**
 * Board view (plan v5 §5): a regenerated Markdown projection with a goal/revision header and
 * per-card status/dependencies/wave/worktree/PR/counters/blocker. It is never the only store
 * of clocks, approvals or history. It also reads and journals the bound firings (cards T1-BOUND-TELEMETRY and -2).
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BoundFired, BoundName, CardRun, Goal, JournalEvent, StopReason, type BoundEntry, type Card } from '../core/types.ts';
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
 * for each the goal's first `GOAL_DONE`, or `GOAL_STOPPED` with a stop reason, whose `at` is at or after the firing's `stoppedAt`, else open; an entry without its time counts after the key's first entry.
 */
export function boundsLine(journals: JournalEvent[][], damaged: string[] = [], pending: string[] = []): string {
  const tally = new Map<BoundName, Map<string, number>>();
  const seen = new Set<string>();
  for (const events of journals) events.forEach((e, i) => {
    const fired = e.type === 'BOUND_FIRED' ? BoundFired.safeParse(e.data).data : undefined;
    if (!fired || seen.has(fired.key)) return;
    seen.add(fired.key);
    const terminal = events.map((event, index) => ({ event, index })).filter(({ event }) => event.type === 'GOAL_DONE' || (event.type === 'GOAL_STOPPED' && StopReason.safeParse(event.data['reason']).success));
    const firingTime = fired.stoppedAt ? Date.parse(fired.stoppedAt) : undefined;
    const timed = firingTime === undefined ? [] : terminal.map(({ event }) => ({ event, at: typeof event.data['at'] === 'string' ? Date.parse(event.data['at']) : NaN })).filter(({ at }) => Number.isFinite(at) && at >= firingTime);
    const end = (timed.length ? timed.reduce((first, candidate) => candidate.at < first.at ? candidate : first).event : terminal.find(({ event, index }) => index > i && (firingTime === undefined || typeof event.data['at'] !== 'string'))?.event);
    const outcome = !end ? 'open' : end.type === 'GOAL_DONE' ? 'DONE' : `STOP/${String(end.data['reason'])}`;
    const counts = tally.get(fired.bound) ?? new Map([['DONE', 0], ['open', 0]]);
    tally.set(fired.bound, counts.set(outcome, (counts.get(outcome) ?? 0) + 1));
  });
  const parts = BoundName.options.filter((b) => tally.has(b)).map((b) => {
    const counts = tally.get(b)!;
    // Code-unit order puts DONE first, the STOP/<reason> entries next and open last.
    return `${b} ${[...counts.values()].reduce((n, c) => n + c, 0)} (${[...counts.keys()].sort().map((k) => `${k} ${counts.get(k)}`).join(', ')})`;
  });
  const incomplete = ([['lines that do not parse in', damaged], ['pending firings or unreadable records in', pending]] as const).filter(([, names]) => names.length).map(([what, names]) => `${what} ${names.map((d) => JSON.stringify(d)).join(', ')}`);
  return `Bounds: ${parts.join('; ') || 'none fired'}${incomplete.length ? `; incomplete: ${incomplete.join('; ')}` : ''}`;
}

/** What `read` returns, or undefined when it throws. */
function orUndefined<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** Whether nothing is at `file`: its lstat fails with ENOENT. A dangling link, or any other failure, is no absence and throws (card T1-BOUND-TELEMETRY-2). */
function absent(file: string): boolean {
  try {
    return !lstatSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw err;
  }
}

/** The events of one journal file that parse, read one line at a time; `damaged` when a line does not or the file cannot be read. */
function readEvents(file: string): { events: JournalEvent[]; damaged: boolean } {
  const lines = orUndefined(() => (absent(file) ? [] : readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())));
  if (!lines) return { events: [], damaged: true };
  const events = lines.flatMap((line) => orUndefined(() => [JournalEvent.parse(JSON.parse(line))]) ?? []);
  return { events, damaged: events.length < lines.length };
}

/** Journals a firing once per key, run by the outbox flush under the lock of the record that holds it; a journal that cannot be read in full refuses it. */
export function journalFiring(journal: Journal, entry: BoundEntry): void {
  const { events, damaged } = readEvents(journal.file);
  if (damaged) throw new Error(`${journal.file} cannot be read in full, so ${entry.data.key} is not known to be unjournaled`);
  if (!events.some((e) => e.type === 'BOUND_FIRED' && e.data['key'] === entry.data.key)) journal.append(entry);
}

/** The Bounds line over every goal journal file in `dir`, whatever the goal records say; a journal with lines that do not parse, or a `dir` that cannot be listed, is named, and so is every goal of `records` whose goal record or card run holds a `pendingFiring` or cannot be read. */
export function boundsOfJournals(dir: string, records?: { goals: string; cards: string }): string {
  const host = path.basename(Journal.host(dir).file);
  const list = (at: string) => orUndefined(() => (absent(at) ? [] : readdirSync(at)));
  const files = (at: string) => list(at)?.filter((f) => f.endsWith('.json')).sort().map((f) => path.join(at, f)) ?? [at];
  const pendingOrUnread = (file: string, schema: typeof Goal | typeof CardRun) => orUndefined(() => {
    const parsed = schema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success && parsed.data.pendingFiring === undefined;
  }) !== true;
  const pending = records ? (() => {
    const goalNames = files(records.goals).map((g) => path.basename(g, '.json'));
    const cardNames = list(records.cards) ?? [path.basename(records.cards)];
    return [...new Set([...goalNames, ...cardNames])].sort().filter((name) => {
      const goalFile = path.join(records.goals, `${name}.json`);
      return (goalNames.includes(name) && pendingOrUnread(goalFile, Goal)) || files(path.join(records.cards, name)).some((file) => pendingOrUnread(file, CardRun));
    });
  })() : [];
  const listed = list(dir);
  if (!listed) return boundsLine([], [path.basename(dir)], pending);
  const read = listed.filter((f) => f.endsWith('.jsonl') && f !== host).sort().map((f) => ({ name: f.slice(0, -'.jsonl'.length), ...readEvents(path.join(dir, f)) }));
  return boundsLine(read.map((r) => r.events), read.filter((r) => r.damaged).map((r) => r.name), pending);
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
