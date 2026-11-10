// Card T1-OUTCOME-INGEST: the seam of the outcome tables, before the implementation. Every table is empty and nothing is written.
export type Row = Record<string, unknown>;
export type TableName = 'cards' | 'card_runs' | 'review_decisions' | 'findings' | 'state_spans' | 'attempts' | 'ingest_errors';
export type Tables = Record<TableName, Row[]>;

export function ingestState(_input: { stateDir: string; cardsDir: string }): Tables {
  return { cards: [], card_runs: [], review_decisions: [], findings: [], state_spans: [], attempts: [], ingest_errors: [] };
}

export function writeTables(_tables: Tables, _outDir: string): void {}
