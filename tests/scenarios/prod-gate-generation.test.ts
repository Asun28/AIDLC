import assert from 'node:assert/strict';
import { after, before, describe, test, type TestContext } from 'node:test';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { cleanup, makeGoal, tmpDir } from '../infra/helpers.ts';
import { makeFixture, writeCard, type Fixture } from './_harness.ts';
import { DEFAULT_HOOK_CONFIG, productionGate, runHook, type HookEvent, type HookResult } from '../../src/hooks/index.ts';
import { dispatchHook } from '../../src/hooks/entry.ts';
import { AuthorizationRecord, type Goal, type GoalState } from '../../src/core/types.ts';
import { GoalStore } from '../../src/state/goal-store.ts';
import { resolveStatePaths } from '../../src/state/paths.ts';
import { setActorForTests } from '../../src/state/journal.ts';

/** The production record of acceptance 1 without `goalGeneration`. */
const BASE = { id: 'rel-1', kind: 'production', grantedBy: 'release manager', grantedAt: '2026-09-11T10:00:00.000Z', environment: 'production', candidateDigest: 'sha256:c1', operations: ['deploy'] };
const record = (over: Record<string, unknown> = { goalGeneration: 0 }): AuthorizationRecord => AuthorizationRecord.parse({ ...BASE, ...over });
const refText = (ref: string) => `${JSON.stringify(ref)} does not match any recorded production authorization`;
const STOPPED = { reason: 'cancelled', detail: 'cancelled by user', nextAction: 'none', global: true, at: '2026-09-11T10:00:00.000Z' } as const;
const NOW = '2026-09-11T10:00:00.000Z';
const PASS1 = 'deploy production';
const PASS2 = 'cat notes & make deploy production';

/**
 * The hook's config discovery asks git with `process.env`, not with the hook's `env`: before each gate or hook call every
 * `GIT_*` variable is removed (the caller's first value kept) and `GIT_CEILING_DIRECTORIES` is set to the parents of the
 * fixture directory in both forms. `restoreGit` (the inner suite's `after` hook) first deletes the names that were absent,
 * then sets each saved value under its own spelling, since Windows reads environment names without regard to case.
 */
const absentGit = new Set<string>();
const savedGit = new Map<string, string>();
function remember(key: string): void {
  if (absentGit.has(key) || savedGit.has(key)) return;
  const value = process.env[key];
  if (value === undefined) absentGit.add(key);
  else savedGit.set(key, value);
}
function isolateGit(dir: string): void {
  for (const key of Object.keys(process.env)) {
    if (!key.toUpperCase().startsWith('GIT_')) continue;
    remember(key);
    delete process.env[key];
  }
  remember('GIT_CEILING_DIRECTORIES');
  process.env['GIT_CEILING_DIRECTORIES'] = [...new Set([path.dirname(dir), path.dirname(realpathSync.native(dir))])].join(path.delimiter);
}
function restoreGit(): void {
  for (const key of absentGit) delete process.env[key];
  for (const [key, value] of savedGit) process.env[key] = value;
}
const dispatch = (dir: string, ev: HookEvent, env: NodeJS.ProcessEnv): HookResult => {
  isolateGit(dir);
  return dispatchHook(ev, { cwd: dir, env, now: NOW });
};
const hook = (dir: string, ev: HookEvent, env: NodeJS.ProcessEnv, classic?: boolean): HookResult => {
  isolateGit(dir);
  return runHook('production-gate', ev, classic ? { cwd: dir, env, classic } : { cwd: dir, env });
};

/** A state directory under a `tmpDir` directory holding the goals, removed after the test. */
function seed(t: TestContext, goals: Goal[], prefix = 'aidlc-pgg-'): { dir: string; env: NodeJS.ProcessEnv } {
  const dir = tmpDir(prefix);
  t.after(() => cleanup(dir));
  const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'], AIDLC_STATE_DIR: path.join(dir, 'state'), AIDLC_SESSION: 'pgg-session' };
  const store = new GoalStore(resolveStatePaths(dir, env));
  for (const goal of goals) store.saveGoal(goal);
  return { dir, env };
}

const event = (command = PASS1, tool = 'Bash'): HookEvent => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command } });
function gate(dir: string, env: NodeJS.ProcessEnv, ref: string, command = PASS1, tool = 'Bash'): HookResult {
  isolateGit(dir);
  return productionGate(event(command, tool), { PATH: env['PATH'], AIDLC_STATE_DIR: env['AIDLC_STATE_DIR'], RELEASE_APPROVAL: ref }, DEFAULT_HOOK_CONFIG, dir);
}
function assertRefused(r: HookResult, ref: string, label: string): void {
  assert.equal(r.exitCode, 2, label);
  assert.equal(r.stdout, undefined, label);
  assert.ok(r.stderr?.includes(refText(ref)), `${label}: ${r.stderr}`);
}
function frozenDenial(r: HookResult, label: string): void {
  assert.equal(r.exitCode, 0, label);
  const out = JSON.parse(r.stdout ?? '{}') as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
  assert.equal(out.hookSpecificOutput?.permissionDecision, 'deny', label);
  assert.ok(out.hookSpecificOutput?.permissionDecisionReason?.startsWith('FROZEN'), label);
}

/** Every `GIT_CEILING_DIRECTORIES` of the real caller, in any letter case: the restore row replaces them with its own. */
const realCeiling = new Map<string, string>();
const ceilingNames = () => Object.keys(process.env).filter((k) => k.toUpperCase() === 'GIT_CEILING_DIRECTORIES');

describe('production gate generation', () => {
  before(() => {
    for (const key of ceilingNames()) {
      realCeiling.set(key, process.env[key]!);
      delete process.env[key];
    }
    process.env['Git_Ceiling_Directories'] = 'caller-sentinel';
  });
  after(() => {
    for (const key of ceilingNames()) delete process.env[key];
    for (const [key, value] of realCeiling) process.env[key] = value;
  });

  describe('acceptance', () => {
    after(restoreGit);

    test('production-gate reads no authorization of a goal that is terminal, DONE or STOP', (t) => {
      for (const state of ['PLAN', 'CARDS', 'RUN', 'WAIT', 'VERIFY_ARC', 'DELIVER', 'CLOSE'] as GoalState[]) {
        const { dir, env } = seed(t, [makeGoal('g1', { state, terminal: false, authorizations: [record()] })]);
        assert.deepEqual(gate(dir, env, 'rel-1'), { exitCode: 0 }, state);
      }
      const refused: Array<[string, Partial<Goal>]> = [
        ['DONE terminal', { state: 'DONE', terminal: true }],
        ['STOP terminal cancelled', { state: 'STOP', terminal: true, stop: { ...STOPPED, unresolvedOperations: [] } }],
        ['STOP not terminal', { state: 'STOP', terminal: false }],
        ['DONE not terminal', { state: 'DONE', terminal: false }],
        ['RUN terminal', { state: 'RUN', terminal: true }],
      ];
      for (const [label, over] of refused) {
        const { dir, env } = seed(t, [makeGoal('g1', { ...over, authorizations: [record()] })]);
        assertRefused(gate(dir, env, 'rel-1'), 'rel-1', label);
      }
      // A skipped goal (listed first, created a minute later) does not end the search.
      const done = makeGoal('g-done', { state: 'DONE', terminal: true, createdAt: '2026-09-11T10:01:00.000Z', authorizations: [record({ id: 'rel-done', ref: 'CHG-1', goalGeneration: 0 })] });
      const run = makeGoal('g-run', { state: 'RUN', authorizations: [record({ id: 'rel-run', ref: 'CHG-1', goalGeneration: 0 })] });
      const { dir, env } = seed(t, [run, done]);
      assert.deepEqual(new GoalStore(resolveStatePaths(dir, env)).listGoals().map((g) => g.id), ['g-done', 'g-run']);
      assert.deepEqual(gate(dir, env, 'CHG-1'), { exitCode: 0 }, 'two goals');
    });

    test("production-gate keeps main's first match and counts it only in the goal's current generation", (t) => {
      const rows: Array<[number, number | undefined, number]> = [
        [0, undefined, 0],
        [0, 0, 0],
        [0, 1, 2],
        [1, undefined, 2],
        [1, 0, 2],
        [1, 1, 0],
        [2, 1, 2],
        [2, 2, 0],
      ];
      for (const [generation, recorded, expected] of rows) {
        const { dir, env } = seed(t, [makeGoal('g1', { generation, authorizations: [record(recorded === undefined ? {} : { goalGeneration: recorded })] })]);
        const r = gate(dir, env, 'rel-1');
        assert.equal(r.exitCode, expected, `goal generation ${generation}, record ${String(recorded)}`);
        if (expected === 2) assert.ok(r.stderr?.includes(refText('rel-1')));
      }
      // Cross generation: the match is main's first record over all records; the generation only decides whether it counts.
      const sel = seed(t, [makeGoal('g1', { generation: 1, authorizations: [record({ id: 'rel-old', ref: 'CHG-1', goalGeneration: 0 }), record({ id: 'rel-new', ref: 'CHG-1', goalGeneration: 1 })] })]);
      assertRefused(gate(sel.dir, sel.env, 'CHG-1'), 'CHG-1', 'CHG-1 matches rel-old first');
      assert.deepEqual(gate(sel.dir, sel.env, 'rel-new'), { exitCode: 0 }, 'rel-new');
      assertRefused(gate(sel.dir, sel.env, 'rel-old'), 'rel-old', 'rel-old');
      const pins: Array<[string, AuthorizationRecord]> = [
        ['development of generation 0 first', record({ id: 'dev-0', kind: 'development', ref: 'CHG-1', goalGeneration: 0 })],
        ['expired production of generation 0 first', record({ id: 'old-0', ref: 'CHG-1', goalGeneration: 0, expiresAt: '2000-01-01T00:00:00.000Z' })],
      ];
      for (const [label, earlier] of pins) {
        const { dir, env } = seed(t, [makeGoal('g1', { generation: 1, authorizations: [earlier, record({ id: 'live-1', ref: 'CHG-1', goalGeneration: 1 })] })]);
        assertRefused(gate(dir, env, 'CHG-1'), 'CHG-1', label);
      }
      // First match within one goal and one generation decides.
      const dev = record({ id: 'dev-1', kind: 'development', ref: 'CHG-2', goalGeneration: 0 });
      const prod = record({ id: 'prod-1', ref: 'CHG-2', goalGeneration: 0 });
      const first: Array<[string, AuthorizationRecord[], number]> = [
        ['development first', [dev, prod], 2],
        ['production first', [prod, dev], 0],
        ['expired first', [record({ id: 'old-1', ref: 'CHG-2', goalGeneration: 0, expiresAt: '2000-01-01T00:00:00.000Z' }), record({ id: 'live-1', ref: 'CHG-2', goalGeneration: 0, expiresAt: '2999-01-01T00:00:00.000Z' })], 2],
      ];
      for (const [label, authorizations, expected] of first) {
        const { dir, env } = seed(t, [makeGoal('g1', { authorizations })]);
        assert.equal(gate(dir, env, 'CHG-2').exitCode, expected, label);
      }
      // Any goal: the second goal's first match is authorized.
      const a = makeGoal('g-a', { createdAt: '2026-09-11T10:01:00.000Z', authorizations: [dev, prod] });
      const b = makeGoal('g-b', { authorizations: [prod, dev] });
      const any = seed(t, [a, b]);
      assert.deepEqual(new GoalStore(resolveStatePaths(any.dir, any.env)).listGoals().map((g) => g.id), ['g-a', 'g-b']);
      assert.deepEqual(gate(any.dir, any.env, 'CHG-2'), { exitCode: 0 }, 'any goal');
      // The search goes on after a goal whose matched record is of another generation.
      const later = makeGoal('g-later', { generation: 1, createdAt: '2026-09-11T10:01:00.000Z', authorizations: [record({ id: 'rel-a', ref: 'X', goalGeneration: 0 })] });
      const granting = makeGoal('g-grant', { authorizations: [record({ id: 'rel-b', ref: 'X', goalGeneration: 0 })] });
      const on = seed(t, [later, granting]);
      assert.deepEqual(new GoalStore(resolveStatePaths(on.dir, on.env)).listGoals().map((g) => g.id), ['g-later', 'g-grant']);
      assert.deepEqual(gate(on.dir, on.env, 'X'), { exitCode: 0 }, 'search continues');
      // The first record in stored order matches, by id or by ref.
      const order = seed(t, [makeGoal('g1', { authorizations: [record({ id: 'dev-1', kind: 'development', ref: 'X', goalGeneration: 0 }), record({ id: 'X', goalGeneration: 0 })] })]);
      assertRefused(gate(order.dir, order.env, 'X'), 'X', 'stored order');
    });

    /** The two refused goals of acceptance 3 with their controls. */
    const REFUSED_CASES = (): Array<[string, Goal, Goal]> => [
      ['finished', makeGoal('g1', { state: 'DONE', terminal: true, authorizations: [record()] }), makeGoal('g1', { state: 'RUN', authorizations: [record()] })],
      ['superseded generation', makeGoal('g1', { generation: 1, authorizations: [record()] }), makeGoal('g1', { generation: 1, authorizations: [record({ goalGeneration: 1 })] })],
    ];

    function configDenial(r: HookResult, label: string): string {
      const out = JSON.parse(r.stdout ?? '{}') as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
      assert.equal(out.hookSpecificOutput?.permissionDecision, 'deny', label);
      const reason = out.hookSpecificOutput?.permissionDecisionReason ?? '';
      assert.ok(reason.startsWith('Bash is denied while '), `${label}: ${reason}`);
      return reason;
    }

    test('both dispatch passes and the legacy decision deny a refused record alike', (t) => {
      for (const [label, refusedGoal, controlGoal] of REFUSED_CASES()) {
        for (const [kind, goal] of [['refused', refusedGoal], ['control', controlGoal]] as const) {
          const { dir, env } = seed(t, [goal]);
          const withRef = { ...env, RELEASE_APPROVAL: 'rel-1' };
          for (const tool of ['Bash', 'PowerShell']) {
            for (const command of [PASS1, PASS2]) {
              const name = `${label} ${kind} ${tool} ${command}`;
              const r = dispatch(dir, event(command, tool), withRef);
              if (kind === 'refused') {
                assertRefused(r, 'rel-1', name);
                isolateGit(dir);
                assert.deepEqual(r, productionGate(event(command, tool), withRef, DEFAULT_HOOK_CONFIG, dir), name);
              } else assert.equal(r.exitCode, 0, name);
            }
            const classic1 = hook(dir, event(PASS1, tool), withRef, true);
            const classic2 = hook(dir, event(PASS2, tool), withRef, true);
            const second1 = hook(dir, event(PASS1, tool), withRef);
            const second2 = hook(dir, event(PASS2, tool), withRef);
            if (kind === 'refused') {
              assertRefused(classic1, 'rel-1', `${label} classic pass1 ${tool}`);
              assert.deepEqual(classic2, { exitCode: 0 }, `${label} classic pass2 ${tool}`);
              assertRefused(second1, 'rel-1', `${label} second pass1 ${tool}`);
              assertRefused(second2, 'rel-1', `${label} second pass2 ${tool}`);
            } else {
              for (const r of [classic1, classic2, second1, second2]) assert.equal(r.exitCode, 0, `${label} control ${tool}`);
            }
          }
          writeFileSync(path.join(dir, 'aidlc.config.json'), '{ not json');
          const legacy = hook(dir, event(PASS1, 'Bash'), withRef);
          if (kind === 'refused') assertRefused(legacy, 'rel-1', `${label} legacy`);
          else configDenial(legacy, `${label} control legacy`);
        }
      }
      // Git context: a caller's GIT_DIR and GIT_WORK_TREE naming another repository do not redirect the config discovery.
      const { dir, env } = seed(t, [REFUSED_CASES()[0]![2]], 'aidlc-pgg-git-');
      writeFileSync(path.join(dir, 'aidlc.config.json'), '{ not json');
      const other = path.join(dir, 'other');
      mkdirSync(other);
      isolateGit(dir);
      const gitEnv: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(dir, 'empty.gitconfig') };
      for (const key of Object.keys(gitEnv)) if (key.toUpperCase() === 'NODE_OPTIONS') delete gitEnv[key];
      writeFileSync(path.join(dir, 'empty.gitconfig'), '');
      assert.equal(spawnSync('git', ['init', '-q', other], { env: gitEnv, encoding: 'utf8' }).status, 0, 'git init');
      writeFileSync(path.join(other, 'aidlc.config.json'), '{}');
      remember('GIT_DIR');
      remember('GIT_WORK_TREE');
      process.env['GIT_DIR'] = path.join(other, '.git');
      process.env['GIT_WORK_TREE'] = other;
      const reason = configDenial(hook(dir, event(PASS1, 'Bash'), { ...env, RELEASE_APPROVAL: 'rel-1' }), 'git context control');
      assert.ok(reason.includes(`${path.basename(dir)}${JSON.stringify(path.sep).slice(1, -1)}aidlc.config.json`), reason);
      assert.ok(!reason.includes(`other${JSON.stringify(path.sep).slice(1, -1)}aidlc.config.json`), reason);
    });

    test('a refused record is denied by the gate in the first pass ahead of a frozen-path denial; an admitted one leaves that denial', (t) => {
      const [finished, superseded] = REFUSED_CASES();
      const control = finished![2];
      const badGoal = (dir: string) => {
        const bad = JSON.parse(JSON.stringify(makeGoal('g-bad', { authorizations: [record({ id: 'rel-bad', goalGeneration: 0 })] }))) as { authorizations: Array<Record<string, unknown>> };
        bad.authorizations[0]!['goalGeneration'] = -1;
        writeFileSync(path.join(dir, 'state', 'goals', 'g-bad.json'), JSON.stringify(bad));
      };
      const cases: Array<[string, Goal, boolean, boolean]> = [
        ['finished', finished![1], true, true],
        ['superseded generation', superseded![1], true, true],
        ['control', control, false, true],
        ['higher generation', makeGoal('g1', { authorizations: [record({ goalGeneration: 1 })] }), true, false],
        ['goal file failing the schema', control, true, false],
      ];
      for (const [label, goal, refused, secondPassRow] of cases) {
        const { dir, env } = seed(t, [goal]);
        if (label === 'goal file failing the schema') badGoal(dir);
        writeFileSync(path.join(dir, 'aidlc.config.json'), JSON.stringify({ hooks: { frozenPaths: ['contracts/'] } }));
        const withRef = { ...env, RELEASE_APPROVAL: 'rel-1' };
        const first = dispatch(dir, event(`${PASS1} > contracts/log.txt`, 'Bash'), withRef);
        if (refused) assertRefused(first, 'rel-1', label);
        else frozenDenial(first, label);
        if (secondPassRow) frozenDenial(dispatch(dir, event(`${PASS2} > contracts/log.txt`, 'Bash'), withRef), `${label} second-pass phrase`);
      }
      // Under an unusable config the refused approval replaces the gate's own config denial in the first pass.
      for (const [label, goal, refused] of [['finished', finished![1], true], ['control', control, false]] as const) {
        const { dir, env } = seed(t, [goal]);
        writeFileSync(path.join(dir, 'aidlc.config.json'), '{ not json');
        const withRef = { ...env, RELEASE_APPROVAL: 'rel-1' };
        const first = dispatch(dir, event(PASS1, 'Bash'), withRef);
        if (refused) assertRefused(first, 'rel-1', `${label} broken config`);
        else assert.equal(first.exitCode, 0, `${label} broken config`);
        if (!refused) assert.ok(configDenial(first, `${label} broken config`).includes('since the production-gate guard cannot read hooks.productionPatterns from it'));
        const second = dispatch(dir, event(PASS2, 'Bash'), withRef);
        assert.equal(second.exitCode, 0, `${label} broken config second-pass phrase`);
        assert.ok(configDenial(second, `${label} broken config second-pass phrase`).includes('since the production-gate guard cannot read hooks.productionPatterns from it'));
      }
    });

    test('goalGeneration is absent or a non-negative integer; any other value fails the goal schema and the gate denies', (t) => {
      const absent = AuthorizationRecord.safeParse(BASE);
      assert.ok(absent.success);
      assert.ok(!('goalGeneration' in absent.data));
      for (const value of [0, 1, 7]) {
        const r = AuthorizationRecord.safeParse({ ...BASE, goalGeneration: value });
        assert.ok(r.success, String(value));
        assert.equal(r.data.goalGeneration, value);
      }
      const refusedValues: unknown[] = [-1, 1.5, '1', null, true];
      for (const value of refusedValues) {
        const r = AuthorizationRecord.safeParse({ ...BASE, goalGeneration: value });
        assert.ok(!r.success, JSON.stringify(value));
        assert.ok(r.error.issues.some((i) => JSON.stringify(i.path) === '["goalGeneration"]'), JSON.stringify(value));
      }
      const ok = () => makeGoal('g-ok', { authorizations: [record({ id: 'rel-2', goalGeneration: 0 })] });
      for (const value of refusedValues) {
        for (const over of [{ state: 'RUN' }, { state: 'DONE', terminal: true }] as Array<Partial<Goal>>) {
          const { dir, env } = seed(t, [ok()]);
          const bad = JSON.parse(JSON.stringify(makeGoal('g-bad', { ...over, authorizations: [record({ id: 'rel-bad', goalGeneration: 0 })] }))) as { authorizations: Array<Record<string, unknown>> };
          bad.authorizations[0]!['goalGeneration'] = value;
          writeFileSync(path.join(dir, 'state', 'goals', 'g-bad.json'), JSON.stringify(bad));
          assertRefused(gate(dir, env, 'rel-2'), 'rel-2', `${JSON.stringify(value)} ${over.state}`);
        }
      }
      const control = seed(t, [ok()]);
      assert.deepEqual(gate(control.dir, control.env, 'rel-2'), { exitCode: 0 }, 'no g-bad.json');
    });

    function fixture(t: TestContext): Fixture {
      // `makeFixture` caches the harness actor; the reset is registered first, so it runs whatever happens after.
      t.after(() => setActorForTests(undefined));
      const fx = makeFixture();
      t.after(() => cleanup(fx.tmp));
      writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
      return fx;
    }
    const PROD_DATA = { kind: 'production', environment: 'production', candidateDigest: 'sha256:c1', operations: ['deploy'], by: 'release manager' };
    const stamps = (goal: Goal) => goal.authorizations.map((a) => [a.kind, a.goalGeneration]);

    test('every authorization the controller newly records stores the goal generation, whatever its kind', (t) => {
      const fx = fixture(t);
      const { id } = fx.controller.createGoal({ text: 'implement T1-A', source: 'card', ref: 'T1-A', affectedSurfaces: [], explicitTarget: 'staging' }, { cards: ['T1-A'] });
      const read = () => new GoalStore(fx.paths).getGoal(id)!;
      assert.deepEqual(stamps(read()), [['development', 0], ['staging', 0]]);
      fx.controller.report({ goalId: id, generation: 0, result: 'approved', data: PROD_DATA });
      assert.deepEqual(stamps(read()).at(-1), ['production', 0]);
      fx.controller.report({ goalId: id, generation: 0, result: 'cancel', data: {} });
      fx.controller.report({ goalId: id, generation: 0, result: 'resume', data: { reason: 'again' } });
      assert.equal(read().generation, 1);
      for (const kind of ['development', 'plan-checkpoint', 'staging', 'production', 'recovery', undefined]) {
        const data: Record<string, unknown> = { ...PROD_DATA, goalGeneration: 0 };
        if (kind === undefined) delete data['kind'];
        else data['kind'] = kind;
        fx.controller.report({ goalId: id, generation: 1, result: 'approved', data });
      }
      const all = stamps(read());
      assert.equal(all.length, 9);
      assert.deepEqual(all.slice(0, 3).map((s) => s[1]), [0, 0, 0]);
      assert.deepEqual(all.slice(3).map((s) => s[1]), [1, 1, 1, 1, 1, 1]);
      assert.deepEqual(all.slice(3).map((s) => s[0]).slice(0, 5), ['development', 'plan-checkpoint', 'staging', 'production', 'recovery']);
    });

    /** The gate on a fixture's state directory, as acceptance 7 calls it. */
    const gateOn = (fx: Fixture) => (ref: string) => {
      isolateGit(fx.tmp);
      return productionGate(event(), { PATH: process.env['PATH'], AIDLC_STATE_DIR: fx.paths.root, RELEASE_APPROVAL: ref }, DEFAULT_HOOK_CONFIG, fx.tmp).exitCode;
    };

    test('the gate follows cancel, resume, authorize and extend', (t) => {
      const fx = fixture(t);
      const at = gateOn(fx);
      const { id } = fx.controller.createGoal({ text: 'implement T1-A', source: 'card', ref: 'T1-A', affectedSurfaces: [], explicitTarget: 'staging' }, { cards: ['T1-A'] });
      const old = fx.controller.report({ goalId: id, generation: 0, result: 'approved', data: PROD_DATA }).goal.authorizations.at(-1)!.id;
      assert.equal(at(old), 0, 'approved');
      fx.controller.report({ goalId: id, generation: 0, result: 'cancel', data: {} });
      assert.equal(at(old), 2, 'cancelled');
      const resumed = fx.controller.report({ goalId: id, generation: 0, result: 'resume', data: { reason: 'again' } }).goal;
      assert.equal(resumed.generation, 1);
      assert.equal(resumed.state, 'WAIT');
      assert.equal(at(old), 2, 'resumed');
      const fresh = fx.controller.report({ goalId: id, generation: 1, result: 'approved', data: PROD_DATA }).goal.authorizations.at(-1)!.id;
      assert.equal(at(fresh), 0, 'new generation record');
      assert.equal(at(old), 2, 'old record after new approval');

      const fx2 = fixture(t);
      const at2 = gateOn(fx2);
      const g2 = fx2.controller.createGoal({ text: 'implement T1-A', source: 'card', ref: 'T1-A', affectedSurfaces: [] }, { cards: ['T1-A'] });
      const rel = fx2.controller.report({ goalId: g2.id, generation: 0, result: 'approved', data: PROD_DATA }).goal.authorizations.at(-1)!.id;
      fx2.advance(4 * 60 * 60 * 1000);
      const d = fx2.controller.next(g2.id);
      assert.equal(d.kind, 'stop');
      if (d.kind === 'stop') assert.equal(d.stop.reason, 'time');
      assert.equal(at2(rel), 2, 'stopped for time');
      const extended = fx2.controller.extendDeadline(g2.id, 'lead', '2026-09-11T20:00:00.000Z', 'more time');
      assert.equal(extended.state, 'CARDS');
      assert.equal(extended.terminal, false);
      assert.equal(extended.generation, 0);
      assert.equal(at2(rel), 0, 'extended');

      // Re-authorization after a resume: a reference an earlier record uses keeps matching that record.
      const fx3 = fixture(t);
      const at3 = gateOn(fx3);
      const g3 = fx3.controller.createGoal({ text: 'implement T1-A', source: 'card', ref: 'T1-A', affectedSurfaces: [], explicitTarget: 'staging' }, { cards: ['T1-A'] });
      fx3.controller.report({ goalId: g3.id, generation: 0, result: 'approved', data: { ...PROD_DATA, ref: 'CHG-9' } });
      assert.equal(at3('CHG-9'), 0, 'CHG-9 at generation 0');
      fx3.controller.report({ goalId: g3.id, generation: 0, result: 'cancel', data: {} });
      fx3.controller.report({ goalId: g3.id, generation: 0, result: 'resume', data: { reason: 'again' } });
      const again = fx3.controller.report({ goalId: g3.id, generation: 1, result: 'approved', data: { ...PROD_DATA, ref: 'CHG-9' } }).goal.authorizations.at(-1)!.id;
      assert.equal(at3('CHG-9'), 2, 'CHG-9 still matches the generation-0 record');
      assert.ok(again.startsWith(`auth-production-${g3.id}-r0-`), again);
      assert.equal(at3(again), 0, 'the new record by its id');
      fx3.controller.report({ goalId: g3.id, generation: 1, result: 'approved', data: { ...PROD_DATA, ref: 'CHG-10' } });
      assert.equal(at3('CHG-10'), 0, 'a new ref');
    });

    test('the approval precedence and the no-goals admission are unchanged', (t) => {
      const { dir, env } = seed(t, [makeGoal('g1', { authorizations: [record()] })]);
      const run = (vars: Record<string, string>) => {
        isolateGit(dir);
        return productionGate(event(), { PATH: env['PATH'], AIDLC_STATE_DIR: env['AIDLC_STATE_DIR'], ...vars }, DEFAULT_HOOK_CONFIG, dir);
      };
      assert.deepEqual(run({ RELEASE_APPROVAL: 'rel-1', AIDLC_RELEASE_APPROVAL: 'other' }), { exitCode: 0 });
      assert.equal(run({ RELEASE_APPROVAL: 'other', AIDLC_RELEASE_APPROVAL: 'rel-1' }).exitCode, 2);
      const empty = seed(t, []);
      assert.deepEqual(gate(empty.dir, empty.env, 'anything'), { exitCode: 0 });
    });
  });

  test("the inner suite's after hook restores the caller's Git variables under their own spelling", () => {
    assert.equal(process.env['Git_Ceiling_Directories'], 'caller-sentinel');
    assert.deepEqual(ceilingNames(), ['Git_Ceiling_Directories']);
  });
});
