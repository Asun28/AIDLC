/**
 * Shared fixture for end-to-end scenario tests. Everything is isolated in a temp directory:
 * `.aidlc` state, a card registry, a controllable clock and an explicit acting session.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectConfig } from '../../src/config.ts';
import { ensureStatePaths, shortKey, statePathsFromRoot, type RepoIdentity, type StatePaths } from '../../src/state/paths.ts';
import { GoalStore } from '../../src/state/goal-store.ts';
import { Journal, setActorForTests } from '../../src/state/journal.ts';
import { LeaseStore } from '../../src/coordination/lease.ts';
import { ReviewQueue } from '../../src/coordination/review-queue.ts';
import { OperationLedger } from '../../src/coordination/reconcile.ts';
import { GoalController } from '../../src/loop/controller.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { loadCardRegistry, renderCard, type CardRegistry, type NewCardInput } from '../../src/artifacts/card.ts';
import { DryRunShipPath, type ShipPath, type ShipOutcomeClass, type ShipRequest, type ShipResult } from '../../src/delivery/ship.ts';
import { DeliveryOpsConfig, type OpsLoad } from '../../src/delivery/ops.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { addMs, type ActorIdentity, type Card, type CardRun, type Goal, type JournalEvent, type Verdict } from '../../src/core/types.ts';

export const T0 = '2026-09-11T00:00:00.000Z';
export const actorA: ActorIdentity = { session: 'win-A', pid: 1, processStart: T0, host: 'h' };
export const actorB: ActorIdentity = { session: 'win-B', pid: 2, processStart: T0, host: 'h' };

export interface Fixture {
  tmp: string;
  cardsDir: string;
  paths: StatePaths;
  repo: RepoIdentity;
  config: ProjectConfig;
  store: GoalStore;
  leases: LeaseStore;
  queue: ReviewQueue;
  ops: OperationLedger;
  clock: { now: string };
  now: () => string;
  advance: (ms: number) => string;
  controller: GoalController;
  registry: () => CardRegistry;
  card: (id: string) => Card;
  runner: (shipPath?: ShipPath) => CardRunner;
  journal: (goalId: string) => Journal;
  events: (goalId: string) => JournalEvent[];
  goal: (goalId: string) => Goal;
  cleanup: () => void;
}

export function makeFixture(options: { config?: Record<string, unknown>; actor?: ActorIdentity } = {}): Fixture {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'aidlc-scn-'));
  const cardsDir = path.join(tmp, 'specs', 'tasks');
  mkdirSync(cardsDir, { recursive: true });
  const paths = ensureStatePaths(statePathsFromRoot(path.join(tmp, '.aidlc')));
  const repo: RepoIdentity = { mainRoot: tmp, worktreeRoot: tmp, isGit: false, key: shortKey(tmp) };
  const config = ProjectConfig.parse({ cardsDir: 'specs/tasks', shipPath: 'dry-run', worktreeRoot: path.join(tmp, 'wt'), base: 'main', mode: 'remote', ...(options.config ?? {}) });
  const clock = { now: T0 };
  const now = () => clock.now;
  setActorForTests(options.actor ?? actorA);
  const store = new GoalStore(paths);
  const leases = new LeaseStore(paths.leases);
  const queue = new ReviewQueue(paths.reviewQueue);
  const ops = new OperationLedger(paths.operations);
  const registry = () => loadCardRegistry(cardsDir);
  const controller = new GoalController({ paths, repo, config, store, leases, queue, ops, now, cards: registry });
  const fx: Fixture = {
    tmp,
    cardsDir,
    paths,
    repo,
    config,
    store,
    leases,
    queue,
    ops,
    clock,
    now,
    advance: (ms: number) => {
      clock.now = addMs(clock.now, ms);
      return clock.now;
    },
    controller,
    registry,
    card: (id: string) => {
      const hit = registry().cards.find((c) => c.card.id === id);
      if (!hit) throw new Error(`card ${id} not in fixture registry`);
      return hit.card;
    },
    runner: (shipPath?: ShipPath) => new CardRunner({ paths, repo, config, store, leases, queue, ops, shipPath: shipPath ?? new DryRunShipPath(['merged']), now }),
    journal: (goalId: string) => Journal.forGoal(paths.journal, goalId),
    events: (goalId: string) => Journal.forGoal(paths.journal, goalId).readAll(),
    goal: (goalId: string) => controller.mustGoal(goalId),
    cleanup: () => {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* windows may hold handles briefly */
      }
    },
  };
  return fx;
}

export interface CardSpec extends Omit<NewCardInput, 'allowPaths' | 'dodCommand' | 'acceptance' | 'deliverable'> {
  allowPaths?: string[];
  dodCommand?: string;
  acceptance?: string[];
  deliverable?: string;
  tier?: 'S' | '1' | '0';
  /** The registry status the card file records; `merged` stands for a card closed under an earlier goal. */
  status?: 'todo' | 'in-progress' | 'in-review' | 'merged';
}

/** Write a card file into the fixture registry. */
export function writeCard(fx: Fixture, spec: CardSpec): string {
  const text = renderCard({
    ...spec,
    allowPaths: spec.allowPaths ?? [`src/${spec.id.toLowerCase()}.ts`],
    dodCommand: spec.dodCommand ?? `node --test tests/${spec.id.toLowerCase()}.test.ts`,
    acceptance: spec.acceptance ?? [`1. ${spec.title} holds. [dod arm 1]`],
    deliverable: spec.deliverable ?? spec.title,
    worktreeRoot: fx.config.worktreeRoot,
  });
  const withTier = spec.tier ? text.replace('dod_exit: 0\n', `dod_exit: 0\ntier: ${spec.tier}\n`) : text;
  const withStatus = spec.status ? withTier.replace(/^status: .*$/m, `status: ${spec.status}`) : withTier;
  const file = path.join(fx.cardsDir, `${spec.id}.md`);
  writeFileSync(file, withStatus, 'utf8');
  return file;
}

export function candidateShaFor(cardId: string): string {
  return `sha-${cardId.toLowerCase()}`;
}

/** Drive one card PREPARE -> BUILD -> SHIP (dry-run merged) -> CLOSE -> DONE. */
export function driveCardToDone(fx: Fixture, goalId: string, cardId: string, shipPath?: ShipPath): CardRun {
  const runner = fx.runner(shipPath);
  const goal = fx.goal(goalId);
  const card = fx.card(cardId);
  const run0 = fx.controller.ensureCardRun(goal, cardId);
  let r = runner.next(goal, card, run0);
  assert.equal(r.directive.kind, 'prepare', `${cardId}: expected prepare, got ${r.directive.kind}: ${r.directive.narration}`);
  r = runner.next(goal, card, r.run);
  assert.equal(r.directive.kind, 'build', `${cardId}: expected build, got ${r.directive.kind}`);
  const run1 = runner.recordAttempt(goal, card, r.run, { outcome: 'success', dodReceipt: `dod:${cardId}`, redReceipt: `red:${cardId}`, candidateSha: candidateShaFor(cardId) });
  r = runner.next(goal, card, run1);
  assert.equal(r.directive.kind, 'close', `${cardId}: expected close after merged ship, got ${r.directive.kind}: ${r.directive.narration}`);
  const run2 = runner.markClosure(goal, card, r.run, { metadata: true, docSync: true, findings: true, evidence: true, cleanup: true, lessons: true }, { skipped: 'fixture: no rule learned' });
  r = runner.next(goal, card, run2);
  assert.equal(r.directive.kind, 'done', `${cardId}: expected done, got ${r.directive.kind}`);
  return r.run;
}

/** Create a goal for explicit cards and move it to RUN through plan-produced + cards-projected. */
export function goalForCards(fx: Fixture, cards: string[], options: { text?: string; size?: 'T0-bugfix' | 'T0' | 'T1' | 'T2'; target?: 'development' | 'package' | 'staging' | 'production' | 'migration' | 'operations' } = {}): Goal {
  const single = cards.length === 1;
  const goal = fx.controller.createGoal(
    { text: options.text ?? (single ? `implement ${cards[0]}` : 'build the hello feature'), source: single ? 'card' : 'natural-language', ref: single ? cards[0] : undefined, affectedSurfaces: [], explicitSize: options.size, explicitTarget: options.target },
    { cards },
  );
  if (!(goal.routing.size === 'T0' || goal.routing.size === 'T0-bugfix')) {
    fx.controller.report({ goalId: goal.id, generation: goal.generation, result: 'plan-produced', data: { planRef: 'plans/hello.md' } });
  }
  fx.controller.report({ goalId: goal.id, generation: goal.generation, result: 'cards-projected', data: { cards } });
  return fx.goal(goal.id);
}

/** A dry-run ship path that injects text into the receipt stdout (for CI classification). */
export class InjectedShipPath extends DryRunShipPath {
  private readonly stdoutText: string;
  constructor(outcomes: ShipOutcomeClass[], stdoutText: string, verdict?: Verdict) {
    super(outcomes, verdict);
    this.stdoutText = stdoutText;
  }
  override ship(req: ShipRequest): ShipResult {
    const r = super.ship(req);
    r.receipt.stdout = `${r.receipt.stdout}\n${this.stdoutText}`;
    return r;
  }
}

/** Delivery operation bindings for release scenarios (sync deploy by default). */
export function opsConfigured(options: { asyncDeploy?: boolean } = {}): OpsLoad {
  const config = DeliveryOpsConfig.parse({
    schemaVersion: 1,
    environments: { staging: { production: false }, production: { production: true } },
    operations: [
      { role: 'deploy', command: ['deploy-cmd'], targetSelection: 'arg', async: options.asyncDeploy ?? false, operationIdPattern: 'id=(\\w+)', statusLookup: ['status-cmd', '{id}'], successPattern: options.asyncDeploy ? 'succeeded' : 'ok', failurePattern: 'FAILED' },
      { role: 'status', command: ['status-cmd'] },
      { role: 'environment', command: ['env-cmd'] },
      { role: 'health', command: ['health-cmd'] },
      { role: 'recover', command: ['recover-cmd'], targetSelection: 'arg', successPattern: 'ok' },
    ],
  });
  return { status: 'configured', config, file: 'memory' };
}

export const opsNotConfigured: OpsLoad = { status: 'not-configured', file: 'none' };

export const opsRunner = scriptedRunner({
  'deploy-cmd': { stdout: 'ok id=dep1', exitCode: 0 },
  'status-cmd': { stdout: 'succeeded', exitCode: 0 },
  'recover-cmd': { stdout: 'ok', exitCode: 0 },
});
