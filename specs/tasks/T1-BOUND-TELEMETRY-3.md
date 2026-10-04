---
id: T1-BOUND-TELEMETRY-3
title: Every bound in the Limits table journals BOUND_FIRED through an outbox, so a bound stop never waits on the journal, and the board shows each bound's firing count, the goal outcomes that followed and every goal whose firing is pending or whose journal is incomplete
status: todo
branch: T1-BOUND-TELEMETRY-3
worktree: D:\wt\AIDLC\T1-BOUND-TELEMETRY-3
plan_ref: docs/plans/PLAN-v5.1-hardening.md#45-module-design
allow_paths:
  - src/core/types.ts
  - src/loop/card-runner.ts
  - src/loop/controller.ts
  - src/state/board.ts
  - src/state/journal.ts
  - src/state/goal-store.ts
  - src/cli/main.ts
  - tests/infra/board.test.ts
  - tests/infra/journal.test.ts
  - tests/infra/goal-store.test.ts
  - tests/scenarios/deadline.test.ts
  - tests/scenarios/ci-rerun.test.ts
  - tests/scenarios/review-block.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/scenarios/two-windows.test.ts
  - tests/scenarios/extend-running-card.test.ts
  - README.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-BOUND-TELEMETRY-3.md
  - docs/plans/PLAN-v5.1-hardening.md
dod_command: npm run check
dod_exit: 0
requirements:
  - R1. WHEN a bound of the README Limits table fires, the loop shall journal one `BOUND_FIRED` event whose zod payload names the bound and whose key names the firing from persisted facts (goal and generation, card, bound, value).
  - R2. The board shall render one `Bounds:` line giving, per fired bound, the firing count and the terminal outcome of the goal after each firing (`DONE`, `STOP/<reason>` or `open`), and shall name as incomplete every journal it cannot read in full and every goal whose firing is pending.
  - R3. The change shall add no config key or persistent state file under `.aidlc/`; a transient sibling journal lock is permitted and removed after each operation.
  - R4. The README Limits table shall state that the lifecycle repair bound is defined and not enforced.
  - R5. WHEN a transition fires a bound, the loop shall save the firing as `pendingFiring` in the same record write as the stop or state it causes, and shall journal it only after that write.
  - R6. WHILE a card run or goal holds a `pendingFiring`, every later call shall journal it, once per key, and clear it before any other action; a firing that cannot be journaled shall stay pending and shall never hold back the stop.
  - R7. Goal writes shall go through the store's locked read-modify-write, and a goal stop shall be written, and its firing journaled, only by the writer whose change wrote it.
  - R8. A bound stop shall be persisted whatever the journal does, and a firing shall be journaled at most once per key and at least once after the journal recovers.
  - R9. The board shall classify a firing by the persisted time of the stop or state it caused (`stoppedAt` in its entry) against the persisted times of the goal's terminal events, never by when the firing was journaled.
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
  - 11. A stale goal snapshot is refused with `GOAL_STALE`; a fresh snapshot keeps persisted pending events and firing, and only the flush clears them (tests/infra/goal-store.test.ts). [R6] [R7] [dod arm 1]
  - 12. A goal resumed into a new generation and stopped again by the same bound on the same value journals its own firing, one per generation over repeated calls (tests/scenarios/deadline.test.ts). [R1] [dod arm 1]
  - 13. `git diff --numstat origin/main...HEAD -- src` is at most +650 net, with 4000 total changed lines and shared W2+W4+W5 ceiling +900 under the approved R3 decision 2 repair; close-out states actual totals. [R1]
  - 14. `docs/OPERATIONS.md` names `BOUND_FIRED`, the outbox (`pendingFiring`) and the board line; `docs/OPERATIONS.md` also names the goal `LOCKED` refusal and the `incomplete:` of a pending firing; `CHANGELOG.md` Unreleased carries the entry under this card id and an entry starting `Changed:` that states goal writes now take the store lock; a test reads each exact sentence (tests/infra/board.test.ts). [R1] [R2] [R5] [R7] [dod arm 1]
  - 15. A held goal lock makes a goal write refuse with `StoreError` `LOCKED` naming the file and leaves the record byte-identical; after the lock is released the same write succeeds (tests/infra/goal-store.test.ts). [R7] [dod arm 1]
  - 16. At the start of `card next`, controller `next` and controller `report`, a pending firing is journaled and cleared before selection or dispatch; a flush that throws leaves the stop in place, the command reports the pending firing, and no ship or other work directive is dispatched (tests/scenarios/t0-flow.test.ts, tests/scenarios/deadline.test.ts). [R6] [R8] [dod arm 1]
  - 17. Every `saveGoal` caller in `diagnosis.same_class` keeps its result under the lock, and goal extend, the hooks and the board either succeed as before or refuse with a named `LOCKED` error, never a partial write (tests/infra/goal-store.test.ts, tests/scenarios/two-windows.test.ts). [R7] [dod arm 1]
  - 18. A goal firing the journal refuses, then its GOAL_STOPPED, then recovery and the flush, is counted on the Bounds line as that stop's firing (`STOP/<reason>`), not open; so is a card firing that stays pending while its goal goes terminal; in a journal that mixes entries written before this card (no times) with new ones, the new entries are classified by time even where their positions disagree; an old-shape line (BOUND_FIRED without stoppedAt, GOAL_STOPPED and GOAL_DONE without at) parses unchanged; GOAL_STOPPED takes its time from the persisted stop and GOAL_DONE from the controller clock, never the wall clock (tests/infra/board.test.ts, tests/scenarios/deadline.test.ts). [R9] [dod arm 1]
  - 19. Raw card reports reject `pendingEvents`, `pendingFiring`, and loop-owned extension receipts, leaving records and journals byte-identical on refusal (tests/scenarios/t0-flow.test.ts). [R6] [dod arm 1]
  - 20. A failed PLAN_INVOKED append cannot lose either failed invocation count; the second failure persists STOP, `pendingFiring` and keyed notes, all replayed once after journal recovery (tests/scenarios/deadline.test.ts). [R5] [R8] [dod arm 1]
  - 21. Assessment derives every downstream bound stop before appending notes; a refused journal retains the whole keyed note batch and stop, and recovery emits every note exactly once (tests/scenarios/t0-flow.test.ts). [R5] [R8] [dod arm 1]
  - 22. A refused CARD_DISPATCHED append leaves the creating card run with a pending dispatch event; existing-run retry replays it once without a second dispatch (tests/scenarios/deadline.test.ts). [R6] [dod arm 1]
  - 23. Card takeover refuses mutation when a pending firing or event cannot flush, including an event arriving after the first read; it never replaces a CI grant with a later deadline firing (tests/scenarios/two-windows.test.ts). [R6] [dod arm 1]
  - 24. Concurrent direct and outbox writers to one shared goal journal yield one valid hash chain and one event per key, with verification and deduplication serialized under the journal lock (tests/infra/journal.test.ts, tests/scenarios/two-windows.test.ts). [R1] [R8] [dod arm 1]
  - 25. An unlistable cards root is directly named as incomplete even if a fabricated child would look absent (tests/infra/board.test.ts). [R2] [dod arm 1]
depends_on: [T1-AUDIT-FACTS-2]
diagnosis:
  root_cause: "T1-BOUND-TELEMETRY journaled a firing before persisting the stop it causes, so a bound stop depended on the journal: a failed append left a CI-denied card in SHIP without its stop and free to ship again (R3 decision 2 finding 4), goal firings had no lock to serialize check and append (finding 2), and every read failure had to be refused or ignored (findings 3, 5, 6). The CI key named the candidate alone (finding 1)."
  same_class: "Every saveGoal caller at b4de1bc, controller.ts: 182 createGoal writes a new goal record under a fresh goal lease and cannot race a stop; 298 CARDS to RUN, 325 WAIT to RUN, 330 RUN to VERIFY_ARC, 343 to WAIT, 350 WAIT to RUN, 392 to CLOSE and 421 to DONE (all in next) and 596 (every report result) write a snapshot read at the start of the call and can race a stop written by an overlapping call on the same goal; 661 persistStop writes the stop and gains pendingFiring; 747 goal extend writes the extended deadline, readmits stopped cards and can race a stop. No hook, CLI or board path writes the goal record directly: src/hooks and src/cli/main.ts call no saveGoal, and writeBoard writes only the board file. Firing sites that move to the outbox: card-runner.ts save(run, firing) 452-458, saveHolding 745, finish() 2330, the command-path stop 1923; controller.ts 210, 220, 264, 527."
budget: 4000
tdd: true
sweep: "Survey of T1-BOUND-TELEMETRY at b4de1bc, the candidate this card carries. Firings journaled inside the transition write: card-runner.ts save(run, firing) at 452-458, saveHolding 745, finish() patch 2330, the command-path stop 1923; goal firings journalFiring before persistStop at controller.ts:210, 220, 264, 527. Goal writes are blind: goal-store.ts saveGoal 37-41 (atomicWriteJson, no lock); card runs go through updateJson (store.ts:162) under <file>.lock. CI firing key is the candidate digest alone (card-runner.ts:2465); the ledger keeps cancelled reruns (types.ts:462-470, ci-policy.ts:197). journalFiring ignores readEvents.damaged (board.ts:86-88); readEvents and boundsOfJournals test existsSync before reading (board.ts:79, 93). R3 decision 2 of T1-BOUND-TELEMETRY: 6 findings at card-runner.ts:2465, controller.ts:210, board.ts:87, card-runner.ts:2329, board.ts:79, board.ts:93."
forbid: [a new config key, a new persistent state file under .aidlc/, a counter kept outside the journal, a change to any bound's value, a bound stop that waits on the journal, a firing key read from the clock, a raw card report patch of loop-owned recovery fields]
non_goals: [enforcing the lifecycle repair bound, counting the worker cap, a per-bound history view, tuning any default, firing the release reconciliation grace or the R2 round limits (issue 126), listJsonFiles and the rest of the existsSync sweep outside the board (issue 127)]
hygiene: "User explicitly approved bounded repair and another review cycle after the second R3 block of T1-BOUND-TELEMETRY-2. This linked successor carries its exact candidate and all counters, findings and evidence. Seven R3 findings F22-F28 define the repair boundary; use RED tests before code, a mutation sweep before R2, and the normal first-plus-one-repair R3 allowance for this successor. An explicit deadline extension is required. PR #140 remains a retained draft until the replacement candidate is reviewed; no defective merge."
doc_sync: README.md (Limits), docs/OPERATIONS.md (Bound telemetry), docs/ARCHITECTURE.md (the goals/ and cards/ rows of the persisted-state table name pendingFiring and the goal lock), CHANGELOG.md
---

# T1-BOUND-TELEMETRY-3

## Deliverable
Invariant the reviewers check: a bound stop is persisted whatever the journal does, and a firing is journaled at most once per key and at least once after the journal recovers. A firing journaled by this code, and a terminal event journaled by this code, carry persisted times, and the board classifies them by those times alone; entries written before this card carry no times, and only those fall back to journal position.

Each bound that fires leaves one `BOUND_FIRED` event in the journal, and `aidlc board` shows in one line how often each bound fired and how the goals ended afterwards. The stop a bound causes is saved first, together with its pending firing, in one record write; the firing is journaled afterwards, once per key, and replayed by every later call until it lands. A journal that cannot be read in full, or a firing still pending, is named on the board, never read as none fired.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run check
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every test passes, with the pass count in the receipt.

## Amendments
- 2026-09-28, by aidlc-37 under the user's delegation of 2026-09-27T09:20Z: src cap +140 -> +146 (W5 +164 -> +158), budget 1400 -> 1460, docs/ARCHITECTURE.md added to allow_paths and doc_sync, R9 and acceptance 18 added. Reason: "R3 decision 1 of T1-BOUND-TELEMETRY blocked on late-firing classification; the successor fixes it and syncs ARCHITECTURE." Terminal journal events are not deferred: each firing carries the persisted time of the stop it caused and the board classifies by it.
- 2026-09-28, by aidlc-37 under the same delegation: the positional fallback is scoped to entries that carry no time; acceptance 18 pins a mixed journal, an old-shape line and the clock sources.

- 2026-10-04, under the user's delegation to finish this card and make all decisions: total diff budget 1460 -> 1600 for the R2 F1 regression and repair of partial deadline extensions under a later card-run lock. Source cap remains +146; scope and acceptance are unchanged.

- 2026-10-04, under the user's explicit delegation of all decisions and permission for multiple PRs: R3 decision 1 identified 14 persistence, recovery, dispatch and board defects. Total diff cap 1600 -> 3200, source cap +146 -> +400, shared W2+W4+W5 envelope +400 -> +650. Add docs/plans/PLAN-v5.1-hardening.md to allow_paths for the matching plan amendment. All behavior requirements, no-new-state-file/no-config-key restrictions, tests, and retained review/attempt counters remain unchanged. Goal concurrency uses stale-write refusal or locked transitions; partial extension writes must be recoverable, and journal failure must leave durable recovery state.

- 2026-10-04, under the same delegated repair authority: add tests/scenarios/extend-running-card.test.ts to allow_paths. The recoverable extension requires a lastExtension receipt on changed card records; retain the earlier full-record assertions for all existing fields and separately assert the exact new receipt. Untouched records and their revisions remain byte-identical. This is an additive existing-record contract change, not a test exemption; budgets and review/attempt counters remain unchanged.
- 2026-10-04, user approved a bounded continuation after the second R3 block: successor T1-BOUND-TELEMETRY-3 carries the -2 candidate, seven findings F22-F28, all old acceptance, review and attempt evidence, and uses a fresh card review cycle. The shared journal needs a transient sibling lock; it is removed after each append and creates no persistent state format. Source ceiling +650, total churn 4000, shared W2+W4+W5 ceiling +900 reserve the measured repair; no config key, bound value change or counter reset.
