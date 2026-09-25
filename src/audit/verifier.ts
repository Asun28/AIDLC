/**
 * Independent audit verifier (plan v5 LC12, Q12).
 *
 * Levels reported honestly:
 *  - `recorded`: a journal exists and parses.
 *  - `traceable`: the chain verifies, every mutation intent has a result or explicit UNKNOWN,
 *    delegated work carries invocation ids, and closure references resolve.
 *  - `independently-verified`: additionally the sealed manifest verifies, retained artifacts
 *    match their digests, and evidence is bound to the final candidate.
 *  - `BLOCKED/capability`: the host cannot provide a capture boundary for the declared
 *    model/tool inventory; the narrower observed level is reported with the exact prerequisite.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Journal } from '../state/journal.ts';
import { fileSha256, type EvidenceStore, type Manifest } from './manifest.ts';
import type { OperationLedger } from '../coordination/reconcile.ts';

export type AuditLevel = 'none' | 'recorded' | 'traceable' | 'independently-verified';

export interface AuditFinding {
  severity: 'block' | 'warn';
  code: string;
  detail: string;
}

export interface AuditReport {
  goalId: string;
  level: AuditLevel;
  claimedFullyAudited: boolean;
  fullyAuditedStatus: 'not-claimed' | 'verified' | 'BLOCKED/capability';
  prerequisite?: string;
  findings: AuditFinding[];
  journal: { events: number; head: string; ok: boolean };
  manifest?: { sealed: boolean; sealOk: boolean; entries: number };
  checkedAt: string;
}

export interface VerifierInput {
  goalId: string;
  journal: Journal;
  operations?: OperationLedger;
  evidence?: EvidenceStore;
  manifest?: Manifest;
  /** Whether the host captured model turns / tool calls for the declared inventory (existing-host prerequisite). */
  hostCaptureBoundary?: { present: boolean; detail: string };
  finalCandidateDigest?: string;
  now: string;
}

export function verifyAudit(input: VerifierInput): AuditReport {
  const findings: AuditFinding[] = [];
  const chain = input.journal.verify();
  if (!chain.ok) for (const p of chain.problems) findings.push({ severity: 'block', code: 'JOURNAL_CHAIN', detail: `line ${p.line}: ${p.problem}` });
  const events = chain.ok ? input.journal.readAll() : [];

  // Mutation intents must have results or explicit UNKNOWN.
  if (input.operations) {
    for (const op of input.operations.list({ goalId: input.goalId })) {
      if (['intended', 'issued', 'running'].includes(op.status)) findings.push({ severity: 'block', code: 'OP_UNRESOLVED', detail: `operation ${op.id} (${op.kind}) has no result; reconcile before closing` });
      if (op.status === 'UNKNOWN') findings.push({ severity: 'warn', code: 'OP_UNKNOWN', detail: `operation ${op.id} outcome remains UNKNOWN (explicit)` });
      const intentEvent = events.find((e) => e.type === 'OPERATION_INTENT' && e.data['operationId'] === op.id);
      if (!intentEvent) findings.push({ severity: 'block', code: 'OP_INTENT_MISSING', detail: `operation ${op.id} has no OPERATION_INTENT journal event` });
    }
  }

  // Delegated work must carry invocation ids.
  for (const e of events) {
    if ((e.type === 'MODEL_INVOCATION' || e.type === 'CARD_DISPATCHED') && !e.data['invocationId'] && !e.data['childRef']) {
      findings.push({ severity: 'block', code: 'TRACE_MISSING', detail: `event #${e.seq} (${e.type}) lacks invocationId/childRef` });
    }
  }

  // Terminal accounting: work counts against the latest disposition journaled before it. A user-authorised re-admission ends
  // a terminal disposition: the resume takeover (it links from an earlier generation and moves to a later one) and the
  // extension of a time stop (GOAL_STATE from STOP to CARDS in the generation of a GOAL_STOPPED for time). A lease takeover
  // re-admits nothing, and work of a generation below the highest one a resume moved to is a late wakeup of a stopped
  // generation. The chain check guarantees the events are in sequence order.
  const generationOf = (e: { generation?: number }) => e.generation ?? 0;
  let terminal: (typeof events)[number] | undefined;
  let resumedGeneration: number | undefined;
  let afterTerminal = 0;
  for (const e of events) {
    if (e.type === 'GOAL_DONE' || e.type === 'GOAL_STOPPED') terminal = e;
    else if (e.type === 'GOAL_TAKEOVER' && typeof e.data['linkedFrom'] === 'string') {
      resumedGeneration = Math.max(resumedGeneration ?? 0, generationOf(e));
      if (terminal && generationOf(e) > generationOf(terminal)) terminal = undefined;
    } else if (e.type === 'GOAL_STATE' && e.data['from'] === 'STOP' && e.data['to'] === 'CARDS' && terminal?.type === 'GOAL_STOPPED' && terminal.data['reason'] === 'time' && generationOf(e) === generationOf(terminal)) terminal = undefined;
    else if (['CARD_DISPATCHED', 'OPERATION_ISSUED', 'ATTEMPT_STARTED'].includes(e.type) && (terminal || (resumedGeneration !== undefined && generationOf(e) < resumedGeneration))) afterTerminal += 1;
  }
  if (afterTerminal) findings.push({ severity: 'block', code: 'WORK_AFTER_TERMINAL', detail: `${afterTerminal} mutation event(s) after terminal disposition` });

  // Manifest / artifacts.
  let manifestInfo: AuditReport['manifest'];
  if (input.manifest && input.evidence) {
    const sealOk = input.evidence.verifySeal(input.manifest);
    manifestInfo = { sealed: Boolean(input.manifest.seal), sealOk, entries: input.manifest.entries.length };
    if (!input.manifest.seal) findings.push({ severity: 'warn', code: 'MANIFEST_UNSEALED', detail: 'manifest not sealed' });
    else if (!sealOk) findings.push({ severity: 'block', code: 'MANIFEST_SEAL', detail: 'manifest seal does not verify (altered after sealing)' });
    if (input.manifest.journalHead && input.manifest.journalHead !== chain.head) {
      // Events after the seal are acceptable only when none of them is a mutation; closure bookkeeping may follow a seal.
      const sealedAt = events.find((e) => e.hash === input.manifest!.journalHead)?.seq;
      const after = sealedAt === undefined ? events : events.filter((e) => e.seq > sealedAt);
      const mutating = after.filter((e) => ['CARD_DISPATCHED', 'OPERATION_ISSUED', 'ATTEMPT_STARTED', 'REVIEW_DECIDED', 'CI_RERUN', 'RELEASE_STATE', 'CARD_RESULT'].includes(e.type));
      if (sealedAt === undefined || mutating.length) findings.push({ severity: 'block', code: 'MANIFEST_STALE', detail: sealedAt === undefined ? 'manifest journal head is not in the journal' : `${mutating.length} mutation event(s) after the seal (${mutating.map((e) => e.type).join(',')})` });
      else findings.push({ severity: 'warn', code: 'MANIFEST_TRAILING', detail: `${after.length} non-mutating event(s) after the seal` });
    }
    for (const entry of input.manifest.entries) {
      const file = path.join(input.evidence.dir, entry.path);
      if (!existsSync(file)) findings.push({ severity: 'block', code: 'ARTIFACT_MISSING', detail: `${entry.id}: ${entry.path} missing` });
      else if (fileSha256(file) !== entry.sha256) findings.push({ severity: 'block', code: 'ARTIFACT_ALTERED', detail: `${entry.id}: digest mismatch` });
      if (input.finalCandidateDigest && entry.candidateDigest && entry.candidateDigest !== input.finalCandidateDigest && ['dod-receipt', 'review-verdict', 'ci-run', 'test-output', 'health'].includes(entry.kind)) {
        findings.push({ severity: 'block', code: 'EVIDENCE_STALE_CANDIDATE', detail: `${entry.id} is bound to candidate ${entry.candidateDigest.slice(0, 12)}, final is ${input.finalCandidateDigest.slice(0, 12)}` });
      }
    }
  }

  const blocks = findings.filter((f) => f.severity === 'block');
  let level: AuditLevel = 'none';
  if (chain.events > 0) level = 'recorded';
  if (chain.events > 0 && chain.ok && !blocks.some((b) => ['OP_UNRESOLVED', 'OP_INTENT_MISSING', 'TRACE_MISSING', 'WORK_AFTER_TERMINAL', 'JOURNAL_CHAIN'].includes(b.code))) level = 'traceable';
  if (level === 'traceable' && manifestInfo?.sealed && manifestInfo.sealOk && !blocks.some((b) => b.code.startsWith('ARTIFACT') || b.code.startsWith('MANIFEST') || b.code === 'EVIDENCE_STALE_CANDIDATE')) level = 'independently-verified';

  let fullyAuditedStatus: AuditReport['fullyAuditedStatus'] = 'not-claimed';
  let prerequisite: string | undefined;
  if (input.hostCaptureBoundary) {
    if (input.hostCaptureBoundary.present && level === 'independently-verified') fullyAuditedStatus = 'verified';
    else {
      fullyAuditedStatus = 'BLOCKED/capability';
      prerequisite = input.hostCaptureBoundary.present ? `audit level is ${level}; resolve blocking findings` : `host capture boundary missing: ${input.hostCaptureBoundary.detail}`;
    }
  }
  return {
    goalId: input.goalId,
    level,
    claimedFullyAudited: Boolean(input.hostCaptureBoundary),
    fullyAuditedStatus,
    prerequisite,
    findings,
    journal: { events: chain.events, head: chain.head, ok: chain.ok },
    manifest: manifestInfo,
    checkedAt: input.now,
  };
}
