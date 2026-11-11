import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { statePathsFromRoot } from '../../src/state/paths.ts';
import * as store from '../../src/state/store.ts';
import { cleanup, ensureStatePaths, tmpDir } from '../infra/helpers.ts';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEAD = 999999999;
const DEAD_LOCK = `pid=${DEAD} at=2026-09-11T10:00:00.000Z nonce=crashed`;
const DEAD_TMP = `.tmp-${DEAD}-0123abcd`;
const OWNER_UNKNOWN = 'lock, owner unknown; delete it only once no aidlc command is running on this state directory';

const roots: string[] = [];
after(() => {
  for (const dir of roots) cleanup(dir);
});
const fresh = (): string => {
  const dir = tmpDir();
  roots.push(dir);
  return dir;
};

/** A state directory with its named children, the heartbeat directory and one goal directory under cards and evidence. */
function stateRoot(): string {
  const root = fresh();
  ensureStatePaths(statePathsFromRoot(root));
  for (const rel of ['heartbeat', 'cards/g-1', 'evidence/g-1']) mkdirSync(path.join(root, rel), { recursive: true });
  return root;
}

function put(root: string, rel: string, text = ''): void {
  const file = path.join(root, ...rel.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const deadLockEntry = (rel: string, pid: number = DEAD): string => `${JSON.stringify(rel)}: lock, pid ${pid} is no longer running; delete ${JSON.stringify(rel)} only once pid ${pid} is confirmed dead, then run the command again`;
const deadTempEntry = (rel: string, pid: number = DEAD): string => `${JSON.stringify(rel)}: temp, pid ${pid} is no longer running`;

const STEMS = ['goals/g-1.json', 'cards/g-1/T0-X.json', 'releases/r-1.json', 'leases/0123456789abcdef.json', 'operations/op-1.json', 'journal/_host.jsonl.append', 'incidents/incidents.json', 'heartbeat/0123456789abcdef', 'evidence/g-1/manifest.json'];

/** The fixture of acceptance 1: a lock and a temp per stem, the review-queue pair and the large pid. */
function plantStems(root: string, pid: number, big: boolean): void {
  for (const stem of STEMS) {
    put(root, `${stem}.lock`, `pid=${pid} at=2026-09-11T10:00:00.000Z nonce=${pid === DEAD ? 'crashed' : 'live'}`);
    put(root, `${stem}.tmp-${pid}-0123abcd`);
  }
  put(root, 'review-queue/_queue.json.lock', `pid=${pid} at=2026-09-11T10:00:00.000Z nonce=x`);
  put(root, `review-queue/_pool-0123456789abcdef.json.tmp-${pid}-0123abcd`);
  if (big) put(root, 'leases/big.json.lock', 'pid=2147483648');
}

/** The 21 entries of the dead-pid fixture in code-unit order of the relative path. */
const DEAD_ENTRIES: string[] = [
  deadLockEntry('cards/g-1/T0-X.json.lock'),
  deadTempEntry(`cards/g-1/T0-X.json${DEAD_TMP}`),
  deadLockEntry('evidence/g-1/manifest.json.lock'),
  deadTempEntry(`evidence/g-1/manifest.json${DEAD_TMP}`),
  deadLockEntry('goals/g-1.json.lock'),
  deadTempEntry(`goals/g-1.json${DEAD_TMP}`),
  deadLockEntry('heartbeat/0123456789abcdef.lock'),
  deadTempEntry(`heartbeat/0123456789abcdef${DEAD_TMP}`),
  deadLockEntry('incidents/incidents.json.lock'),
  deadTempEntry(`incidents/incidents.json${DEAD_TMP}`),
  deadLockEntry('journal/_host.jsonl.append.lock'),
  deadTempEntry(`journal/_host.jsonl.append${DEAD_TMP}`),
  deadLockEntry('leases/0123456789abcdef.json.lock'),
  deadTempEntry(`leases/0123456789abcdef.json${DEAD_TMP}`),
  deadLockEntry('leases/big.json.lock', 2147483648),
  deadLockEntry('operations/op-1.json.lock'),
  deadTempEntry(`operations/op-1.json${DEAD_TMP}`),
  deadLockEntry('releases/r-1.json.lock'),
  deadTempEntry(`releases/r-1.json${DEAD_TMP}`),
  deadTempEntry(`review-queue/_pool-0123456789abcdef.json${DEAD_TMP}`),
  deadLockEntry('review-queue/_queue.json.lock'),
];

/** The lock and temp names of acceptance 5, none of which doctor reads. */
function plantExcluded(root: string): void {
  const dead = `${DEAD_LOCK}`;
  put(root, `evidence/g-1/review/T0-X/T0-X.mutants.pending.json${DEAD_TMP}`, dead);
  put(root, 'evidence/g-1/foo.lock', dead);
  put(root, `evidence/g-1/x${DEAD_TMP}`);
  put(root, 'cards/stray.json.lock', dead);
  put(root, 'evidence/stray.lock', dead);
  put(root, 'cards/g-1/sub/x.json.lock', dead);
  put(root, `board/g-1.md${DEAD_TMP}`);
  put(root, 'x.json.lock', dead);
  put(root, 'goals/g-1.json', '{}');
  put(root, `goals/a.tmp-${DEAD}-0123ABCD`);
  put(root, `goals/a.tmp-${DEAD}-0123abc`);
  put(root, 'goals/a.LOCK', dead);
  put(root, 'goals/a.lockx', dead);
}

/** Every path under `dir` with its bytes (a directory maps to a marker). */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (abs: string, rel: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        out[next] = '<dir>';
        walk(path.join(abs, entry.name), next);
      } else out[next] = readFileSync(path.join(abs, entry.name), 'latin1');
    }
  };
  walk(dir, '');
  return out;
}

const errno = (code: string): Error => Object.assign(new Error(`${code}: simulated`), { code });

type Fn = (...args: unknown[]) => unknown;
type Call = { fn: string; file: string; flag: unknown };
const NOT_HANDLED = Symbol('not handled');
const WATCHED = ['readdirSync', 'readFileSync', 'writeFileSync', 'writeSync', 'appendFileSync', 'unlinkSync', 'rmSync', 'rmdirSync', 'renameSync', 'mkdirSync', 'copyFileSync', 'openSync'] as const;

/** Route the watched `node:fs` functions through a recorder, and through `handle` first (the pattern of tests/infra/update-json.test.ts throughFs). */
function throughFs<T>(handle: (fn: string, args: unknown[], real: Fn) => unknown, body: () => T): { value: T; calls: Call[] } {
  const target = fs as unknown as Record<string, Fn>;
  const real: Record<string, Fn> = {};
  const calls: Call[] = [];
  for (const name of WATCHED) {
    const original = target[name]!;
    real[name] = original;
    target[name] = (...args: unknown[]) => {
      calls.push({ fn: name, file: String(args[0]), flag: args[1] });
      const handled = handle(name, args, original);
      return handled === NOT_HANDLED ? original(...args) : handled;
    };
  }
  syncBuiltinESMExports();
  try {
    return { value: body(), calls };
  } finally {
    for (const name of WATCHED) target[name] = real[name]!;
    syncBuiltinESMExports();
  }
}
const passThrough = (): unknown => NOT_HANDLED;

type Kind = 'file' | 'dir' | 'link';
const dirent = (name: string, kind: Kind) => ({ name, isFile: () => kind === 'file', isDirectory: () => kind === 'dir', isSymbolicLink: () => kind === 'link' });

/** `process.kill` stubbed for one call; restored in a finally. */
function withKill<T>(body: () => T): { value: T; pids: number[] } {
  const real = process.kill;
  const pids: number[] = [];
  process.kill = ((pid: number) => {
    pids.push(pid);
    if (pid === 5151) throw errno('EPERM');
    if (pid === 6161) return true;
    throw errno('ESRCH');
  }) as typeof process.kill;
  try {
    return { value: body(), pids };
  } finally {
    process.kill = real;
  }
}

describe('doctor interruptedWrites (card T0-DOCTOR-INTERRUPTED-WRITES)', () => {
  it('a lock and a temp of a process that is not running are listed in every directory doctor reads', () => {
    const root = stateRoot();
    plantStems(root, DEAD, true);
    const before = snapshot(root);
    const report = store.interruptedWritesReport(statePathsFromRoot(root));
    assert.deepEqual(report, DEAD_ENTRIES);
    assert.ok(DEAD_ENTRIES.includes('"leases/0123456789abcdef.json.lock": lock, pid 999999999 is no longer running; delete "leases/0123456789abcdef.json.lock" only once pid 999999999 is confirmed dead, then run the command again'));
    assert.ok(DEAD_ENTRIES.includes('"goals/g-1.json.tmp-999999999-0123abcd": temp, pid 999999999 is no longer running'));
    assert.ok(DEAD_ENTRIES.includes('"leases/big.json.lock": lock, pid 2147483648 is no longer running; delete "leases/big.json.lock" only once pid 2147483648 is confirmed dead, then run the command again'));
    assert.equal(DEAD_ENTRIES.length, 21);
    assert.deepEqual(snapshot(root), before);
  });

  it('a lock and a temp of a running process are not listed', () => {
    const root = stateRoot();
    plantStems(root, process.pid, false);
    assert.equal(store.interruptedWritesReport(statePathsFromRoot(root)), 'none');
  });

  it('pid rows follow the regex of locked()', () => {
    const root = stateRoot();
    const lockRows: Array<[string, number | 'live' | 'none']> = [
      ['pid=4242 at=x', 4242],
      ['at=x pid=4242', 4242],
      ['owner:pid=4242', 4242],
      ['pid=4242 pid=5151', 4242],
      ['pid=004242', 4242],
      ['pid=4242abc', 4242],
      ['pid=4242.5', 4242],
      ['pid=5151', 'live'],
      ['pid=6161', 'live'],
      ['xpid=4242', 'none'],
      ['_pid=4242', 'none'],
      ['PID=4242', 'none'],
      ['pid=', 'none'],
      ['pid= 4242', 'none'],
      ['pid=-4242', 'none'],
      ['pid=0', 'none'],
      [`pid=${'9'.repeat(400)}`, 'none'],
      ['', 'none'],
      ['   \n', 'none'],
      ['garbage', 'none'],
    ];
    const expected: string[] = [];
    lockRows.forEach(([text, outcome], i) => {
      const rel = `leases/l${String(i).padStart(2, '0')}.json.lock`;
      put(root, rel, text);
      if (outcome === 'none') expected.push(`${JSON.stringify(rel)}: ${OWNER_UNKNOWN}`);
      else if (outcome !== 'live') expected.push(deadLockEntry(rel, outcome));
    });
    for (const name of ['g.json.tmp-4242-0123abcd', 'g.json.tmp-004242-0123abcd', 'g.json.tmp-5151-0123abcd', 'g.json.tmp-0-0123abcd']) put(root, `goals/${name}`);
    const longTemp = `g.json.tmp-${'9'.repeat(400)}-0123abcd`;
    const paths = statePathsFromRoot(root);
    const { value, pids } = withKill(() => throughFs((fn, args, real) => (fn === 'readdirSync' && String(args[0]) === paths.goals ? [...(real(...args) as unknown[]), dirent(longTemp, 'file')] : NOT_HANDLED), () => store.interruptedWritesReport(paths)).value);
    assert.deepEqual(value, [
      `"goals/g.json.tmp-0-0123abcd": temp, no usable pid`,
      deadTempEntry('goals/g.json.tmp-004242-0123abcd', 4242),
      deadTempEntry('goals/g.json.tmp-4242-0123abcd', 4242),
      `${JSON.stringify(`goals/${longTemp}`)}: temp, no usable pid`,
      ...expected,
    ]);
    assert.deepEqual([...new Set(pids)].sort(), [4242, 5151, 6161]);
    assert.ok(pids.every((pid) => pid === 4242 || pid === 5151 || pid === 6161), `only usable pids reach process.kill: ${pids.join(',')}`);
  });

  it('a matching path that is not a regular file is listed and never opened or entered', () => {
    const root = stateRoot();
    mkdirSync(path.join(root, 'leases', 'k.json.lock'));
    put(root, 'leases/k.json.lock/inner.txt', DEAD_LOCK);
    mkdirSync(path.join(root, 'goals', `d.json${DEAD_TMP}`));
    const paths = statePathsFromRoot(root);
    const { value, calls } = throughFs((fn, args, real) => (fn === 'readdirSync' && String(args[0]) === paths.leases ? [...(real(...args) as unknown[]), dirent('s.json.lock', 'link')] : NOT_HANDLED), () => store.interruptedWritesReport(paths));
    assert.deepEqual(value, [`"goals/d.json${DEAD_TMP}": unreadable, not a regular file`, '"leases/k.json.lock": unreadable, not a regular file', '"leases/s.json.lock": unreadable, not a regular file']);
    const touched = [path.join(paths.goals, `d.json${DEAD_TMP}`), path.join(paths.leases, 'k.json.lock'), path.join(paths.leases, 's.json.lock')];
    assert.deepEqual(calls.filter((c) => (c.fn === 'readFileSync' || c.fn === 'readdirSync') && touched.some((t) => c.file === t || c.file.startsWith(t + path.sep))), []);
  });

  it('doctor reads nothing outside its directories and name patterns', () => {
    const root = stateRoot();
    plantExcluded(root);
    assert.equal(store.interruptedWritesReport(statePathsFromRoot(root)), 'none');
  });

  it('a retained file with a manifest name is classified by its name', () => {
    const root = stateRoot();
    put(root, 'evidence/g-1/manifest.json', JSON.stringify({ entries: [{ id: 'report', path: 'manifest.json.lock' }] }));
    put(root, 'evidence/g-1/manifest.json.lock', 'retained report text');
    assert.deepEqual(store.interruptedWritesReport(statePathsFromRoot(root)), [`"evidence/g-1/manifest.json.lock": ${OWNER_UNKNOWN}`]);
  });

  it('the scan reads only what R2 names and mutates nothing', () => {
    const root = stateRoot();
    plantStems(root, DEAD, true);
    plantExcluded(root);
    const paths = statePathsFromRoot(root);
    const before = snapshot(root);
    const { value, calls } = throughFs(passThrough, () => store.interruptedWritesReport(paths));
    assert.deepEqual(value, DEAD_ENTRIES);
    assert.deepEqual(snapshot(root), before);
    const rel = (file: string): string => path.relative(root, file).split(path.sep).join('/');
    for (const call of calls) assert.ok(call.fn === 'readdirSync' || call.fn === 'readFileSync', `a ${call.fn} call on ${call.file}`);
    assert.ok(calls.every((c) => c.fn !== 'openSync' || c.flag === 'r'));
    const listed = calls.filter((c) => c.fn === 'readdirSync').map((c) => (rel(c.file) || '.'));
    assert.deepEqual([...listed].sort(), ['.', 'cards', 'cards/g-1', 'evidence', 'evidence/g-1', 'goals', 'heartbeat', 'incidents', 'journal', 'leases', 'operations', 'releases', 'review-queue'].sort());
    const read = calls.filter((c) => c.fn === 'readFileSync').map((c) => rel(c.file));
    const locks = DEAD_ENTRIES.filter((e) => e.includes(': lock,')).map((e) => (JSON.parse(e.slice(0, e.indexOf('": ') + 1)) as string));
    assert.deepEqual([...read].sort(), [...locks].sort());
  });

  describe('a failure is an entry of its own and the scan goes on', () => {
    const leasesLock = 'leases/0123456789abcdef.json.lock';
    /** The entries of acceptance 1 without those under `prefix`, plus `added`, in code-unit order. */
    const without = (prefix: string, added: Array<[string, string]>): string[] => {
      const rows: Array<[string, string]> = DEAD_ENTRIES.map((e) => [(JSON.parse(e.slice(0, e.indexOf('": ') + 1)) as string), e]);
      const kept = rows.filter(([rel]) => !rel.startsWith(prefix));
      return [...kept, ...added.map(([rel, text]): [string, string] => [rel, `${JSON.stringify(rel)}: ${text}`])].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, e]) => e);
    };
    const run = (handle: (fn: string, args: unknown[], real: Fn) => unknown): { value: 'none' | string[]; calls: Call[] } => {
      const root = stateRoot();
      plantStems(root, DEAD, true);
      const paths = statePathsFromRoot(root);
      const hooked = (fn: string, args: unknown[]): unknown => handle(fn, [path.relative(root, String(args[0])).split(path.sep).join('/') || '.', ...args.slice(1)], () => undefined);
      return throughFs((fn, args) => hooked(fn, args), () => store.interruptedWritesReport(paths));
    };
    const failOn = (fn: string, rel: string, error: Error) => (name: string, args: unknown[]): unknown => {
      if (name === fn && args[0] === rel) throw error;
      return NOT_HANDLED;
    };

    it('cards', () => assert.deepEqual(run(failOn('readdirSync', 'cards', errno('EACCES'))).value, without('cards/', [['cards', 'unreadable, EACCES']])));
    it('evidence', () => assert.deepEqual(run(failOn('readdirSync', 'evidence', errno('EACCES'))).value, without('evidence/', [['evidence', 'unreadable, EACCES']])));
    it('cards/g-1', () => assert.deepEqual(run(failOn('readdirSync', 'cards/g-1', errno('EACCES'))).value, without('cards/g-1/', [['cards/g-1', 'unreadable, EACCES']])));
    it('a lock read that fails', () => assert.deepEqual(run(failOn('readFileSync', leasesLock, errno('EACCES'))).value, without(leasesLock, [[leasesLock, 'unreadable, EACCES']])));
    it('an error without a code', () => assert.deepEqual(run(failOn('readdirSync', 'goals', new Error('no code'))).value, without('goals/', [['goals', 'unreadable, UNREADABLE']])));
    it('a lock gone after the listing', () => assert.deepEqual(run(failOn('readFileSync', leasesLock, errno('ENOENT'))).value, without(leasesLock, [[leasesLock, OWNER_UNKNOWN]])));
    it('the root stops the scan', () => {
      const { value, calls } = run(failOn('readdirSync', '.', errno('EACCES')));
      assert.deepEqual(value, ['".": unreadable, EACCES']);
      assert.equal(calls.length, 1);
    });
    it('a root that is a file (real file system)', () => {
      const file = path.join(fresh(), 'state-file');
      writeFileSync(file, 'x');
      assert.deepEqual(store.interruptedWritesReport(statePathsFromRoot(file)), ['".": unreadable, ENOTDIR']);
    });
    it('a goals entry that is a file (real file system)', () => {
      const root = fresh();
      put(root, 'goals', 'x');
      put(root, 'leases/a.json.lock', DEAD_LOCK);
      assert.deepEqual(store.interruptedWritesReport(statePathsFromRoot(root)), ['"goals": unreadable, ENOTDIR', deadLockEntry('leases/a.json.lock')]);
    });
  });

  it('entries are sorted by code-unit order of the relative path', () => {
    const root = stateRoot();
    for (const rel of ['goals/Z.json.lock', 'goals/a.json.lock', 'cards/g-1/x.json.lock']) put(root, rel, DEAD_LOCK);
    put(root, `goals/B.json${DEAD_TMP}`);
    assert.deepEqual(store.interruptedWritesReport(statePathsFromRoot(root)), [deadLockEntry('cards/g-1/x.json.lock'), deadTempEntry(`goals/B.json${DEAD_TMP}`), deadLockEntry('goals/Z.json.lock'), deadLockEntry('goals/a.json.lock')]);
  });

  it('a name is printed as the listing returned it, JSON-quoted', () => {
    const root = stateRoot();
    const paths = statePathsFromRoot(root);
    const name = `a"b\nc.json${DEAD_TMP}`;
    const { value } = throughFs((fn, args, real) => (fn === 'readdirSync' && String(args[0]) === paths.goals ? [...(real(...args) as unknown[]), dirent(name, 'file')] : NOT_HANDLED), () => store.interruptedWritesReport(paths));
    assert.deepEqual(value, ['"goals/a\\"b\\nc.json.tmp-999999999-0123abcd": temp, pid 999999999 is no longer running']);
  });

  it('a state directory that is missing or empty gives none and creates nothing', () => {
    const missing = path.join(fresh(), 'nope');
    assert.equal(store.interruptedWritesReport(statePathsFromRoot(missing)), 'none');
    assert.equal(existsSync(missing), false);
    const empty = fresh();
    assert.equal(store.interruptedWritesReport(statePathsFromRoot(empty)), 'none');
    assert.deepEqual(readdirSync(empty), []);
  });

  it('the LOCKED messages stay whole for each owner class', () => {
    const dir = fresh();
    const live = `pid=${process.pid} at=2026-09-11T10:00:00.000Z nonce=live`;
    const rows: Array<[string, (lock: string) => string]> = [
      [DEAD_LOCK, (lock) => `${lock} is locked by pid ${DEAD}, which is no longer running; delete ${lock} only once pid ${DEAD} is confirmed dead, then run the command again`],
      [live, () => `locked by another writer (${live}); run the command again`],
      ['', () => 'locked by another writer (unknown owner); run the command again'],
      ['   \n', () => 'locked by another writer (unknown owner); run the command again'],
      ['garbage', () => 'locked by another writer (garbage); run the command again'],
      ['pid=0 at=x', () => 'locked by another writer (pid=0 at=x); run the command again'],
    ];
    rows.forEach(([text, message], i) => {
      const record = path.join(dir, `rec${i}.json`);
      writeFileSync(`${record}.lock`, text);
      assert.throws(
        () => store.updateJson(record, z.unknown(), () => undefined, { timeoutMs: 1 }),
        (err: unknown) => err instanceof store.StoreError && err.code === 'LOCKED' && err.message === `LOCKED: ${message(`${record}.lock`)} (${record})`,
      );
    });
  });

  describe('aidlc doctor', () => {
    const entry = path.join(repo, 'src', 'cli', 'main.ts');
    function childEnv(dir: string, state: string): NodeJS.ProcessEnv {
      const env: NodeJS.ProcessEnv = {};
      for (const [key, value] of Object.entries(process.env)) if (!key.toUpperCase().startsWith('GIT_') && key !== 'NODE_OPTIONS') env[key] = value;
      env['GIT_CEILING_DIRECTORIES'] = [path.dirname(dir), path.dirname(realpathSync.native(dir))].join(path.delimiter);
      env['AIDLC_STATE_DIR'] = state;
      env['AIDLC_SESSION'] = 'doctor-test';
      return env;
    }
    function doctor(dir: string, state: string, flag: '--json' | '--no-json'): { status: number | null; stdout: string; stderr: string } {
      const r = spawnSync(process.execPath, [entry, 'doctor', flag], { cwd: dir, env: childEnv(dir, state), encoding: 'utf8', timeout: 120_000, windowsHide: true });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    }
    /** The fixture of acceptances 13 and 14: a dead lock, a dead temp, a live lock and an excluded temp. */
    function fixture(): { dir: string; state: string } {
      const dir = fresh();
      const state = path.join(dir, 'state');
      mkdirSync(state);
      put(state, 'leases/0123456789abcdef.json.lock', DEAD_LOCK);
      put(state, `goals/g-1.json${DEAD_TMP}`);
      put(state, 'cards/g-1/T0-X.json.lock', `pid=${process.pid} at=2026-09-11T10:00:00.000Z nonce=live`);
      put(state, `evidence/g-1/review/T0-X/T0-X.mutants.pending.json${DEAD_TMP}`);
      return { dir, state };
    }
    const GOALS = `"goals/g-1.json${DEAD_TMP}": temp, pid ${DEAD} is no longer running`;
    const LEASES = deadLockEntry('leases/0123456789abcdef.json.lock');

    it('aidlc doctor --json carries interruptedWrites after stateDir, writes nothing and exits 0', () => {
      const { dir, state } = fixture();
      const before = snapshot(dir);
      const r = doctor(dir, state, '--json');
      assert.equal(r.status, 0, r.stderr);
      const parsed = JSON.parse(r.stdout) as Record<string, unknown>;
      assert.deepEqual(parsed['interruptedWrites'], [GOALS, LEASES]);
      const keys = Object.keys(parsed);
      assert.equal(keys.indexOf('interruptedWrites'), keys.indexOf('stateDir') + 1);
      assert.deepEqual(snapshot(dir), before);
    });

    it('aidlc doctor prints the human lines', () => {
      const { dir, state } = fixture();
      const r = doctor(dir, state, '--no-json');
      assert.equal(r.status, 0, r.stderr);
      const lines = r.stdout.split(/\r?\n/);
      const at = lines.findIndex((l) => l.startsWith('stateDir'));
      assert.ok(at >= 0, r.stdout);
      assert.equal(lines[at + 1], `interruptedWrites ${GOALS}`);
      assert.equal(lines[at + 2], `${' '.repeat(13)}${LEASES}`);
    });

    it('aidlc doctor with no state directory, and with one it cannot read, exits 0', () => {
      const dir = fresh();
      const missing = path.join(dir, 'nostate');
      const a = doctor(dir, missing, '--json');
      assert.equal(a.status, 0, a.stderr);
      assert.equal((JSON.parse(a.stdout) as Record<string, unknown>)['interruptedWrites'], 'none');
      assert.equal(existsSync(missing), false);
      const state = path.join(dir, 'state');
      put(state, 'goals', 'x');
      const b = doctor(dir, state, '--json');
      assert.equal(b.status, 0, b.stderr);
      assert.deepEqual((JSON.parse(b.stdout) as Record<string, unknown>)['interruptedWrites'], ['"goals": unreadable, ENOTDIR']);
    });
  });
});
