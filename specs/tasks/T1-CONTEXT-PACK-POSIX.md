---
id: T1-CONTEXT-PACK-POSIX
title: readOpenedSource reads a context source on a platform other than Windows and Linux by opening it without following a final link, requiring that the validated path still resolves to itself and that the opened descriptor and the path name one device and inode
status: todo
branch: T1-CONTEXT-PACK-POSIX
worktree: D:\wt\AIDLC\T1-CONTEXT-PACK-POSIX
plan_ref: plans/install-portability.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - src/loop/context-pack.ts
  - tests/scenarios/context-pack.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T1-CONTEXT-PACK-POSIX.md
  - specs/tasks/T1-CONTEXT-PACK-POSIX.md
dod_command: npm run typecheck && node --test tests/scenarios/context-pack.test.ts tests/core/context-pack.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `process.platform` is neither `win32` nor `linux`, `readOpenedSource` (src/loop/context-pack.ts:45) shall open `resolved` with the flags of the Linux branch (:59), throw `Opened context source path changed` unless `realpathSync.native(resolved)` equals `resolved` and the `dev` and `ino` of `fstatSync(fd, { bigint: true })` equal those of `lstatSync(resolved, { bigint: true })`, and otherwise return `readFileSync(fd, 'utf8')`.
  - R2. The new branch shall close the descriptor on every path, in a `finally` as the Linux branch does (:63), and let an error thrown by the open, by `realpathSync.native`, by `fstatSync`, by `lstatSync` or by the read propagate unchanged, as the Linux branch propagates the error of its `realpathSync` (tests/scenarios/context-pack.test.ts:159-174).
  - R3. The `win32` branch (:46-57) and the `linux` branch (:59-63) shall keep every line; the throw of :58 is the one statement the new branch replaces.
  - R4. docs/OPERATIONS.md shall carry the sentence of acceptance detail 2 in the paragraph of :57, directly before its last sentence.
  - R5. The new changelog.d/T1-CONTEXT-PACK-POSIX.md shall hold the entry of acceptance detail 3 followed by one line feed.
acceptance:
  - 1. `tests/scenarios/context-pack.test.ts`, new test "T1-CONTEXT-PACK-POSIX acceptance 1: on a platform other than win32 and linux the plan file and docs/LESSONS.md are read". With `process.platform` set to `darwin` as :161-172 sets it, `loadContextPack` returns the plan text and the matching lesson line. Fails on main by assertion (`Opened context source verification requires Windows or Linux`). [R1] [dod arm 2]
  - 2. Same file, new test "T1-CONTEXT-PACK-POSIX acceptance 2: on that platform a parent-directory swap after resolution is refused before outside content is read". The fixture and the swap of :195-226 for `plans/plan.md` and `docs/LESSONS.md`, under platform `darwin`; the error matches `/^Error: Opened context source path changed$/` and the swap happened. Fails on main by assertion (the other message). [R1] [dod arm 2]
  - 3. Same file, new test "T1-CONTEXT-PACK-POSIX acceptance 3: a path whose device or inode differs from the opened descriptor is refused and the descriptor is closed". Two rows under platform `darwin`, each with `fs.lstatSync` replaced for the resolved plan path (as :168 replaces `fs.realpathSync`) by a value built from the real one, the first with `ino` plus 1n, the second with `dev` plus 1n; each throws `Opened context source path changed`, and a spy shows `fs.closeSync` was called with the descriptor `fs.openSync` returned. Fails on main by assertion. [R1] [R2] [dod arm 2]
  - 4. Same file, new test "T1-CONTEXT-PACK-POSIX acceptance 4: an error of the path check propagates unchanged and the descriptor is closed". Under platform `darwin`, `fs.lstatSync` replaced to throw an error object for the resolved plan path; `loadContextPack` throws that same object and the descriptor was closed. Fails on main by assertion. [R2] [dod arm 2]
  - 5. Same file, new test "T1-CONTEXT-PACK-POSIX acceptance 5: a final component replaced by a link after resolution is not read", skipped on a `win32` host (Node defines no `O_NOFOLLOW` there, and creating a file link needs a privilege). Under platform `darwin` on a POSIX host, the mocked `fs.realpathSync.native` replaces `plans/plan.md` by a link to an outside file after the first resolution; `loadContextPack` throws an error whose `code` is `ELOOP`, the error of the open, and the swap happened. Fails on main by assertion on a POSIX host (main throws an error with no `code`). [R1] [R2] [dod arm 2]
  - 6. The twelve tests of tests/scenarios/context-pack.test.ts that exist on main (:11 to :245) and tests/core/context-pack.test.ts pass with no line changed. They pass on main and with this card. [R3] [dod arm 2]
  - 7. The sentence of acceptance detail 2 stands in docs/OPERATIONS.md, and changelog.d/T1-CONTEXT-PACK-POSIX.md holds the entry of acceptance detail 3 followed by one line feed (reviewer-verified against the diff); tests/surface/changelog-fragments.test.ts passes with the new file. [R4] [R5] [dod arm 2]
depends_on: [T1-CHANGELOG-FRAGMENTS]
budget: 130
tdd: true
sweep: "On main at 35de54fe. `grep -rnlE 'context-pack|readOpenedSource|loadContextPack' src tests docs README.md CHANGELOG.md`: src/loop/context-pack.ts, src/loop/controller.ts (the caller of `loadContextPack`), tests/core/context-pack.test.ts (`contextPack` only, no I/O), tests/scenarios/context-pack.test.ts, docs/ARCHITECTURE.md:42, docs/OPERATIONS.md:57, CHANGELOG.md. `readOpenedSource` (:45-64) is not exported and reads `process.platform` at :46 and :58. The tests reach a platform branch by replacing the `platform` property of `process` and calling `syncBuiltinESMExports()` (tests/scenarios/context-pack.test.ts:161-172 for linux, :178-190 for win32), and replace fs functions the same way (:168, :122-131), so the new branch needs no export and no new parameter. `grep -rn 'requires Windows or Linux' tests docs README.md`: no hit, so no test or document pins the message of :58. tests/scenarios/context-pack.test.ts:195-226 runs the parent-directory swap on the host platform and expects `Opened context source path changed`; on a host that is neither Windows nor Linux that test reaches the new branch, so the branch must refuse a parent swap. A comparison of `fstatSync(fd)` with `lstatSync(resolved)` alone does not: `lstat` follows every component but the last, so after the swap both name the outside file. The second resolution of R1 is what refuses it. Measured on Windows with Node 22.23.1 on 2026-11-16: `fs.constants.O_NOFOLLOW` and `O_NONBLOCK` are undefined, so the flag expression of :59 is 0 there, and `ino` of a file was 259801403506366105, above 2 to the power 53, hence the bigint stats. docs/OPERATIONS.md:57 is in the section Running a goal, which tests/surface/prose.test.ts does not size (it sizes Sessions, :326-359); `grep -rn 'Before reading, the opened file' tests`: no hit."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of a test that exists on main
  - a change to the `win32` branch, to the `linux` branch, to `windowsRead`, to `contextPack` or to `loadContextPack`
  - an export of `readOpenedSource`, a platform parameter, or a read of the platform from anything but `process.platform`
  - a read of the file by its path after the checks; the text comes from the opened descriptor
  - stats compared as numbers; `dev` and `ino` are compared as bigint
  - a new file under src, or a new dependency
  - the sequence of two hash signs and a space in the entry
non_goals:
  - a hard link inside the repository to a file outside it; the opened file and the path are then one inode and the text is read, as on Linux
  - a FIFO or a device at the validated path; the new branch opens with the flags of the Linux branch and adds no file-type check
  - a swap made and undone between the open and the checks that leaves the path naming the opened file again; the file read is then the one the path names
  - a `win32` host with the platform replaced; acceptance 1 to 4 run there with flags 0 and prove the checks, and only acceptance 5 needs a POSIX host
  - fixing other tests that fail on macOS, and the macOS CI job, which T1-CI-MACOS adds
  - docs/ARCHITECTURE.md, whose sentence on `context-pack.ts` (:42) names no platform
hygiene: "Line numbers are from main at 35de54fe; read them again at PREPARE. Tests first, in two commits: the first adds the five tests and records acceptance 1 to 4 failing on main by assertion on this machine (acceptance 5 is skipped on Windows); the second adds the branch. Each new test restores `process.platform`, every replaced fs function and `syncBuiltinESMExports()` in a `finally`, as :172 and :190 do. Run the two test files on Linux as well as Windows before the first review (lesson 2026-11-11 T0-DIRTY-SUCCESS-2), since acceptance 5 runs only on a POSIX host; a WSL or container run recorded in the Attempt evidence is enough, and if none is available say so in the Attempt evidence and leave the proof of acceptance 5 to the Ubuntu check of the pull request. Revert table, each row a scratch change restored afterwards: the second `realpathSync.native` check dropped (2 red); the `ino` comparison dropped (3 red, first row); the `dev` comparison dropped (3 red, second row); `closeSync` moved out of the `finally` (3 and 4 red); the text read by path instead of from the descriptor (reviewer row, no test tells the two apart); the throw of :58 kept (1 red). Run `npm test` once before the first review, since tests/infra/update-json.test.ts and tests/core/parse-guard.test.ts scan all of src."
---

# T1-CONTEXT-PACK-POSIX

## Deliverable
The context pack of a `run-card` directive loads on macOS and every other platform that is neither Windows nor Linux: `readOpenedSource` gains a third branch that reads the validated file from an opened descriptor after checking that the path still names that file.

## Why
Outside review of 2026-11-16, confirmed on main at 35de54fe: `readOpenedSource` throws `Opened context source verification requires Windows or Linux` (src/loop/context-pack.ts:58) on any other platform, so `aidlc next` cannot build a `run-card` directive there. Spec specs/install-portability.md R7.

The plan names a comparison of the descriptor's device and inode with those of the path. That comparison alone does not refuse a parent-directory swap, which tests/scenarios/context-pack.test.ts:195 requires on the host platform, because `lstat` resolves every component but the last. The branch therefore also resolves the validated path again and requires the same path back. Windows keeps its handle-path check and Linux its `/proc/self/fd` check.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/context-pack.test.ts tests/core/context-pack.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; no existing test line changes. Arm 1 is the typecheck, arm 2 the test files.

## Acceptance detail

### 1. The branch
In place of the throw of :58: open `resolved` with `constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK`; then, inside a `try` whose `finally` closes the descriptor: if `realpathSync.native(resolved) !== resolved`, throw `Opened context source path changed`; read `fstatSync(fd, { bigint: true })` and `lstatSync(resolved, { bigint: true })`, and if `dev` or `ino` differ, throw the same message; return `readFileSync(fd, 'utf8')`.

Input forms and failure paths: a regular file (read); a path whose parent became a link (second resolution differs: refused); a path that now names another file (device or inode differs: refused); a final component that became a link (the open fails with the system error, `ELOOP` on Linux and macOS, which propagates); a path removed after resolution (the open or a check throws `ENOENT`, which propagates).

### 2. The OPERATIONS sentence
`On any other platform, macOS included, the reader opens the file without following a final link, requires that the validated path still resolves to itself, requires the device and inode of the opened descriptor to equal those of the path, and reads that descriptor (card T1-CONTEXT-PACK-POSIX).`

It goes directly before `This prevents a concurrent directory-link swap from redirecting the read.`

### 3. The entry
changelog.d/T1-CONTEXT-PACK-POSIX.md (new), this one line and one line feed:

"- T1-CONTEXT-PACK-POSIX: the context pack of a `run-card` directive loads on macOS and every other platform that is neither Windows nor Linux. Before, `readOpenedSource` threw `Opened context source verification requires Windows or Linux` there. On those platforms the reader opens the validated file without following a final link, refuses with `Opened context source path changed` when the validated path no longer resolves to itself or when the device and inode of the opened descriptor differ from those of the path, and reads the descriptor. The Windows and Linux readers are unchanged."
