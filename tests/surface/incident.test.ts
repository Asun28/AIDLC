import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IncidentLedger, intentFromBreach, writeIncidentIntent } from '../../src/maintain/incident.ts';
import { breachIdentity, type BandBreach } from '../../src/maintain/bands.ts';
import { parseIntent } from '../../src/artifacts/intent.ts';
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
  const fx = makeFixture();
  try {
    writeFileSync(path.join(fx.tmp, 'bands.yaml'), ['metric: error_rate', 'direction: above', 'min_samples: 8', 'tiers:', '  1sigma: { action: log }', '  2sigma: { action: diagnose, tools: "Read" }', '  3sigma: { action: propose, routes: [pull_request] }', 'dedupe_window_ms: 21600000', ''].join('\n'), 'utf8');
    writeFileSync(path.join(fx.tmp, 'data.json'), JSON.stringify({ baseline: [9, 10, 11, 9, 10, 11, 9, 10, 11, 9, 10, 11], recent: [{ at: '2026-09-11T00:00:00.000Z', value: 14 }] }), 'utf8');
    const check = () => spawnSync(process.execPath, [path.resolve('src/cli/main.ts'), 'monitor', 'check', '--bands', 'bands.yaml', '--data', 'data.json', '--file-intent'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root }, encoding: 'utf8', timeout: 60_000 });
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
  } finally {
    fx.cleanup();
  }
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
function withFs<T>(name: 'readFileSync' | 'renameSync' | 'writeSync' | 'openSync', make: (real: (...a: unknown[]) => unknown) => (...a: unknown[]) => unknown, body: () => T): T {
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
  const id = breachIdentity(breach);
  const methods: Array<[string, (l: IncidentLedger) => unknown]> = [
    ['read', (l) => l.read()],
    ['shouldFile', (l) => l.shouldFile(breach, 6 * HOUR, t0)],
    ['attachIntent', (l) => l.attachIntent(id, 'intent/x.md', t0)],
    ['triage', (l) => l.triage(id, 'dismissed', 'r')],
  ];
  const refuses = (ledger: IncidentLedger, code: string, issuePath: string | undefined, label: string): void => {
    for (const [method, run] of methods) {
      assert.throws(
        () => run(ledger),
        (err: unknown) => err instanceof StoreError && err.code === code && err.message.includes(ledger.file) && (issuePath === undefined || err.message.includes(issuePath)),
        `${label}: ${method}`,
      );
    }
  };
  for (const [label, content, code, issuePath] of cases) {
    const ledger = new IncidentLedger(scratch());
    writeFileSync(ledger.file, content);
    refuses(ledger, code, issuePath, label);
    assert.deepEqual(readFileSync(ledger.file), content, `${label}: the bytes are as they were`);
  }
  // A directory at the ledger path.
  const dirLedger = new IncidentLedger(scratch());
  mkdirSync(dirLedger.file);
  refuses(dirLedger, 'READ_FAILED', undefined, 'a directory');
  assert.equal(statSync(dirLedger.file).isDirectory(), true);
  // A read error of the file itself (EACCES), injected on fs.readFileSync of the ledger.
  const denied = new IncidentLedger(scratch());
  writeFileSync(denied.file, '{}');
  withFs('readFileSync', (real) => (p, ...rest) => {
    if (String(p) === denied.file) throw errno('EACCES');
    return real(p, ...rest);
  }, () => refuses(denied, 'READ_FAILED', undefined, 'EACCES'));
  assert.equal(bytesOf(denied.file), '{}');
  // Absent is an empty ledger and a read creates nothing.
  const absent = new IncidentLedger(path.join(scratch(), 'not-yet'));
  assert.deepEqual(absent.read(), {});
  assert.equal(existsSync(path.dirname(absent.file)), false);
});

test('a ledger under a regular file reads as absent and no write lands: the write throws and the file keeps its bytes', () => {
  const file = path.join(scratch(), 'plain');
  writeFileSync(file, 'plain text');
  const ledger = new IncidentLedger(path.join(file, 'incidents'));
  assert.deepEqual(ledger.read(), {});
  assert.throws(() => ledger.shouldFile(breach, 6 * HOUR, t0));
  assert.equal(bytesOf(file), 'plain text');
});

test('a ledger file with mode 0o000 is a read error, and one in a directory that cannot be searched reads as absent and is never rewritten', { skip: posixOnly }, () => {
  const ledger = new IncidentLedger(path.join(scratch(), 'in'));
  ledger.write({ k: rec() });
  const before = bytesOf(ledger.file);
  try {
    chmodSync(ledger.file, 0o000);
    assert.throws(() => ledger.shouldFile(breach, 6 * HOUR, t0), (err: unknown) => err instanceof StoreError && err.code === 'READ_FAILED' && err.message.includes(ledger.file));
  } finally {
    chmodSync(ledger.file, 0o644);
  }
  try {
    chmodSync(path.dirname(ledger.file), 0o000);
    // The parent cannot be searched, so existsSync is false and the file reads as absent; the write cannot land either.
    assert.deepEqual(ledger.read(), {});
    assert.throws(() => ledger.shouldFile(breach, 6 * HOUR, t0));
  } finally {
    chmodSync(path.dirname(ledger.file), 0o755);
  }
  assert.equal(bytesOf(ledger.file), before);
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
  }, () => assert.throws(() => ledger.shouldFile(breach, 6 * HOUR, t0), /EPERM/));
  assert.deepEqual(readFileSync(ledger.file), before);
  assert.deepEqual(readdirSync(dir).filter((name) => name.includes('.tmp-')), []);
  // A successful change leaves no temporary file and keeps a key the schema does not name.
  ledger.write({ [id]: rec({ identity: id, note: 'kept' }) });
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(1)).record['note'], 'kept');
  assert.deepEqual(readdirSync(dir).filter((name) => name.includes('.tmp-')), []);
  const stored = JSON.parse(bytesOf(ledger.file)) as Record<string, Record<string, unknown>>;
  assert.equal(stored[id]!['note'], 'kept');
  assert.equal(stored[id]!['count'], 2);
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
type Fx = ReturnType<typeof makeFixture>;
/** One `aidlc monitor check` over `recent` values (one point per minute of 2026-09-11); the cwd is the fixture. */
function monitor(fx: Fx, recent: number[], extra: string[] = ['--file-intent']) {
  writeFileSync(path.join(fx.tmp, 'bands.yaml'), BANDS, 'utf8');
  writeFileSync(path.join(fx.tmp, 'data.json'), JSON.stringify({ baseline: BASELINE, recent: recent.map((value, i) => ({ at: `2026-09-11T00:0${i}:00.000Z`, value })) }), 'utf8');
  return spawnSync(process.execPath, [path.resolve('src/cli/main.ts'), 'monitor', 'check', '--bands', 'bands.yaml', '--data', 'data.json', ...extra], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root }, encoding: 'utf8', timeout: 60_000 });
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
  for (const [label, recent, breachCount] of [['a propose-tier breach', ABOVE, 1], ['no breach', NONE, 0], ['only a log-tier breach', LOG_ONLY, 1]] as Array<[string, number[], number]>) {
    const fx = makeFixture();
    try {
      const ledgerFile = path.join(fx.paths.incidents, 'incidents.json');
      writeFileSync(ledgerFile, '{', 'utf8');
      const journalBefore = hostJournalText(fx);
      const result = monitor(fx, recent);
      assert.equal(result.status, 1, `${label}: ${result.stderr}`);
      const printed = JSON.parse(result.stdout) as { breaches: unknown[]; filed: string[] };
      assert.equal(printed.breaches.length, breachCount, `${label}: ${result.stdout}`);
      assert.deepEqual(printed.filed, [], label);
      assert.ok(result.stderr.startsWith('aidlc: '), `${label}: ${result.stderr}`);
      assert.ok(result.stderr.includes('MALFORMED_JSON') && result.stderr.includes('incidents.json'), `${label}: ${result.stderr}`);
      assert.equal(bytesOf(ledgerFile), '{', label);
      assert.equal(existsSync(path.join(fx.tmp, 'intent')), false, `${label}: no intent directory`);
      assert.equal(hostJournalText(fx), journalBefore, `${label}: the host journal is as it was`);
    } finally {
      fx.cleanup();
    }
  }
});

test('aidlc monitor check without --file-intent does not read the ledger', () => {
  const fx = makeFixture();
  try {
    const ledgerFile = path.join(fx.paths.incidents, 'incidents.json');
    writeFileSync(ledgerFile, '{', 'utf8');
    const result = monitor(fx, ABOVE, []);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(bytesOf(ledgerFile), '{');
  } finally {
    fx.cleanup();
  }
});

test('aidlc monitor check files the two sides of a metric on one day to two different files and leaves the first unchanged', () => {
  const fx = makeFixture();
  try {
    const one = monitor(fx, ABOVE);
    assert.equal(one.status, 0, one.stderr);
    const [firstFile] = filedOf(one.stdout);
    assert.ok(firstFile);
    const firstBytes = bytesOf(firstFile);
    const two = monitor(fx, BELOW);
    assert.equal(two.status, 0, two.stderr);
    const [secondFile] = filedOf(two.stdout);
    assert.ok(secondFile);
    assert.notEqual(secondFile, firstFile);
    assert.equal(bytesOf(firstFile), firstBytes);
    assert.equal(parseIntent(bytesOf(secondFile)).ok, true);
    assert.equal(parseIntent(bytesOf(secondFile)).intent?.slug, path.basename(secondFile, '.md'));
    assert.equal(readdirSync(path.dirname(firstFile)).length, 2);
  } finally {
    fx.cleanup();
  }
});

test('aidlc monitor check refiles one breach after its dedupe window to a second file and leaves the first unchanged', () => {
  const fx = makeFixture();
  try {
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
    assert.notEqual(secondFile, firstFile);
    assert.equal(bytesOf(firstFile), firstBytes);
  } finally {
    fx.cleanup();
  }
});

test('aidlc monitor check with an intent write that fails exits 1 with nothing attached and nothing journaled', () => {
  const learn = makeFixture();
  let slug: string;
  try {
    const result = monitor(learn, ABOVE);
    assert.equal(result.status, 0, result.stderr);
    slug = path.basename(filedOf(result.stdout)[0]!, '.md');
  } finally {
    learn.cleanup();
  }
  const fx = makeFixture();
  try {
    const intentDir = path.join(fx.tmp, 'intent');
    mkdirSync(path.join(intentDir, `${slug}.md`), { recursive: true });
    for (let n = 2; n <= 999; n++) mkdirSync(path.join(intentDir, `${slug}-${n}.md`));
    const journalBefore = hostJournalText(fx);
    const result = monitor(fx, ABOVE);
    assert.equal(result.status, 1, result.stdout);
    assert.ok(result.stderr.includes(slug), result.stderr);
    const records = Object.values(new IncidentLedger(fx.paths.incidents).read());
    assert.equal(records.length, 1);
    assert.equal(records[0]!.intentFile, undefined);
    assert.equal(records[0]!.filedAt, undefined);
    assert.equal(hostJournalText(fx), journalBefore);
    assert.equal(readdirSync(intentDir).length, 999);
  } finally {
    fx.cleanup();
  }
});
