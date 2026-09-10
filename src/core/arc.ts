/**
 * Arc selection (plan v5 §5 "Arc selection and live changes", R28-R31, Q9/Q10).
 *
 * Cards are selected from the accepted dependency graph plus actual integrated prerequisite
 * evidence. Freeze cards run alone before dependents; a contraction migration step is a later
 * compatibility step. At most two workers, only with disjoint resources; `allow_paths`
 * disjointness alone does not isolate shared ports, databases or builds. A child STOP blocks
 * its dependents; an empty ready set with required gaps is WAIT or STOP, never DONE.
 */
import { MAX_WORKERS_DEFAULT, type Card, type CardId } from './types.ts';

export type CardOutcome = 'closed' | 'running' | 'stopped' | 'waiting' | 'todo';

export interface ArcInput {
  cards: Card[];
  outcomes: Record<string, CardOutcome>;
  maxWorkers?: number;
  /** A single formal reviewer slot forces one worker. */
  singleReviewerSlot?: boolean;
  /** Ownership/locking is verified; otherwise concurrency lowers to one. */
  ownershipControlsVerified?: boolean;
}

export interface ArcSelection {
  ready: CardId[];
  wave: CardId[];
  blockedByStop: CardId[];
  waitingOn: CardId[];
  workers: number;
  /** 'done' when everything is closed; 'wait' when work is running; 'stop' when gaps cannot progress. */
  verdict: 'dispatch' | 'wait' | 'done' | 'stop';
  reasons: string[];
}

export function topologicalOrder(cards: Card[]): { order: CardId[]; cycle?: CardId[] } {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const state = new Map<string, 0 | 1 | 2>();
  const order: CardId[] = [];
  const stack: CardId[] = [];
  let cycle: CardId[] | undefined;
  const visit = (id: CardId): void => {
    if (cycle) return;
    const s = state.get(id) ?? 0;
    if (s === 2) return;
    if (s === 1) {
      cycle = [...stack.slice(stack.indexOf(id)), id];
      return;
    }
    state.set(id, 1);
    stack.push(id);
    for (const dep of byId.get(id)?.depends_on ?? []) if (byId.has(dep)) visit(dep);
    stack.pop();
    state.set(id, 2);
    order.push(id);
  };
  for (const c of cards) visit(c.id);
  return cycle ? { order, cycle } : { order };
}

function pathsOverlap(a: string[], b: string[]): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  for (const x of a.map(norm)) {
    for (const y of b.map(norm)) {
      if (x === y || x.startsWith(y + '/') || y.startsWith(x + '/')) return true;
      if (x.includes('*') || y.includes('*')) return true; // wildcard: treat as overlap (conservative)
    }
  }
  return false;
}

/** Two cards are isolated only when paths AND declared shared resources are disjoint. */
export function resourcesDisjoint(a: Card, b: Card): boolean {
  if (pathsOverlap(a.allow_paths, b.allow_paths)) return false;
  const ra = new Set(a.resources.map((r) => r.toLowerCase()));
  for (const r of b.resources) if (ra.has(r.toLowerCase())) return false;
  if (a.parallelizable_with.length && !a.parallelizable_with.includes(b.id) && b.parallelizable_with.length && !b.parallelizable_with.includes(a.id)) return false;
  return true;
}

export function selectArc(input: ArcInput): ArcSelection {
  const reasons: string[] = [];
  const { order, cycle } = topologicalOrder(input.cards);
  if (cycle) {
    return { ready: [], wave: [], blockedByStop: [], waitingOn: [], workers: 0, verdict: 'stop', reasons: [`dependency cycle: ${cycle.join(' -> ')}`] };
  }
  const byId = new Map(input.cards.map((c) => [c.id, c]));
  const outcome = (id: string): CardOutcome => input.outcomes[id] ?? 'todo';
  const closed = (id: string) => outcome(id) === 'closed' || byId.get(id)?.status === 'merged';

  const blockedByStop: CardId[] = [];
  const waitingOn: CardId[] = [];
  const ready: CardId[] = [];
  for (const id of order) {
    if (closed(id)) continue;
    const o = outcome(id);
    if (o === 'running' || o === 'waiting') continue;
    if (o === 'stopped') continue;
    const deps = byId.get(id)?.depends_on ?? [];
    const stoppedDep = deps.find((d) => outcome(d) === 'stopped' || blockedByStop.includes(d));
    if (stoppedDep) {
      blockedByStop.push(id);
      continue;
    }
    const openDep = deps.find((d) => !closed(d));
    if (openDep) {
      waitingOn.push(id);
      continue;
    }
    ready.push(id);
  }
  const running = order.filter((id) => outcome(id) === 'running' || outcome(id) === 'waiting');
  const allClosed = order.every((id) => closed(id));
  if (allClosed) return { ready: [], wave: [], blockedByStop, waitingOn, workers: 0, verdict: 'done', reasons: ['all required cards closed; parent still verifies the integrated goal'] };

  // Worker cap
  let workers = Math.min(input.maxWorkers ?? MAX_WORKERS_DEFAULT, MAX_WORKERS_DEFAULT);
  if (input.singleReviewerSlot) {
    workers = 1;
    reasons.push('single reviewer slot: concurrency lowered to one');
  }
  if (input.ownershipControlsVerified === false) {
    workers = 1;
    reasons.push('ownership/locking not verified: concurrency lowered to one');
  }
  const freeSlots = Math.max(0, workers - running.length);

  // Freeze cards run alone, first.
  const freeze = ready.filter((id) => byId.get(id)?.freeze);
  const wave: CardId[] = [];
  if (freeze.length) {
    if (running.length === 0) {
      wave.push(freeze[0]!);
      reasons.push(`freeze card ${freeze[0]} runs alone before dependents`);
    } else {
      reasons.push(`freeze card ${freeze[0]} waits for running work to finish`);
    }
  } else {
    // Contraction steps go last among ready cards.
    const ordered = [...ready].sort((a, b) => Number(byId.get(a)?.migration_phase === 'contract') - Number(byId.get(b)?.migration_phase === 'contract'));
    const runningCards = running.map((id) => byId.get(id)!).filter(Boolean);
    for (const id of ordered) {
      if (wave.length >= freeSlots) break;
      const card = byId.get(id)!;
      if (card.migration_phase === 'contract' && ordered.some((o) => o !== id && byId.get(o)?.migration_phase !== 'contract')) {
        reasons.push(`contraction card ${id} deferred until compatibility steps close`);
        continue;
      }
      const conflicts = [...runningCards, ...wave.map((w) => byId.get(w)!)].filter((other) => !resourcesDisjoint(card, other));
      if (conflicts.length) {
        reasons.push(`${id} serialised: shares resources with ${conflicts.map((c) => c.id).join(',')}`);
        continue;
      }
      wave.push(id);
    }
  }

  let verdict: ArcSelection['verdict'];
  if (wave.length) verdict = 'dispatch';
  else if (running.length) verdict = 'wait';
  else if (ready.length) verdict = 'wait';
  else verdict = 'stop';
  if (verdict === 'stop') reasons.push(blockedByStop.length ? `blocked by stopped dependencies: ${blockedByStop.join(',')}` : 'no ready work and required gaps remain');
  return { ready, wave, blockedByStop, waitingOn, workers, verdict, reasons };
}

/** Integration repair cycle accounting (one bounded coherent repair per arc). */
export function canOpenIntegrationRepair(cyclesUsed: number, max = 1): { allowed: boolean; detail: string } {
  if (cyclesUsed >= max) return { allowed: false, detail: `integration repair cycle already used (${cyclesUsed}/${max}); STOP/arc-verify` };
  return { allowed: true, detail: 'one bounded in-scope repair cycle may create coherent repair cards' };
}
