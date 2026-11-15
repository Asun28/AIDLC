// node bench/outcome/replay.ts cases|assemble (card T1-OUTCOME-REPLAY): the recall baseline in evals/review/replay/ and bench/outcome/replay-main.json.
import type { ReviewBenchCase } from '../../src/core/types.ts';
import type { FinalRow } from './adjudicate.ts';

export const AGREED = '';
export const OWNER = '';
export interface Counts { cases: number; candidates: number; triples: number; reviews: number; spendUsd: number; withoutDraft: number; notScorable: number; adjudicator: number; left: number }
export interface Plan { write: ReviewBenchCase[]; remove: string[]; counts: Counts; stop?: string }
export interface TrialCase { id: string; outcome: string; detail?: string; verdictRef?: string }
export interface Report { stage: string; policyHash: string; leftCheckouts: string[]; trialResults: Array<{ cases: TrialCase[] }> }
export interface TrialEntry { case: string; outcomes: string[]; agree: boolean; verdicts: string[]; verdictAgree: boolean; report: Report }
export type ReadDoc = (ref: string) => string | undefined;
export interface AssembleInput { status: string; head: string; run: string | undefined; trials: Record<string, string>; cases: ReviewBenchCase[]; rows: FinalRow[]; hasCommit: (sha: string) => boolean; readDoc: ReadDoc; selfCheck: (file: string) => void }

export function planReplay(_: { rows: FinalRow[]; drafts: ReviewBenchCase[]; scorable: (c: ReviewBenchCase) => boolean }): Plan {
  return { write: [], remove: [], counts: { cases: 0, candidates: 0, triples: 0, reviews: 0, spendUsd: 0, withoutDraft: 0, notScorable: 0, adjudicator: 0, left: 0 } };
}

export function trialCases(_: ReviewBenchCase[]): ReviewBenchCase[] {
  return [];
}

export function trialEntry(id: string, report: Report, _: ReadDoc): TrialEntry {
  return { case: id, outcomes: [], agree: false, verdicts: [], verdictAgree: false, report };
}

export function assembleReplay(_: AssembleInput, __: (text: string) => void): { refusal: string } | undefined {
  return { refusal: '' };
}
