---
id: T0-JOURNAL-READ-ENOENT
title: Journal.readAll, head and verify read a goal journal as empty only when reading its file fails with ENOENT and throw READ_FAILED for any other failure, and LeaseStore.list lists through readDirNames, so aidlc audit verify refuses a journal it cannot read where it reported level none with an intact chain (issue 370)
status: todo
branch: T0-JOURNAL-READ-ENOENT
allow_paths:
  - src/state/journal.ts
  - src/coordination/lease.ts
  - tests/infra/helpers.ts
  - tests/infra/journal.test.ts
  - tests/infra/lease.test.ts
  - tests/surface/verifier.test.ts
  - changelog.d/T0-JOURNAL-READ-ENOENT.md
  - specs/tasks/T0-JOURNAL-READ-ENOENT.md
dod_command: npm run typecheck && node --test tests/infra/journal.test.ts tests/infra/journal-lock.test.ts tests/infra/lease.test.ts tests/infra/store.test.ts tests/surface/verifier.test.ts tests/surface/verifier-binding.test.ts tests/scenarios/audit.test.ts tests/scenarios/journal-owed.test.ts tests/scenarios/fault-points.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `Journal.readRawLines` (src/state/journal.ts:113-117) shall decide what the journal file answers from its one `readFileSync(this.file, 'utf8')` alone, with no look at the path before it - a read that throws an error whose `code` is exactly `ENOENT` returns `[]`, a read that throws anything else throws `StoreError('READ_FAILED', this.file, <the message of that error>)`, and a read that succeeds returns its non-blank lines as on main. `Journal.readAll` (:107-111) shall take its lines from `readRawLines` and parse each line as on main. So `readAll`, `head`, `verify` and `filter` answer for a journal file that is not there as on main and throw READ_FAILED for any other failure to read it.
  - R2. `LeaseStore.list` (src/coordination/lease.ts:136-149) shall take its names from `readDirNames(this.dir)` (src/state/store.ts), with its `.json` filter and its per-file parse-or-skip as on main; `readdirSyncSafe` (:160-166) is removed, the `node:fs` import line drops `existsSync` and `readdirSync`, and the `../state/store.ts` import line adds `readDirNames`.
  - R3. Every caller of `readAll`, `head`, `verify`, `filter` and `LeaseStore.list` shall keep its code as on main (body section Callers); in particular `verifyAudit` (src/audit/verifier.ts:58-62) throws READ_FAILED for a goal journal that cannot be read, so `aidlc audit verify` exits 1 with `aidlc: READ_FAILED: <message> (<file>)` where it reported level `none`, 0 events and an intact chain, and still reports level `none` for a journal that is not there.
  - R4. tests/infra/helpers.ts shall export `failingFs` and `fsError` with the signatures and behaviour of Acceptance detail 0, and acceptance 1, 4 and 5 inject their failures through them.
  - R5. The doc comments of `readAll`, `readRawLines` and `LeaseStore.list` and the new fragment changelog.d/T0-JOURNAL-READ-ENOENT.md shall carry the texts of Acceptance detail 6, and no document changes.
acceptance:
  - 1. tests/infra/journal.test.ts, new test "T0-JOURNAL-READ-ENOENT acceptance 1 - only a read error with the code ENOENT is an empty journal" - the table of Acceptance detail 1 over a journal file that is not on disk, each row run through `readAll`, `head`, `verify` and `filter`, with `fs.readFileSync` failing for that path through `failingFs`. Fails on main (each throwing row answers as for a missing file, since `existsSync` answers false first). [R1] [R4] [dod arm 1]
  - 2. Same file, new test "T0-JOURNAL-READ-ENOENT acceptance 2 - a directory at the journal path is READ_FAILED, and a journal under a regular file is READ_FAILED on POSIX and empty on Windows" - the rows of Acceptance detail 2 on the real file system, both platforms asserted and none skipped. The directory row fails on main on both platforms (a raw EISDIR error, not a `StoreError`); the POSIX branch of the second row fails on main; its Windows branch and the missing-file row pass on main and with this card. [R1] [dod arm 1]
  - 3. Same file, new test "T0-JOURNAL-READ-ENOENT acceptance 3 - a journal in a directory without search permission is READ_FAILED (EACCES), read directly or through verifyAudit", skipped with its stated reason on Windows and for root (Acceptance detail 3) - a journal of two events with its directory at mode 0o600, each of `readAll`, `head`, `verify`, `filter` and `verifyAudit` throwing `READ_FAILED` naming the journal file with `EACCES` in the message, the mode restored in a `finally`. Fails on main on POSIX (each answers as for a journal with no events). [R1] [R3] [dod arm 1]
  - 4. tests/surface/verifier.test.ts, new test "T0-JOURNAL-READ-ENOENT acceptance 4 - verifyAudit refuses a goal journal it cannot read and reports a missing one as level none" - Acceptance detail 4. Fails on main (level `none` with 0 events and an intact chain where READ_FAILED is due). [R3] [R4] [dod arm 1]
  - 5. tests/infra/lease.test.ts, new test "T0-JOURNAL-READ-ENOENT acceptance 5 - LeaseStore.list refuses a leases directory it cannot list and lists a missing one as empty" - the rows of Acceptance detail 5. Fails on main (the three refusing rows answer `[]`). [R2] [R4] [dod arm 1]
  - 6. The doc comments and the fragment hold the texts of Acceptance detail 6, the fragment followed by one line feed, tests/surface/changelog-fragments.test.ts and tests/surface/prose.test.ts pass with it, and `git diff origin/main -- CHANGELOG.md docs README.md` is empty (reviewer-verified against the diff). [R5] [dod arm 1]
  - 7. Every other test of the three changed test files and every test of the unchanged files of the DoD pass with no line changed - tests/infra/journal-lock.test.ts, store.test.ts, tests/surface/verifier-binding.test.ts, tests/scenarios/audit.test.ts, journal-owed.test.ts and fault-points.test.ts; and in the `npm test` run recorded before the first review, tests/scenarios/review-release.test.ts (its acceptance 6, a journal path made a directory, among them) and review-resolve.test.ts (its two journal-as-directory subtests among them) pass with no line changed. [R1] [R2] [R3] [dod arm 1]
depends_on: []
budget: 250
tdd: true
sweep: "Main at 0e14f387. `grep -rn 'readAll()' src` finds 12 calls besides the definition (src/state/journal.ts:107) - src/state/journal.ts:196 (`filter`, which has no caller under src/), src/audit/verifier.ts:62, src/cli/main.ts:983 (`review release`), :1040 (`review resolve`), src/loop/card-runner.ts:719 (`owedWith`), :735 and :738 (`deliverOwed`), :990 (`takeover`), :1387 (`ship`, the merge intent), src/loop/controller.ts:529 (`releaseGoalLease`), :994 (the ruling readmission). `readRawLines` is private and called by `head` (src/state/journal.ts:119, called only inside `append`) and `verify` (:163, called by src/audit/verifier.ts:60 alone). `Journal.exists` (:103) and `LeaseStore.list` have no caller under src/; tests/infra/journal.test.ts:17, journal-lock.test.ts:206 and tests/infra/lease.test.ts:189 call them. src/index.ts:27 and :30 export both classes from the package, so `LeaseStore.list` is kept and moved onto `readDirNames` rather than removed. Body section Callers says what changes for each call. Tests that replace `fs.readFileSync` - tests/scenarios/review-release.test.ts:93 and review-resolve.test.ts:110-125 fail or count reads of named files in a child; the only journal they count (review-resolve.test.ts:642, `COUNT_READS_BASE` of an existing journal under a held section) is read 0 times on main and with this card. tests/infra/goal-store.test.ts:271, tests/infra/store.test.ts:121-135, tests/scenarios/narration-quote.test.ts:41 and review-rule-goal.test.ts:36 name no journal file. A journal file that is not there is now read by a `readFileSync` that fails with ENOENT where `existsSync` answered first, so a test counting `readFileSync` calls on a missing journal would see one more; none does. review-release.test.ts:607-640 and review-resolve.test.ts:606-633 and :658-677 make a journal path a directory and assert exit 1 only; on main that read throws a raw EISDIR, with this card READ_FAILED, and both exit 1. Reproduced on 2026-11-18 with a throwaway harness outside the repository (never committed) - on Windows (Node 22.23.1) and on WSL Ubuntu (Node 22.23.1, temporary directories on ext4) a `readFileSync` of a journal file not on disk made to fail with EACCES gave `readAll` `[]`, `verify` `{ ok: true, events: 0 }` and `head` `{ seq: -1 }`, and `LeaseStore.list` of a directory holding one lease gave 0 leases with its `readdirSync` made to fail with EACCES; on WSL a journal under a regular file read as `[]` (ENOTDIR), and a journal of two events whose directory was at mode 0o600 gave `readAll` 0 events and `verifyAudit` level `none`, journal `{ events: 0, ok: true }` and no finding, where the same journal readable gave level `traceable` and 2 events."
forbid:
  - weakening, skipping or deleting a test to go green; the only platform skip is the test of acceptance 3, with its stated reason
  - an `existsSync`, `statSync`, `lstatSync` or `accessSync` of the journal file in `readAll` or `readRawLines`, or of the leases directory in `LeaseStore.list`
  - a change to `Journal.append`, `Journal.exists`, `resolveSessionId`, `currentActor` or the order or content of any journal write
  - a change under src/ outside `readAll` and `readRawLines` with their doc comments and the `./store.ts` import line of src/state/journal.ts, and `LeaseStore.list` with its doc comment, `readdirSyncSafe`, the `node:fs` import line and the `../state/store.ts` import line of src/coordination/lease.ts
  - a change to src/state/store.ts, src/audit/verifier.ts, src/cli/main.ts, src/loop/card-runner.ts, src/loop/controller.ts or src/hooks/index.ts
  - a change to .claude/skills/verify-card-run-writes/SKILL.md or to tests/scenarios/fault-points.test.ts
  - a new test file
  - in tests/infra/helpers.ts, a change other than the two new exports of Acceptance detail 0 and the import lines they need
  - a change to CHANGELOG.md, README.md or any file under docs/
  - in the test files a temporary directory outside the fixture's own, a directory left with a changed mode, or a process left running
non_goals:
  - "`Journal.exists` (src/state/journal.ts:103-105): a boolean that states the `existsSync` question in its name; no caller under src/"
  - "the `existsSync` of `session-default` in `resolveSessionId` (src/state/journal.ts:38-40): a false answer leads to a write that fails and the `s-<pid>` fallback, not to an empty read"
  - "the per-file read of `LeaseStore.list`, which skips a lease file that cannot be read or parsed as on main; the method has no caller under src/"
  - a journal line that is not JSON or fails the event schema; `readAll` throws as on main and `verify` reports it as on main
  - the other `existsSync` guards under src/ (85 calls in 21 files at 0e14f387); each is a separate question and none is named by issue 370
  - a journal under a regular file on Windows, a link to nothing, and a name the file system reports as no entry; each read fails with ENOENT and the journal reads as empty
  - a journal file that another process is deleting on Windows (the read fails with EPERM while the delete is pending); it is READ_FAILED with this card, and aidlc deletes no journal
  - a read that throws a value that is no Error object; `readFileSync` throws none, and the message of such a value is read as in `readJson`
  - a `JOURNAL_UNREADABLE` finding in `verifyAudit` or a per-goal report under `aidlc audit verify --all`; the verifier keeps its code and the command exits 1 at the first journal it cannot read
  - a document sentence; no document states what a journal read answers for a journal it cannot read
diagnosis:
  root_cause: "`Journal.readAll` and `Journal.readRawLines` asked `existsSync(this.file)` first and answered no lines when it said false. `existsSync` says false for every failure of the stat, not only for a file that is not there - a journal directory or state root that cannot be searched (EACCES), a parent that is a regular file on POSIX (ENOTDIR), a loop of links (ELOOP). So a goal journal that is there and cannot be read was read as a journal with no events. `verifyAudit` counts the events of `verify` and reads level `none` from 0 events, so `aidlc audit verify` reported level `none`, 0 events and an intact chain with no finding for a journal of two events it could not read (reproduced on WSL Linux at 0e14f387, journal directory at mode 0o600), where the readable journal is `traceable`. A journal file that is there and fails its read for another reason (mode 0o000 on the file, a directory at the path) already threw, but the raw node:fs error and not a `StoreError`. `LeaseStore.list` asked `existsSync(this.dir)` and then listed through `readdirSyncSafe`, which answered `[]` for every listing error."
  same_class: "`readJson` (T0-STORE-READ-ENOENT-2), `readDirNames`, `listJsonFiles` and `findInterruptedWrites` (T0-STORE-LIST-ENOENT-2) already have the rule; `LeaseStore.list` moves onto `readDirNames` here. `Journal.exists`, the `session-default` check of `resolveSessionId` and the other `existsSync` guards under src/ are left out (non_goals)."
hygiene: "Issue 370, named in the non_goals and same_class of T0-STORE-LIST-ENOENT-2 (PR 369). Line numbers are from main at 0e14f387; read them again at PREPARE. Tests first, in two commits - the seam commit adds `failingFs` and `fsError` to tests/infra/helpers.ts and the tests of acceptance 1 to 5 with src/ as on main, and RED on Windows is acceptance 1, the directory row of acceptance 2, acceptance 4 and the three refusing rows of acceptance 5 failing (the second row of acceptance 2 passes there on its Windows branch; acceptance 3 is skipped with its reason); the second commit changes `readRawLines`, `readAll` and `LeaseStore.list`, writes the comments and adds the fragment. Run tests/infra/journal.test.ts, tests/infra/lease.test.ts and tests/surface/verifier.test.ts on Linux as well as Windows before the first R3 (docs/LESSONS.md 2026-11-11 T0-DIRTY-SUCCESS-2) - acceptance 3 and the POSIX branch of acceptance 2 run nowhere else before CI. This machine has WSL (distribution Ubuntu) with Node 22.23.1 at ~/node22/bin/node, which is not on the login PATH; record the Linux run in the Attempt evidence, or say that it could not be run. Every command that reads a goal journal reads through `readRawLines`, so also run `npm test` once on Windows before the first review and record its counts (CLAUDE.md, Verifying your work). Revert table before the first review, each a scratch change run alone and restored afterwards - the `existsSync` line put back in `readRawLines` (acceptance 1 rows through `head` and `verify`, acceptance 4 and the `verify` row of acceptance 3 red); the `existsSync` line put back in `readAll` with `readAll` reading the file itself (acceptance 1 rows through `readAll` and `filter` red); `readdirSyncSafe` put back in `LeaseStore.list` (acceptance 5 refusing rows red); the comparison of the code replaced by a search of the message for ENOENT (the row `a denied read of ENOENT.jsonl` red); the comparison made case-insensitive (the `enoent` row red); every read error read as empty (each throwing row of acceptance 1 and the directory row of acceptance 2 red); ENOENT thrown as READ_FAILED (the ENOENT rows of acceptance 1, the missing rows of acceptance 2, 4 and 5 and the existing test `head() on an empty journal is the genesis hash` red); the file left out of the StoreError (acceptance 1 red). Write protocol - .claude/skills/verify-card-run-writes/SKILL.md names src/state/journal.ts for `Journal.append`, which reads the head through `readRawLines` inside its lock section; this card changes that read and no write or its order (a head read that fails with another code than ENOENT threw on main too, a raw node:fs error from `readFileSync` or from the append behind a false `existsSync`, and now throws READ_FAILED before the append), so the outcome is in sync, tests/scenarios/fault-points.test.ts is in the DoD, and the skill file and its sync commit stay as they are. Documents - checked on main at 0e14f387 that no sentence states what a journal read answers for a journal it cannot read; docs/ARCHITECTURE.md:212 (`none` (no events)) and docs/OPERATIONS.md:601 (the levels and findings of `audit verify`) stay true. The card adds no test file, so it moves no file between the CI shards. The DoD test list took 94 s on main at 0e14f387 on Windows with the machine at 100% CPU from other sessions (typecheck clean); review-release.test.ts (222 s alone) and review-resolve.test.ts (242 s alone) are left out of it for that reason and run in the `npm test` run before the first review and in CI."
doc_sync: changelog.d/T0-JOURNAL-READ-ENOENT.md
---

# T0-JOURNAL-READ-ENOENT

## Deliverable
`Journal.readAll`, `head`, `verify` and `filter` answer that a goal journal is empty only when reading its file fails with `ENOENT`. Any other failure to read it is `READ_FAILED` naming the file, where they answered as for a journal with no events because `existsSync` could not see the file. `LeaseStore.list` lists the leases directory through `readDirNames`, so a directory that cannot be listed is `READ_FAILED` where it answered no leases. `aidlc audit verify` therefore refuses a journal it cannot read, where it reported level `none` with an intact chain, and every command that reads a goal journal refuses such a file.

## Why
Issue 370, left out by name in the non_goals of T0-STORE-LIST-ENOENT-2. Those two cards gave the store the rule "only no entry means absent" for one record and for a directory; the journal reads and the lease listing kept the `existsSync` check. `existsSync` says false for a file that is there when its stat fails for another reason: a directory that cannot be searched, a parent that is a regular file on POSIX, a loop of links.

The audit verifier is the reader whose answer is wrong. It counts the events of `verify`, so a goal journal of two events in a journal directory at mode 0o600 reported level `none`, 0 events and an intact chain, with no finding (reproduced on WSL Linux at 0e14f387); the same journal readable is `traceable`. The other readers append to the journal after they read it, and on POSIX the append behind a false `existsSync` fails too; with this card they stop at the read, with a `StoreError` naming the file.

The rule is the one `readJson` and `readDirNames` already have. On Windows a journal under a regular file reports no entry, so it cannot be told from a missing journal there and stays empty.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/journal.test.ts tests/infra/journal-lock.test.ts tests/infra/lease.test.ts tests/infra/store.test.ts tests/surface/verifier.test.ts tests/surface/verifier-binding.test.ts tests/scenarios/audit.test.ts tests/scenarios/journal-owed.test.ts tests/scenarios/fault-points.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every test of the listed files passes; on Windows the test of acceptance 3 is reported as skipped with its reason. dod arm 1 is the whole command.

## Callers
On main at 0e14f387. "Cannot be read" below means a read of the journal file that fails with another code than `ENOENT`; a journal file that is not there reads as empty, as on main. On main such a read answered no lines when `existsSync` was false (a parent that cannot be searched, a parent that is a regular file on POSIX, a loop of links) and threw the raw node:fs error when it was true (a file without read permission, a directory at the path); with this card both throw `READ_FAILED` naming the file.

| Call | With this card |
|---|---|
| src/audit/verifier.ts:60 `verify`, :62 `readAll` (`aidlc audit verify`, src/cli/main.ts:1470) | a journal that cannot be read throws out of `verifyAudit`, and the command exits 1 with `aidlc: READ_FAILED: <message> (<file>)` (bin/aidlc.js), where it reported level `none`, 0 events and an intact chain; with `--all` the first such journal ends the command |
| src/loop/card-runner.ts:719 `owedWith`, :735 and :738 `deliverOwed`, :1387 `ship` | the command throws `READ_FAILED` at the read, where it read no events and then failed at the append (on POSIX the append behind a false `existsSync` fails too); :738 is inside the card-run lock section, which `updateJson` ends as it ends any section that throws, with the record unchanged |
| src/loop/card-runner.ts:990 `takeover` | a journal of this goal or of another goal holding a run of the card that cannot be read throws inside the lease section, which `updateJson` ends with the lease unchanged |
| src/loop/controller.ts:529 `releaseGoalLease` (CLOSE) | throws inside the goal lease section with the lease unchanged; the lease is settled before DONE is saved (src/loop/controller.ts:505), so the goal stays in CLOSE |
| src/loop/controller.ts:994 the ruling readmission | throws inside the goal lock section with the goal unchanged |
| src/cli/main.ts:983 `review release`, :1040 `review resolve` | throws inside the queue section before the queue is written, as a failed append did; a requester goal journaled before it keeps its NOTE and running the command again finishes it (review-release.test.ts acceptance 6, review-resolve.test.ts) |
| src/state/journal.ts:119 `head` inside `append` | a head read that cannot be read throws `READ_FAILED` and nothing is appended; on main the append failed there too, with a raw error |
| `Journal.filter`, `LeaseStore.list` | no caller under src/ |

## Acceptance detail

### 0. The injection helpers (R4)
tests/infra/helpers.ts adds two exports in the form of `failingRead`, `failingList` and `readError` of tests/infra/store.test.ts, which stay as they are:
```ts
/** `body` with `fs[name]` throwing `error` for the path `target` and calling the real function for any other; the real function is restored after. */
export function failingFs<T>(name: 'readFileSync' | 'readdirSync', target: string, error: unknown, body: () => T): T
/** An error of a row: its message, and its code unless the row has none. */
export function fsError(code: string | undefined, message: string): Error
```
`failingFs` changes the default export of `node:fs` and calls `syncBuiltinESMExports()` from `node:module`, and restores both in a `finally`.

### 1. The read table (acceptance 1)
The journal is `Journal.forGoal(<fixture>/unseen, 'g-1')` and the test asserts first that `existsSync` of its file is false. Each row's error is `fsError(code, message)`, thrown through `failingFs('readFileSync', <the journal file>, ...)`. Each row is run through `readAll()`, `head()`, `verify()` and `filter(() => true)`.

| `code` | Message | Each of the four |
|---|---|---|
| `ENOENT` | `ENOENT: no such file or directory, open` | answers as for a missing file: `[]`, `{ seq: -1, hash: GENESIS_HASH }`, `{ ok: true, events: 0, head: GENESIS_HASH, problems: [] }`, `[]` |
| `ENOENT` | `a message that names no code` | the same |
| `EACCES` | `EACCES: permission denied, open` | throws |
| `ENOTDIR` | `ENOTDIR: not a directory, open` | throws |
| `ELOOP` | `ELOOP: too many symbolic links encountered, open` | throws |
| `EPERM` | `EPERM: operation not permitted, open` | throws |
| `EISDIR` | `EISDIR: illegal operation on a directory, read` | throws |
| `EIO` | `EIO: i/o error, read` | throws |
| `EACCES` | `a denied read of ENOENT.jsonl` | throws (the code decides, not the message) |
| `enoent` | `a code in another letter case` | throws (the code is compared exactly) |
| none | `an error with no code` | throws |

Each throwing row is checked whole: the error is a `StoreError`, its `code` is `READ_FAILED`, its `file` is the journal file and its `message` is `READ_FAILED: <the row's message> (<the journal file>)`. Because the file is not on disk, any look at the path before the read answers "empty" and fails every throwing row.

### 2. The real file system on both platforms (acceptance 2)
- A directory at the journal path (`<fixture>/real/g-dir.jsonl` made a directory): each of the four throws a `StoreError` with code `READ_FAILED`, that path as `file` and `EISDIR` in its message, on every platform.
- A journal under a regular file (`<fixture>/real/plain` holds text; the journal is `new Journal(<fixture>/real/plain/g.jsonl)`): on `win32` each of the four answers as for a missing file (detail 1); on every other platform each throws a `StoreError` with code `READ_FAILED`, that path and `ENOTDIR` in its message. The test asserts the branch of the platform it runs on, and a comment in it says why they differ: under a regular file POSIX answers `ENOTDIR` and Windows answers that there is no entry, which no reader can tell from a missing file.
- A journal that is not there (`<fixture>/real/none/g.jsonl`): each answers as for a missing file, as on main.

### 3. The real file system on POSIX (acceptance 3)
The test carries `{ skip: reason }`: on `win32` the reason `Windows has no POSIX mode bits, so a directory mode cannot hide a journal`; when `process.getuid?.() === 0` the reason `root reads through any directory mode`; else `false`.

`Journal.forGoal(<fixture>/locked/journal, 'g-locked')` is given two events with the file's `actor` helper and fixed `ts`. Then, inside a `try` whose `finally` sets `<fixture>/locked/journal` back to mode 0o755, with that directory at mode 0o600 (read and no search) each of `readAll()`, `head()`, `verify()`, `filter(() => true)` and `verifyAudit({ goalId: 'g-locked', journal, now: <a fixed ISO time> })` throws a `StoreError` with code `READ_FAILED`, the journal file as `file` and `EACCES` in its message. After the `finally`, `readAll()` returns the two events.

### 4. The audit verifier (acceptance 4)
The file's `fixture()` with no event appended, and the test asserts that `existsSync(f.journal.file)` is false.
- With no injection, `verifyAudit({ goalId: f.goalId, journal: f.journal, operations: f.operations, now })` returns level `none`, `journal` `{ events: 0, head: GENESIS_HASH, ok: true }` and no finding, as on main.
- With `fs.readFileSync` of `f.journal.file` failing with `fsError('EACCES', 'EACCES: permission denied, open')` through `failingFs`, the same call throws the `StoreError` of detail 1 for that file and message.

### 5. LeaseStore.list (acceptance 5)
Under `<fixture>/list-enoent` (outside the `leases` directory the file's other tests share), each row asserts the result named:

| Row | Directory | Result |
|---|---|---|
| missing | `<fixture>/list-enoent/missing`, asserted not on disk | `[]` |
| missing, listing failing with EACCES | the same, with `failingFs('readdirSync', <dir>, fsError('EACCES', 'EACCES: permission denied, scandir'), ...)` | throws the `StoreError` `READ_FAILED` of that directory and message, checked whole as in detail 1 |
| one lease | `<fixture>/list-enoent/held`, holding one lease claimed with the file's `A` actor | that one lease (`resourceKey`, `generation` 0, `released` false) |
| one lease, listing failing with EACCES | the same, injected as above | throws the `StoreError` of detail 1 for that directory |
| a regular file at the directory path | `<fixture>/list-enoent/plain` holding text, on the real file system | throws a `StoreError` with code `READ_FAILED`, that path as `file` and `ENOTDIR` in its message, on every platform |

### 6. Texts (acceptance 6)
The doc comment of `readAll`, which has none on main:
```ts
  /** Every event of the journal, each line parsed; a journal file that cannot be read throws READ_FAILED (`readRawLines`). */
```
The doc comment of `readRawLines`:
```ts
  /**
   * The non-blank lines of the journal file, for verification (does not throw on malformed lines). A file that is not there
   * (its read fails with the code ENOENT) has none; any other failure to read it throws READ_FAILED naming the file.
   */
```
The doc comment of `LeaseStore.list`, which has none on main:
```ts
  /** Every lease file of the directory that parses, skipping one that cannot be read or parsed; a directory that cannot be listed throws READ_FAILED (`readDirNames`). */
```
changelog.d/T0-JOURNAL-READ-ENOENT.md, one line and a line feed:
```
- T0-JOURNAL-READ-ENOENT (bugfix, issue 370): a goal journal is read as empty only when reading its file fails with `ENOENT`. Any other failure, such as a journal directory that cannot be searched (`EACCES`) or a parent that is a regular file on POSIX (`ENOTDIR`), is `READ_FAILED` naming the file, where `Journal.readAll`, `head` and `verify` answered as for a journal with no events because `existsSync` could not see the file. So `aidlc audit verify` exits 1 with `aidlc: READ_FAILED: <message> (<file>)` for a journal it cannot read, where it reported level `none` with an intact chain, and every command that reads a goal journal refuses such a file. `LeaseStore.list` lists through `readDirNames`: a leases directory that cannot be listed is `READ_FAILED`, where it answered no leases. On Windows a journal under a regular file reports no entry and still reads as empty.
```

## Attempt evidence
</content>
</invoke>
