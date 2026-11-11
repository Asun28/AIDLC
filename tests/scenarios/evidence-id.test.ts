import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvidenceStore, type Manifest } from '../../src/audit/manifest.ts';
import { makeFixture, writeCard, goalForCards, type Fixture } from './_harness.ts';

/** The CLI from the sources, never a compiled build that may be stale. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const NOW = '2026-11-11T00:00:00.000Z';
const HEAD = 'aa'.repeat(32);

const temps: string[] = [];
const fixtures: Fixture[] = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
  for (const fx of fixtures) fx.cleanup();
});

/** A temporary directory the after hook removes. */
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-evidence-id-'));
  temps.push(dir);
  return dir;
}

function store(goal = 'g1'): EvidenceStore {
  return new EvidenceStore(path.join(tempDir(), 'evidence'), goal);
}

/** Retain through the public call with the manifest as the CLI loads it. */
function retain(ev: EvidenceStore, id: string, content = id, extra: { sourcePath?: string } = {}): Manifest {
  return ev.retain(ev.load('g1', 0, 0, NOW), { id, kind: 'artifact', content: extra.sourcePath ? undefined : content, sourcePath: extra.sourcePath });
}

function bytes(file: string): string | undefined {
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** What a refused retain must leave alone: the manifest bytes, and every file name and the bytes of each. */
function snapshot(ev: EvidenceStore): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(ev.dir)) out[name] = readFileSync(path.join(ev.dir, name), 'utf8');
  return out;
}

/** The message of the error a call throws. */
function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  assert.fail('expected the call to throw');
}

/** The refusal of `id` names the id, the file name and the reason, and changes no byte. */
function refused(ev: EvidenceStore, id: string, reason: RegExp, content = 'new'): void {
  const before = snapshot(ev);
  const message = refusal(() => retain(ev, id, content));
  assert.match(message, reason, `id ${JSON.stringify(id)}: ${message}`);
  assert.match(message, /^evidence id /, message);
  assert.ok(message.includes(`evidence id ${id} has the file name `), `id ${JSON.stringify(id)}: ${message}`);
  assert.deepEqual(snapshot(ev), before, `id ${JSON.stringify(id)}`);
}

const FILE_OF = (id: string): RegExp => new RegExp(`refused: the file of the id ${id.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')};`);

test('an id whose file name is another retained id\'s is refused', () => {
  const ev = store();
  retain(ev, 'a/b', 'first');
  retain(ev, 'Dod-X', 'dod');
  for (const id of ['a_b', 'a b', 'a//b', 'A/B', 'A_b']) {
    refused(ev, id, FILE_OF('a/b'));
    assert.equal(bytes(path.join(ev.dir, 'a_b')), 'first', id);
  }
  refused(ev, 'dod-x', FILE_OF('Dod-X'));
  assert.equal(bytes(path.join(ev.dir, 'Dod-X')), 'dod');
  assert.deepEqual(ev.load('g1', 0, 0, NOW).entries.map((e) => e.id), ['a/b', 'Dod-X']);
});

const DEVICES = ['CON', 'PRN', 'AUX', 'NUL', ...Array.from({ length: 10 }, (_, i) => `COM${i}`), ...Array.from({ length: 10 }, (_, i) => `LPT${i}`)];

/** `nUl`, `cOn`: every other letter upper-cased, so each stem is tried in a case that is neither the upper nor the lower one. */
function mixed(stem: string): string {
  return [...stem.toLowerCase()].map((ch, i) => (i % 2 === 1 ? ch.toUpperCase() : ch)).join('');
}

test('every class of R2', () => {
  assert.equal(DEVICES.length, 24);
  const ev = store();
  retain(ev, 'seed');

  // (a) empty
  refused(ev, '', /refused: empty;/);
  // (b) ends with a dot
  for (const id of ['.', '..', 'a.', 'x..']) refused(ev, id, /refused: ends with a dot;/);
  // (c) the copy directory of card close and worktree reclaim, in any case
  for (const id of ['review', 'Review', 'REVIEW']) refused(ev, id, /refused: the reserved name review;/);
  // (d) device names: bare, with an extension, and in mixed case
  for (const stem of DEVICES) {
    for (const id of [stem, stem.toLowerCase(), `${stem}.txt`, `${mixed(stem)}.Log`, mixed(stem)]) refused(ev, id, /refused: the device name /);
  }
  refused(ev, 'nUl.Log', /refused: the device name nul;/);
  refused(ev, 'com1.tar.gz', /refused: the device name com1;/);

  // Accepted near misses: each is retained under its own file name.
  const near = ['a.nul', 'console', 'com10', 'lpt', 'reviews', 'review.json', '.x', 'a.b', 'nul_x'];
  for (const id of near) retain(ev, id, `body ${id}`);
  const stored = ev.load('g1', 0, 0, NOW);
  assert.deepEqual(stored.entries.map((e) => e.id), ['seed', ...near]);
  for (const id of near) assert.equal(bytes(path.join(ev.dir, id)), `body ${id}`, id);
  assert.ok(stored.entries.every((e) => ev.intact(e)));
});

test('the manifest names stay refused', () => {
  const ev = store();
  retain(ev, 'seed');
  for (const id of ['manifest.json', 'manifest.json.lock', 'manifest.json.tmp-1-abcdef12']) refused(ev, id, /which is reserved for manifest\.json/);
});

test('order of the refusals', () => {
  // Sealed first: a colliding id on a sealed manifest gets the sealed refusal.
  const sealed = store();
  retain(sealed, 'a/b');
  sealed.seal(sealed.load('g1', 0, 0, NOW), { journalHead: HEAD, journalEvents: 1, now: NOW });
  assert.match(refusal(() => retain(sealed, 'a_b')), /sealed/);
  assert.match(refusal(() => retain(sealed, 'review')), /sealed/);

  // The rules come before the missing source: a colliding id whose file is missing gets the collision refusal.
  const ev = store();
  retain(ev, 'a/b');
  const missing = path.join(tempDir(), 'absent.txt');
  const before = snapshot(ev);
  assert.match(refusal(() => retain(ev, 'a_b', '', { sourcePath: missing })), /refused: the file of the id a\/b;/);
  assert.match(refusal(() => retain(ev, 'review.', '', { sourcePath: missing })), /refused: ends with a dot;/);
  assert.match(refusal(() => retain(ev, 'zz', '', { sourcePath: missing })), /evidence source missing/);
  assert.deepEqual(snapshot(ev), before);

  // Rule order (a) to (e): the first rule that applies is reported.
  assert.match(refusal(() => retain(ev, 'nul.')), /refused: ends with a dot;/);
  assert.match(refusal(() => retain(ev, 'manifest.json.')), /refused: ends with a dot;/);
  assert.match(refusal(() => retain(ev, 'MANIFEST.JSON')), /reserved for manifest\.json/);
  // (c) before (e): a legacy entry of another id on the file `review`.
  const legacy = store();
  mkdirSync(legacy.dir, { recursive: true });
  writeFileSync(legacy.manifestFile(), JSON.stringify(handManifest([{ id: 'zz', path: 'review' }])), 'utf8');
  assert.match(refusal(() => retain(legacy, 'review')), /refused: the reserved name review;/);
  // (d) before (e): a legacy entry of another id on a device file name.
  writeFileSync(legacy.manifestFile(), JSON.stringify(handManifest([{ id: 'zz', path: 'nul.txt' }])), 'utf8');
  assert.match(refusal(() => retain(legacy, 'nul.txt')), /refused: the device name nul;/);
});

/** A manifest as a legacy store could have written it: entries over paths the test chooses. */
function handManifest(entries: { id: string; path: string }[]): Manifest {
  return {
    schemaVersion: 1,
    goalId: 'g1',
    generation: 0,
    revision: 0,
    createdAt: NOW,
    entries: entries.map((e) => ({ id: e.id, kind: 'artifact', path: e.path, sha256: sha(e.id), bytes: e.id.length })),
    models: [],
  };
}

test('same-id replacement and a legacy manifest', () => {
  const ev = store();
  retain(ev, 'verdict', 'one');
  retain(ev, 'verdict', 'second');
  retain(ev, 'a/b', 'one');
  retain(ev, 'a/b', 'second!');
  const stored = ev.load('g1', 0, 0, NOW);
  assert.deepEqual(stored.entries.map((e) => e.id), ['verdict', 'a/b']);
  assert.equal(stored.entries[0]!.sha256, sha('second'));
  assert.equal(stored.entries[1]!.sha256, sha('second!'));
  assert.equal(stored.entries[1]!.bytes, 7);
  assert.equal(bytes(path.join(ev.dir, 'verdict')), 'second');
  assert.equal(bytes(path.join(ev.dir, 'a_b')), 'second!');

  // A legacy manifest whose two ids share one path: a retain of either id is refused naming the other, and an unrelated id succeeds.
  const legacy = store();
  mkdirSync(legacy.dir, { recursive: true });
  writeFileSync(legacy.manifestFile(), JSON.stringify(handManifest([{ id: 'p/q', path: 'p_q' }, { id: 'p_q', path: 'p_q' }])), 'utf8');
  const before = snapshot(legacy);
  assert.match(refusal(() => retain(legacy, 'p/q')), /refused: the file of the id p_q;/);
  assert.match(refusal(() => retain(legacy, 'p_q')), /refused: the file of the id p\/q;/);
  assert.deepEqual(snapshot(legacy), before);
  const next = retain(legacy, 'r');
  assert.deepEqual(next.entries.map((e) => e.id), ['p/q', 'p_q', 'r']);
});

test('two colliding retains in a deterministic interleave', () => {
  const ev = store();
  const copy = ev.load('g1', 0, 0, NOW);
  ev.retain(ev.load('g1', 0, 0, NOW), { id: 'a/b', kind: 'artifact', content: 'first' });
  assert.match(refusal(() => ev.retain(copy, { id: 'a_b', kind: 'artifact', content: 'second' })), /refused: the file of the id a\/b;/);
  assert.equal(bytes(path.join(ev.dir, 'a_b')), 'first');
  assert.deepEqual(ev.load('g1', 0, 0, NOW).entries.map((e) => e.id), ['a/b']);
});

test('the loop\'s ids are accepted', () => {
  const ev = store();
  const loopIds = ['T1-X.verdict', 'dod-T1-X', 'review/T1-X.json', 'T1-X/T1-X.pre.0.1.1.202b79d6.ac-coverage.json', 'r3-decision-2-verdict', 'merge-T1-X-pr22', 'arc-check'];
  for (const id of loopIds) retain(ev, id);
  const stored = ev.load('g1', 0, 0, NOW);
  assert.deepEqual(stored.entries.map((e) => e.id), loopIds);
  assert.ok(stored.entries.every((e) => ev.intact(e)));
  assert.equal(new Set(stored.entries.map((e) => e.path.toLowerCase())).size, loopIds.length);
});

/** A goal of a fixture state directory and the CLI bound to it. */
function cliGoal() {
  const fx = makeFixture();
  fixtures.push(fx);
  writeCard(fx, { id: 'T1-EVIDENCE', title: 'retains evidence' });
  const goal = goalForCards(fx, ['T1-EVIDENCE']);
  const ev = new EvidenceStore(fx.paths.evidence, goal.id);
  const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, ...args, '--goal', goal.id, '--json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root }, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  const journal = () => bytes(fx.journal(goal.id).file);
  return { ev, cli, journal };
}

test('the CLI refuses a colliding id and journals nothing', () => {
  const { ev, cli, journal } = cliGoal();
  const first = cli('evidence', 'retain', '--id', 'a/b', '--kind', 'artifact', '--content', 'first');
  assert.equal(first.status, 0, first.stderr);
  const events = journal();
  const manifest = bytes(ev.manifestFile());
  const second = cli('evidence', 'retain', '--id', 'a_b', '--kind', 'artifact', '--content', 'second');
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /refused: the file of the id a\/b;/);
  assert.equal(journal(), events);
  assert.equal(bytes(ev.manifestFile()), manifest);
  assert.equal(bytes(path.join(ev.dir, 'a_b')), 'first');
});
