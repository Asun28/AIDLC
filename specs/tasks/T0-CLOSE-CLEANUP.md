---
id: T0-CLOSE-CLEANUP
title: `aidlc card close` removes the worktree of a merged card and writes its status, so the cleanup and metadata flags report work that was done
status: todo
branch: T0-CLOSE-CLEANUP
worktree: D:\wt\AIDLC\T0-CLOSE-CLEANUP
allow_paths:
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - src/probes/git.ts
  - src/artifacts/card.ts
  - src/audit/manifest.ts
  - tests/scenarios/card-close-cleanup.test.ts
  - tests/scenarios/lesson-dup.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - .claude/skills/aidlc-loop/card-loop.md
  - templates/claude/skills/aidlc-loop/card-loop.md
  - CHANGELOG.md
  - specs/tasks/T0-CLOSE-CLEANUP.md
dod_command: npm run typecheck && node --test tests/scenarios/card-close-cleanup.test.ts tests/scenarios/lesson-dup.test.ts tests/scenarios/card-goal.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/audit.test.ts tests/surface/manifest.test.ts tests/surface/verifier.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/command-lines.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc card close <id>` with `--cleanup` or `--all`, on a CLOSE run with its merge verified, shall copy every regular file directly under `<worktree>/.review/` into the evidence tree of the goal, and only then remove the worktree of the card with `git worktree remove` without `--force`, leaving the branch.
  - R1a. `EvidenceStore.retain` and `EvidenceStore.seal` shall read the manifest and write it under one exclusive lock on the manifest file, so a writer holding an older copy keeps the entries another writer recorded. `retain` shall refuse an id whose evidence path another entry holds, before it writes the file.
  - R2. When the copy or the removal fails, `closure.cleanup` shall stay false, the worktree shall stay, the other requested flags shall be recorded, and the command shall exit nonzero with a message that names the cause; the same command run again after the cause is fixed shall complete the step.
  - R3. A card whose branch has no worktree and whose expected path does not exist shall record `closure.cleanup` true and remove nothing, so a repeat of the command, and a retry after a crash between the removal and the record, succeeds.
  - R4. A worktree of the branch at a path other than the expected one, or a path at the expected place that git does not list for the branch, shall be refused under R2 and left in place.
  - R5. `aidlc card close <id>` with `--metadata` or `--all` shall set the `status` value of the card file in the main checkout, read as `scalar` reads the key (spaces before the colon included), to `merged` and change no other byte of the file; a file that already says `merged` is not written, and a missing file fails under R2 for `closure.metadata`. The command commits nothing.
  - R6. With `shipPath: dry-run` neither step shall run git or write a file, as PREPARE already treats that path.
  - R7. The `card close` description, the close directive, `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and both copies of `card-loop.md` shall state that these two steps are performed by the command and that the session commits the card file on main; the CHANGELOG Unreleased section shall have an entry naming this card.
acceptance:
  - 1. `tests/scenarios/card-close-cleanup.test.ts`, in a real temporary git repository with a linked worktree holding `.review/a.json`: `markClosure` with `cleanup` leaves no entry in `git worktree list` and no directory, the branch resolves, the evidence tree holds the bytes of `a.json` under a manifest entry with id `<card>.a.json`, and `closure.cleanup` is true. [R1] [dod arm 2]
  - 2. Same file: a modified tracked file and, in a second test, an untracked file: `markClosure` with `cleanup` and `docSync` throws a message holding git's refusal, `closure.cleanup` is false, `closure.docSync` is true, the file is in place, and a second call after the file is restored or removed completes. [R2] [dod arm 2]
  - 3. Same file: a sealed manifest makes the copy fail: the worktree stays, `closure.cleanup` is false, and the message holds the seal refusal. [R1] [R2] [dod arm 2]
  - 4. Same file: no worktree for the branch: `closure.cleanup` is true, and a wrapped runner records no `worktree remove`. A second call also succeeds. [R3] [dod arm 2]
  - 5. Same file: the branch checked out at another path: refused, the worktree in place, `closure.cleanup` false. [R4] [dod arm 2]
  - 6. Same file: a card file with CRLF line ends and a comment after the status value keeps every other byte under `metadata`; a file already `merged` keeps its mtime; a missing file leaves `closure.metadata` false and the call throws naming the path. [R5] [dod arm 2]
  - 7. Same file: `shipPath: dry-run`: a wrapped runner records no git call and the card file is unchanged; `tests/scenarios/lesson-dup.test.ts` and `tests/scenarios/card-goal.test.ts` pass with no assertion changed apart from a close directive sentence R7 changes. [R6] [R7] [dod arm 2]
  - 8. Same file: `docs/OPERATIONS.md` and `docs/ARCHITECTURE.md` hold the sentence of the Doc text section, both copies of `card-loop.md` hold `card close --all` and stay within the cap of `tests/surface/templates.test.ts`, and the CHANGELOG entry is read. [R7] [dod arm 2]
  - 9. Same file: two files of `.review/` whose names map to one evidence path (`a b.json`, `a_b.json`) with different contents: the call throws, `closure.cleanup` is false, the worktree and both files are in place, and the copy on the evidence tree still holds the bytes of the first. [R1a] [R2] [dod arm 2]
  - 10. Same file: two stores load one manifest and each retains from its own copy: both entries are on disk. A seal from an older copy keeps the entry recorded after that copy was read. [R1a] [dod arm 2]
  - 11. Same file: a detached checkout at the expected path is refused, the directory in place, `closure.cleanup` false. A card file with `status : todo` becomes `status : merged`. [R4] [R5] [dod arm 2]
depends_on: []
budget: 500
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
hygiene: "Who the steps hold against: an accident and a session in another window, through the lease fence and git refusing a dirty worktree. They do not hold against the author of the candidate, who already writes the whole worktree: a symlink at .review/ copies local files into the local, gitignored evidence tree and no further. Requested by the user on 2026-11-07: a worktree should be cleaned after a card is merged, and the status updated. The commit stays with the session because the main checkout is shared by several sessions and a downstream base can refuse a direct push; the same split as `--lesson`, which writes docs/LESSONS.md and leaves the commit."
---

# T0-CLOSE-CLEANUP

## Why

`aidlc card close --all` records `cleanup` and `metadata` as true and does neither. Nothing in `src/` removes a card worktree, so 3 merged cards hold a worktree on disk while their run records say `cleanup: true`, and the status of every merged card is a hand edit.

## Design

`markClosure` keeps its checks (live goal, CLOSE run, verified merge, fenced lease) and runs the two steps before it computes the closure, in this order, so a retry after a crash finds the step done:

1. `cleanup`: find the worktree with `GitProbe.findWorktree`; none means done. A mismatch fails. Copy the files of `.review/` with `EvidenceStore.retain` (kind `artifact`, id `<card>.<file name>`, so no file of `.review/` can take the path of `manifest.json`), then `git worktree remove <path>`.
   `EvidenceStore.retain` and `seal` run under `updateJson` on `manifest.json`, the file lock the lease and card-run records use, which also covers `aidlc evidence retain` and `aidlc audit seal`. The lock timeout is its default 2 s; a timeout is a failed step under R2.
2. `metadata`: rewrite the status value in `<mainRoot>/<cardsDir>/<id>.md`.

A failed step leaves its flag out of the closure and its message goes into the journal event; `markClosure` saves the run and then throws that message, so the other flags stay recorded and the command exits nonzero.

## Doc text

The sentence for the docs of R7: `card close --cleanup` and `--metadata` do the step and record it: cleanup copies `.review/` into the evidence tree and removes the worktree, metadata writes `status: merged` in the main checkout, and the session commits that file on main.
