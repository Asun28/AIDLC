---
id: T0-CLOSE-CLEANUP-2
title: `aidlc card close` removes the worktree of a merged card and writes its status, so the cleanup and metadata flags report work that was done
status: merged
branch: T0-CLOSE-CLEANUP-2
worktree: D:\wt\AIDLC\T0-CLOSE-CLEANUP-2
allow_paths:
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - src/probes/git.ts
  - src/artifacts/card.ts
  - src/artifacts/frontmatter.ts
  - tests/scenarios/card-close-cleanup.test.ts
  - tests/scenarios/lesson-dup.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - .claude/skills/aidlc-loop/card-loop.md
  - templates/claude/skills/aidlc-loop/card-loop.md
  - CHANGELOG.md
  - specs/tasks/T0-CLOSE-CLEANUP-2.md
dod_command: npm run typecheck && node --test tests/scenarios/card-close-cleanup.test.ts tests/scenarios/lesson-dup.test.ts tests/scenarios/card-goal.test.ts tests/scenarios/fault-points.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/command-lines.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc card close <id>` with `--cleanup` or `--all`, on a CLOSE run with its merge verified, shall copy every regular file directly under `<worktree>/.review/` to `<evidence>/<goal>/review/<card>/` under its own name, read each copy back and compare it with its source, and only then remove the worktree of the card with `git worktree remove` without `--force`, leaving the branch. The copies stay outside the manifest, which never held these files, so the step neither reads nor writes `manifest.json`.
  - R2. When the copy, the comparison or the removal fails, `closure.cleanup` shall be false, also when an earlier call recorded it true, the worktree shall stay, the other requested flags shall be recorded, and the command shall exit nonzero with a message that names the cause; the same command run again after the cause is fixed shall complete the step. A failed step shall lower its flag before the journal write, so a journal write that fails too leaves no earlier true behind, raises no other flag, and the message names both causes.
  - R3. A card whose branch has no worktree and whose expected path does not exist shall record `closure.cleanup` true and remove nothing, so a repeat of the command, and a retry after a crash between the removal and the record, succeeds.
  - R4. A worktree of the branch whose real path is not the real path of the expected one, a path that differs only by case on a case-sensitive filesystem included, or a path at the expected place that git does not list for the branch, shall be refused under R2 and left in place.
  - R5. `aidlc card close <id>` with `--metadata` or `--all` shall set the `status` value of the card file in the main checkout, read as `scalar` reads it through one definition of the line and the value (spaces before the colon and whitespace `scalar` trims around the value included), to `merged` and change no other byte of the file; a file that already says `merged` is not written, and a missing file fails under R2 for `closure.metadata`, which is false after it, also when an earlier call recorded it true. A card file in neither card directory stops every `card` command at load, before any step runs, so `card close` then leaves the flags as recorded until the file is back and the step runs again. The command commits nothing.
  - R6. With `shipPath: dry-run` neither step shall run git or write a file, as PREPARE already treats that path.
  - R7. The `card close` description, the close directive, `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and both copies of `card-loop.md` shall state that these two steps are performed by the command that the session commits the card file on main, and that `--cleanup` and `--all` come after the doc_sync, findings and evidence steps, because they remove the worktree that holds `.review/`; the CHANGELOG Unreleased section shall have an entry naming this card.
acceptance:
  - 1. `tests/scenarios/card-close-cleanup.test.ts`, in a real temporary git repository with a linked worktree holding `.review/a.json`: `markClosure` with `cleanup` leaves no entry in `git worktree list` and no directory, the branch resolves, `<evidence>/<goal>/review/<card>/a.json` holds the bytes of the file, a file in a subdirectory of `.review/` is not copied, and `closure.cleanup` is true. [R1] [dod arm 2]
  - 2. Same file: a modified tracked file and, in a second test, an untracked file: `markClosure` with `cleanup` and `docSync` throws a message holding git's refusal, `closure.cleanup` is false, `closure.docSync` is true, the file is in place, and a second call after the file is restored or removed completes. [R2] [dod arm 2]
  - 3. Same file: a file at the path of the copy directory makes the copy fail: the worktree stays, `closure.cleanup` is false, and a wrapped runner records no `worktree remove`. A sealed manifest does not fail the step, and `manifest.json` is unchanged by it. [R1] [R2] [dod arm 2]
  - 4. Same file: no worktree for the branch: `closure.cleanup` is true, and a wrapped runner records no `worktree remove`. A second call also succeeds. [R3] [dod arm 2]
  - 5. Same file: the branch checked out at another path: refused, the worktree in place, `closure.cleanup` false. [R4] [dod arm 2]
  - 6. Same file: a card file with CRLF line ends and a comment after the status value keeps every other byte under `metadata`; a file already `merged` keeps its mtime; a missing file leaves `closure.metadata` false and the call throws naming the path. [R5] [dod arm 2]
  - 7. Same file: `shipPath: dry-run`: a wrapped runner records no git call and the card file is unchanged; `tests/scenarios/lesson-dup.test.ts` and `tests/scenarios/card-goal.test.ts` pass with no assertion changed apart from a close directive sentence R7 changes. [R6] [R7] [dod arm 2]
  - 8. Same file: `docs/OPERATIONS.md` and `docs/ARCHITECTURE.md` hold the sentence of the Doc text section, both copies of `card-loop.md` name `aidlc evidence retain` before `card close --all` and stay within the cap of `tests/surface/templates.test.ts`, the close directive holds the order, `docs/OPERATIONS.md` states the limit of R5 and its recovery, and the CHANGELOG entry is read. [R7] [dod arm 2]
  - 9. Same file: a detached checkout at the expected path is refused, the directory in place, `closure.cleanup` false. A card file with `status : todo` becomes `status : merged`. A card file with a nonbreaking space before `todo` becomes `merged` with that space kept, and one with a nonbreaking space before `merged` is not written. [R4] [R5] [dod arm 2]
  - 10. Same file, on a case-sensitive filesystem and skipped elsewhere: the branch at `WT/<card>` with the root configured as `wt`: refused, the worktree in place, `closure.cleanup` false. [R4] [dod arm 2]
  - 11. Same file: `metadata` recorded true by a first call, then the card file removed: a second call with `metadata` throws and `closure.metadata` is false; the same for `cleanup` with a path at the expected place that git does not list. [R2] [R5] [dod arm 2]
  - 12. Same file, with two file names that differ beyond case: a symbolic link in the copy directory joins their two destinations, and the two files of `.review/` have different contents: the call throws, the worktree and both files are in place, and `closure.cleanup` is false. The test skips only when creating the link fails with `EPERM`, `EACCES`, `ENOTSUP` or `ENOSYS`, and any other error fails it. [R1] [R2] [dod arm 2]
  - 13. Same file: every closure flag recorded and the worktree removed by the step: `next` returns `done`. [R1] [dod arm 2]
  - 14. Same file: `cleanup` recorded true by a first call, then a second call with `cleanup` and `docSync` where the step fails and the journal append throws: `closure.cleanup` is false in the stored run, `closure.docSync` stays false, and the message names both causes. [R2] [dod arm 2]
depends_on: []
budget: 650
tdd: true
sweep: "Checked on main at bbbdb10. `markClosure` (src/loop/card-runner.ts) sets the flags it is given and checks none of them. `card close --all` (src/cli/main.ts) passes cleanup true. No code in src removes a card worktree. All three merged cards with a live worktree record cleanup true: T0-CI-RERUN-STRUCTURED-2, T0-R2-OFF, T0-R3-STOP-DISPUTED. `.review/` sits inside the worktree, so removing the worktree without a copy loses the verdicts and logs. `git worktree remove` refuses modified and untracked files and passes ignored ones, so `.review/` and `node_modules` do not block it. `card-loop.md` is 6481 bytes under a cap of 6500. `tests/scenarios/lesson-dup.test.ts:91` pins the whole close sentence."
forbid:
  - passing `--force` to `git worktree remove`
  - deleting a local or remote branch
  - committing or pushing from the command
  - changing the meaning of `--evidence`, `--doc-sync` or `--findings`, or the lesson step
  - weakening or skipping a test to go green
non_goals:
  - worktrees of superseded cards and cancelled goals, which T0-WORKTREE-RECLAIM takes next
  - a commit or push of the status from the CLI
  - a new status value for superseded or cancelled cards
  - removing the leftover worktrees that exist today
  - running `card close` for a card file in neither card directory, which stops at load like every `card` command; R5 states that limit and its recovery
hygiene: "This card replaces T0-CLOSE-CLEANUP by the user's ruling `1` of 2026-11-07, after R3 decision 4 stopped that card with one finding, collision-test-false-skip, in acceptance 12. It carries that branch at 937fa2d, changes acceptance 12 and renames the card in the test titles, the CHANGELOG entry and docs/OPERATIONS.md, with no production code change. T0-CLOSE-CLEANUP never merged, so those texts name this card alone. R3 decision 1 on this card raised F1 status-key-parser-mismatch, the second raise of that class, and F2 and F3 close-before-retain: `withCardStatus` now reads the value through the function `scalar` reads it with, so no second regex remains, and the close text puts the removal last. R3 decision 2 raised F4 metadata-load-before-reset and F5 journal-before-save: F5 is R2 and acceptance 14; F4 is disputed and stated as the limit of R5, because reaching the step without a card file means running `card close` without its card, for a state in which no `card` command works, and restoring the file and running the step again already gives the right flag. Who the steps hold against: an accident and a session in another window, through the lease fence and git refusing a dirty worktree. They do not hold against the author of the candidate, who already writes the whole worktree: a symlink at .review/ copies local files into the local, gitignored evidence tree and no further. Requested by the user on 2026-11-07: a worktree should be cleaned after a card is merged, and the status updated. The commit stays with the session because the main checkout is shared by several sessions and a downstream base can refuse a direct push; the same split as `--lesson`, which writes docs/LESSONS.md and leaves the commit."
---

# T0-CLOSE-CLEANUP-2

## Why

`aidlc card close --all` records `cleanup` and `metadata` as true and does neither. Nothing in `src/` removes a card worktree, so 3 merged cards hold a worktree on disk while their run records say `cleanup: true`, and the status of every merged card is a hand edit.

## Design

`markClosure` keeps its checks (live goal, CLOSE run, verified merge, fenced lease) and runs the two steps before it computes the closure, in this order, so a retry after a crash finds the step done:

1. `cleanup`: find the worktree with `GitProbe.findWorktree`; nothing there means done, and a path there that git does not list for the branch fails. A mismatch fails, and so does a real path other than the real path of the expected one, because `findWorktree` folds case. Copy the files of `.review/` to `<evidence>/<goal>/review/<card>/` with their names, read each copy back against its source, then `git worktree remove <path>`. The read-back is what holds when two names that the worktree keeps apart reach one file, whatever folds them (case, Unicode form, `AIDLC_STATE_DIR` on another filesystem), so no rule about names is needed. The copies stay outside `manifest.json`: R3 decisions 1 and 2 raised four findings on that shared file (lock, path collisions, concurrent writers), and the card needs none of what it provides.
2. `metadata`: rewrite the status value in `<mainRoot>/<cardsDir>/<id>.md`.

A failed step sets its flag to false and its message goes into the journal event; `markClosure` saves the run and then throws that message, so the other flags stay recorded and the command exits nonzero.

## Doc text

The sentence for the docs of R7: `card close --cleanup` and `--metadata` do the step and record it: cleanup copies `.review/` into the evidence tree and removes the worktree, metadata writes `status: merged` in the main checkout, and the session commits that file on main.

The order, for `docs/OPERATIONS.md` and the close directive: run `--cleanup` or `--all` after the doc_sync, findings and evidence steps, because it removes the worktree that holds `.review/`.

The limit, for `docs/OPERATIONS.md`: a card file in neither card directory stops `card close` at load, like every `card` command, so no step runs and the flags stay as recorded; restore the file and run the step again.
