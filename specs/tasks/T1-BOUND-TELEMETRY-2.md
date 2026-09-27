---
id: T1-BOUND-TELEMETRY-2
title: Every bound in the Limits table journals BOUND_FIRED through an outbox, so a bound stop never waits on the journal, and the board shows each bound's firing count, the goal outcomes that followed and every goal whose firing is pending or whose journal is incomplete
status: todo
branch: T1-BOUND-TELEMETRY-2
worktree: D:\wt\AIDLC\T1-BOUND-TELEMETRY-2
plan_ref: docs/plans/PLAN-v5.1-hardening.md#45-module-design
allow_paths:
  - src/core/types.ts
  - src/loop/card-runner.ts
  - src/loop/controller.ts
  - src/state/board.ts
  - src/state/goal-store.ts
  - src/cli/main.ts
  - tests/infra/board.test.ts
  - tests/infra/goal-store.test.ts
  - tests/scenarios/deadline.test.ts
  - tests/scenarios/ci-rerun.test.ts
  - tests/scenarios/review-block.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/scenarios/two-windows.test.ts
  - README.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-BOUND-TELEMETRY-2.md
dod_command: npm run check
dod_exit: 0
requirements:
  - R1. WHEN a bound of the README Limits table fires, the loop shall journal one `BOUND_FIRED` event whose zod payload names the bound and whose key names the firing from persisted facts (goal and generation, card, bound, value).
  - R2. The board shall render one `Bounds:` line giving, per fired bound, the firing count and the terminal outcome of the goal after each firing (`DONE`, `STOP/<reason>` or `open`), and shall name as incomplete every journal it cannot read in full and every goal whose firing is pending.
  - R3. The change shall add no config key and no file under `.aidlc/`.
  - R4. The README Limits table shall state that the lifecycle repair bound is defined and not enforced.
  - R5. WHEN a transition fires a bound, the loop shall save the firing as `pendingFiring` in the same record write as the stop or state it causes, and shall journal it only after that write.
  - R6. WHILE a card run or goal holds a `pendingFiring`, every later call shall journal it, once per key, and clear it before any other action; a firing that cannot be journaled shall stay pending and shall never hold back the stop.
  - R7. Goal writes shall go through the store's locked read-modify-write, and a goal stop shall be written, and its firing journaled, only by the writer whose change wrote it.
  - R8. A bound stop shall be persisted whatever the journal does, and a firing shall be journaled at most once per key and at least once after the journal recovers.
acceptance:
  - 1. Each firing point journals exactly one `BOUND_FIRED` with its bound name and key (card deadline, arc deadline, reconciliation grace, review decisions, no-verdict retry, CI rerun allowed and denied, attempts, planning invocations, integration repair); a scenario per bound asserts the event and its key (tests/scenarios/deadline.test.ts, tests/scenarios/review-block.test.ts, tests/scenarios/ci-rerun.test.ts, tests/scenarios/t0-flow.test.ts). [R1] [dod arm 1]
  - 2. A `BOUND_FIRED` event whose payload names no known bound, or has no key, fails to parse (tests/infra/board.test.ts). [R1] [dod arm 1]
  - 3. Over fixture journals of three goals, the board prints one line `Bounds: <bound> <n> (DONE a, STOP/<reason> b, open c); ...` in a fixed bound order, the outcome of a firing being the goal's first terminal event after it, and `Bounds: none fired` when there are none (tests/infra/board.test.ts). [R2] [dod arm 1]
  - 4. No config key is added (`ProjectConfig` keys unchanged) and no path under `.aidlc/` is written by the board beyond what it writes today (tests/infra/board.test.ts). [R3] [dod arm 1]
  - 5. The README Limits table row for repair cycles says the lifecycle repair bound is defined and not enforced; a test reads the exact row (tests/infra/board.test.ts). [R4] [dod arm 1]
  - 6. R3 decision 2 finding 1 of T1-BOUND-TELEMETRY: a CI rerun granted, cancelled and granted again on the same candidate journals two `ci-rerun-allowed` firings with distinct keys, and a retry of one refused save journals none more (tests/scenarios/ci-rerun.test.ts). [R1] [dod arm 1]
  - 7. Finding 2: two overlapping goal deadline calls on one goal record journal one `arc-deadline` entry and save one stop (tests/scenarios/two-windows.test.ts). [R7] [dod arm 1]
  - 8. Finding 3: a goal journal that cannot be read in full refuses the append, keeps `pendingFiring`, and the board names the goal and the journal as incomplete; once the journal is readable the next call journals the firing once and clears it (tests/infra/board.test.ts). [R2] [R6] [dod arm 1]
  - 9. Finding 4: a CI-denied ship result whose firing append fails leaves the card STOPPED with `pendingFiring`; the next `card next` journals the firing and returns the stop without invoking the ship path again (tests/scenarios/ci-rerun.test.ts). [R5] [R6] [dod arm 1]
  - 10. Findings 5 and 6: a journal file or journal directory that is a dangling link, or a directory that cannot be listed, is named as incomplete, while an absent one reads as none fired (tests/infra/board.test.ts). [R2] [dod arm 1]
  - 11. A plain goal write from a snapshot without `pendingFiring` keeps the persisted one; only the flush clears it (tests/infra/goal-store.test.ts). [R6] [R7] [dod arm 1]
  - 12. A goal resumed into a new generation and stopped again by the same bound on the same value journals its own firing, one per generation over repeated calls (tests/scenarios/deadline.test.ts). [R1] [dod arm 1]
  - 13. `git diff --numstat origin/main...HEAD -- src` is at most +140 net (set by aidlc-37 under the user's delegation for this successor; W5 goes to +164); the close-out states it and the W2+W4 running total against +400. [R1]
  - 14. `docs/OPERATIONS.md` names `BOUND_FIRED`, the outbox (`pendingFiring`) and the board line; `docs/OPERATIONS.md` also names the goal `LOCKED` refusal and the `incomplete:` of a pending firing; `CHANGELOG.md` Unreleased carries the entry under this card id and an entry starting `Changed:` that states goal writes now take the store lock; a test reads each exact sentence (tests/infra/board.test.ts). [R1] [R2] [R5] [R7] [dod arm 1]
  - 15. A held goal lock makes a goal write refuse with `StoreError` `LOCKED` naming the file and leaves the record byte-identical; after the lock is released the same write succeeds (tests/infra/goal-store.test.ts). [R7] [dod arm 1]
  - 16. At the start of `card next`, controller `next` and controller `report`, a pending firing is journaled and cleared before selection or dispatch; a flush that throws leaves the stop in place, the command reports the pending firing, and no ship or other work directive is dispatched (tests/scenarios/t0-flow.test.ts, tests/scenarios/deadline.test.ts). [R6] [R8] [dod arm 1]
  - 17. Every `saveGoal` caller in `diagnosis.same_class` keeps its result under the lock, and goal extend, the hooks and the board either succeed as before or refuse with a named `LOCKED` error, never a partial write (tests/infra/goal-store.test.ts, tests/scenarios/two-windows.test.ts). [R7] [dod arm 1]
depends_on: [T1-AUDIT-FACTS-2]
diagnosis:
  root_cause: "T1-BOUND-TELEMETRY journaled a firing before persisting the stop it causes, so a bound stop depended on the journal: a failed append left a CI-denied card in SHIP without its stop and free to ship again (R3 decision 2 finding 4), goal firings had no lock to serialize check and append (finding 2), and every read failure had to be refused or ignored (findings 3, 5, 6). The CI key named the candidate alone (finding 1)."
  same_class: "Every saveGoal caller at b4de1bc, controller.ts: 182 createGoal writes a new goal record under a fresh goal lease and cannot race a stop; 298 CARDS to RUN, 325 WAIT to RUN, 330 RUN to VERIFY_ARC, 343 to WAIT, 350 WAIT to RUN, 392 to CLOSE and 421 to DONE (all in next) and 596 (every report result) write a snapshot read at the start of the call and can race a stop written by an overlapping call on the same goal; 661 persistStop writes the stop and gains pendingFiring; 747 goal extend writes the extended deadline, readmits stopped cards and can race a stop. No hook, CLI or board path writes the goal record directly: src/hooks and src/cli/main.ts call no saveGoal, and writeBoard writes only the board file. Firing sites that move to the outbox: card-runner.ts save(run, firing) 452-458, saveHolding 745, finish() 2330, the command-path stop 1923; controller.ts 210, 220, 264, 527."
budget: 1400
tdd: true
sweep: "Survey of T1-BOUND-TELEMETRY at b4de1bc, the candidate this card carries. Firings journaled inside the transition write: card-runner.ts save(run, firing) at 452-458, saveHolding 745, finish() patch 2330, the command-path stop 1923; goal firings journalFiring before persistStop at controller.ts:210, 220, 264, 527. Goal writes are blind: goal-store.ts saveGoal 37-41 (atomicWriteJson, no lock); card runs go through updateJson (store.ts:162) under <file>.lock. CI firing key is the candidate digest alone (card-runner.ts:2465); the ledger keeps cancelled reruns (types.ts:462-470, ci-policy.ts:197). journalFiring ignores readEvents.damaged (board.ts:86-88); readEvents and boundsOfJournals test existsSync before reading (board.ts:79, 93). R3 decision 2 of T1-BOUND-TELEMETRY: 6 findings at card-runner.ts:2465, controller.ts:210, board.ts:87, card-runner.ts:2329, board.ts:79, board.ts:93."
forbid: [a new config key, a new file under .aidlc/, a counter kept outside the journal, a change to any bound's value, a bound stop that waits on the journal, a firing key read from the clock, a raw card report patch]
non_goals: [enforcing the lifecycle repair bound, counting the worker cap, a per-bound history view, tuning any default, firing the release reconciliation grace or the R2 round limits (issue 126), listJsonFiles and the rest of the existsSync sweep outside the board (issue 127)]
hygiene: "Ruling by aidlc-37 under the user's delegation of 2026-09-27T09:20Z: first successor of T1-BOUND-TELEMETRY (stopped on R3 decision 2), carrying b4de1bc. Reason: R3 decision 2 on T1-BOUND-TELEMETRY blocked on six findings rooted in journal-before-persist; the successor persists the stop first with pendingFiring in the same locked write (an outbox) and flushes the firing afterwards, which needs a locked goal write (finding 2) and the pendingFiring fields. Goal-write locking is in scope by this ruling although it was a non-goal of T1-STORE-CAS-2: the stop and its pending firing must land in one write that an overlapping writer cannot overwrite. Before R3 decision 1 a hand Codex pre-check must answer no to both: is any bound stop ever not persisted because of a journal failure; can any key be journaled twice. A second R3 block goes to the user; there is no -3 without them. Lessons: 2026-09-18 T1-REVIEW-STATS (derive the count from the event the loop persists at the firing); a bound stop must never wait on telemetry. Run the mutation sweep over every new branch before the first review."
doc_sync: README.md (Limits), docs/OPERATIONS.md (Bound telemetry), CHANGELOG.md
---

# T1-BOUND-TELEMETRY-2

## Deliverable
Invariant the reviewers check: a bound stop is persisted whatever the journal does, and a firing is journaled at most once per key and at least once after the journal recovers.

Each bound that fires leaves one `BOUND_FIRED` event in the journal, and `aidlc board` shows in one line how often each bound fired and how the goals ended afterwards. The stop a bound causes is saved first, together with its pending firing, in one record write; the firing is journaled afterwards, once per key, and replayed by every later call until it lands. A journal that cannot be read in full, or a firing still pending, is named on the board, never read as none fired.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run check
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every test passes, with the pass count in the receipt.
