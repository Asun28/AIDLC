import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GoalStore } from '../../src/state/goal-store.ts';
import { ensureStatePaths, statePathsFromRoot } from '../../src/state/paths.ts';
import { ReleaseAttempt } from '../../src/core/types.ts';
import { cleanup, iso, makeCardRun, makeGoal, tmpDir } from './helpers.ts';

describe('state/goal-store', () => {
  const dir = tmpDir();
  const paths = ensureStatePaths(statePathsFromRoot(path.join(dir, '.aidlc')));
  const store = new GoalStore(paths);
  after(() => cleanup(dir));

  it('saves, gets and lists goals (newest first) with schema validation', () => {
    const g1 = makeGoal('goal-a', { createdAt: iso(0), updatedAt: iso(0) });
    const g2 = makeGoal('goal-b', { createdAt: iso(60_000), updatedAt: iso(60_000) });
    const saved = store.saveGoal(g1);
    assert.equal(saved.id, 'goal-a');
    // updatedAt is stamped from the real clock on every save
    assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(saved.createdAt, g1.createdAt);
    store.saveGoal(g2);
    assert.equal(store.getGoal('goal-a')?.id, 'goal-a');
    assert.equal(store.getGoal('missing'), undefined);
    assert.deepEqual(
      store.listGoals().map((g) => g.id),
      ['goal-b', 'goal-a'],
    );
    assert.ok(existsSync(store.goalFile('goal-a')));
  });

  it('refuses to persist an invalid goal', () => {
    const bad = { ...makeGoal('goal-bad'), state: 'NOPE' } as unknown as ReturnType<typeof makeGoal>;
    assert.throws(() => store.saveGoal(bad));
    assert.equal(store.getGoal('goal-bad'), undefined);
  });

  it('saves, gets and lists card runs per goal', () => {
    const run = makeCardRun('goal-a', 'T1-ALPHA');
    store.saveCardRun(run);
    store.saveCardRun(makeCardRun('goal-a', 'T1-BETA', { state: 'SHIP' }));
    store.saveCardRun(makeCardRun('goal-b', 'T1-GAMMA'));
    assert.equal(store.getCardRun('goal-a', 'T1-ALPHA')?.state, 'BUILD');
    assert.equal(store.getCardRun('goal-a', 'T1-ZZZ'), undefined);
    assert.deepEqual(
      store.listCardRuns('goal-a').map((r) => r.cardId).sort(),
      ['T1-ALPHA', 'T1-BETA'],
    );
    assert.deepEqual(store.listCardRuns('goal-none'), []);
    // defaults were filled in by the schema (review / ci / closure prefault)
    const back = store.getCardRun('goal-a', 'T1-ALPHA')!;
    assert.equal(back.review.substantiveDecisions, 0);
    assert.deepEqual(back.ci.reruns, []);
    assert.equal(back.closure.cleanup, false);
  });

  it('saves, gets and lists release attempts, filtered by goal', () => {
    const attempt = ReleaseAttempt.parse({
      id: 'rel-1',
      goalId: 'goal-a',
      generation: 0,
      target: 'staging',
      state: 'PREPARE',
      startedAt: iso(),
      deadline: iso(3 * 60 * 60 * 1000),
      updatedAt: iso(),
    });
    store.saveRelease(attempt);
    assert.equal(store.getRelease('rel-1')?.target, 'staging');
    assert.equal(store.listReleases('goal-a').length, 1);
    assert.equal(store.listReleases('goal-b').length, 0);
    assert.equal(store.listReleases().length, 1);
  });

  it('recover() removes interrupted temporary writes across the state tree', () => {
    const leftovers = [
      path.join(paths.goals, 'goal-a.json.tmp-1-0123abcd'),
      path.join(paths.cards, 'goal-a', 'T1-ALPHA.json.tmp-2-0123abcd'),
      path.join(paths.releases, 'rel-1.json.tmp-3-0123abcd'),
    ];
    for (const f of leftovers) writeFileSync(f, '{', 'utf8');
    const { interrupted } = store.recover();
    assert.deepEqual(interrupted.sort(), leftovers.sort());
    for (const f of leftovers) assert.equal(existsSync(f), false);
    // durable records untouched
    assert.equal(store.getGoal('goal-a')?.id, 'goal-a');
    assert.equal(store.getCardRun('goal-a', 'T1-ALPHA')?.cardId, 'T1-ALPHA');
    assert.deepEqual(store.recover().interrupted, []);
  });
});
