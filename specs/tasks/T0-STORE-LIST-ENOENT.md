---
id: T0-STORE-LIST-ENOENT
title: listJsonFiles and findInterruptedWrites list a state directory as empty only when its listing fails with ENOENT and throw READ_FAILED for any other failure, so the production gate refuses a RELEASE_APPROVAL that matches no authorization when the goals directory cannot be inspected, where it let the command run as if there were no aidlc state (issue 368)
status: todo
superseded_by: T0-STORE-LIST-ENOENT-2
branch: T0-STORE-LIST-ENOENT
worktree: D:\wt\AIDLC\T0-STORE-LIST-ENOENT
allow_paths:
  - src/state/store.ts
  - src/state/goal-store.ts
  - src/cli/main.ts
  - tests/infra/store.test.ts
  - tests/scenarios/prod-gate-generation.test.ts
  - tests/surface/doctor-interrupted-writes.test.ts
  - changelog.d/T0-STORE-LIST-ENOENT.md
  - specs/tasks/T0-STORE-LIST-ENOENT.md
dod_command: npm run typecheck && node --test tests/infra/store.test.ts tests/infra/goal-store.test.ts tests/infra/reconcile.test.ts tests/infra/review-queue.test.ts tests/infra/bounds.test.ts tests/surface/bounds.test.ts tests/infra/claims.test.ts tests/scenarios/prod-gate-generation.test.ts tests/surface/hooks.test.ts tests/surface/doctor-interrupted-writes.test.ts tests/surface/lease-heartbeat.test.ts tests/scenarios/registry-per-call.test.ts tests/scenarios/release-lease.test.ts tests/scenarios/fault-points.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. src/state/store.ts shall export `readDirNames(dir: string): string[]`, which decides what a directory answers from its one `readdirSync(dir)` alone, with no look at the path before it - a listing that throws an error whose `code` is exactly `ENOENT` returns `[]`, a listing that throws anything else throws `StoreError('READ_FAILED', dir, <the message of that error>)`, and a listing that succeeds returns its names unchanged.
  - R2. `listJsonFiles` (src/state/store.ts:279-285) and `findInterruptedWrites` (:110-116) shall take their names from `readDirNames(dir)` and keep their filter, sort and path join as on main; no `existsSync` remains in src/state/store.ts.
  - R3. `GoalStore.recover` (src/state/goal-store.ts:113-123) shall take the names of the cards directory from `readDirNames(this.paths.cards)`, with its directory list, its order and its cleanup otherwise as on main; src/state/goal-store.ts imports neither `existsSync` nor `readdirSync`.
  - R4. `doctorWorkingTree` (src/cli/main.ts:159-173) shall pass `goals: () => c.store.listGoals()`, with no `existsSync` of the goals directory, so `aidlc doctor` reports every uncommitted planning file as `claim unknown (goal records unreadable: READ_FAILED)` when the goals directory cannot be listed, where it reported `unclaimed`.
  - R5. Every other caller of `listJsonFiles`, `findInterruptedWrites`, `listGoals`, `listCardRuns`, `listReleases`, `OperationLedger.list`, `ReviewQueue.list` and `readBoundRecords` shall keep its code as on main (body section Callers); in particular `productionGate` (src/hooks/index.ts:430-472) refuses with exit 2 a `RELEASE_APPROVAL` or `AIDLC_RELEASE_APPROVAL` that matches no recorded production authorization when the goals directory cannot be listed, where it returned exit 0, and still returns exit 0 for any approval text when the goals directory is not there.
  - R6. The doc comments of `readDirNames`, `listJsonFiles` and `findInterruptedWrites` and the new fragment changelog.d/T0-STORE-LIST-ENOENT.md shall carry the texts of Acceptance detail 7, and no document changes.
acceptance:
  - 1. tests/infra/store.test.ts, new test "T0-STORE-LIST-ENOENT acceptance 1 - only a listing error with the code ENOENT is an empty directory" - the table of Acceptance detail 1 over a directory path that is not on disk, each row run through `readDirNames`, `listJsonFiles` and `findInterruptedWrites`, with `fs.readdirSync` routed through a wrapper that throws the row's error for that path. Fails on main (`readDirNames` is not exported; with the import alone, `listJsonFiles` and `findInterruptedWrites` return `[]` on each throwing row, since `existsSync` answers false first). [R1] [R2] [dod arm 1]
  - 2. Same file, new test "T0-STORE-LIST-ENOENT acceptance 2 - a regular file at the directory path is READ_FAILED, and a directory under a regular file is READ_FAILED on POSIX and empty on Windows" - the rows of Acceptance detail 2 on the real file system, both platforms asserted and none skipped. The first row fails on main on both platforms (a raw ENOTDIR error, not a `StoreError`); the POSIX branch of the second row fails on main; its Windows branch and the missing-directory row pass on main and with this card. [R1] [R2] [dod arm 1]
  - 3. Same file, new test "T0-STORE-LIST-ENOENT acceptance 3 - every lister refuses a state directory under a root without search permission (EACCES)", skipped with its stated reason on Windows and for root (Acceptance detail 3) - the rows of Acceptance detail 3 with the state root at mode 0o600, each throwing `READ_FAILED` naming its directory with `EACCES` in the message, the mode restored in a `finally`. Fails on main on POSIX (each answers an empty list). [R2] [R3] [R5] [dod arm 1]
  - 4. Same file, new test "T0-STORE-LIST-ENOENT acceptance 4 - each lister refuses a directory whose listing fails with EACCES and lists a missing one as empty" - the rows of Acceptance detail 4. Fails on main (every lister answers as for a missing directory). [R2] [R3] [R5] [dod arm 1]
  - 5. tests/scenarios/prod-gate-generation.test.ts, new test "T0-STORE-LIST-ENOENT acceptance 5 - production-gate refuses a plain approval when the goals directory cannot be listed" - the two rows of Acceptance detail 5; the POSIX row is a subtest skipped with its stated reason on Windows and for root. Fails on main (exit 0 in both rows). [R5] [dod arm 1]
  - 6. tests/surface/doctor-interrupted-writes.test.ts, new test in the `aidlc doctor` suite "T0-STORE-LIST-ENOENT acceptance 6 - doctor names an uncommitted planning file a claim unknown when the goals directory cannot be listed" - Acceptance detail 6. Fails on main (`"intent/a.md": unclaimed`). [R4] [dod arm 1]
  - 7. The doc comments and the fragment hold the texts of Acceptance detail 7, the fragment followed by one line feed, tests/surface/changelog-fragments.test.ts and tests/surface/prose.test.ts pass with it, and `git diff origin/main -- CHANGELOG.md docs README.md` is empty (reviewer-verified against the diff). [R6] [dod arm 1]
  - 8. Every other test of the three changed test files and every test of the unchanged files of the DoD pass with no line changed - tests/infra/goal-store.test.ts (its `recover()` test among them), reconcile.test.ts, review-queue.test.ts, bounds.test.ts and claims.test.ts, tests/surface/bounds.test.ts, hooks.test.ts and lease-heartbeat.test.ts, tests/scenarios/registry-per-call.test.ts, release-lease.test.ts and fault-points.test.ts. [R2] [R3] [R5] [dod arm 1]
depends_on: []
budget: 250
tdd: true
sweep: "Main at 2f4b2a26. `grep -rn 'listJsonFiles\\|findInterruptedWrites' src` finds 9 calls - src/state/goal-store.ts:48 (`listGoals`), :91 (`listCardRuns`), :107 (`listReleases`), :119 (`recover`), src/coordination/reconcile.ts:46 (`OperationLedger.list`), src/coordination/review-queue.ts:118 (`ReviewQueue.list`), src/state/bounds.ts:96 and :99 (`readBoundRecords`, each inside `attempt`, which turns any error into `BoundsReadError` with the store code), and src/state/store.ts:120 (`recoverInterruptedWrites`). `GoalStore.recover` and `recoverInterruptedWrites` have no caller under src/ (tests/infra/goal-store.test.ts:86 and tests/infra/store.test.ts:73 call them). `aidlc doctor` lists interrupted writes through `interruptedWritesReport` (src/state/store.ts:296-347), which already reads only `ENOENT` as an empty directory and names any other failure; it does not call `findInterruptedWrites`, so the issue's sentence about doctor is about its workingTree claims (src/cli/main.ts:165), not its interruptedWrites line. The callers of the three GoalStore listers - src/cli/main.ts:165, :177, :185, :385, :624, :1180-1181, :1237-1238, :1463; src/hooks/index.ts:449 (`productionGate`), :651 and :686 (`verifyBeforeDone`); src/loop/card-runner.ts:668, :990; src/loop/controller.ts:345, :463-474, :490, :863, :924, :1013; src/loop/run-driver.ts:30, :102; src/loop/worktree-reclaim.ts:117, :120; src/review/repro.ts:113. Body section Callers says what changes for each group. Tests that replace `fs.readdirSync` - tests/surface/lease-heartbeat.test.ts:209-224 counts the listings of `renewSessionCardLeases`, which lists the leases directory with its own `statSync` and `readdirSync` (src/hooks/index.ts:594, :607) and calls no lister of this card; tests/scenarios/registry-per-call.test.ts:294-319 counts listings whose path ends in specs/tasks; tests/infra/bin-entry.test.ts:174-201 is bin/resolve-entry.js; tests/surface/doctor-interrupted-writes.test.ts:123-380 goes through `interruptedWritesReport`. A missing directory is now listed by a `readdirSync` that fails with ENOENT where `existsSync` answered first, so a test counting `readdirSync` calls on a missing state directory would see one more; none of the four counts such a directory. Tests that set POSIX modes - tests/infra/store.test.ts:200-205 (the goals directory itself at 0o000 and 0o600: at 0o600 it lists and the read of the entry fails, as on main), tests/scenarios/release-lease.test.ts:709-711 (through `ReleaseRunner.strictLedger`, which lists with its own `readdirSync`), tests/surface/cli-cwd-paths.test.ts:537-553 (the `-C` check), tests/surface/hooks.test.ts:842-853 (the hook config read), tests/surface/incident.test.ts and tests/scenarios/dirty-success.test.ts:235-248 (their own stat); none reaches a lister of this card on such a path. Reproduced on 2026-11-18 with a throwaway harness outside the repository (never committed) - on Windows a directory under a regular file lists ENOENT and a mode has no effect, so main answers `[]` there and is right to; on WSL Ubuntu (Node 22.23.1, temporary directories on ext4) a goals directory holding `g.json` and a leftover temp file gave `[]` from both functions under a parent of mode 0o600 (`readdirSync` EACCES) and under a regular file (`readdirSync` ENOTDIR), and `productionGate` with `RELEASE_APPROVAL=any-text-at-all`, a live goal holding no authorization and `deploy production` returned exit 2 with the state directory readable and `{\"exitCode\":0}` with it at mode 0o600."
forbid:
  - weakening, skipping or deleting a test to go green; the only platform skips are the test of acceptance 3 and the POSIX row of acceptance 5, each with its stated reason
  - an `existsSync`, `statSync`, `lstatSync` or `accessSync` of the directory in `readDirNames`, `listJsonFiles` or `findInterruptedWrites`
  - a change to `readJson`, `updateJson`, `atomicWriteJson`, `atomicWriteText`, `createExclusive`, `recoverInterruptedWrites` or `interruptedWritesReport`
  - a change under src/ outside `readDirNames`, `listJsonFiles` and `findInterruptedWrites` with their doc comments and the `node:fs` import line of src/state/store.ts, `GoalStore.recover` and the `node:fs` import line of src/state/goal-store.ts, and the `goals` line of `doctorWorkingTree` (src/cli/main.ts:165)
  - a change to src/hooks/index.ts, src/state/claims.ts, src/state/bounds.ts, src/loop/release-runner.ts or any file under src/coordination/
  - a change to .claude/skills/verify-card-run-writes/SKILL.md or to tests/scenarios/fault-points.test.ts
  - a new test file
  - a change to CHANGELOG.md, README.md or any file under docs/
  - in the test files a temporary directory outside the fixture's own, a directory left with a changed mode, or a process left running
non_goals:
  - "`LeaseStore.list` (src/coordination/lease.ts:137), the journal reads (src/state/journal.ts:108 and :115) and the other `existsSync` guards under src/ that answer empty for a path they cannot see; same class, a follow-up issue"
  - "`ReleaseRunner.strictLedger` (src/loop/release-runner.ts:200-208), which already lists with this rule; moving it onto `readDirNames` is a refactor no reader asked for"
  - the `!existsSync(paths.goals)` fallback of `productionGate` (src/hooks/index.ts:461) itself - it is reached only after a goals listing that succeeded, so with this card it sees an absent directory or a readable one
  - a directory under a regular file on Windows, a link to nothing, and a name the file system reports as no entry; each listing fails with ENOENT and the directory lists as empty
  - a directory that another process is deleting on Windows (the listing fails with EPERM while the delete is pending); it is READ_FAILED with this card, and aidlc deletes no state directory that another process lists
  - a listing that throws a value that is no Error object; `readdirSync` throws none, and the message of such a value is read as in `readJson`
  - the message or the exit code of any command for a directory that is missing
  - a document sentence; no document states what a store listing answers for a directory it cannot inspect
diagnosis:
  root_cause: "`listJsonFiles` and `findInterruptedWrites` asked `existsSync(dir)` first and answered an empty list when it said false. `existsSync` says false for every failure of the stat, not only for a directory that is not there - a parent that cannot be searched (EACCES), a parent that is a regular file on POSIX (ENOTDIR), a loop of links (ELOOP). So a state directory that is there and cannot be inspected was listed as empty. `productionGate` (src/hooks/index.ts:446-465) reads an empty goal list followed by a false `existsSync(paths.goals)` as 'no aidlc state' and honours any approval text, so with the state directory at mode 0o600 it let `deploy production` run on an approval that matches no record (reproduced on WSL Linux at 2f4b2a26); `aidlc doctor` reported an uncommitted planning file `unclaimed`; and every listing command answered as if the store held no goals, runs, release attempts, operations or review requests."
  same_class: "Every caller of the two functions gets the rule through them (body section Callers). Two guards beside them repeat the check and are fixed here - the `existsSync` of the cards directory in `GoalStore.recover` (src/state/goal-store.ts:116) and of the goals directory in `doctorWorkingTree` (src/cli/main.ts:165). `interruptedWritesReport` (src/state/store.ts:296-347), `ReleaseRunner.strictLedger` (src/loop/release-runner.ts:200-208) and `readJson` (T0-STORE-READ-ENOENT-2) already have the rule. Same class and left to a follow-up issue - `LeaseStore.list` (src/coordination/lease.ts:137) and the journal reads (src/state/journal.ts:108, :115) ask `existsSync` and answer empty."
hygiene: "Issue 368, named in the non_goals of T0-STORE-READ-ENOENT-2 (PR 367). Decided by the coordinating session working the open issues through the loop. Line numbers are from main at 2f4b2a26; read them again at PREPARE. Tests first, in two commits - the seam commit adds the rows of acceptance 1 to 6 while the store is main's and exports `readDirNames` as a stub that calls `readdirSync` with no catch (the import of acceptance 1 then resolves), and RED on Windows is acceptance 1, the first row of acceptance 2, acceptance 4, the injected row of acceptance 5 and acceptance 6 failing (the second row of acceptance 2 passes there on its Windows branch; acceptance 3 and the POSIX row of acceptance 5 are skipped with their reasons); the second commit gives `readDirNames` its catch, changes the two functions, `GoalStore.recover` and the doctor line, writes the comments and adds the fragment. The DoD command line names tests/scenarios/prod-gate-generation.test.ts and tests/scenarios/release-lease.test.ts, so it matches this repository's own production pattern (`prod` then `release` on one line) and the PreToolUse hook refuses it typed as a Bash or PowerShell command; run it from a script file outside the worktree, and keep the receipt of `aidlc card attempt` to the exit code and the counts. Run the three changed test files on Linux as well as Windows before the first R3 (docs/LESSONS.md 2026-11-11 T0-DIRTY-SUCCESS-2) - acceptance 3, the POSIX branch of acceptance 2 and the POSIX row of acceptance 5 run nowhere else before CI. This machine has WSL (distribution Ubuntu) with Node 22.23.1 at ~/node22/bin/node, which is not on the login PATH; record the Linux run in the Attempt evidence, or say that it could not be run. Every listing command reads through these functions, so also run `npm test` once on Windows before the first review and record its counts (CLAUDE.md, Verifying your work). Revert table before the first review, each a scratch change run alone and restored afterwards - the `existsSync` line put back in `listJsonFiles` (its rows of acceptance 1, the `listGoals`, `listCardRuns`, `listReleases`, `ops.list`, `queue.list` and `readBoundRecords` rows of acceptance 4, both rows of acceptance 5 and acceptance 6 red); the `existsSync` line put back in `findInterruptedWrites` (its rows of acceptance 1 and the `recover` goals row of acceptance 4 red); the `existsSync` of the cards directory put back in `recover` (the `recover` cards row red); the doctor line put back (acceptance 6 red); the comparison of the code replaced by a search of the message for ENOENT (the row `a denied listing of ENOENT` red); the comparison made case-insensitive (the `enoent` row red); every listing error read as empty (each throwing row of acceptance 1 red); ENOENT thrown as READ_FAILED (the ENOENT rows, the missing-directory half of acceptance 4 and the existing tests `findInterruptedWrites on a missing directory is empty` and `listJsonFiles returns sorted .json paths only` red); the directory left out of the StoreError (acceptance 1 red). Write protocol - .claude/skills/verify-card-run-writes/SKILL.md names src/state/store.ts for `atomicWriteJson` and `atomicWriteText` and src/state/goal-store.ts for `saveCardRun` and `updateCardRun`; this card changes listings and no write or its order, so the outcome is in sync, tests/scenarios/fault-points.test.ts is in the DoD, and the skill file and its sync commit stay as they are. Documents - checked on main at 2f4b2a26 that no sentence states what a store listing answers for a directory it cannot inspect (`grep -n 'existsSync\\|cannot be listed\\|lists as empty' docs/OPERATIONS.md docs/ARCHITECTURE.md README.md` finds none); docs/REQUIREMENTS-TRACEABILITY.md:14 names `recover` and the interrupted writes of store.ts and stays true. The card adds no test file, so it moves no file between the CI shards (`--test-shard=<k>/4` over the sorted list of tests/**/*.test.ts). Acceptance 6 adds one `aidlc doctor` child to tests/surface/doctor-interrupted-writes.test.ts with that file's 120 s child timeout (compare issue 365). The DoD test list took 44 s on main at 2f4b2a26 on Windows (typecheck clean; 305 tests, 297 passed, 8 skipped, 0 failed), against the 540 s limit of a loop-run DoD."
doc_sync: changelog.d/T0-STORE-LIST-ENOENT.md
---

# T0-STORE-LIST-ENOENT

## Deliverable
`listJsonFiles` and `findInterruptedWrites` answer that a state directory is empty only when listing it fails with `ENOENT`. Any other failure to list it is `READ_FAILED` naming the directory, where both functions answered an empty list because `existsSync` could not see the directory. The one rule lives in a new export, `readDirNames`. The production gate therefore refuses an approval that matches no recorded authorization when the goals directory cannot be inspected, `aidlc doctor` names an uncommitted planning file `claim unknown` in that case, and every command that lists goals, card runs, release attempts, operations or review requests refuses such a directory.

## Why
Issue 368, left out by name in the non_goals of T0-STORE-READ-ENOENT-2. That card gave `readJson` the rule "only no entry means absent"; the two directory listings beside it kept the `existsSync` check. `existsSync` says false for a directory that is there when its stat fails for another reason: a parent that cannot be searched, a parent that is a regular file on POSIX, a loop of links.

The worst consequence is in the production gate. It lists the goals and, when no live goal holds a matching authorization and `existsSync(paths.goals)` is false, reads that as "no aidlc state" and honours the plain approval text, as the playbook hook does. With the state directory at mode 0o600 both checks say "nothing here", so `deploy production` ran on `RELEASE_APPROVAL=any-text-at-all` (reproduced on WSL Linux at 2f4b2a26). With the listing throwing, the gate's own `catch` refuses, and src/hooks/index.ts does not change.

The rule is the one `ReleaseRunner.strictLedger` already has for the operations directory and `interruptedWritesReport` has for the doctor's scan. On Windows a directory under a regular file reports no entry, so it cannot be told from a missing directory there and stays empty.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/store.test.ts tests/infra/goal-store.test.ts tests/infra/reconcile.test.ts tests/infra/review-queue.test.ts tests/infra/bounds.test.ts tests/surface/bounds.test.ts tests/infra/claims.test.ts tests/scenarios/prod-gate-generation.test.ts tests/surface/hooks.test.ts tests/surface/doctor-interrupted-writes.test.ts tests/surface/lease-heartbeat.test.ts tests/scenarios/registry-per-call.test.ts tests/scenarios/release-lease.test.ts tests/scenarios/fault-points.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every test of the listed files passes; on Windows the test of acceptance 3 and the POSIX row of acceptance 5 are reported as skipped with their reasons. dod arm 1 is the whole command.

## Callers
On main at 2f4b2a26. "Cannot be listed" below means a listing that fails with another code than `ENOENT`; a directory that is not there lists as empty, as on main.

| Call | With this card |
|---|---|
| src/state/goal-store.ts:48 `listGoals`, :91 `listCardRuns`, :107 `listReleases`; src/coordination/reconcile.ts:46 `OperationLedger.list`; src/coordination/review-queue.ts:118 `ReviewQueue.list` | a directory that cannot be listed throws `READ_FAILED` naming it, where they answered `[]` (a directory under an unsearchable parent or a regular file on POSIX) or threw the raw `readdirSync` error (a regular file at the directory path, a directory without read permission) |
| src/state/bounds.ts:96 and :99 `readBoundRecords` | `BoundsReadError` `cannot read "<dir>": READ_FAILED`, where it answered no goals or no runs (or `UNREADABLE` for a raw error) |
| src/state/goal-store.ts:114-123 `recover`, src/state/store.ts:119-129 `recoverInterruptedWrites` | the first directory that cannot be listed throws `READ_FAILED`; no caller under src/ |
| src/hooks/index.ts:446-465 `productionGate` | the throw reaches its `catch`, so an approval that matches no record is refused with exit 2, where the empty list and a false `existsSync` honoured it; an absent goals directory still honours it |
| src/hooks/index.ts:651, :686 `verifyBeforeDone` (Stop) | the throw ends the advisory DoD reminder through its existing `catch`, as an empty list did; no visible change |
| src/cli/main.ts:165 `doctorWorkingTree` | R4 - `claim unknown (goal records unreadable: READ_FAILED)` for each uncommitted planning file, where it said `unclaimed` |
| every other CLI call (src/cli/main.ts:177, :185, :385, :624, :1180-1181, :1237-1238, :1463) and the loop calls (card-runner.ts, controller.ts, run-driver.ts, worktree-reclaim.ts, repro.ts) | the command exits 1 with `aidlc: READ_FAILED: <message> (<dir>)`, where it went on as if the store held nothing there |

## Acceptance detail

### 1. The listing table (acceptance 1)
The directory path is `<fixture>/unseen/state`, and the test asserts first that `existsSync` of it is false. `fs.readdirSync` is routed through a wrapper that throws the row's error when it is called with that path and calls the real function for any other: the default export of `node:fs` is changed and `syncBuiltinESMExports()` called, and both are restored in a `finally` (the form of `failingRead` in tests/infra/store.test.ts). An error is `Object.assign(new Error(<message>), { code })`, with no `code` property in the last row. Each row is run through `readDirNames`, `listJsonFiles` and `findInterruptedWrites`.

| `code` | Message | Each of the three |
|---|---|---|
| `ENOENT` | `ENOENT: no such file or directory, scandir` | returns `[]` |
| `ENOENT` | `a message that names no code` | returns `[]` |
| `EACCES` | `EACCES: permission denied, scandir` | throws |
| `ENOTDIR` | `ENOTDIR: not a directory, scandir` | throws |
| `ELOOP` | `ELOOP: too many symbolic links encountered, scandir` | throws |
| `EPERM` | `EPERM: operation not permitted, scandir` | throws |
| `EIO` | `EIO: i/o error, scandir` | throws |
| `EACCES` | `a denied listing of ENOENT` | throws (the code decides, not the message) |
| `enoent` | `a code in another letter case` | throws (the code is compared exactly) |
| none | `an error with no code` | throws |

Each throwing row is checked whole: the error is a `StoreError`, its `code` is `READ_FAILED`, its `file` is the directory and its `message` is `READ_FAILED: <the row's message> (<the directory>)`. Because the directory is not on disk, any look at the path before the listing answers "empty" and fails every throwing row.

### 2. The real file system on both platforms (acceptance 2)
- A regular file at the directory path (`<fixture>/real/plain` holds text): each of the three throws a `StoreError` with code `READ_FAILED`, that path as `file` and `ENOTDIR` in its message, on every platform.
- A directory path under a regular file (`<fixture>/real/plain/goals`): on `win32` each of the three returns `[]`; on every other platform each throws a `StoreError` with code `READ_FAILED`, that path and `ENOTDIR` in its message. The test asserts the branch of the platform it runs on, and a comment in it says why they differ: under a regular file POSIX answers `ENOTDIR` and Windows answers that there is no entry, which no reader can tell from a missing directory.
- A directory that is not there (`<fixture>/real/none`): each returns `[]`, as on main.

### 3. The real file system on POSIX (acceptance 3)
The test carries `{ skip: reason }` in the form of `noModes` (tests/infra/store.test.ts:193, acceptance 3 of T0-STORE-READ-ENOENT-2): on `win32` the reason `Windows has no POSIX mode bits, so a directory mode cannot hide a directory`; when `process.getuid?.() === 0` the reason `root reads through any directory mode`; else `false`.

Under `<fixture>/list-locked/.aidlc` (the existing `<fixture>/locked` belongs to acceptance 3 of T0-STORE-READ-ENOENT-2), `ensureStatePaths(statePathsFromRoot(...))` and a `GoalStore` over it save `makeGoal('goal-locked')`, one card run of it and one release attempt; an `OperationLedger` over its operations directory and a `ReviewQueue` over its review-queue directory are made. Then, inside a `try` whose `finally` sets the state root back to mode 0o755, with the state root at mode 0o600 (read and no search) each row throws a `StoreError` with code `READ_FAILED`, the named directory as `file` and `EACCES` in its message:

| Call | Directory named |
|---|---|
| `store.listGoals()` | `paths.goals` |
| `store.listCardRuns('goal-locked')` | `<paths.cards>/goal-locked` |
| `store.listReleases()` | `paths.releases` |
| `ops.list()` | `paths.operations` |
| `queue.list()` | `paths.reviewQueue` |
| `store.recover()` | `paths.cards` |
| `readBoundRecords(store)` | throws a `BoundsReadError` whose message is `cannot read <JSON.stringify of paths.goals>: READ_FAILED` |

After the `finally`, `store.listGoals()` returns the one goal.

### 4. The listers (acceptance 4)
One state directory `statePathsFromRoot(<fixture>/absent/.aidlc)` that is not created, with a `GoalStore`, an `OperationLedger` and a `ReviewQueue` over it. For each row the test asserts that the directory is not on disk, that the call answers as the last column says, and that with the listing of that directory failing with `EACCES` (message `EACCES: permission denied, scandir`, injected as in detail 1) the call throws the `StoreError` of detail 1 for that directory.

| Call | Directory | Missing directory |
|---|---|---|
| `store.listGoals()` | `paths.goals` | `[]` |
| `store.listCardRuns('g-1')` | `<paths.cards>/g-1` | `[]` |
| `store.listReleases()` | `paths.releases` | `[]` |
| `ops.list()` | `paths.operations` | `[]` |
| `queue.list()` | `paths.reviewQueue` | `[]` |
| `store.recover()` (cards) | `paths.cards` | `{ interrupted: [] }` |
| `store.recover()` (goals) | `paths.goals`, with the cards directory missing | `{ interrupted: [] }` |
| `readBoundRecords(store)` | `paths.goals` | `{ goals: [], runs: [] }`; with the failing listing it throws a `BoundsReadError` whose message is `cannot read <JSON.stringify of paths.goals>: READ_FAILED` |

### 5. The production gate (acceptance 5)
Both rows use the file's `gate` helper with `RELEASE_APPROVAL` `rel-1` and the command `deploy production`, and assert with `assertRefused(r, 'rel-1', <label>)`.
- Injected, every platform: `seed(t, [])` and the goals directory of `resolveStatePaths(dir, env)` asserted not on disk; with no injection the gate returns `{ exitCode: 0 }` (no aidlc state, as on main); with `fs.readdirSync` of that directory failing with `EACCES` (injected as in detail 1, restored in a `finally`) it is refused.
- Real file system, POSIX: a subtest with the skip reasons of detail 3. `seed(t, [makeGoal('g1', { state: 'RUN', terminal: false })])`; with the state directory (`env.AIDLC_STATE_DIR`) at mode 0o600 inside a `try` whose `finally` sets it back to 0o755, the gate is refused; after the `finally` it is refused too (a live goal with no matching authorization), which shows the row tests the listing and not the goal.

### 6. aidlc doctor (acceptance 6)
In the `aidlc doctor` suite: a fresh directory made a git repository (`git init` in it, run with the suite's `childEnv`), holding the untracked file `intent/a.md`, and a state directory `<dir>/state` that holds `leases/` and no `goals/`. The child is spawned as the suite's `doctor(dir, state, '--json')` with a second `--import` preload, a `data:` module in the form of the suite's first preload, that makes `fs.readdirSync` throw `Object.assign(new Error('EACCES: permission denied, scandir'), { code: 'EACCES' })` for the path in the environment variable `FAIL_LIST_OF` (set to `<state>/goals`) and calls `syncBuiltinESMExports()`. The child exits 0, and `workingTree` in its JSON is `['"intent/a.md": claim unknown (goal records unreadable: READ_FAILED)']`. On main it is `['"intent/a.md": unclaimed']`.

### 7. Texts (acceptance 7)
The doc comment of `readDirNames`:
```ts
/**
 * The names in a directory. A directory that is not there (its listing fails with the code ENOENT) has none; any other
 * failure to list it throws READ_FAILED naming the directory.
 */
```
The doc comment of `findInterruptedWrites`:
```ts
/** Detect leftover temporary files from interrupted writes in a directory; a directory that cannot be listed throws READ_FAILED (`readDirNames`). */
```
The doc comment of `listJsonFiles`, which has none on main:
```ts
/** The `.json` files of a directory, sorted by name; a directory that cannot be listed throws READ_FAILED (`readDirNames`). */
```
changelog.d/T0-STORE-LIST-ENOENT.md, one line and a line feed:
```
- T0-STORE-LIST-ENOENT (bugfix, issue 368): a state directory is listed as empty only when listing it fails with `ENOENT`. Any other failure, such as a parent directory that cannot be searched (`EACCES`) or a parent that is a regular file on POSIX (`ENOTDIR`), is `READ_FAILED` naming the directory, where `listJsonFiles` and `findInterruptedWrites` answered an empty list because `existsSync` could not see it. So the production gate refuses an approval that matches no recorded production authorization when the goals directory cannot be listed, where it let the command run as if there were no aidlc state; `aidlc doctor` reports an uncommitted planning file as `claim unknown (goal records unreadable: READ_FAILED)` in that case, where it said `unclaimed`; and every command that lists goals, card runs, release attempts, operations or review requests refuses such a directory. On Windows a directory under a regular file reports no entry and still lists as empty.
```
