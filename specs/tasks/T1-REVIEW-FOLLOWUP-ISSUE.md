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
  - R7. .claude/skills/aidlc-loop/card-loop.md and its template copy (CLOSE section), docs/OPERATIONS.md (closure), docs/ARCHITECTURE.md (closure record) and docs/REQUIREMENTS-TRACEABILITY.md (the R25-R27 row, which says idempotent issue creation is not implemented) shall state R1 to R6; the two card-loop.md files stay identical and within the byte cap tests/surface/templates.test.ts asserts.
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
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test
  - filing an issue before the merge is verified, or from any command other than card close
  - a GitHub search query to find the marker (the search index lags; R4 lists by label)
  - a shell string for a gh call
  - editing .aidlc state by hand
non_goals: [making P2 findings non-blocking, a follow-up card file, filing issues for runs closed before this card, a change to CHANGELOG.md]
hygiene: "Line numbers are from main at 0f28b51e and move with T1-REVIEW-SEVERITY and T1-FINDING-IDENTITY; read them again at PREPARE. This card adds a store write to a command the verify-card-run-writes coverage record names, so run that skill before SHIP and at CLOSE, and extend its record."
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
