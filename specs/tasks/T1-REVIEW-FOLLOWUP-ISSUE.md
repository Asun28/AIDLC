---
id: T1-REVIEW-FOLLOWUP-ISSUE
title: A closure step files one GitHub issue labelled review-followup per merged card run that lists its advisory and deferred formal findings, found again by a marker in its body so a retry never files a second one
status: todo
branch: T1-REVIEW-FOLLOWUP-ISSUE
worktree: D:\wt\AIDLC\T1-REVIEW-FOLLOWUP-ISSUE
plan_ref: plans/review-recall.md#order-of-work
allow_paths:
  - src/core/types.ts
  - src/core/review-policy.ts
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - tests/scenarios/followup-issue.test.ts
  - tests/scenarios/fault-points.test.ts
  - .claude/skills/verify-card-run-writes/SKILL.md
  - .claude/skills/aidlc-loop/card-loop.md
  - templates/claude/skills/aidlc-loop/card-loop.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - docs/REQUIREMENTS-TRACEABILITY.md
  - tests/scenarios/card-close-cleanup.test.ts
  - tests/scenarios/goal-close-stages.test.ts
  - tests/scenarios/_harness.ts
  - tests/scenarios/audit.test.ts
  - tests/scenarios/review-rule-goal.test.ts
  - tests/scenarios/run-driver.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/scenarios/lesson-dup.test.ts
  - tests/scenarios/worktree-reclaim.test.ts
  - tests/surface/lessons.test.ts
  - tests/surface/removed-surface.test.ts
  - src/probes/gh.ts
  - tests/infra/gh.test.ts
  - specs/tasks/T1-REVIEW-FOLLOWUP-ISSUE.md
dod_command: npm run typecheck && node --test tests/scenarios/followup-issue.test.ts tests/infra/gh.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/card-close-cleanup.test.ts tests/scenarios/goal-close-stages.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R1. The closure record of a card run (`CardRun['closure']`, src/core/types.ts) shall gain the step `followups`. A run created after this card starts with it false; a record that lacks the key parses with it true, so no run closed or closing before this card gains a step. `CardRun` shall gain `followupIssue` (optional: a positive issue number, or null when the step filed none) and `followupNote` (optional text saying why none was filed).
  - R2. The follow-up findings of a run shall be, in this order and once each by trimmed text: every reason in the `advisory` list of the run's decided formal invocations (R3 and ship path), every formal finding with `advisory: true`, and every finding whose `ruling` defers it without an issue number. A run with none has no follow-up findings.
  - R3. `aidlc card close <id> --followups` (and `--all`, which includes it) shall, on a CLOSE run with its merge verified under the same lease and generation checks as every other closure flag (`markClosure`, src/loop/card-runner.ts:3260): when the ship path is not `github`, `repository` is not set, or the run has no follow-up findings, record the step with `followupIssue: null` and a `followupNote` naming the case; otherwise find or file the issue (R4) and record its number, the step and the number in one store write.
  - R4. The marker shall be `findingMarker(cardId, prNumber, candidateSha, 'review followups')` (src/core/review-policy.ts:223). The step shall use the runner's injected `GhProbe` methods of T1-GH-ISSUES: it files with `createIssue(repo, title, body, 'review-followup')` only when no issue of `issuesWithLabel(repo, 'review-followup')` holds the marker in its body; a match is recorded instead. The issue title is `Review follow-ups: <cardId>`; the body names the card, the PR number, the candidate SHA, each follow-up finding as a list item with its finding id where it has one, and the marker on its last line.
  - R5. A failure of either gh call shall leave the step unset and the run unchanged, and `card close` shall exit non-zero naming the call; the next `card close --followups` retries and, through R4, files no second issue.
  - R6. `close()` (card-runner.ts:3197-3248) shall list `followups` among the missing steps until it is recorded, and its narration shall name `--followups`.
  - R8. The existing tests and helpers that drive a new card run to DONE by marking the six closure steps of main (tests/scenarios/_harness.ts `driveCardToDone`, audit.test.ts, review-rule-goal.test.ts, run-driver.test.ts, t0-flow.test.ts, lesson-dup.test.ts, worktree-reclaim.test.ts, tests/surface/lessons.test.ts, card-close-cleanup.test.ts) shall also mark or expect `followups`, and an expected narration that lists the closure flags shall name `--followups`; each such line changes by that addition only and is listed in the Attempt evidence. The R25-R27 row of docs/REQUIREMENTS-TRACEABILITY.md and its pin in tests/surface/removed-surface.test.ts shall say that the loop calls `findingMarker` in the `followups` closure step, which this card makes true; no other row or line changes. In tests/infra/gh.test.ts the T1-GH-ISSUES acceptance 1 and 3 tests may change their expected argv and scripted response keys from the single `gh issue list --limit 100` call to the paginated lookup that R3 decision 1 of this card required (every page of the label read), and nothing else in them. card-loop.md keeps its sentence on unrelated findings (a deduplicated issue keyed by a card/PR/SHA marker); the new CLOSE text is fitted within the byte cap by its own wording, not by removing another rule.
  - R7. docs/OPERATIONS.md (closure), docs/ARCHITECTURE.md (closure record) and docs/REQUIREMENTS-TRACEABILITY.md (the R25-R27 row, which says idempotent issue creation is not implemented) shall state R1 to R6. .claude/skills/aidlc-loop/card-loop.md and its template copy stay as on main: they are 6 bytes under the cap tests/surface/templates.test.ts asserts with the rule on unrelated findings kept, and the CLOSE directive names `--followups` when the step is missing (R6).
acceptance:
  - 1. `tests/scenarios/followup-issue.test.ts` (new), "T1-REVIEW-FOLLOWUP-ISSUE acceptance 1: a merged run with advisory and deferred findings files one issue with the marker, the label and each finding, and records its number". Scripted `gh` (the injected runner). Fails on main (no flag). [R1] [R2] [R3] [R4] [dod arm 1]
  - 2. Same file, "T1-REVIEW-FOLLOWUP-ISSUE acceptance 2: an issue already holding the marker is recorded and none is filed; a failed create leaves the step unset, and the retry files once". Fails on main. [R4] [R5] [dod arm 1]
  - 3. Same file, "T1-REVIEW-FOLLOWUP-ISSUE acceptance 3: no issue on another ship path, without a repository, or with no follow-up finding; the step is recorded with a note". Fails on main. [R3] [dod arm 1]
  - 4. Same file, "T1-REVIEW-FOLLOWUP-ISSUE acceptance 4: a stored run without the key parses with the step done, a new run starts without it, and close lists it as missing". Fails on main by assertion. [R1] [R6] [dod arm 1]
  - 5. `tests/scenarios/fault-points.test.ts` covers the store write of `card close --followups` by an added case, with no existing line changed, and passes; card-close-cleanup.test.ts, goal-close-stages.test.ts and templates.test.ts pass with no line changed. At CLOSE, .claude/skills/verify-card-run-writes/SKILL.md moves its sync commit to the merge commit on main. [R3] [R5] [R7] [dod arm 1]
  - 6. The skill and doc sentences are as R7 states (reviewer-verified against the diff). [R7]
depends_on: [T1-FINDING-IDENTITY, T1-GH-ISSUES]
budget: 230
tdd: true
sweep: "Main at 0f28b51e. `close` src/loop/card-runner.ts:3197-3248 computes missing steps from `run.closure` at :3201 and names each step's flag in its narration; `markClosure` :3260 checks the goal generation, CLOSE state, merge verification and lease fence before any flag is written. `findingMarker` review-policy.ts:223-230 is a pure function the loop does not call (docs/REQUIREMENTS-TRACEABILITY.md:20, `partial`). `GhProbe.issuesWithLabel` and `createIssue` come from T1-GH-ISSUES. card-loop.md CLOSE says an unrelated finding becomes a deduplicated issue keyed by a card/PR/SHA marker. Formal invocations keep their advisory reasons in `advisory` (types.ts:309-349; set at card-runner.ts:2447 and :2871). A finding's `ruling` is `FindingRuling` (types.ts:508); `aidlc review rule --defer --issue <n>` stores an issue number on it."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test, other than an expected literal that pins the exact text of a document line this card's requirements change, or the exact shape of a record or report whose fields this card's requirements add (a deepEqual of `FindingStats`, `ReviewFinding`, a bench report or case result, or `CardRun['closure']`), updated to the new text or by the added fields and nothing else, each such line named in the Attempt evidence with the requirement that changes it (a test file outside allow_paths needs a recorded amendment first)
  - filing an issue before the merge is verified, or from any command other than card close
  - a GitHub search query to find the marker (the search index lags; R4 lists by label)
  - a shell string for a gh call
  - editing .aidlc state by hand
non_goals: [making P2 findings non-blocking, a follow-up card file, filing issues for runs closed before this card, a change to CHANGELOG.md]
hygiene: "Run `npm run check` (typecheck and the full suite, as CI runs it) in the worktree before recording the attempt and put its totals in the Attempt evidence (lesson of T1-REVIEW-SEVERITY-2, CI run 43757539597). Line numbers are from main at 0f28b51e and move with T1-REVIEW-SEVERITY and T1-FINDING-IDENTITY; read them again at PREPARE. This card adds a store write to a command the verify-card-run-writes coverage record names, so run that skill before SHIP and at CLOSE, and extend its record."
doc_sync: docs/OPERATIONS.md (closure), docs/ARCHITECTURE.md (closure record), docs/REQUIREMENTS-TRACEABILITY.md (R25-R27), .claude/skills/aidlc-loop/card-loop.md (CLOSE)
---

# T1-REVIEW-FOLLOWUP-ISSUE

## Deliverable
When a card closes, its advisory and deferred findings land in one GitHub issue labelled `review-followup`, and a crash or retry never files a second one.

## Why
Owner's decision of 2026-11-16 (intent/review-recall.md): advisory and non-blocking findings are logged as one GitHub issue per shipped card. Today an advisory finding is retained in `.review/` and shown to the author, and nothing carries it past the merge; `findingMarker` was written for a deduplicated issue and is never called.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/followup-issue.test.ts tests/infra/gh.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/card-close-cleanup.test.ts tests/scenarios/goal-close-stages.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; no existing test line changes.

## Attempt evidence

Attempt 1: BLOCKED, no attempt recorded. R1 ("a run created after this card starts with it false") with R6 means every existing test that drives a new run to DONE by marking the six old steps now stops at CLOSE. Those tests sit outside allow_paths, so they need a recorded amendment.

- RED 97437417 `tests/scenarios/followup-issue.test.ts`: acceptance 1-4 fail by assertion on main (`0 !== 1` one issue filed; `undefined !== 55`; dry-run case: followups not recorded; a new run does not start with the step false).
- GREEN 68eb174b, then 5f8f79d5 (docs). Followup acceptance 1-4 pass. The added fault-point case passes, with a scratch break shown (`{ ...followup }` dropped from the journal data: `k=1 ... undefined !== 200`).
- DoD (`npm run typecheck && node --test <6 files>`): exit 1, 129 tests, 126 pass, 1 fail, 2 skipped. The failure is `goal-close-stages.test.ts:8` (`T1-HELLO: expected done, got close`) through `driveCardToDone` in `tests/scenarios/_harness.ts:154`, outside allow_paths.
- `npm run check` at 5f8f79d5: exit 1, 3745 tests, 3633 pass, 84 fail, 28 skipped. All 84 failures are this one cause.
- Scratch run, not committed: adding `followups: true` (or `'followups'`) to these literals leaves 2 failures, `lesson-dup.test.ts:57` and the exact narration at `:90`:
  - `_harness.ts:154`
  - `audit.test.ts:164`
  - `review-rule-goal.test.ts:291`
  - `run-driver.test.ts:432`
  - `t0-flow.test.ts:90, 98, 249, 2143, 2177`
  - `lesson-dup.test.ts:89` and the markClosure before `:50`
  - `worktree-reclaim.test.ts:658`
  - `lessons.test.ts:187`
- R7 row R25-R27 is not changed. `tests/surface/removed-surface.test.ts:103` pins it, and a loop assertion there requires "`findingMarker` exists as a pure function the loop does not call", so changing the row needs a ruling.
- Pinned line changed: `tests/scenarios/card-close-cleanup.test.ts:323` adds `followups: true` to the closure flags (R1).
- card-loop.md: 6499 bytes (cap 6500), both copies identical and ASCII. CLOSE adds one line. The Review sentence "Unrelated finding: deduplicated issue keyed by card/PR/SHA marker." is removed to make room; the follow-up issue is that issue.
- Reviewer text in the issue body: each finding is one list item, whitespace is collapsed, and `@name` gets a zero-width space.
- Mutants, all 26 killed by followup-issue.test.ts (M20 by the fault-point case):
  - M1-M2: default true/false split
  - M3-M5: each R3 skip case
  - M6-M7: marker never matches / always matches
  - M8: failure swallowed
  - M9: `--all` leaves the step out
  - M10: `--followups` not wired
  - M11: pending invocations included
  - M12: no dedupe
  - M13: no trim
  - M14: pre-stage advisory included
  - M15: deferred with an issue number included
  - M16: rejected findings included
  - M17: invocation advisory dropped
  - M18: narration does not name `--followups`
  - M19: issue number not recorded
  - M20: journal does not name the issue
  - M21: wrong marker reason
  - M22: wrong title
  - M23: marker not on the last line
  - M24: finding ids dropped
  - M25: wrong label
  - M26: order swapped

Attempt 1, after the R8 amendment (74dba070), candidate e40388f6:
- R8 changed lines, each by the addition only:
  - `tests/scenarios/_harness.ts:154`: `followups: true`
  - `audit.test.ts:164`: `followups: true`
  - `review-rule-goal.test.ts:291`: `followups: true`
  - `run-driver.test.ts:432`: `followups: true`
  - `t0-flow.test.ts:90`: `'followups'`
  - `t0-flow.test.ts:95`: `followups: true` on the five-step mark, so `:98` stays `['lessons']`
  - `t0-flow.test.ts:249, 2177`: `followups: true`
  - `t0-flow.test.ts:2143`: `'followups'`
  - `lesson-dup.test.ts:17` (`FIVE`): `followups: true`
  - `lesson-dup.test.ts:89`: `'followups'`
  - `lesson-dup.test.ts:92`: the expected narration adds `, followups` to the step list and the `--followups` sentence
  - `worktree-reclaim.test.ts:658`: `followups: true`
  - `tests/surface/lessons.test.ts:187`: `'followups'`
  - `card-close-cleanup.test.ts:323`: `followups: true`, from before the amendment
- R25-R27: the row status now says the loop calls `findingMarker` in the `followups` closure step. In `removed-surface.test.ts`, the R25-R27 tuple leaves the uncalled-function `rows` loop, because the loop requires the old phrase for every row. One `assert.equal` after the loop pins the new row. No other row or line changed.
- card-loop.md: both copies are back to main (6494 bytes, identical, ASCII), and the unrelated-finding sentence stays. The new CLOSE line is not there: the cap leaves 6 bytes free, and the shortest wording is 72 bytes, so R7 for card-loop.md is open.
- DoD: exit 0, 129 tests, 127 pass, 0 fail, 2 skipped.
- `npm run check` at e40388f6: exit 0, 3745 tests, 3717 pass, 0 fail, 28 skipped. The verify-card-run-writes check passes, including the followups case.

Attempt 1, after the R7 amendment (64ce6f58), merged at 60d0c586:
- R7: card-loop.md and its template are unchanged under the amendment. `git diff main -- .claude/skills/aidlc-loop/card-loop.md templates/claude/skills/aidlc-loop/card-loop.md` is empty. The CLOSE directive names `--followups` (R6), and docs/OPERATIONS.md states the step.
- DoD: exit 0, 129 tests, 127 pass, 0 fail, 2 skipped. The full suite passed at e40388f6 (3745 tests, 3717 pass, 0 fail, 28 skipped). The merge since then brings only card text.

Attempt 2, the repair of R3 decision 1 (F1-F4), at 5498a0de:
- F1: a duplicate keeps its first position and gains the finding id it lacked. Acceptance 1 now expects `- F2: Prefer a Map for the lookup.`, and fixture F8 shows a first id is never replaced.
- F2: `issuesWithLabel` reads `gh api repos/<repo>/issues?labels=<label>&state=all&per_page=100&page=N` until a short page. Pull requests are left out, and a null body reads as empty. Past 1000 pages it throws instead of returning a partial list.
  - The argv and keys of `tests/infra/gh.test.ts` T1-GH-ISSUES acceptance 1 and 3 change from `gh issue list` to the API (amendment 4178f0a7).
  - New tests: a match on page 2 in gh.test.ts and in followup-issue.test.ts.
- F3: the lookup and the create run under an `other` operation with the effect `review-followup issue`, journaled with `OPERATION_INTENT`.
  - While its intent is unresolved, `close()` refuses a takeover of the card lease.
  - The lease is fenced again before the create and before the result.
  - The reservation resolves as `succeeded` before the card-run write, or as `failed` on any error. A retry reuses an unresolved reservation, journals a missing intent, and looks up by marker again before it creates.
  - Tested: a lease that expires during the lookup gets its takeover refused and the old closer files nothing; a lease that expires during the create records nothing.
- F4: a recorded issue clears `followupNote`. Tested: a skip without a repository, then a success.
- Fault points: the followups case now expects the writes `OPERATION_INTENT`, `EVIDENCE_RETAINED` and the record write, plus a second case that fails each of the two operation writes in turn. The retry files no second issue, and every reservation is resolved and journaled. The verify-card-run-writes record names the operation writes.
- Sweep:
  - Dedupe sites: only `followupFindings`.
  - gh calls treated as complete in this step: only `issuesWithLabel`. `checkRuns` (50-page cap) and `prsForBranch` predate this card and are outside its scope.
  - Network calls between a fence and a write: the lookup and the create, both fenced again.
  - Optional fields a later success must clear: `followupNote`.
- Mutants, all 15 killed:
  - N1: no id enrichment
  - N2: id overwritten
  - N3: first page only
  - N4: pull requests included
  - N5: stop on a full page
  - N6, N15: takeover ignores the reservation
  - N7: no fence before the create
  - N8: no fence before the result
  - N9: reservation not reused
  - N10: intent not journaled on reuse
  - N11: no failed result
  - N12: note kept
  - N13: no lookup before the create
  - N14: success not marked
- DoD: exit 0, 134 tests, 132 pass, 0 fail, 2 skipped.
- `npm run check`: exit 0, 3750 tests, 3722 pass, 0 fail, 28 skipped.

Attempt 3, the repair of R3 decision 2 (F5-F8), at 4c2bdda3:
- F5: answered by amendment c04e294c. The gh.test.ts edits are only the T1-GH-ISSUES acceptance 1 and 3 argv and scripted-key changes to the paginated lookup.
- F6: each attempt for a marker is the operation `op-followup-<sha256(marker)[0..12]>-<n>` (kind `other`, effect `review-followup issue`).
  - The step journals `OPERATION_INTENT`, then creates the record as `running` through `updateJson` from src/state/store.ts. That is the same `<file>.lock` serialisation as card runs and leases; OperationLedger offers no compare-and-set, and src/coordination/reconcile.ts is outside allow_paths. No new lock is added.
  - A command that finds the record already written is refused. So is a command that finds an attempt of the marker `running`, `UNKNOWN`, `intended` or `issued`. Both refusals come before any gh call and name the operation and `aidlc ops reconcile <id> --status succeeded --provider-id <n>` (or `--status failed`).
  - A running operation also holds `card next` in WAIT (precedence rule 4). A crash leaves the attempt `running`, which takes the existing reconcile path.
  - The takeover filter in `close()` is back to main.
- F7: the lease fence and the persisted goal (not terminal, same generation, the `assertLiveGoal` of `markClosure`) are both checked before the create and before the result.
- F8: the attempt ends:
  - `succeeded` once the number is known, including when a later check fails;
  - `UNKNOWN` when the issue create call failed after it may have been sent (timeout, lost response, non-zero exit, no URL);
  - `failed` otherwise (the lookup, a check before the create, the label call).

  An `UNKNOWN` attempt blocks every later close until it is reconciled, and the next close looks up by marker again. In acceptance 2, the create failures now go through that reconcile before the retry.
- Sweep 1, each external call and the status its failure leaves:
  - `issuesWithLabel`: failed (acceptance 2 list case)
  - check before the create: failed (F3 lookup-expiry test, F7)
  - `label create`: failed (F8 label test)
  - `issue create`: UNKNOWN (acceptance 2 refused and lost cases; F8 timeout test)
  - check after the create: succeeded (F3 create-expiry test)
  - result write failing: the attempt is resolved by the catch, or left running and reconciled (fault case for the operation writes)
- Sweep 2, checks repeated after a network call:
  - lease fence: F3 (both cases)
  - goal terminal state and generation: F7
  - operation status: the claim (F6)
  - card-run revision: compare-and-set at save
- Sweep 3, interleavings:
  - same-session overlap: F6, plus a record written between the count and the claim
  - another session's `card next` during the lookup: F3, it waits and does not take over
  - goal cancel or generation change during the lookup: F7
  - lease expiry during the create: F3
  - a create that completes on GitHub after a timeout: F8
- Mutants, all 14 killed:
  - P1: no open-attempt check
  - P2: no claim compare-and-set
  - P3: UNKNOWN recorded as failed
  - P4: label failure recorded as UNKNOWN
  - P5: no goal recheck
  - P6: known number recorded as failed
  - P7: no recheck before the result
  - P8: no recheck before the create
  - P9: `sent` set after the create
  - P10: claim not `running`
  - P11: intent not journaled
  - P12: the same id for every attempt
  - P13: note kept
  - P14: no lookup
- Fault points: the followups cases pass unchanged. The writes are still the `OPERATION_INTENT` and `EVIDENCE_RETAINED` appends, the record write, and the claim and result writes of the operation. The verify record says the operation writes are covered. It does not name `updateJson`, because its check needs `name(` and the definition is `updateJson<T>(`.
- DoD: exit 0, 138 tests, 136 pass, 0 fail, 2 skipped.
- `npm run check` at 4c2bdda3: exit 0, 3754 tests, 3726 pass, 0 fail, 28 skipped.

Attempt 4, the repair of R3 decision 3 (F9, F10), at 716ac1ab:
- F9: a close that finds an `UNKNOWN` attempt of the marker resumes it.
  - It claims the attempt (`UNKNOWN` to `running` through `updateJson`; any other state is refused) and only looks up.
  - A marked issue is checked with lease and goal, then recorded, and the attempt becomes `succeeded`.
  - With no marked issue, or a failed lookup, the attempt goes back to `UNKNOWN` and the step refuses with the reconcile command. Nothing is submitted.
  - A `running` attempt still refuses before any gh call.
  - Acceptance 2's lost-response retry is direct again: the retry records the visible issue and files nothing. In the `refused` case (HTTP 502, no issue on GitHub) the outcome stays ambiguous. The retry looks up, submits nothing and keeps `UNKNOWN`, and only a reconcile to `failed` (a person finding no marked issue) lets the next close file once. That reconcile is the requirement's path for an invisible outcome, not a bypass.
- F10: GhProbe gains `ensureLabel` (the label call alone) and `submitIssue` (the issue call alone, body on stdin, number from the URL, same error rules). `createIssue` keeps its contract by calling the two. Each has an added test in gh.test.ts; no existing gh.test.ts line changed this round.
- Order of calls and checks for a new attempt, with nothing external between steps 6 and 7:
  1. list the marker's attempts; refuse on `running`, `intended` or `issued`; resume on `UNKNOWN`
  2. journal `OPERATION_INTENT`
  3. claim `op-followup-<hash>-<n>` as `running` (record lock)
  4. `gh api` issues lookup, every page
  5. found: go to step 8; not found: `gh label create`
  6. check the card lease fence, the persisted goal (not terminal, same generation), and that the operation is still `running`
  7. `gh issue create`
  8. check lease fence and goal again
  9. operation `succeeded`
  10. back in `markClosure`: `assertLiveGoal`, `EVIDENCE_RETAINED`, card-run save (compare-and-set)
- Order for a resume:
  1. claim `UNKNOWN` to `running`
  2. lookup
  3. found: check lease and goal, then `succeeded`; not found: back to `UNKNOWN` and refuse
- Status each failure leaves:
  - lookup: `failed` (resume: back to `UNKNOWN`)
  - label call: `failed`
  - step-6 check: `failed`, or untouched when the claim is no longer this command's
  - submit: `UNKNOWN`
  - any later check: `succeeded` with the number
- Sweep of tests that reconcile by hand or step around a requirement:
  - acceptance 2 `refused`: the ambiguous path, as above
  - F10 claim test: someone else reconciling mid-call is the scenario under test
  - F9 resume test: one reconcile back to `UNKNOWN` to set up the next case
  - F6 race case: a hand-written record stands in for the other command
  - the stale-list racer: an injected ledger view stands in for an interleaving
  - none skips a step the code takes
- Mutants, 14 killed:
  - Q1: UNKNOWN refused at once
  - Q2: resume falls through to a submit
  - Q3: resume not back to UNKNOWN
  - Q4: resume claim unchecked
  - Q5: running not refused
  - Q6: no recheck after the label call
  - Q7: no claim check before the submit
  - Q8: someone else's status overwritten
  - Q9: label call skipped
  - Q10: `createIssue` in the flow (a second label call)
  - Q11: `submitIssue` makes a label call
  - Q12: `ensureLabel` ignores failure
  - Q13: resume records without a recheck
  - Q14: resume lookup error recorded as failed

  Q4, Q10, Q13 and Q14 first survived and were killed by added tests: a resume claim racer, the call-order assertion, lease expiry during the resumed lookup, and a failed resumed lookup.
- Fault points: the operation-write case now runs for a new attempt and for the resume of an `UNKNOWN` attempt (claim and result each fail in turn); the retry records the one issue. Not covered: a failed write of the return to `UNKNOWN` leaves the attempt `running`, which is the crash path and needs `aidlc ops reconcile`.
- No real gh request was sent. One mistyped shell edit once ran the local `gh label create` with stray arguments; gh rejected them at flag parsing ("unknown flag: --force\"), printed usage and made no API request. The edit was reverted.
- DoD: exit 0, 144 tests, 142 pass, 0 fail, 2 skipped.
- `npm run check`: exit 0, 3760 tests, 3732 pass, 0 fail, 28 skipped.
