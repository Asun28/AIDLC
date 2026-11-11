---
id: T0-DEAD-BRANCHES
title: "Remove four unreachable or redundant branches found by the audit of 2026-11-11 (effort, controller, router, ci-policy) with no change of behaviour"
status: todo
branch: T0-DEAD-BRANCHES
worktree: D:\wt\AIDLC\T0-DEAD-BRANCHES
allow_paths:
  - src/core/effort.ts
  - src/loop/controller.ts
  - src/core/router.ts
  - src/core/ci-policy.ts
  - tests/scenarios/deadline.test.ts
  - specs/tasks/T0-DEAD-BRANCHES.md
dod_command: npm run typecheck && node --test tests/core/effort.test.ts tests/core/router.test.ts tests/core/ci-policy.test.ts tests/scenarios/release.test.ts tests/scenarios/deadline.test.ts tests/scenarios/amendment.test.ts tests/scenarios/arc-reentry.test.ts tests/scenarios/ask-reclassify.test.ts
dod_exit: 0
depends_on: [T0-CARDS-PROJECTED-REENTRY, T0-ASK-RECLASSIFY, T0-CHECKPOINT-PACKET-SHARED]
tdd: false
requirements:
  - R1. `finishAttempt` (src/core/effort.ts) shall not hold the block of lines 224-226 (`if (decision.action === 'stop' && decision.reason === 'exhausted' && (updated.escalationUsed || !nextSupportedEffort(updated))) { ... }`). Proof it never runs: `nextEffortAction` returns reason `exhausted` only at :92 and :95, which it reaches only after :84 returned for `escalationUsed` true and :88-90 returned for an undefined `nextSupportedEffort`; it is called with `updated`, so in that branch `updated.escalationUsed` is false and `nextSupportedEffort(updated)` is defined, and the condition is false. The other stop return of `nextEffortAction`, the stored terminal at :59-60, cannot be the one reached here: `finishAttempt` refuses an episode that already has a terminal (:197-201), and :220 sets `terminal` to undefined for a `fail`, so `updated` carries none.
  - R2. The `release-result` branch of `GoalController.report` (src/loop/controller.ts:625) shall set `[goal.target]: 'fail'` in place of `next.disposition === 'recovered' ? 'fail' : 'fail'`, whose two arms are equal.
  - R3. The carried state of `resume` (controller.ts:654-655) shall be computed once as `state: goal.stop?.reason === 'time' || goal.state === 'STOP' ? 'WAIT' : goal.state`, with `takeover` declared `const` and line 655 removed. Proof of equality for every goal record: on main a `time` stop gives `STOP` at :654, which :655 turns into `WAIT` (the stop is always `undefined` there); `STOP` gives `WAIT`; any other state is kept and is not `STOP`, so :655 does nothing. The `time` disjunct is kept because a record with a `time` stop in a state other than STOP parses, although the loop never writes one (`persistStopValue` is the one writer of `goal.stop` and always moves to STOP).
  - R4. `classifyRequest` (src/core/router.ts:85) shall read `const surfaces = input.affectedSurfaces ?? [];` in place of a spread whose second part is `[]` in both arms; `surfaces` is read only by `surfaces.join(' ')` at :86.
  - R5. `classifyCiFailure` (src/core/ci-policy.ts) shall not hold the `transientHits` counter (:301 declaration, :313 increment, :318 `void transientHits;`), which nothing reads; each `evidence.push` of a transient match and its order stay, and the comment of :318 (the transient log matches stay in the evidence and grant nothing) moves above the `TRANSIENT_PATTERNS` loop.
  - R6. No other line of the four source files shall change: every export, signature, return value, persisted record, journal event and message stays as on the card's base.
acceptance:
  - 1. `npm run typecheck` passes: with `noUnusedLocals` no counter, variable or import is left without a reader. [R1] [R2] [R3] [R4] [R5] [dod arm 1]
  - 2. `tests/core/effort.test.ts` passes unchanged, among them "Q25: escalation is unavailable at the top of the ladder" and "Q25: a failed escalated attempt ends the episode; there is no fifth attempt", which reach both terminals through line 223. [R1] [dod arm 2]
  - 3. `tests/scenarios/release.test.ts` passes unchanged, among them "Q16: a staging goal reaches DELIVER and stops with release-config when no provider operations are bound" (`stages.staging` is `fail` after a stopped `release-result`). [R2] [dod arm 2]
  - 4. `tests/scenarios/deadline.test.ts` "T0-DEAD-BRANCHES: a goal stopped for time and resumed without a revision is derived again from its runs, never read as terminal" passes on main and on the candidate: a one-card goal whose run is saved in STOP for `time` stops for `time`; `resume` without text or cards returns `stop` with reason `time` and not the narration `Goal is terminal. Late wakeups do no new work.`, and the stored goal has generation 1, `terminal` true and stop reason `time`. A second case exercises the `time` disjunct outside STOP: a staging goal whose card merged is saved by hand after `arc-verified` as a terminal record in DELIVER with a `time` stop; `resume` without text or cards returns `verify-arc` with the goal in VERIFY_ARC at generation 1 (the carried state is WAIT, as on main), not `release` in DELIVER. Removing line 655 alone fails the first case and dropping the `time` disjunct fails the second (both shown in the attempt evidence; checked on 2026-11-11 in a scratch copy of main). The other tests of the file and `tests/scenarios/amendment.test.ts` pass unchanged. [R3] [dod arm 2]
  - 5. `tests/core/router.test.ts` passes unchanged, among them the test at :130 that routes `affectedSurfaces` `db/migrations/0004_x.sql`. [R4] [dod arm 2]
  - 6. `tests/core/ci-policy.test.ts` passes unchanged, among them "a transient log pattern alone is unknown: log text never grants a rerun, and its match stays as evidence (T0-CI-RERUN-STRUCTURED)". [R5] [dod arm 2]
  - 7. The diff touches only the five sites of R1 to R5, the one test of acceptance 4 and this card (reviewer-verified against the diff). [R6]
budget: 90
sweep: "Read of each site on main at 92796d4f, then git grep -n \"transientHits\\|nextSupportedEffort\\|'recovered' ? 'fail'\\|takeover.state === 'STOP'\\|affectedSurfaces ? \\[\\]\" -- src. ci-policy.ts:301,313,318: the only three `transientHits` sites, removed (R5). effort.ts:20 (definition), :87 (`nextEffortAction`), :224 (removed, R1): `nextSupportedEffort` stays exported and used at :87. controller.ts:625 (R2) and :655 (R3): one hit each. router.ts:85 (R4): one hit. Pins in tests: no test asserts on any removed line; the tests named in acceptance 2 to 6 run the code around each site. Left out on purpose: `canRerun` (ci-policy.ts:382-384, `used.some(...)` after `used.length >= MAX_CI_TRANSIENT_RERUNS`) is unreachable only while `MAX_CI_TRANSIENT_RERUNS` is 1 (src/core/types.ts:1167); it is the duplicate-rerun guard a larger allowance needs, so it stays."
forbid: ["weakening or skipping a test to go green", "a change of behaviour, of an exported name, of a message or of a persisted record", "removing the `canRerun` duplicate-rerun guard", "editing .aidlc state by hand"]
non_goals: ["the other audit items of 2026-11-11 (stale comments F28, unused exports F25, unread schema fields F27)", "dropping the `time` disjunct of R3, which would change the carried state of a hand-written record", "a refactor of any touched function beyond its site"]
hygiene: "Line numbers are from main at 92796d4f; the three cards it depends on move the controller.ts lines, so read them again at PREPARE. T0-CARDS-PROJECTED-REENTRY, T0-ASK-RECLASSIFY and T0-CHECKPOINT-PACKET-SHARED change src/loop/controller.ts and merge first, and the DoD runs the test files of the first two; sync with main before SHIP. `tdd: false`: a cleanup with no change of behaviour has no failing test to write first; the acceptance 4 tests are characterizations that pass on main, and the attempt evidence shows the first failing with line 655 removed and line 654 unchanged (the state stays STOP with no stop record, and `next` returns the terminal narration with reason `cancelled`) and the second failing with the `time` disjunct dropped (the carried state stays DELIVER and `next` returns `release`). No CHANGELOG entry: CLAUDE.md records behaviour changes there, and this card changes none; T1-SWEEP-DEAD-CODE had an entry because it removed library exports and refused a config value. So the CHANGELOG insertion rule of the earlier cards of this list does not apply and CHANGELOG.md is not in allow_paths. This card changes no file the verify-card-run-writes coverage record names."
doc_sync: none (no documented behaviour changes)
---

# T0-DEAD-BRANCHES

## Deliverable
Four sites that cannot run or that compute a constant are reduced to the code that runs, with no change of behaviour.

## Why
Audit F26 of 2026-11-11. Each requirement carries the proof that the removed code cannot change a result. The fifth site the audit named, the duplicate-rerun check of `canRerun`, is unreachable only because the rerun allowance is 1; it guards the allowance it would need if raised, so it stays (see sweep).

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/effort.test.ts tests/core/router.test.ts tests/core/ci-policy.test.ts tests/scenarios/release.test.ts tests/scenarios/deadline.test.ts tests/scenarios/amendment.test.ts tests/scenarios/arc-reentry.test.ts tests/scenarios/ask-reclassify.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck and every named test pass; the acceptance 4 test passes on main as well.

## Attempt evidence

Base f544c5df (origin/main with T0-CARDS-PROJECTED-REENTRY, T0-ASK-RECLASSIFY and T0-CHECKPOINT-PACKET-SHARED merged). Each site was found by the code the card quotes and re-proved on that code; every proof still holds. The controller sites moved to controller.ts:646 (R2) and :683-684 (R3).

### Acceptance items

| # | Result |
|---|--------|
| 1 | `npm run typecheck` exits 0 (first arm of the DoD). |
| 2 | `tests/core/effort.test.ts` unchanged and passing in the DoD. |
| 3 | `tests/scenarios/release.test.ts` unchanged and passing in the DoD. |
| 4 | `tests/scenarios/deadline.test.ts` test "T0-DEAD-BRANCHES: a goal stopped for time and resumed without a revision is derived again from its runs, never read as terminal" added with both cases. It passes on the base source (src stashed, deadline.test.ts: pass 8, fail 0) and on the candidate (pass 8, fail 0), by design. It does not read the platform: it uses the fixture clock and store only. `amendment.test.ts` and the other tests of the file pass unchanged. |
| 5 | `tests/core/router.test.ts` unchanged and passing in the DoD. |
| 6 | `tests/core/ci-policy.test.ts` unchanged and passing in the DoD. |
| 7 | The diff touches the five sites, the one test and this card (see `git diff --stat`). |

### Per-site proof on the current code

- R1, effort.ts `finishAttempt`: `updated` is built with `terminal: undefined` for a `fail`, and `finishAttempt` throws first for an episode that already has a terminal, so `nextEffortAction(updated, ...)` skips the stored-terminal return. It returns reason `exhausted` only after the `escalationUsed` return and the `!next` return (`nextSupportedEffort(episode)` undefined) have not fired, and `nextSupportedEffort(updated)` is the same call on the same baseline, so `updated.escalationUsed` is false and the result is defined: the removed condition is false. The block is removed; `nextSupportedEffort` stays exported and used in `nextEffortAction`.
- R2, controller.ts `release-result`: `next.disposition === 'recovered' ? 'fail' : 'fail'` has equal arms, so it is `'fail'`. Replaced.
- R3, controller.ts `resume`: see the equivalence table. `takeover` is not reassigned after the removed line (`git grep -n "takeover =" src/loop/controller.ts` has no hit), so it is `const`. The `time` disjunct is kept.
- R4, router.ts `classifyRequest`: both spread parts are the array or `[]` (`input.affectedSurfaces ? [] : []`), so the value is `input.affectedSurfaces ?? []`; `surfaces` is read only by `surfaces.join(' ')` (`grep -n surfaces src/core/router.ts` gives the declaration and that read).
- R5, ci-policy.ts `classifyCiFailure`: `transientHits` had three sites (declaration, increment, `void`) and no reader. The three are removed; the `evidence.push` of each transient match and its order stay; the comment moved above the `TRANSIENT_PATTERNS` loop. `canRerun` is untouched.

### Equivalence table for R3

Inputs the condition reads: goal state (9 values of `GoalState`) and stop reason (undefined or one of the 20 values of `StopReason`): 9 x 21 = 189 combinations. Old form: `state: stop?.reason === 'time' ? 'STOP' : state === 'STOP' ? 'WAIT' : state` with `stop: undefined`, then `if (stop === undefined && state === 'STOP') state = 'WAIT'`. New form: `stop?.reason === 'time' || state === 'STOP' ? 'WAIT' : state`. A scratch script (not committed) evaluated both on all 189 combinations: 0 differ. The reading: the old second line always runs with `stop` undefined, so it maps a `STOP` produced by the `time` arm to `WAIT` and does nothing else (the other arms never give `STOP`).

### Tests that keep watching each area (scratch mutation, restored after each run; file left as edited)

| Mutation of the code left | Test run | Result |
|---|---|---|
| M1: resume keeps the old first line without the removed second line (`time` gives STOP) | deadline.test.ts | fails: the new test, case 1 (pass 7, fail 1) |
| M2: `time` disjunct dropped | deadline.test.ts | fails: the new test, case 2 (case 1 starts in STOP, so only case 2 can see it) (pass 7, fail 1) |
| M3: `release-result` stage `'pending'` instead of `'fail'` | release.test.ts | fails: "Q16: a staging goal reaches DELIVER and stops with release-config ..." (pass 17, fail 1) |
| M4: `surfaces = []` | router.test.ts | fails: "router (Q2)" (pass 25, fail 1) |
| M5: transient `evidence.push` removed | ci-policy.test.ts | fails: "CI classification (Q7)" (pass 45, fail 1) |
| M6: stop reasons other than `exhausted` no longer set `terminal` in `finishAttempt` | effort.test.ts | fails: "effort episodes (MA2 / Q25)" (pass 30, fail 5) |

Tests that surround R1 and stay green: the two Q25 tests of acceptance 2 (terminals through `nextEffortAction` at the top of the ladder and after a failed escalated attempt).

Coordinator verification:
