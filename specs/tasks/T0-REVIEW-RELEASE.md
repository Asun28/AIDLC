---
id: T0-REVIEW-RELEASE
title: Every mutation of a review pool runs in one lock section, and `aidlc review release` frees the slot of a process that died, journaled in that same section
status: todo
branch: T0-REVIEW-RELEASE
worktree: D:\wt\AIDLC\T0-REVIEW-RELEASE
allow_paths:
  - src/coordination/review-queue.ts
  - src/state/store.ts
  - src/cli/main.ts
  - tests/infra/review-queue.test.ts
  - tests/scenarios/review-release.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-REVIEW-RELEASE.md
dod_command: npm run typecheck && node --test tests/scenarios/review-release.test.ts tests/infra/review-queue.test.ts tests/scenarios/review-admit-foreign.test.ts tests/scenarios/review-block.test.ts tests/scenarios/ci-rerun.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/t0-flow.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. Every `ReviewQueue` method that writes a request or a pool record shall do its reads and its writes in one section of the pool record's lock (`updateJson`), so that against every other mutation of that pool the read of a request and the writes that follow it are one step. Sections do not nest, since the lock is not reentrant. A read-only method takes no lock.
  - R2. `ReviewQueue.release(key, reason, options)` shall, in one such section, check the stored request, run `options.before(request)` when given, write the request `cancelled` with the reason as `lastError`, and remove it from `pool.active`. It shall throw, writing nothing, for an unknown key, for any state but `running`, for a `slotOwner` of another host or with no usable pid, and for an owner process still alive; and when `before` throws it shall write nothing and rethrow.
  - R3. `aidlc review release <key> --reason <text>` shall pass as `before` a step that appends a `NOTE` of kind `review-slot-released` with the key, the request's `seq` and the reason to the journal of each goal among the request's requesters that holds no such `NOTE` for that key and `seq`, and shall print the released request. A refusal exits non-zero; a failed append exits non-zero with the slot still held, and running the command again finishes the release with one `NOTE` per goal.
  - R4. `docs/OPERATIONS.md`, as the last paragraph of the `## Ship gates (GitHub ship path)` section, shall carry the OPERATIONS sentence of the Doc text section, and the Sessions section shall not change.
  - R5. The CHANGELOG Unreleased section shall carry the entry of the Doc text section.
acceptance:
  - 1. `tests/scenarios/review-release.test.ts`: `release` frees a running request of this host whose owner process is gone (`pool.active` empty, state `cancelled`, the reason as `lastError`). [R2] [dod arm 2]
  - 2. Same file: it throws and leaves the request and the pool unchanged for an unknown key, for a `queued`, `completed` or `cancelled` request, for a `slotOwner` naming another host, for pid 0, for an owner process that is alive, and for a `before` that throws. [R2] [dod arm 2]
  - 3. Same file: while a `release` holds its section (reached from its `before`), `enqueue`, `admit`, `cancel` and a second `release` of the pool each refuse with `LOCKED`, so no mutation lands between its check and its write. [R1] [R2] [dod arm 2]
  - 4. Same file: after a first release frees a dead owner and the same key is admitted again for a live owner at another `seq`, a second release refuses and the request stays `running` with its key in `pool.active`. [R2] [dod arm 2]
  - 5. Same file, by spawning the CLI from the sources: on a dead owner it exits 0, prints the released request and journals one `review-slot-released` NOTE in the requester goal; on a live owner it exits non-zero and journals nothing; and the same key admitted again journals its own NOTE, by its `seq`. [R3] [dod arm 2]
  - 6. Same file: a request of two goals whose second journal cannot be written exits non-zero with the slot held and one NOTE, and the same command run again, with the journal writable, exits 0 with one NOTE per goal and the slot free. [R3] [dod arm 2]
  - 7. Same file: two CLI processes releasing one key at once end with one exit 0, the other refused or `LOCKED`, one NOTE per goal, and a journal whose chain verifies. [R1] [R3] [dod arm 2]
  - 8. Same file: `docs/OPERATIONS.md` holds the OPERATIONS sentence in Ship gates and `CHANGELOG.md` the Unreleased entry of the Doc text section; a test reads each exact text and fails with it removed. [R4] [R5] [dod arm 2]
  - 9. Every test of the dod_command other than the new file passes with no assertion changed. [R1] [dod arm 2]
depends_on: []
budget: 300
tdd: true
sweep: "git grep -n 'this.queue\\.\\|queue\\.' src on main: the card runner and `run-driver.ts` call the queue; `cancel` runs inside a catch of `CardRunner.ship` since T0-SHIP-THROW-SLOT-3, and none of those callers holds the pool lock, so R1 adds no nested section. `savePool` and `pool()` are the two pool record paths."
forbid: [weakening or skipping a test to go green, a release of a request whose owner is alive or of another host, a change to admission order or to what `admit` returns, a nested section of the pool lock, a new lock file other than the pool record's own, a new journal event type, a reconcile of the operation by `review release` (`aidlc ops reconcile` stays the one way), an edit of any file under `.aidlc/`]
non_goals: [a process killed while it holds the pool lock, which leaves `<pool>.json.lock` for an operator to remove, since `updateJson` never removes another writer's lock and its `LOCKED` names the file and the process, as for every record lock, a `cancel` of a cancelled request in pool A racing an `enqueue` that moves it to pool B (R1 covers one pool, and `release` refuses a cancelled request), an expiry for running requests, a process killed on another host, the `lost` state of a request, a request whose pid was reused or whose process is a zombie (`processAlive` counts it as alive, so the release refuses, which fails closed)]
diagnosis:
  root_cause: "A running request whose process died outside any catch stays in `pool.active` for ever: `admit` keeps it, and no command settles it. On 2026-11-04 that took a one-off `ReviewQueue.cancel` the user approved, since T0-SHIP-THROW-SLOT-3 covers a throw, not a killed process. Request and pool writes take no lock, so a release checked in one step and written in another can cancel a later admission of the same key, leave a joining goal unjournaled, and let two commands both journal: R3 decisions 1 and 2 of T0-SHIP-THROW-SLOT (F1, F6, F13)."
  same_class: "See the sweep: every queue mutation joins the section, so the release shares it with enqueue, admission and cancellation."
hygiene: "Split out of T0-SHIP-THROW-SLOT by the user's ruling of 2026-11-05. The first version of `release`, its CLI command and its tests are on the local branch T0-SHIP-THROW-SLOT at a59721e, and its verdicts in that worktree's `.review/` hold F1, F6 and F13 in full; reuse what still fits R1 to R3. `processAlive` is exported from `src/state/store.ts` and that export is the only change there. Every forbid clause names the code it guards (docs/LESSONS.md 2026-09-27 T0-REVIEWER-UTF8); the doc test reads the exact line (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS)."
doc_sync: CHANGELOG.md, docs/OPERATIONS.md
---

# T0-REVIEW-RELEASE

## Deliverable
A review slot held by a dead process no longer needs a one-off call. `aidlc review release` frees it, refuses while that process is alive, and journals the release, all in one lock section that every other mutation of the pool also takes.

## Doc text
OPERATIONS sentence:

`aidlc review release <key> --reason <text>` frees the slot of a `running` request whose owner process is gone from this host, which is how a process killed outside any catch leaves the pool; it refuses while that process is alive or when the owner is on another host, and journals a `review-slot-released` NOTE in each requester goal before it frees the slot, so running it again finishes a release that failed part way.

CHANGELOG entry:

- T0-REVIEW-RELEASE: `aidlc review release <key> --reason <text>` frees the review slot of a process that died outside any catch, refusing while that process is alive or when it ran on another host, and every mutation of a review pool now runs in one lock section, so a release can never cancel a later admission of the same key.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/review-release.test.ts tests/infra/review-queue.test.ts tests/scenarios/review-admit-foreign.test.ts tests/scenarios/review-block.test.ts tests/scenarios/ci-rerun.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/t0-flow.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.

## Attempt evidence
Attempt 1.

RED: commit 11d2fd8 holds `tests/scenarios/review-release.test.ts` alone. `node --test --test-reporter=spec tests/scenarios/review-release.test.ts` on it: exit 1, tests 15, pass 0, fail 15. Each failure is the missing behaviour: `release is not a function` for the queue items (acceptance 1 to 4), `unknown command 'release'` from the CLI (acceptance 5 to 7), a missing text (acceptance 8).

Two tests were added during the mutation check, each killing a mutant: the NOTE matching test of acceptance 5 (key, kind, event type, a requester naming no goal) and the deterministic test of acceptance 7 (a command run inside a held section). The final file has 17 tests.

GREEN: the dod_command before the commit: exit 0, typecheck clean, tests 250, pass 250, fail 0.

Mutants, each applied by hand to the source, run against the tests that cover it, restored and never committed (`git diff` compared equal to its saved copy after each batch). 41 mutants, 41 killed:
- A section dropped from each mutation (11): `savePool`, `setPoolLimit`, `enqueue`, `requeue`, `admit`, `complete`, `markLost`, `resolveLost`, `hold`, `cancel`, `release`. Each failed on its own name in acceptance 3, by `Missing expected exception` or, for `resolveLost`, by its `not lost` error in place of `LOCKED`.
- Section structure (4): `resolveLost` calling public `complete` from its section (`LOCKED` in tests/infra/review-queue.test.ts), `enqueue` locking the pool it names instead of the pool of the stored request, `sectionOf` not reading the pool again in the section, the lock's change returning a copy so the lock writes a stale record.
- Refusals of `release` (7): the state check, `lost` allowed, no `slotOwner`, pid 0, the pid bound, another host, a live owner.
- Order and writes of `release` (5): `before` not called, `before` after the write, the check after `before`, the slot kept, the reason dropped.
- CLI (11): dedupe dropped, dedupe without seq, key, kind or event type, a missing goal throwing, a NOTE without reason, seq or cardId, nothing printed, the first version's NOTEs outside the section.
- Docs (3): the OPERATIONS sentence removed, the sentence no longer the last paragraph of Ship gates, the CHANGELOG entry removed.

The mutant of the first version's NOTEs outside the section was killed in one run of acceptance 7's two-process test and survived another, since that test depends on the two commands overlapping. The deterministic test of acceptance 7 kills it on every run: the test holds the section and a command run inside it must exit with `LOCKED` and journal nothing.

Callers: `src/loop/card-runner.ts`, `src/loop/run-driver.ts`, `src/loop/controller.ts` and `src/cli/main.ts` call the queue outside any section of the pool lock. Only `ReviewQueue` takes that lock and the CLI's `before` calls only the journal and the goal store. Some card-runner calls follow a card-run section; none runs inside a pool section.

A request can change pool: `enqueue` replaces a cancelled request in the pool its caller names, and the key carries no pool. `sectionOf` reads the pool again in the section and moves to the new pool's section, so `release` is always in the section of the pool holding the request. Against a mutation of a cancelled request in its old pool, an `enqueue` that moves it holds only the new pool's lock: R1 covers mutations of one pool, and `release` refuses a cancelled request, so no forbid clause is reached.
