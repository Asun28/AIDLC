/**
 * Review statistics over persisted card runs (plan review-findings R11, R12).
 *
 * Pure over the two review ledgers of a card run and the card registry: no I/O, no clock.
 */
import type { CardRun } from '../core/types.ts';

export interface R2Stats {
  rounds: number;
  blocks: number;
  noVerdict: number;
  quotaHolds: number;
  durationMs: number;
  blocksByPerspective: Record<string, number>;
}

export interface R3Stats {
  decisions: number;
  blocks: number;
  durationMs: number;
}

export interface FindingStats {
  total: number;
  pre: number;
  formal: number;
  open: number;
  disputed: number;
  reraised: number;
  firstRoundMiss: number;
  resolved: number;
}

export interface CardReviewStats {
  cardId: string;
  goalId?: string;
  r2: R2Stats;
  r3: R3Stats;
  findings: FindingStats;
  wallMs: number;
  family?: FamilyStats;
}

export interface FamilyStats {
  members: CardReviewStats[];
  totals: { r2: R2Stats; r3: R3Stats; findings: FindingStats; wallMs: number };
}

/** The registry fields the family chain needs. */
export interface RegistryCard {
  id: string;
  superseded_by?: string;
}

export function summarizeReviews(_runs: readonly CardRun[], _registry: readonly RegistryCard[]): CardReviewStats[] {
  return [];
}

export function formatReviewStats(_summaries: readonly CardReviewStats[]): string {
  return '';
}
