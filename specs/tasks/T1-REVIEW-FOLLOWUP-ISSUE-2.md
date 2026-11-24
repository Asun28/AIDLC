---
id: T1-REVIEW-FOLLOWUP-ISSUE-2
title: "(replaces T1-REVIEW-FOLLOWUP-ISSUE) card close --followups records the GitHub issue of the advisory and deferred findings of a merged card, with at most one issue submission per run"
status: todo
branch: T1-REVIEW-FOLLOWUP-ISSUE-2
worktree: D:\wt\AIDLC\T1-REVIEW-FOLLOWUP-ISSUE-2
plan_ref: plans/review-recall.md#order-of-work
allow_paths:
  - src/core/types.ts
  - src/loop/card-runner.ts
  - src/loop/controller.ts
  - src/core/card-machine.ts
  - src/cli/main.ts
  - tests/scenarios/
  - tests/core/types.test.ts
  - tests/surface/lessons.test.ts
  - tests/surface/removed-surface.test.ts
  - .claude/skills/verify-card-run-writes/SKILL.md
  - .claude/skills/verify-card-run-writes/references/not-covered.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - docs/REQUIREMENTS-TRACEABILITY.md
  - README.md
  - changelog.d/T1-REVIEW-FOLLOWUP-ISSUE-2.md
  - specs/tasks/T1-REVIEW-FOLLOWUP-ISSUE-2.md
dod_command: npm run typecheck && node --test tests/scenarios/followup-issue.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/adopt-merge.test.ts tests/scenarios/card-close-cleanup.test.ts tests/scenarios/goal-close-stages.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/audit.test.ts tests/scenarios/run-driver.test.ts tests/scenarios/lesson-dup.test.ts tests/scenarios/review-rule-goal.test.ts tests/scenarios/worktree-reclaim.test.ts tests/core/types.test.ts tests/surface/lessons.test.ts tests/surface/removed-surface.test.ts tests/surface/templates.test.ts tests/surface/test-temp.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The closure record of a card run shall gain the step `followups`, false on a run created without a closure record and true on a stored closure record without the key.
  - R2. `CardRun` shall gain the optional fields `followupIssue` (a positive safe integer, or null when the step filed none), `followupNote` (a non-empty text) and `followupPending` (non-empty `repository`, `marker` and `by`, and an ISO timestamp `at`), and a stored value of another form fails the parse.
  - R3. While `closure.followups` is true, `card close` with `--followups`, `--all` or `--skip-followups` shall make no gh call for the step and leave the step and the fields of R2 as they are.
  - R4. When no `followupPending` is stored and the ship path is not `github`, no `repository` is configured, or `followupFindings` of the run is empty, the step shall be recorded with `followupIssue` null and a `followupNote` that names the case, with no gh call.
  - R5. The marker shall be `findingMarker(cardId, prNumber, sha, 'review followups')` with the sha of the run's candidate, or the `headRefOid` of its PR when the run has no candidate, and the step fails with no gh call when the run has neither.
  - R6. Otherwise the step shall read `issuesWithLabel(repository, 'review-followup')` and take, as the issue of the run, the lowest-numbered issue whose last line that is not empty equals the marker, where the repository and the marker are those of `followupPending` when one is stored and the configured repository and the marker of R5 when none is.
  - R7. When no issue is found and no `followupPending` is stored, the step shall call `ensureLabel`, store `followupPending` by one locked update of the card run, and then call `submitIssue` once, with the title `Review follow-ups: <cardId>`, the `followupIssueBody` of the findings of the record that update wrote, and the label `review-followup`.
  - R8. The reservation update shall refuse without submission unless the current locked run is in CLOSE with its merge verified, its followups step is open, it has no followupPending, its ownerGeneration equals the caller's captured generation, the card lease passes its fence with a fresh clock reading while both the card-run lock and then the card-lease lock are held, and the goal re-read there is non-terminal and at the caller's goal generation.
  - R9. When no issue is found and a `followupPending` is stored, the step shall submit nothing and fail with a message that names the repository, the marker, the time and the session of the pending submission and the two recovery commands, `card close <id> --followups` again later and `card close <id> --skip-followups "<why>"`.
  - R10. `card close <id> --skip-followups "<why>"` shall record the step with `followupIssue` null and the trimmed text as `followupNote`, with no gh call, and refuse a blank text and the combination with `--followups` or `--all` before any write.
  - R11. Every closure write made by this command shall merge only its intended changes into the current locked card-run record, holding the card-run lock and then the card-lease lock through the write with a fresh lease fence; a follow-up disposition applies the checks of R8 except the absence of followupPending, sets closure.followups and followupIssue, sets or removes followupNote and removes followupPending, while writes of other closure steps retain their existing guards.
  - R12. When the write of R11 is refused after `submitIssue` or the lookup gave a number, the command shall leave the stored record as it is and name the number in its message.
  - R13. When the step fails, the other requested steps shall be done under the guards they have without it, and the command exits non-zero with a message part that starts with `followups:`.
  - R14. Every gh call of the step shall run in the main checkout.
  - R15. A `followupPending` shall not by itself move a merged run out of CLOSE, also after `card next`.
  - R16. The close directive of `card next` shall list `followups` while it is not recorded and name `--followups` and `--skip-followups`, and the close narration of `aidlc next` lists `followups` among the steps.
  - R17. A `card-result` report shall refuse a patch with an own property `followupIssue`, `followupNote` or `followupPending`, also one whose value is undefined, before any write.
  - R18. Existing tests and helpers shall preserve their existing cases and assertions, with edits limited to adding followups to closure flags, expected closure records, narrations and step-count comments, except for the R19 traceability pin and extensions of `tests/scenarios/fault-points.test.ts` needed for this command: imports, stage types, fixtures, COVERED entries, submission counters, fault injection, stage-specific recovery, observations, expected writes, end-state checks and current documentation pins; new cases and helpers proving this card are permitted within allow_paths.
  - R19. `docs/OPERATIONS.md` (the `--all` example, Closure steps, Fault-point check) shall state the commands, the failures and the recovery, `docs/ARCHITECTURE.md` (the closure predicates, the CardRun row) the fields, their defaults and the limits of the non_goals, `docs/REQUIREMENTS-TRACEABILITY.md` (R25-R27, with its pin in `tests/surface/removed-surface.test.ts`) that the loop calls `findingMarker` in this step, and the CLOSE row of README.md the step.
acceptance:
  - 1. `tests/scenarios/followup-issue.test.ts` (new), injected runner. A merged run with an advisory reason, an advisory finding and a deferred finding makes the list call, the label call and one submit with the title, the label and the body on stdin, all in the main checkout after `--all` removed the worktree too, and then holds the number and the step, no note and no pending record. RED on main (no flag). [R6] [R7] [R11] [R14] [dod arm 2]
  - 2. Same file. An issue of the second page whose last line is the marker is recorded with no label and no submit call, and of two the lower number. An issue that holds the marker inside a finding, with other text on its line, with more characters after it, or above the last line is not the issue of the run. [R6] [dod arm 2]
  - 3. Same file. A ship path that is not `github`, no repository, and no finding each record null and the note with no gh call; run again after the repository is set, and `--skip-followups` on a recorded step, change nothing. [R3] [R4] [dod arm 2]
  - 4. Same file. A stored run whose closure lacks the key, with advisory findings and other steps open, closes by `--all` and a lesson disposition with no gh call and none of the fields of R2; a new run starts with the step false, the `card next` close directive names the missing followups step and both `--followups` and `--skip-followups`, and the `aidlc next` close narration names followups. `tests/core/types.test.ts` covers the forms of R2, absent, null and malformed. [R1] [R2] [R3] [R16] [dod arms 2, 13]
  - 5. Same file. An adopted merge without a candidate takes the sha of its PR, a candidate that differs from the PR head is used, and a run with neither fails with no gh call and closes by `--skip-followups`. [R5] [dod arm 2]
  - 6. Same file. A list call that fails, times out or does not parse, and a label call that fails, leave no pending record and the step open, with the other flags of `--all` done and a message part `followups:`; the next call files one issue. [R7] [R13] [dod arm 2]
  - 7. Same file. A submit that times out, exits 1 or prints no issue URL leaves the pending record. The next close, with a `card next` before it and without, submits nothing and fails with the text of R9 while the issue is not listed, and records it once it is; it does so also when the configured repository, the ship path or the candidate changed in between. One submit call in each case. [R6] [R9] [R15] [dod arm 2]
  - 8. Same file. A goal cancelled or moved to another generation, a lease expired or taken over, and a pending record or a recorded step written by another close, each set during the list call and again during the label call, get no submit call and keep what was written. [R8] [dod arm 2]
  - 9. Same file. A goal cancelled, a lease taken over and a `--skip-followups` during the submit call each leave the stored record as the other command wrote it and name the number. After `aidlc goal resume` and `card next`, and after a takeover by `card next`, the next close records the issue from the list with no submit. A close of other flags and a `card next` between the pending record and the record of the step lose no field. Repeat the refusal case with cancellation during a lookup that returns a matching issue: the command names its number, makes no label or submit call, and leaves the stored card run unchanged. [R11] [R12] [dod arm 2]
  - 10. Same file. `--skip-followups` with and without a pending record records null and the trimmed note and removes the pending record. Through the CLI entry, a missing value, blank text and combination with `--followups` or `--all` are refused with nothing written; a failed follow-up step exits non-zero and prints a message part starting with `followups:`; and `--followups` alone leaves the other steps open. A report with each property of R17, also undefined, is refused with nothing written. [R10] [R13] [R17] [dod arm 2]
  - 11. `tests/scenarios/fault-points.test.ts`, with a new stage and COVERED entry. Fail each actual card-run write and goal journal append of `card close --followups` in turn, count submissions across the failed command and recovery, and assert at most one submission and preservation of a committed pending record until lookup records the issue or explicit skip clears it. Separately wrap the reservation's store update in the test so that it completes the real update and then throws before returning to the submit call; assert zero submissions, restart with a fresh CardRunner over the same stored state, and assert lookup-only recovery with pending and no issue until `--skip-followups`. This separate case simulates interruption after reservation, not operating-system process death. [R7] [R9] [R11] [dod arm 3]
  - 12. Existing tests pass with only the changes permitted by R18; the new tests and fault-test extensions prove their cited requirements. `npm run check` passes in the implementation worktree, with the command, commit, totals and changed existing-test lines recorded in the Attempt evidence. [R18] [dod arms 2 to 19]
  - 13. Doc text (reviewer-verified against the diff) is as R19, the fragment has the form of `changelog.d/README.md`, and the verify-card-run-writes skill names the command, its writes and the end without an issue. `.claude/skills/aidlc-loop/card-loop.md` and its template copy are unchanged. [R19] [dod arms 15, 16, 18, 19]
depends_on: [T1-REVIEW-FOLLOWUP-CORE, T0-ADVISORY-WITHDRAW]
budget: 250
tdd: true
sweep: "Discovery evidence only: the whole suite on 2a87bf7c (the stopped card with main at 6c517433 merged, its closing tests already changed) gives 4,185 tests, 4,152 pass, 32 skipped, 1 fail, tests/scenarios/adopt-merge.test.ts:104. `git diff --numstat` of that branch against its merge base names the other files a new closure step changes: tests/scenarios/_harness.ts, audit, card-close-cleanup, fault-points, lesson-dup, review-rule-goal, run-driver, t0-flow and worktree-reclaim, tests/surface/lessons and removed-surface. Main at 9278ab1d: `close` and `markClosure` (src/loop/card-runner.ts) compute the missing steps from the closure record and save a snapshot read before the steps run, which saveCardRun refuses once the revision moved (src/state/goal-store.ts:62); the raw-patch guard names closure, mergeVerified and ownerGeneration (src/loop/controller.ts:670); controller.ts:519 and card-machine.ts:28 list the six steps; adoptMerge records a run without a candidate. Doc sentences that state the steps: OPERATIONS.md:93 (five mechanical steps) and :747, ARCHITECTURE.md:144, README.md:124. `git grep -n findingMarker` finds REQUIREMENTS-TRACEABILITY.md:20 and removed-surface.test.ts:103."
forbid: ["a submit call before the merge is verified or from a command other than card close", "a search query of GitHub", "a write to GitHub from a test", "editing .aidlc state by hand"]
non_goals:
  - "an issue for a card closed before this card (67 of 289 merged runs held such a finding on 2026-11-24)"
  - "an issue after the step is recorded with null: the note names why, and the owner files by hand"
  - "stopping a submission that has started: a goal cancelled or a step skipped after the update of R7 does not recall the request"
  - "a second submission after a crash between the pending record and the request: the run then has no issue until the operator skips the step"
  - "a record in the operation ledger: an UNKNOWN operation moves the run to WAIT, where card close refuses (F10)"
hygiene: "Starts from main after T1-REVIEW-FOLLOWUP-CORE and T0-ADVISORY-WITHDRAW have merged (both cards that change src/loop/card-runner.ts run one at a time); line numbers are read again at PREPARE. Code of 2a87bf7c may be reused where it meets these requirements; its reservation in the operation ledger is replaced. `tests/scenarios/` is allowed as a directory so that a closing test added to main later needs no amendment, and R18 limits what may change there. RED first. New fixtures make their directories with `tmpDir` of tests/infra/helpers.ts. Run `npm run check` in the worktree before the attempt is recorded. Run the verify-card-run-writes skill before SHIP and move its sync commit at CLOSE. Checked against the newest lessons on 2026-11-24: absent, undefined and empty are cases of their own (T0-PR-SUMMARY), every sentence a narration changes is swept (T0-RED-PATH-TEXT), each document gets its whole clause and the count of steps beside it (T0-PR-SUMMARY-REUSED), a CLI test sets every variable the code reads (T0-INIT-CLI-PATH)."
doc_sync: docs/OPERATIONS.md, docs/ARCHITECTURE.md, docs/REQUIREMENTS-TRACEABILITY.md, README.md, changelog.d/T1-REVIEW-FOLLOWUP-ISSUE-2.md
---

# T1-REVIEW-FOLLOWUP-ISSUE-2

Second of the two cards that replace T1-REVIEW-FOLLOWUP-ISSUE (stopped at R3 decision 4).

## Why
Owner's decision of 2026-11-16 (`intent/review-recall.md`): advisory and deferred findings are logged as one GitHub issue per shipped card. Main records the findings and creates no follow-up issue.

## Deliverable
One closure step that files the issue at most once per run. A submission that may have reached GitHub is never repeated: it is found by its marker, or the operator skips the step with a reason.

## The findings of the stopped card
| Finding | Here |
|---|---|
| F1, F2, F5 | T1-REVIEW-FOLLOWUP-CORE |
| F3 unfenced creation, F6 cancelled goal | R8 and R12, acceptance 8 and 9 |
| F4 stale note, F9 historical run | R3, acceptance 3 and 4 |
| F7 ambiguous create, F8 manual reconciliation | R6 and R9, acceptance 7 |
| F10 recovery not reachable after `card next` | R15, acceptance 7: no operation is recorded, so the run stays in CLOSE |

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/followup-issue.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/adopt-merge.test.ts tests/scenarios/card-close-cleanup.test.ts tests/scenarios/goal-close-stages.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/audit.test.ts tests/scenarios/run-driver.test.ts tests/scenarios/lesson-dup.test.ts tests/scenarios/review-rule-goal.test.ts tests/scenarios/worktree-reclaim.test.ts tests/core/types.test.ts tests/surface/lessons.test.ts tests/surface/removed-surface.test.ts tests/surface/templates.test.ts tests/surface/test-temp.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: at most one submission per run under every failure named above, each run ending with a recorded issue, a recorded reason or a pending record, and every test that closes a card passes with the step added.

## PR summary

### What
`aidlc card close --followups` records one GitHub issue for the advisory and deferred findings of a merged card. `--all` includes the step. `--skip-followups` records the step with a reason and no issue.

### Why / Intent
The owner decided on 2026-11-16 to log these findings as one issue per shipped card. Main recorded the findings and created no issue.

### How / Behaviour
The step looks for the issue by its marker. When it finds none, it stores a pending record and submits the issue once. A submission with an unknown outcome is never repeated. Later calls look for the issue, or the operator skips the step.

### System impact
The card run gains one closure flag and three optional fields. A closure stored before this change has the step done. Each closure write now merges into the stored run under two locks.

### Security
Reviewer text goes to the issue body through `followupIssueBody`, which neutralises mentions. The gh calls use argv arrays. A raw patch cannot set the new fields.

### Tests and review
`tests/scenarios/followup-issue.test.ts` covers the step with a scripted gh. The fault-point test fails each write of the command. R3 reviews the candidate.

### Risk
Medium. The step writes to GitHub. A crash between the pending record and the request leaves no issue until the operator skips the step.

### Ownership
The aidlc loop maintainers.

### Docs
`docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`, `docs/REQUIREMENTS-TRACEABILITY.md`, `README.md`, the verify skill and the changelog fragment state the change.

## Attempt evidence
RED: `fe2728518ac4fc15cf031a455c7ca6d7ebae61cb`, `node --test tests/scenarios/followup-issue.test.ts tests/core/types.test.ts`: 36 tests, 23 pass, 13 fail, each new test among the failures.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/scenarios/followup-issue.test.ts`, acceptance 1 (`--followups` alone, `--all` over a real worktree, and a finding recorded during the label call) | RED at fe272851, pass |
| 2 | Same file, acceptance 2 (4 found rows, 7 rows that are not the issue, one pull request) | RED, pass |
| 3 | Same file, acceptance 3 | RED, pass |
| 4 | Same file, acceptance 4; `tests/core/types.test.ts`, the describe "the followups closure step" | RED, pass |
| 5 | Same file, acceptance 5, through `adoptMerge` for the run without a candidate | RED, pass |
| 6 | Same file, acceptance 6 | RED, pass |
| 7 | Same file, acceptance 7 (4 submit answers by 8 changes in between) | RED, pass |
| 8 | Same file, acceptance 8 (12 changes during the list call and the label call, and the fence inside both locks) | RED, pass |
| 9 | Same file, acceptance 9 | RED, pass |
| 10 | Same file, acceptance 10 and "acceptance 10, CLI" (PATH names an empty directory, so no gh runs) | RED, pass |
| 11 | `tests/scenarios/fault-points.test.ts`, stage F of COVERED, and the describe "the pending record of card close --followups" | pass; with the reservation write removed from the source 4 tests fail |
| 12 | `npm run check` in the worktree at `898866143fe9e8e15b0a436c1e269be633adad41` | exit 0; 4249 tests, 4217 pass, 0 fail, 32 skipped |
| 13 | The docs, the fragment and the verify skill in the diff; `changelog-fragments`, `prose`, `templates`, `removed-surface` | reviewer-verified; pass |

Changed existing-test lines (line numbers of main), each for the new step: `_harness.ts` 154, `adopt-merge` 123, `audit` 164, `card-close-cleanup` 323, `card-continue-goal` 235, `review-rule-goal` 291 and 462, `run-driver` 432, `t0-flow` 95, 249 and 2178 and `lesson-dup` 17 add the flag; `t0-flow` 90 and 2144, `lesson-dup` 89, `lessons` 187 and `worktree-reclaim` 658 add it to the expected missing steps or record; `lesson-dup` 92 is the narration; `card-close-cleanup` 30 and `lesson-dup` 20 are step counts in comments; `removed-surface` 103 is the R19 pin. In `fault-points`: 3, 17, 28, 40, 44, 54, 78, 125, 280, 298, 306, 331, 370, 387, 653, 698 to 701, 709, 720, 733, 737, 742 and 752 (imports, stage type, fixture, counters, recovery, end states, documentation pins). Every other changed line of an existing test file is an addition.

Guards: 20 changed forms of the source were run one at a time against `followup-issue.test.ts` (19) and `fault-points.test.ts` (1): the state, merge, generation, fence, open-step, goal-terminal, goal-generation, second-reservation and other-target checks, the early return of a recorded step, the pending target and refusal, the lowest number, the last line, the working directory of the submit, the findings of the reserved record, the merge into the stored record, the raw-patch name, the historical default and the stored reservation. Each was caught.

Attempt 1 (09fb3d0a) passed R3 twice and failed CI on PR 477: PR 475 had merged after its base sync with two tests that close a card, in `card-continue-goal.test.ts` and `review-rule-goal.test.ts`. Attempt 2 merges main and adds the flag to both.

The first `npm run check`, at 611113d4, failed `t0-flow.test.ts:251`: that test reads the last EVIDENCE_RETAINED event of a close as the lesson event. The step journals a NOTE instead, and the test keeps its assertion.
