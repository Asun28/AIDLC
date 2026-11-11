---
id: T0-AUDIT-FIXES
title: "Fourteen defects found by the audit of 2026-11-11 are fixed, each with a test that fails before its fix: the verdict reader, the ship gate, the review-fix episode, the release packet, the secrets guard and nine smaller ones"
status: todo
branch: T0-AUDIT-FIXES
worktree: D:\wt\AIDLC\T0-AUDIT-FIXES
size_exception: "approved by the user (asun28) on 2026-11-11: the fourteen audit fixes go through one T0-bugfix card for R3 review; written at budget 500, about 130 source lines in 13 files with the rest tests and docs; raised to 950 by the coordinator on 2026-11-11 for the repair of R3 decision 1 (the reader rewrite and its tests); the fixes are independent, so a finding on one does not touch the others"
allow_paths:
  - src/review/pre-review.ts
  - src/delivery/github-ship.ts
  - src/loop/card-runner.ts
  - src/loop/release-runner.ts
  - src/cli/main.ts
  - src/hooks/index.ts
  - src/delivery/ops.ts
  - src/artifacts/card.ts
  - src/artifacts/plan.ts
  - src/delivery/worktree.ts
  - src/maintain/incident.ts
  - src/core/release-machine.ts
  - src/core/card-goal.ts
  - src/core/review-policy.ts
  - src/delivery/ship.ts
  - tests/surface/pre-review.test.ts
  - tests/infra/github-ship.test.ts
  - tests/scenarios/dispute-running-attempt.test.ts
  - tests/scenarios/release.test.ts
  - tests/surface/hooks.test.ts
  - tests/infra/ops.test.ts
  - tests/surface/card.test.ts
  - tests/surface/plan.test.ts
  - tests/infra/worktree.test.ts
  - tests/surface/incident.test.ts
  - tests/core/release-machine.test.ts
  - tests/core/card-goal.test.ts
  - tests/core/review-policy.test.ts
  - tests/infra/ship.test.ts
  - README.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-AUDIT-FIXES.md
dod_command: npm run typecheck && node --test tests/surface/pre-review.test.ts tests/infra/github-ship.test.ts tests/scenarios/dispute-running-attempt.test.ts tests/scenarios/release.test.ts tests/surface/hooks.test.ts tests/infra/ops.test.ts tests/surface/card.test.ts tests/surface/plan.test.ts tests/infra/worktree.test.ts tests/surface/incident.test.ts tests/core/release-machine.test.ts tests/core/card-goal.test.ts tests/scenarios/fault-points.test.ts tests/core/review-policy.test.ts tests/infra/ship.test.ts
dod_exit: 0
requirements:
  - R1. `readVerdict` shall read an opener that a character refuted and whose brackets close later in the output (from the refuting character on, with quoted text skipped and a backslash escaping the character after it, the closers outnumber the openers by the count of containers open at that character) as one document that closed without parsing, from the opener to that closer, so that nothing inside it is a document of its own (the nested `standards` object of a block whose `spec` axis carries an invalid escape, a raw line break or a bare word, an element of a broken array) and that such a document after the last parseable one makes the output malformed; an opener whose brackets never close is prose as on main, and the complete document after it decides whatever punctuation stands before or after it, except a document that stands directly behind a member name (a closing quote and a colon, whitespace allowed around them), which is the member of a broken document cut short and yields no verdict. The walk stays linear in the size of the output.
  - R2. WHEN `github.requireVerdict` is on and the verdict file has a `run_status` member whose value is not the string `success` (another of the five values, any other string, a blank, null or another type), `GitHubShipPath` shall end the ship with `[R3-NO-VERDICT-JSON]` before the block and stale-sha checks and before any push or merge; a file without the member is read as on main, and with `github.requireVerdict` off a current block still ends the ship with `[R3-SPEC-BLOCK]`. `parseVerdictDocument` (`src/core/review-policy.ts`) shall keep a `run_status` member outside the five values as `malformed` where `parseVerdict` drops it, and the verdict file readers of both ship paths and `readVerdict` of a reviewer output shall read documents through it.
  - R3. WHEN the PR lookup returns a PR together with a problem (a PR closed without a merge), `GitHubShipPath` shall end the ship with `[SHIP-PR-BASE-UNKNOWN]`, the problem text and the PR number, before any base sync, push or CI wait.
  - R4. WHEN `aidlc card next` selects REVIEW_FIX and the effort episode's terminal is `succeeded`, the card runner shall reopen the episode (`reopenAfterReviewBlock`), so the repair of a finding accepted by `aidlc review accept` after the gate settled the repair gets an attempt that `aidlc card attempt` records.
  - R5. `aidlc release packet` shall print the checkpoint directive when the attempt is at CHECKPOINT and exit non-zero in every other state, and shall never save the attempt, append to the journal or issue an operation; `ReleaseRunner.next` at CHECKPOINT shall return the same directive it returned before this card.
  - R6. `aidlc release next`, `report` and `candidate` shall refuse a `--goal` that is not the goal of the attempt, naming the attempt and both goals, before any write, and shall load the goal of the attempt when `--goal` is absent or names it; `packet`, which takes no `--goal`, shall load the goal of the attempt.
  - R7. `secretsGuard` shall test every match of each secret pattern and skip only the matches that are placeholders, and shall read `edits[].new_string` of a MultiEdit beside `content` and `new_string`.
  - R8. The `aidlc.ops.json` schema shall refuse a `successPattern`, `failurePattern` or `operationIdPattern` that is blank or does not compile as a regular expression with the `m` flag, with an issue at the key's path.
  - R9. `validateRegistry` shall add a blocking `[CARD-ID-DUPLICATE]` finding to each card outside the archive whose id another card file carries, and shall add the findings of a second card with an id to those of the first in place of replacing them.
  - R10. Plan readiness gate 3 shall fail on an open marker beside a closed `[TBD: question]` and on `???` wherever it stands, and shall pass a plan whose only marker is a closed `[TBD: question]`; a closed question and a code fence shall be replaced by whitespace before the search, so that a marker directly beside one still fails and no removal joins the text on its two sides into a marker.
  - R11. `decideWorktree` shall return STOP/ownership when the probe reports a mismatch, before it reads a missing entry as no worktree, so a branch checked out in two worktrees never gets a third.
  - R12. `IncidentLedger.shouldFile` shall measure the dedupe window from the record's `filedAt`, else from `firstSeen`; `attachIntent` shall set `filedAt` to the time it is given, and `aidlc monitor check --file-intent` shall pass the current time.
  - R13. `validatePerspectives` shall refuse two perspective names that differ only by letter case as a duplicate.
  - R14. Four messages shall name commands the CLI has, written so that they run: the package run-proof narration names `aidlc release report <attemptId> --step package-run-proof --status succeeded`, the staging verification narration names `aidlc release report <attemptId> --step stage-verify --status succeeded`, the staging release-config stop names `aidlc.ops.json` and `aidlc release ops --target staging`, and the no-goal refusal of `resolveCardGoal` names `aidlc goal new --card <id> "<request>"`.
  - R15. `README.md` (the directive list with `ask`, the layout with `review/`, the tests line with `scenarios`), `docs/OPERATIONS.md` (the bracket rule and the run_status rule of the verdict reader), `docs/ARCHITECTURE.md` (the run_status clause of the GitHub ship path) and the CHANGELOG Unreleased section shall state R1 to R14.
acceptance:
  - 1. `tests/surface/pre-review.test.ts` "an object nested in a document that broke before it never stands in for that document as the verdict" passes and fails on main; "R3 decision 1 (F1): a refuted opener whose brackets close later is one document that did not parse; one whose brackets never close is prose, whatever punctuation surrounds the verdict" passes and fails at ad56fd74; the other tests of the file pass unchanged. [R1] [dod arm 1]
  - 2. `tests/infra/github-ship.test.ts` "a pass verdict whose run_status is not success is no verdict: nothing is pushed or merged" passes and fails on main; "R3 decision 1: a run_status member that is not the string success is no verdict whatever its value, and it is read before the block and the stale sha", `tests/core/review-policy.test.ts` "a run_status member outside the five values is read as malformed, never dropped, so no reader takes it as success" and `tests/infra/ship.test.ts` "readVerdict keeps a run_status outside the five values as malformed, never as a review that completed" pass and fail at ad56fd74; the `parseVerdict` test of `tests/core/review-policy.test.ts` passes unchanged. [R2] [dod arm 1]
  - 3. `tests/infra/github-ship.test.ts` "a PR closed without a merge stops before any sync, push or CI wait, and the result names it" passes and fails on main. [R3] [dod arm 1]
  - 4. `tests/scenarios/dispute-running-attempt.test.ts` "a dispute accepted after the gate settled the repair reopens the episode: the repair gets an attempt and can be recorded" passes and fails on main; `tests/scenarios/fault-points.test.ts` passes unchanged. [R4] [dod arm 1]
  - 5. `tests/scenarios/release.test.ts` "the approval packet is read without advancing the attempt: no save, no journal event, no deploy, before and after the authority is recorded" passes and fails on main; "R3 decision 1: `aidlc release packet` fails outside CHECKPOINT and prints the packet at CHECKPOINT, and writes nothing in either case, before and after the authority is recorded" runs the CLI command, passes, and fails on the sources of main at its first assertion (exit 0 in PREPARE). [R5] [dod arm 1]
  - 6. `tests/scenarios/release.test.ts` "a release command refuses a --goal that does not own the attempt, and writes nothing" passes and fails on main. [R6] [dod arm 1]
  - 7. `tests/surface/hooks.test.ts` "secrets-guard: a placeholder match does not excuse a later real match, and every edit of a MultiEdit is read" passes and fails on main. [R7] [dod arm 1]
  - 8. `tests/infra/ops.test.ts` "a successPattern, failurePattern or operationIdPattern that is no regular expression is refused at its path, before any command can run" passes and fails on main. [R8] [dod arm 1]
  - 9. `tests/surface/card.test.ts` "registry: a card id carried by two files is a block on the active card, and no card overwrites the findings of another" passes and fails on main; `aidlc cards validate` on this repository still reports 0 blocking findings. [R9] [dod arm 1]
  - 10. `tests/surface/plan.test.ts` "a closed [TBD: question] exempts only itself: an open marker beside it still fails" and "a ??? marker fails wherever it stands, beside a word or alone" pass and fail on main; "R3 decision 1: text removed before the marker search leaves a gap, so a marker directly beside a closed question or a code fence still fails and no removal makes a marker" passes and fails at ad56fd74. [R10] [dod arm 1]
  - 11. `tests/infra/worktree.test.ts` "stops with ownership when the branch is checked out in two worktrees, and never starts a third" passes and fails on main. [R11] [dod arm 1]
  - 12. `tests/surface/incident.test.ts` "the dedupe window starts at each filing: a breach refiled after the window is deduped again until the next window ends" passes and fails on main; "a record filed before filedAt existed keeps its window from firstSeen" passes. [R12] [dod arm 1]
  - 13. `tests/surface/pre-review.test.ts` "perspective names that differ only by case are refused: their log and verdict files are one file on a case-insensitive filesystem" passes and fails on main. [R13] [dod arm 1]
  - 14. `tests/scenarios/release.test.ts` "a package attempt asks for its run proof by the command that records it" and "a staged attempt asks for its verification by the command that records it", `tests/core/release-machine.test.ts` "the staging release-config stop names the file that binds operations and the command that lists them" and `tests/core/card-goal.test.ts` "the command the no-goal refusal names carries the request text `aidlc goal new` requires" pass and fail on main. [R14] [dod arm 1]
  - 15. The README, `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` (the run_status clause of the GitHub ship path) and the CHANGELOG state R1 to R14 (reviewer-verified against the diff). [R15]
depends_on: []
budget: 950
tdd: true
diagnosis:
  root_cause: "Fourteen separate causes, by requirement. R1: `topLevelDocuments` resumes its scan at the character that refuted an opener, so an object nested after the break point is taken as a top-level document and `readVerdict` returns it. R2: the `requireVerdict` branch of `GitHubShipPath` reads `verdict` and `sha` and never `run_status`, which `classifyVerdict` treats as no verdict, and `parseVerdict` drops a `run_status` outside its five values before any reader sees it. R3: the ship path stops on a lookup problem only when no PR comes with it. R4: the REVIEW_FIX branch of `CardRunner.next` reopens only an episode whose terminal is unset, so an episode the gate settled as succeeded admits no repair attempt. R5: `aidlc release packet` calls `ReleaseRunner.next`, the mutating step. R6: `releaseCtx` loads the goal named by `--goal` without comparing it to `attempt.goalId`. R7: `secretsGuard` tests the first match of each pattern only and reads `content` and `new_string` only. R8: the ops patterns are plain strings compiled when the command's output is read. R9: `validateRegistry` keys findings by id with `Map.set` and has no duplicate check. R10: gate 3 strips every closed `[TBD: ...]` line-wide and its `???` alternative needs a word boundary. R11: `decideWorktree` reads a missing entry before a mismatch. R12: `shouldFile` measures the window from `firstSeen`, which a refiling never moves. R13: `validatePerspectives` compares names case-sensitively while their files share a name on a case-insensitive filesystem. R14: four messages were written for commands and flags that were renamed or never existed, or without the attempt id the command requires."
  repro: "Each test named in acceptance 1 to 14 fails at bcdc0665 (main) with the source files unchanged; the RED commit of attempt 1 holds only the tests and its DoD output lists the failures. The audit ran in the worktree D:\\wt\\AIDLC\\_audit-20261111 (branch audit-20261111 from de42ed08), where Codex reproduced the Fable xhigh findings and Fable xhigh reproduced the Codex findings with probe scripts before each fix."
  same_class: "For each fix, the sibling sites of its cause, each listed in the attempt evidence as covered, not affected or out of scope: every caller of `readVerdict` and `topLevelDocuments` (R2 and R3 readers, the second pass, the fallback); every verdict field the ship gate reads beside `classifyVerdict`; every `resolved.problem` reader in `GitHubShipPath`; every `reopenAfterReviewBlock` call; every `releaseCtx` caller and every release subcommand that takes an attempt; every tool input field `secretsGuard` reads; every pattern field of the ops schema; every `out.set` in `validateRegistry`; every marker alternative of gate 3; every return of `decideWorktree`; every reader of `firstSeen`; every place a perspective name becomes a file name; every message in `src/` that names an `aidlc` command changed here."
sweep: "grep -n \"readVerdict\\|topLevelDocuments\\|run_status\\|resolved.problem\\|reopenAfterReviewBlock\\|releaseCtx\\|checkpointPacket\\|new_string\\|Pattern\\|CARD-ID-DUPLICATE\\|CLOSED_TBD\\|found.mismatch\\|filedAt\\|validatePerspectives\" src. Read the lines again at PREPARE."
forbid: [weakening or skipping a test to go green, changing the verdict the reader returns for a document that R1 does not name, making `aidlc release packet` write anything, changing what `parseVerdict` returns, a fix outside the fourteen named here, editing .aidlc state by hand]
non_goals: [the confirmed findings the audit did not apply (sections B and C of the audit list such as journal append locking and the dirty-success episode), the live-state and hygiene items of section D of the audit list, a refactor of any touched function beyond its fix, the two load-sensitive timing tests of tests/infra/exec.test.ts]
hygiene: "The fixes were written and verified in the audit worktree and are carried over as two commits: the tests alone (RED), then the sources and docs. The fourteen fixes are independent: none reads state another writes. `CardRunner.next` is covered by the verify-card-run-writes skill, so its fault-point test is in the DoD; the REVIEW_FIX reopen adds no store write and no journal append. Amended after R3 decision 1 (five findings): R1 reads membership from the brackets (and, for a broken document cut short, from the member name), never from a comma or a closer beside the document; two cases main reads as a verdict now yield none and are stated in R1: a document between a prose opener that never closed and later closers that balance it, and a document directly behind a member name after such an opener. R2 reads the status before the block and the sha, and a `run_status` outside the five values is `malformed` at the three document readers; `parseVerdict` itself is unchanged because `tests/core/review-policy.test.ts` pins since b9457c9e that it drops such a value. The two card-runner sites that call `parseVerdict` read a result the journal already decided (the envelope carries its own validated run status), so they stay. R10 replaces removed text by whitespace. The balance is counted over all brackets outside quoted text without matching their kinds, which a broken JSON document does not need and which keeps the walk linear. Outside text in a message is quoted as the surrounding code already does."
doc_sync: README.md, docs/OPERATIONS.md, docs/ARCHITECTURE.md, CHANGELOG.md
---

# T0-AUDIT-FIXES

## Deliverable
Fourteen defects found by the audit of 2026-11-11 no longer occur. The five with the largest effect: a `block` verdict with one bad escape in a reason is no longer read as `pass`; a `pass` verdict from a review that did not complete no longer merges; a finding accepted after the gate settled its repair no longer leaves the card without an attempt until its deadline; `aidlc release packet` no longer runs the release step it displays; the secrets guard reads every match and every edit.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/pre-review.test.ts tests/infra/github-ship.test.ts tests/scenarios/dispute-running-attempt.test.ts tests/scenarios/release.test.ts tests/surface/hooks.test.ts tests/infra/ops.test.ts tests/surface/card.test.ts tests/surface/plan.test.ts tests/infra/worktree.test.ts tests/surface/incident.test.ts tests/core/release-machine.test.ts tests/core/card-goal.test.ts tests/scenarios/fault-points.test.ts tests/core/review-policy.test.ts tests/infra/ship.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Attempt evidence

Attempt 1 (effort medium). The fixes were written in the audit worktree and carried over as tests first. RED receipt `2f0a93e4` (tests only, sources of main): 17 tests failed, the ones named in acceptance 1 to 14 except "a record filed before filedAt existed keeps its window from firstSeen", which passes on main as the card states; the other 301 passed. Fix `ef448402`. The sweep then found a fourth message of the R14 class, the staging-verify narration without the attempt id; the card was amended on main (f241becb), RED receipt `9a0a5cc2` (that test failed, quoting the old narration), fix `df13b70b`.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/surface/pre-review.test.ts` "an object nested in a document that broke before it never stands in for that document as the verdict" | pass |
| 2 | `tests/infra/github-ship.test.ts` "a pass verdict whose run_status is not success is no verdict: nothing is pushed or merged" | pass |
| 3 | `tests/infra/github-ship.test.ts` "a PR closed without a merge stops before any sync, push or CI wait, and the result names it" | pass |
| 4 | `tests/scenarios/dispute-running-attempt.test.ts` "a dispute accepted after the gate settled the repair reopens the episode: the repair gets an attempt and can be recorded"; `tests/scenarios/fault-points.test.ts` | pass |
| 5 | `tests/scenarios/release.test.ts` "the approval packet is read without advancing the attempt: no save, no journal event, no deploy, before and after the authority is recorded" | pass |
| 6 | `tests/scenarios/release.test.ts` "a release command refuses a --goal that does not own the attempt, and writes nothing" | pass |
| 7 | `tests/surface/hooks.test.ts` "secrets-guard: a placeholder match does not excuse a later real match, and every edit of a MultiEdit is read" | pass |
| 8 | `tests/infra/ops.test.ts` "a successPattern, failurePattern or operationIdPattern that is no regular expression is refused at its path, before any command can run" | pass |
| 9 | `tests/surface/card.test.ts` "registry: a card id carried by two files is a block on the active card, and no card overwrites the findings of another"; `aidlc cards validate` in the worktree: 272 cards, 0 blocking | pass |
| 10 | `tests/surface/plan.test.ts` "a closed [TBD: question] exempts only itself: an open marker beside it still fails" and "a ??? marker fails wherever it stands, beside a word or alone" | pass |
| 11 | `tests/infra/worktree.test.ts` "stops with ownership when the branch is checked out in two worktrees, and never starts a third" | pass |
| 12 | `tests/surface/incident.test.ts` "the dedupe window starts at each filing: a breach refiled after the window is deduped again until the next window ends" and "a record filed before filedAt existed keeps its window from firstSeen" | pass |
| 13 | `tests/surface/pre-review.test.ts` "perspective names that differ only by case are refused: their log and verdict files are one file on a case-insensitive filesystem" | pass |
| 14 | `tests/scenarios/release.test.ts` "a package attempt asks for its run proof by the command that records it" and "a staged attempt asks for its verification by the command that records it"; `tests/core/release-machine.test.ts` "the staging release-config stop names the file that binds operations and the command that lists them"; `tests/core/card-goal.test.ts` "the command the no-goal refusal names carries the request text `aidlc goal new` requires" | pass |
| 15 | README.md (directive list, layout, tests line), docs/OPERATIONS.md (verdict extraction sentence), CHANGELOG.md Unreleased | reviewer |

Rule against main, per fix: R1 removes a verdict only for a document that follows a refuted opener and is a container member; every complete top-level document main reads as the verdict is still read (the earlier tests of the file pass unchanged). R2 and R3 only add stops before a remote effect. R4 reopens only an episode whose terminal is `succeeded` in REVIEW_FIX; an open episode is passed on as before. R5: `ReleaseRunner.next` at CHECKPOINT calls the same code through `checkpoint()`, so its directive is the one main returns. R6 refuses only a `--goal` that differs from the attempt's goal; main loaded that other goal. R8 refuses only a pattern that would have thrown when the output was read. R9, R10, R11 and R13 add findings or refusals where main had none. R12 changes when a refiled breach is deduplicated; a record without `filedAt` keeps the window of main.

Same class (the sibling sites of each cause):
- R1: `topLevelDocuments` has one caller, `readVerdict`; `readVerdict` has one caller, `finalizeReview`, which reads every reviewer output (R2 and R3, their fallbacks, the second pass, the base-sync reviewer): covered. `ShipPath.readVerdict(cardId)` parses the verdict file aidlc wrote, not reviewer output: not affected.
- R2: `run_status` is read by `classifyVerdict` (core/review-policy.ts) and `classify` (review/pre-review.ts), which already treat a value other than `success` as no verdict, and now by the GitHub ship gate: covered. The scaffold ship path leaves its gate to the scaffold script, and the dry-run path reads no verdict file: not affected.
- R3: `resolved.problem` has two readers in `GitHubShipPath.ship`; both stop now, the second with the PR number: covered.
- R4: `reopenAfterReviewBlock` has four other calls (the pre-review block paths and the two R3 block paths); each reopens whenever an episode exists: not affected.
- R5, R6: `releaseCtx` has four callers; `next`, `report` and `candidate` pass `--goal`, `packet` has none and loads the attempt's goal; `release start` and `release ops` take no attempt: covered. `checkpointPacket` has one caller.
- R7: the hook matcher sends Bash, PowerShell, Edit, Write and MultiEdit; their text fields are `command`, `new_string`, `content` and `edits[].new_string`, all read: covered. NotebookEdit is not sent to the hook: not affected.
- R8: the three pattern fields are the only ones the five `new RegExp` sites of `src/delivery/ops.ts` compile: covered.
- R9: `validateRegistry` has one `out.set`: covered.
- R10: the eight word markers keep their word boundary; `???` is the only alternative without word characters: covered.
- R11: `decideWorktree` returns the probe failure first as on main, then the mismatch, then the missing entry: covered.
- R12: `firstSeen` is read by `shouldFile` only; `attachIntent` has one caller, `aidlc monitor check --file-intent`, which passes the time: covered.
- R13: `validatePerspectives` is called once, in `runPanel`, before any perspective file is written; `ProjectConfig` accepts any non-blank names: covered at the reader.
- R14: every `aidlc` command named in `src/core/release-machine.ts`, `src/core/card-goal.ts` and `src/loop/release-runner.ts` was run with `--help` (exit 0 each): `goal new`, `goal extend`, `goal resume`, `release ops`, `release candidate`, `release report`, `release next`, `release packet`, `authorize`. The staging-verify narration lacked the attempt id `release report` requires: fixed here. The checkpoint narration's `aidlc authorize` line gives the kind, environment, candidate and operations and leaves `--goal` to the default of that command: not changed.

DoD: `npm run typecheck` exit 0; the `node --test` arm exit 0. Mutation sweep (`aidlc card mutants`): not run.
