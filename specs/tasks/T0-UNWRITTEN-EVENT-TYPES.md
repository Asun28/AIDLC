---
id: T0-UNWRITTEN-EVENT-TYPES
title: The seven journal event types no code writes are removed, and the verifier's trace check reads CARD_DISPATCHED only (issue 101, plan finding F4)
status: todo
branch: T0-UNWRITTEN-EVENT-TYPES
worktree: D:\wt\AIDLC\T0-UNWRITTEN-EVENT-TYPES
allow_paths:
  - src/core/types.ts
  - src/audit/verifier.ts
  - tests/core/journal-event-types.test.ts
  - tests/surface/verifier.test.ts
  - CHANGELOG.md
  - specs/tasks/T0-UNWRITTEN-EVENT-TYPES.md
dod_command: npm run typecheck && node --test tests/core/journal-event-types.test.ts tests/surface/verifier.test.ts
dod_exit: 0
requirements:
  - R1. `JournalEventType` (`src/core/types.ts`) shall no longer declare `CARD_AMENDED`, `LEASE_RELEASED`, `LEASE_FENCED`, `AUDIT_VERIFIED`, `INCIDENT_DETECTED`, `MODEL_INVOCATION` or `HOOK_DECISION`, so a journal line with one of them fails the `JournalEvent` parse and code that names one fails the typecheck. Every other type stays, in its order.
  - R2. The verifier's trace check (`verifyAudit`, `src/audit/verifier.ts`) shall read `CARD_DISPATCHED` only: a `CARD_DISPATCHED` event without `invocationId` and without `childRef` is still a blocking `TRACE_MISSING`, and one carrying either is not.
  - R3. `CHANGELOG.md` Unreleased shall name the seven removed types, state that no released version wrote them, so no persisted journal changes, and state that the removal is a type-level change for library code that names them. A writer wanted later brings its type back with its own acceptance item.
acceptance:
  - 1. tests/core/journal-event-types.test.ts - for each of the seven names, a journal event that parses with a kept type (`NOTE`) fails `JournalEvent.safeParse` once its type is that name, and a journal file carrying such a line makes `Journal.readAll` throw; the kept types are the declared list minus the seven, in order. [R1] [dod arm 1]
  - 2. tests/surface/verifier.test.ts - the two tests that appended `MODEL_INVOCATION` append `CARD_DISPATCHED` and keep their assertions: with `invocationId` the journal verifies at `independently-verified` with no blocking finding; with neither `invocationId` nor `childRef` the verifier reports `TRACE_MISSING`; with `childRef` alone it does not. [R2] [dod arm 1]
  - 3. tests/core/journal-event-types.test.ts - CHANGELOG.md Unreleased carries the entry this card adds; a test reads the exact line and fails with it removed. [R3] [dod arm 1]
depends_on: []
budget: 160
tdd: true
sweep: "git grep -n for each of the seven names over src, tests, templates, docs and README.md on main ec8eb67: no writer anywhere; one reader, verifier.ts:74 (the MODEL_INVOCATION half of the trace check); two tests that append MODEL_INVOCATION by hand (tests/surface/verifier.test.ts:34 and :83); docs/plans/PLAN-v5.1-hardening.md:356-359 names them as finding F4 and stays as written (a historical plan). types.ts lines 879, 901-902, 905-906, 908-909."
forbid: [weakening or skipping a test to go green, a types.ts change outside lines 879, 901-902, 905-906 and 908-909 (measured on main ec8eb67), removing or reordering any other journal event type, a verifier.ts change outside line 74, an edit of docs/plans/PLAN-v5.1-hardening.md, adding a writer for any of the seven]
non_goals: [writing any of the seven events (a later writer brings its type back with its own acceptance item), the journal format, other checks of the verifier, the audit levels]
diagnosis:
  root_cause: "JournalEventType declares seven event types that no code writes (issue 101, plan finding F4, filed by T1-AUDIT-FACTS), and verifyAudit (verifier.ts:74) checks MODEL_INVOCATION events for an invocation id or child ref. No MODEL_INVOCATION is ever written, so that half of the check never runs while the audit level counts it."
  same_class: "Every declared journal event type is checked for a writer by the sweep's git grep; the seven are the only ones with none. The one reader of any of them is verifier.ts:74."
hygiene: "Issue 101, decided by aidlc-37 on 2026-09-27 (option 1, all seven removed in one card): an event type nothing writes makes the audit level claim a check that can never run. F4 of docs/plans/PLAN-v5.1-hardening.md is resolved by this card; the plan stays as written. types.ts 908-909 are adjacent to aidlc-a6's T1-BOUND-TELEMETRY insert of BOUND_FIRED (after 909), so the hunks cannot be kept 4 lines apart: the ship order with a6 is decided by aidlc-37 once the DoD is green, and the merge keeps BOUND_FIRED and drops the seven. Run the mutation sweep before the first review; the doc test reads the exact line (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS); every forbid clause names the code it guards (docs/LESSONS.md 2026-09-27 T0-REVIEWER-UTF8)."
doc_sync: CHANGELOG.md
---

# T0-UNWRITTEN-EVENT-TYPES

## Deliverable
The journal vocabulary declares only event types some code writes: the seven that nothing writes are removed, and the verifier's trace check reads `CARD_DISPATCHED`, the one delegated-work event the loop journals.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/journal-event-types.test.ts tests/surface/verifier.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
