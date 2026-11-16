---
slug: execution-gate
title: A card is ready for review when the loop's own run of its DoD is green, and CI runs while R3 reviews
intent: intent/execution-gate.md
status: draft
created: 2026-11-16T02:45:00Z
skills_applied: []
---

# Spec: a card is ready for review when the loop's own DoD run is green, and CI runs while R3 reviews
From intent: intent/execution-gate.md. Status: draft. Skills applied: (none).

## Requirements (EARS)
- R1. WHEN a successful attempt is recorded and the loop-run DoD ran and exited with a code other than the card's `dod_exit`, the card runner shall store the attempt as a failed attempt whose cause names the exit code and the expected one.
- R2. WHEN a successful attempt is recorded and the loop-run DoD timed out or ended without an exit code, the card runner shall store the attempt as a failed attempt whose cause names that result.
- R3. WHEN an attempt is stored as failed under R1 or R2, the card runner shall keep the `loopDod` record on it, bind no new candidate, store no DoD receipt and leave the card in BUILD.
- R4. WHEN the loop-run DoD did not run (`ran: false`), or ran and exited with `dod_exit`, the card runner shall store the success as it does today.
- R5. The `github` ship path shall offer a publish step that commits nothing, pushes the card branch and opens a draft pull request against the base when none is open, and returns the pull-request number.
- R6. IF the push or the pull-request call of the publish step fails or times out, THEN the publish step shall return the failure without a ship sentinel that stops the card.
- R7. WHEN the card runner requests an R3 decision on a candidate on the `github` ship path in remote mode, the card runner shall run the publish step first, after every check that precedes the push in a ship today.
- R8. IF the publish step fails, THEN the card runner shall record the failure on the card run and request the R3 decision as it does today.
- R9. WHEN the `github` ship path merges a pull request that is a draft, the ship path shall mark it ready for review after the CI gate passes and before the merge call.
- R10. The repository shall hold a pure function that, given the paths a candidate changed and the text of each test file, returns the test files that name a changed path.
- R11. The repository shall hold a report of that function over the recorded red CI runs: for each, whether the failed test file was selected and how many files were selected.
- R12. The outcome bench shall hold a view that counts, per week of merge, the merged cards, the merged bugfix cards and the reverts, with its rows in a committed file.

## Design
`recordAttempt` (`src/loop/card-runner.ts`) already runs `loopDod` after every refusal and
before the one save. The gate turns the input outcome into `fail` when the record says the DoD
ran and did not meet `dod_exit` or timed out, before the episode and the candidate are written,
so the existing failed-attempt path (counted attempt, same-cause stop, no receipt) handles it.
All 25 recorded loop runs met `dod_exit` [SOURCE: state directory, 2026-11-16], so the gate is
expected to change no outcome of a truthful worker.

`ShipPath` gains an optional `publish(req)`; only `GitHubShipPath` implements it. It reuses the
push and pull-request calls of `ship` with `--draft`. The runner calls it in `formalReview`,
after the scope check and before the pool request. The `github` ship path has no local secret
scan (gitleaks is a CI check), so no local check that precedes the push in a ship today is
skipped except the base sync. `ship` is unchanged except for `gh pr ready` before the merge when
the pull request is a draft: it finds the open pull request through `resolvePr`, pushes (a
no-op when the head is published) and reads the check runs of the head, which CI has already
started. CI takes 14 to 22 minutes [SOURCE: `gh run list --workflow ci`, 21 pull-request runs,
2026-11-16].

`affectedTests` is a pure function in `src/core/`. Its report runs over a committed list of red
runs (candidate commit, changed paths, failed test file) that the coordinator assembles from
the Actions logs. The loop does not call it in this goal.

The ingest holds no bugfix marker, so the escaped-defect card adds a `diagnosis` column to the
cards table. The view goes in `views/30-github.sql`, since it reads the reverts, and its rows
go to `bench/outcome/escaped.json`: `summary.json` is pinned by the baseline tests.

## Interfaces and contracts
- `Attempt.loopDod` keeps its shape. A failed attempt may now carry one.
- `ShipPath.publish?(req: ShipRequest): { ok: boolean; prNumber?: number; detail: string }` (new, optional). Frozen by card T1-SHIP-PUBLISH before T1-SHIP-PUBLISH-WIRE.
- `CardRun` gains an optional record of the last publish (time, head, pull-request number or failure text).
- The pull-request listing of `src/probes/gh.ts` gains `isDraft`.
- A failed `gh pr ready` ends the ship with the existing `[SHIP-MERGE-FAIL]`.
- No directive kind, sentinel class or review record changes.

## Data model and migration impact
none. A card run written before the change parses unchanged: the new field is optional and a
failed attempt with `loopDod` uses the existing optional field.

## Flagged concerns (route to policy owners)
- (none)

## Non-goals
- Running the DoD in a clean checkout, or running more tests than `dod_command` names.
- Calling the test selection from the loop, or a gate on it.
- Cancelling an R3 review when CI goes red, or reading CI before the R3 verdict.
- Any change to `REVIEW.md`, the R3 prompt or the review allowances.
- The `scaffold` and `dry-run` ship paths.

## Acceptance
- 1. A scenario records a success whose scripted DoD exits 1 on a card with `dod_exit: 0`: the stored attempt is `fail` with the cause of R1, the run is in BUILD with no receipt and no new candidate. [R1] [R3]
- 2. The same with a DoD that times out, and with one that ends without an exit code. [R2] [R3]
- 3. A success whose DoD exits with `dod_exit`, and one whose DoD did not run, are stored as today. [R4]
- 4. `publish` with a scripted runner pushes and opens a draft pull request, returns an open pull request's number without creating one, and returns a failure without throwing for a failed push or create. [R5] [R6]
- 5. A scenario on the `github` ship path shows the publish calls before the formal review request, and a failed publish followed by the same request. [R7] [R8]
- 6. A ship of a draft pull request calls `gh pr ready` after `[CI-GATE-PASS]` and before the merge. [R9]
- 7. `affectedTests` returns the files that name a changed path and none other, on a fixture. [R10]
- 8. `docs/reliability/affected.md` gives the two numbers of the keep rule, recomputed by a test from the committed case file. [R11]
- 9. `bench/outcome/escaped.json` holds the rows of the view, and a test reads them. [R12]
