---
id: T0-REVIEW-QUEUE-KEY
title: ReviewQueue.hold, cancel and release free the slot of the request's stored key, and aidlc review release journals its NOTE and checks a retry by that stored key, so a key given in another letter case or with backslashes leaves no stale active entry and no second NOTE (issue 304)
status: todo
superseded_by: T0-REVIEW-QUEUE-KEY-2
branch: T0-REVIEW-QUEUE-KEY
worktree: D:\wt\AIDLC\T0-REVIEW-QUEUE-KEY
allow_paths:
  - src/coordination/review-queue.ts
  - src/cli/main.ts
  - tests/infra/review-queue-key.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T0-REVIEW-QUEUE-KEY.md
  - specs/tasks/T0-REVIEW-QUEUE-KEY.md
dod_command: npm run typecheck && node --test tests/infra/review-queue-key.test.ts tests/infra/review-queue.test.ts tests/scenarios/review-resolve.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
requirements:
  - R1. `ReviewQueue.hold`, `ReviewQueue.cancel` and `ReviewQueue.release` (src/coordination/review-queue.ts) shall remove the stored `request.key` of the request they found from its pool's `active` list, as `resolveLost` does, whatever spelling of the key the caller passed (the request is found by `shortKey`, which ignores letter case and reads `\` as `/`). Every other effect of the three methods (the request record written, the pool's reset and notification owner after a hold, the refusals of release) is unchanged.
  - R2. `aidlc review release <key>` shall journal its `review-slot-released` NOTE with the request's stored key as `data.key`, and shall test whether a requester goal already holds that NOTE (the retry check) by the stored key, its pool and its seq, so a release typed in another spelling and a retry typed in the stored spelling find the same NOTE and append no second one. The NOTE's other fields and the command's refusals and output are unchanged.
  - R3. `docs/OPERATIONS.md` shall state, in the paragraph on `aidlc review release`, that the command frees the slot of the request's stored key and journals its NOTE under that key also when `<key>` is given in another letter case or with `\` for `/`; the change shall be recorded in the fragment `changelog.d/T0-REVIEW-QUEUE-KEY.md` (the form of changelog.d/README.md) under this card id and issue 304, and `CHANGELOG.md` shall not change.
acceptance:
  - 1. tests/infra/review-queue-key.test.ts - for each of `hold`, `cancel` and `release`, and for each of two spellings of a stored key (all upper case, and every `/` written as `\`), a running request whose key holds a `/` and lower-case letters is found and settled, and afterwards the pool's `active` list does not hold the stored key; with the stored spelling the result is the same; on main the upper-case and backslash rows leave the stored key in `active`. `release` uses an owner pid that no process can hold (above the range the platform hands out, the direction of issue 312), never the pid of an exited child. [R1] [dod arm 1]
  - 2. tests/infra/review-queue-key.test.ts, through the CLI with a state directory holding one requester goal and a running request of that goal - `aidlc review release <upper-case spelling> --reason r` exits 0, the goal journal holds one `review-slot-released` NOTE whose `data.key` is the stored key, and the pool's `active` list does not hold the stored key; a second `aidlc review release <stored spelling>` after a failed write left the request running (simulated by restoring the request file to running) appends no second NOTE; on main the first call's NOTE names the upper-case spelling and the retry appends a second NOTE. [R2] [dod arm 1]
  - 3. tests/infra/review-queue.test.ts and tests/scenarios/review-resolve.test.ts pass unchanged; tests/scenarios/review-release.test.ts is unchanged and passes in CI (it is left out of the DoD while issue 312 makes it flaky on Windows). [R1] [R2] [dod arm 1]
  - 4. docs/OPERATIONS.md carries the sentence of R3 and the fragment carries the entry; a test reads the exact sentence and the fragment line (with `fragmentEntry` of tests/infra/changelog.ts) and fails with either removed; tests/surface/changelog-fragments.test.ts passes. [R3] [dod arm 1]
depends_on: []
budget: 200
tdd: true
sweep: "grep -n 'releaseSlot(' src/coordination/review-queue.ts: `resolveLost` (line 259) and the admission path (line 242) pass `r.key`; `hold` (273), `cancel` (296) and `release` (326) pass the caller's `key`, and `releaseSlot` filters `active` by exact string (line 341). grep -n \"review-slot-released\" src/cli/main.ts: the `release` action journals `key` as supplied and checks a retry with `e.data['key'] === key` (lines 980-981); the `resolve` action uses `request.key` for both (lines 1033-1034). `requestFile` already maps every spelling to the same file through `shortKey`."
forbid: [weakening or skipping a test to go green, a change to `shortKey` or to how a request is found, a change to admission or to `resolveLost`, a change to the refusals of release, a change to CHANGELOG.md]
non_goals: [the dead-pid helper of tests/scenarios/review-release.test.ts (issue 312), a goal record the store cannot see (issue 303), the output line of review release]
diagnosis:
  root_cause: "`hold`, `cancel` and `release` find the request by `shortKey` of the supplied key but call `releaseSlot(r.pool, key, now)` with the supplied spelling, and `releaseSlot` removes only an exact match from `active`, so a key given in another letter case or with `\\` leaves the stored key in the pool file; the `release` CLI action also journals and dedupes its NOTE by the supplied spelling. Card T0-REVIEW-RESOLVE-LOST fixed the same defect in `resolveLost` and `review resolve` only (same_class and non_goals of specs/tasks/T0-REVIEW-RESOLVE-LOST-2.md)."
  same_class: "Every method of ReviewQueue that takes a key and frees a slot: hold, cancel, release (this card), resolveLost (fixed). Every CLI action that journals a NOTE keyed by a queue key: review release (this card), review resolve (fixed)."
hygiene: "Issue 304. A test of release needs a slot owner pid that is dead; use one no process can hold rather than the exited-child helper of review-release.test.ts, which issue 312 reports flaky on Windows. Give each changed call its own failing-when-removed row (docs/LESSONS.md 2026-11-17 T1-OUTCOME-ESCAPED). Run every test file that reads docs/OPERATIONS.md before the first R3 (docs/LESSONS.md 2026-11-11 T0-RELEASE-OP-REISSUE); grep tests/ for a pin of the release paragraph first (docs/LESSONS.md 2026-11-15 T1-REPLAY-CLEAN)."
doc_sync: docs/OPERATIONS.md, changelog.d/T0-REVIEW-QUEUE-KEY.md
---

# T0-REVIEW-QUEUE-KEY

## Deliverable
`hold`, `cancel` and `release` free the slot of the stored key of the request they settle, and `aidlc review release` journals and dedupes its NOTE by that stored key, so any spelling `shortKey` maps to the request leaves the pool and the journal as the stored spelling does.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/review-queue-key.test.ts tests/infra/review-queue.test.ts tests/scenarios/review-resolve.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
