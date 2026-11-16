---
slug: execution-gate
title: A card is ready for review when the loop's own run of its DoD is green, and CI runs while R3 reviews
spec: specs/execution-gate.md
size: T1
status: draft
created: 2026-11-16T03:00:00Z
---

# Plan: a card is ready for review when the loop's own DoD run is green, and CI runs while R3 reviews (from specs/execution-gate.md)

## 1. Goal and boundaries
The loop's own DoD run decides whether a success stands, the pull request is open as a draft
while R3 reviews, and two reports say whether a test selection is worth wiring in and how many
defects reach main. Cut: a gate on the test selection, cancelling R3 on a red CI, a clean
checkout for the DoD, any review-policy change. Success criteria, read on the outcome summary
after 30 cards have merged under the change: no card is replaced after a red CI that followed
an R3 pass on a test its DoD could not run, and the card lead time p50 is below the baseline
0.85 hours. With 30 cards neither number is a significance test; they are reported with their
counts.

## 2. Minimal acceptable loop
T1-DOD-GATE-FIXTURES with T1-DOD-GATE alone closes issue 124. T1-SHIP-PUBLISH with
T1-SHIP-PUBLISH-WIRE alone moves the CI start to the R3 request.

## 3. Tech stack
none this version

## 4. Directory structure
- `src/core/affected.ts` (new)
- `bench/outcome/affected.ts`, `bench/outcome/affected-cases.json` (new)
- `bench/outcome/escaped.json` (new)
- `docs/reliability/affected.md` (new)

## 4.5 Module design
- `src/loop/card-runner.ts` `recordAttempt`: a refuted success takes the failed-attempt path; `formalReview` runs the publish step after the scope check (`:2068-2069`) and before the pool request (`:2074`).
- `src/delivery/ship.ts`: `ShipPath.publish?`.
- `src/delivery/github-ship.ts`: `publish`; `gh pr ready` before the merge of a draft.
- `src/probes/gh.ts`: the two `pr list` calls read `isDraft`.
- `src/core/affected.ts`: `affectedTests`, pure.
- `bench/outcome/`: the selection report; the escaped-defect view in `views/30-github.sql`, a `diagnosis` column in the ingest, rows in `escaped.json`.

## 5. Data model and state machine
The card state precedence does not change. A refuted success takes the failed-attempt path,
so BUILD follows from the missing DoD receipt as it does for any failed attempt. `CardRun`
gains an optional publish record.

## 6. Contracts and core interfaces
`ShipPath.publish?(req: ShipRequest)` is frozen by T1-SHIP-PUBLISH. Sentinels and their
classes are unchanged; `publish` prints none, and a failed `gh pr ready` ends with the existing
`[SHIP-MERGE-FAIL]`.

## Files that change
- src/loop/card-runner.ts
- src/cli/main.ts
- src/core/types.ts
- src/delivery/ship.ts
- src/delivery/github-ship.ts
- src/probes/gh.ts
- src/core/affected.ts (new)
- bench/outcome/affected.ts (new)
- bench/outcome/affected-cases.json (new)
- bench/outcome/ingest.ts
- bench/outcome/views/30-github.sql
- bench/outcome/escaped.json (new)
- docs/reliability/affected.md (new)
- docs/OPERATIONS.md
- docs/ARCHITECTURE.md
- CHANGELOG.md

## Order of work
1. T1-OUTCOME-ESCAPED: the escaped-defect view, so the numbers before the gate exist.
2. T1-AFFECTED-SELECT: `affectedTests`. Starts beside 1 and 3 (no shared path).
3. T1-DOD-GATE-FIXTURES: three test fixtures answer the DoD with exit 0, so the gate turns no existing scenario red.
4. Coordinator, no card: list the red CI runs of pull requests with
   `gh run list --workflow ci --status failure`, read each failed test file from
   `gh run view <id> --log-failed`, and write the list to `_local/affected/red-runs.json`.
5. T1-AFFECTED-REPORT: the case file and the report against the keep rule. After 2 and 4.
6. T1-SHIP-PUBLISH: `publish`, `isDraft`, `gh pr ready`. Runs alone on the ship files.
7. T1-DOD-GATE: the refuted success. After 3 and after card T1-REVIEW-FOLLOWUP-ISSUE of
   `plans/review-recall.md` has merged (both edit `card-runner.ts`).
8. T1-SHIP-PUBLISH-WIRE: the runner calls `publish` in `formalReview`. After 6 and 7.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-OUTCOME-ESCAPED | MUST | merged cards, merged bugfix cards and reverts per week of merge | - | W1 | - |
| T1-AFFECTED-SELECT | MUST | `affectedTests`, pure, with its tests | - | W1 | - |
| T1-DOD-GATE-FIXTURES | MUST | three fixtures whose scripted DoD exits 0 | - | W1 | - |
| T1-AFFECTED-REPORT | MUST | the selection's hit rate and size on the recorded red runs | T1-AFFECTED-SELECT | - | - |
| T1-SHIP-PUBLISH | MUST | `GitHubShipPath.publish` and `gh pr ready` before the merge of a draft | - | - | yes |
| T1-DOD-GATE | MUST | a success the loop-run DoD refutes is a counted failed attempt | T1-DOD-GATE-FIXTURES | - | - |
| T1-SHIP-PUBLISH-WIRE | MUST | the draft pull request opens when R3 is requested | T1-SHIP-PUBLISH, T1-DOD-GATE | - | - |

Budgets: 170, 110, 60, 200, 200, 190 and 190 changed lines, 1120 in total. The W1 cards share
no path.

## Risks
- The gate reads a DoD the loop ran in the card worktree; a DoD that passes only for the worker's shell (an environment variable, a path) now fails the attempt. 25 of 25 recorded runs matched, so the 95% upper bound of the mismatch rate is about 11%.
- A timed-out DoD, and one that ended without an exit code, is a counted failure: two in a row with the same cause and no progress stop the card. The recorded maximum is 234 s against a 540 s limit.
- A draft pull request is visible before review and runs CI for a candidate R3 may block; each repair push runs CI again.
- The `github` ship path has no local secret scan: gitleaks is a CI check (`src/loop/card-runner.ts:3120`). Today the push follows the R3 pass and precedes that check; with the publish step the push precedes both.
- The publish step runs after the scope check, the clean-candidate check and the pinned-HEAD check of `formalReview`. It runs no base sync, so a candidate that conflicts with the base gets its CI after the ship's base sync, as today.
- The red-run list is small (about 10 to 15 runs), so the selection report's hit rate has a wide interval; the report prints the count.
- Not verified before the cards run: what `gh pr ready` exits with on a pull request that is already ready; DuckDB's week function in UTC.
- Owner to confirm at approval: the push before R3 with no local secret scan (or a scan card first); a worker under `AIDLC_RUN_NO_SHIP=1` does not publish; a DoD with no exit code is a counted failure; `--progress` on a refuted success is kept.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: `aidlc card status <card>` of a card of this goal shows a `loopDod` line that met `dod_exit` on its success.
- Arc: the pull request of the first card shipped after T1-SHIP-PUBLISH-WIRE merged was created before that card's first R3 decision (`gh pr view --json createdAt` against the decision time in `aidlc review stats`).
- Arc: the tests of T1-AFFECTED-REPORT and T1-OUTCOME-ESCAPED pass on main.

## 10. After merge
none this version (development-only target)
