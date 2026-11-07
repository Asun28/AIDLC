---
id: T0-PROD-GOAL-STAGES
title: A delivered production attempt that passed stage-verify passes the goal's staging stage, so a production goal reaches DONE
status: todo
branch: T0-PROD-GOAL-STAGES
worktree: D:\wt\AIDLC\T0-PROD-GOAL-STAGES
allow_paths:
  - src/loop/controller.ts
  - tests/scenarios/release.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-PROD-GOAL-STAGES.md
dod_command: npm run typecheck && node --test tests/scenarios/release.test.ts tests/scenarios/goal-close-stages.test.ts
dod_exit: 0
requirements:
  - R1. When a goal in DELIVER finds its release attempt DONE with disposition `delivered`, the controller shall set the stage of the goal's target to `pass`, as it does on main.
  - R2. When that attempt's target is `production` and its `stage-verify` step has status `succeeded`, the controller shall also set `stages.staging` to `pass`.
  - R3. When that attempt has no `stage-verify` step with status `succeeded`, the controller shall leave `stages.staging` as it was, so CLOSE keeps listing it as missing.
  - R4. `docs/OPERATIONS.md` under the production release text shall state R2 and R3, and the CHANGELOG Unreleased section shall have an entry naming this card.
acceptance:
  - 1. `tests/scenarios/release.test.ts`: a production goal driven by `ReleaseRunner` from `toDeliver` through stage-verify, the production approval, APPLY and OBSERVE to a delivered attempt reaches goal state `DONE`, with stages `development=pass`, `staging=pass` and `production=pass`. [R1] [R2] [dod arm 2]
  - 2. `tests/scenarios/release.test.ts`: a production goal whose attempt is saved `DONE`/`delivered` with no `stage-verify` step stays in `CLOSE`, the directive lists `stage staging=pending` as missing, and `stages.production` is `pass`. [R3] [dod arm 2]
  - 3. `tests/scenarios/release.test.ts`: the same goal with a `stage-verify` step of status `failed` stays in `CLOSE` with `stage staging=pending` missing. [R3] [dod arm 2]
  - 4. The staging-target scenario at `tests/scenarios/release.test.ts:95` and `tests/scenarios/goal-close-stages.test.ts` pass with no change. [R1] [dod arm 2]
  - 5. `docs/OPERATIONS.md` and the CHANGELOG hold the text R4 asks for. [R4] Reviewer-verified.
depends_on: []
budget: 110
tdd: true
sweep: "`.stages` on bbbdb10: `src/loop/controller.ts:389` is the only place that passes a release stage; 587 and 590 set the target `fail` on a stopped attempt, and 627 resets to pending on a resume. `src/core/goal-machine.ts:96` sets staging `pending` for a production goal. `src/state/board.ts:59` only prints."
diagnosis:
  root_cause: "`stagesForTarget('production')` sets both `staging` and `production` to `pending`, and `nextInDeliver` passes only `stages[goal.target]`, so `nextInClose` lists `stage staging=pending` for good. The release runner verifies staging on the same attempt before CHECKPOINT, and that fact stays in `attempt.steps` as the `stage-verify` step."
  same_class: "A `package`, `staging`, `migration` or `operations` goal requests one release stage, which line 389 passes. Only `production` requests a stage other than its target."
forbid:
  - changing `stagesForTarget`, the release runner, or the guard on CHECKPOINT
  - passing `stages.staging` without a succeeded `stage-verify` step on the delivered attempt
  - weakening or skipping a test to go green
non_goals:
  - journaling a stage event
  - any change to how a stopped or recovered attempt sets stages
hygiene: "Issue 162. Line numbers checked on main at bbbdb10. The evidence is the attempt of this generation, which `nextInDeliver` already selects."
---

# T0-PROD-GOAL-STAGES

## Deliverable
A production goal reaches DONE once its release attempt is delivered and staging was verified on that attempt. Closes issue 162.

## Acceptance
```powershell
npm run typecheck && node --test tests/scenarios/release.test.ts tests/scenarios/goal-close-stages.test.ts
```
- Expected exit code: 0
- Assertion: the acceptance list above.
