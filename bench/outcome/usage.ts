// Card T1-OUTCOME-USAGE, RED seam: the signatures of the usage readers, with no behaviour yet.
import type { Row, Tables } from './ingest.ts';

export type Usage = { rows: Row[]; errors: Row[] };
export type Prices = Record<string, { input: number; cacheRead: number; cacheWrite: number; output: number; source: string; date: string }>;

export function claudeUsage(_dirs: string[], _cardIds: string[]): Usage {
  return { rows: [], errors: [] };
}
export function codexUsage(_dir: string): Usage {
  return { rows: [], errors: [] };
}
export function reviewLogUsage(_stateDir: string): Usage {
  return { rows: [], errors: [] };
}
export function attribute(_rows: Row[], _tables: Pick<Tables, 'card_runs' | 'attempts' | 'state_spans'>, _worktreeRoot: string): Row[] {
  return [];
}
export function priceOf(_row: Row, _prices: Prices): number | null {
  return null;
}
