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
import type { GitProbe } from '../probes/git.ts';
import type { GhProbe } from '../probes/gh.ts';
import { ShippedFacts, type PrInfo } from '../core/types.ts';

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
  /** The probes that re-derive the facts journaled with each merge (card T1-AUDIT-FACTS); `base` is the ref a merge must be on. */
  probes?: { git: GitProbe; gh: GhProbe; cwd: string; base: string; repository?: string };
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

  // Merge facts (card T1-AUDIT-FACTS). A card is shipped when a merge intent of the card has a succeeded result or
  // reconciliation; the facts are read only from the result its one writer journals (OPERATION_RESULT of the intent's card and
  // operation, status succeeded) and never from narration. Each card counts the facts git and gh re-derived as recorded.
  const merges = new Map(events.filter((e) => e.type === 'OPERATION_INTENT' && e.data['kind'] === 'merge' && e.cardId && typeof e.data['operationId'] === 'string').map((e) => [e.data['operationId'], e.cardId!]));
  const rederived = new Map<string, number>();
  for (const e of events) {
    const card = merges.get(e.data['operationId']);
    if (!card || e.cardId !== card || e.data['status'] !== 'succeeded' || (e.type !== 'OPERATION_RESULT' && e.type !== 'OPERATION_RECONCILED')) continue;
    const facts = e.type === 'OPERATION_RESULT' ? ShippedFacts.safeParse(e.data).data : undefined;
    rederived.set(card, (rederived.get(card) ?? 0) + (facts ? rederive(card, facts, input.probes, findings) : 0));
  }
  const noFacts = [...rederived].filter(([, n]) => n === 0).map(([card]) => card);

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
  if (level === 'traceable' && manifestInfo?.sealed && manifestInfo.sealOk && !blocks.some((b) => b.code.startsWith('ARTIFACT') || b.code.startsWith('MANIFEST') || b.code === 'EVIDENCE_STALE_CANDIDATE' || b.code === 'FACT_MISMATCH')) level = 'independently-verified';

  let fullyAuditedStatus: AuditReport['fullyAuditedStatus'] = 'not-claimed';
  let prerequisite: string | undefined;
  if (input.hostCaptureBoundary) {
    if (input.hostCaptureBoundary.present && level === 'independently-verified' && noFacts.length === 0) fullyAuditedStatus = 'verified';
    else {
      fullyAuditedStatus = 'BLOCKED/capability';
      const host = !input.hostCaptureBoundary.present ? `host capture boundary missing: ${input.hostCaptureBoundary.detail}` : level !== 'independently-verified' ? `audit level is ${level}; resolve blocking findings` : '';
      prerequisite = [host, noFacts.length ? `no re-derived fact for shipped card(s): ${noFacts.join(', ')}` : ''].filter(Boolean).join('; ');
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

/**
 * Re-derives one card's merge facts from git and gh (card T1-AUDIT-FACTS) and returns how many matched: a disagreement is a
 * FACT_MISMATCH block naming the card, the fact and both values; a fact git or gh cannot answer is a FACT_UNVERIFIED warning.
 */
function rederive(card: string, facts: ShippedFacts, probes: VerifierInput['probes'], findings: AuditFinding[]): number {
  let matched = 0;
  const check = (fact: string, recorded: string, derived: string | undefined, source: 'git' | 'gh') => {
    if (derived === undefined) findings.push({ severity: 'warn', code: 'FACT_UNVERIFIED', detail: `${card} ${fact}: recorded ${recorded}, not re-derived (${source})` });
    else if (derived !== recorded) findings.push({ severity: 'block', code: 'FACT_MISMATCH', detail: `${card} ${fact}: recorded ${recorded}, re-derived ${derived}` });
    else matched += 1;
  };
  const onBase = probes?.git.contains(probes.cwd, probes.base, facts.mergeSha);
  check('mergeSha object type', 'commit', probes?.git.objectType(probes.cwd, facts.mergeSha), 'git');
  check('tree', facts.tree, probes?.git.treeOf(probes.cwd, facts.mergeSha), 'git');
  check(`mergeSha on ${probes?.base ?? 'the base'}`, 'ancestor', onBase === undefined ? undefined : onBase ? 'ancestor' : 'not an ancestor', 'git');
  let view: PrInfo | undefined;
  try {
    view = probes?.repository ? probes.gh.prView(probes.repository, facts.pr, probes.cwd) : undefined;
  } catch {
    view = undefined;
  }
  check(`pr ${facts.pr} state`, 'MERGED', view?.state, 'gh');
  check('mergeSha', facts.mergeSha, view && (view.mergeCommit ?? 'none'), 'gh');
  check('headSha', facts.headSha, view && (view.headRefOid ?? 'none'), 'gh');
  return matched;
}
