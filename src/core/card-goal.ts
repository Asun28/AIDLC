/**
 * The goal a command that names a card acts on (card T0-CARD-GOAL-RESOLVE, issue #72). Pure: the caller passes the goal
 * records, newest first as the goal store lists them, and for an explicit goal whether it holds a run of the card.
 *
 * The goal is chosen by the card's projection, never by which goal is newest: the one non-terminal goal that projects
 * the card, else the one terminal goal that does. None, or more than one at the step that decides, is refused naming the
 * candidates, before any card run is read or written. An explicit goal is used only when it projects the card or already
 * holds its run, so no command creates a run of a card in a goal that does not own it.
 */

export interface CardGoalCandidate {
  id: string;
  /** The goal's card projection. */
  cards: readonly string[];
  terminal: boolean;
}

export type CardGoalResolution = { ok: true; goalId: string } | { ok: false; error: string };

export function resolveCardGoal(goals: readonly CardGoalCandidate[], cardId: string, options: { explicit?: string; holdsRun?: (goalId: string) => boolean } = {}): CardGoalResolution {
  const projecting = goals.filter((g) => g.cards.includes(cardId));
  if (options.explicit !== undefined) {
    const named = goals.find((g) => g.id === options.explicit);
    if (!named) return { ok: false, error: `goal ${options.explicit} not found` };
    if (named.cards.includes(cardId) || options.holdsRun?.(named.id)) return { ok: true, goalId: named.id };
    const others = projecting.length ? `the goals that project it: ${projecting.map((g) => g.id).join(', ')}` : 'no goal projects it';
    return { ok: false, error: `goal ${named.id} does not project card ${cardId} and holds no run of it (${others}); pass --goal <id> of a goal that projects the card` };
  }
  const active = projecting.filter((g) => !g.terminal);
  if (active.length === 1) return { ok: true, goalId: active[0]!.id };
  if (active.length > 1) return { ok: false, error: `card ${cardId} is projected by ${active.length} active goals (${active.map((g) => g.id).join(', ')}); pass --goal <id>` };
  if (projecting.length === 1) return { ok: true, goalId: projecting[0]!.id };
  if (projecting.length > 1) return { ok: false, error: `card ${cardId} is projected by no active goal and by ${projecting.length} terminal goals (${projecting.map((g) => g.id).join(', ')}); pass --goal <id>` };
  return { ok: false, error: `no goal projects card ${cardId}; create one with \`aidlc goal new --card ${cardId}\`` };
}
