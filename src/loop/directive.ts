/**
 * Typed directives (pattern borrowed from AWS AI-DLC: the engine prints exactly one typed
 * directive per call; the conductor executes only the named move). `next` is read-only;
 * `report` commits a transition. Every directive carries the goal identity, generation and
 * the deadline so a late wakeup can check the terminal generation before acting.
 */
import { z } from 'zod';
import { CardState, GoalState, ReleaseState, StopRecord } from '../core/types.ts';

const Base = z.object({
  goalId: z.string(),
  generation: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  goalState: GoalState,
  deadline: z.string(),
  narration: z.string(),
  /** Companion skills the step calls for, supplied from the goal routing and the card step; advisory names, never a gate. */
  skills: z.array(z.string()).default([]),
});

export const Directive = z.discriminatedUnion('kind', [
  Base.extend({ kind: z.literal('ask'), question: z.string(), options: z.array(z.string()).default([]), responseRoute: z.string() }),
  Base.extend({ kind: z.literal('plan'), size: z.string(), inputs: z.array(z.string()), invocationAllowance: z.number().int().nonnegative(), outputs: z.array(z.string()) }),
  Base.extend({ kind: z.literal('project-cards'), planRef: z.string(), cardsDir: z.string(), outputs: z.array(z.string()) }),
  Base.extend({ kind: z.literal('checkpoint'), approvalKind: z.string(), packet: z.record(z.string(), z.unknown()), responseRoute: z.string() }),
  Base.extend({ kind: z.literal('run-card'), cardId: z.string(), cardState: CardState, worktree: z.string().optional(), base: z.string(), mode: z.enum(['local', 'remote']), effort: z.string(), role: z.string(), cardDeadline: z.string(), context: z.record(z.string(), z.unknown()).default({}) }),
  Base.extend({ kind: z.literal('verify-arc'), cards: z.array(z.string()), integratedChecks: z.array(z.string()), repairCyclesLeft: z.number().int().nonnegative() }),
  Base.extend({ kind: z.literal('release'), attemptId: z.string(), releaseState: ReleaseState, target: z.string(), environment: z.string().optional(), packet: z.record(z.string(), z.unknown()).default({}) }),
  Base.extend({ kind: z.literal('wait'), on: z.string(), until: z.string().optional(), pollSeconds: z.number().int().positive().optional() }),
  Base.extend({ kind: z.literal('close'), missing: z.array(z.string()) }),
  Base.extend({ kind: z.literal('done'), evidence: z.record(z.string(), z.unknown()).default({}) }),
  Base.extend({ kind: z.literal('stop'), stop: StopRecord }),
]);
export type Directive = z.infer<typeof Directive>;

export const ReportResult = z.enum([
  'intent-accepted',
  'plan-produced',
  'plan-failed',
  'cards-projected',
  'approved',
  'rejected',
  'card-result',
  'arc-verified',
  'arc-failed',
  'release-result',
  'revision',
  'cancel',
  'resume',
]);
export type ReportResult = z.infer<typeof ReportResult>;

export const ReportInput = z.object({
  goalId: z.string(),
  /** Generation the reporter observed; a stale generation is refused. */
  generation: z.number().int().nonnegative(),
  result: ReportResult,
  cardId: z.string().optional(),
  attemptId: z.string().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type ReportInput = z.infer<typeof ReportInput>;
