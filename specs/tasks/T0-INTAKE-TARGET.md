---
id: T0-INTAKE-TARGET
title: Intake reads a delivery target only from the flag or from a request to deliver, never from a word in the text
status: todo
branch: T0-INTAKE-TARGET
worktree: D:\wt\AIDLC\T0-INTAKE-TARGET
allow_paths:
  - src/core/router.ts
  - tests/scenarios/intake-target.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-INTAKE-TARGET.md
dod_command: npm run typecheck && node --test tests/scenarios/intake-target.test.ts tests/core/router.test.ts tests/scenarios/goal-card-count.test.ts tests/scenarios/goal-close-stages.test.ts tests/scenarios/release.test.ts
dod_exit: 0
requirements:
  - R1. When a request carries a `ref` from `--card` or `--issue` and no `--target`, `classifyRequest` shall route it with target `development` and `targetSource` `default`, and its kind shall not come from a target word.
  - R2. When a request carries `--target development`, `classifyRequest` shall route it with no `release` kind and with `card-loop` in its modules when its size has one.
  - R3. For free text, `detectTarget` shall read a target only from a delivery verb tied by `to` to the target word in one sentence, `go live`, a delivery verb tied to `for online testing`, a build verb tied to a package noun, `package it|the app|a build`, a migration phrase that names the operation, or an operations phrase that names the watch. A sentence ends at `.`, `!`, `?` or `;`, with any closing quote or bracket, before whitespace, at a blank line, or before a list item; a line break inside a sentence is wrapping, and no limit applies to the words between the verb and the target.
  - R4. `detectTarget` shall read no target from text the router's `BUG` pattern matches.
  - R5. When R1 or R2 sets aside a target the text reads as, the routing reasons shall name it.
  - R6. A goal created from text with a target word, a `ref` and no `--target` shall hold no staging authorization and shall reach DONE from `arc-verified` with no release attempt.
  - R7. `docs/OPERATIONS.md` under the standalone release heading shall state R1 and R3, and the CHANGELOG Unreleased section shall have an entry naming this card.
acceptance:
  - 1. `tests/scenarios/intake-target.test.ts`: each of the six rows in issue 222 with a `ref` routes to target `development`, `targetSource` `default`, kind other than `release`, and `card-loop` in its modules. [R1] [dod arm 2]
  - 2. `tests/scenarios/intake-target.test.ts`: each of those six rows without a `ref` routes the same way, since none asks for a delivery. [R3] [dod arm 2]
  - 3. `tests/scenarios/intake-target.test.ts`: `deploy to production` with a `ref` and no `--target` routes to development, and with a `ref` and `--target staging` routes to staging. [R1] [dod arm 2]
  - 4. `tests/scenarios/intake-target.test.ts`: `deploy to production` with `--target development` routes to development, kind `change`, `card-loop` in its modules, and no reason says `explicit production release request`. [R2] [dod arm 2]
  - 5. `tests/scenarios/intake-target.test.ts`, one row per form of R3, each routing to the literal target and `targetSource` `explicit`. Production - `deploy to production`, `Release version 2.0 to production`, `release to prod`, `promote the build to the production cluster`, `go live`. Staging - `release to staging`, `Deploy the current build to staging for online testing`, `push the build to uat`, `deploy it for online testing`. Package - `Build a runnable package for the app`, `package the app`, `publish the docker image`. Migration - `Run the migration against the reporting database`. Operations - `Keep watching the service and page on-call when latency spikes`, `monitor the service`. The test also holds a row for each remaining verb and phrase of R3. `deploy to pre-production` routes to staging and `observe production` to operations, where main read production for both. `deploy the approved customer reporting application build from the latest successful verification pipeline to staging` and `deploy` then a line break then `to staging` route to staging (R3 decision 1 F1). [R3] [dod arm 2]
  - 6. `tests/scenarios/intake-target.test.ts`, one row per class this card drops, each routing to development and `targetSource` `default`. A preposition other than `to` - `the job runs in production`, `deploy on staging`. A noun phrase - `the production release step`, `the prod release step`, `a staging deploy`. A sentence boundary - `Release the notes. The next step is to production`, `Please write "Release the notes." The next step is to production`, `Please write "Build the documentation." The installer is described later` (R3 decision 1 F2), a blank line between `Release the notes` and `The next step is to production`, and two list items, `- Release the notes` and `- Link it to production docs`. A bare word - `uat`, `preprod`, `online testing`, `the installer`, `an apk`, `the docker image`, `alerting docs`, `the on-call page`, `the maintenance window`, `the data migration helper`. `ship it to prod` also stays development, as on main, since the narrowing reads nothing main did not. [R3] [dod arm 2]
  - 7. `tests/scenarios/intake-target.test.ts`: `deploy to production fails with a 500` and `the release to staging is broken` route to development and kind `bugfix`. [R4] [dod arm 2]
  - 8. `tests/scenarios/intake-target.test.ts`: the routing reasons name the target the text read as in the `ref` row of acceptance 3 and the row of acceptance 4, and name none for `Fix a typo in the README` with a `ref`. [R5] [dod arm 2]
  - 9. `tests/scenarios/intake-target.test.ts`: a goal created with the text of issue 162, `source` `card`, a `ref` and no `--target` has target `development` and no `auth-staging` record; once its card is done, `arc-verified` ends it DONE, and `listReleases` is empty. [R6] [dod arm 2]
  - 10. The tests of `router`, `goal-card-count`, `goal-close-stages` and `release` pass with no change. [R3] [dod arms 3 to 6]
  - 11. `docs/OPERATIONS.md` and the CHANGELOG hold the text R7 asks for. [R7] Reviewer-verified.
depends_on: []
budget: 260
tdd: true
sweep: "On main at 48f1017. `detectTarget` at `src/core/router.ts:36` has one caller, `classifyRequest` at line 103, which runs from `GoalController.createGoal` at `src/loop/controller.ts:120` and the prompt hook at `src/hooks/index.ts:694`. The hook only prints `formatRouting`, so a narrower reading changes a printed line and no gate. `routing.target` is read at controller.ts:127, and the staging authorization at line 153 follows from it. `RELEASE` also feeds the kind at line 107, gated by `targetInfo.explicit`, so it needs no change. Every test request naming a target word is a real request: `tests/core/router.test.ts` lines 45, 92, 102, 109, 136, 162 and 229, and `tests/scenarios/goal-card-count.test.ts` lines 70 and 74. Every release example in the docs passes `--target`."
diagnosis:
  root_cause: "`detectTarget` tests for a target word, and line 37 then tests `RELEASE`, which also matches that word, so the second test never fails. The other branches match one word as well. `classifyRequest` records the result as `targetSource: explicit`, and `input.ref` does not set `kind`, so a card goal takes `kind: release` from its own description."
  same_class: "All five target branches of `detectTarget` read prose; R3 narrows each one. `MIGRATION_OP` also loses its bare `data migration`. `INCIDENT` matches `production is` and `production error`, but it sets only the kind `incident`, which sets no target, so it stays."
forbid:
  - changing `formatRouting`, the `targetSource` values, or the staging authorization rule at `src/loop/controller.ts:153`
  - a free-text request that R3 names routing anywhere but its target
  - weakening or skipping a test to go green
non_goals:
  - a confirmation step at intake, which issue 222 proposes for a target read from text; R3 narrows that reading to a request to deliver, so `deploy to staging` keeps working as `tests/core/router.test.ts:92` pins
  - a text-derived value for `targetSource`, which `tests/core/router.test.ts:94` pins as `explicit` for a request to deliver
  - a sentence that describes the verb phrase in free text, such as `add a test that we deploy to staging`. It still reads as a request; `--card`, `--issue` or `--target development` routes it to development, and the reason line shows the reading. A long sentence that names a delivery verb and later `to production` reads the same way, since R3 decision 1 F1 removed the distance limit
hygiene: "Issue 222, items 1, 2 and 4 of its proposal. No request main left on development gains a target, so `prod` counts only in `release to prod` and `online tests` stays unread. Two forms change target, both away from production: main read `pre-production` as production, since `\\bproduction\\b` matches after the hyphen, and read `observe production` as a release. The scan finds the first verb of a sentence and tests the rest for the target, so it stays linear in the prompt the hook reads. A request R3 no longer reads goes to development, where it can do no more than a card, and `--target` still names any target. Lesson T1-PROMPT-CHECK-2 asks for the old and new patterns to be compared over a generated corpus and for each dropped class to be named before the first review: acceptance 6 names the classes, and the card's Attempt evidence carries the comparison. Who the boundary holds against: a request misread by intake, not a hostile prompt. Line numbers checked on main at 48f1017."
---

# T0-INTAKE-TARGET

## Deliverable
A word in a request no longer sets a delivery target. Closes issue 222.

## Attempt evidence
RED, commit e31ea7e: `node --test tests/scenarios/intake-target.test.ts` exits 1, tests 50, pass 16, fail 34, all on assertions: acceptance 1 six rows, 2 six rows, 3, 4, 6 sixteen rows, 7 two rows, 8 and 9. The 16 that pass are the 15 requests of acceptance 5, which main already reads, and `ship it to prod`, which stays development on both.

Old and new `classifyRequest` over a generated corpus of 387845 requests, with no `ref` (verbs by objects by links by places by tails, plus the fixed phrases): 73567 route the same, 0 gain a target, 312981 go to development, and 1297 change target. Those 1297 are 1296 requests with `pre-production`, production to staging, and `observe production`, production to operations. The 312981 fall in the classes acceptance 6 and 7 name: 116970 bug reports, 41040 with a preposition other than `to`, 82609 with no delivery verb, and 72362 with a verb that is not tied by `to`, such as `prod release`.

The RED cannot show that each rule of the fix is needed, since most rows of acceptance 5 pass on main, so each rule, verb and phrase was changed in turn, by hand, and the tests run: 32 changes, 30 failed a test. The two that passed, a link other than `to` before `production` and reading `online tests`, had no row. `deploy on production` and `deploy it for online tests` now hold those, and both changes fail a test.

## Acceptance
```powershell
npm run typecheck && node --test tests/scenarios/intake-target.test.ts tests/core/router.test.ts tests/scenarios/goal-card-count.test.ts tests/scenarios/goal-close-stages.test.ts tests/scenarios/release.test.ts
```
- Expected exit code: 0
- Assertion: the acceptance list above.
