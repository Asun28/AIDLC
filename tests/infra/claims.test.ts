import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatWorkingTree, planningClaims, uncommittedPlanningFiles, workingTreeReport, type PlanningDirs, type WorkingTreeInputs } from '../../src/state/claims.ts';
import type { Lease } from '../../src/core/types.ts';
import { makeGoal, iso } from './helpers.ts';

const dirs: PlanningDirs = { intentDir: 'intent', specsDir: 'specs', plansDir: 'plans', cardsDir: 'specs/tasks' };

const PLAN = `---
title: review coverage
---
# Plan

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | Depends on | Window | Freeze |
|---|---|---|---|---|---|
| T1-REVIEW-INVARIANTS | MUST | lessons checklist | - | A | no |
| T1-REVIEW-COVERAGE | MUST | ac-coverage angle | T1-REVIEW-INVARIANTS | B | no |
`;

function lease(goalId: string, overrides: Partial<Lease> = {}): Lease {
  return { resourceKey: `goal:repo:${goalId}`, generation: 0, owner: { session: 'sess-A', pid: 1, processStart: iso(), host: 'h' }, acquiredAt: iso(), heartbeatAt: iso(), expiresAt: iso(600_000), released: false, ...overrides };
}

describe('planningClaims (T0-PLANNING-CLAIMS acceptance 1)', () => {
  test('a goal with an intent claims the intent, the spec and plan of its slug, its plan reference and every card it lists or its plan names', () => {
    const goal = makeGoal('g-a', { intentRef: 'intent/review-coverage.md', planRef: 'plans/review-coverage.md', cards: ['T1-REVIEW-COVERAGE-STATS'] });
    const reads: string[] = [];
    const claims = planningClaims([goal], dirs, (ref) => {
      reads.push(ref);
      return PLAN;
    });
    assert.deepEqual(reads, ['plans/review-coverage.md'], 'the plan is read once, by the goal planRef');
    assert.deepEqual(
      [...claims.entries()].sort(),
      [
        ['intent/review-coverage.md', 'g-a'],
        ['plans/review-coverage.md', 'g-a'],
        ['specs/review-coverage.md', 'g-a'],
        ['specs/tasks/T1-REVIEW-COVERAGE-STATS.md', 'g-a'],
        ['specs/tasks/T1-REVIEW-COVERAGE.md', 'g-a'],
        ['specs/tasks/T1-REVIEW-INVARIANTS.md', 'g-a'],
      ],
    );
  });

  test('paths are forward-slash and relative whatever the record carries; a plan that cannot be read names no extra cards', () => {
    const goal = makeGoal('g-a', { intentRef: 'intent\\loop.md', planRef: 'plans\\other-slug.md', cards: ['T0-ONE'] });
    const claims = planningClaims([goal], { intentDir: 'intent', specsDir: 'specs', plansDir: 'plans', cardsDir: 'specs\\tasks' }, () => undefined);
    assert.deepEqual([...claims.keys()].sort(), ['intent/loop.md', 'plans/loop.md', 'plans/other-slug.md', 'specs/loop.md', 'specs/tasks/T0-ONE.md']);
  });

  test('a terminal goal claims nothing; a goal without an intent claims only its plan and cards', () => {
    const done = makeGoal('g-done', { intentRef: 'intent/done.md', planRef: 'plans/done.md', cards: ['T0-DONE'], terminal: true, state: 'DONE' });
    const bare = makeGoal('g-bare', { planRef: 'plans/bare.md', cards: ['T0-BARE'] });
    const none = makeGoal('g-none', { cards: ['T0-NONE'] });
    const claims = planningClaims([done, bare, none], dirs, () => undefined);
    assert.deepEqual([...claims.entries()].sort(), [
      ['plans/bare.md', 'g-bare'],
      ['specs/tasks/T0-BARE.md', 'g-bare'],
      ['specs/tasks/T0-NONE.md', 'g-none'],
    ]);
  });

  test('a path two goals claim keeps the older goal, whatever the input order', () => {
    const older = makeGoal('g-older', { intentRef: 'intent/shared.md', createdAt: iso(0) });
    const newer = makeGoal('g-newer', { intentRef: 'intent/shared.md', cards: ['T0-NEW'], createdAt: iso(60_000) });
    for (const order of [[older, newer], [newer, older]]) {
      const claims = planningClaims(order, dirs, () => undefined);
      assert.equal(claims.get('intent/shared.md'), 'g-older');
      assert.equal(claims.get('specs/shared.md'), 'g-older');
      assert.equal(claims.get('plans/shared.md'), 'g-older');
      assert.equal(claims.get('specs/tasks/T0-NEW.md'), 'g-newer');
    }
  });
});

describe('uncommittedPlanningFiles (acceptance 2)', () => {
  test('selects the untracked and modified paths under the four directories and no other path', () => {
    const status = {
      dirty: true,
      entries: [
        'M intent/first.md',
        '?? intent/review-coverage.md',
        ' M specs/review-coverage.md',
        'M  plans/review-coverage.md',
        'A  specs/tasks/T1-REVIEW-COVERAGE.md',
        'R  specs/tasks/T0-OLD.md -> specs/tasks/T0-RENAMED.md',
        '?? "intent/with space.md"',
        '?? src/state/claims.ts',
        ' M docs/OPERATIONS.md',
        '?? intents/not-the-dir.md',
        '?? plans',
      ],
      untracked: ['intent/review-coverage.md', 'src/state/claims.ts', 'intents/not-the-dir.md', 'plans'],
    };
    // `GitProbe.status` trims git's output, so a first entry modified in the worktree only arrives as
    // `M path` (its leading space gone); it is read like ` M path`
    assert.deepEqual(uncommittedPlanningFiles(status, dirs), [
      'intent/first.md',
      'intent/review-coverage.md',
      'specs/review-coverage.md',
      'plans/review-coverage.md',
      'specs/tasks/T1-REVIEW-COVERAGE.md',
      'specs/tasks/T0-RENAMED.md',
      'intent/with space.md',
    ]);
    assert.deepEqual(uncommittedPlanningFiles({ dirty: false, entries: [], untracked: [] }, dirs), []);
  });

  test('a path git C-quoted is decoded: named escapes, octal UTF-8 bytes, a quote and a backslash', () => {
    const entries = [
      '?? "intent/caf\\303\\251 plan.md"',
      '?? "intent/a\\"b\\\\c.md"',
      '?? "intent/tab\\there.md"',
      '?? "specs/tasks/T0-\\303\\244.md"',
    ];
    assert.deepEqual(uncommittedPlanningFiles({ entries }, dirs), ['intent/café plan.md', 'intent/a"b\\c.md', 'intent/tab\there.md', 'specs/tasks/T0-ä.md']);
    // a decoded path matches its claim
    const claims = new Map<string, string>([['intent/café plan.md', 'g-a']]);
    assert.deepEqual(formatWorkingTree(['intent/café plan.md'], claims, () => undefined, iso()), ['intent/café plan.md: claimed by g-a (no lease)']);
  });
});

describe('formatWorkingTree (acceptance 3)', () => {
  test('clean when nothing is uncommitted; otherwise one entry per file with its claim and lease state', () => {
    const now = iso(0);
    const claims = new Map<string, string>([
      ['intent/live.md', 'g-live'],
      ['intent/expired.md', 'g-expired'],
      ['intent/released.md', 'g-released'],
      ['intent/noleaseyet.md', 'g-none'],
    ]);
    const leases: Record<string, Lease | undefined> = {
      'g-live': lease('g-live', { owner: { session: 'sess-A', pid: 1, processStart: iso(), host: 'h' }, expiresAt: iso(600_000) }),
      'g-expired': lease('g-expired', { owner: { session: 'sess-B', pid: 2, processStart: iso(), host: 'h' }, expiresAt: iso(-1) }),
      'g-released': lease('g-released', { owner: { session: 'sess-C', pid: 3, processStart: iso(), host: 'h' }, released: true }),
      'g-none': undefined,
    };
    assert.equal(formatWorkingTree([], claims, (g) => leases[g], now), 'clean');
    const lines = formatWorkingTree(['intent/live.md', 'intent/expired.md', 'intent/released.md', 'intent/noleaseyet.md', 'specs/stray.md'], claims, (g) => leases[g], now);
    assert.deepEqual(lines, [
      `intent/live.md: claimed by g-live (session sess-A, lease live until ${iso(600_000)})`,
      `intent/expired.md: claimed by g-expired (session sess-B, lease expired at ${iso(-1)})`,
      'intent/released.md: claimed by g-released (session sess-C, lease released)',
      'intent/noleaseyet.md: claimed by g-none (no lease)',
      'specs/stray.md: unclaimed',
    ]);
  });

  test('a lease record that cannot be read is said so on its entry and never quoted', () => {
    const claims = new Map<string, string>([['intent/x.md', 'g-x']]);
    const lines = formatWorkingTree(['intent/x.md'], claims, () => {
      throw new Error('MALFORMED_JSON: HUSH42XYZ');
    }, iso());
    assert.deepEqual(lines, ['intent/x.md: claimed by g-x (lease unreadable)']);
  });
});

describe('workingTreeReport: what aidlc doctor prints (acceptance 3)', () => {
  const inputs = (overrides: Partial<WorkingTreeInputs> = {}): WorkingTreeInputs => ({
    isGit: true,
    status: () => ({ entries: [] }),
    dirs,
    goals: () => [],
    readPlan: () => undefined,
    leaseOf: () => undefined,
    now: iso(),
    ...overrides,
  });

  test('a repository that is not git prints n/a without touching git or the state', () => {
    let touched = false;
    const touch = <T,>(value: T) => () => {
      touched = true;
      return value;
    };
    assert.equal(workingTreeReport(inputs({ isGit: false, status: touch({ entries: ['?? intent/x.md'] }), goals: touch([]) })), 'n/a');
    assert.equal(touched, false);
  });

  test('a git status that cannot be read is UNREADABLE with the first line of the error; nothing throws out of the entry check', () => {
    const report = workingTreeReport(inputs({
      status: () => {
        throw new Error('git status failed: fatal: not a git repository\nsecond line');
      },
    }));
    assert.equal(report, 'UNREADABLE: git status failed: fatal: not a git repository');
  });

  test('goal records that cannot be read leave every entry claim unknown with the first line of the error; nothing throws', () => {
    const report = workingTreeReport(inputs({
      status: () => ({ entries: ['?? intent/a.md', ' M plans/a.md'] }),
      goals: () => {
        throw new Error('MALFORMED_JSON: goals/g-a.json\nUnexpected token');
      },
    }));
    assert.deepEqual(report, [
      'intent/a.md: claim unknown (goal records unreadable: MALFORMED_JSON: goals/g-a.json)',
      'plans/a.md: claim unknown (goal records unreadable: MALFORMED_JSON: goals/g-a.json)',
    ]);
  });

  test('clean when no planning file is uncommitted, and the goals are not read', () => {
    assert.equal(workingTreeReport(inputs({
      status: () => ({ entries: [' M src/state/claims.ts', '?? _local/notes.md'] }),
      goals: () => {
        throw new Error('goals must not be read for a clean tree');
      },
    })), 'clean');
  });

  test('the entries name the claiming goal and its lease; a plan that cannot be read names no extra cards', () => {
    const goal = makeGoal('g-a', { intentRef: 'intent/a.md', planRef: 'plans/a.md', cards: ['T0-A'] });
    const report = workingTreeReport(inputs({
      status: () => ({ entries: ['?? intent/a.md', ' M specs/tasks/T0-A.md', '?? specs/tasks/T0-FROM-PLAN.md'] }),
      goals: () => [goal],
      readPlan: () => {
        throw new Error('EACCES');
      },
      leaseOf: (goalId) => lease(goalId, { expiresAt: iso(600_000) }),
    }));
    assert.deepEqual(report, [
      `intent/a.md: claimed by g-a (session sess-A, lease live until ${iso(600_000)})`,
      `specs/tasks/T0-A.md: claimed by g-a (session sess-A, lease live until ${iso(600_000)})`,
      'specs/tasks/T0-FROM-PLAN.md: unclaimed',
    ]);
  });
});
