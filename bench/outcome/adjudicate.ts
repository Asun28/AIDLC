// Card T1-OUTCOME-ADJUDICATE (seam): the adjudication of the rows of bench/outcome/labels.jsonl whose two labels differ.
import type { Label, LabelRow } from './labels.ts';

export const ADJ_CALL_CEILING_USD = 0.5;
export const ADJ_SPEND_CEILING_USD = 35;
export const SAMPLE_SEED = 'T1-OUTCOME-ADJUDICATE 2026-11-14';
export type Source = 'agreed' | 'owner' | 'adjudicator';
export interface FinalRow extends LabelRow { source: Source | null; adjudicator: Label | null }
export interface Summary { toAdjudicate: number; adjudicated: number; unanswered: number; spotCheck: { sample: number; agree: number; errorRate: number | null } }
export interface Logged { spend: number; lines: number; row: (goalId: string, cardId: string, findingId: string) => { label: Label | null; due: boolean } }

export function toAdjudicate(_rows: LabelRow[]): LabelRow[] {
  return [];
}

export function adjudicationPrompt(_labelPrompt: string, _row: LabelRow, _tailA: string, _tailB: string): string {
  return '';
}

export function readAdjudications(_text: string): Logged {
  return { spend: 0, lines: 0, row: () => ({ label: null, due: false }) };
}

export function mayAdjudicate(_spend: number): boolean {
  return false;
}

export function spotSample(_rows: LabelRow[]): LabelRow[] {
  return [];
}

export function finalRows(_rows: LabelRow[], _adjudicator: (Label | null)[], _spotText: string): { rows: FinalRow[]; summary: Summary } | { error: string } {
  return { error: 'not implemented' };
}
