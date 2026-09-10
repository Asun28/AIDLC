import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Card, CardRun, Goal, type ActorIdentity, type DeliveryTarget, type StageStatus } from '../../src/core/types.ts';

export function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'aidlc-'));
}

export function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* best effort */
  }
}

export function actor(session: string, pid = 1000): ActorIdentity {
  return { session, pid, processStart: '2026-09-11T00:00:00.000Z', host: 'test-host' };
}

export function iso(offsetMs = 0, base = '2026-09-11T10:00:00.000Z'): string {
  return new Date(Date.parse(base) + offsetMs).toISOString();
}

export function allStages(overrides: Partial<Record<DeliveryTarget, StageStatus>> = {}): Record<DeliveryTarget, StageStatus> {
  return {
    development: 'pending',
    package: 'not_requested',
    staging: 'not_requested',
    production: 'not_requested',
    migration: 'not_requested',
    operations: 'not_requested',
    ...overrides,
  };
}

export function makeGoal(id = 'goal-1', overrides: Partial<Goal> = {}): Goal {
  const now = iso();
  return Goal.parse({
    schemaVersion: 1,
    id,
    generation: 0,
    revision: 0,
    revisions: [{ revision: 0, at: now, reason: 'intake', request: { text: 'Build the widget feature', source: 'natural-language' } }],
    repository: 'D:/tmp/repo',
    routing: {
      size: 'T1',
      sizeSource: 'inferred',
      kind: 'feature',
      target: 'development',
      targetSource: 'default',
      cardCount: 'unknown',
      modules: ['router', 'arc', 'card-loop'],
      nextModule: 'arc',
      dataImpact: false,
      reasons: ['kind=feature'],
    },
    target: 'development',
    stages: allStages(),
    state: 'RUN',
    deadlines: { createdAt: now, goalDeadline: iso(12 * 60 * 60 * 1000) },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

export function makeCard(id: string, overrides: Partial<Card> = {}): Card {
  return Card.parse({
    id,
    title: `card ${id}`,
    status: 'todo',
    branch: id,
    worktree: `C:\\wt\\${id}`,
    allow_paths: [`src/${id.toLowerCase()}/`],
    dod_command: 'npm test',
    ...overrides,
  });
}

export function makeCardRun(goalId: string, cardId: string, overrides: Partial<CardRun> = {}): CardRun {
  const now = iso();
  return CardRun.parse({
    goalId,
    cardId,
    cardRevision: 0,
    goalGeneration: 0,
    state: 'BUILD',
    startedAt: now,
    deadline: iso(3 * 60 * 60 * 1000),
    updatedAt: now,
    ...overrides,
  });
}
