---
id: T0-SHIP-FAILURE-ORACLE
title: The ship classifier's combination test compares every receipt read as a failure with a frozen, ordered copy of main's failure classes, not with the classifier under test (R3 decision 2 finding of T0-EXIT-ZERO-NOT-MERGED-3)
status: todo
branch: T0-SHIP-FAILURE-ORACLE
worktree: D:\wt\AIDLC\T0-SHIP-FAILURE-ORACLE
allow_paths:
  - tests/infra/ship.test.ts
  - specs/tasks/T0-SHIP-FAILURE-ORACLE.md
dod_command: npm run typecheck && node --test tests/infra/ship.test.ts
dod_exit: 0
requirements:
  - R1. The combination test of `classifyShipOutput` (`tests/infra/ship.test.ts`, the describe block of T0-EXIT-ZERO-NOT-MERGED-3) shall take the expected class of every receipt main read as a failure from a frozen, ordered oracle in the test, copied from main's SENTINEL_MAP (main 390d43e) for the markers of the corpus in main's precedence (`[SHIP-MERGE-FAIL]` merge-failed, `[CI-GATE-RED]` ci-red, `[SHIP-PUSH-FAIL]` push-failed, `DoD 未通过` dod-failed; the first entry that matches decides, else `unclassified`), and assert the exact class. The baseline that calls the classifier under test on a nonzero exit is removed.
  - R2. No src file changes: SENTINEL_MAP and its order stay as they are.
acceptance:
  - 1. tests/infra/ship.test.ts - over the corpus, every receipt main read as a failure classifies as the frozen oracle's class; a receipt carrying two or three of the corpus's failure markers classifies by the oracle's precedence. [R1] [dod arm 1]
  - 2. The mutation sweep reorders SENTINEL_MAP (moving `[CI-GATE-RED]` above `[SHIP-MERGE-FAIL]`, and `[SHIP-PUSH-FAIL]` above `[CI-GATE-RED]`) and changes one class (`[SHIP-PUSH-FAIL]` to `pr-failed`); the test fails for each. [R1] [R2]
depends_on: [T0-EXIT-ZERO-NOT-MERGED-3]
budget: 60
tdd: true
sweep: "The only test that states the failure-class invariant of T0-EXIT-ZERO-NOT-MERGED-3 is the combination test in tests/infra/ship.test.ts; its baseline (classifyShipOutput on the same receipt with exit 1) shares SENTINEL_MAP with the code under test, so a change to the map's order or classes passes unseen (R3 decision 2 of T0-EXIT-ZERO-NOT-MERGED-3 reproduced one with a precedence reversal)."
forbid: [weakening or skipping a test to go green, any src change (SENTINEL_MAP, classifyShipOutput), a baseline that calls classifyShipOutput]
non_goals: [the classifier's behaviour, the merged-path facts (issue 131), CI log classes (issue 76 item 2)]
hygiene: "Registered before the merge of T0-EXIT-ZERO-NOT-MERGED-3 under the ruling of aidlc-37 (delegation of 2026-09-27T09:20Z): that card merged with its R3 decision 2 finding on test strength open, since it does not change SENTINEL_MAP or failure precedence and a hand-run Codex check of 64b804b against origin/main's classifier confirmed every failure class and its precedence unchanged. This card carries the frozen oracle. A test for a preserved behaviour takes its expectation from a frozen copy of the old behaviour, never from the code under test on another path."
doc_sync: none (test only)
---

# T0-SHIP-FAILURE-ORACLE

## Deliverable
The combination test of the ship classifier fails when SENTINEL_MAP's order or classes change: its expected failure classes come from a frozen, ordered copy of main's map.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/ship.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
