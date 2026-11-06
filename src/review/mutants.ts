/** Mutant runner seam (card T1-VERIFY-MUTANTS): the exports the RED run fails on by assertion. */
import path from 'node:path';
import type { Card, MutantReport } from '../core/types.ts';
import type { Runner, SyncRunner } from '../probes/exec.ts';

export const MUTANT_MAX_DEFAULT = 30;
export const MUTANT_TIMEOUT_DEFAULT_MS = 120_000;

export const mutantsReportPath = (worktree: string, card: string): string => path.join(worktree, '.review', `${card}.mutants.json`);
export const mutantsMarkerPath = (worktree: string, card: string): string => path.join(worktree, '.review', `${card}.mutants.pending.json`);

export interface RunMutantsInput {
  card: Pick<Card, 'id' | 'dod_command' | 'dod_exit'>;
  worktree: string;
  base: string;
  max?: number;
  timeoutMs?: number;
}

export interface MutantsDeps {
  git: SyncRunner;
  dod: Runner;
  now: () => string;
  progress?: (line: string) => void;
}

export interface MutantRestore {
  outcome: 'nothing' | 'restored' | 'original' | 'idle';
  message: string;
}

export async function runMutants(input: RunMutantsInput, deps: MutantsDeps): Promise<{ report: MutantReport; path: string }> {
  const report = { schemaVersion: 1, cardId: input.card.id, candidateSha: '', base: input.base, dodCommand: input.card.dod_command, operators: [], max: 1, timeoutMs: 1, baselineDurationMs: 0, generated: 0, skipped: 0, totals: { killed: 0, survived: 0, timeout: 0 }, startedAt: deps.now(), finishedAt: deps.now(), mutants: [] } satisfies MutantReport;
  return { report, path: mutantsReportPath(input.worktree, input.card.id) };
}

export function restoreMutants(_worktree: string, card: string): MutantRestore {
  return { outcome: 'nothing', message: card };
}

export function mutantSummaryText(_report: MutantReport, _reportPath: string): string {
  return '';
}
