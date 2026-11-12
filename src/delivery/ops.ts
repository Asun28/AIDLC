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
import { IsoTimestamp, type HealthSignal } from '../core/types.ts';

export const OperationRole = z.enum(['build', 'package', 'deploy', 'status', 'environment', 'health', 'recover', 'migration-status', 'migration-apply', 'backup-verify', 'restore']);
export type OperationRole = z.infer<typeof OperationRole>;

/**
 * A pattern of a binding: not blank, and a regular expression under the `m` flag it is matched with. One that does not
 * compile is refused when the file loads, so the command whose output it reads is never run first.
 */
const pattern = z
  .string()
  .regex(/\S/, 'must not be blank')
  .refine((source) => {
    try {
      new RegExp(source, 'm');
      return true;
    } catch {
      return false;
    }
  }, 'must be a regular expression');

/**
 * The `cwd` of a binding: not blank, not drive-relative (a drive letter and a colon not followed by a slash or a backslash) and
 * without a NUL character, which no file system accepts and with which a spawn throws instead of failing.
 * `aidlc.ops.json` is committed and read on every platform, so a value that is a relative name on POSIX and a path read against
 * the current directory of a drive on Windows is refused on both.
 */
const cwdField = z
  .string()
  .regex(/\S/, 'must not be blank')
  .regex(/^(?![A-Za-z]:(?![\\/]))/, 'must not be drive-relative (a drive letter and a colon need a slash or a backslash after them)')
  .refine((cwd) => !cwd.includes('\u0000'), 'must not contain a NUL character');

export const OperationBinding = z.object({
  role: OperationRole,
  /** argv array, never a shell string. */
  command: z.array(z.string()).min(1),
  /** The directory the command and its status lookup run in, resolved against the main checkout; see `operationCwd`. */
  cwd: cwdField.optional(),
  /** How the target environment reaches the command: an argument (`targetArg`), the `AIDLC_TARGET_ENV` variable, or not at all. */
  targetSelection: z.enum(['arg', 'env', 'none']).default('none'),
  targetArg: z.string().optional(),
  credentialScope: z.string().optional(),
  effects: z.array(z.string()).default([]),
  externallyVisible: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(30 * 60 * 1000),
  /** Status lookup command (argv) to reconcile an issued operation; `{id}` placeholder. */
  statusLookup: z.array(z.string()).optional(),
  idempotencyKeyArg: z.string().optional(),
  /** Regex capturing the provider operation id from stdout. */
  operationIdPattern: pattern.optional(),
  /** Interpretation: exit 0 alone is not completion for async operations. */
  async: z.boolean().default(false),
  successPattern: pattern.optional(),
  failurePattern: pattern.optional(),
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

/**
 * The directory an operation command and its status lookup run in: `root`, the main checkout, or the `cwd` of the binding
 * resolved against it with the host's `path.resolve`, the value as written.
 */
export function operationCwd(binding: OperationBinding, root: string): string {
  return binding.cwd === undefined ? root : path.resolve(root, binding.cwd);
}

export function executeOperation(binding: OperationBinding, target: string | undefined, options: { root: string; runner?: SyncRunner; idempotencyKey?: string }): OperationExecution {
  const runner = options.runner ?? runSync;
  const [cmd, ...rest] = binding.command;
  const args = [...rest];
  if (binding.targetSelection === 'arg' && target) args.push(...(binding.targetArg ? [binding.targetArg, target] : [target]));
  if (binding.idempotencyKeyArg && options.idempotencyKey) args.push(binding.idempotencyKeyArg, options.idempotencyKey);
  const env = { ...process.env };
  if (binding.targetSelection === 'env' && target) env['AIDLC_TARGET_ENV'] = target;
  const receipt = runner(cmd!, args, { cwd: operationCwd(binding, options.root), timeoutMs: binding.timeoutMs, env, killTree: true });
  const text = `${receipt.stdout}\n${receipt.stderr}`;
  const id = binding.operationIdPattern ? text.match(new RegExp(binding.operationIdPattern, 'm'))?.[1] : undefined;
  if (receipt.timedOut) return { receipt, providerOperationId: id, status: 'UNKNOWN', detail: 'operation timed out; outcome unknown until reconciled' };
  if (binding.failurePattern && new RegExp(binding.failurePattern, 'm').test(text)) return { receipt, providerOperationId: id, status: 'failed', detail: 'failure pattern matched' };
  if (receipt.exitCode !== 0) return { receipt, providerOperationId: id, status: binding.async ? 'UNKNOWN' : 'failed', detail: `exit ${receipt.exitCode}` };
  if (binding.async) return { receipt, providerOperationId: id, status: 'issued', detail: 'asynchronous operation issued; exit zero is not completion' };
  if (binding.successPattern && !new RegExp(binding.successPattern, 'm').test(text)) return { receipt, providerOperationId: id, status: 'UNKNOWN', detail: 'exit zero but success pattern not observed' };
  return { receipt, providerOperationId: id, status: 'succeeded', detail: 'exit zero and success criteria observed' };
}

/**
 * The report a `health` operation prints as the last non-blank line of its stdout (card T0-HEALTH-OP-SIGNALS): the environment
 * and candidate it measured and one entry per signal. Unknown keys are dropped; any malformed entry fails the whole report.
 */
export const HealthReport = z.object({
  environment: z.string().min(1),
  candidate: z.string().min(1),
  signals: z.array(
    z.object({
      name: z.string(),
      samples: z.number().int().nonnegative(),
      observed: z.number().optional(),
      lastSampleAt: IsoTimestamp.refine((at) => !Number.isNaN(Date.parse(at)), 'must name a real time').optional(),
    }),
  ),
});
export type HealthReport = z.infer<typeof HealthReport>;

/**
 * The report on the last line of `stdout` (split at `\n`) whose `trim()` is not empty, trimmed, found by scanning backward from
 * the end without splitting the whole output; `undefined` when there is no such line or it is not JSON or not a `HealthReport`.
 */
export function healthReportOf(stdout: string): HealthReport | undefined {
  let end = stdout.length;
  let line = '';
  for (;;) {
    const newline = end === 0 ? -1 : stdout.lastIndexOf('\n', end - 1);
    line = stdout.slice(newline + 1, end).trim();
    if (line !== '') break;
    if (newline < 0) return undefined;
    end = newline;
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = HealthReport.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * One signal per declared entry, in declaration order, with the declaration's name, source, threshold, minimum samples and
 * staleness. The observation comes from the one report entry whose `name` is the declared name exactly; with no report, no
 * such entry or two of them, the signal is unavailable (samples 0, no observation).
 */
export function healthSignals(declared: DeliveryOpsConfig['health'], report: HealthReport | undefined): HealthSignal[] {
  return declared.map((d) => {
    const base = { name: d.name, source: d.source, threshold: d.threshold, minSamples: d.minSamples, maxStalenessMs: d.maxStalenessMs, synthetic: false };
    const hits = report ? report.signals.filter((s) => s.name === d.name) : [];
    const hit = hits.length === 1 ? hits[0]! : undefined;
    if (!hit) return { ...base, samples: 0, probeAvailable: false };
    return { ...base, samples: hit.samples, ...(hit.observed === undefined ? {} : { observed: hit.observed }), ...(hit.lastSampleAt === undefined ? {} : { lastSampleAt: hit.lastSampleAt }), probeAvailable: true };
  });
}

export function lookupOperation(binding: OperationBinding, providerOperationId: string, root: string, runner: SyncRunner = runSync): { status: 'succeeded' | 'failed' | 'running' | 'UNKNOWN'; receipt?: ExecReceipt; detail: string } {
  if (!binding.statusLookup) return { status: 'UNKNOWN', detail: 'no status lookup bound for this operation role' };
  const [cmd, ...rest] = binding.statusLookup.map((a) => a.replace('{id}', providerOperationId));
  const receipt = runner(cmd!, rest, { cwd: operationCwd(binding, root), timeoutMs: 5 * 60 * 1000, killTree: true });
  if (receipt.exitCode !== 0 || receipt.timedOut) return { status: 'UNKNOWN', receipt, detail: 'status lookup failed' };
  const text = receipt.stdout;
  if (binding.failurePattern && new RegExp(binding.failurePattern, 'm').test(text)) return { status: 'failed', receipt, detail: 'failure pattern in status' };
  if (binding.successPattern && new RegExp(binding.successPattern, 'm').test(text)) return { status: 'succeeded', receipt, detail: 'success pattern in status' };
  if (/running|in[_ -]?progress|pending|queued/i.test(text)) return { status: 'running', receipt, detail: 'provider reports in progress' };
  return { status: 'UNKNOWN', receipt, detail: 'status output did not match success/failure/running' };
}
