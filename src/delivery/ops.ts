/**
 * Provider operation bindings (plan v5 LC3 "Bind to real project tools").
 *
 * Operation ROLES, not invented CLI flags: build/package, deployment submission, deployment
 * status, environment identity, smoke/health observation, recovery, migration status/apply,
 * backup/restore verification. Each binding records the real invocation, target selection,
 * credential scope, effects, timeout, status lookup, result interpretation and evidence
 * location. A missing operation required for an enabled target is STOP/release-config; an
 * inactive optional target does not require it. "I could not read the setting" is a failure,
 * never "the setting is off".
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runSync, type ExecReceipt, type SyncRunner } from '../probes/exec.ts';

export const OperationRole = z.enum(['build', 'package', 'deploy', 'status', 'environment', 'health', 'recover', 'migration-status', 'migration-apply', 'backup-verify', 'restore']);
export type OperationRole = z.infer<typeof OperationRole>;

export const OperationBinding = z.object({
  role: OperationRole,
  /** argv array, never a shell string. */
  command: z.array(z.string()).min(1),
  cwd: z.string().optional(),
  /** How the target environment is selected (arg template, env var, config file). */
  targetSelection: z.enum(['arg', 'env', 'config', 'none']).default('none'),
  targetArg: z.string().optional(),
  credentialScope: z.string().optional(),
  effects: z.array(z.string()).default([]),
  externallyVisible: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(30 * 60 * 1000),
  /** Status lookup command (argv) to reconcile an issued operation; `{id}` placeholder. */
  statusLookup: z.array(z.string()).optional(),
  idempotencyKeyArg: z.string().optional(),
  /** Regex capturing the provider operation id from stdout. */
  operationIdPattern: z.string().optional(),
  /** Interpretation: exit 0 alone is not completion for async operations. */
  async: z.boolean().default(false),
  successPattern: z.string().optional(),
  failurePattern: z.string().optional(),
  evidenceDir: z.string().optional(),
  /** Whether this operation triggers external publication (tag/release CD). */
  triggersPublication: z.boolean().default(false),
});
export type OperationBinding = z.infer<typeof OperationBinding>;

export const DeliveryOpsConfig = z.object({
  schemaVersion: z.literal(1),
  environments: z.record(z.string(), z.object({ description: z.string().optional(), database: z.string().optional(), production: z.boolean().default(false) })).default({}),
  operations: z.array(OperationBinding).default([]),
  health: z
    .array(
      z.object({
        name: z.string(),
        source: z.string(),
        threshold: z.object({ op: z.enum(['<', '<=', '>', '>=', '==']), value: z.number() }),
        minSamples: z.number().int().positive().default(1),
        maxStalenessMs: z.number().int().positive().default(5 * 60 * 1000),
        windowMs: z.number().int().positive().default(10 * 60 * 1000),
        maxWaitMs: z.number().int().positive().default(30 * 60 * 1000),
        owner: z.string().optional(),
      }),
    )
    .default([]),
});
export type DeliveryOpsConfig = z.infer<typeof DeliveryOpsConfig>;

export type OpsLoad = { status: 'configured'; config: DeliveryOpsConfig; file: string } | { status: 'not-configured'; file: string } | { status: 'unreadable'; file: string; error: string };

export const OPS_CONFIG_FILE = 'aidlc.ops.json';

export function loadDeliveryOps(repoRoot: string, file: string = path.join(repoRoot, OPS_CONFIG_FILE)): OpsLoad {
  if (!existsSync(file)) return { status: 'not-configured', file };
  try {
    const parsed = DeliveryOpsConfig.parse(JSON.parse(readFileSync(file, 'utf8')));
    return { status: 'configured', config: parsed, file };
  } catch (err) {
    return { status: 'unreadable', file, error: (err as Error).message };
  }
}

export const REQUIRED_ROLES: Record<'package' | 'staging' | 'production' | 'migration', OperationRole[]> = {
  package: ['build', 'package'],
  staging: ['deploy', 'status', 'environment', 'health'],
  production: ['deploy', 'status', 'environment', 'health', 'recover'],
  migration: ['migration-status', 'migration-apply', 'backup-verify'],
};

export interface RoleResolution {
  role: OperationRole;
  status: 'configured' | 'NOT CONFIGURED';
  binding?: OperationBinding;
}

/** Resolve required roles for an enabled target; report each as configured or NOT CONFIGURED. */
export function resolveRoles(load: OpsLoad, target: keyof typeof REQUIRED_ROLES): { ok: boolean; roles: RoleResolution[]; problem?: string } {
  if (load.status === 'unreadable') return { ok: false, roles: [], problem: `ops config unreadable: ${load.error} (${load.file})` };
  const roles = REQUIRED_ROLES[target].map((role): RoleResolution => {
    const binding = load.status === 'configured' ? load.config.operations.find((o) => o.role === role) : undefined;
    return binding ? { role, status: 'configured', binding } : { role, status: 'NOT CONFIGURED' };
  });
  return { ok: roles.every((r) => r.status === 'configured'), roles };
}

export interface OperationExecution {
  receipt: ExecReceipt;
  providerOperationId?: string;
  /** 'succeeded' only when a sync op exits 0 and no failure pattern matched; async ops are 'issued'. */
  status: 'succeeded' | 'failed' | 'issued' | 'UNKNOWN';
  detail: string;
}

export function executeOperation(binding: OperationBinding, target: string | undefined, options: { runner?: SyncRunner; idempotencyKey?: string; cwd?: string } = {}): OperationExecution {
  const runner = options.runner ?? runSync;
  const [cmd, ...rest] = binding.command;
  const args = [...rest];
  if (binding.targetSelection === 'arg' && target) args.push(...(binding.targetArg ? [binding.targetArg, target] : [target]));
  if (binding.idempotencyKeyArg && options.idempotencyKey) args.push(binding.idempotencyKeyArg, options.idempotencyKey);
  const env = { ...process.env };
  if (binding.targetSelection === 'env' && target) env['AIDLC_TARGET_ENV'] = target;
  const receipt = runner(cmd!, args, { cwd: options.cwd ?? binding.cwd, timeoutMs: binding.timeoutMs, env });
  const text = `${receipt.stdout}\n${receipt.stderr}`;
  const id = binding.operationIdPattern ? text.match(new RegExp(binding.operationIdPattern, 'm'))?.[1] : undefined;
  if (receipt.timedOut) return { receipt, providerOperationId: id, status: 'UNKNOWN', detail: 'operation timed out; outcome unknown until reconciled' };
  if (binding.failurePattern && new RegExp(binding.failurePattern, 'm').test(text)) return { receipt, providerOperationId: id, status: 'failed', detail: 'failure pattern matched' };
  if (receipt.exitCode !== 0) return { receipt, providerOperationId: id, status: binding.async ? 'UNKNOWN' : 'failed', detail: `exit ${receipt.exitCode}` };
  if (binding.async) return { receipt, providerOperationId: id, status: 'issued', detail: 'asynchronous operation issued; exit zero is not completion' };
  if (binding.successPattern && !new RegExp(binding.successPattern, 'm').test(text)) return { receipt, providerOperationId: id, status: 'UNKNOWN', detail: 'exit zero but success pattern not observed' };
  return { receipt, providerOperationId: id, status: 'succeeded', detail: 'exit zero and success criteria observed' };
}

export function lookupOperation(binding: OperationBinding, providerOperationId: string, runner: SyncRunner = runSync): { status: 'succeeded' | 'failed' | 'running' | 'UNKNOWN'; receipt?: ExecReceipt; detail: string } {
  if (!binding.statusLookup) return { status: 'UNKNOWN', detail: 'no status lookup bound for this operation role' };
  const [cmd, ...rest] = binding.statusLookup.map((a) => a.replace('{id}', providerOperationId));
  const receipt = runner(cmd!, rest, { cwd: binding.cwd, timeoutMs: 5 * 60 * 1000 });
  if (receipt.exitCode !== 0 || receipt.timedOut) return { status: 'UNKNOWN', receipt, detail: 'status lookup failed' };
  const text = receipt.stdout;
  if (binding.failurePattern && new RegExp(binding.failurePattern, 'm').test(text)) return { status: 'failed', receipt, detail: 'failure pattern in status' };
  if (binding.successPattern && new RegExp(binding.successPattern, 'm').test(text)) return { status: 'succeeded', receipt, detail: 'success pattern in status' };
  if (/running|in[_ -]?progress|pending|queued/i.test(text)) return { status: 'running', receipt, detail: 'provider reports in progress' };
  return { status: 'UNKNOWN', receipt, detail: 'status output did not match success/failure/running' };
}
