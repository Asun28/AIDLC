---
id: T0-INTAKE-TARGET-2
title: Intake reads a delivery target only from the flag or from a request to deliver, never from a word in the text
status: merged
branch: T0-INTAKE-TARGET-2
worktree: D:\wt\AIDLC\T0-INTAKE-TARGET-2
allow_paths:
  - src/core/router.ts
  - tests/scenarios/intake-target.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-INTAKE-TARGET-2.md
dod_command: npm run typecheck && node --test tests/scenarios/intake-target.test.ts tests/core/router.test.ts tests/scenarios/goal-card-count.test.ts tests/scenarios/goal-close-stages.test.ts tests/scenarios/release.test.ts
dod_exit: 0
requirements:
  - R1. When a request carries a `ref` from `--card` or `--issue` and no `--target`, `classifyRequest` shall route it with target `development` and `targetSource` `default`, and its kind shall not come from a target word.
  - R2. When a request carries `--target development`, `classifyRequest` shall route it with no `release` kind and with `card-loop` in its modules when its size has one.
  - R3. For free text, `detectTarget` shall read a target only from a delivery verb tied by `to` to the target word in one sentence, `go live`, a delivery verb tied to `for online testing`, a build verb with a package noun after it in one sentence, `package it|the app|a build`, a migration phrase that names the operation, or an operations phrase that names the watch. A sentence ends at a Unicode sentence terminator, `;` or an ellipsis, with any run of marks that are not letters or digits after it, before whitespace; at a full-width terminator with or without whitespace; at a blank line; or before a list item, a line that opens with a run of marks, or a label of up to three letters or digits followed by `.` or `)`, and then whitespace. Any other line break is wrapping, inside a form too, and no limit applies to the words between the verb and the target.
  - R4. `detectTarget` shall read no target from text the router's `BUG` pattern matches with its whitespace collapsed, and `classifyRequest` shall read the same text as a bug report for its kind.
  - R5. When R1 or R2 sets aside a target the text reads as, the routing reasons shall name it.
  - R6. A goal created from text with a target word, a `ref` and no `--target` shall hold no staging authorization and shall reach DONE from `arc-verified` with no release attempt.
  - R7. `docs/OPERATIONS.md` under the standalone release heading shall state R1 and R3, and the CHANGELOG Unreleased section shall have an entry naming this card.
acceptance:
  - 1. `tests/scenarios/intake-target.test.ts`: each of the six rows in issue 222 with a `ref` routes to target `development`, `targetSource` `default`, kind other than `release`, and `card-loop` in its modules. [R1] [dod arm 2]
  - 2. `tests/scenarios/intake-target.test.ts`: each of those six rows without a `ref` routes the same way, since none asks for a delivery. [R3] [dod arm 2]
  - 3. `tests/scenarios/intake-target.test.ts`: `deploy to production` with a `ref` and no `--target` routes to development, and with a `ref` and `--target staging` routes to staging. [R1] [dod arm 2]
  - 4. `tests/scenarios/intake-target.test.ts`: `deploy to production` with `--target development` routes to development, kind `change`, `card-loop` in its modules, and no reason says `explicit production release request`. [R2] [dod arm 2]
  - 5. `tests/scenarios/intake-target.test.ts`, one row per form of R3, each routing to the literal target and `targetSource` `explicit`. Production - `deploy to production`, `Release version 2.0 to production`, `release to prod`, `promote the build to the production cluster`, `go live`. Staging - `release to staging`, `Deploy the current build to staging for online testing`, `push the build to uat`, `deploy it for online testing`. Package - `Build a runnable package for the app`, `package the app`, `publish the docker image`. Migration - `Run the migration against the reporting database`. Operations - `Keep watching the service and page on-call when latency spikes`, `monitor the service`. The test also holds a row of its own for each remaining verb and phrase of R3, including `create a build artifact`. `deploy to pre-production` routes to staging and `observe production` to operations, where main read production for both. `deploy the approved customer reporting application build from the latest successful verification pipeline to staging` and `deploy` then a line break then `to staging` route to staging (R3 decision 1 F1). Each named form with a line break inside it routes as it does on one line, and `go` then a line break then `live` has the `release` kind. A request with two target words takes the target of its form: `deploy the production build to staging` staging, `run the migration on staging` migration, `package the app for staging` package, `monitor production` operations. A child process classifies a run of 400000 of each of the units the test lists, marks, terminators and line breaks among them, before its 30 second kill, so a scan that is not linear fails with no clock in the test (R3 decision 3 F5). [R3] [dod arm 2]
  - 6. `tests/scenarios/intake-target.test.ts`, one row per class this card drops, each routing to development and `targetSource` `default`. A preposition other than `to` - `the job runs in production`, `deploy on staging`. A noun phrase - `the production release step`, `the prod release step`, `a staging deploy`. A sentence boundary - `Release the notes. The next step is to production`, `Please write "Release the notes." The next step is to production`, `Please write "Build the documentation." The installer is described later` (R3 decision 1 F2), the same sentence pair with each terminator and each closing mark the test lists, including braces and guillemets (R3 decision 2 F4), the pair split by a full-width terminator with no whitespace, including `\uff0e`, a blank line that holds spaces, a blank line between `Release the notes` and `The next step is to production`, and two list items, `- Release the notes` and `- Link it to production docs`, with each list marker the test lists, including `+`. An object inside the verb - `rename the build artifact helper`, `the build artifact` and `build artifact` (R3 decision 2 F3). A bare word - `uat`, `preprod`, `online testing`, `the installer`, `an apk`, `the docker image`, `alerting docs`, `the on-call page`, `the maintenance window`, `the data migration helper`. `deploy it for online test` reads as no target, since R3 names `for online testing`. `ship it to prod` also stays development, as on main. [R3] [dod arm 2]
  - 7. `tests/scenarios/intake-target.test.ts`: `deploy to production fails with a 500`, `the release to staging is broken` and `deploy to production fails` then a line break then `with a 500` each route to development and kind `bugfix`. [R4] [dod arm 2]
  - 8. `tests/scenarios/intake-target.test.ts`: the routing reasons name the target the text read as in the `ref` row of acceptance 3 and the row of acceptance 4, and name none for `Fix a typo in the README` with a `ref`. [R5] [dod arm 2]
  - 9. `tests/scenarios/intake-target.test.ts`: a goal created with the text of issue 162, `source` `card`, a `ref` and no `--target` has target `development` and no `auth-staging` record; once its card is done, `arc-verified` ends it DONE, and `listReleases` is empty. [R6] [dod arm 2]
  - 10. The tests of `router`, `goal-card-count`, `goal-close-stages` and `release` pass with no change. [R3] [dod arms 3 to 6]
  - 11. `docs/OPERATIONS.md` and the CHANGELOG hold the text R7 asks for. [R7] Reviewer-verified.
depends_on: []
budget: 380
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
  - reading free text as grammar. R3 is a word match over the forms it names, so a text that holds a form reads as a request wherever the form stands, such as `the go live checklist`, `add the phrase deploy to production to the docs` or a table row, and a request in another form, such as `deploy into production`, reads as none. A false reading is corrected by `--card`, `--issue` or `--target development`, and the reason line shows it; a miss is corrected by `--target`, which is the way the docs name a target
  - a list marker with no whitespace after it, which reads as wrapping so that a line opening with `(all of it)` stays in its sentence
  - a sentence that describes the verb phrase in free text, such as `add a test that we deploy to staging`. It still reads as a request; `--card`, `--issue` or `--target development` routes it to development, and the reason line shows the reading. A long sentence that names a delivery verb and later `to production` reads the same way, since R3 decision 1 F1 removed the distance limit
hygiene: "This card replaces T0-INTAKE-TARGET by the user's ruling `successor` of 2026-11-07, after R3 decision 4 stopped that card with one finding, weakened-bugfix-assertion, in acceptance 7: that candidate loosened the row to `kind` not `release` to fit a wrapped report the code read as `change`. This card carries that branch at ec916b8, restores the exact assertion, reads `BUG` on the collapsed text for the kind as well, and renames the card in the test titles, the comments, the CHANGELOG entry and docs/OPERATIONS.md, since T0-INTAKE-TARGET never merged. Issue 222, items 1, 2 and 4 of its proposal. A one-line request main left on development stays there, so `prod` counts only in `release to prod` and `online tests` stays unread; a line break inside a form reads as the form does on one line, which main did not do. A request with more than one target word takes the target of the form it asks for, where main took the first branch a bare word reached, and a target it no longer reads takes its staging authorization with it: `deploy the production build to staging` goes to staging, `run the migration on staging` to migration, `package the app for staging` to package, `monitor production` and `observe production` to operations, and `deploy to pre-production` to staging, since main's `production` test matches after the hyphen. The split tests its lookbehind only at whitespace, and the scan finds the first verb of a sentence and tests the rest for the target, so both stay linear in the prompt the hook reads and the goal intake. A request R3 no longer reads goes to development, where it can do no more than a card, and `--target` still names any target. Lesson T1-PROMPT-CHECK-2 asks for the old and new patterns to be compared over a generated corpus and for each dropped class to be named before the first review: acceptance 6 names the classes, and the card's Attempt evidence carries the comparison. Who the boundary holds against: a request misread by intake, not a hostile prompt. Line numbers checked on main at 48f1017."
---

# T0-INTAKE-TARGET-2

## Deliverable
A word in a request no longer sets a delivery target. Closes issue 222.

## Attempt evidence
RED for this card, commit 3c68f86: `node --test tests/scenarios/intake-target.test.ts` exits 1, tests 378, pass 377, fail 1: the wrapped bug report of acceptance 7, which read as kind `change`. Reading `BUG` on the collapsed text clears it, and restoring the raw read fails it again. The evidence below is from the card this one replaces, on the branch this card carries.

RED, commit e31ea7e: `node --test tests/scenarios/intake-target.test.ts` exits 1, tests 50, pass 16, fail 34, all on assertions: acceptance 1 six rows, 2 six rows, 3, 4, 6 sixteen rows, 7 two rows, 8 and 9. The 16 that pass are the 15 requests of acceptance 5, which main already reads, and `ship it to prod`, which stays development on both.

RED for repair 1, commit 87b1471 (R3 decision 1 F1, F2): tests 84, pass 78, fail 6: the long sentence, the two line-wrapped requests, and the three sentences that end inside a closing quote or bracket.

RED for repair 2, commit 3dbfddf (R3 decision 2 F3, F4): tests 274, pass 127, fail 147: three rows of an object inside the verb, 134 terminator and closing mark pairs, four full-width terminators and six list markers.

RED for repair 3, commit 4e4d9f2 (R3 decision 3 F5): the child that classifies runs of 1000000 of each unit is killed at its 60 second limit. With the fix, 30 input shapes at 20000 to 160000 characters each take at most 126 ms and grow about in step with the size, and the child finishes before its limit. The child then took 9 seconds of CPU beside the timing tests of `tests/infra/exec.test.ts`, one of which failed once in a full run and passed three times alone, so it now classifies runs of 400000 with a 30 second kill, and with the whitespace gate removed it is still killed.

RED before R3 decision 4, commit 8b860fa, from an independent check of the candidate: tests 378, pass 366, fail 12: seven forms with a line break inside them, `for online test`, the terminators `\uff0e` and `\uff61` with no whitespace, the kind of a wrapped form, and a wrapped bug report.

Old and new `classifyRequest` over a generated one-line corpus of 391645 requests, with no `ref` (verbs by objects by links by places by tails, requests with two target words, and the fixed phrases): 75072 route the same, 0 gain a target, 314646 go to development, and 1927 change target. Each of the 1927 takes the target of the form it asks for, where main took the first branch a bare word reached: 1482 production to staging, such as `deploy to pre-production`; 255 staging to package; 102 production to package; 28 package, 20 staging and 8 production to migration; and 14 package, 10 staging, 6 production and 2 migration to operations. A line break inside a form is outside that corpus: main did not read those requests, and R3 now does.

The RED cannot show that each rule of the fix is needed, since most rows of acceptance 5 pass on main, so each rule, verb, noun and phrase was changed in turn, by hand, and the tests run. On the final candidate, 93 changes gave 92 failures with the child test skipped, since it takes a minute. The one that passed removes the whitespace gate, which that child test catches: its RED is commit 4e4d9f2.

## Acceptance
```powershell
npm run typecheck && node --test tests/scenarios/intake-target.test.ts tests/core/router.test.ts tests/scenarios/goal-card-count.test.ts tests/scenarios/goal-close-stages.test.ts tests/scenarios/release.test.ts
```
- Expected exit code: 0
- Assertion: the acceptance list above.
