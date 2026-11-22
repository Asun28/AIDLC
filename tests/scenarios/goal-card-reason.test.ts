/**
 * Card T0-GOAL-CARD-REASON (issue 423): the routing reasons of a goal whose request gives a card name that card and not
 * the card id the request text names first, through `aidlc goal new --card` and through `createGoal`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeFixture, writeCard } from './_harness.ts';
import { tmpDir } from '../infra/helpers.ts';
import { runCliInProcess } from '../infra/cli-inprocess.ts';

const NAMED = 'T0-GATE';
const GIVEN = 'T0-GATE-2';
const TEXT = 'Build the gate, successor of T0-GATE';
/** The reasons of acceptance item 1 of the card, for `TEXT` with `--card T0-GATE-2`. */
const REASONS = [
  'ref=T0-GATE-2',
  'resolved card T0-GATE-2',
  'the text names card id T0-GATE; --card names the card of this request',
  'kind=card-execute',
  'size=T0 (inferred)',
  'target=development (default; hosting/deploy not authorised by this request)',
];

/** A fixture whose registry holds the card the text names and the card the request gives. */
function withCards() {
  const fx = makeFixture();
  writeCard(fx, { id: NAMED, title: 'the gate' });
  writeCard(fx, { id: GIVEN, title: 'the gate, second card' });
  return fx;
}

test('T0-GOAL-CARD-REASON acceptance 5: aidlc goal new --card records routing reasons that name the given card, with the request ref and the goal cards as before [R4]', async () => {
  const [repo, state] = [tmpDir('aidlc-reason-repo-'), tmpDir('aidlc-reason-state-')];
  try {
    mkdirSync(path.join(repo, 'specs', 'tasks'), { recursive: true });
    writeFileSync(path.join(repo, 'aidlc.config.json'), JSON.stringify({ shipPath: 'dry-run', cardsDir: 'specs/tasks', worktreeRoot: path.join(state, 'wt'), base: 'main', mode: 'remote' }));
    const fx = withCards();
    try {
      for (const id of [NAMED, GIVEN]) copyFileSync(path.join(fx.cardsDir, `${id}.md`), path.join(repo, 'specs', 'tasks', `${id}.md`));
    } finally {
      fx.cleanup();
    }
    const init = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, encoding: 'utf8' });
    assert.equal(init.status, 0, `git init: ${init.stderr}`);
    const env = { ...process.env, AIDLC_STATE_DIR: state };
    const cli = async (...args: string[]) => {
      const r = await runCliInProcess(['-C', repo, ...args, '--json'], { cwd: repo, env });
      assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}\n${r.stdout}`);
      return JSON.parse(r.stdout) as Record<string, any>;
    };
    const created = await cli('goal', 'new', TEXT, '--card', GIVEN);
    assert.deepEqual(created['routing'].reasons, REASONS, 'the reasons goal new prints');
    const goal = await cli('goal', 'status', created['goal'] as string);
    assert.deepEqual(goal['routing'].reasons, REASONS, 'the reasons the goal record holds');
    assert.deepEqual(goal['cards'], [GIVEN]);
    assert.equal(goal['revisions'][0].request.ref, GIVEN);
  } finally {
    for (const dir of [repo, state]) rmSync(dir, { recursive: true, force: true });
  }
});

test('T0-GOAL-CARD-REASON acceptance 6: createGoal with a request that gives a card and no cards option takes the given card as the goal card, and without a ref the card of the text [R4]', () => {
  const fx = withCards();
  try {
    const given = fx.controller.createGoal({ text: `implement ${NAMED}`, source: 'card', ref: GIVEN, affectedSurfaces: [] });
    assert.deepEqual(given.cards, [GIVEN]);
    const fromText = fx.controller.createGoal({ text: `implement ${NAMED}`, source: 'natural-language', affectedSurfaces: [] });
    assert.deepEqual(fromText.cards, [NAMED]);
  } finally {
    fx.cleanup();
  }
});
