import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GENESIS_HASH, Journal, currentActor, resolveSessionId, setActorForTests, sha256 } from '../../src/state/journal.ts';
import { StoreError } from '../../src/state/store.ts';
import { verifyAudit } from '../../src/audit/verifier.ts';
import { actor, cleanup, failingFs, fsError, tmpDir } from './helpers.ts';

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

describe('state/journal session identity (T0-SESSION-IDENTITY)', () => {
  const state = tmpDir();
  after(() => {
    cleanup(state);
    setActorForTests(undefined);
  });

  it('session precedence: AIDLC_SESSION, then the Claude Code session, then the persisted default token', () => {
    const base: NodeJS.ProcessEnv = { AIDLC_STATE_DIR: state };
    // Claude Code exports its session to every Bash and PowerShell subprocess as CLAUDE_CODE_SESSION_ID.
    assert.deepEqual(resolveSessionId({ ...base, CLAUDE_CODE_SESSION_ID: 'cc-1' }, state), { session: 'cc-1', source: 'claude' });
    // the explicit override wins over both Claude variables
    assert.deepEqual(resolveSessionId({ ...base, AIDLC_SESSION: 'win-A', CLAUDE_CODE_SESSION_ID: 'cc-1', CLAUDE_SESSION_ID: 'legacy-1' }, state), { session: 'win-A', source: 'env' });
    assert.deepEqual(resolveSessionId({ ...base, CLAUDE_CODE_SESSION_ID: 'cc-1', CLAUDE_SESSION_ID: 'legacy-1' }, state), { session: 'cc-1', source: 'claude' });
    // none set: the persisted default token, unchanged
    writeFileSync(path.join(state, 'session-default'), 'default-abcd1234\n', 'utf8');
    assert.deepEqual(resolveSessionId(base, state), { session: 'default-abcd1234', source: 'default' });
    // T1-SWEEP2-FLAGS acceptance 1: the older CLAUDE_SESSION_ID, which Claude Code never exported, is not read; an empty CLAUDE_CODE_SESSION_ID is unset
    assert.deepEqual(resolveSessionId({ ...base, CLAUDE_SESSION_ID: 'legacy-1' }, state), { session: 'default-abcd1234', source: 'default' });
    assert.deepEqual(resolveSessionId({ ...base, CLAUDE_CODE_SESSION_ID: '', CLAUDE_SESSION_ID: 'legacy-1' }, state), { session: 'default-abcd1234', source: 'default' });
    // currentActor carries the resolved value
    setActorForTests(undefined);
    assert.equal(currentActor({ ...base, CLAUDE_CODE_SESSION_ID: 'cc-1' }).session, 'cc-1');
    setActorForTests(undefined);
  });
});

describe('state/journal reads a journal as empty only on ENOENT (T0-JOURNAL-READ-ENOENT)', () => {
  const dir = tmpDir();
  after(() => cleanup(dir));
  /** The four public readers of `j`, each with what it answers for a journal file that is not there. */
  const readers = (j: Journal): Array<[string, () => unknown, unknown]> => [
    ['readAll', () => j.readAll(), []],
    ['head', () => j.head(), { seq: -1, hash: GENESIS_HASH }],
    ['verify', () => j.verify(), { ok: true, events: 0, head: GENESIS_HASH, problems: [] }],
    ['filter', () => j.filter(() => true), []],
  ];
  /** Asserts that `err` is the READ_FAILED store error of `file` with the message of `message`, field by field. */
  const isReadFailed = (err: unknown, file: string, message: string): boolean => {
    assert.ok(err instanceof StoreError, String(err));
    assert.deepEqual({ code: err.code, file: err.file, message: err.message }, { code: 'READ_FAILED', file, message: `READ_FAILED: ${message} (${file})` });
    return true;
  };
  /** The READ_FAILED store error of `file` whose message carries `code`. */
  const refusedWith = (file: string, code: string) => (err: unknown): boolean => err instanceof StoreError && err.code === 'READ_FAILED' && err.file === file && err.message.includes(code);

  it('T0-JOURNAL-READ-ENOENT acceptance 1 - only a read error with the code ENOENT is an empty journal', () => {
    const j = Journal.forGoal(path.join(dir, 'unseen'), 'g-1');
    assert.equal(existsSync(j.file), false);
    const empty: Array<[string, string]> = [
      ['ENOENT', 'ENOENT: no such file or directory, open'],
      ['ENOENT', 'a message that names no code'],
    ];
    const refused: Array<[string | undefined, string]> = [
      ['EACCES', 'EACCES: permission denied, open'],
      ['ENOTDIR', 'ENOTDIR: not a directory, open'],
      ['ELOOP', 'ELOOP: too many symbolic links encountered, open'],
      ['EPERM', 'EPERM: operation not permitted, open'],
      ['EISDIR', 'EISDIR: illegal operation on a directory, read'],
      ['EIO', 'EIO: i/o error, read'],
      ['EACCES', 'a denied read of ENOENT.jsonl'],
      ['enoent', 'a code in another letter case'],
      [undefined, 'an error with no code'],
    ];
    for (const [name, read, missing] of readers(j)) {
      for (const [code, message] of empty) {
        assert.deepEqual(failingFs('readFileSync', j.file, fsError(code, message), read), missing, `${name} ${code}: ${message}`);
      }
      for (const [code, message] of refused) {
        assert.throws(() => failingFs('readFileSync', j.file, fsError(code, message), read), (err: unknown) => isReadFailed(err, j.file, message), `${name} ${code}: ${message}`);
      }
    }
  });

  it('T0-JOURNAL-READ-ENOENT acceptance 2 - a directory at the journal path is READ_FAILED, and a journal under a regular file is READ_FAILED on POSIX and empty on Windows', () => {
    const real = path.join(dir, 'real');
    const directory = path.join(real, 'g-dir.jsonl');
    mkdirSync(directory, { recursive: true });
    for (const [name, read] of readers(new Journal(directory))) assert.throws(read, refusedWith(directory, 'EISDIR'), `${name} a directory`);

    const plain = path.join(real, 'plain');
    writeFileSync(plain, 'text', 'utf8');
    const under = new Journal(path.join(plain, 'g.jsonl'));
    // Under a regular file POSIX answers ENOTDIR and Windows answers that there is no entry, which no reader can tell from a missing file.
    for (const [name, read, missing] of readers(under)) {
      if (process.platform === 'win32') assert.deepEqual(read(), missing, `${name} under a regular file`);
      else assert.throws(read, refusedWith(under.file, 'ENOTDIR'), `${name} under a regular file`);
    }
    for (const [name, read, missing] of readers(new Journal(path.join(real, 'none', 'g.jsonl')))) assert.deepEqual(read(), missing, `${name} missing`);
  });

  const noModes = process.platform === 'win32' ? 'Windows has no POSIX mode bits, so a directory mode cannot hide a journal' : process.getuid?.() === 0 ? 'root reads through any directory mode' : false;
  it('T0-JOURNAL-READ-ENOENT acceptance 3 - a journal in a directory without search permission is READ_FAILED (EACCES), read directly or through verifyAudit', { skip: noModes }, () => {
    const journalDir = path.join(dir, 'locked', 'journal');
    const j = Journal.forGoal(journalDir, 'g-locked');
    const a = actor('session-locked', 21);
    j.append({ type: 'GOAL_CREATED', goalId: 'g-locked', actor: a, ts: '2026-09-11T10:00:00.000Z' });
    j.append({ type: 'NOTE', goalId: 'g-locked', actor: a, ts: '2026-09-11T10:00:01.000Z' });
    const denied = refusedWith(j.file, 'EACCES');
    try {
      chmodSync(journalDir, 0o600);
      for (const [name, read] of readers(j)) assert.throws(read, denied, name);
      assert.throws(() => verifyAudit({ goalId: 'g-locked', journal: j, now: '2026-09-11T10:00:02.000Z' }), denied, 'verifyAudit');
    } finally {
      chmodSync(journalDir, 0o755);
    }
    assert.equal(j.readAll().length, 2);
  });
});
