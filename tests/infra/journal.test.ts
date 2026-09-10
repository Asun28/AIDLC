import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GENESIS_HASH, Journal, currentActor, setActorForTests, sha256 } from '../../src/state/journal.ts';
import { actor, cleanup, tmpDir } from './helpers.ts';

describe('state/journal (Q12 evidence chain)', () => {
  const dir = tmpDir();
  after(() => {
    cleanup(dir);
    setActorForTests(undefined);
  });

  it('head() on an empty journal is the genesis hash', () => {
    const j = Journal.forGoal(dir, 'empty');
    assert.equal(j.exists(), false);
    assert.deepEqual(j.head(), { seq: -1, hash: GENESIS_HASH });
    assert.deepEqual(j.readAll(), []);
    const v = j.verify();
    assert.equal(v.ok, true);
    assert.equal(v.events, 0);
    assert.equal(v.head, GENESIS_HASH);
  });

  it('append builds a hash chain and verify() passes', () => {
    const j = Journal.forGoal(dir, 'g1');
    const a = actor('session-a', 11);
    const e0 = j.append({ type: 'GOAL_CREATED', goalId: 'g1', generation: 0, actor: a, data: { size: 'T1' } });
    const e1 = j.append({ type: 'CARD_DISPATCHED', goalId: 'g1', cardId: 'T1-FOO', actor: a, data: { childRef: 'c1' } });
    const e2 = j.append({ type: 'NOTE', goalId: 'g1', actor: a });
    assert.equal(e0.seq, 0);
    assert.equal(e0.prevHash, GENESIS_HASH);
    assert.equal(e1.seq, 1);
    assert.equal(e1.prevHash, e0.hash);
    assert.equal(e2.prevHash, e1.hash);
    assert.match(e2.hash, /^[a-f0-9]{64}$/);
    assert.deepEqual(j.head(), { seq: 2, hash: e2.hash });
    const v = j.verify();
    assert.equal(v.ok, true);
    assert.equal(v.events, 3);
    assert.equal(v.head, e2.hash);
    assert.deepEqual(v.problems, []);
    assert.deepEqual(
      j.readAll().map((e) => e.type),
      ['GOAL_CREATED', 'CARD_DISPATCHED', 'NOTE'],
    );
    assert.deepEqual(j.filter((e) => e.cardId === 'T1-FOO').map((e) => e.seq), [1]);
  });

  it('tampering with a middle line is reported at that line as an altered hash', () => {
    const j = Journal.forGoal(dir, 'tamper');
    const a = actor('session-a');
    j.append({ type: 'NOTE', actor: a, data: { i: 0 } });
    j.append({ type: 'NOTE', actor: a, data: { i: 1 } });
    j.append({ type: 'NOTE', actor: a, data: { i: 2 } });
    const lines = readFileSync(j.file, 'utf8').split('\n').filter((l) => l.trim());
    const middle = JSON.parse(lines[1]!) as { data: { i: number } };
    middle.data.i = 99; // alter content, keep the stored hash
    lines[1] = JSON.stringify(middle);
    writeFileSync(j.file, lines.join('\n') + '\n', 'utf8');
    const v = j.verify();
    assert.equal(v.ok, false);
    assert.equal(v.events, 3);
    assert.deepEqual(
      v.problems.map((p) => [p.line, p.problem]),
      [[2, 'event hash mismatch (altered content)']],
    );
  });

  it('deleting a line is reported as a sequence gap and broken previous hash', () => {
    const j = Journal.forGoal(dir, 'gap');
    const a = actor('session-a');
    j.append({ type: 'NOTE', actor: a, data: { i: 0 } });
    j.append({ type: 'NOTE', actor: a, data: { i: 1 } });
    j.append({ type: 'NOTE', actor: a, data: { i: 2 } });
    const lines = readFileSync(j.file, 'utf8').split('\n').filter((l) => l.trim());
    lines.splice(1, 1);
    writeFileSync(j.file, lines.join('\n') + '\n', 'utf8');
    const v = j.verify();
    assert.equal(v.ok, false);
    const problems = v.problems.filter((p) => p.line === 2).map((p) => p.problem);
    assert.ok(problems.includes('sequence gap: expected 1, found 2'), JSON.stringify(v.problems));
    assert.ok(problems.includes('previous hash mismatch'), JSON.stringify(v.problems));
  });

  it('a malformed line and a schema-violating line are reported without throwing', () => {
    const j = Journal.forGoal(dir, 'malformed');
    j.append({ type: 'NOTE', actor: actor('s') });
    writeFileSync(j.file, readFileSync(j.file, 'utf8') + 'not json\n' + JSON.stringify({ seq: 1 }) + '\n', 'utf8');
    const v = j.verify();
    assert.equal(v.ok, false);
    assert.equal(v.problems.find((p) => p.line === 2)?.problem, 'malformed JSON');
    assert.match(v.problems.find((p) => p.line === 3)?.problem ?? '', /^schema:/);
  });

  it('currentActor is cached and can be replaced for tests; append uses it by default', () => {
    const a = actor('injected', 7);
    setActorForTests(a);
    assert.deepEqual(currentActor(), a);
    const j = Journal.host(dir);
    const e = j.append({ type: 'LEASE_ACQUIRED' });
    assert.deepEqual(e.actor, a);
    setActorForTests(undefined);
    const real = currentActor();
    assert.equal(real.pid, process.pid);
    assert.match(real.processStart, /Z$/);
  });

  it('sha256 helper produces lowercase hex', () => {
    assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
