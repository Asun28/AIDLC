---
id: T0-EXIT-ZERO-NOT-MERGED
title: A ship that exits 0 is merged only on its adapter's merge contract; without it the card machine reconciles the merge from gh, then the merge token, and a definite non-merge stops the card (issue 76 item 3, plan finding F5)
status: todo
branch: T0-EXIT-ZERO-NOT-MERGED
worktree: D:\wt\AIDLC\T0-EXIT-ZERO-NOT-MERGED
allow_paths:
  - src/delivery/ship.ts
  - src/delivery/github-ship.ts
  - src/loop/card-runner.ts
  - tests/infra/ship.test.ts
  - tests/scenarios/merge-unconfirmed.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-EXIT-ZERO-NOT-MERGED.md
dod_command: npm run typecheck && node --test tests/infra/ship.test.ts tests/scenarios/merge-unconfirmed.test.ts
dod_exit: 0
requirements:
  - R1. `classifyShipOutput` (`src/delivery/ship.ts`) shall classify an exit-0 ship (not timed out) as `merged` only when the output carries the `[SAGA-DONE]` sentinel and no `[SAGA-FAIL]`. An exit-0 ship that carries a failure sentinel of the sentinel map classifies as that failure; one that carries neither classifies as the new class `merge-unconfirmed` ("exit 0 without the adapter's merge contract"). The alternatives that made an exit 0 `merged` without the contract (`MERGED` or 合并 anywhere in the text, `merged_pr=` in the text, no sentinel at all, no `[SAGA-FAIL]`) are removed. No ship adapter upgrades `merge-unconfirmed` to `merged`: the card machine is the one decider (R2).
  - R2. The card machine (`applyShipResult`, `src/loop/card-runner.ts`) shall reconcile a `merge-unconfirmed` ship, never count it as merged from text, never retry it: the operation is issued and its result decided from the PR number the ship reported or the merge token names. When gh answers the PR view, gh decides: MERGED with `headRefOid` equal to the candidate sha is a verified merge (CLOSE, operation `succeeded`); OPEN, CLOSED, or MERGED at another head is a definite non-merge (operation `failed`, the card stops as `tool`, and the stop names the PR, its state and head, and the next action: merge by hand, then `aidlc goal resume`). Only when gh does not answer (no repository, no PR number, gh fails) does the merge token decide: a tip equal to the candidate sha is a verified merge; no token, or a token whose tip is another sha (a stale token proves nothing about this candidate), leaves the operation `UNKNOWN` and the card WAITs on `merge-verify`, bounded by the admission deadline and its reconciliation grace. The dry-run shortcut that verifies a `merged` ship on the dry-run path does not apply to `merge-unconfirmed`, and a `merge-unconfirmed` ship records the PR as MERGED only once verified. A `merge-unconfirmed` ship whose candidate was replaced or whose run was stopped while it was in flight leaves its operation `UNKNOWN`, as a `merged` one does, never `failed`.
  - R3. `DryRunShipPath` shall print `[SAGA-DONE]` on a scripted `merged` outcome, so classifying its receipt again gives `merged`, and a scripted `merge-unconfirmed` outcome exits 0. A `merged` ship keeps its verification unchanged.
  - R4. `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`, the `src/delivery/github-ship.ts` header comment and `CHANGELOG.md` shall state the contract and the reconcile path: `merged` comes from `[SAGA-DONE]`; a scaffold success prints no sentinel and is reconciled from its merge token or the PR view as `merge-unconfirmed`.
acceptance:
  - 1. tests/infra/ship.test.ts - the defect's own assertion changes: exit 0 with `all good` (tests/infra/ship.test.ts:58, which asserted `merged`) is `merge-unconfirmed`; exit 0 with `[SAGA-DONE]` is still `merged`; each removed alternative is `merge-unconfirmed` on its own (`PR #7 MERGED`, a scaffold success line with 合并, `merged_pr=#7`, no sentinel, a non-failure sentinel such as `[SHIP-TIME]` without `[SAGA-FAIL]`); exit 0 with a failure sentinel and no `[SAGA-FAIL]` (`[SHIP-MERGE-FAIL]`) is `merge-failed`; exit 0 with `[SAGA-DONE]` and `[SAGA-FAIL]` classifies the failure sentinel. [R1] [dod arm 1]
  - 2. tests/infra/ship.test.ts - `ScaffoldShipPath` over a scripted scaffold success (exit 0, the 合并 line, a merge token on disk) returns `merge-unconfirmed`: the adapter does not upgrade it. `DryRunShipPath` prints `[SAGA-DONE]` on `merged` and `classifyShipOutput` of its receipt is `merged`; its `merge-unconfirmed` receipt exits 0 and classifies as `merge-unconfirmed`. [R1] [R3] [dod arm 1]
  - 3. tests/scenarios/merge-unconfirmed.test.ts - a `merge-unconfirmed` ship through the card runner with a scripted gh: PR MERGED at the candidate is CLOSE with the operation `succeeded`; OPEN, CLOSED and MERGED at another head each stop the card as `tool` with the operation `failed`, the PR, its state and head in the detail and the resume in the next action; gh answering wins over a token (a token at the candidate with the PR OPEN stops; a stale token with the PR MERGED at the candidate closes). [R2] [dod arm 1]
  - 4. tests/scenarios/merge-unconfirmed.test.ts - when gh does not answer (gh fails, or no repository is configured): a token tip at the candidate is CLOSE; a stale token tip, and no token at all, leave the operation `UNKNOWN` and the card in WAIT on `merge-verify`, with no PR recorded as MERGED; the dry-run path does not verify a `merge-unconfirmed` ship; a `merge-unconfirmed` ship whose candidate is replaced during the ship leaves its operation `UNKNOWN`. [R2] [dod arm 1]
  - 5. docs/OPERATIONS.md, docs/ARCHITECTURE.md and CHANGELOG.md Unreleased carry the rule under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R4] [dod arm 1]
depends_on: []
budget: 420
tdd: true
sweep: "Every place that decides a merge or an outcome from ship text, on main 390d43e: ship.ts:206 (this card); the PR number read from the ship text (ship.ts:204) feeds only gh pr view, whose state and head decide; github-ship.ts:312 reads the PR number from the URL gh pr create prints, and the merge is decided by the gh pr view JSON (358); card-runner.ts:2518 reads [SHIP-BASE-SYNC-MERGED], a sentinel the adapter declares; github-ship.ts:291 and 358, card-runner.ts:2350 and verifier.ts:194 read gh JSON. CI log classes (ci-policy.ts) are issue 76 item 2, not this card. Adapter contracts: github-ship prints [SAGA-DONE] on every exit-0 path (292, 303, 360); the claude-devops-scaffold task.ps1 prints no sentinel on success (its [SAGA-DONE] is only in the failure report next to [SAGA-FAIL], task.ps1:1290) and mints .git/scaffold-merged/<card> only when gh reports MERGED (1254-1261) or after a local merge (1074); DryRunShipPath never classifies and printed only the outcome word. No zod schema in src/core/types.ts enumerates ship outcomes."
forbid: [weakening or skipping a test to go green (the one changed expectation is tests/infra/ship.test.ts:58, the defect's own assertion, stated in acceptance 1), a card-runner.ts change outside lines 2324 and 2335-2362 (measured on main 390d43e; a hunk there may add lines at its position), src code (ship.ts classifyShipOutput) returning merged for an exit-0 ship without the [SAGA-DONE] sentinel, src code (ship.ts ScaffoldShipPath, github-ship.ts) upgrading merge-unconfirmed to merged, src code (card-runner.ts applyShipResult) deciding a merge-unconfirmed ship from the token when gh answers the PR view, src code (card-runner.ts applyShipResult) retrying a merge-unconfirmed ship, a change to how a merged ship is verified, a src/core/types.ts change]
non_goals: [the failure sentinels and their classes, CI log classes (issue 76 item 2), the scaffold's own output, a ship allowance or re-ship counter, the WAIT on an UNKNOWN operation and its reconciliation grace (unchanged)]
diagnosis:
  root_cause: "classifyShipOutput (ship.ts:206) returns merged on exit 0 when any of [SAGA-DONE], merged_pr=, MERGED or 合并 appears in the text, when the text has no sentinel at all, or when it has no [SAGA-FAIL]: any tool that exits 0 and prints nothing counts as a merge. The card machine then verifies a merged ship against the merge token or the PR view, but the classification itself is text (issue 76 item 3, plan finding F5)."
  same_class: "The sweep above: every other place that decides a merge reads gh JSON, git, or a sentinel the adapter declares."
hygiene: "Issue 76 item 3, design approved by aidlc-37 (one decider in the card machine; a definite non-merge needs positive evidence from the PR view; gh answering wins over the token). CLAUDE.md:65 ('Every adapter prints the same scaffold-style sentinels so classifyShipOutput maps outcomes uniformly') is stale for a scaffold success, which prints no sentinel; the user owns that file and its correction is not in this card. The card-runner.ts lines (2324, 2335-2362 on main 390d43e) are adjacent to aidlc-a6's T1-BOUND-TELEMETRY hunk at 2320: this card builds to a green DoD and holds R2 until that card ships, then merges main and re-measures. Run the mutation sweep over every new branch before the first review; the doc test reads the exact sentences (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS); every forbid clause names the code it guards (docs/LESSONS.md 2026-09-27 T0-REVIEWER-UTF8); every condition the new branches answer yes on is listed in R2 (docs/LESSONS.md 2026-09-27 T0-DISPUTE-RUNNING-ATTEMPT)."
doc_sync: docs/OPERATIONS.md (ship outcomes, STOP reasons), docs/ARCHITECTURE.md (outcome to state map), CHANGELOG.md
---

# T0-EXIT-ZERO-NOT-MERGED

## Deliverable
A ship counts as merged only on its adapter's declared merge contract (`[SAGA-DONE]`). Any other exit 0 is `merge-unconfirmed`: the card machine asks gh for the PR, then the merge token, closes a verified merge, stops the card on a definite non-merge, and waits on an unknown one within the deadline.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/ship.test.ts tests/scenarios/merge-unconfirmed.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
