---
id: T0-STORE-READ-ENOENT
title: readJson reads a stored record as absent only when its read fails with ENOENT and throws READ_FAILED for any other failure to read the path, so `aidlc review release` and `aidlc review resolve` stop before any queue write on a requester goal whose record cannot be inspected, where they skipped that goal's NOTE and freed the slot (issue 303)
status: todo
branch: T0-STORE-READ-ENOENT
worktree: D:\wt\AIDLC\T0-STORE-READ-ENOENT
allow_paths:
  - src/state/store.ts
  - src/loop/release-runner.ts
  - tests/infra/store.test.ts
  - tests/scenarios/review-resolve.test.ts
  - tests/scenarios/review-release.test.ts
  - changelog.d/T0-STORE-READ-ENOENT.md
  - specs/tasks/T0-STORE-READ-ENOENT.md
dod_command: npm run typecheck && node --test tests/infra/store.test.ts tests/scenarios/review-resolve.test.ts tests/scenarios/review-release.test.ts tests/scenarios/fault-points.test.ts tests/infra/goal-store.test.ts tests/infra/lease.test.ts tests/infra/reconcile.test.ts tests/infra/review-queue.test.ts tests/infra/update-json.test.ts tests/infra/bounds.test.ts tests/surface/bounds.test.ts tests/surface/incident.test.ts tests/scenarios/release-lease.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `readJson` (src/state/store.ts:86-105) shall decide what a path answers from its one `readFileSync(file, 'utf8')` alone, with no look at the path before it - a read that throws an error whose `code` is exactly `ENOENT` returns undefined, a read that throws anything else throws `StoreError('READ_FAILED', file, <the message of that error>)`, and a file that is read is parsed and validated as on main (`MALFORMED_JSON`, `SCHEMA_VIOLATION`).
  - R2. Every caller of `readJson` shall keep its code as on main, so that each reader of one record by its path (`GoalStore.getGoal`, `getCardRun` and `getRelease`, `LeaseStore.read`, `OperationLedger.get`, `ReviewQueue.get`, `ReviewQueue.pool`, and `readBoundRecords` with a goal id) throws that `READ_FAILED` (`readBoundRecords` as its `BoundsReadError`) for a record whose read fails with another code than `ENOENT` and answers a missing record as on main.
  - R3. `aidlc review release <key>` and `aidlc review resolve <key>` shall, for a requester goal whose record is read with another error than `ENOENT`, exit 1 with the one line `aidlc: READ_FAILED: <message> (<goal file>)` on stderr before any queue write, the request, the pool and every journal left as they were.
  - R4. The doc comment of `readJson`, the comment of `strictLedger` (src/loop/release-runner.ts:195-199) and the new fragment changelog.d/T0-STORE-READ-ENOENT.md shall carry the texts of Acceptance detail 7, and no document changes.
acceptance:
  - 1. tests/infra/store.test.ts, new test "T0-STORE-READ-ENOENT acceptance 1 - only a read error with the code ENOENT is an absent record" - the table of Acceptance detail 1 over a path that is not on disk, with `fs.readFileSync` routed through a wrapper that throws the row's error for that path. Fails on main (each `READ_FAILED` row returns undefined, since `existsSync` answers false first). [R1] [dod arm 1]
  - 2. Same file, new test "T0-STORE-READ-ENOENT acceptance 2 - a directory at the record path is READ_FAILED and a path under a regular file is READ_FAILED on POSIX and absent on Windows" - the two real-file-system rows of Acceptance detail 2, both platforms asserted and none skipped. Its POSIX branch fails on main; its Windows branch and the directory row pass on main and with this card. [R1] [dod arm 1]
  - 3. Same file, new test "T0-STORE-READ-ENOENT acceptance 3 - a record in a directory without search permission is READ_FAILED (EACCES), read alone or through a listing", skipped with its stated reason on Windows and for root (Acceptance detail 3) - `GoalStore.getGoal` under a goals directory of mode 0o000 and `GoalStore.listGoals` under mode 0o600 each throw `READ_FAILED` naming the goal file with `EACCES` in the message, and the mode is restored in a `finally`. Fails on main on POSIX (undefined and an empty list). [R1] [R2] [dod arm 1]
  - 4. Same file, new test "T0-STORE-READ-ENOENT acceptance 4 - each reader of one record refuses a record whose read fails with EACCES and reads a missing one as absent" - the eight rows of Acceptance detail 4. Fails on main (every reader answers as for a missing record). [R2] [dod arm 1]
  - 5. tests/scenarios/review-resolve.test.ts, subtest "a request or goal record that cannot be read" - a fourth breaker, code `READ_FAILED`, "nothing, with a read that fails with EACCES" (the record removed from disk, the fault module switched on with `FAIL_READ_OF` the record's path and `FAIL_READ_CODE` `EACCES`), run for the request and for the goal with the assertions of the three existing breakers unchanged. Fails on main (the request row prints `unknown review request`, the goal row exits 0). [R3] [dod arm 1]
  - 6. tests/scenarios/review-release.test.ts, new test "T0-STORE-READ-ENOENT acceptance 6 - a release whose requester goal cannot be inspected exits 1 with the slot held and no NOTE, and running it again finishes it" - the rows of Acceptance detail 6. Fails on main (exit 0, the slot freed, no NOTE). [R3] [dod arm 1]
  - 7. The other tests of the three changed files and every test of the unchanged files of the DoD pass with no line changed - tests/scenarios/fault-points.test.ts, tests/infra/goal-store.test.ts, lease.test.ts, reconcile.test.ts, review-queue.test.ts, update-json.test.ts and bounds.test.ts, tests/surface/bounds.test.ts and incident.test.ts, tests/scenarios/release-lease.test.ts. [R2] [dod arm 1]
  - 8. The two comments and the fragment hold the texts of Acceptance detail 7, the fragment followed by one line feed, tests/surface/changelog-fragments.test.ts and tests/surface/prose.test.ts pass with it, and `git diff origin/main -- CHANGELOG.md docs README.md` is empty (reviewer-verified against the diff). [R4] [dod arm 1]
depends_on: []
budget: 230
tdd: true
sweep: "Main at aea950c0. `grep -rn 'readJson(' src` finds 17 calls; body section Callers says for each what changes. What a caller does with the error - src/cli/main.ts:978 and :1030 (`review release`, `review resolve`) call `c.store.getGoal` inside the queue section before any queue write, so the throw leaves the queue as it was; src/hooks/index.ts:665-672 and :730-736 catch a lease read error and list the run as unreadable or leave the goal out; `aidlc board --watch` prints `state unreadable` with the code; every other command exits 1 with `aidlc: READ_FAILED`. Deletes - `grep -rn 'unlinkSync\\|rmSync' src` shows that aidlc deletes no record another process reads through `readJson` (`LeaseStore.purgeReleased` has no caller under src/; the mutant marker is read and deleted by one process). Tests that replace `fs.readFileSync` - tests/infra/goal-store.test.ts:271 and tests/infra/update-json.test.ts:308 fail the read of a lock file only, and tests/scenarios/review-rule-goal.test.ts:36 counts reads that returned; none depends on the `existsSync` of `readJson`. Tests that build paths a POSIX stat cannot inspect - tests/scenarios/release-lease.test.ts:685-738 (through `strictLedger`, on a DONE attempt that returns before any `OperationLedger.list`), tests/surface/incident.test.ts:315 and :332 (through `IncidentLedger.present`), tests/scenarios/dirty-success.test.ts:235-248 (through the `lstatSync` of `recordAttempt`); none reaches `readJson` on such a path. Measured on 2026-11-17 on scratch copies outside the repository with a prototype (never committed) - on Windows with main's `readJson` acceptance 1, 4, 5 and 6 failed, acceptance 2 passed and acceptance 3 was skipped; with the prototype all passed and the typecheck was clean. On Linux (WSL Ubuntu, Node 24.3.0, temporary directories on ext4) the prototype rows ran with 25 existing test files, the ones with POSIX permission rows among them, 648 tests in all - with the prototype 644 passed, none failed and 4 were skipped; with main's `readJson` only the new rows failed. The whole suite was not run with the prototype."
forbid:
  - weakening, skipping or deleting a test to go green; the one platform skip is the test of acceptance 3 with its stated reason
  - an `existsSync`, `statSync`, `lstatSync` or `accessSync` of the record path in `readJson`
  - a new parameter of `readJson`, or a change to any of its 17 callers
  - a change to `listJsonFiles`, `findInterruptedWrites`, `updateJson`, `atomicWriteJson` or `atomicWriteText`
  - a change under src/ outside `readJson` with its doc comment and the one comment of `strictLedger`
  - a change to .claude/skills/verify-card-run-writes/SKILL.md or to tests/scenarios/fault-points.test.ts
  - a new test file
  - a change to CHANGELOG.md, README.md or any file under docs/
  - in the test files a temporary directory outside the fixture's own, a directory left with a changed mode, or a process left running
non_goals:
  - `listJsonFiles` and `findInterruptedWrites` (src/state/store.ts:277 and :109), which still answer an empty list for a directory `existsSync` cannot see; a follow-up issue
  - a path under a regular file on Windows, a link to nothing, and a name the file system reports as no entry; each read fails with ENOENT and the record is read as absent
  - a record that another process is deleting on Windows (the open fails with EPERM while the delete is pending); it is READ_FAILED with this card, and aidlc deletes no stored record that another process reads
  - a read that throws a value that is no Error object; `readFileSync` throws none, and the message of such a value is read as on main
  - `IncidentLedger.present`, `markerOf` of src/review/mutants.ts, the code of `strictLedger` and the mutant-marker check of `recordAttempt`; each inspects its path itself and keeps its rule
  - the message or the exit code of any command for a record that is missing
  - a document sentence; no document states what a store read answers for a path it cannot inspect
diagnosis:
  root_cause: "`readJson` asked `existsSync(file)` first and answered undefined when it said false. `existsSync` says false for every failure of the stat, not only for a file that is not there - a parent directory that cannot be searched (EACCES), a parent that is a regular file on POSIX (ENOTDIR), a loop of links (ELOOP), a name that is too long. So a record that is there and cannot be inspected was read as a record the store does not hold. `aidlc review release` and `aidlc review resolve` skip a requester goal the store does not hold (src/cli/main.ts:978 and :1030), so for such a goal they freed the pool slot without its NOTE, while each failure `readJson` did report (READ_FAILED, MALFORMED_JSON, SCHEMA_VIOLATION) already stopped both commands before any queue write."
  same_class: "The 17 calls of `readJson` (body section Callers) - all get the rule through the one function, and no caller changes. `IncidentLedger.present` (src/maintain/incident.ts:22-32) already has this rule for its own file. Same class and left to a follow-up issue - `listJsonFiles` and `findInterruptedWrites` ask `existsSync` about a directory and answer an empty list."
hygiene: "Issue 303. Line numbers are from main at aea950c0; read them again at PREPARE. Work this card after T0-EXEC-READY-MARGIN. Tests first, in two commits - the seam commit adds the rows of acceptance 1 to 6 while `readJson` is main's, and RED on Windows is acceptance 1, 4, 5 and 6 failing (acceptance 2 passes there on its Windows branch and acceptance 3 is skipped with its reason); the second commit changes `readJson` and the two comments and adds the fragment. Run the three changed test files on Linux as well as Windows before the first R3 (docs/LESSONS.md 2026-11-11 T0-DIRTY-SUCCESS-2) - acceptance 3 and the POSIX branch of acceptance 2 run nowhere else before CI. This machine has WSL (distribution Ubuntu, Node 24.3.0 under ~/.nvm/versions/node/v24.3.0/bin, which is not on the login PATH); record the Linux run in the Attempt evidence, or say that it could not be run. Every command reads through this function, so also run `npm test` once on Windows before the first review and record its counts (CLAUDE.md, Verifying your work); until T0-EXEC-READY-MARGIN has merged, tests/infra/exec.test.ts can fail in that run with its named precondition, which is not a failure of this card. Revert table before the first review, each a scratch change run alone and restored afterwards - the `existsSync` line put back (acceptance 1, 4, 5 and 6 red); the comparison of the code replaced by a search of the message for ENOENT (the rows `a denied read of ENOENT.json` and `a message that names no code` red); the comparison made case-insensitive (the `enoent` row red); every read error read as absent (each throwing row of acceptance 1 red); ENOENT thrown as READ_FAILED (the two ENOENT rows, the missing-record half of acceptance 4 and the existing test `readJson returns undefined for a missing file` red); the file left out of the StoreError (acceptance 1 red). The listed readers have no row that can fail on Windows, since an entry that is on disk already gave READ_FAILED on main when its read failed; the listing half of acceptance 3 is their row and runs on POSIX. Write protocol - .claude/skills/verify-card-run-writes/SKILL.md names src/state/store.ts for `atomicWriteJson` and `atomicWriteText`; this card changes a read and no write or its order, so the outcome is in sync, tests/scenarios/fault-points.test.ts is in the DoD, and the skill file and its sync commit stay as they are. Documents - checked on main at aea950c0 that no sentence states what a store read answers for a path it cannot inspect (`grep -n 'existsSync\\|cannot be seen\\|store cannot' docs/OPERATIONS.md docs/ARCHITECTURE.md README.md` finds none). docs/OPERATIONS.md:259 (board watch) and :494 (bounds) say that a record that cannot be read stops with its code, and :640 and :642 say that each requester goal journals its NOTE before the queue is written; all four stay true without a word changed, and tests/scenarios/review-resolve.test.ts:948 and tests/scenarios/review-release.test.ts:725 pin where the last two stand. So no sentence is added, and no pinned paragraph or neighbour is touched. The card adds no test file, so it moves no file between the CI shards (`--test-shard=<k>/4` over the sorted list of tests/**/*.test.ts, 215 files on main at aea950c0); a new file beside tests/infra/store.test.ts (file 52 counted from 0, shard 1) would move tests/infra/stray-processes.test.ts from shard 2 to shard 3 and every later file one shard on, which is why the rows go into the three existing files. The DoD holds none of the files known to fail under load (tests/infra/exec.test.ts, tests/scenarios/mutants-review.test.ts, tests/surface/review-bench.test.ts); its test list took 99 s on main (366 tests, 8 skipped) and 104 s on the prototype (373 tests, 9 skipped) on Windows, against the 540 s limit of a loop-run DoD."
doc_sync: changelog.d/T0-STORE-READ-ENOENT.md
---

# T0-STORE-READ-ENOENT

## Deliverable
`readJson` answers that a record is absent only when reading its file fails with `ENOENT`. Any other failure to read the path is `READ_FAILED` naming the file, where the function answered "absent" because `existsSync` could not see the file. A requester goal whose record cannot be inspected therefore stops `aidlc review release` and `aidlc review resolve` with exit 1 before any queue write, and every other reader of one stored record refuses such a record the same way.

## Why
Issue 303, found in the review of T0-REVIEW-RESOLVE-LOST and left out by name in the non_goals of T0-REVIEW-RESOLVE-LOST-2. Both commands journal a NOTE in each requester goal and then settle the review request, and both skip a goal the store does not hold. A goal whose record is there and cannot be inspected was read as not held, so the slot was freed without that goal's NOTE.

The rule is the one `IncidentLedger.present` already has for its file: only "no entry" means absent. It goes into `readJson`, so all 17 callers get it and none changes. The read's own error decides, with no look at the path first, which also removes the window between a check and the read.

On Windows a path under a regular file reports no entry, so that case cannot be told from a missing file there and stays "absent". The cases that change are on POSIX (a parent that cannot be searched, a parent that is a regular file) and, on every platform, a loop of links or a path the read refuses for another reason.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/store.test.ts tests/scenarios/review-resolve.test.ts tests/scenarios/review-release.test.ts tests/scenarios/fault-points.test.ts tests/infra/goal-store.test.ts tests/infra/lease.test.ts tests/infra/reconcile.test.ts tests/infra/review-queue.test.ts tests/infra/update-json.test.ts tests/infra/bounds.test.ts tests/surface/bounds.test.ts tests/surface/incident.test.ts tests/scenarios/release-lease.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every test of the listed files passes; on Windows the test of acceptance 3 is reported as skipped with its reason. dod arm 1 is the whole command.

## Callers
The 17 calls of `readJson` on main at aea950c0, in src/state/goal-store.ts, bounds.ts and store.ts, src/coordination/lease.ts, reconcile.ts and review-queue.ts, src/maintain/incident.ts and src/review/mutants.ts.

| Call | What it reads | With this card |
|---|---|---|
| goal-store.ts:44 `getGoal`, :72 `getCardRun`, :103 `getRelease`; lease.ts:54 `LeaseStore.read`; reconcile.ts:42 `OperationLedger.get`; review-queue.ts:114 `ReviewQueue.get`, :84 `ReviewQueue.pool` | one record by its path | changes - a read that fails with another code than `ENOENT` throws `READ_FAILED` where the caller got undefined (`pool` - the default empty pool) |
| bounds.ts:97 with a goal id | that goal's file | changes - `BoundsReadError` `cannot read "<file>": READ_FAILED` where it answered that the goal has no record |
| goal-store.ts:49, :92, :108; reconcile.ts:47; review-queue.ts:120; bounds.ts:97 without a goal id, :100 | the entries `listJsonFiles` returned | changes only for an entry the listing shows and the read cannot open (a directory with read and no search permission on POSIX, a loop of links) - it was dropped and now throws. A link to nothing is still dropped |
| incident.ts:36 | its file, after `present()` (its own `statSync`) | no change |
| mutants.ts:271 | the marker, after `markerOf` (its own `lstatSync`) | no change |
| store.ts:185 `updateJson` | the record, after the exclusive create of its lock file in the same directory | no change under a directory that cannot be searched (the create fails first, as on main); changes only when the record path itself is a loop of links |

## Acceptance detail

### 1. The read table (acceptance 1)
The record path is `<fixture>/unseen/rec.json`, and the test asserts first that `existsSync` of it is false. `fs.readFileSync` is routed through a wrapper that throws the row's error when it is called with that path and calls the real function for any other: the default export of `node:fs` is changed and `syncBuiltinESMExports()` called, and both are restored in a `finally` (the form of `throughFs` in tests/infra/update-json.test.ts). An error is `Object.assign(new Error(<message>), { code })`, with no `code` property in the last row.

| `code` | Message | `readJson(file, Rec)` |
|---|---|---|
| `ENOENT` | `ENOENT: no such file or directory, open` | returns undefined |
| `ENOENT` | `a message that names no code` | returns undefined |
| `EACCES` | `EACCES: permission denied, open` | throws |
| `ENOTDIR` | `ENOTDIR: not a directory, open` | throws |
| `ELOOP` | `ELOOP: too many symbolic links encountered, open` | throws |
| `EPERM` | `EPERM: operation not permitted, open` | throws |
| `EISDIR` | `EISDIR: illegal operation on a directory, read` | throws |
| `ENAMETOOLONG` | `ENAMETOOLONG: name too long, open` | throws |
| `EIO` | `EIO: i/o error, read` | throws |
| `EACCES` | `a denied read of ENOENT.json` | throws (the code decides, not the message) |
| `enoent` | `a code in another letter case` | throws (the code is compared exactly) |
| none | `an error with no code` | throws |

Each throwing row is checked whole: the error is a `StoreError`, its `code` is `READ_FAILED`, its `file` is the path and its `message` is `READ_FAILED: <the row's message> (<the path>)`. Because the path is not on disk, any look at the path before the read answers "absent" and fails every throwing row.

### 2. The real file system on both platforms (acceptance 2)
- A directory at the record path (`mkdirSync` of `<fixture>/real/dir.json`): `readJson` throws a `StoreError` with code `READ_FAILED` and that file. It does so on main too; the row pins it.
- A record path under a regular file (`<fixture>/real/plain` holds text; the path is `<fixture>/real/plain/rec.json`): on `win32` `readJson` returns undefined; on every other platform it throws a `StoreError` with code `READ_FAILED`, that file and `ENOTDIR` in its message. The test asserts the branch of the platform it runs on, and a comment in it says why they differ: under a regular file POSIX answers `ENOTDIR` and Windows answers that there is no entry, which no reader can tell from a missing file.

### 3. The real file system on POSIX (acceptance 3)
The test carries `{ skip: reason }` in the form of tests/scenarios/dirty-success.test.ts:235-236: on `win32` the reason `Windows has no POSIX mode bits, so a directory mode cannot hide a record`; when `process.getuid?.() === 0` the reason `root reads through any directory mode`; else `false`. It is one test, so the runner reports the skip and its reason.

A `GoalStore` over `ensureStatePaths(statePathsFromRoot(<fixture>/locked/.aidlc))` saves `makeGoal('goal-locked')`. Then, inside a `try` whose `finally` sets the goals directory back to mode 0o755:
- with the goals directory at mode 0o000, `store.getGoal('goal-locked')` throws a `StoreError` with code `READ_FAILED`, the goal file and `EACCES` in its message;
- with the goals directory at mode 0o600 (read and no search: the directory lists the entry and no entry can be opened), `store.listGoals()` throws the same.

After the `finally`, `store.getGoal('goal-locked')` returns the goal.

### 4. The readers of one record (acceptance 4)
One state directory under the fixture, with a `GoalStore`, a `LeaseStore`, an `OperationLedger` and a `ReviewQueue` over its directories. For each row the test asserts that the file is not on disk, that the reader answers as the last column says, and that with the read of that file failing with `EACCES` (message `EACCES: permission denied, open`, injected as in detail 1) the reader throws the `StoreError` of detail 1 for that file.

| Reader | File | Missing record |
|---|---|---|
| `store.getGoal('g-1')` | `store.goalFile('g-1')` | undefined |
| `store.getCardRun('g-1', 'T1-A')` | `store.cardFile('g-1', 'T1-A')` | undefined |
| `store.getRelease('rel-1')` | `store.releaseFile('rel-1')` | undefined |
| `leases.read('card:x')` | `leases.file('card:x')` | undefined |
| `ops.get('op-1')` | `<operations>/op-1.json` | undefined |
| `queue.get('k')` | `<review-queue>/<shortKey('k')>.json` | undefined |
| `queue.pool('default', at)`, `at` a fixed ISO timestamp | `<review-queue>/_pool-<shortKey('default')>.json` | `{ pool: 'default', maxConcurrent: 1, active: [], nextSeq: 0, usageKnown: false, updatedAt: at }` |
| `readBoundRecords(store, 'g-1')` | `store.goalFile('g-1')` | undefined; with the failing read it throws a `BoundsReadError` whose message is `cannot read <JSON.stringify of the file>: READ_FAILED` |

### 5. review resolve (acceptance 5)
In the subtest "a request or goal record that cannot be read" (main :384-412) the breaker list gains a fourth entry: code `READ_FAILED`, name "nothing, with a read that fails with EACCES", a replacement that writes nothing (the record stays removed), and the run options `{ preload: true, env: { FAIL_READ_OF: <the record's path>, FAIL_READ_CODE: 'EACCES' } }` for its `resolve` call. The fault module of the file (`PRELOAD`, main :103-125) has both switches and stays as it is; the three existing breakers pass no run options, as on main. The loop body and its assertions stay: exit 1; stderr starts with `aidlc: READ_FAILED: ` and ends with ` (<file>)` and a line feed; the snapshot of the state directory is unchanged; and for the goal record the request is still `lost`, the pool still holds it and neither requester goal has a `review-lost-resolved` NOTE.

### 6. review release (acceptance 6)
A helper `cliFailingRead(fx, key, file, code)` in the form of `cliFailingWrite` (main :71-83): a preload module written into the fixture that replaces `fs.readFileSync` so that a read of the path in `FAIL_READ_OF` throws `Object.assign(new Error('injected read failure'), { code: process.env.FAIL_READ_CODE })`, and calls `syncBuiltinESMExports()`.

One card and one goal (`goalForCards`) and one running request of a dead owner for `<goal>:<card>`. The text of the goal file is kept and the file removed; `queueFiles(fx)` is taken. Then:
- `cliFailingRead(fx, request.key, <goal file>, 'EACCES')` exits 1; its stderr is exactly `aidlc: READ_FAILED: injected read failure (<goal file>)` and a line feed; `queueFiles(fx)` is unchanged (no request or pool write, no lock left); the goal has no `review-slot-released` NOTE.
- With the goal file written back, `cli(fx, request.key)` exits 0, the pool has no active request, and the goal has the one NOTE `[goal.id, CARD, request.key, request.seq, REASON]`.

### 7. The texts (acceptance 8)
- The doc comment of `readJson` (main :85) says that a file that is not there (a read that fails with `ENOENT`) returns undefined and that any other failure to read it, and invalid content, throw. The wording is the implementer's.
- In the comment of `strictLedger`, the parenthesis "(`OperationLedger.list` drops an entry `existsSync` cannot see)" becomes "(`OperationLedger.list` drops a listed entry whose read finds no entry, such as a link to nothing)". No other word of that comment and no code of the file changes.
- changelog.d/T0-STORE-READ-ENOENT.md, one line and one line feed:

"- T0-STORE-READ-ENOENT (bugfix, issue 303): a stored record is read as absent only when reading its file fails with `ENOENT`. Any other failure to read the path, such as a parent directory that cannot be searched (`EACCES`), a parent that is a regular file on POSIX (`ENOTDIR`) or a loop of links, is `READ_FAILED` naming the file, where `readJson` answered that the record was absent because `existsSync` could not see it. So `aidlc review release` and `aidlc review resolve` exit 1 before any queue write when the record of a requester goal cannot be inspected, where they freed the slot without that goal's NOTE, and every command that reads a goal, a card run, a release attempt, a lease, an operation, a review request or a review pool by its path refuses such a record the same way. On Windows a path under a regular file reports no entry and is still read as absent."
