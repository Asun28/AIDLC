import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { OPS_CONFIG_FILE, OperationBinding, REQUIRED_ROLES, executeOperation, loadDeliveryOps, lookupOperation, resolveRoles } from '../../src/delivery/ops.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
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
    const ok = executeOperation(plain, undefined, { runner: scriptedRunner({ 'make build': { stdout: 'built' } }) });
    assert.equal(ok.status, 'succeeded');
    const withPattern = OperationBinding.parse({ role: 'build', command: ['make', 'build'], successPattern: 'Build succeeded' });
    const noPattern = executeOperation(withPattern, undefined, { runner: scriptedRunner({ 'make build': { stdout: 'done' } }) });
    assert.equal(noPattern.status, 'UNKNOWN');
    assert.match(noPattern.detail, /success pattern not observed/);
    const matched = executeOperation(withPattern, undefined, { runner: scriptedRunner({ 'make build': { stdout: 'Build succeeded\n' } }) });
    assert.equal(matched.status, 'succeeded');
  });

  it('executeOperation: an async operation with exit 0 is issued, never succeeded', () => {
    const deploy = OperationBinding.parse({ role: 'deploy', command: ['deploy-tool', 'submit'], async: true, operationIdPattern: 'operation=(\\S+)', targetSelection: 'arg', targetArg: '--env', idempotencyKeyArg: '--key' });
    const seen: string[][] = [];
    const r = executeOperation(deploy, 'staging', {
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
    const asyncFail = executeOperation(deploy, 'staging', { runner: scriptedRunner({ 'deploy-tool submit': { exitCode: 1, stderr: 'rejected' } }) });
    assert.equal(asyncFail.status, 'UNKNOWN');
  });

  it('executeOperation: timeout is UNKNOWN, failure pattern is failed, non-zero sync exit is failed', () => {
    const b = OperationBinding.parse({ role: 'migration-apply', command: ['migrate', 'up'], failurePattern: 'ERROR' });
    const timeout = executeOperation(b, undefined, { runner: scriptedRunner({ 'migrate up': { timedOut: true, exitCode: null } }) });
    assert.equal(timeout.status, 'UNKNOWN');
    assert.match(timeout.detail, /timed out; outcome unknown until reconciled/);
    const failed = executeOperation(b, undefined, { runner: scriptedRunner({ 'migrate up': { stdout: 'ERROR: lock held' } }) });
    assert.equal(failed.status, 'failed');
    assert.match(failed.detail, /failure pattern matched/);
    const nonZero = executeOperation(b, undefined, { runner: scriptedRunner({ 'migrate up': { exitCode: 2 } }) });
    assert.equal(nonZero.status, 'failed');
    assert.equal(nonZero.detail, 'exit 2');
  });

  it('lookupOperation: without a status lookup the outcome is UNKNOWN; with one, patterns decide', () => {
    const noLookup = OperationBinding.parse({ role: 'deploy', command: ['deploy-tool'] });
    assert.equal(lookupOperation(noLookup, 'op-1').status, 'UNKNOWN');
    const withLookup = OperationBinding.parse({ role: 'deploy', command: ['deploy-tool'], statusLookup: ['deploy-tool', 'status', '{id}'], successPattern: 'SUCCEEDED', failurePattern: 'FAILED' });
    const runner = (stdout: string, exitCode = 0) =>
      scriptedRunner({
        'deploy-tool status op-1': { stdout, exitCode },
      });
    assert.equal(lookupOperation(withLookup, 'op-1', runner('state: SUCCEEDED')).status, 'succeeded');
    assert.equal(lookupOperation(withLookup, 'op-1', runner('state: FAILED')).status, 'failed');
    assert.equal(lookupOperation(withLookup, 'op-1', runner('state: in_progress')).status, 'running');
    assert.equal(lookupOperation(withLookup, 'op-1', runner('state: weird')).status, 'UNKNOWN');
    assert.equal(lookupOperation(withLookup, 'op-1', runner('', 1)).status, 'UNKNOWN');
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
});
