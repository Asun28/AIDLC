---
id: T0-REVIEW-RELEASE
title: Every mutation of the review queue runs in one lock section, and `aidlc review release` frees the slot of a process that died, journaled in that same section
status: todo
branch: T0-REVIEW-RELEASE
worktree: D:\wt\AIDLC\T0-REVIEW-RELEASE
allow_paths:
  - src/coordination/review-queue.ts
  - src/state/store.ts
  - src/cli/main.ts
  - tests/infra/review-queue.test.ts
  - tests/scenarios/review-release.test.ts
  - tests/scenarios/run-driver.test.ts
  - tests/scenarios/t0-flow.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-REVIEW-RELEASE.md
dod_command: npm run typecheck && node --test tests/scenarios/review-release.test.ts tests/infra/review-queue.test.ts tests/scenarios/review-admit-foreign.test.ts tests/scenarios/review-block.test.ts tests/scenarios/ci-rerun.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/run-driver.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. Every `ReviewQueue` method that writes a request or a pool record shall do its reads and its writes in one section of the queue's single lock (`updateJson` over one record of the queue directory, whatever the pool), so that against every other mutation of the queue, in any pool, the read of a request and the writes that follow it are one step. Sections do not nest, since the lock is not reentrant. A read-only method takes no lock. `ReviewQueue` has no public method that takes a whole pool record; `updatePool(pool, change)` passes `change` the record read in the section.
  - R2. `ReviewQueue.release(key, reason, options)` shall, in one such section, check the stored request, run `options.before(request)` when given, remove it from `pool.active`, and write the request `cancelled` with the reason as `lastError`, so a failure at either write leaves it `running`. It shall throw, writing nothing, for an unknown key, for any state but `running`, for a `slotOwner` of another host or with no usable pid, and for an owner process still alive; and when `before` throws it shall write nothing and rethrow.
  - R3. `aidlc review release <key> --reason <text>` shall pass as `before`, so that two releases never append to a goal's journal at once, a step that appends a `NOTE` of kind `review-slot-released` with the key, the request's `pool`, its `seq` and the reason to the journal of each goal among the request's requesters that holds no such `NOTE` for that key, `pool` and `seq`, and shall print the released request. A refusal exits non-zero; a failed append exits non-zero with the slot still held, and running the command again finishes the release with one `NOTE` per goal.
  - R4. `docs/OPERATIONS.md`, as the last paragraph of the `## Ship gates (GitHub ship path)` section, shall carry the OPERATIONS sentence of the Doc text section, and the Sessions section shall not change.
  - R5. The CHANGELOG Unreleased section shall carry the entry of the Doc text section.
acceptance:
  - 1. `tests/scenarios/review-release.test.ts`: `release` frees a running request of this host whose owner process is gone (`pool.active` empty, state `cancelled`, the reason as `lastError`). [R2] [dod arm 2]
  - 2. Same file: it throws and leaves the request and the pool unchanged for an unknown key, for a `queued`, `completed` or `cancelled` request, for a `slotOwner` naming another host, for pid 0, for an owner process that is alive, and for a `before` that throws. [R2] [dod arm 2]
  - 3. Same file: while a `release` holds its section (reached from its `before`), `enqueue`, `admit`, `cancel`, `complete`, `requeue`, `markLost`, `resolveLost`, `hold`, `setPoolLimit`, `updatePool` and a second `release` each refuse with `LOCKED`, also for a request of another pool, so no mutation lands between its check and its write. [R1] [R2] [dod arm 2]
  - 4. Same file: after a first release frees a dead owner and the same key is admitted again for a live owner at another `seq`, a second release refuses and the request stays `running` with its key in `pool.active`. [R2] [dod arm 2]
  - 5. Same file, by spawning the CLI from the sources: on a dead owner it exits 0, prints the released request and journals one `review-slot-released` NOTE in the requester goal; on a live owner it exits non-zero and journals nothing; and the same key admitted again journals its own NOTE, by its `pool` and `seq`, the same key and `seq` in another pool included. [R3] [dod arm 2]
  - 6. Same file: a request of two goals whose second journal cannot be written exits non-zero with the slot held and one NOTE, and the same command run again, with the journal writable, exits 0 with one NOTE per goal and the slot free; a failed write of the pool or of the request exits non-zero with the request `running`, and the same command run again exits 0 with one NOTE per goal and the slot free. [R2] [R3] [dod arm 2]
  - 7. Same file: two CLI processes releasing keys of two pools that share a requester goal, and two releasing one key, at once, end with the release done once per key, the other refused or `LOCKED`, one NOTE per key and goal, and a journal whose chain verifies. [R1] [R3] [dod arm 2]
  - 8. Same file: `docs/OPERATIONS.md` holds the OPERATIONS sentence in Ship gates and `CHANGELOG.md` the Unreleased entry of the Doc text section; a test reads each exact text and fails with it removed. [R4] [R5] [dod arm 2]
  - 9. Every test of the dod_command other than the new file passes with no assertion changed; the nine `savePool` fixture lines move to `updatePool`. [R1] [dod arm 2]
depends_on: []
budget: 300
tdd: true
sweep: "git grep -n 'this.queue\\.\\|queue\\.' src on main: the card runner and `run-driver.ts` call the queue; `cancel` runs inside a catch of `CardRunner.ship` since T0-SHIP-THROW-SLOT-3, and none of those callers holds the queue lock, so R1 adds no nested section. `updatePool` is the one public write of a pool record and `pool()` the read."
forbid: [weakening or skipping a test to go green, a release of a request whose owner is alive or of another host, a change to admission order or to what `admit` returns, a nested section of the queue lock, a lock other than the one queue lock, a new journal event type, a reconcile of the operation by `review release` (`aidlc ops reconcile` stays the one way), an edit of any file under `.aidlc/`]
non_goals: [a process killed while it holds the queue lock, which leaves its lock file for an operator to remove, since `updateJson` never removes another writer's lock and its `LOCKED` names the file and the process, as for every record lock, a lock over `Journal.append` (the head read and append of a goal journal are shared with every writer of that journal, as they are at main, and `src/state/journal.ts` is outside this card; the queue lock serializes the release's own appends against each other), an expiry for running requests, a process killed on another host, the `lost` state of a request, a request whose pid was reused or whose process is a zombie (`processAlive` counts it as alive, so the release refuses, which fails closed)]
diagnosis:
  root_cause: "A running request whose process died outside any catch stays in `pool.active` for ever: `admit` keeps it, and no command settles it. On 2026-11-04 that took a one-off `ReviewQueue.cancel` the user approved, since T0-SHIP-THROW-SLOT-3 covers a throw, not a killed process. Request and pool writes take no lock, so a release checked in one step and written in another can cancel a later admission of the same key, leave a joining goal unjournaled, and let two commands both journal: R3 decisions 1 and 2 of T0-SHIP-THROW-SLOT (F1, F6, F13)."
  same_class: "See the sweep: every queue mutation joins the section, so the release shares it with enqueue, admission and cancellation."
hygiene: "Split out of T0-SHIP-THROW-SLOT by the user's ruling of 2026-11-05. The first version of `release`, its CLI command and its tests are on the local branch T0-SHIP-THROW-SLOT at a59721e, and its verdicts in that worktree's `.review/` hold F1, F6 and F13 in full; reuse what still fits R1 to R3. `processAlive` is exported from `src/state/store.ts` and that export is the only change there. Every forbid clause names the code it guards (docs/LESSONS.md 2026-09-27 T0-REVIEWER-UTF8); the doc test reads the exact line (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS)."
doc_sync: CHANGELOG.md, docs/OPERATIONS.md
---

# T0-REVIEW-RELEASE

## Deliverable
A review slot held by a dead process no longer needs a one-off call. `aidlc review release` frees it, refuses while that process is alive, and journals the release, all in one lock section that every other mutation of the queue also takes.

## Doc text
OPERATIONS sentence:

`aidlc review release <key> --reason <text>` frees the slot of a `running` request whose owner process is gone from this host, which is how a process killed outside any catch leaves the pool; it refuses while that process is alive or when the owner is on another host, and journals a `review-slot-released` NOTE in each requester goal before it frees the slot, so running it again finishes a release that failed part way.

CHANGELOG entry:

- T0-REVIEW-RELEASE: `aidlc review release <key> --reason <text>` frees the review slot of a process that died outside any catch, refusing while that process is alive or when it ran on another host, and every mutation of a review pool now runs in one lock section, so a release can never cancel a later admission of the same key.

## Amendments
- 2026-11-05, planner (session lead), after R3 decision 1 and before R3 decision 2, from its findings (classes: stale-pool-overwrite, release-note-identity-collision, release-partial-write-unretryable): R1 removes every public write of a whole pool record, R2 orders the writes so a failure leaves the request `running`, R3 and acceptance 5 add the pool to the NOTE identity, acceptance 3, 6 and 9 and the sweep follow, and the two scenario files whose fixtures called `savePool` join allow_paths.
- 2026-11-05, planner (session lead), after R3 decision 2 and before R3 decision 3, from its findings (classes: cross-pool-request-race, journal-append-race): the lock of R1 is one lock over the whole queue, as the user's ruling on the split named it, in place of one per pool, which removes moves between pools as a case; the release's journal appends run inside it; a lock over `Journal.append` itself stays out of this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/review-release.test.ts tests/infra/review-queue.test.ts tests/scenarios/review-admit-foreign.test.ts tests/scenarios/review-block.test.ts tests/scenarios/ci-rerun.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/run-driver.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
