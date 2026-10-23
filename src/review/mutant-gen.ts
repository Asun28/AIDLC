/** Seam (card T1-VERIFY-MUTANT-GEN): exports with stub bodies so the RED run fails on assertions. */
import type { MutationOperator } from '../core/types.ts';

export interface Mutant {
  line: number;
  column: number;
  operator: MutationOperator;
  original: string;
  mutated: string;
  start: number;
  end: number;
}

export interface ChangedSourceFile {
  file: string;
  lines: number[];
}

export function changedSourceLines(_diff: string): ChangedSourceFile[] {
  return [];
}

export function mutantsFor(_source: string, _changedLines: readonly number[]): Mutant[] {
  return [];
}

export function applyMutant(source: string, _mutant: Mutant): string {
  return source;
}
