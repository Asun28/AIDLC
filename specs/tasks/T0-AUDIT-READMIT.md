---
id: T0-AUDIT-READMIT
title: aidlc audit verify counts work after a terminal disposition only when no user-authorised re-admission (goal resume, or a deadline extension of a time stop) came between them
status: todo
branch: T0-AUDIT-READMIT
worktree: D:\wt\AIDLC\T0-AUDIT-READMIT
allow_paths:
  - src/audit/verifier.ts
  - tests/surface/verifier.test.ts
  - tests/scenarios/audit.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-AUDIT-READMIT.md
dod_command: npm run typecheck && node --test tests/surface/verifier.test.ts tests/scenarios/audit.test.ts
dod_exit: 0
requirements:
  - R1. `verifyAudit` shall report a work event (`CARD_DISPATCHED`, `OPERATION_ISSUED`, `ATTEMPT_STARTED`) as `WORK_AFTER_TERMINAL` only when the latest disposition event journaled before it is a terminal one (`GOAL_DONE`, `GOAL_STOPPED`); a re-admission is a disposition event that ends the terminal state: the `GOAL_TAKEOVER` of `aidlc goal resume` (it carries `linkedFrom` and a generation above the stopped one) and the `GOAL_STATE` from `STOP` that `aidlc goal extend` writes when it re-admits a time stop.
  - R2. `verifyAudit` shall keep reporting `WORK_AFTER_TERMINAL` for a work event after the last terminal disposition with no re-admission since, and for a work event whose generation is below the generation of the latest resume `GOAL_TAKEOVER` before it (a late wakeup of the stopped generation); the `GOAL_TAKEOVER` of `aidlc goal takeover` (a lease takeover, `leaseGeneration` and no `linkedFrom`) is never a re-admission.
acceptance:
  - 1. A journal of `GOAL_STOPPED` (generation 0), a resume `GOAL_TAKEOVER` (generation 1, `linkedFrom`), `CARD_DISPATCHED` and `ATTEMPT_STARTED` (generation 1) and `GOAL_DONE` (generation 1) reports no `WORK_AFTER_TERMINAL` and reaches `traceable` (tests/surface/verifier.test.ts). [R1] [dod arm 1]
  - 2. A journal of `GOAL_STOPPED` for time, the extension `NOTE`, `GOAL_STATE` from `STOP` to `CARDS` and a `CARD_DISPATCHED` in the same generation reports no `WORK_AFTER_TERMINAL` (tests/surface/verifier.test.ts). [R1] [dod arm 1]
  - 3. Each of these still reports `WORK_AFTER_TERMINAL`: work after `GOAL_DONE` with no re-admission (the existing tests), work after the final `GOAL_DONE` of a resumed goal, a generation-0 `CARD_DISPATCHED` journaled after the generation-1 resume `GOAL_TAKEOVER`, and work after a lease `GOAL_TAKEOVER` that follows `GOAL_STOPPED` (tests/surface/verifier.test.ts). [R2] [dod arm 1]
  - 4. A goal driven through a stop, `goal resume --replace` and a DONE in the scenario harness verifies at `traceable` with no `WORK_AFTER_TERMINAL` (tests/scenarios/audit.test.ts). [R1] [dod arm 1]
  - 5. `docs/OPERATIONS.md` (the `verify` paragraph) states which events re-admit a goal for this check; CHANGELOG.md Unreleased carries the entry under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R1] [R2] [dod arm 1]
depends_on: []
budget: 150
tdd: true
sweep: "grep -rn 'WORK_AFTER_TERMINAL\\|GOAL_TAKEOVER\\|from: .STOP.' src/ tests/ docs/: the rule at src/audit/verifier.ts:74-77 takes the first GOAL_DONE or GOAL_STOPPED and counts every later work event; the level rule at verifier.ts:107 makes the block drop the level to recorded. Writers of re-admission: controller.ts:570 (GOAL_TAKEOVER with linkedFrom, goal resume), controller.ts:707 (GOAL_STATE from STOP to CARDS, goal extend of a time stop); main.ts:325 writes GOAL_TAKEOVER with leaseGeneration for a lease takeover. Tests: tests/surface/verifier.test.ts:72-77 and tests/scenarios/audit.test.ts:45-53 (both work after GOAL_DONE with no re-admission). Docs: docs/OPERATIONS.md:251."
forbid: [dropping WORK_AFTER_TERMINAL for work with no re-admission, treating a lease takeover as a re-admission, changing the level rule or any other finding]
non_goals: [sealing the manifest, re-auditing past goals, the late-wakeup fencing of the loop itself]
diagnosis:
  root_cause: "verifyAudit takes the first terminal event of the journal (events.find GOAL_DONE or GOAL_STOPPED) and counts every later CARD_DISPATCHED, OPERATION_ISSUED or ATTEMPT_STARTED, so a goal re-admitted by the user (goal resume, or goal extend after a time stop) reports the work of its continuation as work after a terminal disposition. Evidence: goal g-20260925014420-bcf1ef (GOAL_STOPPED at generation 0, resume to T0-QUOTA-FALSE-HOLD-2 at generation 1, DONE) verifies at recorded with '4 mutation event(s) after terminal disposition'; goal g-20260918021545-195e85 (T0-PLANNING-CLAIMS-2, also resumed) reports 5."
  same_class: "No other audit finding reads the terminal event. The manifest checks (MANIFEST_STALE, MANIFEST_TRAILING) compare against the seal, not the terminal disposition."
hygiene: "Found at VERIFY_ARC of goal g-20260925014420-bcf1ef (PR #44). Run the mutation sweep over the new disposition walk before the first review (docs/LESSONS.md 2026-09-24)."
doc_sync: docs/OPERATIONS.md (audit verify paragraph), CHANGELOG.md
---

# T0-AUDIT-READMIT

## Deliverable
`aidlc audit verify` no longer blocks a goal that the user re-admitted through `aidlc goal resume` or `aidlc goal extend` after a time stop: work journaled after the re-admission is the continuation, not work after a terminal disposition. Work after the last terminal disposition, late work of a stopped generation, and work after a lease takeover still block.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/verifier.test.ts tests/scenarios/audit.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
