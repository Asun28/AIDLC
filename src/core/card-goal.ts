/**
 * The goal a command that names a card acts on (card T0-CARD-GOAL-RESOLVE, issue #72). Pure: the caller passes the goal
 * records, newest first as the goal store lists them, and for an explicit goal whether it holds a run of the card.
 */

export interface CardGoalCandidate {
  id: string;
  /** The goal's card projection. */
  cards: readonly string[];
  terminal: boolean;
}

export type CardGoalResolution = { ok: true; goalId: string } | { ok: false; error: string };

export function resolveCardGoal(goals: readonly CardGoalCandidate[], cardId: string, options: { explicit?: string; holdsRun?: (goalId: string) => boolean } = {}): CardGoalResolution {
  if (options.explicit) return { ok: true, goalId: options.explicit };
  const active = goals.find((g) => !g.terminal) ?? goals[0];
  if (!active) return { ok: false, error: `no goals; create one with \`aidlc goal new "<request>"\` (card ${cardId})` };
  return { ok: true, goalId: active.id };
}
