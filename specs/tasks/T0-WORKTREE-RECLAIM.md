---
id: T0-WORKTREE-RECLAIM
title: `aidlc worktree reclaim` removes the clean worktrees of finished cards, and `card close` and `goal cancel` run it
status: todo
branch: T0-WORKTREE-RECLAIM
worktree: D:\wt\AIDLC\T0-WORKTREE-RECLAIM
allow_paths:
  - src/loop/worktree-reclaim.ts
  - src/loop/card-runner.ts
  - src/probes/git.ts
  - src/cli/main.ts
  - tests/scenarios/worktree-reclaim.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-WORKTREE-RECLAIM.md
dod_command: npm run typecheck && node --test tests/scenarios/worktree-reclaim.test.ts tests/scenarios/card-close-cleanup.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/card-goal.test.ts tests/infra/worktree.test.ts tests/surface/command-lines.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc worktree reclaim` shall report one row for each linked worktree of the repository, with the card, the path, an action of `removed`, `would remove`, `skipped` or `failed`, and a reason; with `--dry-run` it shall copy and remove nothing.
  - R2. A worktree shall be a candidate only when its real path is `<worktree root>/<branch>`, the branch is a card with a file in the cards or archive directory, every goal holding a run of the card is terminal, and the card is finished, meaning `status: merged`, a DONE run in its latest goal, a `superseded_by`, or a latest goal stopped with reason `cancelled`; any other worktree shall be skipped with a reason that names which condition failed.
  - R3. A candidate shall be skipped when another session holds a live lease on the card, when a goal holding a run of the card has an unresolved operation for it, when the worktree is locked, when git reports a modified or untracked file, when an ignored path exists other than `.review/`, `node_modules/` and `dist/`, or when `.review/` holds anything but regular files directly under it, because `git worktree remove` deletes ignored files without asking, and that probe shall not depend on a git setting; the reason shall name the paths or the holder.
  - R4. A candidate that passes shall have the files of `.review/` copied and read back through the code the cleanup step of `card close` uses, into `<evidence>/<latest goal>/review/<card>/`, and shall then be removed with `git worktree remove` without `--force`, leaving the branch.
  - R5. A failure on one worktree shall be a `failed` row naming the cause and the sweep shall go on to the next worktree; `aidlc worktree reclaim` shall exit nonzero when a row failed and zero when rows were only skipped.
  - R6. `card close` with `--cleanup` or `--all`, whether it succeeded or not, and `goal cancel`, shall run the sweep after their own work and write its `removed` and `failed` rows to stderr, best effort; a sweep that throws, a row that failed, or a stderr that cannot be written shall change neither the stdout nor the exit code nor the error of the command.
  - R7. With `shipPath: dry-run`, or outside a git repository, the sweep shall run no git and report no row, as that path treats the cleanup step.
  - R8. `docs/OPERATIONS.md` and `docs/ARCHITECTURE.md` shall state the command and the two commands that run it, `docs/OPERATIONS.md` shall state the rule on ignored paths and the limit of the Doc text section, and the CHANGELOG Unreleased section shall have an entry naming this card.
acceptance:
  - 1. `tests/scenarios/worktree-reclaim.test.ts`, in a real temporary git repository with a linked worktree holding `.review/a.json`: a superseded card in a terminal goal: the row says `removed`, no entry in `git worktree list`, no directory, the branch resolves, and `<evidence>/<goal>/review/<card>/a.json` holds the bytes of the file. [R1] [R2] [R4] [dod arm 2]
  - 2. Same file: a `status: merged` card, a card with a DONE run in its latest goal, and a card whose latest goal was cancelled are each removed. [R2] [dod arm 2]
  - 3. Same file: each of these is skipped with its reason and stays in place: a goal that is not terminal, in both a card's only goal and an older goal of it; a card stopped for a ruling with no cancel and no successor; no card file; no run; a detached worktree; a worktree at a path that is not `<root>/<branch>`. The main checkout has no row. [R1] [R2] [dod arm 2]
  - 4. Same file: each of these is skipped with its reason and stays in place: a live lease of another session; an unresolved operation; a locked worktree; a modified tracked file; an untracked file; an ignored `_local/` directory, named in the reason, with and without `status.showUntrackedFiles=no` in the git config; a directory inside `.review/`. A released lease, an expired lease and a live lease of this session do not block, because a session that cancels its own goal holds one. [R3] [dod arm 2]
  - 5. Same file: a card with runs in two goals keeps its copies under the latest goal. [R4] [dod arm 2]
  - 6. Same file, by the CLI with `AIDLC_STATE_DIR` set: `worktree reclaim --dry-run --json` prints a `would remove` row, and the worktree, the evidence tree and the card files are unchanged. [R1] [dod arm 2]
  - 7. Same file: a copy that fails on one worktree gives a `failed` row, leaves that worktree in place, and the next worktree is removed; by the CLI the command exits nonzero. With rows that are only skipped it exits zero. [R5] [dod arm 2]
  - 8. Same file, by the CLI: `goal cancel` removes the worktree of the goal's card and writes the row to stderr. A `card close --all` on a github run removes a finished card's worktree beside its own, and one that fails its evidence check keeps its error and exit code and still removes the finished worktree. With a state that makes the sweep throw, each command's exit code and its whole stdout equal those of the same command on the dry-run path, which runs no sweep, with goal ids, times and the temporary path normalized. With its stderr closed `goal cancel` exits zero and the sweep has run. [R6] [dod arm 2]
  - 9. Same file: `card close` without `--cleanup` or `--all` runs no sweep. [R6] [dod arm 2]
  - 10. Same file: `shipPath: dry-run`, and a repository identity that is not git: a wrapped runner records no git call and the sweep returns no row. [R7] [dod arm 2]
  - 11. Same file: after a removal, `decideWorktree` on the cancelled card returns `start` with the expected path, and the branch keeps its commit. [R4] [dod arm 2]
  - 12. Same file: `docs/OPERATIONS.md` and `docs/ARCHITECTURE.md` hold the sentence of the Doc text section, `docs/OPERATIONS.md` holds its limit sentence, and the CHANGELOG entry is read. [R8] [dod arm 2]
depends_on: []
budget: 450
tdd: true
sweep: "Checked on main at 1c8f6ea. Of 15 linked worktrees, 11 are finished and clean: T0-CI-RERUN-STRUCTURED, T0-CI-RERUN-STRUCTURED-2, T0-CLOSE-CLEANUP, T1-REVIEW-BENCH, T1-REVIEW-BENCH-EXPORT, T1-REVIEW-BENCH-EXPORT-2, T1-RUN-DRIVER, T1-RUN-DRIVER-2, T1-RUN-DRIVER-3, T1-VERIFY-MUTANT-GEN, T1-VERIFY-MUTANT-GEN-2. T0-INTAKE-TARGET, T0-LESSONS-TEST-RUN-ENV and T1-LESSON-MATCH are live, and `_precheck-crs` is detached and dirty. `git status --ignored` on the 11: every one holds `.review/` and `node_modules/`, eight hold `dist/`, and the three T1-RUN-DRIVER cards hold `_local/` with 18 to 21 build logs, which `git worktree remove` would delete and which is why R3 names ignored paths. No `.review/` holds a nested file. `goal cancel` in src/loop/controller.ts changes no run, so a cancelled goal leaves its runs in any state, and R2 reads the goal, not the run state. `decideWorktree` returns `start` when git lists no worktree for the branch. `CardRunner.reclaimWorktree` is the only code that copies `.review/`."
forbid:
  - passing `--force` to `git worktree remove`
  - deleting a local or remote branch
  - writing the card file, a card run, a goal or the manifest from the sweep
  - removing a worktree that is not a card worktree
  - failing `card close` or `goal cancel` because of the sweep
  - weakening or skipping a test to go green
non_goals:
  - a lock around the check and the removal; the hygiene note states the limit
  - a status value for superseded or cancelled cards
  - deleting branches of finished cards
  - changing what `card close --cleanup` removes, or adding the ignored path rule to it
  - a setting to turn the sweep off
hygiene: "R3 decision 1 raised F1 ignored-path-config-leak, F2 sweep-diagnostic-escape, F3 cleanup-sweep-skipped-on-error, F4 and F5 stdout-preservation-unproved. The locked worktree of R3 was found in the same review of the code: git refuses to remove one, which would have been a `failed` row on every sweep. Requested by the user on 2026-11-07: a worktree should be cleaned after a card is merged or cancelled. Who the sweep holds against: an accident and a session in another window, through the goal state, the lease and git refusing a modified worktree. It keeps every branch, so a removal is undone by `git worktree add`, and `goal resume` needs nothing else because PREPARE starts a worktree on the existing branch. Limit stated here rather than reached in review: no lock spans the check and the removal, because a stopped card often holds an expired lease that only a takeover could claim. A `goal resume` and `card next` in another session inside that window can lose a worktree they just attached; git refuses if it holds work, and otherwise `card next` starts it again on the branch. A clean worktree of a finished card that a person has open is removed; on Windows an open directory makes the removal fail, which is a `failed` row."
---

# T0-WORKTREE-RECLAIM

## Why

`card close --cleanup` covers a card that merges and closes. A card replaced by a successor or left in a cancelled goal never reaches that step, so 11 finished worktrees sit on disk today, each with its own `node_modules`, and every new one stays too.

## Design

`src/loop/worktree-reclaim.ts` holds the copy and removal, moved out of `CardRunner.reclaimWorktree`, and `sweepWorktrees`. The sweep reads the git worktree list, the card registry, every goal and its runs once, then decides each worktree in the order of R2 and R3, cheapest first, with git status last. `card close` and `goal cancel` call it from the CLI after their own result, so `markClosure` and the controller gain no git work and no new failure, and the two commands cover the three ways a card finishes: a merge, a replacement, a cancel.

Ignored paths are the reason clean is not enough: `git status` does not show them and `git worktree remove` deletes them. `.review/` is copied, and `node_modules/` and `dist/` are rebuilt by a command; anything else stops the removal and is named, so a person decides.

## Doc text

The sentence for `docs/OPERATIONS.md` and `docs/ARCHITECTURE.md`: `aidlc worktree reclaim` removes the clean worktrees of merged, superseded and cancelled cards, and `card close --cleanup`, `card close --all` and `goal cancel` run it; the branch stays and `.review/` goes to the evidence tree.

The limit, for `docs/OPERATIONS.md`: no lock spans the check and the removal, so a `goal resume` and `card next` in another session in that window can lose a clean worktree, and `card next` then starts it again on the branch.
