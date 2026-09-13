/**
 * Core domain types and persisted schemas for the AI-native SDLC loop.
 *
 * Everything that is written to disk has a zod schema so that a stale, hand-edited or
 * partially written record is refused rather than silently trusted (plan v5 §5: "if records
 * are lost, recover verified evidence or STOP; do not invent a clean start").
 *
 * Naming follows the v5 plan: request sizes (T0-bugfix/T0/T1/T2), goal/card/release states,
 * STOP reasons, LC1 delivery targets, MS1-MS5 coordination, MA1-MA3 model policy.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

/** ISO-8601 UTC timestamp as produced by `new Date().toISOString()`. */
export const IsoTimestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/, 'expected ISO-8601 UTC timestamp');
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;

/** Card id as machine-checked by the scaffold: `T<stage>-<UPPER-KEBAB>`. */
export const CARD_ID_REGEX = /^T\d+-[A-Z0-9]+(-[A-Z0-9]+)*$/;
export const CardId = z.string().regex(CARD_ID_REGEX, 'card id must match ^T\\d+-[A-Z0-9]+(-[A-Z0-9]+)*$');
export type CardId = z.infer<typeof CardId>;

export const Sha256Hex = z.string().regex(/^[a-f0-9]{64}$/, 'expected lowercase sha256 hex');
export type Sha256Hex = z.infer<typeof Sha256Hex>;

// ---------------------------------------------------------------------------
// Request classification (plan §3)
// ---------------------------------------------------------------------------

export const RequestSize = z.enum(['T0-bugfix', 'T0', 'T1', 'T2']);
export type RequestSize = z.infer<typeof RequestSize>;

export const RequestKind = z.enum([
  'bugfix', // one narrow reproducible defect
  'change', // one narrow behaviour change
  'feature', // module/feature, usually 2-5 cards
  'system', // new system / major architecture
  'card-execute', // execute an existing card id
  'card-amendment', // modify an old card (text or contract)
  'issue', // qualified issue reference
  'incident', // alert / observed regression
  'release', // explicit package / staging / production request
  'migration', // explicit data migration operation
]);
export type RequestKind = z.infer<typeof RequestKind>;

/** LC1 delivery targets. Development is the default; everything else is opt-in. */
export const DeliveryTarget = z.enum(['development', 'package', 'staging', 'production', 'migration', 'operations']);
export type DeliveryTarget = z.infer<typeof DeliveryTarget>;

/** LC1: a disabled stage is `not_requested`, never PASS / FAIL / missing. */
export const StageStatus = z.enum(['not_requested', 'pending', 'pass', 'fail', 'unknown']);
export type StageStatus = z.infer<typeof StageStatus>;

export const Module = z.enum(['router', 'card-loop', 'arc', 'release', 'migrate']);
export type Module = z.infer<typeof Module>;

/** Project-level tier computed by the scaffold from allow_paths; distinct from request size. */
export const ProjectTier = z.enum(['S', '1', '0']);
export type ProjectTier = z.infer<typeof ProjectTier>;

export const RoutingResult = z.object({
  size: RequestSize,
  sizeSource: z.enum(['explicit', 'inferred']),
  kind: RequestKind,
  target: DeliveryTarget,
  targetSource: z.enum(['explicit', 'default']),
  cardCount: z.union([z.number().int().nonnegative(), z.literal('unknown')]),
  modules: z.array(Module),
  nextModule: Module,
  /** Companion skills the route calls for (tdd, diagnose, grilling, merge-conflicts); the directives carry them. */
  skills: z.array(z.string()).default([]),
  dataImpact: z.boolean(),
  impactEscalation: z.string().optional(),
  ambiguity: z.string().optional(),
  reasons: z.array(z.string()),
});
export type RoutingResult = z.infer<typeof RoutingResult>;

// ---------------------------------------------------------------------------
// States (plan §5 / §6)
// ---------------------------------------------------------------------------

export const GoalState = z.enum(['PLAN', 'CARDS', 'RUN', 'WAIT', 'VERIFY_ARC', 'DELIVER', 'CLOSE', 'DONE', 'STOP']);
export type GoalState = z.infer<typeof GoalState>;

export const CardState = z.enum(['PREPARE', 'BUILD', 'SHIP', 'REVIEW_FIX', 'WAIT', 'CLOSE', 'DONE', 'STOP']);
export type CardState = z.infer<typeof CardState>;

export const ReleaseState = z.enum([
  'PREPARE',
  'STAGE',
  'CHECKPOINT',
  'APPLY',
  'OBSERVE',
  'RECOVER',
  'CLOSE',
  'DONE',
  'WAIT',
  'STOP',
]);
export type ReleaseState = z.infer<typeof ReleaseState>;

export const StopReason = z.enum([
  'card',
  'capability',
  'scope',
  'risk',
  'frozen',
  'checkpoint',
  'review',
  'tool',
  'ci',
  'auth',
  'time',
  'arc-verify',
  'release-config',
  'release-auth',
  'release-health',
  'migration',
  'rollback-auth',
  'audit',
  'ownership',
  'cancelled',
]);
export type StopReason = z.infer<typeof StopReason>;

export const StopRecord = z.object({
  reason: StopReason,
  detail: z.string(),
  nextAction: z.string(),
  /** true when the condition is a global prohibition/capture failure, false when one branch is blocked. */
  global: z.boolean(),
  at: IsoTimestamp,
  unresolvedOperations: z.array(z.string()).default([]),
});
export type StopRecord = z.infer<typeof StopRecord>;

// ---------------------------------------------------------------------------
// Actor / identity
// ---------------------------------------------------------------------------

export const ActorIdentity = z.object({
  session: z.string().min(1),
  pid: z.number().int().nonnegative(),
  /** Process start time; pid + start together identify a process instance. */
  processStart: IsoTimestamp,
  host: z.string().min(1),
});
export type ActorIdentity = z.infer<typeof ActorIdentity>;

// ---------------------------------------------------------------------------
// Cards (scaffold-compatible projection of the accepted plan)
// ---------------------------------------------------------------------------

export const CardStatus = z.enum(['todo', 'in-progress', 'in-review', 'merged']);
export type CardStatus = z.infer<typeof CardStatus>;

export const CardDiagnosis = z.object({
  root_cause: z.string(),
  same_class: z.string().optional(),
});

export const Card = z.object({
  id: CardId,
  title: z.string().min(1),
  status: CardStatus,
  branch: z.string().min(1),
  worktree: z.string().min(1),
  allow_paths: z.array(z.string().min(1)).min(1),
  dod_command: z.string().min(1),
  dod_exit: z.number().int().default(0),
  review_gate: z.string().optional(),
  acceptance: z.array(z.string()).default([]),
  requirements: z.array(z.string()).optional(),
  depends_on: z.array(CardId).default([]),
  parallelizable_with: z.array(CardId).default([]),
  plan_ref: z.string().optional(),
  budget: z.number().int().positive().optional(),
  tier: ProjectTier.optional(),
  sweep: z.string().optional(),
  forbid: z.array(z.string()).optional(),
  non_goals: z.array(z.string()).optional(),
  diagnosis: CardDiagnosis.optional(),
  dod_assert: z.string().optional(),
  hygiene: z.string().optional(),
  doc_sync: z.string().optional(),
  superseded_by: z.string().optional(),
  /** aidlc extension: explicit non-TDD exemption (documentation / pure config cards). */
  tdd: z.boolean().default(true),
  /** aidlc extension: shared interface definition / freeze card; runs alone before dependents. */
  freeze: z.boolean().default(false),
  /** aidlc extension: migration phase this card implements, if any. */
  migration_phase: z.enum(['expand', 'deploy', 'backfill', 'verify', 'contract']).optional(),
  /** aidlc extension: shared resources (ports, databases, builds) beyond allow_paths. */
  resources: z.array(z.string()).default([]),
});
export type Card = z.infer<typeof Card>;

// ---------------------------------------------------------------------------
// Review (scaffold verdict.schema.json compatible)
// ---------------------------------------------------------------------------

export const VerdictValue = z.enum(['pass', 'block']);
export const RunStatus = z.enum(['success', 'timeout', 'no_output', 'malformed', 'tool_error']);
export type RunStatus = z.infer<typeof RunStatus>;

const Axis = z.object({ verdict: VerdictValue, reasons: z.array(z.string()).default([]) });

export const Verdict = z.object({
  verdict: VerdictValue,
  reasons: z.array(z.string()).default([]),
  axes: z.object({ spec: Axis.optional(), standards: Axis.optional() }).optional(),
  sha: z.string().optional(),
  branch: z.string().optional(),
  run_status: RunStatus.optional(),
  routed_skip: z
    .object({ predicate: z.string(), reason: z.string(), changed_paths: z.array(z.string()).default([]) })
    .optional(),
});
export type Verdict = z.infer<typeof Verdict>;

export const PreReviewOutcome = z.enum(['pass', 'block', 'no-verdict', 'quota-hold']);
export type PreReviewOutcome = z.infer<typeof PreReviewOutcome>;

/** One angle of a concurrent review panel (bugs, security, compliance, or a custom focus). */
export const PerspectiveRecord = z.object({
  name: z.string().min(1),
  outcome: PreReviewOutcome,
  runStatus: RunStatus.optional(),
  reasons: z.array(z.string()).default([]),
  durationMs: z.number().int().nonnegative().default(0),
  verdictRef: z.string().optional(),
  receiptSha256: z.string().optional(),
});
export type PerspectiveRecord = z.infer<typeof PerspectiveRecord>;

export const ReviewInvocation = z.object({
  invocationId: z.string().min(1),
  candidateDigest: z.string().min(1),
  base: z.string().min(1),
  policyVersion: z.string().min(1),
  reviewer: z.string().min(1),
  requestedAt: IsoTimestamp,
  outcome: z.enum(['pass', 'block', 'no-verdict', 'quota-hold', 'pending']),
  runStatus: RunStatus.optional(),
  verdictRef: z.string().optional(),
  /** Quota hold reported by a command-run reviewer: no new decision before this time. */
  holdUntil: IsoTimestamp.optional(),
});
export type ReviewInvocation = z.infer<typeof ReviewInvocation>;

export const ReviewLedger = z.object({
  /** Valid substantive decisions (initial + one for a repaired candidate). */
  substantiveDecisions: z.number().int().nonnegative().default(0),
  substantiveBlocks: z.number().int().nonnegative().default(0),
  /** The installed script's own enforced counter, tracked separately and never rewritten. */
  scriptCounter: z.number().int().nonnegative().default(0),
  /** Initial dispatch plus one retry total across script and driver. */
  noVerdictRetriesUsed: z.number().int().nonnegative().default(0),
  invocations: z.array(ReviewInvocation).default([]),
  lastVerdict: Verdict.optional(),
});
export type ReviewLedger = z.infer<typeof ReviewLedger>;

// Pre-review (R2): a bounded second-model review before the ship. Rounds are counted per R3 cycle
// (the number of substantive R3 blocks at the time), so an R3 block restarts the cycle and a pass does not.
export const PreReviewRound = z.object({
  round: z.number().int().positive(),
  cycle: z.number().int().nonnegative(),
  reviewer: z.string().min(1),
  candidateDigest: z.string().min(1),
  candidateSha: z.string().optional(),
  requestedAt: IsoTimestamp,
  durationMs: z.number().int().nonnegative().default(0),
  outcome: PreReviewOutcome,
  runStatus: RunStatus.optional(),
  reasons: z.array(z.string()).default([]),
  verdictRef: z.string().optional(),
  receiptSha256: z.string().optional(),
  /** Quota hold: no new round before this time; the hold never counts as a decision. */
  holdUntil: IsoTimestamp.optional(),
  /** Concurrent angles of a panel round. */
  perspectives: z.array(PerspectiveRecord).optional(),
});
export type PreReviewRound = z.infer<typeof PreReviewRound>;

export const PreReviewLedger = z.object({
  rounds: z.array(PreReviewRound).default([]),
});
export type PreReviewLedger = z.infer<typeof PreReviewLedger>;

// ---------------------------------------------------------------------------
// CI
// ---------------------------------------------------------------------------

export const CiFailureClass = z.enum(['code-defect', 'transient', 'unknown']);
export type CiFailureClass = z.infer<typeof CiFailureClass>;

export const CiRerun = z.object({
  runId: z.string().min(1),
  attempt: z.number().int().positive(),
  candidate: z.string().min(1),
  requestedAt: IsoTimestamp,
  /** Persisted before the request; a lost response still consumes the allowance. */
  outcome: z.enum(['requested', 'queued', 'in_progress', 'success', 'failure', 'lost', 'cancelled']),
  reconciledAt: IsoTimestamp.optional(),
});

export const CiLedger = z.object({
  reruns: z.array(CiRerun).default([]),
});
export type CiLedger = z.infer<typeof CiLedger>;

// ---------------------------------------------------------------------------
// Effort / model policy (MA1-MA3)
// ---------------------------------------------------------------------------

export const EffortLevel = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type EffortLevel = z.infer<typeof EffortLevel>;

export const Role = z.enum(['planner', 'implementer', 'investigator', 'reviewer', 'release-specialist']);
export type Role = z.infer<typeof Role>;

export const RoleProfile = z.object({
  role: Role,
  provider: z.string().min(1),
  model: z.string().min(1),
  modelVersion: z.string().optional(),
  supportedEfforts: z.array(EffortLevel).min(1),
  tools: z.array(z.string()).default([]),
  contextLimit: z.number().int().positive().optional(),
  pool: z.string().min(1),
  readOnly: z.boolean().default(false),
  /** Result of the representative role check, if run. */
  roleCheck: z.enum(['passed', 'failed', 'not-run']).default('not-run'),
  fallback: z.string().optional(),
});
export type RoleProfile = z.infer<typeof RoleProfile>;

export const NotCountedReason = z.enum(['expected-red', 'quota', 'admission-hold', 'tool-outage', 'env-setup']);
export type NotCountedReason = z.infer<typeof NotCountedReason>;

export const Attempt = z.object({
  n: z.number().int().positive(),
  effort: EffortLevel,
  startedAt: IsoTimestamp,
  finishedAt: IsoTimestamp.optional(),
  outcome: z.enum(['success', 'fail', 'not-counted', 'running']),
  notCountedReason: NotCountedReason.optional(),
  /** Normalised failure cause used for the same-cause-twice rule. */
  cause: z.string().optional(),
  evidence: z.string().optional(),
  progress: z.boolean().default(false),
  checksGained: z.array(z.string()).default([]),
  checksLost: z.array(z.string()).default([]),
  nextHypothesis: z.string().optional(),
});
export type Attempt = z.infer<typeof Attempt>;

export const EffortEpisode = z.object({
  taskId: z.string().min(1),
  role: Role,
  baseline: EffortLevel,
  ladder: z.array(EffortLevel).min(1),
  attempts: z.array(Attempt).default([]),
  escalationUsed: z.boolean().default(false),
  terminal: z
    .enum(['succeeded', 'same-cause-stop', 'exhausted', 'escalation-unavailable', 'escalation-failed'])
    .optional(),
});
export type EffortEpisode = z.infer<typeof EffortEpisode>;

// ---------------------------------------------------------------------------
// Deadlines (plan §1 authority and limits)
// ---------------------------------------------------------------------------

export const Deadlines = z.object({
  createdAt: IsoTimestamp,
  /** Admission deadline for the whole goal (3h one-card, 12h multi-card arc). */
  goalDeadline: IsoTimestamp,
  /** Extension is explicit and recorded; a delayed approval never extends. */
  extensions: z
    .array(z.object({ at: IsoTimestamp, by: z.string(), newDeadline: IsoTimestamp, reason: z.string() }))
    .default([]),
  graceMs: z.number().int().nonnegative().default(5 * 60 * 1000),
});
export type Deadlines = z.infer<typeof Deadlines>;

// ---------------------------------------------------------------------------
// Authorization (LC6)
// ---------------------------------------------------------------------------

export const AuthorizationKind = z.enum(['development', 'plan-checkpoint', 'staging', 'production', 'recovery']);
export type AuthorizationKind = z.infer<typeof AuthorizationKind>;

export const AuthorizationRecord = z.object({
  id: z.string().min(1),
  kind: AuthorizationKind,
  grantedBy: z.string().min(1),
  grantedAt: IsoTimestamp,
  expiresAt: IsoTimestamp.optional(),
  /** Host/project permission record this approval refers to. */
  ref: z.string().optional(),
  goalRevision: z.number().int().nonnegative().optional(),
  candidateDigest: z.string().optional(),
  sourceSha: z.string().optional(),
  configDigest: z.string().optional(),
  environment: z.string().optional(),
  operations: z.array(z.string()).default([]),
  migrations: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).default([]),
  recoveryTarget: z.string().optional(),
  /** Recovery pre-authorization specifics (LC6 §2). */
  recovery: z
    .object({
      eligibleBaseline: z.string(),
      healthTrigger: z.string(),
      procedure: z.string(),
      migrationCompatibility: z.string(),
      windowMs: z.number().int().positive(),
      budget: z.string().optional(),
      owner: z.string(),
    })
    .optional(),
});
export type AuthorizationRecord = z.infer<typeof AuthorizationRecord>;

// ---------------------------------------------------------------------------
// Operations (LC4: durable intent before external mutation)
// ---------------------------------------------------------------------------

export const OperationKind = z.enum([
  'deploy',
  'migrate',
  'backfill',
  'rollback',
  'restore',
  'ci-rerun',
  'review',
  'merge',
  'tag',
  'publish',
  'package',
  'other',
]);
export type OperationKind = z.infer<typeof OperationKind>;

export const OperationStatus = z.enum(['intended', 'issued', 'running', 'succeeded', 'failed', 'UNKNOWN', 'cancelled']);
export type OperationStatus = z.infer<typeof OperationStatus>;

export const OperationRecord = z.object({
  id: z.string().min(1),
  kind: OperationKind,
  goalId: z.string().min(1),
  cardId: z.string().optional(),
  releaseAttempt: z.string().optional(),
  target: z.string().min(1),
  candidateDigest: z.string().optional(),
  idempotencyKey: z.string().optional(),
  providerOperationId: z.string().optional(),
  ownerGeneration: z.number().int().nonnegative(),
  intentRecordedAt: IsoTimestamp,
  issuedAt: IsoTimestamp.optional(),
  finishedAt: IsoTimestamp.optional(),
  reconciledAt: IsoTimestamp.optional(),
  status: OperationStatus,
  timeoutMs: z.number().int().positive(),
  effects: z.array(z.string()).default([]),
  externallyVisible: z.boolean().default(true),
  evidenceRef: z.string().optional(),
  error: z.string().optional(),
});
export type OperationRecord = z.infer<typeof OperationRecord>;

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const EvidenceRef = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'dod-receipt',
    'red-receipt',
    'review-verdict',
    'ci-run',
    'pr',
    'merge',
    'test-output',
    'health',
    'deploy',
    'migration',
    'recovery',
    'screenshot',
    'invocation',
    'artifact',
    'other',
  ]),
  path: z.string().optional(),
  sha256: Sha256Hex.optional(),
  candidateDigest: z.string().optional(),
  environment: z.string().optional(),
  createdAt: IsoTimestamp,
  note: z.string().optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

// ---------------------------------------------------------------------------
// Card run (durable per-card execution record)
// ---------------------------------------------------------------------------

export const CandidateInfo = z.object({
  sha: z.string().min(1),
  dirty: z.boolean(),
  untracked: z.array(z.string()).default([]),
  /** sha256 over sha + status + relevant input manifest; the review/CI dedupe key component. */
  digest: z.string().min(1),
});
export type CandidateInfo = z.infer<typeof CandidateInfo>;

export const PrInfo = z.object({
  number: z.number().int().positive(),
  url: z.string().optional(),
  state: z.enum(['OPEN', 'MERGED', 'CLOSED']),
  headRefOid: z.string().optional(),
  baseRefName: z.string().optional(),
  mergedAt: IsoTimestamp.optional(),
  mergeCommit: z.string().optional(),
});
export type PrInfo = z.infer<typeof PrInfo>;

export const CardRun = z.object({
  goalId: z.string().min(1),
  cardId: CardId,
  cardRevision: z.number().int().nonnegative(),
  goalGeneration: z.number().int().nonnegative(),
  state: CardState,
  /** Fixed no later than the first PREPARE; never reset. */
  startedAt: IsoTimestamp,
  deadline: IsoTimestamp,
  ownerGeneration: z.number().int().nonnegative().optional(),
  worktree: z.string().optional(),
  branch: z.string().optional(),
  base: z.object({ ref: z.string(), oid: z.string().optional() }).optional(),
  mode: z.enum(['local', 'remote']).default('remote'),
  candidate: CandidateInfo.optional(),
  pr: PrInfo.optional(),
  review: ReviewLedger.prefault({}),
  preReview: PreReviewLedger.prefault({}),
  ci: CiLedger.prefault({}),
  effort: EffortEpisode.optional(),
  redReceipt: z.string().optional(),
  dodReceipt: z.string().optional(),
  mergeVerified: z.boolean().default(false),
  closure: z
    .object({
      metadata: z.boolean().default(false),
      docSync: z.boolean().default(false),
      findings: z.boolean().default(false),
      evidence: z.boolean().default(false),
      cleanup: z.boolean().default(false),
    })
    .prefault({}),
  evidence: z.array(EvidenceRef).default([]),
  stop: StopRecord.optional(),
  blocker: z.string().optional(),
  /** A ship-side setback awaiting repair (merge conflict, rejected RED receipt); cleared by the next recorded attempt so a resumed worker still gets the skill and the detail. */
  pendingRepair: z.object({ kind: z.enum(['merge-conflict', 'red-missing']), detail: z.string(), at: IsoTimestamp }).optional(),
  updatedAt: IsoTimestamp,
});
export type CardRun = z.infer<typeof CardRun>;

// ---------------------------------------------------------------------------
// Release attempt (LC4/LC5)
// ---------------------------------------------------------------------------

export const ReleaseAttempt = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  generation: z.number().int().nonnegative(),
  target: DeliveryTarget,
  environment: z.string().optional(),
  database: z.string().optional(),
  state: ReleaseState,
  candidateDigest: z.string().optional(),
  sourceSha: z.string().optional(),
  configDigest: z.string().optional(),
  previousHealthyRelease: z.string().optional(),
  authorizationRef: z.string().optional(),
  ownerGeneration: z.number().int().nonnegative().optional(),
  steps: z
    .array(
      z.object({
        name: z.string(),
        status: z.enum(['pending', 'running', 'succeeded', 'failed', 'UNKNOWN', 'skipped']),
        operationId: z.string().optional(),
      }),
    )
    .default([]),
  operations: z.array(z.string()).default([]),
  healthWindow: z.object({ from: IsoTimestamp, to: IsoTimestamp }).optional(),
  healthResult: z.enum(['PASS', 'BREACH', 'INSUFFICIENT_DATA']).optional(),
  disposition: z.enum(['delivered', 'recovered', 'failed', 'pending']).default('pending'),
  linkedAttempt: z.string().optional(),
  startedAt: IsoTimestamp,
  deadline: IsoTimestamp,
  evidence: z.array(EvidenceRef).default([]),
  stop: StopRecord.optional(),
  updatedAt: IsoTimestamp,
});
export type ReleaseAttempt = z.infer<typeof ReleaseAttempt>;

// ---------------------------------------------------------------------------
// Goal (durable, versioned requirement + runtime record)
// ---------------------------------------------------------------------------

export const RequestSource = z.enum(['natural-language', 'card', 'issue', 'incident', 'bug-evidence']);

export const GoalRequest = z.object({
  text: z.string().min(1),
  source: RequestSource,
  ref: z.string().optional(),
  repository: z.string().optional(),
  explicitSize: RequestSize.optional(),
  explicitTarget: DeliveryTarget.optional(),
  affectedSurfaces: z.array(z.string()).default([]),
});
export type GoalRequest = z.infer<typeof GoalRequest>;

export const GoalRevision = z.object({
  revision: z.number().int().nonnegative(),
  at: IsoTimestamp,
  reason: z.string(),
  request: GoalRequest,
  supersededCards: z.record(z.string(), z.string()).default({}),
  removedCards: z.array(z.string()).default([]),
});
export type GoalRevision = z.infer<typeof GoalRevision>;

export const GoalCounters = z.object({
  planningInvocations: z.number().int().nonnegative().default(0),
  integrationRepairCycles: z.number().int().nonnegative().default(0),
  lifecycleRepairCycles: z.number().int().nonnegative().default(0),
  providerWaitMs: z.number().int().nonnegative().default(0),
  planningMs: z.number().int().nonnegative().default(0),
});
export type GoalCounters = z.infer<typeof GoalCounters>;

export const Goal = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  /** Execution generation; advanced on takeover / fresh continuation. */
  generation: z.number().int().nonnegative(),
  /** Current accepted requirement revision. */
  revision: z.number().int().nonnegative(),
  revisions: z.array(GoalRevision).min(1),
  repository: z.string().min(1),
  routing: RoutingResult,
  target: DeliveryTarget,
  stages: z.record(DeliveryTarget, StageStatus),
  state: GoalState,
  deadlines: Deadlines,
  authorizations: z.array(AuthorizationRecord).default([]),
  cards: z.array(CardId).default([]),
  cardRevisions: z.record(z.string(), z.number().int().nonnegative()).default({}),
  /** Intent file relative to the main checkout, recorded at intake; PLAN lists its open questions. */
  intentRef: z.string().optional(),
  planRef: z.string().optional(),
  projectionRef: z.string().optional(),
  counters: GoalCounters.prefault({}),
  roleProfiles: z.array(RoleProfile).default([]),
  maxWorkers: z.number().int().min(1).max(2).default(2),
  reviewPool: z.string().default('default'),
  evidence: z.array(EvidenceRef).default([]),
  stop: StopRecord.optional(),
  terminal: z.boolean().default(false),
  linkedFrom: z.string().optional(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type Goal = z.infer<typeof Goal>;

// ---------------------------------------------------------------------------
// Journal events (hash-chained, append-only)
// ---------------------------------------------------------------------------

export const JournalEventType = z.enum([
  'GOAL_CREATED',
  'GOAL_ROUTED',
  'GOAL_REVISED',
  'GOAL_STATE',
  'GOAL_STOPPED',
  'GOAL_DONE',
  'GOAL_TAKEOVER',
  'PLAN_INVOKED',
  'PLAN_ACCEPTED',
  'CARDS_PROJECTED',
  'CARD_STATE',
  'CARD_DISPATCHED',
  'CARD_RESULT',
  'CARD_AMENDED',
  'ATTEMPT_STARTED',
  'ATTEMPT_FINISHED',
  'REVIEW_REQUESTED',
  'REVIEW_ADMITTED',
  'REVIEW_DECIDED',
  'REVIEW_HOLD',
  'PRE_REVIEW_DECIDED',
  'CI_CLASSIFIED',
  'CI_RERUN',
  'OPERATION_INTENT',
  'OPERATION_ISSUED',
  'OPERATION_RESULT',
  'OPERATION_RECONCILED',
  'RELEASE_STATE',
  'HEALTH_EVALUATED',
  'AUTHORIZATION_GRANTED',
  'AUTHORIZATION_CHECKED',
  'LEASE_ACQUIRED',
  'LEASE_RENEWED',
  'LEASE_RELEASED',
  'LEASE_FENCED',
  'EVIDENCE_RETAINED',
  'MANIFEST_SEALED',
  'AUDIT_VERIFIED',
  'INCIDENT_DETECTED',
  'INTENT_FILED',
  'MODEL_INVOCATION',
  'HOOK_DECISION',
  'NOTE',
]);
export type JournalEventType = z.infer<typeof JournalEventType>;

export const JournalEvent = z.object({
  seq: z.number().int().nonnegative(),
  ts: IsoTimestamp,
  type: JournalEventType,
  goalId: z.string().optional(),
  cardId: z.string().optional(),
  generation: z.number().int().nonnegative().optional(),
  actor: ActorIdentity,
  data: z.record(z.string(), z.unknown()).default({}),
  prevHash: z.string(),
  hash: Sha256Hex,
});
export type JournalEvent = z.infer<typeof JournalEvent>;

// ---------------------------------------------------------------------------
// Coordination (MS1-MS5)
// ---------------------------------------------------------------------------

export const Lease = z.object({
  resourceKey: z.string().min(1),
  generation: z.number().int().nonnegative(),
  owner: ActorIdentity,
  operation: z.string().optional(),
  acquiredAt: IsoTimestamp,
  heartbeatAt: IsoTimestamp,
  expiresAt: IsoTimestamp,
  released: z.boolean().default(false),
});
export type Lease = z.infer<typeof Lease>;

export const ReviewRequestState = z.enum(['queued', 'running', 'retry-after', 'lost', 'completed', 'cancelled']);
export type ReviewRequestState = z.infer<typeof ReviewRequestState>;

export const ReviewRequest = z.object({
  key: z.string().min(1),
  pool: z.string().min(1),
  repository: z.string().min(1),
  candidateDigest: z.string().min(1),
  base: z.string().min(1),
  policyVersion: z.string().min(1),
  reviewer: z.string().min(1),
  requesters: z.array(z.string()).min(1),
  seq: z.number().int().nonnegative(),
  state: ReviewRequestState,
  enqueuedAt: IsoTimestamp,
  deadline: IsoTimestamp,
  startedAt: IsoTimestamp.optional(),
  retryAfter: IsoTimestamp.optional(),
  finishedAt: IsoTimestamp.optional(),
  slotOwner: ActorIdentity.optional(),
  attempts: z.number().int().nonnegative().default(0),
  verdictRef: z.string().optional(),
  lastError: z.string().optional(),
});
export type ReviewRequest = z.infer<typeof ReviewRequest>;

export const ReviewPool = z.object({
  pool: z.string().min(1),
  maxConcurrent: z.number().int().positive().default(1),
  active: z.array(z.string()).default([]),
  resetAt: IsoTimestamp.optional(),
  notificationOwner: ActorIdentity.optional(),
  nextSeq: z.number().int().nonnegative().default(0),
  usageKnown: z.boolean().default(false),
  updatedAt: IsoTimestamp,
});
export type ReviewPool = z.infer<typeof ReviewPool>;

// ---------------------------------------------------------------------------
// Health (LC7)
// ---------------------------------------------------------------------------

export const HealthSignal = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  baseline: z.number().optional(),
  threshold: z.object({ op: z.enum(['<', '<=', '>', '>=', '==']), value: z.number() }),
  observed: z.number().optional(),
  samples: z.number().int().nonnegative(),
  minSamples: z.number().int().positive(),
  lastSampleAt: IsoTimestamp.optional(),
  maxStalenessMs: z.number().int().positive(),
  synthetic: z.boolean().default(false),
  probeAvailable: z.boolean().default(true),
});
export type HealthSignal = z.infer<typeof HealthSignal>;

export const HealthResult = z.enum(['PASS', 'BREACH', 'INSUFFICIENT_DATA']);
export type HealthResult = z.infer<typeof HealthResult>;

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export function nowIso(): IsoTimestamp {
  return new Date().toISOString();
}

export function addMs(ts: IsoTimestamp, ms: number): IsoTimestamp {
  return new Date(Date.parse(ts) + ms).toISOString();
}

export function minIso(a: IsoTimestamp, b: IsoTimestamp): IsoTimestamp {
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

export const HOUR_MS = 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
export const CARD_LIMIT_MS = 3 * HOUR_MS;
export const ARC_LIMIT_MS = 12 * HOUR_MS;
export const RECONCILE_GRACE_MS = 5 * MINUTE_MS;
export const MAX_WORKERS_DEFAULT = 2;
export const MAX_SUBSTANTIVE_REVIEW_DECISIONS = 2;
export const MAX_NO_VERDICT_RETRIES = 1;
export const MAX_CI_TRANSIENT_RERUNS = 1;
export const MAX_INTEGRATION_REPAIR_CYCLES = 1;
export const MAX_LIFECYCLE_REPAIR_CYCLES = 1;
export const MAX_PLANNING_INVOCATIONS = 2;
