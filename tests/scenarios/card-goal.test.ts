import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, goalForCards } from './_harness.ts';

/** The CLI from the sources (what `npm run dev` runs), never a compiled build that may be stale. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));

/** Two active goals, the older projecting T1-OLD and the newer T1-NEW, and a registered card T1-NONE no goal projects. */
function twoGoals() {
  const fx = makeFixture();
  writeCard(fx, { id: 'T1-OLD', title: 'the older goal card' });
  writeCard(fx, { id: 'T1-NEW', title: 'the newer goal card' });
  writeCard(fx, { id: 'T1-NONE', title: 'a card no goal projects' });
  const older = goalForCards(fx, ['T1-OLD']);
  fx.advance(60_000);
  const newer = goalForCards(fx, ['T1-NEW']);
  const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, ...args, '--json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-A' }, encoding: 'utf8', timeout: 60_000 });
  return { fx, older, newer, cli };
}

test('T0-CARD-GOAL-RESOLVE acceptance 3: without --goal a card command acts on the older goal that projects the card, never on the newer active goal [R1]', () => {
  const { fx, older, newer, cli } = twoGoals();
  try {
    const close = cli('card', 'close', 'T1-OLD', '--metadata');
    assert.notEqual(close.status, 0, 'the closure itself is refused: the run is not in CLOSE');
    assert.match(close.stderr, /without a verified merge/, `the refusal is the closure's, after the goal was resolved: ${close.stderr}`);
    assert.ok(fx.store.getCardRun(older.id, 'T1-OLD'), 'the run is written in the goal that projects the card');
    assert.equal(fx.store.getCardRun(newer.id, 'T1-OLD'), undefined, 'no run of the card in the newer goal');
    const status = cli('card', 'status', 'T1-OLD');
    assert.equal(status.status, 0, status.stderr);
    assert.equal((JSON.parse(status.stdout) as { goalId: string }).goalId, older.id);
  } finally {
    fx.cleanup();
  }
});

test('T0-CARD-GOAL-RESOLVE acceptance 3: card report and card takeover without --goal resolve the goal that projects the card too [R1]', () => {
  const { fx, older, newer, cli } = twoGoals();
  try {
    cli('card', 'report', 'T1-OLD', '--data', '{}');
    assert.ok(fx.store.getCardRun(older.id, 'T1-OLD'), 'card report writes the run in the goal that projects the card');
    assert.equal(fx.store.getCardRun(newer.id, 'T1-OLD'), undefined, 'card report creates no run in the newer goal');
    const takeover = cli('card', 'takeover', 'T1-NEW');
    assert.notEqual(takeover.status, 0, 'no run of T1-NEW exists to take over');
    assert.ok(takeover.stderr.includes(`no run record for T1-NEW in ${newer.id}`), `card takeover looks in the goal that projects the card: ${takeover.stderr}`);
    const takeoverOld = cli('card', 'takeover', 'T1-OLD');
    assert.ok(!takeoverOld.stderr.includes(newer.id), `card takeover of T1-OLD never names the newer goal: ${takeoverOld.stderr}`);
  } finally {
    fx.cleanup();
  }
});

test('T0-CARD-GOAL-RESOLVE acceptance 3: review pre, r3, dispute and accept without --goal act on the goal that projects the card, never on the newer goal [R1]', () => {
  const commands = [
    ['review', 'pre', 'T1-OLD'],
    ['review', 'r3', 'T1-OLD'],
    ['review', 'dispute', 'T1-OLD', 'F1', '--note', 'the finding does not hold'],
    ['review', 'accept', 'T1-OLD', 'F1'],
  ];
  for (const args of commands) {
    const { fx, older, newer, cli } = twoGoals();
    try {
      const r = cli(...args);
      assert.ok(!r.stderr.includes(newer.id), `${args.join(' ')} never names the newer goal: ${r.stderr}`);
      assert.ok(fx.store.getCardRun(older.id, 'T1-OLD'), `${args.join(' ')} reads the run of the goal that projects the card`);
      assert.equal(fx.store.getCardRun(newer.id, 'T1-OLD'), undefined, `${args.join(' ')} creates no run in the newer goal`);
    } finally {
      fx.cleanup();
    }
  }
});

test('T0-CARD-GOAL-RESOLVE acceptance 3: a card no goal projects is refused naming it, and no run is created in any goal [R2]', () => {
  const { fx, older, newer, cli } = twoGoals();
  try {
    const r = cli('card', 'close', 'T1-NONE', '--metadata');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no goal projects card T1-NONE/, r.stderr);
    assert.match(r.stderr, /aidlc goal new --card T1-NONE/, r.stderr);
    for (const goal of [older, newer]) assert.equal(fx.store.getCardRun(goal.id, 'T1-NONE'), undefined, `no run in ${goal.id}`);
  } finally {
    fx.cleanup();
  }
});

test('T0-CARD-GOAL-RESOLVE acceptance 3: an explicit --goal that does not project the card is refused naming it and the projecting goal, and no run is created in it [R3]', () => {
  const { fx, older, newer, cli } = twoGoals();
  try {
    const r = cli('card', 'close', 'T1-OLD', '--metadata', '--goal', newer.id);
    assert.notEqual(r.status, 0);
    assert.ok(r.stderr.includes(`goal ${newer.id} does not project card T1-OLD`), r.stderr);
    assert.ok(r.stderr.includes(older.id), `the projecting goal is named: ${r.stderr}`);
    assert.equal(fx.store.getCardRun(newer.id, 'T1-OLD'), undefined, 'no run of the card in the named goal');
  } finally {
    fx.cleanup();
  }
});

test('T0-CARD-GOAL-RESOLVE acceptance 4: docs/OPERATIONS.md, docs/ARCHITECTURE.md and the CHANGELOG Unreleased section state the rule [R5]', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
  const operations = read('docs', 'OPERATIONS.md');
  const opsSentences = [
    '- A command that names a card (`aidlc card next|attempt|close|ci-reconcile|report|status|takeover <card>`, `aidlc review pre|r3|dispute|accept <card>`) acts on the goal that projects the card, not on the newest goal (card T0-CARD-GOAL-RESOLVE): without `--goal` it takes the one non-terminal goal whose `cards` hold the card, else the one terminal goal that does, and it refuses before any card run is read or written when no goal or more than one qualifies, naming the candidates.',
    'An explicit `--goal` is used only when that goal projects the card or already holds its run.',
    'Commands that name no card (`aidlc next`, `aidlc report`, `aidlc board`, `aidlc audit`) still take the newest active goal without `--goal`, so pass it whenever more than one goal is active.',
  ];
  for (const sentence of opsSentences) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
  const architecture = read('docs', 'ARCHITECTURE.md');
  const archSentence = 'A command that names a card resolves its goal with `resolveCardGoal` (`src/core/card-goal.ts`) from the goals that project the card, never from which goal is newest (card T0-CARD-GOAL-RESOLVE).';
  assert.ok(architecture.includes(archSentence), `docs/ARCHITECTURE.md states: ${archSentence}`);
  const changelog = read('CHANGELOG.md');
  const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
  const changelogSentences = [
    '- Card goal resolution, card T0-CARD-GOAL-RESOLVE: a command that names a card now acts on the goal that projects the card and refuses, naming the candidate goals, when none or several do; it used to take the newest active goal, so a card command of one session could create and journal a run of its card in another session\'s goal (issue #72).',
    'An explicit `--goal` that neither projects the card nor holds its run is refused.',
  ];
  for (const sentence of changelogSentences) assert.ok(unreleased.includes(sentence), `CHANGELOG.md Unreleased states: ${sentence}`);
});
