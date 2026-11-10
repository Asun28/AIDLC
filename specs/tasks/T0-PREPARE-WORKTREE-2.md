---
id: T0-PREPARE-WORKTREE-2
title: "`aidlc card next` selects BUILD only for a card whose worktree is an existing directory, so a PREPARE that asked for a new worktree is repeated until it is made"
status: merged
branch: T0-PREPARE-WORKTREE-2
worktree: D:\wt\AIDLC\T0-PREPARE-WORKTREE-2
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/prepare-worktree.test.ts
  - tests/scenarios/fault-points.test.ts
  - tests/scenarios/merge-unconfirmed.test.ts
  - tests/scenarios/audit.test.ts
  - tests/scenarios/narration-quote.test.ts
  - .claude/skills/verify-card-run-writes/SKILL.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-PREPARE-WORKTREE.md
  - specs/tasks/T0-PREPARE-WORKTREE-2.md
dod_command: npm run typecheck && node --test tests/scenarios/prepare-worktree.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/merge-unconfirmed.test.ts tests/scenarios/audit.test.ts tests/scenarios/narration-quote.test.ts
dod_exit: 0
requirements:
  - R1. WHEN PREPARE decides `start` (no worktree for the card branch), the run shall stay in PREPARE and record no worktree path; the directive is the `prepare` directive with action `start`, as before this card.
  - R2. The `prepared` evidence of the card machine shall be true only when the run records a worktree path, that path is an existing directory (a regular file or a path whose stat fails is not), and this session holds the card lease. A run in BUILD, REVIEW_FIX or SHIP whose recorded worktree path is not an existing directory shall get PREPARE. WHEN git still registers the card branch's worktree at the expected path, marked prunable or locked, and no directory is there, PREPARE shall return `prepare` with action `start` that names how to clear the registration, and record no stop; any other failed worktree probe stays a `tool` stop.
  - R3. With `shipPath: dry-run`, which creates no worktree, `prepared` shall be what it is before this card.
  - R4. `docs/OPERATIONS.md` (the card loop, PREPARE) and the CHANGELOG Unreleased section shall state R1 to R3.
  - R5. A scenario test that builds a run on the dry-run ship path and then runs `card next` on the github ship path shall create the run's recorded worktree directory before that `card next`, as a prepared github run has one; no assertion of those tests changes.
acceptance:
  - 1. `tests/scenarios/prepare-worktree.test.ts`, on the github ship path with a real temporary repository: a card's first `card next` returns `prepare` with action `start`, and a second `card next` without creating the worktree returns `prepare` with action `start` again, not `build`. Fails before the fix. [R1] [R2] [dod arm 1]
  - 2. Same file: after `git worktree add` of the card branch at the directive's path, `card next` returns `prepare` with action `attach`, then `build`. [R1] [R2] [dod arm 1]
  - 3. Same file: a run stored in BUILD, REVIEW_FIX or SHIP with a recorded worktree path that does not exist, that is a regular file, or that lies under a regular file gets `prepare` with action `start`; an attached worktree deleted while git registers it (prunable, and locked) gets a retryable `prepare` `start` with no stop and builds again once made; a failed common-directory probe of an existing directory stays a `tool` stop. Fails before the fix. [R2] [dod arm 1]
  - 4. Same file: with `shipPath: dry-run` the directives of a first and second `card next` are those before this card. [R3] [dod arm 1]
  - 5. `tests/scenarios/fault-points.test.ts` passes; the PREPARE write is in its covered commands or recorded in the verify skill's coverage record, and the sync commit moves at CLOSE on main. [R1] [dod arm 2]
  - 6. The docs and CHANGELOG state R1 to R3 (reviewer-verified against the diff). [R4]
  - 7. `tests/scenarios/merge-unconfirmed.test.ts`, `tests/scenarios/audit.test.ts` and `tests/scenarios/narration-quote.test.ts` pass, and their diff only creates the recorded worktree directory before the github `card next` (reviewer-verified against the diff). [R5] [dod arm 1]
depends_on: []
budget: 220
tdd: true
diagnosis:
  root_cause: "`CardRunner` PREPARE (src/loop/card-runner.ts:921 at 1fe48a6) saves `state: 'BUILD'` and `worktree: decision.path` for both decisions, `start` and `attach`, before anything creates the worktree; the `prepared` evidence (:665) is `Boolean(run.worktree)` plus an owned lease, so the next `card next` selects BUILD for a directory that does not exist."
  repro: "Goal g-20261107095106-c08940 on 2026-11-08: T1-BENCH-TRIALS got `prepare` action `start` for D:\\wt\\AIDLC\\T1-BENCH-TRIALS, then `build` attempt 1 with no worktree or branch; T1-EVAL-TRANSCRIPT and T1-FINDING-REPRO, whose runs an earlier `card next` had left in BUILD, got `build` with no `prepare` at all. Goal g-20261110040130-9f38f7 showed it again on 2026-11-10 for T0-PREPARE-WORKTREE itself."
  same_class: "Other readers of `run.worktree` that assume it exists: the ship path, `card close --cleanup`, `reviewCheckout` and the candidate read in `recordAttempt`; the attempt evidence of T0-PREPARE-WORKTREE lists each as covered by R2 or not affected."
sweep: "grep -n \"prepared\\|run.worktree\\|isDirectory\\|registeredWithoutDirectory\" src/loop/card-runner.ts src/core/card-machine.ts at 054ec11: the `prepared` evidence, `prepare`, `reviewCheckout`, the candidate read in `recordAttempt` and the directive builders; the attempt evidence of T0-PREPARE-WORKTREE classifies each."
forbid: [weakening or skipping a test to go green, creating the worktree from `card next` (the agent or scaffold makes it), changing the dry-run directives, editing .aidlc state by hand]
non_goals: [making `card next` run `git worktree add`, a node_modules link for new worktrees, changing what `decideWorktree` decides, asking git on every `card next` whether the directory is the card's worktree]
hygiene: "Continues the branch line of T0-PREPARE-WORKTREE at 054ec11: R3 decision 1 blocked 123855d (F1, a regular file counted as prepared), 2f50b22 repaired it and passed decision 2, the second pass blocked it (F2, a deleted worktree git still registers became a final tool stop), e0679a6 repaired that and passed decision 4, Windows CI on PR 250 then failed two tests on a fixture main root that was not canonical under the runner's 8.3 temp path (RUNNER~1), and 054ec11 fixes the test only. The carried diff is about 305 lines against budget 220: 48 in src/loop/card-runner.ts, the rest tests the acceptance and the two R3 repairs required, and card evidence. R2 adds a directory check, not a git probe, to every `card next`; run `npm run bench -- --check` before SHIP."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-PREPARE-WORKTREE-2

Replaces T0-PREPARE-WORKTREE by the user's ruling of 2026-11-10 on its STOP/review: the Windows CI repair 054ec11 (a test fixture main root, no src change) needed a fifth R3 decision, one more than the allowance.

## Deliverable
After `aidlc card next` asks for a new worktree, it keeps asking until the worktree exists, so no BUILD directive names a directory that is not there.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/prepare-worktree.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/merge-unconfirmed.test.ts tests/scenarios/audit.test.ts tests/scenarios/narration-quote.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Attempt evidence
Attempt 1 continues the branch line of T0-PREPARE-WORKTREE at 054ec11, merged with main at 95cb3bc. RED: 254462f (`tests/scenarios/prepare-worktree.test.ts`, 3 of 4 failed on main's code), and each R3 repair added a test that failed on the candidate before it (F1 on 123855d, F2 on 2f50b22; repros recorded on T0-PREPARE-WORKTREE). Input forms, the class sweep and the readers of `run.worktree` are listed in the attempt evidence of specs/tasks/T0-PREPARE-WORKTREE.md.

| Item | Proof | Result |
|---|---|---|
| 1 | prepare-worktree.test.ts, acceptance 1 test | pass |
| 2 | prepare-worktree.test.ts, acceptance 2 test | pass |
| 3 | prepare-worktree.test.ts, the four acceptance 3 tests | pass |
| 4 | prepare-worktree.test.ts, acceptance 4 test | pass |
| 5 | fault-points.test.ts in the DoD; the PREPARE start write is named under Not covered in .claude/skills/verify-card-run-writes/SKILL.md; the sync commit moves at CLOSE | pass; sync commit open until CLOSE |
| 6 | docs/OPERATIONS.md paragraph after the T0 bugfix walk-through; CHANGELOG Unreleased entry | reviewer-verified |
| 7 | merge-unconfirmed, audit and narration-quote tests in the DoD; each diff adds one `mkdirSync` of the recorded worktree and changes no assertion | pass |

054ec11 gives the real-repository fixture a canonical main root (`realpathSync.native(fx.tmp)`): Windows CI on PR 250 failed acceptance 2 and the prunable-or-locked acceptance 3 test under the runner's 8.3 temp path, reproduced locally with TMP set to an 8.3 path; 7 of 7 pass under the short and the normal temp directory.

Attempt 2 (repair of R3 decision 1 on 7674f61: F1 stat-error-treated-as-absence, F2 unrelated-probe-stop-cleared). The recovery no longer rewrites a tool stop: `CardRunner.prepare` reads the stale registration first (`staleRegistration`) and calls `decideWorktree` unchanged for anything else. A registration counts as stale only from a listing that succeeds, an entry at the expected path marked `prunable` or `locked`, and a stat that reports nothing there (`pathKind` is `absent` only for ENOENT and ENOTDIR; any other stat error is `unknown`). The new test failed on 7674f61 (a failed first listing became `start`) and passes with the repair. Input forms of `staleRegistration` and `pathKind`, each with its test:
- the listing fails: `decideWorktree` decides, here a tool stop; new test, form "the first listing fails";
- a marked entry whose directory stat fails with EACCES: `unknown`, so `decideWorktree` decides (a tool stop); new test, form "EACCES";
- a marked entry whose directory exists: `decideWorktree` decides (tool stop on a failed common-directory probe); acceptance 3, failed probe of an existing directory;
- a prunable or a locked entry with nothing at its path: retryable `start`; acceptance 3, forms "prunable" and "locked", real repository;
- an entry with neither mark, a mismatch, no entry: `decideWorktree` decides as before; t0-flow.test.ts T0-PROBE-STOP-TEXT (T1-COMMON, ownership) and acceptance 1;
- `prepared` reads `pathKind(...) === 'directory'`: a regular file, a path under a file and a missing path are not prepared; acceptance 3, first two tests.

Attempt 3 (repair of R3 decision 2 on 1d5125a: F3 re F2, a failed first listing followed by a successful listing still lost the stop; F4 registered-file-stops, a registration whose path holds a regular file reached the final stop). `staleRegistration` now returns a PREPARE decision: its own failed listing is the tool stop decideWorktree records for one (same detail), so no later listing can replace it; a marked entry whose path holds something that is not a directory is a retryable `start` that says to move or delete it; a stat that cannot tell still goes to decideWorktree. Both new forms failed on 1d5125a and pass with the repair:
- a failed listing, then a successful listing with no entry of the card: tool stop; test "a failed listing is the tool stop", first form;
- a prunable registration with a regular file at its path: retryable `start` naming "move or delete it", then attach and build after the file is removed and the registration pruned; acceptance 3, form "a file at the path", real repository.
