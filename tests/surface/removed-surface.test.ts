// Card T1-SWEEP-DEAD-CODE: an unread constant, an unread config field, a target-less enum value, an uncalled function,
// a one-card script and two duplicate plan copies are gone, and the lifecycle repair bound is stated as unenforced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from '../../src/index.ts';
import { ProjectConfig } from '../../src/config.ts';
import { OperationBinding } from '../../src/delivery/ops.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');

test('T1-SWEEP-DEAD-CODE acceptance 1: the library exports neither MAX_LIFECYCLE_REPAIR_CYCLES nor resetRepoIdentityCache [R1] [R4]', () => {
  assert.equal('MAX_LIFECYCLE_REPAIR_CYCLES' in lib, false);
  assert.equal('resetRepoIdentityCache' in lib, false);
  assert.equal(lib.MAX_INTEGRATION_REPAIR_CYCLES, 1);
});

test('T1-SWEEP-DEAD-CODE acceptance 3: the README Limits table states the lifecycle repair bound as unenforced [R1]', () => {
  const readme = read('README.md');
  assert.ok(readme.includes('| Integration repair cycles | 1 | `src/core/arc.ts`, `src/loop/controller.ts` |\n'));
  assert.ok(readme.includes('| Lifecycle repair cycles | 1, stated in the release-health stop directive; not enforced in code | `src/loop/controller.ts` |\n'));
  assert.ok(!readme.includes('Integration / lifecycle'));
});

test('T1-SWEEP-DEAD-CODE acceptance 4: a config that still carries cardPolicy parses and drops it [R2]', () => {
  const parsed = ProjectConfig.parse({ cardPolicy: 'advisory' });
  assert.equal('cardPolicy' in parsed, false);
  assert.equal('cardPolicy' in ProjectConfig.parse({}), false);
});

test('T1-SWEEP-DEAD-CODE acceptance 5: targetSelection config is refused; arg, env and none parse [R3]', () => {
  const binding = (targetSelection: string): unknown => ({ role: 'deploy', command: ['deploy-tool', 'submit'], targetSelection });
  assert.throws(() => OperationBinding.parse(binding('config')));
  for (const value of ['arg', 'env', 'none']) assert.equal(OperationBinding.parse(binding(value)).targetSelection, value);
});

test('T1-SWEEP-DEAD-CODE acceptance 6: the obsolete script and the two duplicate plan copies are deleted; the transfer manifest stays [R5]', () => {
  for (const rel of ['scripts/code-unchanged.mjs', 'docs/plans/PLAN-aidlc-loop-v5.md', 'docs/plans/PLAN-aidlc-loop-v4.md']) assert.equal(existsSync(path.join(root, rel)), false, rel);
  for (const rel of ['docs/plans/PLAN-aidlc-loop.md', 'docs/plans/PLAN-aidlc-loop-v4-archive.md', 'docs/migration/file-transfer-manifest.json']) assert.equal(existsSync(path.join(root, rel)), true, rel);
});

test('T1-SWEEP-DEAD-CODE acceptance 7: the CHANGELOG names the card, the removed exports, the dropped field and the refused value [R6]', () => {
  const changelog = read('CHANGELOG.md');
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  const entry = unreleased.split('\n').find((l) => l.startsWith('- T1-SWEEP-DEAD-CODE: '));
  assert.ok(entry, 'a T1-SWEEP-DEAD-CODE entry');
  for (const name of ['`MAX_LIFECYCLE_REPAIR_CYCLES`', '`resetRepoIdentityCache`', '`cardPolicy`', "`targetSelection: 'config'`", '`scripts/code-unchanged.mjs`', '`docs/plans/PLAN-aidlc-loop-v5.md`', '`docs/plans/PLAN-aidlc-loop-v4.md`']) {
    assert.ok(entry.includes(name), `the entry names ${name}`);
  }
});
