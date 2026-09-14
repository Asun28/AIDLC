---
id: T1-LOOP-GATES-2
title: The secret scan is a merge gate; a red scan is a security CI class that never reruns; required checks and verdict policy flow from config to the GitHub ship path (replacement of T1-LOOP-GATES after its two R3 decisions)
status: todo
branch: T1-LOOP-GATES-2
worktree: C:\wt\T1-LOOP-GATES-2
allow_paths:
  - .github/workflows/security-scanners.yml
  - templates/github/workflows/security-scanners.yml
  - src/core/types.ts
  - src/core/ci-policy.ts
  - src/loop/card-runner.ts
  - src/config.ts
  - src/delivery/github-ship.ts
  - aidlc.config.json
  - templates/aidlc.config.json
  - tests/core/ci-policy.test.ts
  - tests/core/config.test.ts
  - tests/scenarios/ci-rerun.test.ts
  - tests/infra/github-ship.test.ts
  - tests/surface/templates.test.ts
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-LOOP-GATES.md
  - specs/tasks/T1-LOOP-GATES-2.md
dod_command: npm run typecheck && node --test tests/core/ci-policy.test.ts tests/core/config.test.ts tests/scenarios/ci-rerun.test.ts tests/infra/github-ship.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R7. WHEN a CI check named for a secret scan fails, the loop shall classify the failure as security, refuse a rerun and stop the card with reason risk.
  - R8. The loop shall pass configured required checks and verdict policy to the GitHub ship path and treat a required check absent from the run list as pending.
acceptance:
  - 1. The secret-scan job carries no `continue-on-error` in the repository workflow or the template, and the two copies stay identical (templates.test.ts). [R7] [dod arm 1]
  - 2. `classifyCiFailure` returns `security` when a failed check-run name in a `[CI-GATE-RED]` line (names with commas, `=value` fragments or underscore spellings such as `secret_scan` included) or a raw gitleaks log matches the secret-scan patterns; `security` wins over code-defect and transient; `canRerun` refuses it with a named reason (ci-policy.test.ts). [R7] [dod arm 1]
  - 3. A `ci-red` ship outcome classified `security` stops the card with reason `risk` and records no rerun intent, also next to transient evidence (ci-rerun.test.ts). [R7] [dod arm 1]
  - 4. `ProjectConfig.github` (`requiredChecks` default empty, `requireVerdict` default true, `ciTimeoutMs`, `ciPollMs`) parses in both config files and reaches `GitHubShipPath` from `CardRunner` without an injected ship path; a required check absent from the returned check runs counts as pending, never as satisfied; this repository lists the four unconditional check-run names (config.test.ts, github-ship.test.ts). [R8] [dod arm 1]
  - 5. A block verdict for the candidate fails the ship before any push or merge even when `github.requireVerdict` is false, and `ProjectConfig` refuses `requireVerdict` false next to `gateRequired` true (github-ship.test.ts, config.test.ts). [R8] [dod arm 1]
  - 6. `docs/ARCHITECTURE.md` ship outcome map and `docs/OPERATIONS.md` config keys and gate promotion are updated; CHANGELOG.md Unreleased carries the entry. [dod arm 1]
plan_ref: plans/loop-integration.md#7
depends_on: [T1-LOOP-LADDER]
budget: 350
tdd: true
sweep: "grep -rn 'classifyCiFailure\|canRerun\|CiFailureClass\|GitHubShipPath(\|requiredChecks\|requireVerdict' src tests docs: ci-policy.ts class table and gate-line parser, card-runner.ts ci-red case and shipPathFor, github-ship.ts verdict and gate loop, config.ts refinement, types.ts enum, ci-rerun.test.ts, github-ship.test.ts, config.test.ts, ARCHITECTURE.md outcome map, OPERATIONS.md Ship gates and STOP table"
non_goals: [a local scanner behind aidlc security check, renaming CI jobs, a gitleaks baseline file, parsing job logs from GitHub, changes to the R2 or R3 review paths]
doc_sync: docs/ARCHITECTURE.md (ship outcome map), docs/OPERATIONS.md (config keys, security gate), CHANGELOG.md
---

# T1-LOOP-GATES-2

## Deliverable
Replacement of T1-LOOP-GATES, which stopped after its two R3 decisions (decision 1: the R8 RED had to be behavioural and the gate-line parser corrupted native check names; decision 2: `secret_scan` spellings were not recognised, and `requireVerdict` false let a blocked candidate merge past a required gate). Every finding is repaired with a failing test first on branch T1-LOOP-GATES (0255842); this card carries the same change through a fresh R2 cycle and two fresh R3 decisions.

The gitleaks history scan becomes a blocking check. The CI classifier gains a `security` class keyed off the failing check-run name the ship path reports (and the raw gitleaks log for `aidlc ci classify --log`); that class never reruns and stops the card with reason `risk`. A `github` config block carries required check names, the verdict requirement and the CI polling limits from `aidlc.config.json` to the GitHub ship path; a required check missing from the run list is treated as pending, a block verdict is never waived, and the config refuses a waived verdict next to a required gate.

Budget 350: the reviewed change is 313 net lines after the four regression scenarios the two R3 decisions asked for.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/ci-policy.test.ts tests/core/config.test.ts tests/scenarios/ci-rerun.test.ts tests/infra/github-ship.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: the CI policy, config, scenario, ship path and template tests named above pass, including the assertions for the security class and its spellings, the no-rerun rule, the config block, the pending rule for absent checks, the never-waived block verdict and the refused config pair.
