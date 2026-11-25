// Card T1-GOAL-UPDATE (issue 300): the locked update of a goal record and the compare-and-set of `saveGoal`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Goal } from '../../src/core/types.ts';
import { GoalStore } from '../../src/state/goal-store.ts';
import { StoreError } from '../../src/state/store.ts';
import { statePathsFromRoot } from '../../src/state/paths.ts';
import { cleanup, ensureStatePaths, makeGoal, tmpDir } from './helpers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const isCode = (code: string) => (err: unknown) => err instanceof StoreError && err.code === code;
const planned = (goal: Goal | undefined, planRef: string): Goal => ({ ...goal!, planRef });

function withStore(body: (store: GoalStore, dir: string) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const dir = tmpDir('aidlc-goal-update-');
    try {
      await body(new GoalStore(ensureStatePaths(statePathsFromRoot(path.join(dir, '.aidlc')))), dir);
    } finally {
      cleanup(dir);
    }
  };
}

test('T1-GOAL-UPDATE acceptance 1: updateGoal decides on the stored record, counts its writes from 0 and writes nothing for a throw or an unchanged record [R1]', withStore((store) => {
  const bytes = () => readFileSync(store.goalFile('g'), 'utf8');
  assert.equal(store.updateGoal('g', (current) => (assert.equal(current, undefined), makeGoal('g'))).writes, 0);
  const before = store.getGoal('g')!.updatedAt;
  assert.deepEqual([1, 2].map((n) => store.updateGoal('g', (current) => planned(current, `p${n}`)).writes), [1, 2]);
  const stored = store.getGoal('g')!;
  assert.deepEqual([stored.writes, stored.planRef], [2, 'p2']);
  assert.ok(stored.updatedAt >= before);
  const was = bytes();
  assert.throws(() => store.updateGoal('g', () => { throw new Error('refused by the change'); }), /refused by the change/);
  assert.equal(store.updateGoal('g', (current) => current!).writes, 2);
  assert.throws(() => store.updateGoal('g', (current) => ({ ...current!, state: 'NOPE' as Goal['state'] })));
  assert.equal(bytes(), was);
  // `writes` is the store's: a change that returns another count does not move it.
  assert.equal(store.updateGoal('g', (current) => ({ ...current!, writes: 40 })).writes, 3);
}));

test('T1-GOAL-UPDATE acceptance 1: a stored record with no writes key reads as 0 and its next write is 1 [R1]', withStore((store) => {
  store.saveGoal(makeGoal('g'));
  const { writes: _w, ...older } = JSON.parse(readFileSync(store.goalFile('g'), 'utf8')) as Record<string, unknown>;
  writeFileSync(store.goalFile('g'), JSON.stringify(older));
  assert.equal(store.getGoal('g')!.writes, 0);
  assert.equal(store.saveGoal(store.getGoal('g')!).writes, 1);
}));

test('T1-GOAL-UPDATE acceptance 1: saveGoal writes the record whose count is stored, and refuses an older or a newer one with GOAL_STALE, also under one updatedAt [R2]', withStore((store) => {
  const first = store.saveGoal(makeGoal('g'));
  const second = store.saveGoal(planned(first, 'p1'));
  assert.deepEqual([first.writes, second.writes], [0, 1]);
  const was = readFileSync(store.goalFile('g'), 'utf8');
  for (const [name, goal] of [['an older count', first], ['an older count with the stored updatedAt', { ...first, updatedAt: second.updatedAt }], ['a newer count', { ...second, writes: 2 }]] as const) {
    assert.throws(() => store.saveGoal(planned(goal, 'p2')), isCode('GOAL_STALE'), name);
    assert.equal(readFileSync(store.goalFile('g'), 'utf8'), was, name);
  }
  assert.throws(() => store.saveGoal(first), /goal g changed since it was read.*run the command again/);
  assert.equal(store.saveGoal(planned(second, 'p3')).writes, 2);
  let ran = false;
  assert.throws(() => store.saveGoal(first, () => { ran = true; }), isCode('GOAL_STALE'));
  assert.equal(ran, false, 'a refused write runs no section of its caller');
}));

test('T1-GOAL-UPDATE acceptance 1: two processes that each make 50 updates leave every one of the 100 [R1]', withStore(async (store, dir) => {
  store.saveGoal(makeGoal('g'));
  const script = path.join(dir, 'writer.mjs');
  const url = (rel: string) => JSON.stringify(pathToFileURL(path.join(root, rel)).href);
  writeFileSync(script, `import { GoalStore } from ${url('src/state/goal-store.ts')};
import { statePathsFromRoot } from ${url('src/state/paths.ts')};
const store = new GoalStore(statePathsFromRoot(process.argv[2]), { lockTimeoutMs: 60_000 });
for (let i = 0; i < 50; i += 1) store.updateGoal('g', (g) => ({ ...g, cardRevisions: { ...g.cardRevisions, [process.argv[3] + i]: i } }));
`);
  const codes = await Promise.all(['a', 'b'].map((name) => new Promise((resolve) => spawn(process.execPath, [script, path.join(dir, '.aidlc'), name], { stdio: 'inherit', windowsHide: true }).on('exit', resolve))));
  assert.deepEqual(codes, [0, 0]);
  const goal = store.getGoal('g')!;
  assert.equal(goal.writes, 100);
  assert.equal(Object.keys(goal.cardRevisions).filter((k) => /^[ab]\d+$/.test(k)).length, 100);
}));

test('T1-GOAL-UPDATE acceptance 6: no file of src/ outside src/state/goal-store.ts writes a goal file [R8]', () => {
  const files = readdirSync(path.join(root, 'src'), { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
  const writers = files.filter((f) => /(?:updateJson|atomicWriteJson|atomicWriteText|writeFileSync|renameSync)\(\s*[\w.]*goalFile\(/.test(readFileSync(path.join(root, 'src', f), 'utf8')));
  assert.deepEqual(writers.map((f) => f.split(path.sep).join('/')), ['state/goal-store.ts']);
});
