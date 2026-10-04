---
id: T1-BOUND-TELEMETRY-4
title: Every bound in the Limits table journals BOUND_FIRED through an outbox, so a bound stop never waits on the journal, and the board shows each bound's firing count, the goal outcomes that followed and every goal whose firing is pending or whose journal is incomplete
status: todo
branch: T1-BOUND-TELEMETRY-4
worktree: D:\wt\AIDLC\T1-BOUND-TELEMETRY-4
plan_ref: docs/plans/PLAN-v5.1-hardening.md#45-module-design
allow_paths:
  - src/core/types.ts
  - src/loop/card-runner.ts
  - src/loop/controller.ts
  - src/audit/verifier.ts
  - src/state/board.ts
  - src/state/journal.ts
  - src/state/store.ts
  - src/state/goal-store.ts
  - src/cli/main.ts
  - tests/infra/board.test.ts
  - tests/infra/journal.test.ts
  - tests/infra/journal-process.test.ts
  - tests/infra/goal-store.test.ts
  - tests/scenarios/deadline.test.ts
  - tests/scenarios/ci-rerun.test.ts
  - tests/scenarios/review-block.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/scenarios/two-windows.test.ts
  - tests/scenarios/extend-running-card.test.ts
  - tests/surface/verifier.test.ts
  - README.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-BOUND-TELEMETRY-4.md
  - specs/tasks/T1-BOUND-TELEMETRY-2.md
  - specs/tasks/T1-BOUND-TELEMETRY-3.md
  - tests/scenarios/audit.test.ts
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
  - 13. `git diff --numstat origin/main...HEAD -- src` is at most +800 net, with 5000 total changed lines and shared W2+W4+W5 ceiling +1100 under the user-approved linked repair; close-out states actual totals. [R1]
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
  - 24. Concurrent direct and outbox writers to one shared goal journal yield one valid hash chain and one event per key, with verification and deduplication serialized under the journal lock, including a deterministic separate-process contention test (tests/infra/journal.test.ts, tests/infra/journal-process.test.ts, tests/scenarios/two-windows.test.ts). [R1] [R8] [dod arm 1]
  - 25. An unlistable cards root is directly named as incomplete even if a fabricated child would look absent (tests/infra/board.test.ts). [R2] [dod arm 1]
  - 26. Direct journal writes verify the full chain and keyed direct/outbox races deduplicate in either writer order; independent keys still append separately (tests/infra/journal.test.ts, tests/infra/journal-process.test.ts). [R1] [R8] [dod arm 1]
  - 27. A pending firing or event arriving after the first read is refused by the locked ship, R2 and R3 admission before any external action (tests/scenarios/t0-flow.test.ts). [R6] [dod arm 1]
  - 28. An exhausted R2 handoff with both formal decisions consumed persists the review stop, firing and complete note batch before a refused assessment append (tests/scenarios/t0-flow.test.ts). [R5] [R8] [dod arm 1]
  - 29. Audit verification uses a replayed CARD_DISPATCHED's persisted startedAt against terminal/re-admission intervals, while missing or invalid times and genuine work after a stop remain blocking (tests/surface/verifier.test.ts). [R2] [R6] [dod arm 1]
  - 30. An exact-sentence test asserts the successor's own CHANGELOG entry in Unreleased (tests/infra/board.test.ts). [R1] [dod arm 1]
  - 31. Direct and outbox BOUND_FIRED writers use the same key identity under the journal lock, including both mixed writer orders and two processes; distinct keys append separately (tests/infra/journal.test.ts, tests/infra/journal-process.test.ts). [R1] [R8] [dod arm 1]
  - 32. Persisted goal revisions distinguish a dispatch committed before STOP/DONE from one created while stopped, including equal clocks, deferred replay in both journal orders, repeated stop/readmission intervals, and later generations; a failed resume goal write cannot journal a phantom readmission (tests/surface/verifier.test.ts, tests/scenarios/audit.test.ts). [R6] [R8] [dod arm 1]
  - 33. A keyed dispatch with missing, malformed, impossible or future startedAt, malformed causal revision, or mismatched key blocks audit even without any terminal; legacy unkeyed events keep their old sequence rule (tests/surface/verifier.test.ts). [R6] [dod arm 1]
  - 34. The locked ship admission test covers pendingFiring as well as pendingEvents, including the previously surviving firing-side mutation (tests/scenarios/t0-flow.test.ts). [R6] [dod arm 1]
  - 35. CHANGELOG Unreleased contains the exact T1-BOUND-TELEMETRY-4 repair sentence, asserted by tests/infra/board.test.ts; docs/OPERATIONS.md describes causal audit ordering. [R1] [dod arm 1]
  - 36. A pre-resume goal snapshot cannot start new card work or persist a later bound firing with the old generation; same-generation callers use the current goal deadline, and a locked firing commit rechecks generation (tests/scenarios/t0-flow.test.ts, tests/scenarios/two-windows.test.ts). [R1] [R7] [dod arm 1]
  - 37. A keyed dispatch without a causal revision is checked against every validated resume occurrence even when the resume journals later; legacy unkeyed work retains journal-order accounting (tests/surface/verifier.test.ts). [R6] [dod arm 1]
  - 38. Valid increasing causal revisions resolve a stop/readmission clock rollback without falsely blocking a proven pre-stop dispatch; malformed times and missing causal proof still fail closed (tests/surface/verifier.test.ts). [R6] [dod arm 1]
  - 39. The Bounds line names a journal with a malformed present terminal `at` as incomplete rather than displaying an unmatched firing as open; absent legacy `at` remains supported (tests/infra/board.test.ts). [R2] [dod arm 1]
  - 40. CI rerun reconciliation flushes and checks card and goal recovery before lookup, journaling or ledger changes, and a refusal retains the pending firing (tests/scenarios/t0-flow.test.ts). [R6] [dod arm 1]
  - 41. Closure flags and lessons refuse pending card or goal events before any side effect and recheck inside the locked card write (tests/scenarios/t0-flow.test.ts). [R6] [dod arm 1]
  - 42. Finding disputes and acceptances refuse unresolved card or goal outboxes before changing findings, including a pending REVIEW_DECIDED event (tests/scenarios/review-block.test.ts, tests/scenarios/t0-flow.test.ts). [R6] [dod arm 1]
  - 43. Controller card-result flushes the target card's outbox before applying a patch and checks pending recovery under the card lock, preserving the record and journal when replay refuses (tests/scenarios/t0-flow.test.ts). [R6] [dod arm 1]
depends_on: [T1-AUDIT-FACTS-2]
diagnosis:
  root_cause: "T1-BOUND-TELEMETRY journaled a firing before persisting the stop it causes, so a bound stop depended on the journal: a failed append left a CI-denied card in SHIP without its stop and free to ship again (R3 decision 2 finding 4), goal firings had no lock to serialize check and append (finding 2), and every read failure had to be refused or ignored (findings 3, 5, 6). The CI key named the candidate alone (finding 1)."
  same_class: "Every saveGoal caller at b4de1bc, controller.ts: 182 createGoal writes a new goal record under a fresh goal lease and cannot race a stop; 298 CARDS to RUN, 325 WAIT to RUN, 330 RUN to VERIFY_ARC, 343 to WAIT, 350 WAIT to RUN, 392 to CLOSE and 421 to DONE (all in next) and 596 (every report result) write a snapshot read at the start of the call and can race a stop written by an overlapping call on the same goal; 661 persistStop writes the stop and gains pendingFiring; 747 goal extend writes the extended deadline, readmits stopped cards and can race a stop. No hook, CLI or board path writes the goal record directly: src/hooks and src/cli/main.ts call no saveGoal, and writeBoard writes only the board file. Firing sites that move to the outbox: card-runner.ts save(run, firing) 452-458, saveHolding 745, finish() 2330, the command-path stop 1923; controller.ts 210, 220, 264, 527."
budget: 5000
tdd: true
sweep: "Survey of T1-BOUND-TELEMETRY at b4de1bc, the candidate this card carries. Firings journaled inside the transition write: card-runner.ts save(run, firing) at 452-458, saveHolding 745, finish() patch 2330, the command-path stop 1923; goal firings journalFiring before persistStop at controller.ts:210, 220, 264, 527. Goal writes are blind: goal-store.ts saveGoal 37-41 (atomicWriteJson, no lock); card runs go through updateJson (store.ts:162) under <file>.lock. CI firing key is the candidate digest alone (card-runner.ts:2465); the ledger keeps cancelled reruns (types.ts:462-470, ci-policy.ts:197). journalFiring ignores readEvents.damaged (board.ts:86-88); readEvents and boundsOfJournals test existsSync before reading (board.ts:79, 93). R3 decision 2 of T1-BOUND-TELEMETRY: 6 findings at card-runner.ts:2465, controller.ts:210, board.ts:87, card-runner.ts:2329, board.ts:79, board.ts:93."
forbid: [a new config key, a new persistent state file under .aidlc/, a counter kept outside the journal, a change to any bound's value, a bound stop that waits on the journal, a firing key read from the clock, a raw card report patch of loop-owned recovery fields]
non_goals: [enforcing the lifecycle repair bound, counting the worker cap, a per-bound history view, tuning any default, firing the release reconciliation grace or the R2 round limits (issue 126), listJsonFiles and the rest of the existsSync sweep outside the board (issue 127)]
hygiene: "User explicitly approved another bounded repair and review cycle after the second R3 block of T1-BOUND-TELEMETRY-3. This linked successor carries candidate 7497c5c, all prior counters, findings and evidence. Three final R3 findings define the repair boundary; use RED tests, semantic mutation sweep before a success receipt, and the normal first-plus-one-repair R3 allowance. An explicit deadline extension is recorded. PR #140 remains a retained draft until the reviewed replacement integrates."
doc_sync: README.md (Limits), docs/OPERATIONS.md (Bound telemetry), docs/ARCHITECTURE.md (the goals/ and cards/ rows of the persisted-state table name pendingFiring and the goal lock), CHANGELOG.md
---

# T1-BOUND-TELEMETRY-4

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
- 2026-10-04, R2 cycle 1 round 1 blocked on acceptance 42: the card outbox guard omitted the goal's pending recovery. The finding disposition now checks goal recovery before its write and inside the goal-then-card locked commit; a scenario injects goal recovery at both points and proves the card remains byte-identical. Acceptance 40/42 cite the files containing their behavioral tests. Review cycle round 1 and all earlier ledgers remain consumed; budgets and scope unchanged.
- 2026-10-04, R3 decision 1 of this successor blocked on eight concrete defects F4-F11: stale caller generation, no-revision keyed replay across resume, causal clock rollback, malformed board terminal time, and four recovery-before-action gaps in CI reconcile, closure, finding disposition and card-result. Acceptance 36-43 records the repaired behavior. The existing allow_paths cover all named source and tests; no new config or persistent state format. The +800 source, 5000 total and shared +1100 ceilings remain, subject to measured close-out. One formal decision remains after a repaired candidate passes R2. Every prior candidate, attempt and review remains in the ledger.
- 2026-10-04, user explicitly approved one more bounded repair and review cycle after T1-BOUND-TELEMETRY-3's second R3 block. This linked successor preserves 7497c5c, every earlier review/attempt counter and local evidence. The three final findings are BOUND_FIRED direct/outbox key identity, audit equal-clock causal order, and invalid keyed dispatch times with no terminal. Reuse the existing goal storeRevision as a causal ordinal; no new counter, config key or persistent state file. Move resume journal events into the goal's same-write outbox to avoid phantom readmission. Add the previously supplemental pendingFiring ship guard test before a success receipt. RED tests and semantic mutation sweep precede formal review. Total budget 5000, source cap +800, shared W2+W4+W5 cap +1100 reserve the bounded causal verifier/test repair; report measured totals. The exact -4 CHANGELOG sentence is mandatory. PR #140 stays draft until a reviewed replacement is integrated.
- 2026-09-28, by aidlc-37 under the user's delegation of 2026-09-27T09:20Z: src cap +140 -> +146 (W5 +164 -> +158), budget 1400 -> 1460, docs/ARCHITECTURE.md added to allow_paths and doc_sync, R9 and acceptance 18 added. Reason: "R3 decision 1 of T1-BOUND-TELEMETRY blocked on late-firing classification; the successor fixes it and syncs ARCHITECTURE." Terminal journal events are not deferred: each firing carries the persisted time of the stop it caused and the board classifies by it.
- 2026-09-28, by aidlc-37 under the same delegation: the positional fallback is scoped to entries that carry no time; acceptance 18 pins a mixed journal, an old-shape line and the clock sources.

- 2026-10-04, under the user's delegation to finish this card and make all decisions: total diff budget 1460 -> 1600 for the R2 F1 regression and repair of partial deadline extensions under a later card-run lock. Source cap remains +146; scope and acceptance are unchanged.

- 2026-10-04, under the user's explicit delegation of all decisions and permission for multiple PRs: R3 decision 1 identified 14 persistence, recovery, dispatch and board defects. Total diff cap 1600 -> 3200, source cap +146 -> +400, shared W2+W4+W5 envelope +400 -> +650. Add docs/plans/PLAN-v5.1-hardening.md to allow_paths for the matching plan amendment. All behavior requirements, no-new-state-file/no-config-key restrictions, tests, and retained review/attempt counters remain unchanged. Goal concurrency uses stale-write refusal or locked transitions; partial extension writes must be recoverable, and journal failure must leave durable recovery state.

- 2026-10-04, under the same delegated repair authority: add tests/scenarios/extend-running-card.test.ts to allow_paths. The recoverable extension requires a lastExtension receipt on changed card records; retain the earlier full-record assertions for all existing fields and separately assert the exact new receipt. Untouched records and their revisions remain byte-identical. This is an additive existing-record contract change, not a test exemption; budgets and review/attempt counters remain unchanged.
- 2026-10-04, user approved a bounded continuation after the second R3 block: predecessor successor T1-BOUND-TELEMETRY-3 carried the -2 candidate, seven findings F22-F28, all old acceptance, review and attempt evidence, and uses a fresh card review cycle. The shared journal needs a transient sibling lock; `src/state/store.ts` supplies the existing exclusive-lock primitive to avoid a second lock implementation. The lock is removed after each append and creates no persistent state format. Source ceiling +650, total churn 4000, shared W2+W4+W5 ceiling +900 reserve the measured repair; no config key, bound value change or counter reset.
- 2026-10-04, behavior clarification for this repair: an assessment now commits its state, receipt and complete keyed note batch before trying the journal; a refused nonbound note leaves the transition pending rather than preserving the prior ownership stop. `card next` replays the batch before downstream work, and existing tests assert the stronger durable state and exact-once replay. An initial card-run lock now encloses takeover's first lease mutation, in card-then-lease order, so a firing arriving after the first read cannot race that mutation; post-lease fencing remains covered. The separate-process journal contention test and predecessor `superseded_by` metadata are in scope.
- 2026-10-04, after R3 decision 1 of T1-BOUND-TELEMETRY-3: eight F6-F13 findings are repaired within the remaining one formal decision. Add `src/audit/verifier.ts` and `tests/surface/verifier.test.ts` solely for replayed dispatch occurrence-time classification; retain fail-closed audit of actual post-terminal work and stale generations. Acceptance 26-30 pins the newly found journal, admission, handoff, audit and docs gaps. No bound value, config key, persistent state format or counter changes; the prior +650 source, 4000 total and shared +900 ceilings remain until measured evidence justifies a separate explicit amendment.
