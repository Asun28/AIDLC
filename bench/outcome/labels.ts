// Card T1-OUTCOME-LABELS (seam): the labels of selected formal findings. The implementation follows the RED receipt.
import type { Row, Tables } from './ingest.ts';

export const CALL_CEILING_USD = 0.25;
export const SPEND_CEILING_USD = 25;
export const LABELS = ['true-defect', 'out-of-card-scope', 'speculative', 'reviewer-misread', 'ambiguous-card'] as const;
export type Label = (typeof LABELS)[number];
export type Group = 'superseded' | 'clean' | 'second-pass';
export type Model = 'claude' | 'codex';
export interface Selected { group: Group; finding: Row }
export interface Answer { label: Label | null; cost: number | null; text: string }
export interface LabelRow { goalId: string; cardId: string; findingId: string; group: Group; candidate: string | null; labelA: Label | null; labelB: Label | null; final: Label | null; ownerRuled: boolean; left: string | null }
export interface Labelled { selected: Selected; labelA: Label | null; labelB: Label | null; left: string | null }
export type Prices = Record<string, { input: number; cacheRead: number; output: number }>;

export function selectFindings(_tables: Tables): Selected[] {
  return [];
}

export function promptFor(_finding: Row, _cardText: string | null, _fileText: string | null, _cardsDir = ''): string {
  return '';
}

export function labelOf(_text: string): Label | null {
  return null;
}

export function claudeAnswer(_stdout: string): Answer {
  return { label: null, cost: null, text: '' };
}

export function codexAnswer(_stdout: string, _prices: Prices): Answer {
  return { label: null, cost: null, text: '' };
}

export function readLog(_text: string): { spend: number; pair: (goalId: string, cardId: string, findingId: string, model: Model) => { label: Label | null; ask: boolean; tail: string | null } } {
  return { spend: 0, pair: () => ({ label: null, ask: false, tail: null }) };
}

export function mayCall(_spend: number): boolean {
  return false;
}

export function labelRows(_items: Labelled[], _rulingsText: string | null): { rows: LabelRow[] } | { error: string } {
  return { rows: [] };
}
