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

// Card T1-SWEEP2-DUPLICATES: the test-only copies of rules production enforces another way are gone, and the
// traceability rows that cited them cite the production code and its scenario tests.
test('T1-SWEEP2-DUPLICATES acceptance 1: the library exports none of the seven copies and keeps the production rules; CardRunner has no classify or newId [R1] [R2]', () => {
  for (const name of ['CARD_TRANSITIONS', 'isCardTransitionAllowed', 'applyCardDecision', 'tagActionRequiresAuthority', 'MAX_COUNTED_ATTEMPTS', 'goalDoneEvidence', 'DEFAULT_BANDS_YAML']) {
    assert.equal(name in lib, false, `${name} is not exported`);
  }
  for (const name of ['selectCardState', 'MAX_BASELINE_ATTEMPTS', 'stagesForTarget', 'parseBandsYaml']) assert.equal(name in lib, true, `${name} is still exported`);
  assert.equal(Object.hasOwn(lib.CardRunner, 'classify'), false, 'CardRunner.classify');
  assert.equal(Object.hasOwn(lib.CardRunner, 'newId'), false, 'CardRunner.newId');
});

test('T1-SWEEP2-DUPLICATES acceptance 6: the traceability rows cite the production code and the new tests; the CHANGELOG names the card and the nine removed names [R5]', () => {
  const trace = read('docs/REQUIREMENTS-TRACEABILITY.md');
  assert.ok(!trace.includes('goalDoneEvidence'), 'no row cites goalDoneEvidence');
  assert.ok(!trace.includes('tagActionRequiresAuthority'), 'no row cites tagActionRequiresAuthority');
  const rows = [
    '| LC11 overall DONE respects the selected target | `src/core/goal-machine.ts` (`stagesForTarget`), `src/loop/controller.ts` (`nextInClose`) | `tests/core/goal-machine.test.ts` (Q15), `tests/scenarios/goal-close-stages.test.ts` | implemented |\n',
    '| Q11 lifecycle: required UI/security/data/package proof cannot be omitted | `src/loop/controller.ts` (`nextInClose`) | `tests/scenarios/goal-close-stages.test.ts` | partial: stage gating only; UI/security proof binding is project-specific |\n',
    '| Q17 production authority gates all external effects incl. tag-triggered CD | `src/core/authorization.ts`, `src/core/release-machine.ts` (`assertReleaseTransition`), `src/loop/release-runner.ts` (`issue`, `triggersPublication`) | `tests/core/authorization.test.ts`, `tests/core/release-machine.test.ts`, `tests/scenarios/release-publication.test.ts` | implemented |\n',
  ];
  for (const row of rows) assert.ok(trace.includes(row), `row: ${row.slice(0, 40)}`);
  const changelog = read('CHANGELOG.md');
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  const entry = unreleased.split('\n').find((l) => l.startsWith('- T1-SWEEP2-DUPLICATES: '));
  assert.equal(
    entry,
    "- T1-SWEEP2-DUPLICATES: removed the test-only copies of rules that production enforces another way. The library no longer exports `CARD_TRANSITIONS`, `isCardTransitionAllowed` or `applyCardDecision` (card state is selected by `selectCardState`, never stepped through a table), `tagActionRequiresAuthority` (the release runner checks the ops binding's `triggersPublication`), `MAX_COUNTED_ATTEMPTS` (the effort ladder enforces `MAX_BASELINE_ATTEMPTS` and one escalation), `goalDoneEvidence` (`aidlc next` in CLOSE checks the stages) or `DEFAULT_BANDS_YAML` (a copy of `templates/bands.yaml`), and `CardRunner` drops the static `classify` and `newId`, which nothing called. Two scenario tests run the production rules those copies stood for: a deploy whose binding has `triggersPublication: true` stops with `release-auth` until a production authorization names its environment, and a goal in CLOSE lists `stage <name>=<status>` for each requested stage that has not passed.",
  );
});

// Card T1-SWEEP2-TEST-ONLY: the exports only tests called are gone or live in the tests, the provider option no caller
// set is gone, and the traceability rows of the pure checks the loop does not call say so.
test('T1-SWEEP2-TEST-ONLY acceptance 1: the library exports none of the eight test-only names and keeps the production entry points; the Claude API provider always omits thinking [R1]', () => {
  for (const name of ['fitsBeforeDeadline', 'isGlobalStop', 'gateChecks', 'evalFromIncident', 'countedFailures', 'ensureStatePaths', 'renderSpec', 'renderPlan']) {
    assert.equal(name in lib, false, `${name} is not exported`);
  }
  for (const name of ['effectiveGoalDeadline', 'formatStop', 'classifyCiFailure', 'parseSpec', 'parsePlanCards']) assert.equal(name in lib, true, `${name} is still exported`);
  const provider = read('src/providers/claude-api.ts');
  assert.ok(!provider.includes('showThinking'), 'ClaudeApiOptions has no showThinking');
  assert.ok(provider.includes("thinking: { type: 'adaptive', display: 'omitted' },"), 'every request asks for thinking display omitted');
});

test('T1-SWEEP2-TEST-ONLY acceptance 4: the rows of the uncalled pure checks say the loop does not call them; ship.ts names classifyCiFailure as the decoder; the CHANGELOG names the card [R4] [R5]', () => {
  const trace = read('docs/REQUIREMENTS-TRACEABILITY.md').split('\n');
  const rows: Array<[id: string, check: string, row: string]> = [
    ['MA3', 'reviewerIndependent', '| MA3 reviewer independence and resource bounds | `src/core/roles.ts` (`reviewerIndependent`), `src/coordination/review-queue.ts` | `tests/core/roles.test.ts` | partial: `reviewerIndependent` exists as a pure function the loop does not call |'],
    ['LC9', 'binaryRollbackCompatible', '| LC9 recovery matches data risk | `src/core/migrate.ts` (`assessRecovery`, `binaryRollbackCompatible`) | `tests/core/migrate.test.ts` (Q21) | partial: `aidlc migrate plan` reports `assessRecovery`; `binaryRollbackCompatible` exists as a pure function the loop does not call |'],
    ['R25-R27', 'findingMarker', '| R25-R27 deduplicated finding dispositions, verified closure, policy-based lessons, no blind main pull | `src/core/review-policy.ts` (`findingMarker`), `src/loop/card-runner.ts` (`close`, `markClosure`), `src/probes/git.ts` (`contains`, `divergence`) | `tests/infra/git.test.ts` | partial: `findingMarker` exists as a pure function the loop does not call; idempotent issue creation against `gh` is not implemented |'],
    ['Q5', 'routeAmendment', '| Q5 amendments | `src/core/amendments.ts` (`mapRevision`, `routeAmendment`), `src/loop/controller.ts` (`revision`) | `tests/core/amendments.test.ts` | partial: the controller maps a revision with `mapRevision`; `routeAmendment` exists as a pure function the loop does not call |'],
    ['LC4', 'unattendedMutationAllowed', '| LC4 durable lifecycle identity and one owner; intent before mutation | `src/coordination/reconcile.ts` (`OperationLedger`, `unattendedMutationAllowed`), `src/loop/release-runner.ts` (`issue`), environment leases | `tests/infra/reconcile.test.ts` (Q18) | partial: `unattendedMutationAllowed` exists as a pure function the loop does not call; `tests/scenarios/release.test.ts` (Q18 reconciliation, Q16/Q17/Q19/Q22) covers the rest |'],
  ];
  for (const [id, check, row] of rows) {
    const line = trace.find((l) => l.startsWith(`| ${id} `));
    assert.equal(line, row, `row ${id}`);
    const status = line.slice(line.lastIndexOf(' | ') + 3, -2);
    assert.ok(status.includes(`\`${check}\` exists as a pure function the loop does not call`), `row ${id} names ${check} as uncalled`);
    assert.doesNotMatch(status, /^implemented/, `row ${id} does not say implemented`);
  }
  const ship = read('src/delivery/ship.ts');
  assert.ok(!ship.includes('gateChecks'), 'ship.ts names no gateChecks');
  assert.ok(ship.includes('`classifyCiFailure` in core/ci-policy decodes the check names when it reads the gate lines.'), 'ship.ts names the decoder');
  const changelog = read('CHANGELOG.md');
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  const entry = unreleased.split('\n').find((l) => l.startsWith('- T1-SWEEP2-TEST-ONLY: '));
  assert.equal(
    entry,
    '- T1-SWEEP2-TEST-ONLY: removed the library exports that only tests called. `fitsBeforeDeadline`, `isGlobalStop`, `gateChecks` and `evalFromIncident` are gone with their tests; the `gateChecks` assertions now read the decoded check names through `classifyCiFailure`, which reads the CI gate lines in the loop. `countedFailures`, `ensureStatePaths`, `renderSpec` and `renderPlan` moved into the tests under the same names (`tests/scenarios/_harness.ts`, `tests/infra/helpers.ts`, `tests/surface/_artifacts.ts`). `ClaudeApiOptions` drops `showThinking`, which no caller set, so the Claude API provider always requests thinking display `omitted`. The traceability rows MA3, LC9, R25-R27, Q5 and LC4 now say that `reviewerIndependent`, `binaryRollbackCompatible`, `findingMarker`, `routeAmendment` and `unattendedMutationAllowed` exist as pure functions the loop does not call, instead of calling them implemented.',
  );
});
