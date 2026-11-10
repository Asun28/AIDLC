// Card T1-OUTCOME-GITHUB: the outcome tables read through `gh` and git. RED seam: the signatures, with empty results.
import type { SyncRunner } from '../../src/probes/exec.ts';
import type { Row } from './ingest.ts';

/** The rows a reader returns and one `github_errors` row per command that failed. */
export type Read = { rows: Row[]; errors: Row[] };
export type GithubTable = 'prs' | 'checks' | 'reverts' | 'branch_commits' | 'github_errors' | 'required_checks';

export function pullRequests(_runner: SyncRunner, _repository: string): Read {
  return { rows: [], errors: [] };
}

export function checkRuns(_runner: SyncRunner, _repository: string, _shas: string[]): Read {
  return { rows: [], errors: [] };
}

export function reverts(_runner: SyncRunner, _base: string): Read {
  return { rows: [], errors: [] };
}

export function branchCommits(_runner: SyncRunner, _base: string, _pulls: Row[]): Read {
  return { rows: [], errors: [] };
}

export function githubTables(_runner: SyncRunner, _repository: string | undefined, _base: string, _requiredChecks: string[]): Record<GithubTable, Row[]> {
  return { prs: [], checks: [], reverts: [], branch_commits: [], github_errors: [], required_checks: [] };
}
