---
id: T0-BASE-SYNC-CHANGELOG-EDGES
title: The base-sync CHANGELOG merge reports its own failures precisely - a committed merge whose commit cannot be read back, a partial write, a failed listing, read or diff3 checkout - and resolves only entries and subsections (issue 60)
status: todo
branch: T0-BASE-SYNC-CHANGELOG-EDGES
worktree: D:\wt\AIDLC\T0-BASE-SYNC-CHANGELOG-EDGES
allow_paths:
  - src/delivery/github-ship.ts
  - src/delivery/ship.ts
  - src/loop/card-runner.ts
  - tests/infra/github-ship.test.ts
  - tests/infra/ship.test.ts
  - tests/scenarios/base-sync-committed.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-BASE-SYNC-CHANGELOG-EDGES.md
dod_command: npm run typecheck && node --test tests/infra/github-ship.test.ts tests/infra/ship.test.ts tests/scenarios/base-sync-committed.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the CHANGELOG.md merge of the base sync is committed but its commit cannot be read back (the `git rev-parse --verify HEAD` after the commit exits non-zero or prints nothing), the GitHub ship path shall return the new sentinel `[SHIP-BASE-SYNC-COMMITTED]` instead of `[SHIP-BASE-SYNC-FAIL]`, and its detail shall say the merge is committed and name the read's exit and stderr; `SENTINEL_MAP` shall classify it as `merge-failed`, and the card runner's merge-conflict repair shall tell the agent to check that the worktree HEAD is that merge, rerun the DoD on it and record it as the attempt, never to resolve every hunk. It never names a merge commit, so it is never `[SHIP-BASE-SYNC-MERGED]` (T0-BASE-SYNC-CHANGELOG R3 decision 1).
  - R2. WHEN writing the resolution, or restoring the file as the merge wrote it, fails, the detail shall say that CHANGELOG.md may be partly written and name `git checkout --conflict=diff3 -- CHANGELOG.md` as the way to write the conflict markers again from the index; the merge stays in progress and HEAD is unchanged, as before.
  - R3. WHEN listing the unmerged paths, reading CHANGELOG.md before the rewrite, `git checkout --conflict=diff3 -- CHANGELOG.md`, or reading the rewritten file fails, the ship path shall return `[SHIP-BASE-SYNC-FAIL]` naming the step and its error (the exit and stderr of git, the error code of the read), never `[SHIP-BASE-SYNC-CONFLICT]`; after a failed read of the rewritten file it first writes the file back as the merge wrote it, and the detail says whether that restore failed. `[SHIP-BASE-SYNC-CONFLICT]` stays for the conflicts the resolver does not take.
  - R4. `unionUnreleasedInsertions` shall resolve a hunk only when every non-blank line either side adds is an entry (a line starting `- `) or a `### ` subsection heading; any other line (prose, an indented continuation, a `* ` bullet, a heading of another level) leaves the whole file to the merge-conflicts skill.
  - R5. The write-failure tests shall make the write fail through a writer the ship path is given (`GitHubShipOptions.writeFile`, default `writeFileSync`), never through file modes, which do not stop root; read failures use a missing file and a directory, which fail for root too.
  - R6. `docs/OPERATIONS.md` (the base sync paragraph) and `CHANGELOG.md` shall state the changed rules and the limit. The limit, stated before the first review: a multi-line entry (an indented continuation line) or a `* ` bullet goes to the skill even when both sides only added it; the detail of a failed write cannot tell whether the file was truncated, so it names the recovery either way; a failure of `git add` or `git commit` keeps its `[SHIP-BASE-SYNC-FAIL]` as today.
acceptance:
  - 1. tests/infra/github-ship.test.ts and tests/infra/ship.test.ts - a commit read that exits non-zero, one that exits non-zero while printing a sha, and one that prints nothing each give `[SHIP-BASE-SYNC-COMMITTED]`, never MERGED, FAIL or CONFLICT, with a detail that says the merge is committed, names the worktree to read HEAD from and the exit and stderr of the read, and carries no merge sha; `classifyShipOutput` maps the sentinel to `merge-failed`. [R1] [dod arm 1]
  - 2. tests/scenarios/base-sync-committed.test.ts - through the card runner a `[SHIP-BASE-SYNC-COMMITTED]` ship returns the card to BUILD with the merge-conflict repair, the DoD and retained receipts cleared, and a narration that says to check that the worktree HEAD is the merge and record it, with no "resolve every hunk"; nothing treats it as merged: the candidate stays the shipped one, no merge operation succeeds, and neither the repair detail nor the narration carries a merge sha; `[SHIP-BASE-SYNC-MERGED]` and `[SHIP-BASE-SYNC-CONFLICT]` keep their narrations. [R1] [dod arm 1]
  - 3. tests/infra/github-ship.test.ts - a resolution write that throws, one that writes part of the text and then throws ENOSPC, and a restore write that throws each give `[SHIP-BASE-SYNC-FAIL]` whose detail says the file may be partly written and names `git checkout --conflict=diff3 -- CHANGELOG.md`, with nothing staged or committed. [R2] [R5] [dod arm 1]
  - 4. tests/infra/github-ship.test.ts - a failed unmerged listing, a missing CHANGELOG.md, a failed diff3 checkout, and a rewritten file that cannot be read (a directory) each give `[SHIP-BASE-SYNC-FAIL]` naming the step and its error, never `[SHIP-BASE-SYNC-CONFLICT]`, with nothing staged or committed; after the failed second read the file is written back as the merge wrote it, or the detail says that restore failed. [R3] [dod arm 1]
  - 5. tests/infra/github-ship.test.ts - the resolver keeps hunks of entries, `### ` headings and blank lines, and returns undefined for a hunk with a prose line, an indented continuation, a `* ` bullet or a `#### ` heading on either side. [R4] [dod arm 1]
  - 6. docs/OPERATIONS.md and CHANGELOG.md Unreleased carry the rules under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R6] [dod arm 1]
depends_on: [T0-BASE-SYNC-CHANGELOG-2]
budget: 480
tdd: true
sweep: "grep -n 'SHIP-BASE-SYNC' src/delivery/github-ship.ts: mergeChangelog returns undefined (so the caller's [SHIP-BASE-SYNC-CONFLICT]) on a failed listing, read or diff3 checkout; its write-failure details say the merge is in progress with its conflict or may carry the diff3 markers; a committed merge whose commit cannot be read back is [SHIP-BASE-SYNC-FAIL], which the runner narrates as resolve every hunk; unionUnreleasedInsertions takes any added line that is not a ## heading."
forbid: [weakening or skipping a test to go green, file modes in a test that must fail a write, a card-runner.ts change outside the step text of the base-sync merge-conflict repair (lines 2478-2481 before this card), a MERGED result that names no merge commit, a change to how any other ship outcome is classified]
non_goals: [conflicts in paths other than CHANGELOG.md, the base sync of the scaffold ship path, git add or git commit failures after the resolution is written, multi-line CHANGELOG entries]
diagnosis:
  root_cause: "mergeChangelog (src/delivery/github-ship.ts) returns undefined, so the caller's [SHIP-BASE-SYNC-CONFLICT] without the error, when the unmerged listing, a read of CHANGELOG.md or the diff3 checkout fails; its write-failure details assume the file kept its conflict or its diff3 markers, though a failed write can leave it truncated; a committed merge whose commit cannot be read back returns [SHIP-BASE-SYNC-FAIL], which the card runner narrates as 'resolve every hunk' although no conflict remains; unionUnreleasedInsertions accepts any added line but a ## heading; and the write-failure tests use chmod 0o444, which does not stop root (issue 60, the advisories of R2 cycle 1 and R3 decision 2 on T0-BASE-SYNC-CHANGELOG-2)."
  same_class: "Every failure return of mergeChangelog (listing, first read, diff3 checkout, second read, restore write, resolution write, commit read-back) and every line shape the resolver accepts."
hygiene: "Issue 60, the five advisories on T0-BASE-SYNC-CHANGELOG-2. The one card-runner.ts hunk is the step text of the base-sync merge-conflict repair (lines 2478-2481 before this card), clear of the ranges other sessions hold (1-45, 690-730, 2300-2340), told to aidlc-37 before the edit and approved by it (aidlc-a6 edits lines 21 and 2309-2322, aidlc-b7 lines 36 and 706-719). Run the mutation sweep over every new branch before the first review; the doc test reads the exact sentences (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS); every forbid clause names the code it guards (docs/LESSONS.md 2026-09-27 T0-REVIEWER-UTF8)."
doc_sync: docs/OPERATIONS.md (base sync paragraph), CHANGELOG.md
---

# T0-BASE-SYNC-CHANGELOG-EDGES

## Deliverable
The base-sync CHANGELOG merge of the GitHub ship path reports each of its own failures as what it is: a committed merge whose commit cannot be read back gets a step that records the worktree HEAD, a failed write names how to recover a partly written file, and a failed listing, read or checkout names its error instead of posing as a conflict; the resolver takes only entries and subsections.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/github-ship.test.ts tests/infra/ship.test.ts tests/scenarios/base-sync-committed.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
