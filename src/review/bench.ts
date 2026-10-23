/** The reviewer bench (card T1-REVIEW-BENCH): seam for the RED run; the implementation follows. */
import type { ReviewBenchCase } from '../core/types.ts';
import type { RunStatus } from '../core/types.ts';
import type { Runner, SyncRunner } from '../probes/exec.ts';

export type BenchOutcome = 'hit' | 'miss' | 'pass' | 'false-block' | 'no-verdict' | 'error';

export interface BenchCaseResult {
  id: string;
  kind: 'bug' | 'clean';
  confirmed: boolean;
  outcome: BenchOutcome;
  runStatus?: RunStatus;
  cited: string[];
  matched?: { reason: string; file: string; line: number };
  detail?: string;
  verdictRef?: string;
  logRef?: string;
  durationMs: number;
}

export interface BenchTotals {
  bugCases: number;
  hits: number;
  misses: number;
  recall: number | null;
  cleanCases: number;
  cleanPasses: number;
  falseBlocks: number;
  falseBlockRate: number | null;
  noVerdict: number;
  errors: number;
  skippedUnconfirmed: number;
}

export interface ReviewBenchReport {
  stage: 'pre' | 'formal';
  reviewer: string;
  policyHash: string;
  leftCheckouts: string[];
  cases: BenchCaseResult[];
  totals: BenchTotals;
}

export interface ReviewBenchOptions {
  root: string;
  stage: 'pre' | 'formal';
  dir?: string;
  caseId?: string;
  includeUnconfirmed?: boolean;
  runner?: Runner;
  git?: SyncRunner;
  tmpRoot?: string;
}

export function loadBenchCases(_dir: string): ReviewBenchCase[] {
  return [];
}

export async function runReviewBench(o: ReviewBenchOptions): Promise<ReviewBenchReport> {
  return { stage: o.stage, reviewer: '', policyHash: '', leftCheckouts: [], cases: [], totals: { bugCases: 0, hits: 0, misses: 0, recall: null, cleanCases: 0, cleanPasses: 0, falseBlocks: 0, falseBlockRate: null, noVerdict: 0, errors: 0, skippedUnconfirmed: 0 } };
}

export function formatBenchReport(_report: ReviewBenchReport): string {
  return '';
}
