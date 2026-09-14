/**
 * aidlc CLI. Every command that reads or writes goal state prints ONE JSON document with
 * `--json` (default when stdout is not a TTY) so an agent can consume it as the only next move.
 */
import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { loadProjectConfig, resolveWorktreeRoot, type ProjectConfig } from '../config.ts';
import { resolveRepoIdentity, resolveStatePaths, type RepoIdentity, type StatePaths } from '../state/paths.ts';
import { GoalStore } from '../state/goal-store.ts';
import { Journal, currentActor, resolveSessionId } from '../state/journal.ts';
import { GoalController } from '../loop/controller.ts';
import { CardRunner } from '../loop/card-runner.ts';
import { ReleaseRunner } from '../loop/release-runner.ts';
import { ReportInput } from '../loop/directive.ts';
import { loadCardRegistry, validateRegistry, renderCard, type ParsedCard } from '../artifacts/card.ts';
import { parseIntent, renderIntent, slugify } from '../artifacts/intent.ts';
import { parseSpec } from '../artifacts/spec.ts';
import { evaluatePlanReadiness, parsePlanCards } from '../artifacts/plan.ts';
import { formatRouting } from '../core/router.ts';
import { formatStop } from '../core/stop.ts';
import { classifyCiFailure } from '../core/ci-policy.ts';
import { detectDataImpact, buildMigrationPlan, checkMigrationOrdering, assessRecovery } from '../core/migrate.ts';
import { ReviewQueue } from '../coordination/review-queue.ts';
import { OperationLedger } from '../coordination/reconcile.ts';
import { LeaseStore, resourceKeys } from '../coordination/lease.ts';
import { loadDeliveryOps, lookupOperation, resolveRoles } from '../delivery/ops.ts';
import { loadEvals, runSuite } from '../evals/runner.ts';
import { MockProvider } from '../providers/mock.ts';
import { ClaudeApiProvider } from '../providers/claude-api.ts';
import { ClaudeCodeProvider } from '../providers/claude-code.ts';
import type { ModelProvider } from '../providers/types.ts';
import { EvidenceStore, Manifest } from '../audit/manifest.ts';
import { verifyAudit } from '../audit/verifier.ts';
import { evaluateBands, parseBandsYaml, type Sample } from '../maintain/bands.ts';
import { IncidentLedger, intentFromBreach, writeIncidentIntent } from '../maintain/incident.ts';
import { readStdinJson, runHook, type HookName } from '../hooks/index.ts';
import { dispatchHook, readStdin } from '../hooks/entry.ts';
import { initProject } from '../scaffold/init.ts';
import { Goal, type DeliveryTarget, type RequestSize } from '../core/types.ts';
import { renderBoard } from '../state/board.ts';

interface Ctx {
  root: string;
  repo: RepoIdentity;
  config: ProjectConfig;
  configFound: boolean;
  paths: StatePaths;
  store: GoalStore;
  controller: GoalController;
  json: boolean;
}

function ctx(opts: { json?: boolean; cwd?: string }): Ctx {
  const cwd = opts.cwd ?? process.cwd();
  const repo = resolveRepoIdentity(cwd);
  const { config, found } = loadProjectConfig(repo.mainRoot);
  // State directories are created lazily by the first write; read-only commands leave the repo untouched.
  const paths = resolveStatePaths(cwd);
  const store = new GoalStore(paths);
  const controller = new GoalController({ paths, repo, config, store, boardMirror: path.join(repo.mainRoot, '_local', 'aidlc-board.md') });
  const json = opts.json ?? !process.stdout.isTTY;
  return { root: repo.mainRoot, repo, config, configFound: found, paths, store, controller, json };
}

function out(c: { json: boolean }, data: unknown, human?: () => string): void {
  if (c.json || !human) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  else process.stdout.write(human() + '\n');
}

function fail(message: string, code = 1): never {
  process.stderr.write(`aidlc: ${message}\n`);
  process.exit(code);
}

function latestActiveGoalId(c: Ctx, explicit?: string): string {
  if (explicit) return explicit;
  const goals = c.store.listGoals();
  const active = goals.find((g) => !g.terminal) ?? goals[0];
  if (!active) fail('no goals; create one with `aidlc goal new "<request>"`');
  return active.id;
}

function parseData(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    return fail(`--data must be JSON: ${(err as Error).message}`);
  }
}

function cardOf(c: Ctx, cardId: string): ParsedCard {
  const registry = loadCardRegistry(path.join(c.root, c.config.cardsDir), path.join(c.root, c.config.archiveDir));
  const hit = registry.cards.find((p) => p.card.id === cardId);
  if (!hit) fail(`card ${cardId} not found in ${c.config.cardsDir}`);
  return hit;
}

function providerFor(name: string | undefined, config: ProjectConfig): ModelProvider {
  const p = name ?? config.provider;
  if (p === 'mock') return new MockProvider();
  if (p === 'claude-code') return new ClaudeCodeProvider();
  return new ClaudeApiProvider();
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = new Command();
  program.name('aidlc').description('AI-native SDLC orchestrator: intent -> spec -> plan -> cards -> verified delivery').version('0.1.0');
  program.option('--json', 'print JSON (default when stdout is not a TTY)');
  program.option('-C, --cwd <dir>', 'run as if started in <dir>');
  const g = () => program.opts<{ json?: boolean; cwd?: string }>();

  // ------------------------------------------------------------------ init / doctor
  program
    .command('init [dir]')
    .description('lay the AI-native SDLC files over a repository (never overwrites without --force)')
    .option('--force', 'overwrite existing files')
    .option('--cards-dir <dir>', 'card registry directory', 'specs/tasks')
    .option('--ship-path <name>', 'scaffold | github | dry-run')
    .option('--dry-run', 'print what would be written')
    .action((dir: string | undefined, o: { force?: boolean; cardsDir: string; shipPath?: 'scaffold' | 'github' | 'dry-run'; dryRun?: boolean }) => {
      const report = initProject({ target: dir ?? g().cwd ?? process.cwd(), force: o.force, cardsDir: o.cardsDir, shipPath: o.shipPath, dryRun: o.dryRun });
      out({ json: Boolean(g().json) }, report, () => [`created: ${report.created.length}`, ...report.created.map((f) => `  + ${f}`), `merged: ${report.merged.join(', ') || '-'}`, `skipped (exists): ${report.skipped.length}`, ...report.skipped.map((f) => `  = ${f}`), `next: review aidlc.config.json, then \`aidlc doctor\``].join('\n'));
    });

  program
    .command('doctor')
    .description('check toolchain, configuration, state directory and providers')
    .action(async () => {
      const c = ctx(g());
      // Toolchain probes run concurrently: doctor is the entry check of every route and wakeup.
      const probe = (cmd: string, args: string[]) =>
        new Promise<string | undefined>((resolve) => {
          let out = '';
          const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
          child.stdout.on('data', (d: Buffer) => (out += d.toString()));
          child.stderr.on('data', (d: Buffer) => (out += d.toString()));
          child.on('error', () => resolve(undefined));
          child.on('close', (code) => resolve(code === 0 ? out.trim().split(/\r?\n/)[0] : undefined));
        });
      const registry = loadCardRegistry(path.join(c.root, c.config.cardsDir), path.join(c.root, c.config.archiveDir));
      const validation = validateRegistry(registry, c.config.tierPaths);
      const blocking = [...validation.values()].flat().filter((f) => f.severity === 'block').length;
      const ops = loadDeliveryOps(c.root);
      const provider = providerFor(undefined, c.config);
      const [gitVersion, ghVersion, pwshVersion, avail] = await Promise.all([probe('git', ['--version']), probe('gh', ['--version']), probe('pwsh', ['-v']), provider.available()]);
      const checks = {
        node: process.version,
        git: gitVersion ?? 'MISSING',
        gh: ghVersion ?? 'MISSING (needed for remote ship)',
        pwsh: pwshVersion ?? 'MISSING (needed for scaffold ship path)',
        repository: c.repo.isGit ? c.repo.mainRoot : `${c.root} (not a git repository)`,
        config: c.configFound ? 'aidlc.config.json' : 'defaults (run aidlc init)',
        shipPath: c.config.shipPath,
        stateDir: c.paths.root,
        cards: `${registry.cards.length} cards, ${registry.errors.length} unparseable, ${blocking} blocking findings`,
        deliveryOps: ops.status === 'configured' ? `configured (${ops.config.operations.length} operations)` : ops.status === 'unreadable' ? `UNREADABLE: ${ops.error}` : 'NOT CONFIGURED (development-only is fine)',
        provider: `${provider.name}: ${avail.ok ? 'ok' : avail.detail}`,
        session: existsSync(c.paths.root) || process.env['AIDLC_SESSION'] || process.env['CLAUDE_SESSION_ID']
          ? `${currentActor().session} (${resolveSessionId().source === 'default' ? 'DEFAULT: every window shares this identity; set AIDLC_SESSION per window for multi-session coordination' : resolveSessionId().source})`
          : '(no state dir yet; created on first goal; set AIDLC_SESSION per window for multi-session coordination)',
      };
      out(c, checks, () => Object.entries(checks).map(([k, v]) => `${k.padEnd(12)} ${v}`).join('\n'));
    });

  // ------------------------------------------------------------------ goals
  const goal = program.command('goal').description('goal intake and lifecycle');
  goal
    .command('new <text...>')
    .description('create a goal from a request (natural language, card id, issue ref, bug evidence)')
    .option('--size <size>', 'explicit request size T0-bugfix|T0|T1|T2')
    .option('--target <target>', 'development|package|staging|production|migration|operations')
    .option('--card <id>', 'existing card id to execute or amend')
    .option('--issue <n>', 'issue number (repository must be resolved)')
    .option('--bug-evidence', 'a stack trace / failing test accompanies the request')
    .option('--limit-hours <h>', 'tighter admission limit in hours')
    .option('--surface <paths>', 'comma-separated affected surfaces')
    .option('--intent <file>', 'intent file (relative to the main checkout) whose open questions PLAN lists for T1/T2')
    .action((text: string[], o: { size?: RequestSize; target?: DeliveryTarget; card?: string; issue?: string; bugEvidence?: boolean; limitHours?: string; surface?: string; intent?: string }) => {
      const c = ctx(g());
      const request = { text: text.join(' '), source: o.bugEvidence ? ('bug-evidence' as const) : o.card ? ('card' as const) : o.issue ? ('issue' as const) : ('natural-language' as const), ref: o.card ?? (o.issue ? `#${o.issue}` : undefined), explicitSize: o.size, explicitTarget: o.target, affectedSurfaces: o.surface ? o.surface.split(',').map((s) => s.trim()) : [] };
      const created = c.controller.createGoal(request, { hasBugEvidence: o.bugEvidence, userLimitMs: o.limitHours ? Number(o.limitHours) * 3600 * 1000 : undefined, cards: o.card ? [o.card] : undefined, knownIssueNumbers: o.issue ? [Number(o.issue)] : undefined, intentRef: o.intent });
      const directive = c.controller.next(created.id);
      out(c, { goal: created.id, routing: created.routing, deadline: created.deadlines.goalDeadline, directive }, () => `${formatRouting(created.routing)}\ngoal ${created.id} deadline ${created.deadlines.goalDeadline}\nnext: ${directive.kind} — ${directive.narration}`);
    });
  goal
    .command('status [id]')
    .description('show a goal record')
    .action((id: string | undefined) => {
      const c = ctx(g());
      const goalRec = c.controller.mustGoal(latestActiveGoalId(c, id));
      out(c, goalRec, () => `${goalRec.id} state=${goalRec.state} gen=${goalRec.generation} rev=${goalRec.revision} target=${goalRec.target} cards=${goalRec.cards.join(',') || '-'}${goalRec.stop ? `\n${formatStop(goalRec.stop)}` : ''}`);
    });
  goal
    .command('list')
    .description('list goals')
    .action(() => {
      const c = ctx(g());
      const goals = c.store.listGoals();
      out(c, goals.map((x) => ({ id: x.id, state: x.state, target: x.target, size: x.routing.size, cards: x.cards, terminal: x.terminal, createdAt: x.createdAt })), () => goals.map((x) => `${x.id}  ${x.state.padEnd(10)} ${x.routing.size.padEnd(9)} ${x.target.padEnd(11)} ${x.cards.join(',')}`).join('\n') || '(none)');
    });
  goal
    .command('extend <id>')
    .requiredOption('--until <iso>', 'new deadline (ISO)')
    .requiredOption('--by <who>', 'who granted the extension')
    .requiredOption('--reason <text>', 'recorded reason')
    .action((id: string, o: { until: string; by: string; reason: string }) => {
      const c = ctx(g());
      const updated = c.controller.extendDeadline(id, o.by, o.until, o.reason);
      out(c, { goal: updated.id, deadlines: updated.deadlines }, () => `extended ${updated.id} to ${o.until}`);
    });
  goal
    .command('cancel <id>')
    .option('--detail <text>')
    .action((id: string, o: { detail?: string }) => {
      const c = ctx(g());
      const r = c.controller.report({ goalId: id, generation: c.controller.mustGoal(id).generation, result: 'cancel', data: { detail: o.detail ?? 'cancelled by user' } });
      out(c, r.directive, () => formatStop(r.goal.stop!));
    });
  goal
    .command('resume <id>')
    .description('fresh user-authorised continuation of a terminal goal (links the old generation, keeps exhausted limits)')
    .option('--reason <text>')
    .action((id: string, o: { reason?: string }) => {
      const c = ctx(g());
      const r = c.controller.report({ goalId: id, generation: c.controller.mustGoal(id).generation, result: 'resume', data: { reason: o.reason } });
      out(c, r.directive, () => `${r.goal.id} generation ${r.goal.generation}: ${r.directive.kind} — ${r.directive.narration}`);
    });
  goal
    .command('amend <id>')
    .description('record a requirement revision (versions the same goal)')
    .requiredOption('--text <text>', 'amended request text')
    .option('--cards <ids>', 'comma-separated card ids for the revised projection')
    .option('--replace <map>', 'JSON map old->new card ids')
    .option('--reason <text>')
    .action((id: string, o: { text: string; cards?: string; replace?: string; reason?: string }) => {
      const c = ctx(g());
      const r = c.controller.report({ goalId: id, generation: c.controller.mustGoal(id).generation, result: 'revision', data: { text: o.text, cards: o.cards?.split(',').map((s) => s.trim()), replacements: o.replace ? JSON.parse(o.replace) : {}, reason: o.reason } });
      out(c, r.directive, () => `${r.goal.id} revision ${r.goal.revision}: ${r.directive.kind} — ${r.directive.narration}`);
    });
  goal
    .command('repair <id>')
    .description('report a failed integrated acceptance with coherent repair cards (one bounded cycle)')
    .requiredOption('--cards <ids>', 'comma-separated repair card ids')
    .option('--detail <text>')
    .action((id: string, o: { cards: string; detail?: string }) => {
      const c = ctx(g());
      const r = c.controller.report({ goalId: id, generation: c.controller.mustGoal(id).generation, result: 'arc-failed', data: { repairCards: o.cards.split(',').map((s) => s.trim()), detail: o.detail } });
      out(c, r.directive, () => `${r.directive.kind} — ${r.directive.narration}`);
    });
  goal
    .command('reconcile <id>')
    .description("list the goal's unresolved operations and, where a provider status lookup is bound, reconcile them")
    .action((id: string) => {
      const c = ctx(g());
      const ledger = new OperationLedger(c.paths.operations);
      const load = loadDeliveryOps(c.root);
      const results = ledger.unresolved(id).map((op) => {
        const role = op.kind === 'deploy' ? 'deploy' : op.kind === 'rollback' ? 'recover' : op.kind === 'migrate' ? 'migration-apply' : undefined;
        const binding = load.status === 'configured' && role ? load.config.operations.find((b) => b.role === role) : undefined;
        if (binding && op.providerOperationId) {
          const looked = lookupOperation(binding, op.providerOperationId);
          const rec = ledger.reconcile(op.id, () => (looked.status === 'UNKNOWN' ? { status: 'UNKNOWN', detail: looked.detail } : { status: looked.status, providerOperationId: op.providerOperationId }));
          Journal.forGoal(c.paths.journal, id).append({ type: 'OPERATION_RECONCILED', goalId: id, cardId: op.cardId, data: { operationId: op.id, status: rec.status } });
          return { id: op.id, kind: op.kind, status: rec.status, via: 'provider lookup' };
        }
        return { id: op.id, kind: op.kind, status: op.status, via: 'manual: aidlc ops reconcile <id> --status <s>' };
      });
      out(c, results, () => (results.length ? results.map((r) => `${r.id} ${r.kind} ${r.status} (${r.via})`).join('\n') : 'no unresolved operations'));
    });
  goal
    .command('takeover <id>')
    .description('take over an expired goal lease after reconciling the previous owner\'s operations')
    .action((id: string) => {
      const c = ctx(g());
      const leases = new LeaseStore(c.paths.leases);
      const ops = new OperationLedger(c.paths.operations);
      const key = resourceKeys.goal(c.repo.key, id);
      const result = leases.takeover(key, () => {
        const unresolved = ops.unresolved(id).map((o) => o.id);
        return { reconciled: unresolved.length === 0, unresolvedOperations: unresolved, note: unresolved.length ? 'reconcile with `aidlc ops reconcile` first' : undefined };
      }, { operation: 'coordinate' });
      Journal.forGoal(c.paths.journal, id).append({ type: 'GOAL_TAKEOVER', goalId: id, data: { leaseGeneration: result.lease.generation, report: result.report } });
      out(c, result, () => `took over ${id} at lease generation ${result.lease.generation}`);
    });

  program
    .command('next [goalId]')
    .description('derive the single next directive for a goal (read-only apart from derived transitions)')
    .option('--goal <id>', 'goal id (alternative to the positional argument)')
    .action((goalId: string | undefined, o: { goal?: string }) => {
      const c = ctx(g());
      const d = c.controller.next(latestActiveGoalId(c, goalId ?? o.goal));
      out(c, d, () => `[${d.kind}] goal=${d.goalId} gen=${d.generation} state=${d.goalState} deadline=${d.deadline}\n${d.narration}`);
    });

  program
    .command('report [goalId]')
    .description('commit an externally observed result, then print the next directive')
    .requiredOption('--result <r>', ReportInput.shape.result.options.join('|'))
    .option('--goal <id>', 'goal id (alternative to the positional argument)')
    .option('--card <id>')
    .option('--attempt <id>')
    .option('--data <json>', 'result payload')
    .option('--plan-ref <path>', 'shortcut for plan-produced')
    .option('--cards <ids>', 'shortcut for cards-projected / repair cards')
    .option('--kind <kind>', 'authorization kind for approved')
    .option('--by <who>')
    .option('--env <environment>')
    .option('--candidate <digest>')
    .option('--ops <list>', 'comma-separated operations for a production authorization')
    .option('--detail <text>')
    .action((goalId: string | undefined, o: { result: string; goal?: string; card?: string; attempt?: string; data?: string; planRef?: string; cards?: string; kind?: string; by?: string; env?: string; candidate?: string; ops?: string; detail?: string }) => {
      const c = ctx(g());
      const id = latestActiveGoalId(c, goalId ?? o.goal);
      const data = parseData(o.data);
      if (o.planRef) data['planRef'] = o.planRef;
      if (o.cards) data[o.result === 'arc-failed' ? 'repairCards' : 'cards'] = o.cards.split(',').map((s) => s.trim());
      if (o.kind) data['kind'] = o.kind;
      if (o.by) data['by'] = o.by;
      if (o.env) data['environment'] = o.env;
      if (o.candidate) data['candidateDigest'] = o.candidate;
      if (o.ops) data['operations'] = o.ops.split(',').map((s) => s.trim());
      if (o.detail) data['detail'] = o.detail;
      const input = ReportInput.parse({ goalId: id, generation: c.controller.mustGoal(id).generation, result: o.result, cardId: o.card, attemptId: o.attempt, data });
      const r = c.controller.report(input);
      out(c, r.directive, () => `[${r.directive.kind}] ${r.directive.narration}`);
    });

  program
    .command('authorize <kind>')
    .description('record an authorization (development|plan-checkpoint|staging|production|recovery) bound to candidate/environment/operations')
    .option('--goal <id>')
    .option('--by <who>', 'who granted it', 'user')
    .option('--ref <ref>', 'host/project permission record reference')
    .option('--env <environment>')
    .option('--candidate <digest>')
    .option('--sha <sourceSha>')
    .option('--config-digest <digest>')
    .option('--ops <list>')
    .option('--migrations <list>')
    .option('--recovery <json>', 'recovery specifics: eligibleBaseline, healthTrigger, procedure, migrationCompatibility, windowMs, owner')
    .action((kind: string, o: { goal?: string; by: string; ref?: string; env?: string; candidate?: string; sha?: string; configDigest?: string; ops?: string; migrations?: string; recovery?: string }) => {
      const c = ctx(g());
      const id = latestActiveGoalId(c, o.goal);
      const data: Record<string, unknown> = { kind, by: o.by, ref: o.ref, environment: o.env, candidateDigest: o.candidate, sourceSha: o.sha, configDigest: o.configDigest, operations: o.ops?.split(',').map((s) => s.trim()) ?? [], migrations: o.migrations?.split(',').map((s) => s.trim()) ?? [], recovery: o.recovery ? JSON.parse(o.recovery) : undefined };
      const r = c.controller.report({ goalId: id, generation: c.controller.mustGoal(id).generation, result: 'approved', data });
      out(c, { authorizations: r.goal.authorizations, directive: r.directive }, () => `recorded ${kind} authorization; next: ${r.directive.kind} — ${r.directive.narration}`);
    });

  program
    .command('board [goalId]')
    .description('regenerate and print the board view')
    .option('--goal <id>', 'goal id (alternative to the positional argument)')
    .action((goalId: string | undefined, o: { goal?: string }) => {
      const c = ctx(g());
      const goalRec = c.controller.mustGoal(latestActiveGoalId(c, goalId ?? o.goal));
      const registry = loadCardRegistry(path.join(c.root, c.config.cardsDir), path.join(c.root, c.config.archiveDir));
      const cards = goalRec.cards.map((id) => registry.cards.find((p) => p.card.id === id)?.card).filter((x): x is NonNullable<typeof x> => Boolean(x));
      const text = renderBoard(goalRec, cards, c.store.listCardRuns(goalRec.id), new Date().toISOString());
      c.controller.writeBoard(goalRec, cards);
      process.stdout.write(text + '\n');
    });

  // ------------------------------------------------------------------ cards
  const card = program.command('card').description('single-card execution');
  const runnerFor = (c: Ctx) => new CardRunner({ paths: c.paths, repo: c.repo, config: c.config, store: c.store });
  const cardCtx = (c: Ctx, cardId: string, goalId?: string) => {
    const goalRec = c.controller.mustGoal(latestActiveGoalId(c, goalId));
    const parsed = cardOf(c, cardId);
    const run = c.controller.ensureCardRun(goalRec, cardId);
    return { goalRec, parsed, run };
  };
  card
    .command('next <cardId>')
    .description('gather evidence, select the card state and perform its bounded action')
    .option('--goal <id>')
    .option('--effort <level>')
    .action((cardId: string, o: { goal?: string; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' }) => {
      const c = ctx(g());
      const { goalRec, parsed, run } = cardCtx(c, cardId, o.goal);
      const r = runnerFor(c).next(goalRec, parsed.card, run, { effort: o.effort });
      c.controller.writeBoard(goalRec);
      out(c, { run: { state: r.run.state, worktree: r.run.worktree, deadline: r.run.deadline, review: r.run.review, ci: r.run.ci, attempts: r.run.effort?.attempts.length ?? 0 }, directive: r.directive }, () => `[${r.directive.kind}] ${cardId} state=${r.run.state}\n${r.directive.narration}`);
    });
  card
    .command('attempt <cardId>')
    .description('record the outcome of the running implementation attempt')
    .option('--goal <id>')
    .requiredOption('--outcome <o>', 'success|fail|not-counted')
    .option('--cause <text>', 'normalised failure cause (required on fail)')
    .option('--not-counted <reason>', 'expected-red|quota|admission-hold|tool-outage|env-setup')
    .option('--progress', 'verified progress since the previous attempt')
    .option('--evidence <text>')
    .option('--dod-receipt <text>')
    .option('--red-receipt <text>')
    .option('--candidate-sha <sha>')
    .action((cardId: string, o: { goal?: string; outcome: 'success' | 'fail' | 'not-counted'; cause?: string; notCounted?: 'expected-red' | 'quota' | 'admission-hold' | 'tool-outage' | 'env-setup'; progress?: boolean; evidence?: string; dodReceipt?: string; redReceipt?: string; candidateSha?: string }) => {
      const c = ctx(g());
      const { goalRec, parsed, run } = cardCtx(c, cardId, o.goal);
      const updated = runnerFor(c).recordAttempt(goalRec, parsed.card, run, { outcome: o.outcome, cause: o.cause, notCountedReason: o.notCounted, progress: o.progress, evidence: o.evidence, dodReceipt: o.dodReceipt, redReceipt: o.redReceipt, candidateSha: o.candidateSha });
      out(c, { effort: updated.effort, dodReceipt: updated.dodReceipt, candidate: updated.candidate }, () => `recorded ${o.outcome}; attempts=${updated.effort?.attempts.length} terminal=${updated.effort?.terminal ?? '-'}; run \`aidlc card next ${cardId}\``);
    });
  card
    .command('close <cardId>')
    .description('mark closure predicates as verified')
    .option('--goal <id>')
    .option('--metadata')
    .option('--doc-sync')
    .option('--findings')
    .option('--evidence')
    .option('--cleanup')
    .option('--all')
    .action((cardId: string, o: { goal?: string; metadata?: boolean; docSync?: boolean; findings?: boolean; evidence?: boolean; cleanup?: boolean; all?: boolean }) => {
      const c = ctx(g());
      const { goalRec, parsed, run } = cardCtx(c, cardId, o.goal);
      const flags = o.all ? { metadata: true, docSync: true, findings: true, evidence: true, cleanup: true } : { metadata: o.metadata, docSync: o.docSync, findings: o.findings, evidence: o.evidence, cleanup: o.cleanup };
      const defined = Object.fromEntries(Object.entries(flags).filter(([, v]) => v !== undefined)) as Partial<typeof run.closure>;
      const updated = runnerFor(c).markClosure(goalRec, parsed.card, run, defined);
      out(c, updated.closure, () => Object.entries(updated.closure).map(([k, v]) => `${k}=${v}`).join(' '));
    });
  card
    .command('ci-reconcile <cardId>')
    .requiredOption('--run <runId>')
    .option('--goal <id>')
    .action((cardId: string, o: { run: string; goal?: string }) => {
      const c = ctx(g());
      const { goalRec, parsed, run } = cardCtx(c, cardId, o.goal);
      const updated = runnerFor(c).ciReconcile(goalRec, parsed.card, run, o.run);
      out(c, updated.ci, () => `reconciled; state=${updated.state}`);
    });
  card
    .command('report <cardId>')
    .description('merge a raw card-run patch (advanced)')
    .option('--goal <id>')
    .requiredOption('--data <json>')
    .action((cardId: string, o: { goal?: string; data: string }) => {
      const c = ctx(g());
      const id = latestActiveGoalId(c, o.goal);
      c.controller.ensureCardRun(c.controller.mustGoal(id), cardId);
      const r = c.controller.report({ goalId: id, generation: c.controller.mustGoal(id).generation, result: 'card-result', cardId, data: parseData(o.data) });
      out(c, r.directive, () => `[${r.directive.kind}] ${r.directive.narration}`);
    });
  card
    .command('status <cardId>')
    .option('--goal <id>')
    .action((cardId: string, o: { goal?: string }) => {
      const c = ctx(g());
      const id = latestActiveGoalId(c, o.goal);
      const run = c.store.getCardRun(id, cardId);
      if (!run) fail(`no run record for ${cardId} in ${id}`);
      out(c, run, () => `${cardId} state=${run.state} worktree=${run.worktree ?? '-'} pr=${run.pr?.number ?? '-'} merge=${run.mergeVerified} deadline=${run.deadline}${run.stop ? `\n${formatStop(run.stop)}` : ''}`);
    });
  card
    .command('fix-task [cardId]')
    .description('set (or clear with --clear) the fix-task marker that locks test files')
    .option('--clear')
    .action((cardId: string | undefined, o: { clear?: boolean }) => {
      const c = ctx(g());
      const file = path.join(c.paths.root, 'fix-task');
      mkdirSync(c.paths.root, { recursive: true });
      writeFileSync(file, o.clear ? '' : (cardId ?? 'fix-task'), 'utf8');
      out(c, { marker: o.clear ? null : cardId ?? 'fix-task' }, () => (o.clear ? 'fix-task marker cleared' : `fix-task marker set: ${cardId ?? 'fix-task'} (test files are locked for the agent)`));
    });
  for (const phase of ['start', 'red', 'ship', 'cleanup'] as const) {
    card
      .command(`${phase} <cardId>`)
      .description(`run the scaffold task.ps1 -Phase ${phase} from the main checkout (scaffold ship path only)`)
      .option('--base <ref>')
      .option('--local')
      .action((cardId: string, o: { base?: string; local?: boolean }) => {
        const c = ctx(g());
        if (c.config.shipPath !== 'scaffold') fail(`ship path is ${c.config.shipPath}; task.ps1 phases apply to the scaffold path only`);
        const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(c.root, 'scripts', 'task.ps1'), '-TaskId', cardId, '-Phase', phase];
        if (o.base ?? c.config.base) args.push('-Base', o.base ?? c.config.base);
        if (o.local || c.config.mode === 'local') args.push('-Local');
        const r = spawnSync('pwsh', args, { cwd: c.root, stdio: 'inherit', windowsHide: true });
        process.exit(r.status ?? 1);
      });
  }

  const cards = program.command('cards').description('card registry');
  cards
    .command('validate')
    .option('--card <id>')
    .action((o: { card?: string }) => {
      const c = ctx(g());
      const registry = loadCardRegistry(path.join(c.root, c.config.cardsDir), path.join(c.root, c.config.archiveDir));
      const validation = validateRegistry(registry, c.config.tierPaths);
      const entries = [...validation.entries()].filter(([id]) => !o.card || id === o.card);
      const blocking = entries.flatMap(([id, fs]) => fs.filter((f) => f.severity === 'block').map((f) => `${id}: ${f.sentinel} ${f.message}`));
      const errors = registry.errors.map((e) => `${path.basename(e.file)}: ${e.error} ${e.findings.map((f) => f.sentinel).join(' ')}`);
      const ok = blocking.length === 0 && errors.length === 0;
      out(c, { ok, cards: entries.length, blocking, errors, findings: Object.fromEntries(entries) }, () => [...entries.flatMap(([id, fs]) => fs.map((f) => `${f.severity === 'block' ? 'BLOCK' : 'warn '} ${id} ${f.sentinel} ${f.message}`)), ...errors.map((e) => `ERROR ${e}`), ok ? `check-cards: PASS (${entries.length} cards)` : 'check-cards: FAIL'].join('\n'));
      if (!ok) process.exitCode = 1;
    });
  cards
    .command('project')
    .description('render draft cards from a plan\'s task-split table (prints unless --write; human sign-off owns the registry)')
    .requiredOption('--plan <file>')
    .option('--write', 'write missing card files into the registry')
    .option('--dod <command>', 'default dod_command for drafted cards', 'npm test')
    .action((o: { plan: string; write?: boolean; dod: string }) => {
      const c = ctx(g());
      const rows = parsePlanCards(readFileSync(o.plan, 'utf8'));
      const dir = path.join(c.root, c.config.cardsDir);
      const drafted: string[] = [];
      for (const row of rows) {
        const text = renderCard({ id: row.id, title: row.output || row.id, allowPaths: ['path/to/change'], dodCommand: o.dod, acceptance: [`1. ${row.output || 'the requested behaviour holds'}. [dod arm 1]`], dependsOn: row.dependsOn, planRef: `${path.relative(c.root, o.plan).replace(/\\/g, '/')}#7`, worktreeRoot: resolveWorktreeRoot(c.config), deliverable: row.output, freeze: row.freezePoint });
        const file = path.join(dir, `${row.id}.md`);
        if (o.write && !existsSync(file)) {
          mkdirSync(dir, { recursive: true });
          writeFileSync(file, text, 'utf8');
          drafted.push(file);
        } else if (!o.write) process.stdout.write(`\n<!-- ${row.id} -->\n${text}`);
      }
      if (o.write) out(c, { drafted, rows: rows.length }, () => `drafted ${drafted.length} card(s); replace path/to placeholders and acceptance before validate`);
    });

  // ------------------------------------------------------------------ artifacts
  const intent = program.command('intent').description('stage 1 artifact');
  intent
    .command('new')
    .requiredOption('--title <t>')
    .option('--author <a>', 'author', currentActor().session)
    .option('--problem <p>', 'problem statement', '')
    .option('--outcome <o>', 'proposed outcome', '')
    .option('--affected <a>', 'affected users and systems', '')
    .option('--constraints <c>', 'constraints', '')
    .option('--question <q...>', 'open questions')
    .action((o: { title: string; author: string; problem: string; outcome: string; affected: string; constraints: string; question?: string[] }) => {
      const c = ctx(g());
      const slug = slugify(o.title);
      const text = renderIntent({ slug, title: o.title, author: o.author, status: 'draft', createdAt: new Date().toISOString(), problem: o.problem, proposedOutcome: o.outcome, affected: o.affected, constraints: o.constraints, openQuestions: o.question ?? [] });
      const file = path.join(c.root, c.config.intentDir, `${slug}.md`);
      mkdirSync(path.dirname(file), { recursive: true });
      if (existsSync(file)) fail(`${file} exists`);
      writeFileSync(file, text, 'utf8');
      out(c, { file }, () => `wrote ${file}`);
    });
  intent
    .command('validate <file>')
    .action((file: string) => {
      const c = ctx(g());
      const v = parseIntent(readFileSync(file, 'utf8'));
      out(c, v, () => (v.ok ? `intent: PASS` : `intent: FAIL\n${v.problems.map((p) => `  - ${p}`).join('\n')}`));
      if (!v.ok) process.exitCode = 1;
    });
  program
    .command('spec')
    .description('stage 2 artifact')
    .command('validate <file>')
    .action((file: string) => {
      const c = ctx(g());
      const v = parseSpec(readFileSync(file, 'utf8'));
      out(c, v, () => (v.ok ? `spec: PASS (${v.requirements.length} EARS requirements)` : `spec: FAIL\n${v.problems.map((p) => `  - ${p}`).join('\n')}`));
      if (!v.ok) process.exitCode = 1;
    });
  const plan = program.command('plan').description('stage 3 artifact');
  plan
    .command('check <file>')
    .description('definition-of-ready gates for a plan')
    .option('--light', 'T0 plan (no task split required)')
    .action((file: string, o: { light?: boolean }) => {
      const c = ctx(g());
      const r = evaluatePlanReadiness(readFileSync(file, 'utf8'), { light: o.light, fileExists: (p) => existsSync(path.resolve(c.root, p)) });
      out(c, r, () => [`plan: ${r.overall}`, ...r.gates.map((gt) => `  ${gt.verdict.padEnd(4)} ${gt.severity === 'block' ? 'B' : 'w'} #${gt.gateId} ${gt.name}${gt.finding ? ` — ${gt.finding}` : ''}`), ...r.questions.map((q) => `  ? ${q}`)].join('\n'));
      if (r.overall !== 'admit') process.exitCode = 1;
    });
  plan
    .command('approve <goalId>')
    .description('record the T2 plan+projection checkpoint approval')
    .option('--by <who>', 'approver', 'user')
    .action((goalId: string, o: { by: string }) => {
      const c = ctx(g());
      const r = c.controller.report({ goalId, generation: c.controller.mustGoal(goalId).generation, result: 'approved', data: { kind: 'plan-checkpoint', by: o.by } });
      out(c, r.directive, () => `[${r.directive.kind}] ${r.directive.narration}`);
    });

  // ------------------------------------------------------------------ review / ci / ops
  const review = program.command('review').description('shared review admission queue, the R2 and R3 review commands, and the findings of a card run');
  review
    .command('status')
    .option('--pool <name>')
    .action((o: { pool?: string }) => {
      const c = ctx(g());
      const q = new ReviewQueue(c.paths.reviewQueue);
      const pool = o.pool ?? c.config.reviewPool;
      out(c, { pool: q.pool(pool), requests: q.list(pool) }, () => `pool ${pool}: active=${q.pool(pool).active.length}/${q.pool(pool).maxConcurrent} resetAt=${q.pool(pool).resetAt ?? '-'}\n${q.list(pool).map((r) => `  ${r.seq} ${r.state.padEnd(11)} ${r.candidateDigest.slice(0, 12)} ${r.requesters.join('+')}`).join('\n') || '  (empty)'}`);
    });
  review
    .command('pre <cardId>')
    .description('run the configured pre-reviewer (R2) on the committed candidate: pass opens the ship, block returns the card to BUILD')
    .option('--goal <id>')
    .action(async (cardId: string, o: { goal?: string }) => {
      const c = ctx(g());
      const { goalRec, parsed, run } = cardCtx(c, cardId, o.goal);
      const r = await runnerFor(c).preReview(goalRec, parsed.card, run);
      c.controller.writeBoard(goalRec);
      const summary = { outcome: r.result.outcome, runStatus: r.result.runStatus, cycle: r.round.cycle, round: r.round.round, maxRounds: c.config.preReview.rounds, reviewer: r.round.reviewer, candidateSha: r.round.candidateSha, durationMs: r.result.durationMs, perspectives: (r.round.perspectives ?? []).map((p) => `${p.name}:${p.outcome}:${p.durationMs}ms`), reasons: r.result.reasons, verdictRef: r.result.verdictRef, logRef: r.result.logRef, state: r.run.state };
      out(c, summary, () => `pre-review ${summary.reviewer} round ${summary.round}/${summary.maxRounds} (cycle ${summary.cycle}): ${summary.outcome} (${summary.runStatus}, ${summary.durationMs} ms) [${summary.perspectives.join(' ')}]\n${summary.reasons.map((x) => `  - ${x}`).join('\n') || '  no findings'}\nstate=${summary.state}; next: \`aidlc card next ${cardId}\``);
    });
  review
    .command('r3 <cardId>')
    .description('run the configured formal reviewer (R3) on the committed candidate: pass opens the ship, a merge-blocking block returns the card to REVIEW_FIX')
    .option('--goal <id>')
    .action(async (cardId: string, o: { goal?: string }) => {
      const c = ctx(g());
      const { goalRec, parsed, run } = cardCtx(c, cardId, o.goal);
      const r = await runnerFor(c).formalReview(goalRec, parsed.card, run);
      c.controller.writeBoard(goalRec);
      const summary = { outcome: r.classified.outcome, mergeBlocking: r.classified.mergeBlocking, runStatus: r.classified.runStatus, decisions: r.run.review.substantiveDecisions, blocks: r.run.review.substantiveBlocks, reviewer: c.config.formalReview.reviewer, durationMs: r.durationMs, reasons: r.classified.reasons, advisory: r.advisory, verdictRef: r.verdictRef, logRef: r.logRef, state: r.run.state };
      out(c, summary, () => `formal review ${summary.reviewer}: ${summary.outcome} (${summary.runStatus}, ${summary.durationMs} ms); decisions ${summary.decisions}/2, blocks ${summary.blocks}\n${summary.reasons.map((x) => `  - ${x}`).join('\n') || '  no findings'}${summary.advisory.length ? `\n  advisory: ${summary.advisory.join(' | ')}` : ''}\nstate=${summary.state}; next: \`aidlc card next ${cardId}\``);
    });
  const findingLine = (f: { id: string; stage: string; round: number; perspective?: string; disposition: string; disputes: Array<{ note: string }>; reraised: Array<{ round: number; stage: string; answeredDispute: boolean }>; resolvedAt?: string; reason: string }) =>
    `${f.id.padEnd(4)} ${f.resolvedAt ? 'resolved' : f.disposition} ${f.stage === 'pre' ? `R2 round ${f.round}${f.perspective ? ` (${f.perspective})` : ''}` : `R3 decision ${f.round}`}${f.reraised.length ? `; re-raised ${f.reraised.map((r) => `${r.stage === 'pre' ? 'R2' : 'R3'} ${r.round}${r.answeredDispute ? ' after a dispute' : ''}`).join(', ')}` : ''}${f.disputes.length ? `; disputed ${f.disputes.length}x, last note: ${f.disputes.at(-1)?.note}` : ''}\n     ${f.reason}`;
  review
    .command('findings <cardId>')
    .description('list the findings of the card run with their dispositions, disputes, re-raises and resolution')
    .option('--goal <id>')
    .action((cardId: string, o: { goal?: string }) => {
      const c = ctx(g());
      const { run } = cardCtx(c, cardId, o.goal);
      const findings = runnerFor(c).listFindings(run);
      out(c, { cardId, findings }, () => (findings.length ? findings.map(findingLine).join('\n') : `${cardId}: no findings recorded`));
    });
  review
    .command('dispute <cardId> <findingId>')
    .description('dispute an open finding with a note; the next round or decision receives the note, and a candidate blocked only by disputed findings is re-reviewed unchanged')
    .option('--goal <id>')
    .requiredOption('--note <text>', 'why the finding does not hold (evidence, file:line, the acceptance item)')
    .action((cardId: string, findingId: string, o: { goal?: string; note: string }) => {
      const c = ctx(g());
      const { goalRec, parsed, run } = cardCtx(c, cardId, o.goal);
      const next = runnerFor(c).disputeFinding(goalRec, parsed.card, run, findingId, o.note);
      c.controller.writeBoard(goalRec);
      const f = next.findings.find((x) => x.id === findingId.toUpperCase())!;
      out(c, { cardId, finding: f }, () => `${findingLine(f)}\nnext: dispute or repair the other open findings, then \`aidlc card next ${cardId}\``);
    });
  review
    .command('accept <cardId> <findingId>')
    .description('withdraw a dispute: the finding is open again and the next round verifies it')
    .option('--goal <id>')
    .action((cardId: string, findingId: string, o: { goal?: string }) => {
      const c = ctx(g());
      const { goalRec, parsed, run } = cardCtx(c, cardId, o.goal);
      const next = runnerFor(c).acceptFinding(goalRec, parsed.card, run, findingId);
      c.controller.writeBoard(goalRec);
      const f = next.findings.find((x) => x.id === findingId.toUpperCase())!;
      out(c, { cardId, finding: f }, () => `${findingLine(f)}\nnext: repair it, record the attempt with the new candidate sha, then \`aidlc card next ${cardId}\``);
    });
  program
    .command('ci')
    .description('CI failure diagnosis')
    .command('classify')
    .requiredOption('--log <file>')
    .action((o: { log: string }) => {
      const c = ctx(g());
      const r = classifyCiFailure([{ name: 'log', conclusion: 'failure', logExcerpt: readFileSync(o.log, 'utf8') }]);
      out(c, r, () => `${r.class}: ${r.evidence.slice(0, 5).join('; ')}`);
    });
  const ops = program.command('ops').alias('op').description('external operation ledger');
  ops
    .command('list')
    .option('--goal <id>')
    .action((o: { goal?: string }) => {
      const c = ctx(g());
      const ledger = new OperationLedger(c.paths.operations);
      const list = ledger.list(o.goal ? { goalId: o.goal } : {});
      out(c, list, () => list.map((x) => `${x.id} ${x.kind.padEnd(9)} ${x.status.padEnd(9)} ${x.target} ${x.candidateDigest?.slice(0, 12) ?? ''}`).join('\n') || '(none)');
    });
  ops
    .command('reconcile <opId>')
    .description('record the looked-up outcome of an operation with unknown result')
    .requiredOption('--status <s>', 'succeeded|failed|running|cancelled|UNKNOWN')
    .option('--detail <text>')
    .option('--provider-id <id>')
    .action((opId: string, o: { status: 'succeeded' | 'failed' | 'running' | 'cancelled' | 'UNKNOWN'; detail?: string; providerId?: string }) => {
      const c = ctx(g());
      const ledger = new OperationLedger(c.paths.operations);
      const rec = ledger.reconcile(opId, () => (o.status === 'UNKNOWN' ? { status: 'UNKNOWN', detail: o.detail ?? 'provider could not resolve' } : { status: o.status, providerOperationId: o.providerId, error: o.detail }));
      Journal.forGoal(c.paths.journal, rec.goalId).append({ type: 'OPERATION_RECONCILED', goalId: rec.goalId, cardId: rec.cardId, data: { operationId: rec.id, status: rec.status } });
      out(c, rec, () => `${rec.id} -> ${rec.status}`);
    });
  ops
    .command('intent')
    .description('record an operation intent before an external mutation')
    .requiredOption('--goal <id>')
    .requiredOption('--kind <k>')
    .requiredOption('--target <t>')
    .option('--candidate <digest>')
    .option('--timeout-ms <n>', 'timeout', '1800000')
    .action((o: { goal: string; kind: string; target: string; candidate?: string; timeoutMs: string }) => {
      const c = ctx(g());
      const ledger = new OperationLedger(c.paths.operations);
      const goalRec = c.controller.mustGoal(o.goal);
      const rec = ledger.recordIntent({ kind: o.kind as never, goalId: goalRec.id, target: o.target, candidateDigest: o.candidate, ownerGeneration: goalRec.generation, timeoutMs: Number(o.timeoutMs) });
      Journal.forGoal(c.paths.journal, rec.goalId).append({ type: 'OPERATION_INTENT', goalId: rec.goalId, data: { operationId: rec.id, kind: rec.kind, target: rec.target } });
      out(c, rec, () => `intent ${rec.id} recorded`);
    });

  // ------------------------------------------------------------------ release
  const release = program.command('release').description('opt-in delivery targets (package / staging / production)');
  const releaseCtx = (c: Ctx, attemptId: string, goalId?: string) => {
    const attempt = c.store.getRelease(attemptId);
    if (!attempt) fail(`unknown release attempt ${attemptId}`);
    const goalRec = c.controller.mustGoal(goalId ?? attempt.goalId);
    return { attempt, goalRec, runner: new ReleaseRunner({ paths: c.paths, repo: c.repo, store: c.store }) };
  };
  release
    .command('start')
    .description('create a release attempt for a goal in DELIVER (or a standalone release goal)')
    .option('--goal <id>')
    .action((o: { goal?: string }) => {
      const c = ctx(g());
      const d = c.controller.next(latestActiveGoalId(c, o.goal));
      out(c, d, () => `[${d.kind}] ${d.narration}`);
    });
  release
    .command('next <attemptId>')
    .option('--goal <id>')
    .action((attemptId: string, o: { goal?: string }) => {
      const c = ctx(g());
      const { attempt, goalRec, runner } = releaseCtx(c, attemptId, o.goal);
      const r = runner.next(goalRec, attempt);
      if (r.attempt.state === 'STOP' || r.attempt.state === 'DONE') {
        c.controller.report({ goalId: goalRec.id, generation: goalRec.generation, result: 'release-result', attemptId, data: { attempt: r.attempt } });
      }
      out(c, { attempt: { id: r.attempt.id, state: r.attempt.state, disposition: r.attempt.disposition, environment: r.attempt.environment, health: r.attempt.healthResult }, directive: r.directive }, () => `[${r.directive.kind}] ${attemptId} state=${r.attempt.state}\n${r.directive.narration}`);
    });
  release
    .command('report <attemptId>')
    .description('record an externally observed release step (stage-verify, recover-verify, package-run-proof, ...)')
    .option('--goal <id>')
    .requiredOption('--step <name>')
    .requiredOption('--status <s>', 'succeeded|failed|UNKNOWN')
    .option('--evidence <text>')
    .action((attemptId: string, o: { goal?: string; step: string; status: 'succeeded' | 'failed' | 'UNKNOWN'; evidence?: string }) => {
      const c = ctx(g());
      const { attempt, goalRec, runner } = releaseCtx(c, attemptId, o.goal);
      const updated = runner.reportStep(goalRec, attempt, o.step, o.status, o.evidence);
      out(c, { steps: updated.steps, state: updated.state }, () => `${o.step}=${o.status}; state=${updated.state}`);
    });
  release
    .command('candidate <attemptId>')
    .requiredOption('--digest <d>')
    .requiredOption('--sha <s>')
    .option('--goal <id>')
    .option('--env <environment>')
    .option('--config-digest <d>')
    .option('--database <db>')
    .action((attemptId: string, o: { digest: string; sha: string; goal?: string; env?: string; configDigest?: string; database?: string }) => {
      const c = ctx(g());
      const { attempt, goalRec, runner } = releaseCtx(c, attemptId, o.goal);
      const updated = runner.setCandidate(goalRec, attempt, { candidateDigest: o.digest, sourceSha: o.sha, configDigest: o.configDigest, environment: o.env, database: o.database });
      out(c, { candidateDigest: updated.candidateDigest, sourceSha: updated.sourceSha, environment: updated.environment }, () => `candidate bound to ${attemptId}`);
    });
  release
    .command('packet <attemptId>')
    .description('print the approval packet for the production checkpoint')
    .action((attemptId: string) => {
      const c = ctx(g());
      const { attempt, goalRec, runner } = releaseCtx(c, attemptId);
      const r = runner.next(goalRec, attempt);
      out(c, r.directive, () => JSON.stringify(r.directive, null, 2));
    });
  release
    .command('ops')
    .description('show bound provider operations for a target')
    .option('--target <t>', 'package|staging|production|migration', 'staging')
    .action((o: { target: 'package' | 'staging' | 'production' | 'migration' }) => {
      const c = ctx(g());
      const load = loadDeliveryOps(c.root);
      const roles = resolveRoles(load, o.target);
      out(c, { status: load.status, roles: roles.roles.map((r) => ({ role: r.role, status: r.status })), ok: roles.ok, problem: roles.problem }, () => [`ops: ${load.status}`, ...roles.roles.map((r) => `  ${r.role.padEnd(17)} ${r.status}`)].join('\n'));
    });

  // ------------------------------------------------------------------ migrate
  const migrate = program.command('migrate').description('data impact and migration planning');
  migrate
    .command('assess')
    .requiredOption('--paths <list>', 'comma-separated changed paths')
    .option('--diff <file>', 'diff text to scan for ORM/SQL/backfill signals')
    .action((o: { paths: string; diff?: string }) => {
      const c = ctx(g());
      const content = o.diff ? readFileSync(o.diff, 'utf8') : undefined;
      const r = detectDataImpact(o.paths.split(',').map((p) => ({ path: p.trim(), content })));
      out(c, r, () => `${r.impacted ? (r.strong ? 'DATA IMPACT (strong)' : 'data impact (hint only)') : 'no data impact'}\n${r.signals.map((s) => `  ${s.strength.padEnd(6)} ${s.kind.padEnd(16)} ${s.path ?? ''} ${s.detail}`).join('\n')}`);
    });
  migrate
    .command('plan')
    .requiredOption('--db <name>')
    .option('--expand <list>')
    .option('--deploy <desc>')
    .option('--backfill <list>')
    .option('--verify <list>')
    .option('--contract <list>')
    .option('--irreversible <list>')
    .option('--order <list>', 'proposed execution order to validate')
    .action((o: { db: string; expand?: string; deploy?: string; backfill?: string; verify?: string; contract?: string; irreversible?: string; order?: string }) => {
      const c = ctx(g());
      const split = (s?: string) => s?.split(';').map((x) => x.trim()).filter(Boolean);
      const steps = buildMigrationPlan({ database: o.db, expand: split(o.expand), compatibleDeploy: o.deploy, backfill: split(o.backfill), verify: split(o.verify), contract: split(o.contract), irreversible: split(o.irreversible) });
      const ordering = o.order ? checkMigrationOrdering(steps, o.order.split(',').map((s) => s.trim())) : undefined;
      const recovery = steps.map((s) => ({ id: s.id, ...assessRecovery(s, {}) }));
      out(c, { steps, ordering, recovery }, () => [...steps.map((s) => `${s.id.padEnd(12)} ${s.phase.padEnd(9)} ${s.reversible ? 'reversible  ' : 'IRREVERSIBLE'} deps=${s.dependsOn.join(',') || '-'} ${s.description}`), ordering ? `ordering: ${ordering.ok ? 'ok' : ordering.problems.join('; ')}` : ''].join('\n'));
    });

  // ------------------------------------------------------------------ evals / audit / monitor / evidence
  program
    .command('evals')
    .description('continuous evals')
    .command('run')
    .option('--dir <dir>')
    .option('--threshold <n>', 'pass-rate gate', '0.9')
    .option('--provider <name>', 'mock|claude-code|claude-api')
    .option('--skip-model', 'run only the deterministic checks')
    .action(async (o: { dir?: string; threshold: string; provider?: string; skipModel?: boolean }) => {
      const c = ctx(g());
      const dir = path.resolve(c.root, o.dir ?? c.config.evalsDir);
      const cases = loadEvals(dir);
      const suite = await runSuite(cases, providerFor(o.provider, c.config), { cwd: c.root, threshold: Number(o.threshold), skipModel: o.skipModel });
      out(c, suite, () => [...suite.results.map((r) => `${r.passed ? 'PASS' : 'FAIL'} ${r.id} (${r.dimension}) ${r.checks.filter((x) => !x.ok).map((x) => `${x.check}: ${x.detail}`).join('; ')}`), `evals: ${suite.gate.toUpperCase()} ${suite.passed}/${suite.total} (threshold ${suite.threshold})`].join('\n'));
      if (suite.gate === 'fail') process.exitCode = 1;
    });
  const audit = program.command('audit').description('evidence manifest and independent verification');
  audit
    .command('verify')
    .option('--goal <id>')
    .option('--all')
    .option('--claim-full', 'evaluate the "fully audited" claim (requires a host capture boundary)')
    .option('--capture-boundary', 'assert that the host captured model/tool events for the declared inventory')
    .action((o: { goal?: string; all?: boolean; claimFull?: boolean; captureBoundary?: boolean }) => {
      const c = ctx(g());
      const ids = o.all ? c.store.listGoals().map((x) => x.id) : [latestActiveGoalId(c, o.goal)];
      const reports = ids.map((id) => {
        const ev = new EvidenceStore(c.paths.evidence, id);
        const mf = existsSync(ev.manifestFile()) ? Manifest.parse(JSON.parse(readFileSync(ev.manifestFile(), 'utf8'))) : undefined;
        return verifyAudit({ goalId: id, journal: Journal.forGoal(c.paths.journal, id), operations: new OperationLedger(c.paths.operations), evidence: ev, manifest: mf, hostCaptureBoundary: o.claimFull ? { present: Boolean(o.captureBoundary), detail: o.captureBoundary ? 'asserted by operator' : 'no host capture boundary asserted' } : undefined, finalCandidateDigest: mf?.finalCandidateDigest, now: new Date().toISOString() });
      });
      out(c, reports, () => reports.map((r) => [`${r.goalId}: level=${r.level} journal=${r.journal.events} events chain=${r.journal.ok ? 'ok' : 'BROKEN'}${r.manifest ? ` manifest=${r.manifest.sealed ? (r.manifest.sealOk ? 'sealed' : 'SEAL BROKEN') : 'unsealed'}` : ''} fully-audited=${r.fullyAuditedStatus}${r.prerequisite ? ` (${r.prerequisite})` : ''}`, ...r.findings.map((f) => `  ${f.severity === 'block' ? 'BLOCK' : 'warn '} ${f.code} ${f.detail}`)].join('\n')).join('\n'));
      if (reports.some((r) => r.findings.some((f) => f.severity === 'block'))) process.exitCode = 1;
    });
  audit
    .command('seal')
    .option('--goal <id>')
    .option('--final-sha <sha>')
    .option('--final-digest <digest>')
    .action((o: { goal?: string; finalSha?: string; finalDigest?: string }) => {
      const c = ctx(g());
      const id = latestActiveGoalId(c, o.goal);
      const goalRec = c.controller.mustGoal(id);
      const ev = new EvidenceStore(c.paths.evidence, id);
      const now = new Date().toISOString();
      const mf = ev.load(id, goalRec.generation, goalRec.revision, now);
      // The seal event is journaled first so the manifest binds to a head that includes it.
      Journal.forGoal(c.paths.journal, id).append({ type: 'MANIFEST_SEALED', goalId: id, generation: goalRec.generation, data: { entries: mf.entries.length, finalSha: o.finalSha, finalCandidateDigest: o.finalDigest } });
      const head = Journal.forGoal(c.paths.journal, id).head();
      const sealed = ev.seal({ ...mf, models: goalRec.roleProfiles.map((p) => ({ role: p.role, provider: p.provider, model: p.model })) }, { journalHead: head.hash, journalEvents: head.seq + 1, finalSha: o.finalSha, finalCandidateDigest: o.finalDigest, now, host: { node: process.version, platform: process.platform, aidlc: '0.1.0' } });
      out(c, { seal: sealed.seal, entries: sealed.entries.length, journalHead: head.hash }, () => `sealed manifest for ${id} (${sealed.entries.length} entries)`);
    });
  program
    .command('evidence')
    .description('retain an artifact in the goal evidence tree')
    .command('retain')
    .option('--goal <id>')
    .requiredOption('--id <id>')
    .requiredOption('--kind <kind>')
    .option('--file <path>')
    .option('--content <text>')
    .option('--candidate <digest>')
    .option('--env <environment>')
    .option('--invocation <id>')
    .option('--note <text>')
    .action((o: { goal?: string; id: string; kind: string; file?: string; content?: string; candidate?: string; env?: string; invocation?: string; note?: string }) => {
      const c = ctx(g());
      const id = latestActiveGoalId(c, o.goal);
      const goalRec = c.controller.mustGoal(id);
      const ev = new EvidenceStore(c.paths.evidence, id);
      const mf = ev.retain(ev.load(id, goalRec.generation, goalRec.revision, new Date().toISOString()), { id: o.id, kind: o.kind, sourcePath: o.file, content: o.content, candidateDigest: o.candidate, environment: o.env, invocationId: o.invocation, note: o.note });
      Journal.forGoal(c.paths.journal, id).append({ type: 'EVIDENCE_RETAINED', goalId: id, generation: goalRec.generation, data: { id: o.id, kind: o.kind, candidateDigest: o.candidate } });
      out(c, { entries: mf.entries.length }, () => `retained ${o.id} (${mf.entries.length} entries)`);
    });
  program
    .command('monitor')
    .description('control-band monitoring (stage 6)')
    .command('check')
    .requiredOption('--bands <file>', 'bands.yaml')
    .requiredOption('--data <file>', 'JSON {baseline:number[], recent:[{at,value}]}')
    .option('--file-intent', 'write an incident intent when a breach reaches the diagnose/propose tier')
    .action((o: { bands: string; data: string; fileIntent?: boolean }) => {
      const c = ctx(g());
      const cfg = parseBandsYaml(readFileSync(o.bands, 'utf8'));
      const data = JSON.parse(readFileSync(o.data, 'utf8')) as { baseline: number[]; recent: Sample[] };
      const breaches = evaluateBands(cfg, data.baseline, data.recent);
      const filed: string[] = [];
      if (o.fileIntent) {
        const ledger = new IncidentLedger(c.paths.incidents);
        for (const b of breaches) {
          if (b.action === 'log') continue;
          const now = new Date().toISOString();
          const decision = ledger.shouldFile(b, cfg.dedupe_window_ms, now);
          if (!decision.file) continue;
          const file = writeIncidentIntent(path.join(c.root, c.config.intentDir), intentFromBreach(b, { summary: `Deterministic band breach on ${b.metric}`, affected: 'see metric owner', proposedOutcome: 'restore the metric to baseline; add a regression eval when fixed', openQuestions: ['Is this a real regression or a data problem?'], evidence: [b.detail] }, now));
          ledger.attachIntent(decision.record.identity, file);
          Journal.host(c.paths.journal).append({ type: 'INTENT_FILED', data: { file, breach: b.rule, metric: b.metric } });
          filed.push(file);
        }
      }
      out(c, { breaches, filed }, () => (breaches.length ? breaches.map((b) => `${b.tier} ${b.rule} ${b.side} -> ${b.action}: ${b.detail}`).join('\n') + (filed.length ? `\nfiled: ${filed.join(', ')}` : '') : 'no breach'));
    });
  program
    .command('security')
    .description('security scan binding')
    .command('check')
    .action(() => {
      const c = ctx(g());
      out(c, { status: 'NOT CONFIGURED', detail: 'bind the project security scanner (e.g. scripts/check-secrets.ps1 -Strict, /security-review-local) in aidlc.config.json or CI; a missing scanner is never a pass' }, () => 'security: NOT CONFIGURED (bind the project scanner; never a pass)');
      process.exitCode = 2;
    });

  // ------------------------------------------------------------------ hooks
  program
    .command('hook <name>')
    .description('Claude Code hook entry (reads the event JSON from stdin); `auto` runs every guard for the event in this one process')
    .action(async (name: string) => {
      const event = readStdinJson(await readStdin());
      const cwd = g().cwd ?? event.cwd ?? process.cwd();
      const result = name === 'auto' ? dispatchHook(event, { cwd }) : runHook(name as HookName, event, { cwd });
      if (result.stdout) process.stdout.write(result.stdout + '\n');
      if (result.stderr) process.stderr.write(result.stderr + '\n');
      process.exit(result.exitCode);
    });

  await program.parseAsync(argv);
}

// Direct execution (`node src/cli/main.ts`) — bin/aidlc.js imports `main` instead.
const invokedDirectly = process.argv[1] && /[\\/]cli[\\/]main\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((err: unknown) => {
    process.stderr.write(`aidlc: ${(err as Error).message}\n`);
    process.exit(1);
  });
}

export { Goal };
