/**
 * Goal state machine (plan v5 §5 state diagram, §6 LC1/LC11).
 *
 * PLAN -> CARDS -> RUN -> VERIFY_ARC -> (CLOSE | DELIVER) -> CLOSE -> DONE, with WAIT and STOP
 * reachable as the diagram permits. Transitions are validated; guards express the plan's
 * completion rules: an empty board or green cards alone never make a goal DONE, a disabled
 * optional stage is `not_requested`, and terminal goals accept no new work.
 */
import type { DeliveryTarget, Goal, GoalState, StageStatus, StopRecord } from './types.ts';

export const GOAL_TRANSITIONS: Record<GoalState, GoalState[]> = {
  PLAN: ['CARDS', 'WAIT', 'STOP'],
  CARDS: ['RUN', 'STOP', 'PLAN'],
  RUN: ['RUN', 'WAIT', 'VERIFY_ARC', 'STOP'],
  WAIT: ['RUN', 'PLAN', 'DELIVER', 'STOP', 'CARDS'],
  VERIFY_ARC: ['CARDS', 'CLOSE', 'DELIVER', 'STOP'],
  DELIVER: ['WAIT', 'CARDS', 'CLOSE', 'STOP'],
  CLOSE: ['DONE', 'STOP'],
  DONE: [],
  STOP: [],
};

export class GoalTransitionError extends Error {
  constructor(from: GoalState, to: GoalState, reason: string) {
    super(`goal transition ${from} -> ${to} refused: ${reason}`);
  }
}

export interface GoalGuards {
  /** Sufficient accepted intent / design for CARDS. */
  intentAccepted?: boolean;
  /** Validated and authorized projection for RUN (T2: plan + projection approved together). */
  projectionAuthorized?: boolean;
  /** All required cards closed with integrated prerequisite evidence. */
  requiredCardsClosed?: boolean;
  /** Integrated acceptance on the final SHA passed (cross-card behaviour for multi-card arcs). */
  integratedAcceptancePassed?: boolean;
  /** Requested delivery target verified (package/staging/production evidence). */
  deliveryVerified?: boolean;
  /** Closure complete: metadata, doc sync, findings, evidence, cleanup, terminal accounting. */
  closureComplete?: boolean;
  /** Bounded repair cycle available (VERIFY_ARC -> CARDS, DELIVER -> CARDS). */
  repairCycleAvailable?: boolean;
  /** Accepted revision moving WAIT back to PLAN. */
  revisionAccepted?: boolean;
}

export function assertGoalTransition(goal: Goal, to: GoalState, guards: GoalGuards = {}): void {
  const from = goal.state;
  if (goal.terminal) throw new GoalTransitionError(from, to, 'goal is terminal; fresh user-authorized continuation links a new generation');
  if (from !== to && !GOAL_TRANSITIONS[from].includes(to)) throw new GoalTransitionError(from, to, 'not in the accepted state diagram');
  switch (to) {
    case 'CARDS':
      if (from === 'PLAN' && !guards.intentAccepted) throw new GoalTransitionError(from, to, 'insufficient accepted intent/design');
      if ((from === 'VERIFY_ARC' || from === 'DELIVER') && !guards.repairCycleAvailable) throw new GoalTransitionError(from, to, 'bounded repair cycle already used');
      break;
    case 'RUN':
      if (from === 'CARDS' && !guards.projectionAuthorized) throw new GoalTransitionError(from, to, 'projection not validated/authorized');
      break;
    case 'VERIFY_ARC':
      if (!guards.requiredCardsClosed) throw new GoalTransitionError(from, to, 'required cards not closed; an empty ready set with gaps is WAIT or STOP, never DONE');
      break;
    case 'DELIVER':
      if (from === 'VERIFY_ARC' && !guards.integratedAcceptancePassed) throw new GoalTransitionError(from, to, 'integrated acceptance not passed');
      if (goal.target === 'development') throw new GoalTransitionError(from, to, 'development-only goal has no delivery stage');
      break;
    case 'CLOSE':
      if (from === 'VERIFY_ARC' && !guards.integratedAcceptancePassed) throw new GoalTransitionError(from, to, 'integrated acceptance not passed');
      if (from === 'VERIFY_ARC' && goal.target !== 'development') throw new GoalTransitionError(from, to, `target ${goal.target} requires DELIVER before CLOSE`);
      if (from === 'DELIVER' && !guards.deliveryVerified) throw new GoalTransitionError(from, to, 'requested delivery target not verified');
      break;
    case 'DONE':
      if (!guards.closureComplete) throw new GoalTransitionError(from, to, 'closure incomplete');
      break;
    case 'PLAN':
      if (from === 'WAIT' && !guards.revisionAccepted) throw new GoalTransitionError(from, to, 'no accepted revision');
      break;
    default:
      break;
  }
}

export function transitionGoal(goal: Goal, to: GoalState, now: string, guards: GoalGuards = {}, stop?: StopRecord): Goal {
  assertGoalTransition(goal, to, guards);
  const next: Goal = { ...goal, state: to, updatedAt: now };
  if (to === 'STOP') {
    if (!stop) throw new GoalTransitionError(goal.state, to, 'STOP requires a recorded reason and next action');
    next.stop = stop;
    next.terminal = true;
  }
  if (to === 'DONE') next.terminal = true;
  return next;
}

/** LC1 stage table: enabled stages by target; everything else is `not_requested`. */
export function stagesForTarget(target: DeliveryTarget): Record<DeliveryTarget, StageStatus> {
  const stages: Record<DeliveryTarget, StageStatus> = {
    development: 'pending',
    package: 'not_requested',
    staging: 'not_requested',
    production: 'not_requested',
    migration: 'not_requested',
    operations: 'not_requested',
  };
  switch (target) {
    case 'package':
      stages.package = 'pending';
      break;
    case 'staging':
      stages.staging = 'pending';
      break;
    case 'production':
      stages.staging = 'pending';
      stages.production = 'pending';
      break;
    case 'migration':
      stages.migration = 'pending';
      break;
    case 'operations':
      stages.operations = 'pending';
      break;
    default:
      break;
  }
  return stages;
}

/** LC11: DONE respects the selected target; disabled stages report not_requested. */
export function goalDoneEvidence(goal: Goal): { done: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const [stage, status] of Object.entries(goal.stages) as Array<[DeliveryTarget, StageStatus]>) {
    if (status === 'not_requested') continue;
    if (status !== 'pass') missing.push(`${stage}=${status}`);
  }
  return { done: missing.length === 0 && goal.state === 'DONE', missing };
}
