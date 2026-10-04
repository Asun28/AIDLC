import type { GoalController } from './controller.ts';
import type { Directive } from './directive.ts';
import type { ModelProvider } from '../providers/types.ts';
import type { GoalStore } from '../state/goal-store.ts';
import type { ReviewQueue } from '../coordination/review-queue.ts';

export interface RunDriverDeps {
  controller: GoalController;
  store: GoalStore;
  queue: ReviewQueue;
  provider: ModelProvider;
  cwd: string;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

export async function runGoal(_goalId: string, _maxSteps: number, _deps: RunDriverDeps): Promise<Directive> {
  throw new Error('run driver not implemented');
}
