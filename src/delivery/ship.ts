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
import { normaliseCause } from '../core/effort.ts';
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
  | 'merge-unconfirmed'
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
  // The base sync before any remote effect (github-ship.ts): a conflict carries git's own diagnostic lines, which the
  // card runner turns into BUILD naming merge-conflicts; a fetch or merge-tree failure carries none and stops as tool. A
  // CHANGELOG merge the path committed itself carries the same lines: it is a new candidate, built and reviewed like one.
  [/\[SHIP-BASE-SYNC-CONFLICT\]/, 'merge-failed'],
  [/\[SHIP-BASE-SYNC-MERGED\]/, 'merge-failed'],
  // A CHANGELOG merge committed but whose commit could not be read back (card T0-BASE-SYNC-CHANGELOG-EDGES): the same repair,
  // with its own detail, since it names no commit.
  [/\[SHIP-BASE-SYNC-COMMITTED\]/, 'merge-failed'],
  [/\[SHIP-BASE-SYNC-FAIL\]/, 'merge-failed'],
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

/**
 * Untrusted text on the ship output (check names in the gate lines, git's lines and paths from the base sync, the
 * failing line of a ship failure) travels with brackets and percent signs encoded, so it can never form a sentinel or a
 * `[SAGA-RESUME]` marker; everything else stays verbatim. `gateChecks` in core/ci-policy decodes the check names.
 */
export function encodeUntrusted(text: string): string {
  return text.replace(/%/g, '%25').replace(/\[/g, '%5B').replace(/\]/g, '%5D');
}

/**
 * The ship failures that count on the effort ladder, and where the failing line their detail names is read (card
 * T0-SHIP-FAILING-LINE-2): a failing test or compile line of the DoD or verify output, or the gate line itself.
 */
const FAILING_LINE_AT: Partial<Record<ShipOutcomeClass, 'test' | 'gate'>> = { 'dod-failed': 'test', 'verify-failed': 'test', 'scope-blocked': 'gate', 'budget-over': 'gate' };

/** A TAP test line, `ok <n>` or `not ok <n>`: judged by the TAP rule alone, whatever other shape it carries. */
const TAP_TEST_LINE = /^(?:not )?ok \d+\b/;

/**
 * The failing lines other than TAP's: a node:test spec failure other than the `✖ failing tests:` heading, a TypeScript
 * diagnostic at the start of the line (bare, or after a location without spaces), a Go failure, and a jest, vitest or
 * pytest failure.
 */
const FAILING_SHAPE: RegExp[] = [/^✖ (?!failing tests:?$)/, /^(?:\S+(?:\(\d+,\d+\): |:\d+:\d+ - ))?error TS\d+: /, /^--- FAIL: \S/, /^FAIL(?:ED)?\s+\S/];

/** A failing test or compile line: a TAP `not ok <n>` without a TODO or SKIP directive, or one of the other shapes. */
function isFailingLine(line: string): boolean {
  if (TAP_TEST_LINE.test(line)) return line.startsWith('not ') && !/(?<!\\)#\s*(?:todo|skip)\b/i.test(line);
  return FAILING_SHAPE.some((shape) => shape.test(line));
}

/**
 * The text a terminal prints from `text`, read as the DEC and ECMA-48 parser (vt100.net) reads it, so every control
 * sequence is consumed whole and the controls met inside one are handled as that parser handles them:
 * - a C0 control is executed in any state, so it stays in the text (a line feed keeps its line); DEL is ignored inside a
 *   sequence;
 * - ESC starts a sequence; CAN and SUB cancel one and are executed; a C1 control ends one: the ST (0x9C) silently, the
 *   CSI, DCS, SOS, OSC, PM and APC introducers by starting their own, any other by being executed;
 * - after ESC, `[` starts a CSI, `]`, `P`, `X`, `^` and `_` a control string, 0x20-0x2F an nF escape up to its
 *   final byte, and any other byte from 0x30 to 0x7E is the final byte of a two-character escape;
 * - a CSI runs through its parameter and intermediate bytes (0x20-0x3F in any order, colon-separated colours included)
 *   to its final byte (0x40-0x7E); a control string holds its payload, lines included, until BEL, an ST (`ESC \` or
 *   0x9C), a CAN or SUB, the next ESC, or the end of the text;
 * - any other character inside a sequence ends it and is printed.
 */
function printedText(text: string): string {
  let out = '';
  let state: 'ground' | 'escape' | 'nf' | 'csi' | 'string' = 'ground';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c === 0x1b) {
      state = 'escape';
    } else if (c === 0x18 || c === 0x1a) {
      state = 'ground';
      out += ch;
    } else if (c >= 0x80 && c <= 0x9f) {
      state = c === 0x9b ? 'csi' : c === 0x90 || c === 0x98 || c >= 0x9d ? 'string' : 'ground';
      if (state === 'ground' && c !== 0x9c) out += ch;
    } else if (state === 'string') {
      if (c === 0x07) state = 'ground';
    } else if (c < 0x20 || c === 0x7f) {
      if (c < 0x20 || state === 'ground') out += ch;
    } else if (state === 'ground' || c > 0x7f) {
      state = 'ground';
      out += ch;
    } else if (state === 'escape') {
      state = c === 0x5b ? 'csi' : ']PX^_'.includes(ch) ? 'string' : c < 0x30 ? 'nf' : 'ground';
    } else if (state === 'nf') {
      if (c >= 0x30) state = 'ground';
    } else if (c >= 0x40) {
      state = 'ground';
    }
  }
  return out;
}

const FAILING_LINE_WIDTH = 160;

/** The first `width` code points of a text, so a cut never splits a surrogate pair. */
function firstCodePoints(text: string, width: number): string {
  let end = 0;
  let count = 0;
  for (const ch of text) {
    if (count === width) break;
    end += ch.length;
    count += 1;
  }
  return text.slice(0, end);
}

/**
 * The failing line of a ship failure as a cause string only, or undefined when the outcome counts no attempt or no line
 * qualifies: the text a terminal prints (printedText), then per line control characters as spaces,
 * normalised as effort causes are, cut to 160 code points and encoded, so the line only tells two failures apart and can
 * never form a sentinel.
 */
function failingLine(text: string, outcome: ShipOutcomeClass, sentinel: RegExp): string | undefined {
  const at = FAILING_LINE_AT[outcome];
  if (!at) return undefined;
  const line = printedText(text)
    .split(/\r?\n/)
    .map((l) => l.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').trim())
    .find((l) => (at === 'gate' ? sentinel.test(l) : isFailingLine(l)));
  return line === undefined ? undefined : encodeUntrusted(firstCodePoints(normaliseCause(line), FAILING_LINE_WIDTH));
}

export function classifyShipOutput(receipt: ExecReceipt): ShipResult {
  const text = `${receipt.stdout}\n${receipt.stderr}`;
  const sentinels = [...new Set([...text.matchAll(/\[[A-Z0-9-]+\]/g)].map((m) => m[0]))];
  const resume = text.match(/\[SAGA-RESUME\]\s*(.+)/)?.[1]?.trim();
  const pr = text.match(/(?:PR|pull request)\s*#(\d+)/i)?.[1];
  // The merge contract is the adapter's [SAGA-DONE] sentinel beside no failure marker, never a word of the output (card
  // T0-EXIT-ZERO-NOT-MERGED). Beside [SAGA-FAIL] or a bracketed sentinel of the map it is conflicting evidence, which gh
  // decides as merge-unconfirmed: a failure class would send a PR that did merge back into repair (R3 decision 1 F2).
  if (receipt.exitCode === 0 && !receipt.timedOut && sentinels.includes('[SAGA-DONE]')) {
    const failed = sentinels.includes('[SAGA-FAIL]') || sentinels.some((s) => SENTINEL_MAP.some(([re]) => re.test(s)));
    if (!failed) return { outcome: 'merged', receipt, sentinels, resumeCommand: resume, prNumber: pr ? Number(pr) : undefined, detail: 'ship exited 0 with [SAGA-DONE], the merge contract' };
    return { outcome: 'merge-unconfirmed', receipt, sentinels, resumeCommand: resume, prNumber: pr ? Number(pr) : undefined, detail: 'exit 0 with [SAGA-DONE] beside a failure marker; the card machine reconciles the merge' };
  }
  if (receipt.timedOut) return { outcome: 'unclassified', receipt, sentinels, resumeCommand: resume, detail: 'ship timed out; reconcile before retry' };
  for (const [re, cls] of SENTINEL_MAP) {
    if (!re.test(text)) continue;
    const detail = `sentinel ${re.source.split('|')[0]}`;
    const line = failingLine(text, cls, re);
    return { outcome: cls, receipt, sentinels, resumeCommand: resume, prNumber: pr ? Number(pr) : undefined, detail: line === undefined ? detail : `${detail}; failing line: ${line}` };
  }
  // An exit 0 without the contract is no merge: the card machine reconciles it from the PR view, then the merge token. One
  // that reports [SAGA-FAIL] with no mapped sentinel stays unclassified (R3 decision 1 F1).
  if (receipt.exitCode === 0 && !sentinels.includes('[SAGA-FAIL]')) return { outcome: 'merge-unconfirmed', receipt, sentinels, resumeCommand: resume, prNumber: pr ? Number(pr) : undefined, detail: "exit 0 without the adapter's merge contract ([SAGA-DONE]); the card machine reconciles the merge" };
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
    // A merged dry-run prints the merge contract, so its receipt classifies as merged again; merge-unconfirmed exits 0 without it.
    const receipt: ExecReceipt = { command: 'dry-run', args: [req.cardId], cwd: '', exitCode: outcome === 'merged' || outcome === 'merge-unconfirmed' ? 0 : 1, signal: null, timedOut: false, stdout: outcome === 'merged' ? '[SAGA-DONE] merged' : outcome, stderr: '', startedAt: now, finishedAt: now, durationMs: 0, outputSha256: '' };
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
