import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import fs, { chmodSync, mkdirSync, readdirSync, realpathSync, renameSync, statSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IncidentLedger, intentFromBreach, writeIncidentIntent } from '../../src/maintain/incident.ts';
import { breachIdentity, type BandBreach } from '../../src/maintain/bands.ts';
import { parseIntent } from '../../src/artifacts/intent.ts';
import * as lib from '../../src/index.ts';
import { IncidentLedgerFile, type IncidentRecord } from '../../src/core/types.ts';
import { StoreError } from '../../src/state/store.ts';
import { Journal } from '../../src/state/journal.ts';
import { cleanup, tmpDir } from '../infra/helpers.ts';
import { makeFixture } from '../scenarios/_harness.ts';

const breach: BandBreach = {
  metric: 'ci_test_failure_rate',
  rule: 'WE1',
  sigma: 3,
  side: 'above',
  tier: '3sigma',
  action: 'propose',
  observed: [0.42],
  baseline: { mean: 0.05, std: 0.02, n: 30 },
  at: '2026-09-11T00:00:00.000Z',
  detail: 'one point 18.5σ from baseline mean 0.050',
};
const HOUR = 60 * 60 * 1000;
const t0 = '2026-09-11T00:00:00.000Z';
const later = (h: number) => new Date(Date.parse(t0) + h * HOUR).toISOString();
/**
 * The caller's environment without any name that starts with GIT_, matched without regard to case (Windows names are case-insensitive: `git_dir` is `GIT_DIR`), on every platform:
 * a child process must not inherit the caller's repository selection (a hook, a worktree command) and find another repository than its fixture.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.toUpperCase().startsWith('GIT_')) env[key] = value;
  return env;
}
/**
 * `cleanEnv()`, the state directory, and `GIT_CEILING_DIRECTORIES` set to the parent of `cwd` as given and as `realpathSync.native` returns it (a short 8.3 temporary path on Windows),
 * so that git run in `cwd` never discovers a repository that encloses it: the fixtures are no git repository, and `AIDLC_STATE_DIR` isolates state, not the intent directory.
 */
function childEnv(stateDir: string, cwd: string): NodeJS.ProcessEnv {
  const ceilings = [...new Set([path.dirname(cwd), path.dirname(realpathSync.native(cwd))])];
  return { ...cleanEnv(), AIDLC_STATE_DIR: stateDir, GIT_CEILING_DIRECTORIES: ceilings.join(path.delimiter) };
}

test('shouldFile files once, dedupes within the window, respects dismissal and refiles after the window', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-incident-'));
  const ledger = new IncidentLedger(dir);
  const first = ledger.shouldFile(breach, 6 * HOUR, t0);
  assert.equal(first.file, true);
  assert.equal(first.record.count, 1);
  const id = breachIdentity(breach);
  // without an intent attached yet, a repeat still asks to file
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(1)).file, true);
  ledger.attachIntent(id, 'intent/x.md');
  const again = ledger.shouldFile(breach, 6 * HOUR, later(2));
  assert.equal(again.file, false);
  assert.equal(again.record.count, 3);
  assert.equal(again.record.intentFile, 'intent/x.md');
  // after the window it refiles
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(7)).file, true);
  // dismissed never refiles
  assert.equal(ledger.triage(id, 'dismissed', 'known flaky')?.dismissReason, 'known flaky');
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(20)).file, false);
  assert.equal(ledger.triage('nope', 'fix-now'), undefined);
  assert.ok(existsSync(ledger.file));
});

test('the dedupe window starts at each filing: a breach refiled after the window is deduped again until the next window ends', () => {
  const ledger = new IncidentLedger(mkdtempSync(path.join(tmpdir(), 'aidlc-incident-')));
  const id = breachIdentity(breach);
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, t0).file, true);
  ledger.attachIntent(id, 'intent/x.md', t0);
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(5.9)).file, false);
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(7)).file, true);
  ledger.attachIntent(id, 'intent/y.md', later(7));
  // The second window runs from hour 7, so hours 8 and 12.9 are inside it and hour 13.1 is past it.
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(8)).file, false);
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(12.9)).file, false);
  const third = ledger.shouldFile(breach, 6 * HOUR, later(13.1));
  assert.equal(third.file, true);
  assert.equal(third.record.firstSeen, t0);
  assert.equal(third.record.filedAt, later(7));
});

test('a record filed before filedAt existed keeps its window from firstSeen', () => {
  const ledger = new IncidentLedger(mkdtempSync(path.join(tmpdir(), 'aidlc-incident-')));
  const id = breachIdentity(breach);
  ledger.write({ [id]: { identity: id, firstSeen: t0, lastSeen: t0, count: 1, intentFile: 'intent/x.md', disposition: 'open' } });
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(2)).file, false);
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(7)).file, true);
});

test('intentFromBreach + writeIncidentIntent produce a parseable incident intent', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-intent-'));
  const intent = intentFromBreach(
    breach,
    { summary: 'Test failure rate spiked after the 09:00 deploy.', affected: 'CI pipeline, deploy job', proposedOutcome: 'Quarantine the flaky test or revert the deploy.', openQuestions: ['Was the deploy the cause?'], evidence: ['gh run view 123'] },
    t0,
  );
  assert.equal(intent.source, 'incident');
  assert.equal(intent.status, 'draft');
  assert.ok(intent.problem.includes('Anomaly: one point'));
  assert.ok(intent.constraints.includes('Tier action: propose'));
  const file = writeIncidentIntent(path.join(dir, 'intent'), intent);
  assert.ok(existsSync(file));
  const parsed = parseIntent(readFileSync(file, 'utf8'));
  assert.equal(parsed.ok, true, parsed.problems.join('; '));
  assert.deepEqual(parsed.intent?.openQuestions, ['Was the deploy the cause?']);
  assert.ok(readFileSync(file, 'utf8').includes('source: incident'));
  assert.ok(readFileSync(file, 'utf8').includes('- gh run view 123'));
});

test('aidlc monitor check --file-intent records the filing time on the incident, so the same breach inside the window files nothing', () => {
  const fx = fixture();
  writeFileSync(path.join(fx.tmp, 'bands.yaml'), ['metric: error_rate', 'direction: above', 'min_samples: 8', 'tiers:', '  1sigma: { action: log }', '  2sigma: { action: diagnose, tools: "Read" }', '  3sigma: { action: propose, routes: [pull_request] }', 'dedupe_window_ms: 21600000', ''].join('\n'), 'utf8');
  writeFileSync(path.join(fx.tmp, 'data.json'), JSON.stringify({ baseline: [9, 10, 11, 9, 10, 11, 9, 10, 11, 9, 10, 11], recent: [{ at: '2026-09-11T00:00:00.000Z', value: 14 }] }), 'utf8');
  const check = () => spawnSync(process.execPath, [path.resolve('src/cli/main.ts'), 'monitor', 'check', '--bands', 'bands.yaml', '--data', 'data.json', '--file-intent'], { cwd: fx.tmp, env: childEnv(fx.paths.root, fx.tmp), encoding: 'utf8', timeout: 60_000 });
  const first = check();
  assert.equal(first.status, 0, first.stderr);
  assert.equal((JSON.parse(first.stdout) as { filed: string[] }).filed.length, 1, first.stdout);
  const records = () => Object.values(new IncidentLedger(fx.paths.incidents).read());
  assert.equal(records().length, 1);
  const filed = records()[0]!;
  assert.ok(filed.intentFile);
  // The command passes the time of the check to the ledger: the window of the next check starts there.
  assert.equal(typeof filed.filedAt, 'string');
  assert.equal(filed.filedAt, filed.lastSeen);
  const second = check();
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual((JSON.parse(second.stdout) as { filed: string[] }).filed, []);
  assert.equal(records()[0]!.filedAt, filed.filedAt, 'a deduplicated check leaves the filing time as it was');
  assert.equal(records()[0]!.count, 2);
});

// ---------------------------------------------------------------------------------------------
// Card T0-INCIDENT-INTENT-LEDGER: the ledger schema, the read classes, the whole write, the intent names, the CLI order.
// ---------------------------------------------------------------------------------------------

const scratchRoot = tmpDir('aidlc-incident-t-');
after(() => cleanup(scratchRoot));
let scratchSeq = 0;
/** A new empty directory under the one scratch root, which the `after` hook above removes. */
const scratch = (): string => {
  const dir = path.join(scratchRoot, `d${scratchSeq++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const posixOnly = process.platform === 'win32' || process.getuid?.() === 0 ? 'POSIX mode bits are not enforced on Windows or for uid 0' : false;
const errno = (code: string): Error => Object.assign(new Error(`${code}: injected`), { code });
const fsRecord = fs as unknown as Record<string, unknown>;
/** Route one `node:fs` function through `make(real)` for the length of `body` (the ESM binding of a builtin follows the CJS export after a sync). */
function withFs<T>(name: 'readFileSync' | 'renameSync' | 'writeSync' | 'openSync' | 'statSync', make: (real: (...a: unknown[]) => unknown) => (...a: unknown[]) => unknown, body: () => T): T {
  const real = fsRecord[name] as (...a: unknown[]) => unknown;
  fsRecord[name] = make(real);
  syncBuiltinESMExports();
  try {
    return body();
  } finally {
    fsRecord[name] = real;
    syncBuiltinESMExports();
  }
}
const bytesOf = (file: string): string => readFileSync(file, 'utf8');
const rec = (over: Record<string, unknown> = {}): IncidentRecord => ({ identity: 'm:WE1:above:3sigma', firstSeen: t0, lastSeen: t0, count: 1, disposition: 'open', ...over }) as IncidentRecord;
const without = (key: string): Record<string, unknown> => {
  const r: Record<string, unknown> = { ...rec() };
  delete r[key];
  return r;
};
const diagnosis = { summary: 'Test failure rate spiked.', affected: 'CI pipeline', proposedOutcome: 'Quarantine the flaky test.', openQuestions: ['Was the deploy the cause?'], evidence: ['gh run view 123'] };

test('the ledger schema: a table of the fields R1 names', () => {
  const accepted: Array<[string, unknown]> = [
    ['every required field', rec()],
    ['with intentFile', rec({ intentFile: 'intent/x.md' })],
    ['with filedAt', rec({ filedAt: t0 })],
    ['with dismissReason', rec({ dismissReason: 'known flaky' })],
    ['with all three optional fields', rec({ intentFile: 'i.md', filedAt: t0, dismissReason: 'r' })],
    ['disposition open', rec({ disposition: 'open' })],
    ['disposition fix-now', rec({ disposition: 'fix-now' })],
    ['disposition scheduled', rec({ disposition: 'scheduled' })],
    ['disposition dismissed', rec({ disposition: 'dismissed' })],
    ['an unnamed extra key', rec({ note: 'kept' })],
    ['an impossible date of the right shape (a text pattern, not a calendar check)', rec({ firstSeen: '2026-02-31T00:00:00Z' })],
    ['one to three fraction digits', rec({ lastSeen: '2026-09-11T00:00:00.1Z' })],
  ];
  for (const [name, value] of accepted) {
    const parsed = IncidentLedgerFile.safeParse({ k: value });
    assert.equal(parsed.success, true, `${name}: ${parsed.success ? '' : parsed.error.message}`);
  }
  const refused: Array<[string, unknown]> = [
    ['disposition Dismissed (case-sensitive)', rec({ disposition: 'Dismissed' })],
    ['disposition closed', rec({ disposition: 'closed' })],
    ['count -1', rec({ count: -1 })],
    ['count 1.5', rec({ count: 1.5 })],
    ['count 0', rec({ count: 0 })],
    ['count "1"', rec({ count: '1' })],
    ['identity empty', rec({ identity: '' })],
    ['identity a number', rec({ identity: 3 })],
    ['intentFile null', rec({ intentFile: null })],
    ['intentFile a number', rec({ intentFile: 3 })],
    ['filedAt not a timestamp', rec({ filedAt: 'yesterday' })],
    ['dismissReason a number', rec({ dismissReason: 3 })],
    ['firstSeen with an offset', rec({ firstSeen: '2026-09-11T00:00:00+02:00' })],
    ['firstSeen yesterday', rec({ firstSeen: 'yesterday' })],
    ['lastSeen yesterday', rec({ lastSeen: 'yesterday' })],
    ['four fraction digits', rec({ lastSeen: '2026-09-11T00:00:00.1234Z' })],
    ['missing identity', without('identity')],
    ['missing firstSeen', without('firstSeen')],
    ['missing lastSeen', without('lastSeen')],
    ['missing count', without('count')],
    ['missing disposition', without('disposition')],
    ['a record that is null', null],
    ['a record that is a string', 'x'],
  ];
  for (const [name, value] of refused) assert.equal(IncidentLedgerFile.safeParse({ k: value }).success, false, name);
  for (const [name, whole] of [['an array', []], ['null', null], ['a string', 'x'], ['a number', 3]] as Array<[string, unknown]>) assert.equal(IncidentLedgerFile.safeParse(whole).success, false, name);
  assert.equal(IncidentLedgerFile.safeParse({}).success, true, 'an empty object is an empty ledger');
  assert.deepEqual(IncidentLedgerFile.parse({ k: rec({ note: { nested: 1 } }) })['k'], rec({ note: { nested: 1 } }), 'an unnamed key is kept as read');
});

const ledgerMethods: Array<[string, (l: IncidentLedger) => unknown]> = [
  ['read', (l) => l.read()],
  ['shouldFile', (l) => l.shouldFile(breach, 6 * HOUR, t0)],
  ['attachIntent', (l) => l.attachIntent(breachIdentity(breach), 'intent/x.md', t0)],
  ['triage', (l) => l.triage(breachIdentity(breach), 'dismissed', 'r')],
];
/** Each of read, shouldFile, attachIntent and triage throws a `StoreError` with `code` whose message names the ledger file (and `issuePath` when given). */
function refusesAll(ledger: IncidentLedger, code: string, issuePath: string | undefined, label: string): void {
  for (const [method, run] of ledgerMethods) {
    assert.throws(
      () => run(ledger),
      (err: unknown) => err instanceof StoreError && err.code === code && err.message.includes(ledger.file) && (issuePath === undefined || err.message.includes(issuePath)),
      `${label}: ${method}`,
    );
  }
}

test('a ledger that does not parse is an error naming the file, and nothing is rewritten', () => {
  const cases: Array<[string, Buffer, string, string?]> = [
    ['empty', Buffer.from(''), 'MALFORMED_JSON'],
    ['whitespace', Buffer.from(' \n\t '), 'MALFORMED_JSON'],
    ['cut short', Buffer.from('{'), 'MALFORMED_JSON'],
    ['a byte order mark before {}', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{}')]), 'MALFORMED_JSON'],
    ['an array', Buffer.from('[]'), 'SCHEMA_VIOLATION'],
    ['null', Buffer.from('null'), 'SCHEMA_VIOLATION'],
    ['a string', Buffer.from('"x"'), 'SCHEMA_VIOLATION'],
    ['a number', Buffer.from('3'), 'SCHEMA_VIOLATION'],
    ['a record without count', Buffer.from(JSON.stringify({ k: without('count') })), 'SCHEMA_VIOLATION', 'k.count'],
    ['a record with disposition closed', Buffer.from(JSON.stringify({ k: rec({ disposition: 'closed' }) })), 'SCHEMA_VIOLATION', 'k.disposition'],
  ];
  for (const [label, content, code, issuePath] of cases) {
    const ledger = new IncidentLedger(scratch());
    writeFileSync(ledger.file, content);
    refusesAll(ledger, code, issuePath, label);
    assert.deepEqual(readFileSync(ledger.file), content, `${label}: the bytes are as they were`);
  }
  // A directory at the ledger path.
  const dirLedger = new IncidentLedger(scratch());
  mkdirSync(dirLedger.file);
  refusesAll(dirLedger, 'READ_FAILED', undefined, 'a directory');
  assert.equal(statSync(dirLedger.file).isDirectory(), true);
  // A read error of the file itself (EACCES), injected on fs.readFileSync of the ledger.
  const denied = new IncidentLedger(scratch());
  writeFileSync(denied.file, '{}');
  withFs('readFileSync', (real) => (p, ...rest) => {
    if (String(p) === denied.file) throw errno('EACCES');
    return real(p, ...rest);
  }, () => refusesAll(denied, 'READ_FAILED', undefined, 'EACCES'));
  assert.equal(bytesOf(denied.file), '{}');
  // Absent is an empty ledger and a read creates nothing.
  const absent = new IncidentLedger(path.join(scratch(), 'not-yet'));
  assert.deepEqual(absent.read(), {});
  assert.equal(existsSync(path.dirname(absent.file)), false);
});

test('a ledger written by main (JSON.stringify with two spaces, ISO times from toISOString, no filedAt on an old record) reads back unchanged and the library exports the schema names', () => {
  const written = {
    'a:WE1:above:3sigma': { identity: 'a:WE1:above:3sigma', firstSeen: '2026-09-11T00:00:00.000Z', lastSeen: '2026-09-11T05:59:59.999Z', count: 4, intentFile: 'intent/x.md', disposition: 'open' },
    'a:WE2:below:2sigma': { identity: 'a:WE2:below:2sigma', firstSeen: '2026-09-11T01:02:03.004Z', lastSeen: '2026-09-11T01:02:03.004Z', count: 1, filedAt: '2026-09-11T01:02:03.004Z', disposition: 'dismissed', dismissReason: 'known flaky' },
  };
  const ledger = new IncidentLedger(scratch());
  writeFileSync(ledger.file, JSON.stringify(written, null, 2) + '\n', 'utf8');
  assert.deepEqual(ledger.read(), written);
  assert.equal(ledger.triage('a:WE1:above:3sigma', 'scheduled')?.disposition, 'scheduled');
  assert.equal(JSON.parse(bytesOf(ledger.file))['a:WE2:below:2sigma'].dismissReason, 'known flaky');
  assert.equal(typeof lib.IncidentRecord.safeParse, 'function');
  assert.equal(lib.IncidentLedgerFile.safeParse(written).success, true);
});

test('a stat of the ledger that fails with anything but "no entry" is READ_FAILED naming the file, through all four methods; only ENOENT means absent', () => {
  for (const code of ['ENOTDIR', 'EACCES', 'EPERM', 'ELOOP']) {
    const ledger = new IncidentLedger(scratch());
    writeFileSync(ledger.file, '{}');
    withFs('statSync', (real) => (p, ...rest) => {
      if (String(p) === ledger.file) throw errno(code);
      return real(p, ...rest);
    }, () => refusesAll(ledger, 'READ_FAILED', undefined, code));
    assert.equal(bytesOf(ledger.file), '{}', code);
  }
  const absent = new IncidentLedger(scratch());
  writeFileSync(absent.file, JSON.stringify({ k: rec() }));
  withFs('statSync', (real) => (p, ...rest) => {
    if (String(p) === absent.file) throw errno('ENOENT');
    return real(p, ...rest);
  }, () => assert.deepEqual(absent.read(), {}));
});

test('a ledger path under a regular file: POSIX stat says ENOTDIR and every method refuses with READ_FAILED; Windows stat says no entry, so the path is absent, nothing is read as a record and the write cannot land', () => {
  const file = path.join(scratch(), 'plain');
  writeFileSync(file, 'plain text');
  const ledger = new IncidentLedger(path.join(file, 'incidents'));
  const id = breachIdentity(breach);
  if (process.platform === 'win32') {
    assert.deepEqual(ledger.read(), {});
    assert.equal(ledger.triage(id, 'dismissed'), undefined);
    ledger.attachIntent(id, 'intent/x.md', t0);
    assert.throws(() => ledger.shouldFile(breach, 6 * HOUR, t0), (err: unknown) => !(err instanceof StoreError));
  } else {
    refusesAll(ledger, 'READ_FAILED', undefined, 'under a regular file');
  }
  assert.equal(bytesOf(file), 'plain text');
  assert.equal(statSync(file).isFile(), true);
});

test('a ledger file with mode 0o000, and one in a directory that cannot be searched, are read errors and are never rewritten', { skip: posixOnly }, () => {
  const ledger = new IncidentLedger(path.join(scratch(), 'in'));
  ledger.write({ k: rec() });
  const before = bytesOf(ledger.file);
  try {
    chmodSync(ledger.file, 0o000);
    refusesAll(ledger, 'READ_FAILED', undefined, 'file mode 0o000');
  } finally {
    chmodSync(ledger.file, 0o644);
  }
  try {
    chmodSync(path.dirname(ledger.file), 0o000);
    refusesAll(ledger, 'READ_FAILED', undefined, 'directory mode 0o000');
  } finally {
    chmodSync(path.dirname(ledger.file), 0o755);
  }
  assert.equal(bytesOf(ledger.file), before);
});

/** Ledger texts with an own `__proto__` key at each depth (JSON.parse makes it an own key). */
const PROTO_TEXTS: Array<[string, string, string]> = [
  ['at the top level', '{"__proto__":null}', '__proto__'],
  ['holding a valid record at the top level', `{"__proto__":${JSON.stringify(rec())}}`, '__proto__'],
  ['in a record', JSON.stringify({ k: rec() }).replace('"count":1', '"__proto__":{"x":1},"count":1'), 'k.__proto__'],
  ['deeper in a record', JSON.stringify({ k: rec({ note: { a: [{ b: 1 }] } }) }).replace('{"b":1}', '{"__proto__":1}'), 'k.note.a.0.__proto__'],
];

test('a ledger with an own __proto__ key at any depth is SCHEMA_VIOLATION naming the file and the key, through all four methods and write; a key that merely contains the text is kept', () => {
  for (const [label, text, issuePath] of PROTO_TEXTS) {
    assert.ok(text.includes('__proto__'), label);
    const ledger = new IncidentLedger(scratch());
    writeFileSync(ledger.file, text);
    refusesAll(ledger, 'SCHEMA_VIOLATION', issuePath, label);
    assert.equal(bytesOf(ledger.file), text, label);
    assert.equal(IncidentLedgerFile.safeParse(JSON.parse(text)).success, false, label);
    assert.throws(() => ledger.write(JSON.parse(text) as never), /__proto__/, `${label}: write`);
    assert.equal(bytesOf(ledger.file), text, `${label}: write`);
  }
  // With two offending keys the issue names the first in key order.
  const twoKeys = new IncidentLedger(scratch());
  writeFileSync(twoKeys.file, '{"a":{"__proto__":1},"b":{"__proto__":1}}');
  refusesAll(twoKeys, 'SCHEMA_VIOLATION', 'a.__proto__: an own', 'two keys');
  const kept = { __proto__x: rec({ identity: '__proto__x' }), k: rec({ __proto__y: 1, note: { __proto__z: 2 } }) };
  const ledger = new IncidentLedger(scratch());
  writeFileSync(ledger.file, JSON.stringify(kept));
  assert.deepEqual(ledger.read(), kept);
});

test('the ledger is written whole and only in a form a read accepts', () => {
  const dir = scratch();
  const ledger = new IncidentLedger(dir);
  const id = breachIdentity(breach);
  ledger.write({ [id]: rec({ identity: id }) });
  const before = readFileSync(ledger.file);
  // A write of a ledger that a read would refuse throws and leaves the previous file.
  assert.throws(() => ledger.write({ [id]: rec({ identity: id, count: 0 }) }));
  assert.deepEqual(readFileSync(ledger.file), before);
  assert.throws(() => ledger.write({ [id]: rec({ identity: id, disposition: 'closed' }) }));
  assert.deepEqual(readFileSync(ledger.file), before);
  // A rename onto the ledger that fails leaves the previous bytes and no temporary file.
  withFs('renameSync', (real) => (from, to, ...rest) => {
    if (String(to) === ledger.file) throw errno('EPERM');
    return real(from, to, ...rest);
  }, () => {
    assert.throws(() => ledger.shouldFile(breach, 6 * HOUR, t0), /EPERM/);
    assert.throws(() => ledger.write({ [id]: rec({ identity: id, count: 9 }) }), /EPERM/);
  });
  assert.deepEqual(readFileSync(ledger.file), before);
  assert.deepEqual(readdirSync(dir).filter((name) => name.includes('.tmp-')), []);
  // A successful change leaves no temporary file and keeps a key the schema does not name.
  ledger.write({ [id]: rec({ identity: id, note: 'kept' }) });
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(1)).record['note'], 'kept');
  assert.deepEqual(readdirSync(dir).filter((name) => name.includes('.tmp-')), []);
  const stored = JSON.parse(bytesOf(ledger.file)) as Record<string, Record<string, unknown>>;
  assert.equal(stored[id]!['note'], 'kept');
  assert.equal(stored[id]!['count'], 2);
  // A ledger directory that does not exist yet is created by the write.
  const nested = new IncidentLedger(path.join(dir, 'a', 'b'));
  nested.write({ [id]: rec({ identity: id }) });
  assert.deepEqual(Object.keys(nested.read()), [id]);
});

test('an intent file name that exists is never overwritten', () => {
  const dir = path.join(scratch(), 'intent');
  const intent = intentFromBreach(breach, diagnosis, t0);
  const slug = intent.slug;
  assert.equal(slug, 'incident-ci-test-failure-rate-we1-2026-09-11', 'the base slug is the one main builds');
  const first = writeIncidentIntent(dir, intent);
  const firstBytes = bytesOf(first);
  const second = writeIncidentIntent(dir, intent);
  const third = writeIncidentIntent(dir, intent);
  assert.deepEqual([first, second, third].map((f) => path.basename(f)), [`${slug}.md`, `${slug}-2.md`, `${slug}-3.md`]);
  for (const file of [first, second, third]) {
    const parsed = parseIntent(bytesOf(file));
    assert.equal(parsed.ok, true, parsed.problems.join('; '));
    assert.equal(parsed.intent?.slug, path.basename(file, '.md'));
  }
  assert.equal(bytesOf(first), firstBytes, 'the first file keeps its bytes');
  assert.deepEqual(readdirSync(dir).sort(), [`${slug}-2.md`, `${slug}-3.md`, `${slug}.md`]);
});

test('a base slug cut at 60 characters keeps its name and takes the suffix after the cut', () => {
  const dir = path.join(scratch(), 'intent');
  const intent = intentFromBreach({ ...breach, metric: 'm'.repeat(80) }, diagnosis, t0);
  assert.equal(intent.slug.length, 60);
  assert.deepEqual([writeIncidentIntent(dir, intent), writeIncidentIntent(dir, intent)].map((f) => path.basename(f)), [`${intent.slug}.md`, `${intent.slug}-2.md`]);
});

test('a directory named <slug>.md counts as taken: the first write returns <slug>-2.md', () => {
  const dir = path.join(scratch(), 'intent');
  const intent = intentFromBreach(breach, diagnosis, t0);
  mkdirSync(path.join(dir, `${intent.slug}.md`), { recursive: true });
  const file = writeIncidentIntent(dir, intent);
  assert.equal(path.basename(file), `${intent.slug}-2.md`);
  assert.equal(parseIntent(bytesOf(file)).intent?.slug, `${intent.slug}-2`);
  assert.equal(statSync(path.join(dir, `${intent.slug}.md`)).isDirectory(), true);
});

test('with <slug>.md and <slug>-2.md to <slug>-999.md present the write throws naming the directory and the slug and writes nothing', () => {
  const dir = path.join(scratch(), 'intent');
  const intent = intentFromBreach(breach, diagnosis, t0);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${intent.slug}.md`), 'one');
  for (let n = 2; n <= 999; n++) writeFileSync(path.join(dir, `${intent.slug}-${n}.md`), `n${n}`);
  assert.throws(() => writeIncidentIntent(dir, intent), (err: unknown) => err instanceof Error && err.message.includes(dir) && err.message.includes(intent.slug));
  assert.equal(readdirSync(dir).length, 999);
  assert.equal(bytesOf(path.join(dir, `${intent.slug}-999.md`)), 'n999');
});

test('with every name but <slug>-999.md taken the write returns <slug>-999.md', () => {
  const dir = path.join(scratch(), 'intent');
  const intent = intentFromBreach(breach, diagnosis, t0);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${intent.slug}.md`), 'one');
  for (let n = 2; n <= 998; n++) writeFileSync(path.join(dir, `${intent.slug}-${n}.md`), `n${n}`);
  const file = writeIncidentIntent(dir, intent);
  assert.equal(path.basename(file), `${intent.slug}-999.md`);
  assert.equal(parseIntent(bytesOf(file)).intent?.slug, `${intent.slug}-999`);
});

test('an exclusive create whose write fails leaves the new name taken, keeps the earlier intents and propagates; the next write takes the next suffix', () => {
  const dir = path.join(scratch(), 'intent');
  const intent = intentFromBreach(breach, diagnosis, t0);
  const first = writeIncidentIntent(dir, intent);
  const firstBytes = bytesOf(first);
  assert.throws(
    () => withFs('writeSync', () => () => { throw errno('ENOSPC'); }, () => writeIncidentIntent(dir, intent)),
    /ENOSPC/,
  );
  assert.equal(bytesOf(first), firstBytes);
  assert.equal(existsSync(path.join(dir, `${intent.slug}-2.md`)), true, 'the partly written file stays and its name is taken');
  assert.equal(path.basename(writeIncidentIntent(dir, intent)), `${intent.slug}-3.md`);
  assert.equal(bytesOf(first), firstBytes);
});

test('an EPERM that the exclusive create raises while the path is absent propagates', () => {
  const dir = path.join(scratch(), 'intent');
  const intent = intentFromBreach(breach, diagnosis, t0);
  const target = path.join(dir, `${intent.slug}.md`);
  mkdirSync(dir, { recursive: true });
  assert.throws(
    () => withFs('openSync', (real) => (p, ...rest) => {
      if (String(p) === target) throw errno('EPERM');
      return real(p, ...rest);
    }, () => writeIncidentIntent(dir, intent)),
    /EPERM/,
  );
  assert.deepEqual(readdirSync(dir), []);
});

test('the intent directory classes: absent is created, a regular file or a path under one throws and leaves the file', () => {
  const intent = intentFromBreach(breach, diagnosis, t0);
  const nested = path.join(scratch(), 'a', 'b', 'intent');
  assert.equal(path.basename(writeIncidentIntent(nested, intent)), `${intent.slug}.md`);
  const plain = path.join(scratch(), 'plain');
  writeFileSync(plain, 'plain text');
  assert.throws(() => writeIncidentIntent(plain, intent));
  assert.throws(() => writeIncidentIntent(path.join(plain, 'intent'), intent));
  assert.equal(bytesOf(plain), 'plain text');
});

test('an intent directory that cannot be searched throws and writes nothing', { skip: posixOnly }, () => {
  const parent = scratch();
  const dir = path.join(parent, 'intent');
  mkdirSync(dir);
  const intent = intentFromBreach(breach, diagnosis, t0);
  try {
    chmodSync(parent, 0o000);
    assert.throws(() => writeIncidentIntent(dir, intent));
  } finally {
    chmodSync(parent, 0o755);
  }
  assert.deepEqual(readdirSync(dir), []);
});

const BANDS = ['metric: error_rate', 'direction: both', 'min_samples: 8', 'tiers:', '  1sigma: { action: log }', '  2sigma: { action: diagnose, tools: "Read" }', '  3sigma: { action: propose, routes: [pull_request] }', 'dedupe_window_ms: 21600000', ''].join('\n');
const BASELINE = [9, 10, 11, 9, 10, 11, 9, 10, 11, 9, 10, 11];
/**
 * The child process sees this instant for `new Date()` (no argument), so the date in an intent name is fixed and no run can cross UTC midnight;
 * `Date.now()` and `Date.parse` stay real. Preloaded with `--import` as a data: URL, so no file is needed.
 */
const FIXED_NOW = '2026-09-11T12:00:00.000Z';
const FIXED_DATE_SHIM = `data:text/javascript,${encodeURIComponent(`const Real = Date; globalThis.Date = class extends Real { constructor(...a) { if (a.length === 0) super('${FIXED_NOW}'); else super(...a); } };`)}`;
/** The base slug of every intent these tests file: metric error_rate, rule WE1, the date of FIXED_NOW. */
const SLUG = 'incident-error-rate-we1-2026-09-11';
type Fx = ReturnType<typeof makeFixture>;
/** A fixture whose directory the `after` hook below removes with `cleanup` of tests/infra/helpers.ts, so a failed assertion leaves none. */
const fixtures: Fx[] = [];
const fixture = (): Fx => {
  const fx = makeFixture();
  fixtures.push(fx);
  return fx;
};
after(() => {
  for (const fx of fixtures) cleanup(fx.tmp);
});
/** One `aidlc monitor check` over `recent` values (one point per minute of 2026-09-11); the cwd is the fixture, the clock is FIXED_NOW. */
function monitor(fx: Fx, recent: number[], extra: string[] = ['--file-intent'], dir: string = fx.tmp) {
  writeFileSync(path.join(dir, 'bands.yaml'), BANDS, 'utf8');
  writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ baseline: BASELINE, recent: recent.map((value, i) => ({ at: `2026-09-11T00:0${i}:00.000Z`, value })) }), 'utf8');
  return spawnSync(process.execPath, ['--import', FIXED_DATE_SHIM, path.resolve('src/cli/main.ts'), 'monitor', 'check', '--bands', 'bands.yaml', '--data', 'data.json', ...extra], { cwd: dir, env: childEnv(fx.paths.root, dir), encoding: 'utf8', timeout: 60_000 });
}
const ABOVE = [14];
const BELOW = [6];
const NONE = [10];
const LOG_ONLY = [10.1, 10.1, 10.1, 10.1, 10.1, 10.1, 10.1, 10.1];
const hostJournalText = (fx: Fx): string | null => {
  const file = Journal.host(fx.paths.journal).file;
  return existsSync(file) ? bytesOf(file) : null;
};
const filedOf = (stdout: string): string[] => (JSON.parse(stdout) as { filed: string[] }).filed;

test('aidlc monitor check reads the ledger first: a ledger that does not parse stops the command with the breach output, whatever the breaches', () => {
  const rows: Array<[string, number[], number, string, string]> = [
    ['a propose-tier breach', ABOVE, 1, '{', 'MALFORMED_JSON'],
    ['no breach', NONE, 0, '{', 'MALFORMED_JSON'],
    ['only a log-tier breach', LOG_ONLY, 1, '{', 'MALFORMED_JSON'],
    ['a ledger that is an array', ABOVE, 1, '[]', 'SCHEMA_VIOLATION'],
    ...PROTO_TEXTS.map(([label, text]): [string, number[], number, string, string] => [`an own __proto__ key ${label}`, ABOVE, 1, text, 'SCHEMA_VIOLATION']),
  ];
  for (const [label, recent, breachCount, content, code] of rows) {
    const fx = fixture();
    const ledgerFile = path.join(fx.paths.incidents, 'incidents.json');
    writeFileSync(ledgerFile, content, 'utf8');
    const journalBefore = hostJournalText(fx);
    const result = monitor(fx, recent);
    assert.equal(result.status, 1, `${label}: ${result.stderr}`);
    const printed = JSON.parse(result.stdout) as { breaches: unknown[]; filed: string[] };
    assert.equal(printed.breaches.length, breachCount, `${label}: ${result.stdout}`);
    assert.deepEqual(printed.filed, [], label);
    assert.ok(result.stderr.startsWith('aidlc: '), `${label}: ${result.stderr}`);
    assert.ok(result.stderr.includes(code) && result.stderr.includes('incidents.json'), `${label}: ${result.stderr}`);
    assert.equal(bytesOf(ledgerFile), content, label);
    assert.equal(existsSync(path.join(fx.tmp, 'intent')), false, `${label}: no intent directory`);
    assert.equal(hostJournalText(fx), journalBefore, `${label}: the host journal is as it was`);
  }
});

test('aidlc monitor check with a ledger path under a regular file: POSIX refuses with READ_FAILED for every breach; Windows reports no entry, so only a filing breach fails (the write cannot land) and no intent is filed', () => {
  const rows: Array<[string, number[]]> = [['no breach', NONE], ['only a log-tier breach', LOG_ONLY], ['a propose-tier breach', ABOVE]];
  for (const [label, recent] of rows) {
    const fx = fixture();
    renameSync(fx.paths.incidents, path.join(scratch(), 'moved-incidents'));
    writeFileSync(fx.paths.incidents, 'plain text', 'utf8');
    const journalBefore = hostJournalText(fx);
    const result = monitor(fx, recent);
    if (process.platform !== 'win32') {
      assert.equal(result.status, 1, `${label}: ${result.stderr}`);
      assert.deepEqual(filedOf(result.stdout), [], label);
      assert.ok(result.stderr.startsWith('aidlc: ') && result.stderr.includes('READ_FAILED') && result.stderr.includes('incidents.json'), `${label}: ${result.stderr}`);
    } else if (recent === ABOVE) {
      assert.equal(result.status, 1, `${label}: ${result.stdout}`);
      assert.equal(result.stdout, '', label);
    } else {
      assert.equal(result.status, 0, `${label}: ${result.stderr}`);
      assert.deepEqual(filedOf(result.stdout), [], label);
    }
    assert.equal(bytesOf(fx.paths.incidents), 'plain text', label);
    assert.equal(existsSync(path.join(fx.tmp, 'intent')), false, `${label}: no intent file`);
    assert.equal(hostJournalText(fx), journalBefore, label);
  }
});

test('aidlc monitor check with an incidents directory that cannot be searched refuses with READ_FAILED for every breach', { skip: posixOnly }, () => {
  for (const [label, recent] of [['no breach', NONE], ['only a log-tier breach', LOG_ONLY], ['a propose-tier breach', ABOVE]] as Array<[string, number[]]>) {
    const fx = fixture();
    writeFileSync(path.join(fx.paths.incidents, 'incidents.json'), '{}', 'utf8');
    const journalBefore = hostJournalText(fx);
    let result;
    try {
      chmodSync(fx.paths.incidents, 0o000);
      result = monitor(fx, recent);
    } finally {
      chmodSync(fx.paths.incidents, 0o755);
    }
    assert.equal(result.status, 1, `${label}: ${result.stderr}`);
    assert.deepEqual(filedOf(result.stdout), [], label);
    assert.ok(result.stderr.startsWith('aidlc: ') && result.stderr.includes('READ_FAILED'), `${label}: ${result.stderr}`);
    assert.equal(bytesOf(path.join(fx.paths.incidents, 'incidents.json')), '{}', label);
    assert.equal(existsSync(path.join(fx.tmp, 'intent')), false, label);
    assert.equal(hostJournalText(fx), journalBefore, label);
  }
});

test('aidlc monitor check without --file-intent does not read the ledger', () => {
  const fx = fixture();
  const ledgerFile = path.join(fx.paths.incidents, 'incidents.json');
  writeFileSync(ledgerFile, '{', 'utf8');
  const result = monitor(fx, ABOVE, []);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(bytesOf(ledgerFile), '{');
});

test('aidlc monitor check files the two sides of a metric on one day to two different files and leaves the first unchanged', () => {
  const fx = fixture();
  const one = monitor(fx, ABOVE);
  assert.equal(one.status, 0, one.stderr);
  const [firstFile] = filedOf(one.stdout);
  assert.ok(firstFile);
  assert.equal(path.basename(firstFile), `${SLUG}.md`);
  const firstBytes = bytesOf(firstFile);
  const two = monitor(fx, BELOW);
  assert.equal(two.status, 0, two.stderr);
  const [secondFile] = filedOf(two.stdout);
  assert.ok(secondFile);
  assert.equal(path.basename(secondFile), `${SLUG}-2.md`);
  assert.equal(bytesOf(firstFile), firstBytes);
  assert.equal(parseIntent(bytesOf(secondFile)).ok, true);
  assert.equal(parseIntent(bytesOf(secondFile)).intent?.slug, `${SLUG}-2`);
  assert.equal(readdirSync(path.dirname(firstFile)).length, 2);
});

test('aidlc monitor check refiles one breach after its dedupe window to a second file and leaves the first unchanged', () => {
  const fx = fixture();
  const one = monitor(fx, ABOVE);
  assert.equal(one.status, 0, one.stderr);
  const [firstFile] = filedOf(one.stdout);
  assert.ok(firstFile);
  const firstBytes = bytesOf(firstFile);
  const ledger = new IncidentLedger(fx.paths.incidents);
  const [id] = Object.keys(ledger.read());
  ledger.attachIntent(id!, firstFile, '2026-01-01T00:00:00.000Z');
  const two = monitor(fx, ABOVE);
  assert.equal(two.status, 0, two.stderr);
  const [secondFile] = filedOf(two.stdout);
  assert.ok(secondFile);
  assert.equal(path.basename(firstFile), `${SLUG}.md`);
  assert.equal(path.basename(secondFile), `${SLUG}-2.md`);
  assert.equal(bytesOf(firstFile), firstBytes);
});

test('aidlc monitor check with an intent write that fails exits 1 with nothing attached and nothing journaled', () => {
  const fx = fixture();
  const intentDir = path.join(fx.tmp, 'intent');
  mkdirSync(path.join(intentDir, `${SLUG}.md`), { recursive: true });
  for (let n = 2; n <= 999; n++) mkdirSync(path.join(intentDir, `${SLUG}-${n}.md`));
  const journalBefore = hostJournalText(fx);
  const result = monitor(fx, ABOVE);
  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stderr.includes(SLUG), result.stderr);
  const records = Object.values(new IncidentLedger(fx.paths.incidents).read());
  assert.equal(records.length, 1);
  assert.equal(records[0]!.intentFile, undefined);
  assert.equal(records[0]!.filedAt, undefined);
  assert.equal(hostJournalText(fx), journalBefore);
  assert.equal(readdirSync(intentDir).length, 999);
});

test('a GIT_DIR and GIT_WORK_TREE in the caller environment do not move the intent out of the fixture', () => {
  const other = scratch();
  const init = spawnSync('git', ['init', '-q', other], { encoding: 'utf8', env: cleanEnv() });
  assert.equal(init.status, 0, init.stderr);
  assert.equal(statSync(path.join(other, '.git')).isDirectory(), true, 'the other repository was initialised where the test says');
  const fx = fixture();
  const saved = { GIT_DIR: process.env['GIT_DIR'], GIT_WORK_TREE: process.env['GIT_WORK_TREE'] };
  process.env['GIT_DIR'] = path.join(other, '.git');
  process.env['GIT_WORK_TREE'] = other;
  try {
    const result = monitor(fx, ABOVE);
    assert.equal(result.status, 0, result.stderr);
    const [file] = filedOf(result.stdout);
    assert.ok(file);
    assert.equal(realpathSync.native(path.dirname(file)), realpathSync.native(path.join(fx.tmp, 'intent')));
    assert.equal(existsSync(path.join(other, 'intent')), false);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

/**
 * A ledger text whose record `k` has a `note` that nests `n` containers (objects with the key x, or arrays) around `bottom`.
 * The ledger object is level 1 and the record level 2, so the innermost container is at level 2 + n: n = 62 is exactly 64 deep, n = 63 is 65.
 */
const nested = (n: number, bottom: string, kind: 'object' | 'array' = 'object'): string =>
  JSON.stringify({ k: rec({ note: '@@' }) }).replace('"@@"', () => (kind === 'object' ? '{"x":' : '[').repeat(n) + bottom + (kind === 'object' ? '}' : ']').repeat(n));
/** The text of the issue at the container that passes the limit: its path from the ledger, then the message. */
const limitIssue = (keys: string[]): string => `${keys.join('.')}: nesting deeper than 64 levels`;
const pathOfLevel65 = (key: string): string[] => ['k', 'note', ...Array<string>(62).fill(key)];

test('a ledger nested exactly 64 deep is read, written by write and read back equal, and rewritten by shouldFile; objects and arrays count alike', () => {
  for (const kind of ['object', 'array'] as const) {
    const text = nested(62, '1', kind);
    const expected = JSON.parse(text) as Record<string, unknown>;
    const ledger = new IncidentLedger(scratch());
    writeFileSync(ledger.file, text);
    assert.deepEqual(ledger.read(), expected, kind);
    const copy = new IncidentLedger(scratch());
    copy.write(JSON.parse(text) as never);
    assert.deepEqual(copy.read(), expected, `${kind}: write`);
    assert.equal(ledger.shouldFile(breach, 6 * HOUR, t0).file, true, kind);
    assert.deepEqual(ledger.read()['k'], expected['k'], `${kind}: shouldFile keeps the deep record`);
    assert.equal(Object.keys(ledger.read()).length, 2, kind);
    assert.deepEqual(readdirSync(path.dirname(ledger.file)).filter((name) => name.includes('.tmp-')), []);
  }
});

test('a ledger nested 65 deep, or 6,000 deep, is SCHEMA_VIOLATION naming the file and the container that passes the limit, through all four methods and write, never a RangeError', () => {
  const rows: Array<[string, string, string[]]> = [
    ['objects, 65 deep', nested(63, '1'), pathOfLevel65('x')],
    ['arrays, 65 deep', nested(63, '1', 'array'), pathOfLevel65('0')],
    ['objects, 6,000 deep', nested(6000, '1'), pathOfLevel65('x')],
    ['arrays, 6,000 deep', nested(6000, '1', 'array'), pathOfLevel65('0')],
  ];
  for (const [label, text, keys] of rows) {
    const ledger = new IncidentLedger(scratch());
    writeFileSync(ledger.file, text);
    refusesAll(ledger, 'SCHEMA_VIOLATION', limitIssue(keys), label);
    assert.equal(bytesOf(ledger.file), text, label);
    const issue = IncidentLedgerFile.safeParse(JSON.parse(text));
    assert.equal(issue.success, false, label);
    if (!issue.success) assert.deepEqual(issue.error.issues[0]!.path, keys, label);
    assert.throws(
      () => ledger.write(JSON.parse(text) as never),
      (err: unknown) => err instanceof StoreError && err.code === 'SCHEMA_VIOLATION' && err.message.includes(ledger.file) && err.message.includes(limitIssue(keys)),
      `${label}: write`,
    );
    assert.equal(bytesOf(ledger.file), text, `${label}: write`);
    assert.deepEqual(readdirSync(path.dirname(ledger.file)).filter((name) => name.includes('.tmp-')), [], label);
  }
});

test('a __proto__ key below the nesting limit keeps its issue, and with the limit the issue named is the one the search meets first', () => {
  const deepObject = '{"x":'.repeat(64) + '1' + '}'.repeat(64);
  const rows: Array<[string, string, string]> = [
    ['__proto__ in a container at level 64', nested(61, '{"__proto__":1}'), `${[...pathOfLevel65('x').slice(0, 63), '__proto__'].join('.')}: an own`],
    ['__proto__ in the container at level 65: the limit is met first, at that container', nested(62, '{"__proto__":1}'), limitIssue(pathOfLevel65('x'))],
    ['__proto__ below level 65: the limit is met first', nested(70, '{"__proto__":1}'), limitIssue(pathOfLevel65('x'))],
    ['__proto__ in key a, a 65-deep value in key b: the proto key is first', `{"a":{"__proto__":1},"b":${deepObject}}`, 'a.__proto__: an own'],
    ['a 65-deep value in key a, __proto__ in key b: the limit is first', `{"a":${deepObject},"b":{"__proto__":1}}`, limitIssue(['a', ...Array<string>(63).fill('x')])],
  ];
  for (const [label, text, fragment] of rows) {
    const ledger = new IncidentLedger(scratch());
    writeFileSync(ledger.file, text);
    refusesAll(ledger, 'SCHEMA_VIOLATION', fragment, label);
    assert.equal(bytesOf(ledger.file), text, label);
  }
});

test('aidlc monitor check reads a ledger nested 64 deep, and refuses one nested 65 or 6,000 deep with SCHEMA_VIOLATION and nothing written', () => {
  const rows: Array<[string, string, number[], boolean]> = [
    ['64 deep', nested(62, '1'), NONE, true],
    ['65 deep, no breach', nested(63, '1'), NONE, false],
    ['65 deep, a propose-tier breach', nested(63, '1'), ABOVE, false],
    ['6,000 deep, only a log-tier breach', nested(6000, '1'), LOG_ONLY, false],
  ];
  for (const [label, text, recent, accepted] of rows) {
    const fx = fixture();
    const file = path.join(fx.paths.incidents, 'incidents.json');
    writeFileSync(file, text, 'utf8');
    const journalBefore = hostJournalText(fx);
    const result = monitor(fx, recent);
    assert.equal(result.status, accepted ? 0 : 1, `${label}: ${result.stderr.slice(0, 300)}`);
    assert.deepEqual(filedOf(result.stdout), [], label);
    if (!accepted) {
      assert.ok(result.stderr.startsWith('aidlc: ') && result.stderr.includes('SCHEMA_VIOLATION') && result.stderr.includes('incidents.json') && result.stderr.includes('nesting deeper than 64 levels'), `${label}: ${result.stderr.slice(0, 300)}`);
      assert.ok(!result.stderr.includes('RangeError'), label);
    }
    assert.equal(bytesOf(file), text, label);
    assert.equal(existsSync(path.join(fx.tmp, 'intent')), false, label);
    assert.equal(hostJournalText(fx), journalBefore, label);
  }
});

test('every GIT_ name, in any case, is removed from a child environment and only the ceiling is set', () => {
  const saved = ['git_dir', 'Git_Work_Tree', 'GIT_INDEX_FILE'].map((key) => [key, process.env[key]] as const);
  process.env['git_dir'] = 'x';
  process.env['Git_Work_Tree'] = 'y';
  process.env['GIT_INDEX_FILE'] = 'z';
  try {
    const env = childEnv('state', scratch());
    assert.deepEqual(Object.keys(env).filter((key) => key.toUpperCase().startsWith('GIT_')), ['GIT_CEILING_DIRECTORIES']);
    assert.equal(env['AIDLC_STATE_DIR'], 'state');
    // The same holds in a real child: its environment holds no selector name in any case (on POSIX the lowercase names are different variables that git ignores, and they are removed all the same).
    const child = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(Object.keys(process.env)))'], { env, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual((JSON.parse(child.stdout) as string[]).filter((key) => key.toUpperCase().startsWith('GIT_')), ['GIT_CEILING_DIRECTORIES']);
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('a path that exists and is not a regular file is READ_FAILED from the stat result, before any read, through all four methods', () => {
  const ledger = new IncidentLedger(scratch());
  writeFileSync(ledger.file, JSON.stringify({ k: rec() }));
  let reads = 0;
  withFs('readFileSync', (real) => (p, ...rest) => {
    if (String(p) === ledger.file) reads++;
    return real(p, ...rest);
  }, () => withFs('statSync', (real) => (p, ...rest) => {
    const stats = real(p, ...rest) as fs.Stats;
    return String(p) === ledger.file ? Object.assign(Object.create(stats), { isFile: () => false }) : stats;
  }, () => refusesAll(ledger, 'READ_FAILED', undefined, 'a stat that says not a regular file')));
  assert.equal(reads, 0, 'the ledger was never read');
  const dirLedger = new IncidentLedger(scratch());
  mkdirSync(dirLedger.file);
  refusesAll(dirLedger, 'READ_FAILED', undefined, 'a directory');
});

test('aidlc monitor check with a directory at the ledger path refuses with READ_FAILED for every breach', () => {
  for (const [label, recent] of [['no breach', NONE], ['only a log-tier breach', LOG_ONLY], ['a propose-tier breach', ABOVE]] as Array<[string, number[]]>) {
    const fx = fixture();
    mkdirSync(path.join(fx.paths.incidents, 'incidents.json'));
    const journalBefore = hostJournalText(fx);
    const result = monitor(fx, recent);
    assert.equal(result.status, 1, `${label}: ${result.stderr}`);
    assert.deepEqual(filedOf(result.stdout), [], label);
    assert.ok(result.stderr.startsWith('aidlc: ') && result.stderr.includes('READ_FAILED') && result.stderr.includes('incidents.json'), `${label}: ${result.stderr}`);
    assert.equal(existsSync(path.join(fx.tmp, 'intent')), false, label);
    assert.equal(hostJournalText(fx), journalBefore, label);
  }
});

/** A value for `write`: a valid record whose `note` is an array holding `element` at index 0 as a property that is not enumerable (`Array.prototype.map`, which the store's serializer uses, still visits it). */
const withHiddenElement = (element: unknown): Record<string, unknown> => {
  const note: unknown[] = [];
  Object.defineProperty(note, '0', { value: element, enumerable: false, writable: true, configurable: true });
  return { k: rec({ note }) };
};
/** `m` nested objects around `bottom`, as a value (not text): the innermost container is at level 3 + m below a `note` array at level 3. */
const nestedValue = (m: number, bottom: unknown): unknown => {
  let value = bottom;
  for (let i = 0; i < m; i++) value = { x: value };
  return value;
};

test('write walks an array as the serializer does: a non-enumerable element counts toward the nesting limit and is searched for __proto__', () => {
  // note is level 3, its element's first object level 4: m nested objects put the innermost at level 3 + m.
  const ok = new IncidentLedger(scratch());
  ok.write(withHiddenElement(nestedValue(61, 1)) as never);
  const stored = ok.read()['k']!['note'] as unknown[];
  assert.equal(Array.isArray(stored), true);
  assert.deepEqual(stored, [nestedValue(61, 1)], '64 deep through a non-enumerable element is written and reads back');
  for (const m of [62, 6000]) {
    const ledger = new IncidentLedger(scratch());
    writeFileSync(ledger.file, '{}');
    assert.throws(
      () => ledger.write(withHiddenElement(nestedValue(m, 1)) as never),
      (err: unknown) => err instanceof StoreError && err.code === 'SCHEMA_VIOLATION' && err.message.includes(ledger.file) && err.message.includes(limitIssue(['k', 'note', '0', ...Array<string>(61).fill('x')])),
      `${m} nested objects`,
    );
    assert.equal(bytesOf(ledger.file), '{}', `${m}: the previous ledger is as it was`);
  }
  const proto = new IncidentLedger(scratch());
  assert.throws(
    () => proto.write(withHiddenElement(JSON.parse('{"__proto__":1}')) as never),
    (err: unknown) => err instanceof StoreError && err.code === 'SCHEMA_VIOLATION' && err.message.includes('k.note.0.__proto__: an own'),
  );
});

test('a fixture beneath a git repository: the intent lands in the fixture and the enclosing repository gains no file', () => {
  const outer = scratch();
  const init = spawnSync('git', ['init', '-q', outer], { encoding: 'utf8', env: cleanEnv() });
  assert.equal(init.status, 0, init.stderr);
  const inner = path.join(outer, 'fixture');
  mkdirSync(inner);
  const fx = fixture();
  const result = monitor(fx, ABOVE, ['--file-intent'], inner);
  assert.equal(result.status, 0, result.stderr);
  const [file] = filedOf(result.stdout);
  assert.ok(file);
  assert.equal(realpathSync.native(path.dirname(file)), realpathSync.native(path.join(inner, 'intent')));
  assert.deepEqual(readdirSync(outer).sort(), ['.git', 'fixture'], 'the enclosing repository holds nothing new');
  assert.deepEqual(readdirSync(inner).sort(), ['bands.yaml', 'data.json', 'intent']);
});
