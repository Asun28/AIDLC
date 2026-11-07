---
id: T0-LESSONS-TEST-RUN-ENV
title: tests/surface/lessons.test.ts passes when the test process has AIDLC_RUN_NO_SHIP=1
status: merged
branch: T0-LESSONS-TEST-RUN-ENV
worktree: D:\wt\AIDLC\T0-LESSONS-TEST-RUN-ENV
allow_paths:
  - tests/surface/lessons.test.ts
  - CHANGELOG.md
  - specs/tasks/T0-LESSONS-TEST-RUN-ENV.md
dod_command: npm run typecheck && node --test tests/surface/lessons.test.ts
dod_exit: 0
requirements:
  - R1. When the test process has `AIDLC_RUN_NO_SHIP=1`, the `repoAtClose` fixture of `tests/surface/lessons.test.ts` shall start its CLI without that variable.
  - R2. The `aidlc card close --lesson` describe block of that file shall set `AIDLC_RUN_NO_SHIP=1` in `process.env` before its tests and restore the earlier value after them.
  - R3. The CHANGELOG Unreleased section shall have an entry naming this card.
acceptance:
  - 1. With R2 applied and R1 not yet, the two tests of that describe block fail with `Shipping requires a separate operator invocation outside aidlc run`; that output is the RED receipt. [R2] [dod arm 2]
  - 2. With R1 applied the dod_command passes. [R1] [R2] [dod arm 1] [dod arm 2]
  - 3. R3 holds and no test outside that describe block changes (reviewer-verified against the diff). [R3]
depends_on: []
budget: 25
sweep: "AIDLC_RUN_NO_SHIP=1 node --test over tests/**/*.test.ts on main at 4749232: 2351 tests, 2339 pass, 2 fail, 10 skipped. Both failures are in the describe block named by R2."
diagnosis:
  root_cause: "`repoAtClose` copies `process.env` into the CLI it starts, so a full suite run inside `aidlc run` passes the driver's `AIDLC_RUN_NO_SHIP=1` to a fixture whose `card next` must ship on the dry-run path (`tests/surface/lessons.test.ts:174`). The CLI then refuses, as designed."
  same_class: "20 other test files pass `process.env` to a child and none fails in the sweep run. `tests/scenarios/dispute-kind.test.ts:73` already removes session variables from a copied env, which is the repair here."
forbid:
  - changing `src/` or the ship boundary
  - deleting or weakening an existing test
non_goals:
  - a shared spawn helper for the other 20 test files
hygiene: "R2 runs on every plain `npm test`, so CI keeps this case without a test command that sets the variable. `node --test` runs each file in its own process, so the change to `process.env` reaches no other test file."
---

# T0-LESSONS-TEST-RUN-ENV

## Deliverable
R1 and R2 in `tests/surface/lessons.test.ts`, and the R3 entry.

## Why
T0-CARD-SHORT's worker ran `npm test` inside `aidlc run` and recorded 2 failures, which said nothing about its change. CI cannot show this, because CI never sets the variable, so a worker that runs the full suite has to explain the same 2 failures each time.

## Limits
This card fixes the one fixture that fails. Another test that ships through the CLI with an inherited env would fail the same way.
