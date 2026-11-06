---
id: T0-REVIEW-CANDIDATE-PINS
title: Pin each candidate under refs/aidlc/candidates/ before its R3 decision is written, so a squash merge and a deleted branch cannot lose a commit the review ledger names
status: todo
branch: T0-REVIEW-CANDIDATE-PINS
worktree: D:\wt\AIDLC\T0-REVIEW-CANDIDATE-PINS
allow_paths:
  - src/probes/git.ts
  - src/review/bench.ts
  - src/loop/card-runner.ts
  - tests/scenarios/candidate-pins.test.ts
  - tests/scenarios/_harness.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-REVIEW-CANDIDATE-PINS.md
dod_command: npm run typecheck && node --test tests/scenarios/candidate-pins.test.ts tests/surface/review-bench-export.test.ts tests/surface/review-bench.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/review-block.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/journal-owed.test.ts tests/core/parse-guard.test.ts tests/infra/update-json.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. WHEN an R3 invocation decides `pass` or `block` for a commit, on either path (`CardRunner.formalReview`, and the ship-path reviewer's decision), the runner shall create `refs/aidlc/candidates/<sha>` naming that commit before the decision is written, so a crash between the two leaves a spare ref and never a recorded decision on an unpinned commit. A stale candidate recorded as history is pinned too, since the ledger names it.
  - R2. The pin shall run `git -c core.hooksPath=/dev/null [-c hook.<name>.enabled=false ...] update-ref --no-deref refs/aidlc/candidates/<sha> <sha>` from the run's worktree. `noHookOptions` moves from `src/review/bench.ts` to `src/probes/git.ts` with its behaviour unchanged, since only `src/cli/main.ts` may import `bench.ts`; `bench.ts` imports it from there.
  - R3. IF the pin fails (a non-zero git exit, a hook name `noHookOptions` refuses, a throw of any value), THEN the decision, the counters, the findings and the card state shall be what a successful pin gives, and the `REVIEW_DECIDED` event shall carry `candidatePinned` false and `pinError`, one nonempty line naming the cause. A successful pin carries `candidatePinned` true. On the command path both are part of the event the decision write persists, so recovery of an owed event keeps them.
  - R4. A no-verdict, a quota hold and a run with `repo.isGit` false shall pin nothing, run no git command for a pin and add neither field.
  - R5. The loop docs shall describe the pins: `### Formal review (R3) as a command` in `docs/OPERATIONS.md` gives the ref name, that the ref keeps a commit whose branch was deleted, the hook rule, the failure rule of R3, that the refs are local and not pushed, and `git update-ref -d` to drop one; `docs/ARCHITECTURE.md` lists the refs with the persisted state; the CHANGELOG Unreleased section has an entry naming this card.
acceptance:
  - 1. `tests/scenarios/candidate-pins.test.ts`, real git, an R3 pass through `formalReview` on candidate C: `git rev-parse refs/aidlc/candidates/<C>` prints C and `REVIEW_DECIDED` has `candidatePinned` true. After `git branch -D`, `git reflog expire --expire=now --all` and `git -c gc.pruneExpire=now gc`, `git cat-file -e <C>^{commit}` exits 0; the same steps on an unpinned commit in the fixture exit non-zero, so the fixture is live. [R1] [R2] [dod arm 2]
  - 2. an R3 block on C1 and a pass on the repaired C2 leave both refs, each naming its own commit. [R1] [dod arm 2]
  - 3. a ship-path reviewer's pass and block each leave the ref, with `candidatePinned` on the event. [R1] [R3] [dod arm 2]
  - 4. a git runner that reads the card run when it sees `update-ref` finds the invocation still pending, so the pin precedes the decision. [R1] [dod arm 2]
  - 5. an `update-ref` that exits 1 and a hook name holding `=` each give the run state, counters and findings of a successful pin, with `candidatePinned` false and `pinError` naming the cause; a runner that throws a string, null, an empty Error or a value `String` cannot print does the same with a nonempty `pinError`, on both paths. [R3] [dod arm 2]
  - 6. a `reference-transaction` hook in `.git/hooks`, one in a directory `core.hooksPath` names and, on a git that runs one (decided by running it), one defined in config each run for a plain `git update-ref` and not for the pin; `.git/config` keeps its bytes. [R2] [dod arm 2]
  - 7. a no-verdict leaves no ref and no `update-ref` call; a run with `repo.isGit` false makes no git call for a pin and its event has neither field. [R4] [dod arm 2]
  - 8. `tests/surface/review-bench-export.test.ts`, `tests/scenarios/fault-points.test.ts`, `tests/core/parse-guard.test.ts` and `tests/infra/update-json.test.ts` pass with none of them changed. [R2] [dod arm 2]
  - 9. `docs/OPERATIONS.md` contains `refs/aidlc/candidates/` in `### Formal review (R3) as a command`, `docs/ARCHITECTURE.md` contains it, the CHANGELOG Unreleased section has a `T0-REVIEW-CANDIDATE-PINS` entry, and `tests/surface/prose.test.ts` passes. [R5] [dod arms 2, 3]
  - 10. a `REVIEW_DECIDED` append that fails after the decision write, then the next `card next`, leaves one event holding `candidatePinned` and, for a failed pin, `pinError`. [R3] [dod arm 2]
depends_on: []
budget: 300
tdd: true
sweep: "main at 1ea52d2. Decision paths: `formalReview` commits through `commitReviewed` at src/loop/card-runner.ts:2073 and appends REVIEW_DECIDED through `deliverOwed` with `extra` at 2137, the route for a fact only this command knows; the ship-path reviewer records through `recordReviewOutcome` at 2501 and appends at 2516. `git update-ref` appears in src only at src/review/bench.ts:464, `noHookOptions` is at bench.ts:511 and uses `oneLine`, and tests/surface/review-bench.test.ts pins that only the CLI imports bench.ts. `refs/aidlc/candidates` appears nowhere in src, docs or tests. `makeFixture` sets `isGit: false` at tests/scenarios/_harness.ts:57, so R4 keeps the existing scenarios free of the new call, and a new test needs a real repository. Run on 2026-11-06 on git 2.56.0.windows.4 in a throwaway repository: `update-ref --no-deref` of a ref named by a full commit id, from a linked worktree, exits 0 twice and the main checkout sees the ref; `rev-parse`, `rev-parse --short`, `log` and `checkout` of that id print no ambiguity warning; the commit survives `git branch -D`, a reflog expiry and `gc` with `gc.pruneExpire=now`."
forbid:
  - changing a review decision, counter, finding or card state because of a pin
  - writing a pin anywhere but refs/aidlc/candidates/
  - changing ReviewBenchCase, the export's refs under refs/aidlc/bench/, or the squash merge of the ship path
  - weakening or skipping a test to go green
non_goals:
  - pinning R2 candidates (the export drafts nothing from stage pre)
  - backfilling older candidates (the export pinned 211 commits on 2026-11-06)
  - deleting, expiring or pushing pins
  - setting gc.pruneExpire in `aidlc init`
  - changing branch cleanup at CLOSE
  - making the ship path's REVIEW_DECIDED an owed event (a failed append loses that whole event, as it does today)
hygiene: "This card closes the cause of the loss found on 2026-11-06: a squash merge leaves a card's commits on its branch alone, CLOSE deletes that branch, and an automatic `git gc` then dropped 77 of the candidates the export needs; 69 came back from GitHub and 8, on stopped runs, did not. `gc.pruneExpire=never` is set in this clone's config as the stopgap, and this card makes that setting unnecessary for a new candidate and covers every repository `aidlc init` serves. `src/loop/card-runner.ts` is covered by the skill verify-card-run-writes, so run it at SHIP; the pin is a ref write, not a store write, so its coverage record should not change. T1-VERIFY-MUTANTS-PROMPT also edits `src/loop/card-runner.ts`: whichever lands second merges the base."
doc_sync: docs/OPERATIONS.md, docs/ARCHITECTURE.md, CHANGELOG.md
---

# T0-REVIEW-CANDIDATE-PINS

## Deliverable
Every commit R3 decides on keeps a ref, `refs/aidlc/candidates/<sha>`, written before the decision, so the review ledger never names a commit that nothing keeps. `aidlc review bench export` and any later audit can then read a candidate whatever happened to its branch.

Decisions:
- One ref per commit, named by the commit: a second decision on the same candidate rewrites the same value, and the name needs no goal or card.
- Before the decision, not after: a spare ref costs nothing, and a decision on an unpinned commit is the gap this card closes.
- A failed pin never changes a review. The event records it, so the gap is visible in the journal; a review that stopped on a ref failure would trade a lost commit for a stopped card.
- Hooks off, by the rule of T1-REVIEW-BENCH-EXPORT-3 R12, through the same helper.
- R3 only: the export drafts nothing from stage `pre`, and every R3 candidate has passed R2.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/candidate-pins.test.ts tests/surface/review-bench-export.test.ts tests/surface/review-bench.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/review-block.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/journal-owed.test.ts tests/core/parse-guard.test.ts tests/infra/update-json.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every listed test passes.

## Attempt evidence

- RED: commit ad7bd5a. `node --test tests/scenarios/candidate-pins.test.ts` exited 1, 10 tests, 2 passed, 8 failed, every failure the missing ref or an assertion on it. The two that passed are the R4 tests, which assert that nothing is pinned.
- GREEN: `npm run typecheck` exits 0 and `npm test` exits 0, 2155 tests, 2149 passed, 6 skipped, 0 failed, at the commit before the last three tests went in. `npm run build && npm run bench -- --check` exits 0.
- A first full run failed acceptance 5, and a rerun of that test alone failed 2 of 3 times. The cause was the fixture: git 2.56 ends with `must be configured` on a hook with `.event` and no `.command` when `git status` refreshes the index, which depends on timing. The fixture now gives the hook a command, and the test passed 6 of 6 repeats.
- WSL Ubuntu, git 2.43.0-1ubuntu7.3: the pin and export tests give 51 tests, 49 passed, 2 skipped (the hooks defined in config, which that git does not run), 0 failed.
- Mutation check: 20 breaks of this change in scratch clones, each restored and none committed; each fails a test. One survived the first sweep, a pin of `HEAD` in place of the reviewed commit, so the replaced-candidate test now moves `HEAD`, and that break fails it. A sweep of my own tests before the mutants added three: the pin order on the ship path, an advisory block, and a symbolic ref at the pin name.
- verify-card-run-writes: in sync. `src/loop/card-runner.ts` changed without a change to a store write, a journal append or their order: the pin is a ref write and the event gains fields, so the coverage record and the sync commit stay. `tests/scenarios/fault-points.test.ts` passes unchanged and its fixture has `isGit` false, so that check does not reach the pin.

Repair after R3 decision 1 (classes pin-error-escapes, pin-result-not-persisted), on fd79756:
- R2 raised the first class as an advisory on fd79756. A candidate that passed cannot take a new attempt, so it went to R3 unchanged, and R3 reproduced it with a thrown string.
- RED: commit 4d90823. `node --test tests/scenarios/candidate-pins.test.ts` exited 1, 16 tests, 13 passed, 3 failed, every failure an assertion: any thrown value on each path, and the lost `REVIEW_DECIDED` append.
- GREEN at 5ff4a31: `npm run typecheck` exits 0 and the DoD tests pass, 370 of 370. `npm test` exits 0, 2160 tests, 2154 passed, 6 skipped, 0 failed. `npm run build && npm run bench -- --check` exits 0.
- WSL Ubuntu, git 2.43.0-1ubuntu7.3: the pin and export tests give 54 tests, 52 passed, 2 skipped (the hooks defined in config), 0 failed.
- Class sweep: `pinDecided` is the one catch around a pin, and the command path was the one place the result rode on `extra`. The ship path appends its `REVIEW_DECIDED` directly, as before this card, so a failed append there loses the whole event; that is a non-goal of this card. The three `(err as Error).message` sites left in `src/review/bench.ts` report errors from `JSON.parse`, the file system and git steps, and none is on the pin path.
- Mutation check: 25 breaks in scratch clones, each restored and none committed. 24 fail a test. The other adds the pin fields to `extra` as well as the event, which changes nothing. A pin error of `undefined` for a thrown string survived the sweep, so the tests now assert the cause each value names.
