/**
 * Ship path adapters (plan v5 R20-R21, LC3).
 *
 * Exactly one existing ship command per project, with preserved base and mode across retries.
 * The scaffold adapter drives `scripts/task.ps1` from the MAIN checkout and classifies its
 * sentinel output; the outcome feeds the card machine rather than replacing its judgement.
 * Authentication failure never silently becomes local mode.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runSync, type ExecReceipt, type SyncRunner } from '../probes/exec.ts';
import { parseVerdict } from '../core/review-policy.ts';
import type { Verdict } from '../core/types.ts';

export type ShipOutcomeClass =
  | 'merged'
  | 'dod-failed'
  | 'verify-failed'
  | 'scope-blocked'
  | 'budget-over'
  | 'license-blocked'
  | 'secrets-blocked'
  | 'review-blocked'
  | 'review-no-verdict'
  | 'ci-red'
  | 'ci-timeout'
  | 'push-failed'
  | 'pr-failed'
  | 'merge-failed'
  | 'auth-failed'
  | 'no-reviewer'
  | 'red-missing'
  | 'unclassified';

export interface ShipResult {
  outcome: ShipOutcomeClass;
  receipt: ExecReceipt;
  sentinels: string[];
  resumeCommand?: string;
  prNumber?: number;
  detail: string;
}

export interface ShipRequest {
  cardId: string;
  base: string;
  mode: 'local' | 'remote';
  skipRed?: boolean;
  noAutoMerge?: boolean;
  timeoutMs?: number;
  /** The candidate the caller believes it is shipping; paths may bind evidence (verdict sha) to it. */
  candidateSha?: string;
}

export interface ShipPath {
  readonly name: string;
  ship(req: ShipRequest): ShipResult;
  /** Read the review verdict file the path produces for a branch, if any. */
  readVerdict(cardId: string): { verdict?: Verdict; raw?: string; file?: string; rounds?: number };
  /** Read the merge token / receipt that proves the merge happened. */
  readMergeToken(cardId: string): { tip?: string; mergedPr?: number; merged?: string; utc?: string } | undefined;
}

const SENTINEL_MAP: Array<[RegExp, ShipOutcomeClass]> = [
  [/\[SHIP-MERGE-FAIL\]/, 'merge-failed'],
  [/\[CI-GATE-TIMEOUT\]/, 'ci-timeout'],
  [/\[CI-GATE-RED\]|\[CI-GATE-JOBS-DRIFT\]|\[CI-GATE-WF-MISSING\]|\[CI-GATE-NOHEAD\]|\[CI-GATE-HEAD-MOVED\]/, 'ci-red'],
  [/\[R3-SPEC-BLOCK\]|\[R3-ROUND-CAP\]|\[SHIP-REVIEW-BLOCK\]/, 'review-blocked'],
  [/\[R3-REVIEWER-TIMEOUT\]|\[R3-NO-OUTPUT\]|\[R3-BAD-VERDICT-JSON\]|\[R3-NO-VERDICT-JSON\]|\[R3-STALE-VERDICT-SHA\]|\[R3-OUTPUT-UNREADABLE\]|\[R3-VERDICT-WRITE-FAILED\]|\[R3-NONZERO-EXIT-PASS\]/, 'review-no-verdict'],
  [/\[SHIP-NO-REVIEWER\]/, 'no-reviewer'],
  [/\[SHIP-PR-NUMBER-FAIL\]|\[SHIP-PR-BASE-UNKNOWN\]|\[SHIP-PR-RETARGET\]/, 'pr-failed'],
  [/\[SHIP-PUSH-FAIL\]/, 'push-failed'],
  [/\[CARD-BUDGET-OVER\]|\[CARD-BUDGET-UNDECIDABLE\]|\[R3-DIFF-TOO-LARGE\]/, 'budget-over'],
  [/\[SHIP-SCOPE-BLOCK\]|\[SHIP-SCOPE-ALLOW-EMPTY\]|\[SHIP-SCOPE-CARD-ABSENT\]|\[SHIP-SCOPE-BASEREF-UNREADABLE\]/, 'scope-blocked'],
  [/\[SHIP-AUTH\]|gh auth login|无法确认 GitHub 账号|非个人账号|GitHub 当前账号/, 'auth-failed'],
  [/\[SHIP-COMMIT-FAIL\]|\[SHIP-LOCAL-MERGE-FAIL\]/, 'merge-failed'],
  [/缺少 RED 证据|RED 证据无效|\[TD85-RESUME\]/, 'red-missing'],
  [/检出疑似机密|check-secrets/, 'secrets-blocked'],
  [/依赖许可不合规|LICENSE-POLICY/, 'license-blocked'],
  [/verify\.ps1 未过|verify: FAIL/, 'verify-failed'],
  [/DoD 未通过|RED 检查失败/, 'dod-failed'],
];

export function classifyShipOutput(receipt: ExecReceipt): ShipResult {
  const text = `${receipt.stdout}\n${receipt.stderr}`;
  const sentinels = [...new Set([...text.matchAll(/\[[A-Z0-9-]+\]/g)].map((m) => m[0]))];
  const resume = text.match(/\[SAGA-RESUME\]\s*(.+)/)?.[1]?.trim();
  const pr = text.match(/(?:PR|pull request)\s*#(\d+)/i)?.[1];
  if (receipt.exitCode === 0 && !receipt.timedOut) {
    if (/\[SAGA-DONE\]|merged_pr=|MERGED|合并/.test(text) || sentinels.includes('[SAGA-DONE]') || sentinels.length === 0 || !/\[SAGA-FAIL\]/.test(text)) {
      return { outcome: 'merged', receipt, sentinels, resumeCommand: resume, prNumber: pr ? Number(pr) : undefined, detail: 'ship exited 0 without a saga failure' };
    }
  }
  if (receipt.timedOut) return { outcome: 'unclassified', receipt, sentinels, resumeCommand: resume, detail: 'ship timed out; reconcile before retry' };
  for (const [re, cls] of SENTINEL_MAP) {
    if (re.test(text)) return { outcome: cls, receipt, sentinels, resumeCommand: resume, prNumber: pr ? Number(pr) : undefined, detail: `sentinel ${re.source.split('|')[0]}` };
  }
  return { outcome: 'unclassified', receipt, sentinels, resumeCommand: resume, detail: `exit ${receipt.exitCode} with no known sentinel; STOP/tool with diagnostics` };
}

export interface ScaffoldShipOptions {
  mainRoot: string;
  worktreeRoot: string;
  runner?: SyncRunner;
  pwsh?: string;
}

/** Drives the claude-devops-scaffold `scripts/task.ps1` contract from the main checkout. */
export class ScaffoldShipPath implements ShipPath {
  readonly name = 'scaffold:task.ps1';
  private readonly opts: ScaffoldShipOptions;
  private readonly runner: SyncRunner;

  constructor(opts: ScaffoldShipOptions) {
    this.opts = opts;
    this.runner = opts.runner ?? runSync;
  }

  private script(): string {
    return path.join(this.opts.mainRoot, 'scripts', 'task.ps1');
  }

  phase(cardId: string, phase: 'start' | 'red' | 'ship' | 'cleanup', extra: string[] = [], timeoutMs = 60 * 60 * 1000): ExecReceipt {
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', this.script(), '-TaskId', cardId, '-Phase', phase, ...extra];
    return this.runner(this.opts.pwsh ?? 'pwsh', args, { cwd: this.opts.mainRoot, timeoutMs });
  }

  ship(req: ShipRequest): ShipResult {
    const extra: string[] = [];
    if (req.base) extra.push('-Base', req.base);
    if (req.mode === 'local') extra.push('-Local');
    if (req.skipRed) extra.push('-SkipRed');
    if (req.noAutoMerge) extra.push('-NoAutoMerge');
    const receipt = this.phase(req.cardId, 'ship', extra, req.timeoutMs);
    return classifyShipOutput(receipt);
  }

  worktreePath(cardId: string): string {
    return path.join(this.opts.worktreeRoot, cardId);
  }

  readVerdict(cardId: string): { verdict?: Verdict; raw?: string; file?: string; rounds?: number } {
    const dir = path.join(this.worktreePath(cardId), '.review');
    const safe = cardId.replace(/[\\/]/g, '-');
    const file = path.join(dir, `${safe}.json`);
    const roundsFile = path.join(dir, `${safe}.rounds`);
    let rounds: number | undefined;
    if (existsSync(roundsFile)) {
      const n = Number(readFileSync(roundsFile, 'utf8').trim());
      if (Number.isFinite(n)) rounds = n;
    }
    if (!existsSync(file)) return { file, rounds };
    const raw = readFileSync(file, 'utf8');
    try {
      return { verdict: parseVerdict(JSON.parse(raw)), raw, file, rounds };
    } catch {
      return { raw, file, rounds };
    }
  }

  readRedReceipt(cardId: string): { taskId: string; sha: string; dodExit: number; phase: string } | undefined {
    const file = path.join(this.worktreePath(cardId), '.review', `${cardId}.red`);
    if (!existsSync(file)) return undefined;
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return undefined;
    }
  }

  readMergeToken(cardId: string): { tip?: string; mergedPr?: number; merged?: string; utc?: string } | undefined {
    const gitDir = path.join(this.opts.mainRoot, '.git');
    const file = path.join(gitDir, 'scaffold-merged', cardId);
    if (!existsSync(file)) return undefined;
    const out: { tip?: string; mergedPr?: number; merged?: string; utc?: string } = {};
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const [k, v] = line.split('=', 2);
      if (!k || v === undefined) continue;
      if (k === 'tip') out.tip = v.trim();
      else if (k === 'merged_pr') out.mergedPr = Number(v.replace('#', '').trim());
      else if (k === 'merged') out.merged = v.trim();
      else if (k === 'utc') out.utc = v.trim();
    }
    return out;
  }
}

/** A dry-run path for qualification fixtures: records requests and returns scripted outcomes. */
export class DryRunShipPath implements ShipPath {
  readonly name = 'dry-run';
  readonly requests: ShipRequest[] = [];
  private readonly outcomes: ShipOutcomeClass[];
  private verdict: Verdict | undefined;

  constructor(outcomes: ShipOutcomeClass[] = ['merged'], verdict?: Verdict) {
    this.outcomes = outcomes;
    this.verdict = verdict;
  }

  ship(req: ShipRequest): ShipResult {
    this.requests.push(req);
    const outcome = this.outcomes[Math.min(this.requests.length - 1, this.outcomes.length - 1)] ?? 'merged';
    const now = new Date().toISOString();
    const receipt: ExecReceipt = { command: 'dry-run', args: [req.cardId], cwd: '', exitCode: outcome === 'merged' ? 0 : 1, signal: null, timedOut: false, stdout: outcome, stderr: '', startedAt: now, finishedAt: now, durationMs: 0, outputSha256: '' };
    return { outcome, receipt, sentinels: [], detail: `dry-run outcome ${outcome}` };
  }

  /** Fixture semantics: the scripted reviewer reviewed exactly the candidate that was shipped last. */
  readVerdict(): { verdict?: Verdict } {
    if (!this.verdict) return {};
    const last = this.requests[this.requests.length - 1];
    return { verdict: last?.candidateSha ? { ...this.verdict, sha: last.candidateSha } : this.verdict };
  }

  readMergeToken(): undefined {
    return undefined;
  }
}
