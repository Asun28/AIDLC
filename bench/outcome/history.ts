// Card T1-OUTCOME-HISTORY: the ruling set, the repeat-block classification and the findings followed by a change, read
// from git on an injected runner.
import type { SyncRunner } from '../../src/probes/exec.ts';
import type { HistoryTable, Row, Tables } from './ingest.ts';

/** The rows a reader returns and one `history_errors` row per git command that failed. */
export type Read = { rows: Row[]; errors: Row[] };

export function rulings(_runner: SyncRunner, _base: string): Read {
  return { rows: [], errors: [] };
}

export function rulingSet(_rulings: Row[], _tables: Tables): Row[] {
  return [];
}

export function repeatBlocks(_runner: SyncRunner, _tables: Tables): Read {
  return { rows: [], errors: [] };
}

export function findingFixes(_runner: SyncRunner, _tables: Tables): Read {
  return { rows: [], errors: [] };
}

export function historyTables(_runner: SyncRunner, _base: string, _tables: Tables): Record<HistoryTable, Row[]> {
  return { rulings: [], ruling_set: [], repeat_blocks: [], finding_fixes: [], history_errors: [] };
}
