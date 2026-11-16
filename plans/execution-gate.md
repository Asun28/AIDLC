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
The loop's own DoD run decides whether a success stands, the `github` ship path can scan a
candidate for secrets before a push, the pull request is open as a draft while R3 reviews when
that scan passed, and one view counts the bugfix cards and reverts that reach main. Cut: a
selection of test files and its report (cut on 2026-11-17: the selection rule's own sweep
missed its keep rule), a gate on any selection, cancelling R3 on a red CI, a clean checkout
for the DoD, any review-policy change, setting the scan command in this repository. Success
criteria, read on the outcome summary after 30 cards have merged under the change: every
success that reached review carries a loop-run DoD that met `dod_exit`, and no push of a
candidate happened without a scan receipt or an R3 pass. The lead-time effect of the draft
pull request is read only in a repository that sets `github.secretScan`; this one does not
yet, so its lead time is moved by `plans/loop-throughput.md`, not by this plan.

## 2. Minimal acceptable loop
T1-DOD-GATE-FIXTURES with T1-DOD-GATE alone closes issue 124. T1-SHIP-SCAN alone gives a
scan before the push of a ship. T1-SHIP-SCAN, T1-SHIP-PUBLISH and T1-SHIP-PUBLISH-WIRE
together, with `github.secretScan` set, move the CI start to the R3 request.

## 3. Tech stack
none this version

## 4. Directory structure
- `bench/outcome/escaped.json` (new)
- `tests/infra/github-ship-scan.test.ts`, `tests/infra/github-ship-publish.test.ts`, `tests/scenarios/ship-publish-wire.test.ts` (new)

## 4.5 Module design
- `src/loop/card-runner.ts` `recordAttempt`: a refuted success takes the failed-attempt path. `shipPathFor` passes `github.secretScan` to the ship path. `formalReview` runs the publish step after the scope check and before the pool request, and stores its result.
- `src/config.ts`: the optional key `github.secretScan`.
- `src/delivery/github-ship.ts`: `scanCandidate`; the scan before the push of a remote-mode ship; `publish`; `gh pr ready` before the merge of a draft.
- `src/delivery/ship.ts`: `ShipPath.publish?`.
- `src/probes/gh.ts`: the two `pr list` calls read `isDraft`.
- `src/core/types.ts`: the publish record of `CardRun`, with the scan receipt.
- `bench/outcome/`: the columns `diagnosis` and `mentions` in the ingest, the view `summary_escaped` in `views/30-github.sql`, its rows in `escaped.json`.

## 5. Data model and state machine
The card state precedence does not change. A refuted success takes the failed-attempt path,
so BUILD follows from the missing DoD receipt as it does for any failed attempt. `CardRun`
gains an optional publish record that holds the scan receipt.

## 6. Contracts and core interfaces
`github.secretScan` and `GitHubShipPath.scanCandidate` are frozen by T1-SHIP-SCAN.
`ShipPath.publish?(req: ShipRequest)` is frozen by T1-SHIP-PUBLISH. Sentinels and their
classes are unchanged: a finding prints the scaffold's `check-secrets:` line (class
`secrets-blocked`), an unavailable scanner `[SHIP-PUSH-FAIL]`, `publish` prints none, and a
failed `gh pr ready` ends with the existing `[SHIP-MERGE-FAIL]`.

## Files that change
- src/loop/card-runner.ts
- src/cli/main.ts
- src/core/types.ts
- src/config.ts
- src/delivery/ship.ts
- src/delivery/github-ship.ts
- src/probes/gh.ts
- bench/outcome/ingest.ts
- bench/outcome/views/10-cards.sql
- bench/outcome/views/30-github.sql
- bench/outcome/README.md
- bench/outcome/escaped.json (new)
- tests/infra/github-ship-scan.test.ts (new)
- tests/infra/github-ship-publish.test.ts (new)
- tests/scenarios/ship-publish-wire.test.ts (new)
- docs/OPERATIONS.md
- docs/ARCHITECTURE.md
- changelog.d/T1-DOD-GATE.md (new)
- changelog.d/T1-SHIP-SCAN.md (new)
- changelog.d/T1-SHIP-PUBLISH.md (new)
- changelog.d/T1-SHIP-PUBLISH-WIRE.md (new)

## Order of work
1. T1-OUTCOME-ESCAPED: the view, so the numbers before the gate exist. It touches only
   `bench/outcome/` and its two tests, so it starts beside any card of this plan or another.
2. T1-DOD-GATE-FIXTURES: three test fixtures answer the DoD with exit 0, so the gate turns no
   existing scenario red.
3. T1-DOD-GATE: the refuted success. After 2, and after card T1-REVIEW-FOLLOWUP-ISSUE of
   `plans/review-recall.md` has merged (both edit `card-runner.ts`).
4. T1-SHIP-SCAN: the configuration key, `scanCandidate` and the scan before the push of a
   ship. After 3 (one line of `card-runner.ts`).
5. T1-SHIP-PUBLISH: `publish`, `isDraft`, `gh pr ready`. After 4 (both edit `github-ship.ts`).
6. T1-SHIP-PUBLISH-WIRE: the runner calls `publish` in `formalReview`. After 3 and 5.

Cards 3 to 6 start after T1-CHANGELOG-FRAGMENTS of `plans/loop-throughput.md` has merged:
each writes its changelog entry to its own file under `changelog.d/`.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-OUTCOME-ESCAPED | MUST | merged cards, merged bugfix cards, reverts and the count "mentions a merged card" per week of merge | - | W1 | - |
| T1-DOD-GATE-FIXTURES | MUST | three fixtures whose scripted DoD exits 0 | - | W1 | - |
| T1-DOD-GATE | MUST | a success the loop-run DoD refutes is a counted failed attempt | T1-DOD-GATE-FIXTURES, T1-CHANGELOG-FRAGMENTS | - | - |
| T1-SHIP-SCAN | MUST | `github.secretScan`, `scanCandidate`, and a ship that pushes nothing on a finding or an unavailable scanner | T1-CHANGELOG-FRAGMENTS | - | yes |
| T1-SHIP-PUBLISH | MUST | `GitHubShipPath.publish` behind a clean scan, and `gh pr ready` before the merge of a draft | T1-SHIP-SCAN, T1-CHANGELOG-FRAGMENTS | - | yes |
| T1-SHIP-PUBLISH-WIRE | MUST | the draft pull request opens when R3 is requested, and the result with the scan receipt is stored on the card run | T1-SHIP-PUBLISH, T1-DOD-GATE, T1-CHANGELOG-FRAGMENTS | - | - |

Budgets: 196, 60, 190, 180, 200 and 196 changed lines, 1022 in total. The W1 cards share no
path.

## Risks
- The gate reads a DoD the loop ran in the card worktree; a DoD that passes only for the worker's shell (an environment variable, a path) now fails the attempt. 25 of 25 recorded runs matched, so the 95% upper bound of the mismatch rate is about 11%.
- A timed-out DoD, and one that ended without an exit code, is a counted failure: two in a row with the same cause and no progress stop the card. The recorded maximum is 234 s against a 540 s limit.
- The early push is off in this repository. `aidlc.config.json` sets no `github.secretScan` in this plan, and gitleaks is not installed on the owner's machine (checked 2026-11-17), so `publish` runs no command here and the push stays after the R3 pass until a later change sets the key. The three ship cards then change no lead time in this repository.
- With the key set, a draft pull request is visible before review and runs CI for a candidate R3 may block; each repair push runs CI again. The older run is cancelled once T1-CI-SHARD has merged.
- The scan runs inside `formalReview` before the pool request, for up to its `timeoutMs` (default 120 s).
- A finding at the publish step does not stop the card: R3 still runs on that candidate, so its diff goes to the reviewer, and the ship then stops on the finding. Stopping before R3 is a follow-up, not part of T1-SHIP-PUBLISH-WIRE.
- `findingExitCode` defaults to 1, and gitleaks exits 1 for an error as well as for a leak, so a scanner error reads as a finding and stops the card for risk. A scanner that cannot be started ends the ship with `[SHIP-PUSH-FAIL]`, a tool stop that is final for the card and whose stop detail reads as an unclassified ship outcome; a misconfigured scanner therefore stops every card at ship.
- The publish step runs after the scope check, the clean-candidate check and the pinned-HEAD check of `formalReview`. It runs no base sync, so a candidate that conflicts with the base gets its CI after the ship's base sync, as today.
- The count "mentions a merged card" is a proxy: it reads the diagnosis block of a bugfix card and the reverted commit of a revert, and it decides nothing about safety.
- Not verified before the cards run: a real gitleaks argv on a commit range; the exit code of a spawn failure under the tree kill on Linux; how many lines the scan gate adds to T1-SHIP-PUBLISH (estimate 15); what `gh pr ready` exits with on a pull request that is already ready; DuckDB's week function in UTC.
- Decided at the approval of 2026-11-17: the early push only with a clean local scan; a worker under `AIDLC_RUN_NO_SHIP=1` does not publish; a DoD with no exit code is a counted failure; `--progress` on a refuted success is kept and never turns a failure into a success.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: `aidlc card status <card>` of a card of this goal shows a `loopDod` line that met `dod_exit` on its success.
- Arc: with no `github.secretScan`, the pull request of the first card shipped after T1-SHIP-PUBLISH-WIRE merged was created after that card's R3 pass, and the card run holds a publish record that says no scan is configured (`gh pr view --json createdAt` against the decision time in `aidlc review stats`).
- Arc: the tests of T1-SHIP-SCAN and T1-OUTCOME-ESCAPED pass on main.

## 10. After merge
none this version (development-only target)
