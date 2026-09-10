/**
 * Native GitHub ship path for repositories without the PowerShell scaffold.
 *
 * Mirrors the scaffold chain: commit -> push -> PR (reuse retained identity) -> require a fresh
 * candidate-bound verdict written by the reviewer role at `<worktree>/.review/<branch>.json`
 * -> CI check runs green -> squash merge matching the head commit -> merge token. Every step
 * prints a scaffold-style sentinel so `classifyShipOutput` can classify the outcome uniformly.
 * Authentication failure never silently becomes local mode.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runSync, type ExecReceipt, type SyncRunner } from '../probes/exec.ts';
import { GitProbe } from '../probes/git.ts';
import { GhProbe } from '../probes/gh.ts';
import { parseVerdict } from '../core/review-policy.ts';
import { classifyShipOutput, type ShipPath, type ShipRequest, type ShipResult } from './ship.ts';
import type { Verdict } from '../core/types.ts';

export interface GitHubShipOptions {
  mainRoot: string;
  worktreeRoot: string;
  /** owner/repo */
  repository: string;
  runner?: SyncRunner;
  /** Required check-run names that must conclude success; empty = every check must succeed. */
  requiredChecks?: string[];
  ciTimeoutMs?: number;
  ciPollMs?: number;
  /** Sleep function for polling (injectable for tests). */
  sleep?: (ms: number) => void;
  /** Whether a verdict is required before merge (default true). */
  requireVerdict?: boolean;
}

export class GitHubShipPath implements ShipPath {
  readonly name = 'github';
  private readonly opts: GitHubShipOptions;
  private readonly runner: SyncRunner;
  private readonly git: GitProbe;
  private readonly gh: GhProbe;

  constructor(opts: GitHubShipOptions) {
    this.opts = opts;
    this.runner = opts.runner ?? runSync;
    this.git = new GitProbe(this.runner);
    this.gh = new GhProbe(this.runner);
  }

  worktreePath(cardId: string): string {
    return path.join(this.opts.worktreeRoot, cardId);
  }

  private receipt(lines: string[], exitCode: number, started: Date): ExecReceipt {
    const finished = new Date();
    return { command: 'github-ship', args: [], cwd: this.opts.mainRoot, exitCode, signal: null, timedOut: false, stdout: lines.join('\n'), stderr: '', startedAt: started.toISOString(), finishedAt: finished.toISOString(), durationMs: finished.getTime() - started.getTime(), outputSha256: '' };
  }

  ship(req: ShipRequest): ShipResult {
    const started = new Date();
    const log: string[] = [];
    const wt = this.worktreePath(req.cardId);
    const fail = (sentinel: string, detail: string): ShipResult => {
      log.push(`${sentinel} ${detail}`, '[SAGA-FAIL]', `[SAGA-RESUME] aidlc card next ${req.cardId}`);
      return classifyShipOutput(this.receipt(log, 1, started));
    };
    if (!existsSync(wt)) return fail('[SHIP-SCOPE-CARD-ABSENT]', `worktree ${wt} missing`);
    // auth guard
    const login = this.gh.login(wt);
    if (!login) return fail('[SHIP-AUTH]', 'gh auth login required (无法确认 GitHub 账号)');
    log.push(`账号校验通过：个人账号 ${login} ✓`);
    // commit
    const add = this.runner('git', ['add', '-A'], { cwd: wt });
    if (add.exitCode !== 0) return fail('[SHIP-COMMIT-FAIL]', add.stderr);
    const staged = this.runner('git', ['diff', '--cached', '--quiet'], { cwd: wt });
    if (staged.exitCode !== 0) {
      const commit = this.runner('git', ['commit', '-m', `feat(${req.cardId}): implement to DoD green\n\nSee specs/tasks/${req.cardId}.md`], { cwd: wt });
      if (commit.exitCode !== 0) return fail('[SHIP-COMMIT-FAIL]', commit.stderr);
      log.push('[SHIP-TIME] commit');
    }
    const head = this.git.head(wt);
    // verdict (fresh, candidate-bound) before any remote effect
    const v = this.readVerdict(req.cardId);
    if (this.opts.requireVerdict !== false) {
      if (!v.verdict) return fail('[R3-NO-VERDICT-JSON]', `no verdict at ${v.file}`);
      if (v.verdict.sha && v.verdict.sha !== head) return fail('[R3-STALE-VERDICT-SHA]', `verdict sha ${v.verdict.sha} != HEAD ${head}`);
      if (v.verdict.verdict === 'block') return fail('[R3-SPEC-BLOCK]', v.verdict.reasons.join('; '));
    }
    if (req.mode === 'local') {
      const merge = this.runner('git', ['merge', '--no-ff', '--no-edit', req.cardId], { cwd: this.opts.mainRoot });
      if (merge.exitCode !== 0) return fail('[SHIP-LOCAL-MERGE-FAIL]', merge.stderr);
      this.writeToken(req.cardId, `tip=${head}\nmerged=${this.git.head(this.opts.mainRoot)}\nutc=${new Date().toISOString()}`);
      log.push('[SAGA-DONE] local merge');
      return classifyShipOutput(this.receipt(log, 0, started));
    }
    // push + PR
    const push = this.runner('git', ['push', '-u', 'origin', req.cardId], { cwd: wt });
    if (push.exitCode !== 0) return fail('[SHIP-PUSH-FAIL]', push.stderr);
    const base = req.base.replace(/^origin\//, '');
    const resolved = this.gh.resolvePr(this.opts.repository, req.cardId, base, undefined, wt);
    if (resolved.problem && !resolved.pr) return fail('[SHIP-PR-BASE-UNKNOWN]', resolved.problem);
    let prNumber = resolved.pr?.number;
    if (!prNumber) {
      const create = this.runner('gh', ['pr', 'create', '--repo', this.opts.repository, '--base', base, '--head', req.cardId, '--title', `feat: [${req.cardId}]`, '--body', `Closed loop: worktree + TDD + independent review. DoD in specs/tasks/${req.cardId}.md.`], { cwd: wt });
      if (create.exitCode !== 0) return fail('[SHIP-PR-NUMBER-FAIL]', create.stderr);
      prNumber = Number(create.stdout.match(/\/pull\/(\d+)/)?.[1]);
      if (!prNumber) return fail('[SHIP-PR-NUMBER-FAIL]', create.stdout);
    } else if (resolved.pr?.state === 'MERGED') {
      log.push(`PR #${prNumber} already MERGED`, '[SAGA-DONE]');
      return { ...classifyShipOutput(this.receipt(log, 0, started)), prNumber };
    }
    log.push(`PR #${prNumber}`);
    // CI gate
    const timeout = this.opts.ciTimeoutMs ?? 30 * 60 * 1000;
    const poll = this.opts.ciPollMs ?? 20_000;
    const sleep = this.opts.sleep ?? ((ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
    const deadline = Date.now() + timeout;
    for (;;) {
      const runs = this.gh.checkRuns(this.opts.repository, head, wt);
      const relevant = this.opts.requiredChecks?.length ? runs.filter((r) => this.opts.requiredChecks!.includes(r.name)) : runs;
      const pending = relevant.filter((r) => r.status !== 'completed');
      const failed = relevant.filter((r) => r.status === 'completed' && !['success', 'neutral', 'skipped'].includes((r.conclusion ?? '').toLowerCase()));
      if (failed.length) return { ...fail('[CI-GATE-RED]', failed.map((f) => `${f.name}=${f.conclusion}`).join(',')), prNumber };
      if (!pending.length && relevant.length > 0) break;
      if (Date.now() > deadline) return { ...fail('[CI-GATE-TIMEOUT]', `${pending.length} pending checks`), prNumber };
      log.push(`[CI-GATE-WAIT] ${pending.length} pending`);
      sleep(poll);
    }
    log.push('[CI-GATE-PASS]');
    const merge = this.runner('gh', ['pr', 'merge', String(prNumber), '--repo', this.opts.repository, '--squash', '--match-head-commit', head], { cwd: wt });
    if (merge.exitCode !== 0) return { ...fail('[SHIP-MERGE-FAIL]', merge.stderr), prNumber };
    const view = this.gh.prView(this.opts.repository, prNumber, wt);
    if (view.state !== 'MERGED') return { ...fail('[SHIP-MERGE-FAIL]', `PR #${prNumber} state ${view.state} after merge`), prNumber };
    this.writeToken(req.cardId, `tip=${head}\nmerged_pr=#${prNumber}\nutc=${new Date().toISOString()}`);
    log.push('[SAGA-DONE]');
    return { ...classifyShipOutput(this.receipt(log, 0, started)), prNumber };
  }

  private tokenFile(cardId: string): string {
    return path.join(this.opts.mainRoot, '.git', 'scaffold-merged', cardId);
  }

  private writeToken(cardId: string, content: string): void {
    const f = this.tokenFile(cardId);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, content, 'utf8');
  }

  readVerdict(cardId: string): { verdict?: Verdict; raw?: string; file?: string; rounds?: number } {
    const file = path.join(this.worktreePath(cardId), '.review', `${cardId.replace(/[\\/]/g, '-')}.json`);
    if (!existsSync(file)) return { file };
    const raw = readFileSync(file, 'utf8');
    try {
      return { verdict: parseVerdict(JSON.parse(raw)), raw, file };
    } catch {
      return { raw, file };
    }
  }

  readMergeToken(cardId: string): { tip?: string; mergedPr?: number; merged?: string; utc?: string } | undefined {
    const f = this.tokenFile(cardId);
    if (!existsSync(f)) return undefined;
    const out: { tip?: string; mergedPr?: number; merged?: string; utc?: string } = {};
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
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
