---
id: T1-LOOP-GATES
title: The secret scan is a merge gate; a red scan is a security CI class that never reruns; required checks and verdict policy flow from config to the GitHub ship path
status: todo
branch: T1-LOOP-GATES
worktree: C:\wt\T1-LOOP-GATES
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
dod_command: npm run typecheck && node --test tests/core/ci-policy.test.ts tests/core/config.test.ts tests/scenarios/ci-rerun.test.ts tests/infra/github-ship.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R7. WHEN a CI check named for a secret scan fails, the loop shall classify the failure as security, refuse a rerun and stop the card with reason risk.
  - R8. The loop shall pass configured required checks and verdict policy to the GitHub ship path and treat a required check absent from the run list as pending.
acceptance:
  - 1. The secret-scan job carries no `continue-on-error` in the repository workflow or the template, and the two copies stay identical (templates.test.ts). [R7] [dod arm 1]
  - 2. `classifyCiFailure` returns `security` when a failed check-run name in a `[CI-GATE-RED]` line or a raw gitleaks log matches the secret-scan patterns; `security` wins over code-defect and transient; `canRerun` refuses it with a named reason (ci-policy.test.ts). [R7] [dod arm 1]
  - 3. A `ci-red` ship outcome classified `security` stops the card with reason `risk` and records no rerun intent (ci-rerun.test.ts). [R7] [dod arm 1]
  - 4. `ProjectConfig.github` (`requiredChecks` default empty, `requireVerdict` default true, `ciTimeoutMs`, `ciPollMs`) parses in both config files and reaches `GitHubShipPath` from `CardRunner`; a required check absent from the returned check runs counts as pending, never as satisfied; this repository lists the four unconditional check-run names (config.test.ts, github-ship.test.ts). [R8] [dod arm 1]
  - 5. `docs/ARCHITECTURE.md` ship outcome map and `docs/OPERATIONS.md` config keys and gate promotion are updated; CHANGELOG.md Unreleased carries the entry. [dod arm 1]
plan_ref: plans/loop-integration.md#7
depends_on: [T1-LOOP-LADDER]
budget: 250
tdd: true
sweep: "grep -rn 'classifyCiFailure\|canRerun\|CiFailureClass\|GitHubShipPath(\|requiredChecks' src tests docs: ci-policy.ts class table, card-runner.ts ci-red case and ship path construction, github-ship.ts gate loop, types.ts enum, ci-rerun.test.ts, github-ship.test.ts, ARCHITECTURE.md outcome map, OPERATIONS.md STOP table"
non_goals: [a local scanner behind aidlc security check, renaming CI jobs, a gitleaks baseline file, parsing job logs from GitHub, changes to the R2 or R3 review paths]
doc_sync: docs/ARCHITECTURE.md (ship outcome map), docs/OPERATIONS.md (config keys, security gate), CHANGELOG.md
---

# T1-LOOP-GATES

## Deliverable
The gitleaks history scan becomes a blocking check. The CI classifier gains a `security` class keyed off the failing check-run name the ship path reports (and the raw gitleaks log for `aidlc ci classify --log`); that class never reruns and stops the card with reason `risk`. A `github` config block carries required check names, the verdict requirement and the CI polling limits from `aidlc.config.json` to the GitHub ship path, and a required check missing from the run list is treated as pending.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/ci-policy.test.ts tests/core/config.test.ts tests/scenarios/ci-rerun.test.ts tests/infra/github-ship.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: the CI policy, config, scenario, ship path and template tests named above pass, including the new assertions for the security class, the no-rerun rule, the config block and the pending rule for absent checks.
