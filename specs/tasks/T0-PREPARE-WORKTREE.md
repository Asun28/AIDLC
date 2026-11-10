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
  - .claude/skills/verify-card-run-writes/SKILL.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-PREPARE-WORKTREE.md
dod_command: npm run typecheck && node --test tests/scenarios/prepare-worktree.test.ts tests/scenarios/fault-points.test.ts
dod_exit: 0
requirements:
  - R1. WHEN PREPARE decides `start` (no worktree for the card branch), the run shall stay in PREPARE and record no worktree path; the directive is the `prepare` directive with action `start`, as before this card.
  - R2. The `prepared` evidence of the card machine shall be true only when the run records a worktree path, that directory exists, and this session holds the card lease. A run in BUILD, REVIEW_FIX or SHIP whose recorded worktree directory does not exist shall get PREPARE.
  - R3. With `shipPath: dry-run`, which creates no worktree, `prepared` shall be what it is before this card.
  - R4. `docs/OPERATIONS.md` (the card loop, PREPARE) and the CHANGELOG Unreleased section shall state R1 to R3.
acceptance:
  - 1. `tests/scenarios/prepare-worktree.test.ts`, on the github ship path with a real temporary repository: a card's first `card next` returns `prepare` with action `start`, and a second `card next` without creating the worktree returns `prepare` with action `start` again, not `build`. Fails before the fix. [R1] [R2] [dod arm 1]
  - 2. Same file: after `git worktree add` of the card branch at the directive's path, `card next` returns `prepare` with action `attach`, then `build`. [R1] [R2] [dod arm 1]
  - 3. Same file: a run stored in BUILD with a recorded worktree path that does not exist gets `prepare` with action `start`. Fails before the fix. [R2] [dod arm 1]
  - 4. Same file: with `shipPath: dry-run` the directives of a first and second `card next` are those before this card. [R3] [dod arm 1]
  - 5. `tests/scenarios/fault-points.test.ts` passes; the PREPARE write is in its covered commands or recorded in the verify skill's coverage record, and the sync commit moves at CLOSE on main. [R1] [dod arm 2]
  - 6. The docs and CHANGELOG state R1 to R3 (reviewer-verified against the diff). [R4]
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
npm run typecheck && node --test tests/scenarios/prepare-worktree.test.ts tests/scenarios/fault-points.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Attempt evidence
Attempt 1. RED at 254462f (`tests/scenarios/prepare-worktree.test.ts`, 3 of 4 failed on main's code: acceptance 1 got state `BUILD`, acceptance 2 and 3 got `build`; acceptance 4 passed, as a guard on unchanged behaviour should). The bug showed live when this goal started: the first `card next` returned `prepare` action `start` with the run already stored as `BUILD` at D:\wt\AIDLC\T0-PREPARE-WORKTREE.

| Item | Proof | Result |
|---|---|---|
| 1 | prepare-worktree.test.ts, acceptance 1 test | pass |
| 2 | prepare-worktree.test.ts, acceptance 2 test | pass |
| 3 | prepare-worktree.test.ts, acceptance 3 test (stored BUILD, REVIEW_FIX and SHIP) | pass |
| 4 | prepare-worktree.test.ts, acceptance 4 test | pass |
| 5 | fault-points.test.ts in the DoD; the PREPARE start write is named under Not covered in .claude/skills/verify-card-run-writes/SKILL.md; the sync commit moves at CLOSE | pass; sync commit open until CLOSE |
| 6 | docs/OPERATIONS.md paragraph after the T0 bugfix walk-through; CHANGELOG Unreleased entry | reviewer-verified |

Readers of `run.worktree` (diagnosis.same_class):
- Ship path: covered by R2. `CardRunner.ship` passes no worktree path to the ship path (the github adapter finds the worktree by card id), and SHIP is selected only when `prepared`, which now requires the directory.
- `card close --cleanup` and `--all`: not affected. They run in CLOSE, which precedes PREPARE, so a merged run whose worktree the cleanup removed goes to CLOSE or DONE as before; `reclaimWorktree` reads `git worktree list`, not `run.worktree`.
- `reviewCheckout` (card-runner.ts) and `card mutants` (cli/main.ts): not affected; both already check that the directory exists.
- Board `outcomeOf` (state/board.ts): not affected; a run in PREPARE with no worktree path maps to `todo`, the outcome it had before its first `card next`, and the goal dispatches the same card again.
- A git worktree entry whose directory is gone: `decideWorktree` decides `attach` (its decision is a non-goal), the run is saved in BUILD with that path, and the next `card next` gets `prepare` again under R2, so no `build` names the missing directory.
