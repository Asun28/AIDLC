/**
 * CI policy (plan v5 R22-R24, Q7).
 *
 * Diagnose before rerunning: a red secret or security scan is STOP/risk and never reruns; a code
 * defect goes back to BUILD with a new candidate; only a
 * justified transient failure earns one same-origin rerun per run/attempt/candidate. The
 * rerun identity is persisted before the request, and a queued/running/completed rerun
 * consumes the allowance even when its request response was lost.
 */
import { MAX_CI_TRANSIENT_RERUNS, type CiFailureClass, type CiLedger } from './types.ts';

const TRANSIENT_PATTERNS: RegExp[] = [
  /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket hang up/i,
  /connection (?:reset|refused|timed out)/i,
  /rate limit|429 Too Many Requests|503 Service Unavailable|502 Bad Gateway/i,
  /The hosted runner .* lost communication|runner has received a shutdown signal|The operation was canceled/i,
  /No space left on device/i,
  /Unable to (?:download|resolve) (?:action|artifact)|Failed to (?:download|restore) cache/i,
  /npm ERR! (?:network|fetch failed)|ERR_PNPM_FETCH|ECONNABORTED/i,
  /Could not resolve host|Temporary failure in name resolution/i,
  /timed out waiting for|exceeded the maximum execution time/i,
  /flaky|retry(?:ing)? in \d+/i,
];

const CODE_DEFECT_PATTERNS: RegExp[] = [
  /AssertionError|assert(?:ion)? failed|expected .* (?:to|but) (?:be|equal|received)/i,
  /FAIL(?:ED)?\s+(?:tests?|suites?)|\d+ (?:failed|failing)/i,
  /error TS\d+|SyntaxError|ReferenceError|TypeError|NullPointerException|IndexError|KeyError/i,
  /compilation failed|cannot find (?:module|symbol|name)|undefined reference/i,
  /lint(?:ing)? (?:error|failed)|ruff|eslint .*error/i,
  /test(?:s)? (?:did not|didn't) pass|exit code 1/i,
  /Traceback \(most recent call last\)/,
];

export interface CiJob {
  name: string;
  conclusion?: string | null;
  status?: string | null;
  logExcerpt?: string;
  /** This record wraps a complete receipt rather than representing an independent job. */
  aggregate?: boolean;
}

/** Check-run names that are secret or security scans: a red one is `security`, never rerun, STOP/risk. */
export const SECURITY_CHECK_NAME = /gitleaks|secret[-_ ]?scan|security/i;

/** Raw scanner output (gitleaks) for `aidlc ci classify --log`. */
const SECURITY_PATTERNS: RegExp[] = [/leaks found: \d+/i, /^\s*RuleID:\s*\S+/m];

/** Decode a name the GitHub ship path encoded for its gate lines. */
function decodeCheckName(name: string): string {
  return name.replace(/%5B/gi, '[').replace(/%5D/gi, ']').replace(/%25/g, '%');
}

const isFailure = (conclusion: string | null | undefined): boolean => Boolean(conclusion) && !['success', 'neutral', 'skipped'].includes(String(conclusion).toLowerCase());

const CONCLUSION = 'success|failure|neutral|cancelled|skipped|timed_out|action_required|stale|startup_failure|pending|queued|in_progress|null';
/** The only legacy form parsed: plain name=conclusion pairs whose names carry neither commas nor equals signs. */
const LEGACY_LINE = new RegExp('^\\[CI-GATE-RED\\]\\s+([^,=]+=(?:' + CONCLUSION + ')(?:,[^,=]+=(?:' + CONCLUSION + '))*)\\s*$', 'i');
const RED_CONCLUSION = /=(?:failure|timed_out|cancelled|action_required|stale|startup_failure)(?:,|\s*$)/i;
const GATE_LINE = /^\[CI-GATE-(?:RED|TIMEOUT|WAIT|STEP)\]/;

/** The job steps GitHub runs itself: the default of `ci.transientSteps` (card T0-CI-RERUN-STRUCTURED). */
export const DEFAULT_TRANSIENT_STEPS: readonly string[] = ['Set up job', 'Complete job'];

/** The failed step a `[CI-GATE-STEP]` line names for a check, or null when the job record places none. */
interface GateStep {
  check: string;
  step: { name: string; conclusion: string } | null;
}
const JSON_PAYLOAD = /^\[CI-GATE-(?:RED|TIMEOUT)\][^\[]*(\[[\s\S]*\])\s*$/;

interface GateRead {
  /** Checks from every structured gate line (JSON, or plain legacy pairs), decoded. */
  checks: CiJob[];
  /** Every explicit red check, including required skipped/neutral checks, and failed timeout checks. */
  redChecks: CiJob[];
  structured: boolean;
  /** Red gate lines in a pair-like form that cannot be parsed safely: never a name, never a rerun. */
  ambiguousRed: string[];
  unresolvedRed: boolean;
  /** The text left for the log patterns: wait lines and gate payloads removed, scaffold text kept. */
  log: string;
  /** The `[CI-GATE-STEP]` lines, decoded: the structured evidence of a transient failure. */
  steps: GateStep[];
}

/**
 * Split the gate lines of a ship receipt from its log text. The GitHub ship path reports check runs as
 * `[CI-GATE-RED] [{name, conclusion}]` and `[CI-GATE-TIMEOUT] N pending checks: [...]`, names JSON-encoded with brackets
 * escaped, so a name with newlines, Unicode line separators, commas, conclusion words or sentinel-like text survives;
 * every such line counts. Plain `name=conclusion` pairs are read too; a red pair-like line that cannot be parsed is
 * kept aside to fail closed. Wait lines and structured payloads never reach the log patterns, so a check name is
 * never evidence of a transient or code failure; scaffold text after a sentinel keeps its log classification.
 */
function readGate(text: string): GateRead {
  const checks: CiJob[] = [];
  const redChecks: CiJob[] = [];
  const ambiguousRed: string[] = [];
  const log: string[] = [];
  const steps: GateStep[] = [];
  let structured = false;
  let unresolvedRed = false;
  for (const line of text.split(/\r?\n/)) {
    const start = checks.length;
    if (!GATE_LINE.test(line)) {
      log.push(line);
      continue;
    }
    if (line.startsWith('[CI-GATE-WAIT]')) continue;
    // A step line is structured evidence and never log text; one that does not parse is no evidence at all.
    if (line.startsWith('[CI-GATE-STEP]')) {
      const step = readStep(line.slice('[CI-GATE-STEP]'.length));
      if (step) steps.push(step);
      continue;
    }
    const m = line.match(JSON_PAYLOAD);
    if (m) {
      try {
        const parsed: unknown = JSON.parse(m[1]!);
        if (Array.isArray(parsed)) {
          structured = true;
          if (line.startsWith('[CI-GATE-RED]') && (!parsed.length || parsed.some((c) => typeof c !== 'object' || c === null || typeof c.name !== 'string' || !c.name.trim() || typeof c.conclusion !== 'string'))) unresolvedRed = true;
          for (const c of parsed) if (typeof c === 'object' && c !== null && 'name' in c) checks.push({ name: decodeCheckName(String((c as { name: unknown }).name)), conclusion: (c as { conclusion?: unknown }).conclusion == null ? null : String((c as { conclusion?: unknown }).conclusion) });
          redChecks.push(...checks.slice(start).filter((c) => line.startsWith('[CI-GATE-RED]') || isFailure(c.conclusion)));
          continue;
        }
      } catch {
        /* not JSON */
      }
    }
    if (line.startsWith('[CI-GATE-RED]')) {
      const legacy = line.match(LEGACY_LINE);
      if (legacy) {
        for (const pair of legacy[1]!.split(',')) {
          const at = pair.lastIndexOf('=');
          checks.push({ name: pair.slice(0, at).trim(), conclusion: pair.slice(at + 1).trim().toLowerCase() });
        }
        if (checks.slice(start).some((c) => !c.name)) unresolvedRed = true;
        redChecks.push(...checks.slice(start));
        continue;
      }
      unresolvedRed = true;
      if (RED_CONCLUSION.test(line)) {
        ambiguousRed.push(line);
        continue;
      }
    }
    log.push(line);
  }
  return { checks, redChecks, structured, ambiguousRed, unresolvedRed, log: log.join('\n'), steps };
}

/** A `[CI-GATE-STEP]` payload: `{check, job, step: {number, name, conclusion} | null}`, names decoded; undefined when malformed. */
function readStep(payload: string): GateStep | undefined {
  try {
    const v: unknown = JSON.parse(payload.trim());
    if (typeof v !== 'object' || v === null || typeof (v as { check?: unknown }).check !== 'string') return undefined;
    const s = (v as { step?: unknown }).step;
    if (s === null) return { check: decodeCheckName((v as { check: string }).check), step: null };
    if (typeof s !== 'object' || s === undefined || typeof (s as { name?: unknown }).name !== 'string' || typeof (s as { conclusion?: unknown }).conclusion !== 'string') return undefined;
    return { check: decodeCheckName((v as { check: string }).check), step: { name: decodeCheckName((s as { name: string }).name), conclusion: (s as { conclusion: string }).conclusion.toLowerCase() } };
  } catch {
    return undefined;
  }
}

/** The checks every structured gate line reports, or undefined when the text has none. */
export function gateChecks(text: string): CiJob[] | undefined {
  const gate = readGate(text);
  return gate.structured || gate.checks.length ? gate.checks : undefined;
}

export interface CiClassification {
  class: CiFailureClass;
  failedJobs: string[];
  evidence: string[];
}

/**
 * The class of a red CI failure. `transient`, the one same-origin rerun, needs structured evidence for every red check (card
 * T0-CI-RERUN-STRUCTURED): its conclusion is `startup_failure`, or a `[CI-GATE-STEP]` line of the check names a failed step
 * on `transientSteps`. Log text never grants a rerun: a text-only transient is `unknown` (no rerun, STOP/ci), its matches
 * kept as evidence. Red checks include independent jobs and gate checks; only explicitly marked aggregate wrappers are excluded.
 * Security and code-defect evidence keep their precedence.
 */
export function classifyCiFailure(jobs: CiJob[], extraLog?: string, options: { transientSteps?: readonly string[] } = {}): CiClassification {
  const transientSteps = options.transientSteps ?? DEFAULT_TRANSIENT_STEPS;
  const failed = jobs.filter((j) => j.conclusion && !['success', 'neutral', 'skipped'].includes(j.conclusion.toLowerCase()));
  const texts = [...failed.map((j) => j.logExcerpt ?? ''), extraLog ?? ''].filter((t) => t.length > 0);
  const evidence: string[] = [];
  const securityHits: string[] = [];
  for (const j of failed) if (SECURITY_CHECK_NAME.test(j.name)) securityHits.push(j.name);
  const logs: string[] = [];
  const gateChecked: CiJob[] = [];
  const steps: GateStep[] = [];
  let gateStructured = false;
  let unresolvedRed = false;
  for (const raw of texts) {
    const gate = readGate(raw);
    gateChecked.push(...gate.redChecks);
    steps.push(...gate.steps);
    unresolvedRed ||= gate.unresolvedRed;
    gateStructured ||= gate.structured || gate.checks.length > 0;
    for (const c of gate.checks) if (isFailure(c.conclusion) && SECURITY_CHECK_NAME.test(c.name)) securityHits.push(c.name);
    for (const line of gate.ambiguousRed) if (SECURITY_CHECK_NAME.test(line)) securityHits.push(`unparsed red gate line naming a scan: ${line.slice(0, 80)}`);
    for (const p of SECURITY_PATTERNS) {
      const m = gate.log.match(p);
      if (m) securityHits.push(m[0].trim().slice(0, 80));
    }
    logs.push(gate.log);
  }
  let codeHits = 0;
  let transientHits = 0;
  for (const text of logs) {
    for (const p of CODE_DEFECT_PATTERNS) {
      const m = text.match(p);
      if (m) {
        codeHits += 1;
        evidence.push(`code: ${m[0].slice(0, 80)}`);
      }
    }
    for (const p of TRANSIENT_PATTERNS) {
      const m = text.match(p);
      if (m) {
        transientHits += 1;
        evidence.push(`transient: ${m[0].slice(0, 80)}`);
      }
    }
  }
  void transientHits; // the transient log matches stay in the evidence and grant nothing
  const independent = failed.filter((j) => j.aggregate !== true);
  const red = gateStructured ? [...gateChecked, ...independent.filter((j) => !gateChecked.some((c) => c.name === j.name && c.conclusion?.toLowerCase() === j.conclusion?.toLowerCase()))] : independent;
  const evidenced = (c: CiJob) => (c.conclusion ?? '').toLowerCase() === 'startup_failure' || steps.some((s) => s.check === c.name && s.step !== null && s.step.conclusion === 'failure' && transientSteps.includes(s.step.name));
  let cls: CiFailureClass;
  if (securityHits.length > 0) cls = 'security'; // a red secret or security scan is never rerun and never repaired blind
  else if (codeHits > 0) cls = 'code-defect'; // any deterministic failure evidence wins; repair first
  else if (!unresolvedRed && red.length > 0 && new Set(independent.map((j) => j.name)).size === independent.length && new Set(red.map((c) => c.name)).size === red.length && red.every(evidenced)) cls = 'transient';
  else cls = 'unknown';
  return { class: cls, failedJobs: failed.map((j) => j.name), evidence: [...new Set(securityHits).values()].map((s) => `security: ${s}`).concat(evidence) };
}

export interface RerunDecision {
  allowed: boolean;
  reason: string;
}

/** Whether a same-origin rerun for (runId, attempt, candidate) is still within allowance. */
export function canRerun(ledger: CiLedger, runId: string, attempt: number, candidate: string, classification: CiFailureClass): RerunDecision {
  if (classification !== 'transient') {
    const reason =
      classification === 'code-defect'
        ? 'code defect: repair in BUILD and ship a new candidate'
        : classification === 'security'
          ? 'security gate: a red secret or security scan is never rerun; remove the finding and ship a new candidate'
          : 'unclassified failure: diagnose before any rerun';
    return { allowed: false, reason };
  }
  const used = ledger.reruns.filter((r) => r.candidate === candidate && r.outcome !== 'cancelled');
  if (used.length >= MAX_CI_TRANSIENT_RERUNS) {
    return { allowed: false, reason: `rerun allowance (${MAX_CI_TRANSIENT_RERUNS}) already consumed for candidate ${candidate.slice(0, 12)} (run ${used[0]?.runId} attempt ${used[0]?.attempt})` };
  }
  if (used.some((r) => r.runId === runId && r.attempt === attempt)) {
    return { allowed: false, reason: 'a rerun for this run/attempt is already persisted; reconcile its outcome first' };
  }
  return { allowed: true, reason: 'justified transient failure; one same-origin rerun permitted' };
}

/** Persist the rerun intent BEFORE issuing the request. */
export function recordRerunIntent(ledger: CiLedger, runId: string, attempt: number, candidate: string, requestedAt: string): CiLedger {
  return { ...ledger, reruns: [...ledger.reruns, { runId, attempt, candidate, requestedAt, outcome: 'requested' }] };
}

export function reconcileRerun(ledger: CiLedger, runId: string, attempt: number, outcome: 'queued' | 'in_progress' | 'success' | 'failure' | 'lost' | 'cancelled', reconciledAt: string): CiLedger {
  return {
    ...ledger,
    reruns: ledger.reruns.map((r) => (r.runId === runId && r.attempt === attempt ? { ...r, outcome, reconciledAt } : r)),
  };
}

/** Whether a lost rerun response must be looked up before any further CI action. */
export function hasUnreconciledRerun(ledger: CiLedger): boolean {
  return ledger.reruns.some((r) => r.outcome === 'requested' || r.outcome === 'lost' || r.outcome === 'queued' || r.outcome === 'in_progress');
}
