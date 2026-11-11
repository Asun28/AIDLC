import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { OPS_CONFIG_FILE, DeliveryOpsConfig, OperationBinding, REQUIRED_ROLES, executeOperation, loadDeliveryOps, lookupOperation, operationCwd, resolveRoles } from '../../src/delivery/ops.ts';
import { scriptedRunner, type SyncRunner } from '../../src/probes/exec.ts';
import { cleanup, tmpDir } from './helpers.ts';

describe('delivery/ops (LC3 provider bindings, three-valued configuration)', () => {
  const dir = tmpDir();
  after(() => cleanup(dir));

  it('loadDeliveryOps: missing file is not-configured, invalid file is unreadable (a failure, never "off"), valid file is configured', () => {
    const missing = loadDeliveryOps(dir);
    assert.equal(missing.status, 'not-configured');
    assert.equal(missing.file, path.join(dir, OPS_CONFIG_FILE));
    const bad = path.join(dir, 'bad');
    writeFileSync(path.join(dir, OPS_CONFIG_FILE), '{ "schemaVersion": 1, "operations": [ { "role": "deploy" } ] }', 'utf8');
    const unreadable = loadDeliveryOps(dir);
    assert.equal(unreadable.status, 'unreadable');
    if (unreadable.status === 'unreadable') assert.match(unreadable.error, /command/);
    writeFileSync(path.join(dir, OPS_CONFIG_FILE), '{ not json', 'utf8');
    assert.equal(loadDeliveryOps(dir).status, 'unreadable');
    writeFileSync(
      path.join(dir, OPS_CONFIG_FILE),
      JSON.stringify({ schemaVersion: 1, environments: { staging: { production: false } }, operations: [{ role: 'deploy', command: ['deploy-tool', 'submit'], async: true, statusLookup: ['deploy-tool', 'status', '{id}'], operationIdPattern: 'operation=(\\S+)' }] }),
      'utf8',
    );
    const configured = loadDeliveryOps(dir);
    assert.equal(configured.status, 'configured');
    if (configured.status === 'configured') {
      assert.equal(configured.config.operations[0]!.timeoutMs, 30 * 60 * 1000);
      assert.equal(configured.config.operations[0]!.targetSelection, 'none');
      assert.equal(configured.config.environments['staging']?.production, false);
    }
    assert.equal(loadDeliveryOps(bad, path.join(bad, 'nope.json')).status, 'not-configured');
  });

  it('resolveRoles reports each required role as configured or NOT CONFIGURED; a missing role fails the target', () => {
    const load = loadDeliveryOps(dir);
    const staging = resolveRoles(load, 'staging');
    assert.equal(staging.ok, false);
    assert.deepEqual(
      staging.roles.map((r) => [r.role, r.status]),
      [
        ['deploy', 'configured'],
        ['status', 'NOT CONFIGURED'],
        ['environment', 'NOT CONFIGURED'],
        ['health', 'NOT CONFIGURED'],
      ],
    );
    assert.equal(staging.roles[0]!.binding?.command[0], 'deploy-tool');
    assert.deepEqual(REQUIRED_ROLES.production, ['deploy', 'status', 'environment', 'health', 'recover']);
    const notConfigured = resolveRoles({ status: 'not-configured', file: 'x' }, 'package');
    assert.equal(notConfigured.ok, false);
    assert.ok(notConfigured.roles.every((r) => r.status === 'NOT CONFIGURED'));
    const unreadable = resolveRoles({ status: 'unreadable', file: 'x', error: 'boom' }, 'migration');
    assert.equal(unreadable.ok, false);
    assert.deepEqual(unreadable.roles, []);
    assert.match(unreadable.problem ?? '', /ops config unreadable: boom/);
    const full = resolveRoles(
      { status: 'configured', file: 'x', config: { schemaVersion: 1, environments: {}, health: [], operations: (['build', 'package'] as const).map((role) => OperationBinding.parse({ role, command: ['make', role] })) } },
      'package',
    );
    assert.equal(full.ok, true);
  });

  it('executeOperation: sync exit 0 is succeeded only when success criteria are observed', () => {
    const plain = OperationBinding.parse({ role: 'build', command: ['make', 'build'] });
    const ok = executeOperation(plain, undefined, { root: dir, runner: scriptedRunner({ 'make build': { stdout: 'built' } }) });
    assert.equal(ok.status, 'succeeded');
    const withPattern = OperationBinding.parse({ role: 'build', command: ['make', 'build'], successPattern: 'Build succeeded' });
    const noPattern = executeOperation(withPattern, undefined, { root: dir, runner: scriptedRunner({ 'make build': { stdout: 'done' } }) });
    assert.equal(noPattern.status, 'UNKNOWN');
    assert.match(noPattern.detail, /success pattern not observed/);
    const matched = executeOperation(withPattern, undefined, { root: dir, runner: scriptedRunner({ 'make build': { stdout: 'Build succeeded\n' } }) });
    assert.equal(matched.status, 'succeeded');
  });

  it('executeOperation: an async operation with exit 0 is issued, never succeeded', () => {
    const deploy = OperationBinding.parse({ role: 'deploy', command: ['deploy-tool', 'submit'], async: true, operationIdPattern: 'operation=(\\S+)', targetSelection: 'arg', targetArg: '--env', idempotencyKeyArg: '--key' });
    const seen: string[][] = [];
    const r = executeOperation(deploy, 'staging', {
      root: dir,
      idempotencyKey: 'k-1',
      runner: (cmd, args) => {
        seen.push([cmd, ...args]);
        return scriptedRunner({ 'deploy-tool submit': { stdout: 'accepted operation=op-77\n' } })(cmd, args);
      },
    });
    assert.equal(r.status, 'issued');
    assert.equal(r.providerOperationId, 'op-77');
    assert.match(r.detail, /exit zero is not completion/);
    assert.deepEqual(seen[0], ['deploy-tool', 'submit', '--env', 'staging', '--key', 'k-1']);
    const asyncFail = executeOperation(deploy, 'staging', { root: dir, runner: scriptedRunner({ 'deploy-tool submit': { exitCode: 1, stderr: 'rejected' } }) });
    assert.equal(asyncFail.status, 'UNKNOWN');
  });

  it('executeOperation: timeout is UNKNOWN, failure pattern is failed, non-zero sync exit is failed', () => {
    const b = OperationBinding.parse({ role: 'migration-apply', command: ['migrate', 'up'], failurePattern: 'ERROR' });
    const timeout = executeOperation(b, undefined, { root: dir, runner: scriptedRunner({ 'migrate up': { timedOut: true, exitCode: null } }) });
    assert.equal(timeout.status, 'UNKNOWN');
    assert.match(timeout.detail, /timed out; outcome unknown until reconciled/);
    const failed = executeOperation(b, undefined, { root: dir, runner: scriptedRunner({ 'migrate up': { stdout: 'ERROR: lock held' } }) });
    assert.equal(failed.status, 'failed');
    assert.match(failed.detail, /failure pattern matched/);
    const nonZero = executeOperation(b, undefined, { root: dir, runner: scriptedRunner({ 'migrate up': { exitCode: 2 } }) });
    assert.equal(nonZero.status, 'failed');
    assert.equal(nonZero.detail, 'exit 2');
  });

  it('lookupOperation: without a status lookup the outcome is UNKNOWN; with one, patterns decide', () => {
    const noLookup = OperationBinding.parse({ role: 'deploy', command: ['deploy-tool'] });
    assert.equal(lookupOperation(noLookup, 'op-1', dir).status, 'UNKNOWN');
    const withLookup = OperationBinding.parse({ role: 'deploy', command: ['deploy-tool'], statusLookup: ['deploy-tool', 'status', '{id}'], successPattern: 'SUCCEEDED', failurePattern: 'FAILED' });
    const runner = (stdout: string, exitCode = 0) =>
      scriptedRunner({
        'deploy-tool status op-1': { stdout, exitCode },
      });
    assert.equal(lookupOperation(withLookup, 'op-1', dir, runner('state: SUCCEEDED')).status, 'succeeded');
    assert.equal(lookupOperation(withLookup, 'op-1', dir, runner('state: FAILED')).status, 'failed');
    assert.equal(lookupOperation(withLookup, 'op-1', dir, runner('state: in_progress')).status, 'running');
    assert.equal(lookupOperation(withLookup, 'op-1', dir, runner('state: weird')).status, 'UNKNOWN');
    assert.equal(lookupOperation(withLookup, 'op-1', dir, runner('', 1)).status, 'UNKNOWN');
  });

  it('T1-PARSE-GUARD acceptance 1: a blank successPattern, failurePattern or operationIdPattern is refused at its path, never read as a pattern [R1]', () => {
    const binding = { role: 'deploy', command: ['deploy-tool', 'submit'] };
    for (const key of ['successPattern', 'failurePattern', 'operationIdPattern']) {
      for (const blank of ['   ', '', '\t']) {
        const r = OperationBinding.safeParse({ ...binding, [key]: blank });
        assert.equal(r.success, false, `${key}: ${JSON.stringify(blank)}`);
        assert.ok(r.error?.issues.some((i) => i.path.join('.') === key), `${key}: the issue names the key`);
      }
      assert.equal(OperationBinding.safeParse({ ...binding, [key]: ' state: done ' }).success, true, `${key}: a pattern with a non-blank character parses`);
    }
  });

  it('a successPattern, failurePattern or operationIdPattern that is no regular expression is refused at its path, before any command can run', () => {
    const binding = { role: 'deploy', command: ['deploy-tool', 'submit'] };
    for (const key of ['successPattern', 'failurePattern', 'operationIdPattern']) {
      for (const bad of ['[', 'operation=(\\S+', '*x']) {
        const r = OperationBinding.safeParse({ ...binding, [key]: bad });
        assert.equal(r.success, false, `${key}: ${bad}`);
        assert.ok(r.error?.issues.some((i) => i.path.join('.') === key && /regular expression/.test(i.message)), `${key}: the issue names the key and the cause`);
      }
      assert.equal(OperationBinding.safeParse({ ...binding, [key]: '^operation=(\\S+)$' }).success, true, key);
    }
  });

  it('operationCwd: one directory for every form of cwd', () => {
    // Card T0-OPS-CWD acceptance 1 [R1]. The rows of the other platform are skipped by process.platform, never deleted.
    const root = path.resolve(dir, 'main-checkout');
    const drive = path.parse(root).root;
    const win = process.platform === 'win32';
    const rows: { on: 'all' | 'win32' | 'posix'; cwd: string | undefined; expected: string }[] = [
      { on: 'all', cwd: undefined, expected: root },
      { on: 'all', cwd: 'ops', expected: path.join(root, 'ops') },
      { on: 'all', cwd: 'ops/sub', expected: path.join(root, 'ops', 'sub') },
      { on: 'all', cwd: '.', expected: root },
      { on: 'all', cwd: '..', expected: path.dirname(root) },
      { on: 'all', cwd: 'my ops', expected: path.join(root, 'my ops') },
      { on: 'all', cwd: 'a\tb', expected: path.join(root, 'a\tb') },
      { on: 'all', cwd: 'a\nb', expected: path.join(root, 'a\nb') },
      { on: 'all', cwd: ' ops ', expected: `${root}${path.sep} ops ` },
      { on: 'all', cwd: '~/ops', expected: path.join(root, '~', 'ops') },
      { on: 'win32', cwd: 'ops\\sub', expected: path.join(root, 'ops', 'sub') },
      { on: 'win32', cwd: '\\ops', expected: path.join(drive, 'ops') },
      { on: 'win32', cwd: '/ops', expected: path.join(drive, 'ops') },
      { on: 'win32', cwd: 'C:\\ops', expected: 'C:\\ops' },
      { on: 'win32', cwd: 'c:\\ops', expected: 'c:\\ops' },
      { on: 'win32', cwd: 'C:/ops', expected: 'C:\\ops' },
      { on: 'win32', cwd: '\\\\server\\share\\ops', expected: '\\\\server\\share\\ops' },
      { on: 'win32', cwd: '\\\\?\\C:\\ops', expected: '\\\\?\\C:\\ops' },
      { on: 'posix', cwd: 'ops\\sub', expected: `${root}/ops\\sub` },
      { on: 'posix', cwd: '/srv/ops', expected: '/srv/ops' },
      { on: 'posix', cwd: 'C:\\ops', expected: `${root}/C:\\ops` },
      { on: 'posix', cwd: 'c:\\ops', expected: `${root}/c:\\ops` },
      { on: 'posix', cwd: 'C:/ops', expected: `${root}/C:/ops` },
      { on: 'posix', cwd: '\\\\server\\share\\ops', expected: `${root}/\\\\server\\share\\ops` },
      { on: 'posix', cwd: '\\\\?\\C:\\ops', expected: `${root}/\\\\?\\C:\\ops` },
      { on: 'posix', cwd: '\\ops', expected: `${root}/\\ops` },
    ];
    for (const row of rows) {
      if (row.on !== 'all' && row.on !== (win ? 'win32' : 'posix')) continue;
      const binding = OperationBinding.parse({ role: 'deploy', command: ['deploy-tool'], ...(row.cwd === undefined ? {} : { cwd: row.cwd }) });
      assert.equal(operationCwd(binding, root), row.expected, `cwd ${JSON.stringify(row.cwd)}`);
    }
  });

  it('a cwd that is not a usable string is refused when the ops file loads', () => {
    // Card T0-OPS-CWD acceptance 2 [R2]: refused on every platform, so a committed file means one thing everywhere.
    const load = (cwd: unknown, name: string) => {
      const file = path.join(dir, `ops-cwd-${name}.json`);
      writeFileSync(file, JSON.stringify({ schemaVersion: 1, operations: [{ role: 'build', command: ['make'] }, { role: 'deploy', command: ['deploy-tool'], cwd }] }), 'utf8');
      return loadDeliveryOps(dir, file);
    };
    const refused: [string, unknown][] = [
      ['null', null],
      ['a number', 3],
      ['an object', {}],
      ['empty', ''],
      ['spaces', '  '],
      ['a tab', '\t'],
      ['a line break', '\n'],
      ['a no-break space', '\u00a0'],
      ['a byte order mark', '\ufeff'],
      ['C:ops', 'C:ops'],
      ['c:ops', 'c:ops'],
      ['C:', 'C:'],
      ['a NUL character', 'ops\u0000x'],
    ];
    for (const [name, cwd] of refused) {
      const r = load(cwd, name.replace(/\W/g, '-'));
      assert.equal(r.status, 'unreadable', name);
      if (r.status === 'unreadable') assert.match(r.error, /cwd/, name);
      const parsed = DeliveryOpsConfig.safeParse({ schemaVersion: 1, operations: [{ role: 'build', command: ['make'] }, { role: 'deploy', command: ['deploy-tool'], cwd }] });
      assert.deepEqual(parsed.error?.issues.map((i) => i.path.join('.')), ['operations.1.cwd'], `${name}: the issue is at operations.1.cwd`);
    }
    for (const cwd of ['C:\\ops', 'c:/ops', 'ops', 'ops dir', '/srv/ops']) assert.equal(load(cwd, `ok-${cwd.replace(/\W/g, '-')}`).status, 'configured', cwd);
  });

  it('a status lookup whose directory does not exist fails to start and reads as UNKNOWN', () => {
    // Card T0-OPS-CWD R5, last sentence: a real process start, no scripted runner.
    const binding = OperationBinding.parse({ role: 'deploy', command: ['deploy-tool'], cwd: 'missing', statusLookup: [process.execPath, '-v'] });
    const looked = lookupOperation(binding, 'op-1', dir);
    assert.equal(looked.status, 'UNKNOWN');
    assert.equal(looked.detail, 'status lookup failed');
    assert.notEqual(looked.receipt?.exitCode, 0);
  });

  it("the template copy of DELIVERY-OPS.md is the repository's", () => {
    // Card T0-OPS-CWD acceptance 7 [R6]: `aidlc init` installs the template, so a repository initialised after this card reads the same rule.
    const read = (file: string) => readFileSync(path.resolve(file), 'utf8').replace(/\r\n/g, '\n');
    const [repository, template] = [read('docs/DELIVERY-OPS.md'), read('templates/docs/DELIVERY-OPS.md')];
    assert.equal(template, repository);
    const copies: [string, string][] = [['docs/DELIVERY-OPS.md', repository], ['templates/docs/DELIVERY-OPS.md', template], ['docs/OPERATIONS.md', read('docs/OPERATIONS.md')]];
    const clauses = [
      'refuses, on every platform, a `cwd` that is not a string',
      'and one that holds a NUL character (U+0000)',
      'so that one form is refused everywhere',
      'Other forms that resolve differently by platform are not refused: a fully qualified Windows form such as `C:\\ops` is that path on Windows and a relative name under the main checkout on POSIX.',
      'the role is bound, the step has no ledger record yet and the publication check passes',
      'it stops with `release-config` before the intent is recorded',
      'A step that already has a ledger record is settled, an unbound role stops NOT CONFIGURED and an unauthorized publication stops `release-auth`, as before',
    ];
    for (const [name, text] of copies) {
      for (const clause of [...clauses, ...(name === 'docs/OPERATIONS.md' ? [] : ['- `cwd` (optional): the directory the command and its status lookup run in, both the same one.'])]) assert.ok(text.includes(clause), `${name} holds: ${clause}`);
    }
    const changelog = read('CHANGELOG.md');
    const start = changelog.indexOf('## Unreleased');
    assert.ok(start >= 0, 'CHANGELOG.md has an Unreleased section');
    const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
    for (const clause of ['and one that holds a NUL character (U+0000)', 'so that one form is refused everywhere', 'the role is bound, the step has no ledger record yet and the publication check passes', 'an unauthorized publication stops `release-auth`, as before']) assert.ok(unreleased.includes(clause), `CHANGELOG.md holds: ${clause}`);
  });

  it('the command and the status lookup of one binding run in one directory', () => {
    // Card T0-OPS-CWD acceptance 3 [R3].
    const root = path.resolve(dir, 'main-checkout');
    const cwds: (string | undefined)[] = [];
    const runner: SyncRunner = (command, args, options) => (cwds.push(options?.cwd), scriptedRunner({ 'deploy-tool': { stdout: 'ok' } })(command, args, options));
    for (const [cwd, expected] of [[undefined, root], ['ops', path.resolve(root, 'ops')]] as const) {
      const binding = OperationBinding.parse({ role: 'deploy', command: ['deploy-tool', 'up'], statusLookup: ['deploy-tool', 'status', '{id}'], ...(cwd === undefined ? {} : { cwd }) });
      cwds.length = 0;
      executeOperation(binding, 'staging', { root, runner });
      assert.deepEqual(cwds, [expected], `command, cwd ${cwd}`);
      lookupOperation(binding, 'op-1', root, runner);
      assert.deepEqual(cwds, [expected, expected], `lookup, cwd ${cwd}`);
    }
  });
});
