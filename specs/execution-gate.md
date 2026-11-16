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
- R5. The `github` ship path shall offer a publish step that commits nothing, pushes the candidate commit to the card branch only after a clean secret scan of its range, opens a draft pull request against the base when none is open, and returns the pull-request number and the scan receipt.
- R6. IF the push or the pull-request call of the publish step fails or times out, or no scan command is configured, or the scan is not clean, THEN the publish step shall return the failure without a ship sentinel that stops the card.
- R7. WHEN the card runner requests an R3 decision on a candidate on the `github` ship path in remote mode, the card runner shall run the publish step first, after every check that precedes the push in a ship today.
- R8. IF the publish step fails or is refused, THEN the card runner shall record that on the card run and request the R3 decision as it does today.
- R9. WHEN the `github` ship path merges a pull request that is a draft, the ship path shall mark it ready for review after the CI gate passes and before the merge call.
- R10. WHERE `github.secretScan` names a command, the `github` ship path shall run it on the range from the base to the candidate before a push and give a receipt bound to that base and candidate only for exit 0.
- R11. IF the scan exits with the configured finding code, or cannot run to an exit code, THEN the `github` ship path shall push nothing.
- R12. The outcome bench shall hold a view that counts, per week of merge, the merged cards, the merged bugfix cards, the reverts, and the bugfix cards and reverts that mention a merged card, with its rows in a committed file.

## Design
`recordAttempt` (`src/loop/card-runner.ts`) already runs `loopDod` after every refusal and
before the one save. The gate turns the input outcome into `fail` when the record says the DoD
ran and did not meet `dod_exit` or timed out, before the episode and the candidate are written,
so the existing failed-attempt path (counted attempt, same-cause stop, no receipt) handles it.
All 25 recorded loop runs met `dod_exit` [SOURCE: state directory, 2026-11-16], so the gate is
expected to change no outcome of a truthful worker.

The scan is a method of `GitHubShipPath`, `scanCandidate`, configured by the new optional key
`github.secretScan { command, timeoutMs, findingExitCode }`. The command is an argv array with
the placeholders `{base}` and `{head}`. Exit 0 gives a receipt `{ base, head }`; the finding
code (default 1) is a finding; a timeout, a spawn failure, no exit code or any other code is
"scanner unavailable" and gives no receipt. The finding code is a key of its own because a
program that cannot be started exits -4058 under the tree kill on Windows [SOURCE: drafter
measurement of 2026-11-17], which must not read as a secret, and because gitleaks exits 1 for
a leak and lets `--exit-code` change that [SOURCE: gitleaks README, read 2026-11-17]. A
remote-mode ship runs the scan after the base sync and before the push: a finding ends the
ship with the scaffold's own `check-secrets:` line, which classifies as `secrets-blocked` and
stops the card for risk, and an unavailable scanner ends it with `[SHIP-PUSH-FAIL]`, which
stops the card for a tool failure. With no command the ship runs as on main.

`ShipPath` gains an optional `publish(req)`; only `GitHubShipPath` implements it. It checks
for a scan command before it runs anything, scans, and pushes the scanned commit by name
(`<candidateSha>:refs/heads/<cardId>`) with a draft pull request. The runner calls it in
`formalReview`, after the scope check and before the pool request, and stores the result with
the scan receipt on the card run. `ship` is otherwise unchanged except for `gh pr ready`
before the merge when the pull request is a draft: it finds the open pull request through
`resolvePr`, pushes (a no-op when the head is published) and reads the check runs of the
head, which CI has already started. R3 takes 4.0 minutes per card at p50 and 12.3 at p90
[SOURCE: `aidlc review stats`, 323 cards, 2026-11-17], which is the time the earlier CI start
saves; the CI duration itself is the subject of `specs/loop-throughput.md`.

The ingest holds no bugfix marker, so the escaped-defect card adds the columns `diagnosis` and
`mentions` to the cards table. A bugfix card counts as mentioning a merged card when its
diagnosis block names a card merged earlier: the whole card text names one in 146 of 165
bugfix cards and the diagnosis block in 58 [SOURCE: drafter measurement of 2026-11-17 over
the registry], so the whole text would not discriminate. A revert counts when its reverted
commit is a card's merge commit. The view goes in `views/30-github.sql`, since it reads the
reverts, and its rows go to `bench/outcome/escaped.json`: `summary.json` is pinned by the
baseline tests.

## Interfaces and contracts
- `Attempt.loopDod` keeps its shape. A failed attempt may now carry one.
- `github.secretScan: { command: string[]; timeoutMs: number; findingExitCode: number }` (new, optional). Frozen by card T1-SHIP-SCAN.
- `GitHubShipPath.scanCandidate(cardId, base, head)` returns `none`, `clean` with a receipt, `finding` or `unavailable`. Frozen by card T1-SHIP-SCAN before T1-SHIP-PUBLISH.
- `ShipPath.publish?(req: ShipRequest)` (new, optional) returns `ok`, the pull-request number, the scan receipt and a detail. Frozen by card T1-SHIP-PUBLISH before T1-SHIP-PUBLISH-WIRE.
- `CardRun` gains an optional record of the last publish (time, head, pull-request number or failure text, scan receipt).
- The pull-request listing of `src/probes/gh.ts` gains `isDraft`.
- A failed `gh pr ready` ends the ship with the existing `[SHIP-MERGE-FAIL]`.
- No directive kind, sentinel class or review record changes: the scan reuses `check-secrets:` and `[SHIP-PUSH-FAIL]`.

## Data model and migration impact
none. A card run written before the change parses unchanged: the new fields are optional and a
failed attempt with `loopDod` uses the existing optional field. A configuration without
`github.secretScan` behaves as today.

## Flagged concerns (route to policy owners)
- (none)

## Non-goals
- Running the DoD in a clean checkout, or running more tests than `dod_command` names.
- A selection of test files by the paths a candidate changed, or a report on one.
- Setting `github.secretScan` in this repository's `aidlc.config.json`, or installing a scanner.
- Stopping a card before R3 when the scan of the publish step reports a finding; the ship stops on it.
- Cancelling an R3 review when CI goes red, or reading CI before the R3 verdict.
- Any change to `REVIEW.md`, the R3 prompt or the review allowances.
- The `scaffold` and `dry-run` ship paths.

## Acceptance
- 1. A scenario records a success whose scripted DoD exits 1 on a card with `dod_exit: 0`: the stored attempt is `fail` with the cause of R1, the run is in BUILD with no receipt and no new candidate. [R1] [R3]
- 2. The same with a DoD that times out, and with one that ends without an exit code. [R2] [R3]
- 3. A success whose DoD exits with `dod_exit`, and one whose DoD did not run, are stored as today. [R4]
- 4. `publish` with a scripted runner and a clean scan pushes the scanned commit and opens a draft pull request, returns an open pull request's number without creating one, and returns a failure without throwing for a failed push or create, for no scan command and for a scan that is not clean. [R5] [R6]
- 5. A scenario on the `github` ship path shows the publish calls before the formal review request, and a failed or refused publish followed by the same request. [R7] [R8]
- 6. A ship of a draft pull request calls `gh pr ready` after `[CI-GATE-PASS]` and before the merge. [R9]
- 7. With a scripted scanner, `scanCandidate` returns a receipt for exit 0, a finding for the finding code and "unavailable" for a timeout, a spawn failure and any other code, and a ship pushes nothing for the last two. [R10] [R11]
- 8. With no scan command a ship runs the commands and prints the lines it does on main. [R10]
- 9. `bench/outcome/escaped.json` holds the rows of the view with the count labelled "mentions a merged card", and a test reads them. [R12]
