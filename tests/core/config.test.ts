import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectConfig } from '../../src/config.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const REQUIRED = ['check (ubuntu-latest, 22)', 'check (windows-latest, 22)', 'build-test', 'Gitleaks (committed history)'];

describe('project config: github ship block (T1-LOOP-GATES R8)', () => {
  test('defaults: no required checks, a verdict is required, polling limits unset', () => {
    const c = ProjectConfig.parse({});
    assert.deepEqual(c.github.requiredChecks, []);
    assert.equal(c.github.requireVerdict, true);
    assert.equal(c.github.ciTimeoutMs, undefined);
    assert.equal(c.github.ciPollMs, undefined);
  });

  test('the block parses with every key and rejects non-positive limits', () => {
    const c = ProjectConfig.parse({ github: { requiredChecks: ['ci'], requireVerdict: false, ciTimeoutMs: 1000, ciPollMs: 10 } });
    assert.deepEqual(c.github.requiredChecks, ['ci']);
    assert.equal(c.github.requireVerdict, false);
    assert.equal(c.github.ciTimeoutMs, 1000);
    assert.equal(c.github.ciPollMs, 10);
    assert.throws(() => ProjectConfig.parse({ github: { ciPollMs: 0 } }));
    assert.throws(() => ProjectConfig.parse({ github: { requiredChecks: 'ci' } }));
  });

  test('a waived verdict requirement conflicts with a required review gate', () => {
    assert.throws(() => ProjectConfig.parse({ gateRequired: true, github: { requireVerdict: false } }), /requireVerdict/);
    assert.equal(ProjectConfig.parse({ gateRequired: false, github: { requireVerdict: false } }).github.requireVerdict, false);
    assert.equal(ProjectConfig.parse({ gateRequired: true }).github.requireVerdict, true);
  });

  test('this repository requires its four unconditional check runs; the template requires none', () => {
    const repo = ProjectConfig.parse(JSON.parse(readFileSync(path.join(root, 'aidlc.config.json'), 'utf8')));
    assert.deepEqual(repo.github.requiredChecks, REQUIRED);
    assert.equal(repo.github.requireVerdict, true);
    const tpl = ProjectConfig.parse(JSON.parse(readFileSync(path.join(root, 'templates', 'aidlc.config.json'), 'utf8')));
    assert.deepEqual(tpl.github.requiredChecks, []);
    assert.equal(tpl.github.requireVerdict, true);
  });
});
