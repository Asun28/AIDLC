// Card T0-SMALL-ISSUES-463-428-ZOD: the zod floor (GHSA-mrhx-c7xc-m3w5) and the two skill descriptions (issue 428).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const read = (file: string): string => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('acceptance 4: the manifest and the lock admit no zod before 4.6.7 [R4]', () => {
  const manifest = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
  const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { version?: string; dependencies?: Record<string, string> }> };
  assert.equal(manifest.dependencies['zod'], '^4.6.7');
  assert.equal(lock.packages['']!.dependencies!['zod'], '^4.6.7');
  const locked = Object.entries(lock.packages).filter(([name]) => name.endsWith('node_modules/zod'));
  assert.deepEqual(locked.map(([name, p]) => [name, p.version]), [['node_modules/zod', '4.6.7']]);
});

const DESCRIPTIONS = {
  tdd: `Test quality reference. Use when asked to add, write or change a test ("add a test for X"), before a card's RED receipt in BUILD, or when judging a test against REVIEW.md dimensions 6 and 11. Not a router: the loop decides when BUILD runs and card-loop.md owns the process rules.`,
  diagnose: 'Diagnosis loop for a failure with no known cause: a red-capable feedback loop first, then ranked hypotheses. Use when asked why a test fails or is flaky, or where an error comes from, and on a routed T0-bugfix card, a card `diagnosis:` field or a DoD/CI failure, after `aidlc goal new` or `aidlc ci classify` has routed it; intake stays with aidlc-loop.',
};

test('acceptance 5: both copies of the tdd and diagnose skills carry the description of the card [R5]', () => {
  for (const dir of ['.claude', 'templates/claude']) {
    for (const [name, description] of Object.entries(DESCRIPTIONS)) {
      const front = parse(read(`${dir}/skills/${name}/SKILL.md`).split('\n---\n')[0]!.replace(/^---\n/, '')) as { description: string };
      assert.equal(front.description.trim(), description, `${dir} ${name}`);
    }
  }
});
