/** Shared deterministic fixtures for core tests. Never uses Date.now(). */
import {
  AuthorizationRecord,
  Card,
  CardRun,
  Goal,
  HealthSignal,
  ReleaseAttempt,
  addMs,
  CARD_LIMIT_MS,
  type DeliveryTarget,
  type RoutingResult,
} from '../../src/core/types.ts';
import { computeGoalDeadlines } from '../../src/core/deadlines.ts';
import { stagesForTarget } from '../../src/core/goal-machine.ts';

export const T0 = '2026-09-11T00:00:00.000Z';
export const T_CARD_DEADLINE = addMs(T0, CARD_LIMIT_MS);

export function card(id: string, extra: Record<string, unknown> = {}): Card {
  return Card.parse({
    id,
    title: `card ${id}`,
    status: 'todo',
    branch: id,
    worktree: `C:\\wt\\${id}`,
    allow_paths: [`src/${id.toLowerCase()}/`],
    dod_command: 'npm test',
    ...extra,
  });
}

export function routing(overrides: Partial<RoutingResult> = {}): RoutingResult {
  return {
    size: 'T0',
    sizeSource: 'inferred',
    kind: 'change',
    target: 'development',
    targetSource: 'default',
    cardCount: 1,
    modules: ['router', 'card-loop'],
    nextModule: 'card-loop',
    dataImpact: false,
    reasons: [],
    ...overrides,
  };
}

export function goal(overrides: Record<string, unknown> = {}, target: DeliveryTarget = 'development'): Goal {
  return Goal.parse({
    schemaVersion: 1,
    id: 'g1',
    generation: 0,
    revision: 0,
    revisions: [{ revision: 0, at: T0, reason: 'intake', request: { text: 'do the thing', source: 'natural-language' } }],
    repository: 'repo',
    routing: routing({ target }),
    target,
    stages: stagesForTarget(target),
    state: 'PLAN',
    deadlines: computeGoalDeadlines(T0, { cardCount: 1 }),
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  });
}

export function cardRun(overrides: Record<string, unknown> = {}): CardRun {
  return CardRun.parse({
    goalId: 'g1',
    cardId: 'T1-A',
    cardRevision: 0,
    goalGeneration: 0,
    state: 'BUILD',
    startedAt: T0,
    deadline: T_CARD_DEADLINE,
    updatedAt: T0,
    ...overrides,
  });
}

export function release(overrides: Record<string, unknown> = {}): ReleaseAttempt {
  return ReleaseAttempt.parse({
    id: 'r1',
    goalId: 'g1',
    generation: 0,
    target: 'package',
    state: 'PREPARE',
    startedAt: T0,
    deadline: T_CARD_DEADLINE,
    updatedAt: T0,
    ...overrides,
  });
}

export function auth(overrides: Record<string, unknown> = {}): AuthorizationRecord {
  return AuthorizationRecord.parse({
    id: 'a1',
    kind: 'production',
    grantedBy: 'release-manager',
    grantedAt: T0,
    ...overrides,
  });
}

export function signal(overrides: Record<string, unknown> = {}): HealthSignal {
  return HealthSignal.parse({
    name: '5xx-rate',
    source: 'prometheus',
    threshold: { op: '<', value: 0.01 },
    observed: 0.001,
    samples: 10,
    minSamples: 5,
    lastSampleAt: T0,
    maxStalenessMs: 60_000,
    ...overrides,
  });
}
