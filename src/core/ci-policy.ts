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

/**
 * The steps of a secret or security scan job that install the scanner before its scan: the default of `ci.scanSetupSteps`, the
 * install step of the shipped `security-scanners.yml` (card T0-SCAN-SETUP-STEP). A scan check red at one of them did not scan.
 */
export const DEFAULT_SCAN_SETUP_STEPS: readonly string[] = ['Install gitleaks (pinned version, checksum verified)'];

/** The failed step a `[CI-GATE-STEP]` line names for a check, or null when the job record places none. */
interface GateStep {
  check: string;
  step: { name: string; conclusion: string } | null;
  /** The line is exactly what the GitHub ship path prints, the only form a scan setup exemption reads (card T0-SCAN-SETUP-STEP). */
  exact: boolean;
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
  /** The check each malformed `[CI-GATE-STEP]` line names, decoded, or null when no check can be read from it. */
  invalidSteps: Array<string | null>;
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
  const invalidSteps: Array<string | null> = [];
  let structured = false;
  let unresolvedRed = false;
  for (const line of text.split(/\r?\n/)) {
    const start = checks.length;
    if (!GATE_LINE.test(line)) {
      log.push(line);
      continue;
    }
    if (line.startsWith('[CI-GATE-WAIT]')) continue;
    // A step line is structured evidence and never log text; one that does not parse is no transient evidence, and it is
    // kept by the check it names so it can deny a scan setup exemption (card T0-SCAN-SETUP-STEP).
    if (line.startsWith('[CI-GATE-STEP]')) {
      const payload = line.slice('[CI-GATE-STEP]'.length);
      const step = readStep(payload);
      if (step) steps.push({ ...step, exact: isShipStepPayload(payload) });
      else invalidSteps.push(readStepCheck(payload));
      continue;
    }
    const m = line.match(JSON_PAYLOAD);
    if (m) {
      try {
        const parsed: unknown = JSON.parse(m[1]!);
        if (Array.isArray(parsed)) {
          structured = true;
          const redLine = line.startsWith('[CI-GATE-RED]');
          if ((redLine && !parsed.length) || parsed.some((c) => typeof c !== 'object' || c === null || typeof c.name !== 'string' || !c.name.trim() || (typeof c.conclusion !== 'string' && (redLine || c.conclusion !== null)))) unresolvedRed = true;
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
    if (line.startsWith('[CI-GATE-TIMEOUT]')) unresolvedRed = true;
    log.push(line);
  }
  return { checks, redChecks, structured, ambiguousRed, unresolvedRed, log: log.join('\n'), steps, invalidSteps };
}

/** The check a malformed `[CI-GATE-STEP]` payload names, decoded, or null when it names none that can be read (a blank check included). */
function readStepCheck(payload: string): string | null {
  try {
    const v: unknown = JSON.parse(payload.trim());
    const check = typeof v === 'object' && v !== null ? (v as { check?: unknown }).check : undefined;
    return typeof check === 'string' && check.trim() ? decodeCheckName(check) : null;
  } catch {
    return null;
  }
}

/**
 * Whether a `[CI-GATE-STEP]` payload is exactly what the GitHub ship path prints (`gateStepLine` in src/delivery/github-ship.ts):
 * one space, then the JSON of `check` (non-blank), `job` (a job id of digits) and `step` (null, or a positive integer `number`,
 * a `name` and a `conclusion`), in that order, with no other or repeated key, no other spacing, U+2028, U+2029 and `/` escaped.
 * Any other form names no step a scan setup exemption reads (card T0-SCAN-SETUP-STEP); a change to the printed form makes
 * every red scan check `security` again until this follows it.
 */
function isShipStepPayload(payload: string): boolean {
  let v: unknown;
  try {
    v = JSON.parse(payload);
  } catch {
    return false;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const { check, job, step } = v as Record<string, unknown>;
  if (typeof check !== 'string' || !check.trim() || typeof job !== 'string' || !/^\d+$/.test(job)) return false;
  let printed: { number: number; name: string; conclusion: string } | null = null;
  if (step !== null) {
    if (typeof step !== 'object' || step === undefined || Array.isArray(step)) return false;
    const { number, name, conclusion } = step as Record<string, unknown>;
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1 || typeof name !== 'string' || typeof conclusion !== 'string') return false;
    printed = { number, name, conclusion };
  }
  const json = JSON.stringify({ check, job, step: printed }).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029').replace(/\//g, '\\/');
  return payload === ` ${json}`;
}

/**
 * A `[CI-GATE-STEP]` payload: `{check, job, step: {number, name, conclusion} | null}`, names decoded; undefined when malformed,
 * a blank check included, since it names no check (card T0-SCAN-SETUP-STEP).
 */
function readStep(payload: string): Omit<GateStep, 'exact'> | undefined {
  try {
    const v: unknown = JSON.parse(payload.trim());
    if (typeof v !== 'object' || v === null || typeof (v as { check?: unknown }).check !== 'string' || !(v as { check: string }).check.trim()) return undefined;
    const s = (v as { step?: unknown }).step;
    if (s === null) return { check: decodeCheckName((v as { check: string }).check), step: null };
    if (typeof s !== 'object' || s === undefined || typeof (s as { name?: unknown }).name !== 'string' || typeof (s as { conclusion?: unknown }).conclusion !== 'string') return undefined;
    return { check: decodeCheckName((v as { check: string }).check), step: { name: decodeCheckName((s as { name: string }).name), conclusion: (s as { conclusion: string }).conclusion.toLowerCase() } };
  } catch {
    return undefined;
  }
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
 * Security and code-defect evidence keep their precedence. A red scan check is no security hit when it failed in a step on
 * `scanSetupSteps` before its scan (card T0-SCAN-SETUP-STEP): it is then classified as any other red check is.
 */
export function classifyCiFailure(jobs: CiJob[], extraLog?: string, options: { transientSteps?: readonly string[]; scanSetupSteps?: readonly string[] } = {}): CiClassification {
  const transientSteps = options.transientSteps ?? DEFAULT_TRANSIENT_STEPS;
  const scanSetupSteps = options.scanSetupSteps ?? DEFAULT_SCAN_SETUP_STEPS;
  const failed = jobs.filter((j) => j.conclusion && !['success', 'neutral', 'skipped'].includes(j.conclusion.toLowerCase()));
  const texts = [...jobs.map((j) => ({ raw: j.logExcerpt ?? '', inspectLog: failed.includes(j) })), { raw: extraLog ?? '', inspectLog: true }];
  const evidence: string[] = [];
  /** Each hit, with the red scan check it names when it comes from a check name alone. */
  const securityHits: Array<{ hit: string; check?: string }> = [];
  // A receipt wrapper is no check record, so a hit from its name is never exempt.
  for (const j of failed) if (SECURITY_CHECK_NAME.test(j.name)) securityHits.push({ hit: j.name, check: j.aggregate === true ? undefined : j.name });
  const logs: string[] = [];
  const gateChecked: CiJob[] = [];
  const gateRecords: CiJob[] = [];
  const steps: GateStep[] = [];
  const invalidSteps: Array<string | null> = [];
  let gateStructured = false;
  let unresolvedRed = false;
  for (const { raw, inspectLog } of texts) {
    const gate = readGate(raw);
    gateChecked.push(...gate.redChecks);
    gateRecords.push(...gate.checks);
    steps.push(...gate.steps);
    invalidSteps.push(...gate.invalidSteps);
    unresolvedRed ||= gate.unresolvedRed;
    gateStructured ||= gate.structured || gate.checks.length > 0;
    for (const c of gate.checks) if (isFailure(c.conclusion) && SECURITY_CHECK_NAME.test(c.name)) securityHits.push({ hit: c.name, check: c.name });
    for (const line of gate.ambiguousRed) if (SECURITY_CHECK_NAME.test(line)) securityHits.push({ hit: `unparsed red gate line naming a scan: ${line.slice(0, 80)}` });
    if (!inspectLog) continue;
    for (const p of SECURITY_PATTERNS) {
      const m = gate.log.match(p);
      if (m) securityHits.push({ hit: m[0].trim().slice(0, 80) });
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
  const independent = jobs.filter((j) => j.aggregate !== true);
  const independentFailed = independent.filter((j) => isFailure(j.conclusion));
  const conclusions = new Map<string, string | undefined>();
  const identitiesAgree = [...independent, ...gateRecords].every((j) => {
    const conclusion = j.conclusion?.toLowerCase();
    if (conclusions.has(j.name) && conclusions.get(j.name) !== conclusion) return false;
    conclusions.set(j.name, conclusion);
    return true;
  });
  const red = gateStructured ? [...gateChecked, ...independentFailed.filter((j) => !gateChecked.some((c) => c.name === j.name && c.conclusion?.toLowerCase() === j.conclusion?.toLowerCase()))] : independentFailed;
  const evidenced = (c: CiJob) => c.name.trim().length > 0 && ((c.conclusion ?? '').toLowerCase() === 'startup_failure' || steps.some((s) => s.check === c.name && s.step !== null && s.step.conclusion === 'failure' && transientSteps.includes(s.step.name)));
  // A scan check that failed installing its scanner did not scan (card T0-SCAN-SETUP-STEP). Fails closed: no red line is
  // unresolved; the check has at most one job record and one gate record, counted before they are matched, which agree on its
  // conclusion, and is one red check; no step line naming it, or naming no readable check, is malformed; and every step line
  // naming it names a failed listed step. Records of other checks never decide this check.
  const setupStep = (check: string): string | undefined => {
    const jobRecords = independent.filter((j) => j.name === check);
    const gateRecordsOf = gateRecords.filter((c) => c.name === check);
    if (unresolvedRed || jobRecords.length > 1 || gateRecordsOf.length > 1 || red.filter((c) => c.name === check).length !== 1) return undefined;
    if (new Set([...jobRecords, ...gateRecordsOf].map((c) => c.conclusion?.toLowerCase())).size !== 1) return undefined;
    if (invalidSteps.some((c) => c === null || c === check)) return undefined;
    const placed = steps.filter((s) => s.check === check);
    if (!placed.length || !placed.every((s) => s.exact && s.step !== null && s.step.conclusion === 'failure' && scanSetupSteps.includes(s.step.name))) return undefined;
    return placed[0]!.step!.name;
  };
  const setupFailures = new Map<string, string>();
  const findings = securityHits.filter(({ check }) => {
    const step = check === undefined ? undefined : setupStep(check);
    if (step === undefined) return true;
    setupFailures.set(check!, step);
    return false;
  });
  let cls: CiFailureClass;
  if (findings.length > 0) cls = 'security'; // a red secret or security scan is never rerun and never repaired blind
  else if (codeHits > 0) cls = 'code-defect'; // any deterministic failure evidence wins; repair first
  else if (!unresolvedRed && identitiesAgree && red.length > 0 && new Set(independent.map((j) => j.name)).size === independent.length && new Set(red.map((c) => c.name)).size === red.length && red.every(evidenced)) cls = 'transient';
  else cls = 'unknown';
  const setupNotes = [...setupFailures].map(([check, step]) => `scan-setup: ${JSON.stringify(check)} failed at ${JSON.stringify(step)} before its scan`);
  return { class: cls, failedJobs: failed.map((j) => j.name), evidence: [...new Set(findings.map((f) => f.hit)).values()].map((s) => `security: ${s}`).concat(evidence, setupNotes) };
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
