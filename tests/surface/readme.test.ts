import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sentence = 'aidlc is not an implementation of the AWS AI-DLC methodology; it is a driver-agnostic bounded-autonomy control plane for coding agents.';
const original = 'AI-native SDLC orchestrator in TypeScript. It implements the Anthropic AI-native SDLC playbook loop, intent -> spec -> plan -> cards -> diff -> review -> release -> incident, with the bounded autonomy of the v5 plan in `docs/plans/PLAN-aidlc-loop.md`: sized routing (T0-bugfix/T0/T1/T2), one coordinator per goal, shared-session leases and review admission, hard admission deadlines, bounded review/CI/effort retries, opt-in release and migration stages, and a hash-chained evidence journal that an independent verifier can check. Every `aidlc next` call returns exactly one typed directive; the agent (Claude Code or any other driver) performs that move and reports the result.';

test('T1-README-SCOPE: the opening paragraph adds the scope sentence and preserves its existing text', () => {
  const paragraphs = read('README.md').trim().split(/\n\s*\n/);
  assert.equal(paragraphs[0], '# aidlc');
  assert.equal(paragraphs[1], `${original} ${sentence}`);
  const patterns = read('docs/ARCHITECTURE.md').split('## Patterns borrowed\n')[1]?.split('\n## ')[0];
  assert.ok(patterns?.includes('- AWS AI-DLC workflows: exactly one typed directive per engine call, the read/write split between `next` and `report`, six-state stage bookkeeping.'));
});

test('T1-README-SCOPE: Unreleased records the clarification in plain prose', () => {
  const unreleased = read('CHANGELOG.md').split('## Unreleased\n')[1]?.split('\n## ')[0];
  const entry = '- T1-README-SCOPE: clarify in the README opening paragraph that aidlc is a driver-agnostic bounded-autonomy control plane for coding agents, not an implementation of the AWS AI-DLC methodology.';
  assert.ok(unreleased?.includes(entry));
  assert.doesNotMatch(sentence + entry, /[\u2014\u300c\u300d]/u);
});
