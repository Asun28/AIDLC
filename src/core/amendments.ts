/**
 * Live requirement changes and card amendments (plan v5 §5 "Arc selection and live changes", Q5).
 *
 * Unstarted cards may be formally amended in place. Running/reviewed work first reconciles
 * its effects, then gets a recorded contract amendment or a linked successor. Merged history is
 * immutable: a successor implements the new requirement. A card-text-only request does not
 * authorise code execution. Stale generation/revision dispatches require revalidation.
 */
import type { Card, CardRun } from './types.ts';

export type AmendmentRoute =
  | { route: 'amend-in-place'; detail: string }
  | { route: 'reconcile-then-amend'; detail: string }
  | { route: 'successor'; detail: string; successorOf: string }
  | { route: 'text-only'; detail: string }
  | { route: 'revalidate'; detail: string };

export interface AmendmentRequest {
  card: Card;
  run?: CardRun;
  textOnly: boolean;
  /** Dispatch identity: generation/revision the requester observed. */
  observedGeneration?: number;
  observedRevision?: number;
  currentGeneration: number;
  currentRevision: number;
}

export function routeAmendment(req: AmendmentRequest): AmendmentRoute {
  if (
    (req.observedGeneration !== undefined && req.observedGeneration !== req.currentGeneration) ||
    (req.observedRevision !== undefined && req.observedRevision !== req.currentRevision)
  ) {
    return { route: 'revalidate', detail: `stale dispatch (observed gen ${req.observedGeneration}/rev ${req.observedRevision}, current gen ${req.currentGeneration}/rev ${req.currentRevision}); revalidate before further mutation` };
  }
  if (req.textOnly) {
    return { route: 'text-only', detail: 'validate the amended card text; do not execute the product change' };
  }
  const merged = req.card.status === 'merged' || req.run?.mergeVerified;
  if (merged) {
    return { route: 'successor', detail: 'merged history stays immutable; create a linked successor card for the new requirement', successorOf: req.card.id };
  }
  const running = req.run && !['PREPARE', 'DONE', 'STOP'].includes(req.run.state) && req.run.state !== 'PREPARE';
  const reviewed = req.run && (req.run.review.substantiveDecisions > 0 || req.run.pr !== undefined);
  if (running || reviewed) {
    return { route: 'reconcile-then-amend', detail: 'reconcile effects already produced (commits, PR, review), then record a contract amendment or link a successor' };
  }
  return { route: 'amend-in-place', detail: 'unstarted card: formal amendment creates a new card revision' };
}

export interface RevisionMapping {
  supersededCards: Record<string, string>;
  removedCards: string[];
  retainedEvidenceFor: string[];
}

/** Map superseded cards to replacements or authorized removals; unaffected evidence is retained. */
export function mapRevision(previousCards: string[], nextCards: string[], replacements: Record<string, string>): RevisionMapping {
  const supersededCards: Record<string, string> = {};
  const removedCards: string[] = [];
  const retainedEvidenceFor: string[] = [];
  for (const id of previousCards) {
    if (nextCards.includes(id)) {
      retainedEvidenceFor.push(id);
    } else if (replacements[id]) {
      supersededCards[id] = replacements[id]!;
    } else {
      removedCards.push(id);
    }
  }
  return { supersededCards, removedCards, retainedEvidenceFor };
}
