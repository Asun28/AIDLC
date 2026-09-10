/**
 * Data impact, migration phase graph and recovery classification (plan v5 LC2, LC8, LC9).
 *
 * Data impact is detected from behaviour and contracts (ORM definitions, embedded SQL,
 * storage changes, backfills); migration directories are only hints. The common online
 * sequence expand -> compatible deploy -> backfill -> verify -> contract is a pattern, not a
 * command order; contraction waits for consumer compatibility evidence. Irreversible changes
 * need an explicit forward-repair or backup-restore strategy, never a demanded down migration.
 */

export interface DataImpactSignal {
  path?: string;
  kind: 'migration-dir' | 'orm-model' | 'embedded-sql' | 'schema-file' | 'backfill-script' | 'storage-contract' | 'query-change';
  detail: string;
  /** Directory hints are weak; contract/ORM/SQL evidence is strong. */
  strength: 'hint' | 'strong';
}

const RULES: Array<{ kind: DataImpactSignal['kind']; strength: DataImpactSignal['strength']; path?: RegExp; content?: RegExp; detail: string }> = [
  { kind: 'migration-dir', strength: 'hint', path: /(^|\/)(migrations?|db\/migrate|alembic\/versions|flyway|liquibase|prisma\/migrations|sqldelight\/migrations)\//i, detail: 'migration directory touched' },
  { kind: 'schema-file', strength: 'strong', path: /\.(sql|sq|prisma|dbml)$|schema\.(rb|py|ts|graphql|json)$|\.sq$/i, detail: 'schema definition file changed' },
  { kind: 'orm-model', strength: 'strong', content: /class \w+\(.*(?:Base|Model|db\.Model)\)|@Entity\b|@Table\b|@Column\b|\bmodels\.Model\b|\bSchema\s*\(|\bdefineModel\b|\bcreateTable\b|\balterTable\b|\bdropTable\b|\baddColumn\b|\bdropColumn\b|\brenameColumn\b/, detail: 'ORM/entity definition changed' },
  { kind: 'embedded-sql', strength: 'strong', content: /\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|COLUMN|VIEW|TYPE|SCHEMA)\b|\bALTER TABLE\b/i, detail: 'embedded DDL' },
  { kind: 'backfill-script', strength: 'strong', path: /backfill|data[-_]fix|migrate[-_]data/i, detail: 'backfill / data script' },
  { kind: 'backfill-script', strength: 'strong', content: /\bbackfill\b|UPDATE\s+\w+\s+SET\b[\s\S]{0,200}WHERE\b[^;]*\bIS NULL\b/i, detail: 'bulk data update' },
  { kind: 'storage-contract', strength: 'strong', content: /\b(serialVersionUID|schemaVersion|storage_version|STORAGE_VERSION|@Serializable\b.*version|protobuf|\.proto\b|avro)\b/, detail: 'stored-format contract' },
  { kind: 'query-change', strength: 'hint', content: /\b(SELECT\s+.+\s+FROM|INSERT\s+INTO|DELETE\s+FROM)\b/i, detail: 'query text changed' },
];

export function detectDataImpact(changes: Array<{ path: string; content?: string }>): { impacted: boolean; strong: boolean; signals: DataImpactSignal[] } {
  const signals: DataImpactSignal[] = [];
  for (const change of changes) {
    const p = change.path.replace(/\\/g, '/');
    for (const rule of RULES) {
      if (rule.path && rule.path.test(p)) signals.push({ path: p, kind: rule.kind, detail: rule.detail, strength: rule.strength });
      else if (rule.content && change.content && rule.content.test(change.content)) signals.push({ path: p, kind: rule.kind, detail: rule.detail, strength: rule.strength });
    }
  }
  const strong = signals.some((s) => s.strength === 'strong');
  return { impacted: signals.length > 0, strong, signals };
}

export type MigrationPhase = 'expand' | 'deploy' | 'backfill' | 'verify' | 'contract';

export interface MigrationStep {
  id: string;
  phase: MigrationPhase;
  description: string;
  reversible: boolean;
  dependsOn: string[];
  /** Contract steps require this evidence before they may run. */
  prerequisites: string[];
  environment?: string;
  database?: string;
}

export interface MigrationPlanInput {
  database: string;
  expand?: string[];
  backfill?: string[];
  contract?: string[];
  compatibleDeploy?: string;
  verify?: string[];
  /** Steps that are irreversible (by id or description substring). */
  irreversible?: string[];
}

/** Build the phase graph; contraction is never first and always waits for verify evidence. */
export function buildMigrationPlan(input: MigrationPlanInput): MigrationStep[] {
  const steps: MigrationStep[] = [];
  const irreversible = new Set((input.irreversible ?? []).map((s) => s.toLowerCase()));
  const isIrreversible = (id: string, desc: string) => irreversible.has(id.toLowerCase()) || [...irreversible].some((k) => desc.toLowerCase().includes(k));
  let prev: string[] = [];
  const add = (phase: MigrationPhase, descs: string[], prerequisites: string[] = []) => {
    const ids: string[] = [];
    descs.forEach((desc, i) => {
      const id = `${phase}-${i + 1}`;
      steps.push({ id, phase, description: desc, reversible: !isIrreversible(id, desc), dependsOn: [...prev], prerequisites, database: input.database });
      ids.push(id);
    });
    if (ids.length) prev = ids;
  };
  add('expand', input.expand ?? []);
  if (input.compatibleDeploy) add('deploy', [input.compatibleDeploy]);
  add('backfill', input.backfill ?? []);
  add('verify', input.verify ?? ['verify consumers and data invariants']);
  add('contract', input.contract ?? [], ['consumer-compatibility-verified', 'data-invariants-verified', 'explicit-contract-authorization']);
  return steps;
}

export interface MigrationOrderingCheck {
  ok: boolean;
  problems: string[];
}

/** Validate that the accepted order respects phase dependencies (Q20). */
export function checkMigrationOrdering(steps: MigrationStep[], executionOrder: string[]): MigrationOrderingCheck {
  const problems: string[] = [];
  const position = new Map(executionOrder.map((id, i) => [id, i]));
  for (const step of steps) {
    const pos = position.get(step.id);
    if (pos === undefined) continue;
    for (const dep of step.dependsOn) {
      const dpos = position.get(dep);
      if (dpos !== undefined && dpos > pos) problems.push(`${step.id} scheduled before its dependency ${dep}`);
    }
    if (step.phase === 'contract') {
      const earlier = executionOrder.slice(0, pos);
      const hasVerify = steps.some((s) => s.phase === 'verify' && earlier.includes(s.id));
      if (!hasVerify) problems.push(`contract step ${step.id} runs before any verify step`);
    }
  }
  const firstContract = executionOrder.findIndex((id) => steps.find((s) => s.id === id)?.phase === 'contract');
  if (firstContract === 0) problems.push('a destructive contraction cannot be the first step');
  return { ok: problems.length === 0, problems };
}

export type RecoveryStrategy = 'apply-reverse' | 'forward-repair' | 'backup-restore' | 'blocked';

export interface RecoveryAssessment {
  strategy: RecoveryStrategy;
  requiresAuthorization: boolean;
  detail: string;
}

/** LC9: recovery matches the data risk; irreversible steps need an explicit alternative. */
export function assessRecovery(step: MigrationStep, options: { forwardRepairAvailable?: boolean; backupVerified?: boolean }): RecoveryAssessment {
  if (step.reversible) return { strategy: 'apply-reverse', requiresAuthorization: false, detail: 'exercise apply/reverse and data invariants on representative scratch/staging data' };
  if (options.forwardRepairAvailable) return { strategy: 'forward-repair', requiresAuthorization: true, detail: 'irreversible; compatible forward repair identified and must be authorized' };
  if (options.backupVerified) return { strategy: 'backup-restore', requiresAuthorization: true, detail: 'irreversible; verified production recovery point exists (identifier, freshness, access, retention)' };
  return { strategy: 'blocked', requiresAuthorization: true, detail: 'irreversible with no verified forward repair or recovery point; this migration is blocked (not unrelated development)' };
}

/** A binary rollback onto an incompatible newer schema is refused (Q21). */
export function binaryRollbackCompatible(schemaVersionDeployed: number, schemaVersionOfPreviousBinary: number, contractApplied: boolean): { ok: boolean; detail: string } {
  if (contractApplied && schemaVersionDeployed > schemaVersionOfPreviousBinary) {
    return { ok: false, detail: 'contract phase applied: previous binary is incompatible with the current schema; application rollback is blocked without a database recovery step' };
  }
  return { ok: true, detail: 'previous binary is compatible with the current (expanded) schema' };
}
