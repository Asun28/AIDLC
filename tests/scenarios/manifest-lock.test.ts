import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvidenceStore, Manifest, type ManifestEntry } from '../../src/audit/manifest.ts';
import { StoreError } from '../../src/state/store.ts';
import { makeFixture, writeCard, goalForCards, type Fixture } from './_harness.ts';

/** The CLI from the sources, never a compiled build that may be stale. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const MANIFEST_MODULE = new URL('../../src/audit/manifest.ts', import.meta.url).href;
const NOW = '2026-11-11T00:00:00.000Z';
const HEAD_A = 'aa'.repeat(32);
const HEAD_B = 'bb'.repeat(32);
const HEAD_C = 'cc'.repeat(32);

const temps: string[] = [];
const fixtures: Fixture[] = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
  for (const fx of fixtures) fx.cleanup();
});

/** A temporary directory the after hook removes. */
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-manifest-lock-'));
  temps.push(dir);
  return dir;
}

function store(goal = 'g1'): EvidenceStore {
  return new EvidenceStore(path.join(tempDir(), 'evidence'), goal);
}

function bytes(file: string): string | undefined {
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

function ids(m: Manifest): string[] {
  return m.entries.map((e) => e.id);
}

/** A lock file as `updateJson` writes it, naming this live process. */
function holdLock(ev: EvidenceStore): string {
  const lock = `${ev.manifestFile()}.lock`;
  writeFileSync(lock, `pid=${process.pid} at=${NOW} nonce=0badc0de`, 'utf8');
  return lock;
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof StoreError, `expected a StoreError, got ${(err as Error).message}`);
    return err.code;
  }
  assert.fail('expected the call to throw');
}

test('a retain given a manifest read before another retain keeps both', () => {
  const ev = store();
  let m = ev.retain(ev.load('g1', 0, 0, NOW), { id: 'a', kind: 'artifact', content: 'a' });
  const copy = ev.load('g1', 0, 0, NOW);
  m = ev.retain(m, { id: 'b', kind: 'artifact', content: 'b' });
  ev.retain(copy, { id: 'c', kind: 'artifact', content: 'c' });
  const stored = ev.load('g1', 0, 0, NOW);
  assert.deepEqual(ids(stored), ['a', 'b', 'c']);
  assert.ok(stored.entries.every((e) => ev.intact(e)));
});

test('a seal given an older copy seals what others retained', () => {
  const ev = store();
  ev.retain(ev.load('g1', 0, 0, NOW), { id: 'a', kind: 'artifact', content: 'a' });
  const copy = ev.load('g1', 0, 0, NOW);
  ev.retain(ev.load('g1', 0, 0, NOW), { id: 'b', kind: 'artifact', content: 'b' });
  ev.seal(copy, { journalHead: HEAD_A, journalEvents: 3, now: NOW });
  const sealed = ev.load('g1', 0, 0, NOW);
  assert.deepEqual(ids(sealed), ['a', 'b']);
  assert.equal(ev.verifySeal(sealed), true);

  const later = store();
  later.retain(later.load('g1', 0, 0, NOW), { id: 'a', kind: 'artifact', content: 'a' });
  const stale = later.load('g1', 0, 0, NOW);
  later.seal(later.load('g1', 0, 0, NOW), { journalHead: HEAD_A, journalEvents: 2, now: NOW });
  const before = bytes(later.manifestFile());
  assert.throws(() => later.retain(stale, { id: 'd', kind: 'artifact', content: 'd' }), /sealed/);
  const kept = later.load('g1', 0, 0, NOW);
  assert.equal(later.verifySeal(kept), true);
  assert.deepEqual(ids(kept), ['a']);
  assert.equal(bytes(later.manifestFile()), before);
  assert.equal(existsSync(path.join(later.dir, 'd')), false);

  // With no manifest file the argument stands in, so a sealed argument is refused as well.
  const none = store('g9');
  assert.throws(() => none.retain(kept, { id: 'e', kind: 'artifact', content: 'e' }), /sealed/);
  assert.equal(existsSync(none.manifestFile()), false);
  assert.equal(existsSync(path.join(none.dir, 'e')), false);
});

test('seal keeps models and host as stated', () => {
  const ev = store();
  ev.retain(ev.load('g1', 0, 0, NOW), { id: 'a', kind: 'artifact', content: 'a' });
  const stale = ev.load('g1', 0, 0, NOW);
  const m1 = [{ role: 'maker', provider: 'claude', model: 'opus' }];
  const m2 = [{ role: 'checker', provider: 'codex', model: 'gpt' }];
  const host = { node: 'v22.18.0', platform: 'win32', aidlc: '0.1.0' };

  const first = ev.seal({ ...stale, models: m1 }, { journalHead: HEAD_A, journalEvents: 2, now: NOW, host });
  assert.deepEqual(ev.load('g1', 0, 0, NOW).models, m1);

  // An argument with models replaces the stored ones; a binding without host keeps the stored host.
  const second = ev.seal({ ...stale, models: m2 }, { journalHead: HEAD_B, journalEvents: 3, now: NOW });
  let stored = ev.load('g1', 0, 0, NOW);
  assert.deepEqual(stored.models, m2);
  assert.deepEqual(stored.host, host);
  assert.notEqual(second.seal, first.seal);
  assert.equal(stored.journalHead, HEAD_B);
  assert.equal(ev.verifySeal(stored), true);

  // An argument without the key keeps the stored models.
  const { models: _dropped, ...noModels } = stale;
  ev.seal(noModels, { journalHead: HEAD_C, journalEvents: 4, now: NOW });
  stored = ev.load('g1', 0, 0, NOW);
  assert.deepEqual(stored.models, m2);
  assert.deepEqual(stored.host, host);
  assert.deepEqual(ids(stored), ['a']);
  assert.equal(ev.verifySeal(stored), true);

  // A seal with no manifest file writes a sealed manifest with the argument's entries.
  const fresh = store('g2');
  const entry: ManifestEntry = { id: 'x', kind: 'artifact', path: 'x', sha256: '0'.repeat(64), bytes: 1 };
  fresh.seal({ schemaVersion: 1, goalId: 'g2', generation: 1, revision: 2, createdAt: NOW, entries: [entry], models: m1 }, { journalHead: HEAD_A, journalEvents: 1, now: NOW });
  const created = fresh.load('g2', 9, 9, NOW);
  assert.deepEqual(ids(created), ['x']);
  assert.equal(created.generation, 1);
  assert.equal(created.revision, 2);
  assert.deepEqual(created.models, m1);
  assert.equal(fresh.verifySeal(created), true);

  // With no file and an argument without models, the sealed manifest has none and its seal verifies once read back.
  const bare = store('g3');
  bare.seal({ schemaVersion: 1, goalId: 'g3', generation: 0, revision: 0, createdAt: NOW, entries: [entry] }, { journalHead: HEAD_A, journalEvents: 1, now: NOW });
  const read = bare.load('g3', 0, 0, NOW);
  assert.deepEqual(read.models, []);
  assert.equal(bare.verifySeal(read), true);
});

test('reserved file names are refused', () => {
  const ev = store();
  ev.retain(ev.load('g1', 0, 0, NOW), { id: 'a', kind: 'artifact', content: 'a' });
  const manifest = bytes(ev.manifestFile());
  const lock = `${ev.manifestFile()}.lock`;
  const refused: Array<[string, string]> = [
    ['manifest.json', 'manifest.json'],
    ['MANIFEST.JSON', 'manifest.json'],
    ['manifest.json.lock', 'manifest.json.lock'],
    ['Manifest.Json.Lock', 'manifest.json.lock'],
    ['manifest.json.tmp-1-abcdef12', 'manifest.json.tmp-'],
    ['MANIFEST.JSON.TMP-9-00000000', 'manifest.json.tmp-'],
    ['manifest.json.tmp-1 2', 'manifest.json.tmp-'],
  ];
  for (const [id, reserved] of refused) {
    assert.throws(
      () => ev.retain(ev.load('g1', 0, 0, NOW), { id, kind: 'artifact', content: 'overwrite' }),
      (err: Error) => err.message.includes(id) && err.message.includes(reserved),
      id,
    );
    assert.equal(bytes(ev.manifestFile()), manifest, id);
    assert.equal(existsSync(lock), false, id);
  }
  assert.deepEqual(readdirSync(ev.dir).sort(), ['a', 'manifest.json']);
  // Names next to the reserved ones are ordinary files.
  for (const [id, name] of [['manifest/json', 'manifest_json'], ['manifest.json.lock2', 'manifest.json.lock2'], ['xmanifest.json', 'xmanifest.json'], ['manifest.jsonx', 'manifest.jsonx']]) {
    const m = ev.retain(ev.load('g1', 0, 0, NOW), { id: id!, kind: 'artifact', content: id });
    assert.equal(m.entries.find((e) => e.id === id)?.path, name);
  }
  const later = ev.retain(ev.load('g1', 0, 0, NOW), { id: 'b', kind: 'artifact', content: 'b' });
  assert.deepEqual(ids(later), ['a', 'manifest/json', 'manifest.json.lock2', 'xmanifest.json', 'manifest.jsonx', 'b']);
  assert.ok(later.entries.every((e) => ev.intact(e)));
});

test('a held lock refuses retain and seal', () => {
  const ev = store();
  ev.retain(ev.load('g1', 0, 0, NOW), { id: 'a', kind: 'artifact', content: 'a' });
  const manifest = bytes(ev.manifestFile());
  const lock = holdLock(ev);
  assert.equal(code(() => ev.retain(ev.load('g1', 0, 0, NOW), { id: 'b', kind: 'artifact', content: 'b' })), 'LOCKED');
  assert.equal(code(() => ev.seal(ev.load('g1', 0, 0, NOW), { journalHead: HEAD_A, journalEvents: 1, now: NOW })), 'LOCKED');
  assert.equal(bytes(ev.manifestFile()), manifest);
  assert.equal(existsSync(path.join(ev.dir, 'b')), false);
  unlinkSync(lock);
  ev.retain(ev.load('g1', 0, 0, NOW), { id: 'b', kind: 'artifact', content: 'b' });
  const sealed = ev.seal(ev.load('g1', 0, 0, NOW), { journalHead: HEAD_A, journalEvents: 1, now: NOW });
  assert.deepEqual(ids(sealed), ['a', 'b']);
  assert.equal(ev.verifySeal(ev.load('g1', 0, 0, NOW)), true);
});

/** A goal of a fixture state directory and the CLI bound to it. */
function cliGoal() {
  const fx = makeFixture();
  fixtures.push(fx);
  writeCard(fx, { id: 'T1-MANIFEST', title: 'retains evidence' });
  const goal = goalForCards(fx, ['T1-MANIFEST']);
  const ev = new EvidenceStore(fx.paths.evidence, goal.id);
  const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, ...args, '--goal', goal.id, '--json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root }, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  const journal = () => bytes(fx.journal(goal.id).file);
  return { fx, goal, ev, cli, journal };
}

test('the CLI refuses under a held lock and journals nothing', () => {
  const { goal, ev, cli, journal } = cliGoal();
  ev.retain(ev.load(goal.id, goal.generation, goal.revision, NOW), { id: 'a', kind: 'artifact', content: 'a' });
  const manifest = bytes(ev.manifestFile());
  const events = journal();
  holdLock(ev);
  const retain = cli('evidence', 'retain', '--id', 'b', '--kind', 'artifact', '--content', 'b');
  assert.notEqual(retain.status, 0);
  assert.match(retain.stderr, /LOCKED/);
  const seal = cli('audit', 'seal');
  assert.notEqual(seal.status, 0);
  assert.match(seal.stderr, /LOCKED/);
  assert.equal(journal(), events);
  assert.equal(bytes(ev.manifestFile()), manifest);
  assert.equal(existsSync(path.join(ev.dir, 'b')), false);
});

test('a manifest that does not parse or fails the schema', () => {
  for (const text of ['{', '{"schemaVersion":2}']) {
    const { goal, ev, cli, journal } = cliGoal();
    mkdirSync(ev.dir, { recursive: true });
    writeFileSync(ev.manifestFile(), text, 'utf8');
    const events = journal();
    let loadError = '';
    try {
      ev.load(goal.id, goal.generation, goal.revision, NOW);
    } catch (err) {
      loadError = (err as Error).message;
    }
    assert.ok(loadError, text);
    const retain = cli('evidence', 'retain', '--id', 'b', '--kind', 'artifact', '--content', 'b');
    assert.notEqual(retain.status, 0, text);
    assert.ok(retain.stderr.includes(loadError), retain.stderr);
    const seal = cli('audit', 'seal');
    assert.notEqual(seal.status, 0, text);
    assert.ok(seal.stderr.includes(loadError), seal.stderr);
    assert.equal(journal(), events, text);
    assert.equal(bytes(ev.manifestFile()), text);
    assert.equal(existsSync(path.join(ev.dir, 'b')), false, text);

    // Called directly with a valid argument, the store's own read refuses and writes nothing.
    const expected = text === '{' ? 'MALFORMED_JSON' : 'SCHEMA_VIOLATION';
    const valid: Manifest = { schemaVersion: 1, goalId: goal.id, generation: 0, revision: 0, createdAt: NOW, entries: [], models: [] };
    assert.equal(code(() => ev.retain(valid, { id: 'c', kind: 'artifact', content: 'c' })), expected, text);
    assert.equal(code(() => ev.seal(valid, { journalHead: HEAD_A, journalEvents: 1, now: NOW })), expected, text);
    assert.equal(bytes(ev.manifestFile()), text);
    assert.deepEqual(readdirSync(ev.dir), ['manifest.json'], text);
  }
});

test('the seal event and the seal bind one manifest', () => {
  const { fx, goal, ev, cli } = cliGoal();
  for (const id of ['a', 'b', 'c']) {
    const r = cli('evidence', 'retain', '--id', id, '--kind', 'artifact', '--content', id);
    assert.equal(r.status, 0, r.stderr);
  }
  const seal = cli('audit', 'seal');
  assert.equal(seal.status, 0, seal.stderr);
  const event = fx.events(goal.id).at(-1)!;
  assert.equal(event.type, 'MANIFEST_SEALED');
  assert.equal((event.data as { entries: number }).entries, 3);
  const sealed = ev.load(goal.id, goal.generation, goal.revision, NOW);
  assert.equal(sealed.journalHead, event.hash);
  assert.equal(sealed.journalEvents, event.seq + 1);
  assert.deepEqual(ids(sealed), ['a', 'b', 'c']);
  const verify = cli('audit', 'verify');
  const [report] = JSON.parse(verify.stdout) as Array<{ manifest?: { sealed: boolean; sealOk: boolean }; findings: Array<{ code: string }> }>;
  assert.deepEqual(report?.manifest && { sealed: report.manifest.sealed, sealOk: report.manifest.sealOk }, { sealed: true, sealOk: true });
  assert.equal(report!.findings.some((f) => f.code === 'MANIFEST_STALE'), false, JSON.stringify(report!.findings));
});

const CHILD = `
const [modUrl, dir, goal, now, ...ids] = process.argv.slice(2);
const { EvidenceStore } = await import(modUrl);
const store = new EvidenceStore(dir, goal);
for (const id of ids) {
  try {
    store.retain(store.load(goal, 0, 0, now), { id, kind: 'artifact', content: id });
    console.log('ok ' + id);
  } catch (err) {
    console.log('err ' + id + ' ' + (err.code ?? err.message) + ' ' + (err.syscall ?? '-') + ' ' + (err.path ? err.path.split(/[\\\\/]/).pop() : '-'));
  }
}
`;

function runChild(script: string, args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { timeout: 120_000, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('concurrent retains lose no entry', async () => {
  const root = tempDir();
  const script = path.join(root, 'retain-child.mjs');
  writeFileSync(script, CHILD, 'utf8');
  const evidence = path.join(root, 'evidence');
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, child) => runChild(script, [MANIFEST_MODULE, evidence, 'g1', NOW, ...[0, 1, 2].map((n) => `c${child}-${n}`)])),
  );
  const lines = results.flatMap((r) => {
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim().split(/\r?\n/);
  });
  assert.equal(lines.length, 24, lines.join('\n'));
  const ev = new EvidenceStore(evidence, 'g1');
  const stored = ev.load('g1', 0, 0, NOW);
  const ok = lines.filter((l) => l.startsWith('ok ')).map((l) => l.slice(3));
  assert.ok(ok.length >= 1, lines.join('\n'));
  for (const id of ok) {
    const entry = stored.entries.find((e) => e.id === id);
    assert.ok(entry && ev.intact(entry), `retained ${id} is in the manifest with an intact file`);
  }
  for (const line of lines.filter((l) => !l.startsWith('ok '))) {
    const [, id, thrown, syscall, file] = line.split(' ');
    // Windows refuses the manifest rename with EPERM while a lockless reader (the load before the section) has the file
    // open; the artifact was copied first and stays without an entry, as the card's non_goals keep it.
    const renameRefused = thrown === 'EPERM' && syscall === 'rename' && file!.startsWith('manifest.json.tmp-');
    const nothingWritten = thrown === 'LOCKED' || (thrown === 'EPERM' && syscall === 'open' && (file === 'manifest.json.lock' || file === 'manifest.json'));
    assert.ok(renameRefused || nothingWritten, line);
    assert.equal(stored.entries.some((e) => e.id === id), false, line);
    if (nothingWritten) assert.equal(existsSync(path.join(ev.dir, id!)), false, line);
  }
  assert.equal(stored.entries.length, ok.length);
});
