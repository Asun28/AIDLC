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
