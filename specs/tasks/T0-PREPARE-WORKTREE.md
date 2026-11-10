---
id: T0-PREPARE-WORKTREE
title: "`aidlc card next` selects BUILD only for a card whose worktree exists, so a PREPARE that asked for a new worktree is repeated until it is made"
status: todo
branch: T0-PREPARE-WORKTREE
worktree: D:\wt\AIDLC\T0-PREPARE-WORKTREE
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
dod_command: npm run typecheck && node --test tests/scenarios/prepare-worktree.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/merge-unconfirmed.test.ts tests/scenarios/audit.test.ts tests/scenarios/narration-quote.test.ts
dod_exit: 0
requirements:
  - R1. WHEN PREPARE decides `start` (no worktree for the card branch), the run shall stay in PREPARE and record no worktree path; the directive is the `prepare` directive with action `start`, as before this card.
  - R2. The `prepared` evidence of the card machine shall be true only when the run records a worktree path, that directory exists, and this session holds the card lease. A run in BUILD, REVIEW_FIX or SHIP whose recorded worktree directory does not exist shall get PREPARE.
  - R3. With `shipPath: dry-run`, which creates no worktree, `prepared` shall be what it is before this card.
  - R4. `docs/OPERATIONS.md` (the card loop, PREPARE) and the CHANGELOG Unreleased section shall state R1 to R3.
  - R5. A scenario test that builds a run on the dry-run ship path and then runs `card next` on the github ship path shall create the run's recorded worktree directory before that `card next`, as a prepared github run has one; no assertion of those tests changes. Found by the full suite at attempt 1: 23 tests in merge-unconfirmed, audit and narration-quote went to PREPARE under R2.
acceptance:
  - 1. `tests/scenarios/prepare-worktree.test.ts`, on the github ship path with a real temporary repository: a card's first `card next` returns `prepare` with action `start`, and a second `card next` without creating the worktree returns `prepare` with action `start` again, not `build`. Fails before the fix. [R1] [R2] [dod arm 1]
  - 2. Same file: after `git worktree add` of the card branch at the directive's path, `card next` returns `prepare` with action `attach`, then `build`. [R1] [R2] [dod arm 1]
  - 3. Same file: a run stored in BUILD with a recorded worktree path that does not exist gets `prepare` with action `start`. Fails before the fix. [R2] [dod arm 1]
  - 4. Same file: with `shipPath: dry-run` the directives of a first and second `card next` are those before this card. [R3] [dod arm 1]
  - 5. `tests/scenarios/fault-points.test.ts` passes; the PREPARE write is in its covered commands or recorded in the verify skill's coverage record, and the sync commit moves at CLOSE on main. [R1] [dod arm 2]
  - 6. The docs and CHANGELOG state R1 to R3 (reviewer-verified against the diff). [R4]
  - 7. `tests/scenarios/merge-unconfirmed.test.ts`, `tests/scenarios/audit.test.ts` and `tests/scenarios/narration-quote.test.ts` pass, and their diff only creates the recorded worktree directory before the github `card next` (reviewer-verified against the diff). [R5] [dod arm 1]
depends_on: []
budget: 220
tdd: true
diagnosis:
  root_cause: "`CardRunner` PREPARE (src/loop/card-runner.ts:921 at 1fe48a6) saves `state: 'BUILD'` and `worktree: decision.path` for both decisions, `start` and `attach`, before anything creates the worktree; the `prepared` evidence (:665) is `Boolean(run.worktree)` plus an owned lease, so the next `card next` selects BUILD for a directory that does not exist."
  repro: "Goal g-20261107095106-c08940 on 2026-11-08: T1-BENCH-TRIALS got `prepare` action `start` for D:\\wt\\AIDLC\\T1-BENCH-TRIALS, then `build` attempt 1 with no worktree or branch; T1-EVAL-TRANSCRIPT and T1-FINDING-REPRO, whose runs an earlier `card next` had left in BUILD, got `build` with no `prepare` at all. Each worktree was made by hand with `git worktree add`."
  same_class: "Other readers of `run.worktree` that assume it exists: the ship path and `card close --cleanup`; check them at PREPARE and list each in the attempt evidence as covered by R2 or not affected."
sweep: "grep -n \"prepared\\|run.worktree\" src/loop/card-runner.ts src/core/card-machine.ts. Lines are from main at 1fe48a6; read them again at PREPARE."
forbid: [weakening or skipping a test to go green, creating the worktree from `card next` (the agent or scaffold makes it), changing the dry-run directives, editing .aidlc state by hand]
non_goals: [making `card next` run `git worktree add`, a node_modules link for new worktrees, changing what `decideWorktree` decides]
hygiene: "R2 adds a directory check, not a git probe, to every `card next`, so the loop benchmark's counts should not move; run `npm run bench -- --check` before SHIP."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-PREPARE-WORKTREE

## Deliverable
After `aidlc card next` asks for a new worktree, it keeps asking until the worktree exists, so no BUILD directive names a directory that is not there.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/prepare-worktree.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/merge-unconfirmed.test.ts tests/scenarios/audit.test.ts tests/scenarios/narration-quote.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Attempt evidence
Attempt 1. RED at 254462f (`tests/scenarios/prepare-worktree.test.ts`, 3 of 4 failed on main's code: acceptance 1 got state `BUILD`, acceptance 2 and 3 got `build`; acceptance 4 passed, as a guard on unchanged behaviour should). The bug showed live when this goal started: the first `card next` returned `prepare` action `start` with the run already stored as `BUILD` at D:\wt\AIDLC\T0-PREPARE-WORKTREE.

| Item | Proof | Result |
|---|---|---|
| 1 | prepare-worktree.test.ts, acceptance 1 test | pass |
| 2 | prepare-worktree.test.ts, acceptance 2 test | pass |
| 3 | prepare-worktree.test.ts, the four acceptance 3 tests (stored BUILD, REVIEW_FIX and SHIP with no directory; a regular file at the recorded path; a path under a regular file; an attached worktree deleted while git registers it, prunable or locked; a failed probe of an existing directory) | pass |
| 4 | prepare-worktree.test.ts, acceptance 4 test | pass |
| 5 | fault-points.test.ts in the DoD; the PREPARE start write is named under Not covered in .claude/skills/verify-card-run-writes/SKILL.md; the sync commit moves at CLOSE | pass; sync commit open until CLOSE |
| 6 | docs/OPERATIONS.md paragraph after the T0 bugfix walk-through; CHANGELOG Unreleased entry | reviewer-verified |
| 7 | merge-unconfirmed.test.ts (`shipped`), audit.test.ts (`shipWithFacts`) and narration-quote.test.ts (acceptance 1 test) in the DoD; each diff adds one `mkdirSync` of the recorded worktree before the github `card next` and changes no assertion | pass (51 of 51) |

The full suite at the first candidate (685be31) failed 23 of 2990 tests, all in those three files: each built the run on the dry-run ship path, which records `wt/T1-...` and makes no directory, then ran `card next` on the github ship path, where R2 sends the run back to PREPARE. The card was amended on main (38e97ec, R5 and acceptance 7) before the fixtures were changed.

Attempt 2 (repair of R3 decision 1, F1, class worktree-file-counts-as-prepared). `prepared` used `existsSync`, which is true for a regular file. It now uses `isDirectory` (card-runner.ts, `statSync(p).isDirectory()` with any stat error read as false). The new acceptance 3 test failed on candidate 123855d (a file at the recorded path got `build`) and passes with the repair. Input forms of `isDirectory`, each with its test:
- an existing directory: acceptance 2 (`build` after `git worktree add`);
- a missing path: acceptance 1 and the first acceptance 3 test;
- a regular file: second acceptance 3 test, form "a regular file";
- a stat that throws (ENOTDIR or ENOENT for a path under a file): second acceptance 3 test, form "a path under a regular file";
- a link or junction to a directory: `statSync` follows it, so it counts as a directory; no test, since the card's fixtures make no links;
- a denied stat (EACCES): the same catch as the path under a file; no portable test.
The dry-run bypass is unchanged: acceptance 4.

Class sweep of `existsSync(run.worktree)` in card-runner.ts: `prepared` (the only site that decides a state) is fixed. `reviewCheckout` and the candidate read in `recordAttempt` keep `existsSync`: neither decides the card state, both predate this card, and no requirement of this card changes them; with a file at the path the loop now selects PREPARE before it directs a review or a BUILD.

Readers of `run.worktree` (diagnosis.same_class):
- Ship path: covered by R2. `CardRunner.ship` passes no worktree path to the ship path (the github adapter finds the worktree by card id), and SHIP is selected only when `prepared`, which now requires the directory.
- `card close --cleanup` and `--all`: not affected. They run in CLOSE, which precedes PREPARE, so a merged run whose worktree the cleanup removed goes to CLOSE or DONE as before; `reclaimWorktree` reads `git worktree list`, not `run.worktree`.
- `reviewCheckout` (card-runner.ts) and `card mutants` (cli/main.ts): not affected; both already check that the directory exists.
- Board `outcomeOf` (state/board.ts): not affected; a run in PREPARE with no worktree path maps to `todo`, the outcome it had before its first `card next`, and the goal dispatches the same card again.
- A git worktree entry whose directory is gone: corrected at attempt 3. The note above said `decideWorktree` decides `attach`; it does not: it probes the common directory inside the missing directory and returns a tool stop, which R3 decision 3 found.

Attempt 3 (repair of the second R3 pass on 2f50b22, class missing-worktree-stops). Under R2 a run whose attached worktree was deleted while git kept its registration went to PREPARE, where `decideWorktree`'s common-directory probe failed in the missing directory and recorded a final `tool` stop. `CardRunner.prepare` now asks, only when `decideWorktree` returns a tool stop, whether git lists the card branch's worktree at the expected path, marked `prunable` or `locked`, with no directory there (`registeredWithoutDirectory`); if so the run stays in PREPARE with no path and a `prepare` `start` that names `git worktree prune` (and `git worktree unlock` for a locked one), so `card next` repeats it until the worktree is made. `decideWorktree` is unchanged (non-goal). The new test failed on 2f50b22 (`stop`) and passes with the repair. Input forms of `registeredWithoutDirectory`, each with its test:
- the worktree listing fails: the tool stop stands; t0-flow.test.ts T0-PROBE-STOP-TEXT, case T1-PROBE;
- an entry at another path (mismatch): `decideWorktree` returns an ownership stop first, so the helper is not called; t0-flow.test.ts T0-PROBE-STOP-TEXT ownership test;
- an entry with neither mark and no directory: the tool stop stands; T0-PROBE-STOP-TEXT, case T1-COMMON;
- a prunable entry with no directory: retryable `start`; acceptance 3, form "prunable", real repository;
- a locked entry with no directory (git never marks a locked entry prunable): retryable `start` naming `git worktree unlock`; acceptance 3, form "locked", real repository;
- a marked entry whose directory exists: the tool stop stands; acceptance 3, failed probe of an existing directory (scripted git).
The check before BUILD reads the directory only; a directory at the recorded path that is not the card's worktree counts as prepared, as the card's hygiene line (no git probe on every `card next`) sets; docs/OPERATIONS.md states it.

Attempt 4 (CI red on PR 250, run 42760326602, `check (windows-latest, 22)`; attempt 3 counted as failed). Acceptance 2 and the prunable-or-locked acceptance 3 test stopped with "worktree ...\wt\T1-HELLO belongs to a different repository": the runner's temp directory is an 8.3 short path (RUNNER~1), and `setup` passed the fixture's non-canonical main root, so git resolved the main checkout's common directory to the short spelling and the worktree's to the long one. Test fixture defect only (a real run's main root comes from git, canonical); lesson 2026-11-09 T1-BOARD-WATCH-2 names it. Reproduced locally with TMP set to an 8.3 path (C:\Users\Admin\AppData\Local\Temp\AIDLCS~1): the same 2 tests failed with the same message. `setup` now gives the runner `realpathSync.native(fx.tmp)` as main root; 7 of 7 pass under the short and the normal temp directory. No source change.
