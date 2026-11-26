---
id: T0-R3-RESERVE-FENCE-TEST
title: "A scenario test pins the lease fence at the R3 reservation: a takeover that lands after the first fence of aidlc review r3 refuses the reservation, runs no reviewer and leaves the new owner's run as the takeover wrote it"
status: todo
branch: T0-R3-RESERVE-FENCE-TEST
worktree: D:\wt\AIDLC\T0-R3-RESERVE-FENCE-TEST
allow_paths:
  - tests/scenarios/r3-reserve-fence.test.ts
  - specs/tasks/T0-R3-RESERVE-FENCE-TEST.md
dod_command: npm run typecheck && node --test tests/scenarios/r3-reserve-fence.test.ts tests/scenarios/two-windows.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. A new file `tests/scenarios/r3-reserve-fence.test.ts` shall hold one test in which, on one card run of a one-card goal under a command reviewer, owned by window A at lease generation 0, `CardRunner.formalReview` runs as A and window B takes the card over (`CardRunner.takeover` as B, after the lease expired) while A's call is past its first fence and before its reservation. The takeover runs from the CardRunner's `queue` dependency: a queue whose `enqueue` runs it once and then calls the fixture's queue, the one injected call between the two fences.
  - R2. The file shall import the harness and the sources by relative path with `.ts` extensions, typecheck under `tsconfig.test.json`, and use the fixture's clock only. No file under `src/`, `docs/` or any other test file changes.
acceptance:
  - 1. The takeover completes: the lease and the run carry generation 1 owned by B, and the run is still in SHIP. [R1] [dod arm 2]
  - 2. A's `formalReview` is refused with an error that matches `fenced` and names B's session; the reviewer command ran 0 times; the run holds no review invocation, is in SHIP with no stop and generation 1; the goal journal holds no `REVIEW_DECIDED` event. [R1] [dod arm 2]
  - 3. With the fence call of the reservation (`this.leases.fence(...)` after `this.renewOwnLease(card.id, current, now)` in `formalReview`) replaced by `void now;`, which typechecks, the test fails (reviewer-verified from the sweep below; the mutant is not committed). [R1]
  - 4. The typecheck reports no error, `tests/scenarios/two-windows.test.ts` passes unchanged, and `git diff --stat origin/main` lists only the two allowed paths. [R2] [dod arm 1] [dod arm 2]
depends_on: []
budget: 120
tdd: false
sweep: "On main at 5dee0caf, card-runner.ts holds three fences of the same text; the one of acceptance 3 is in formalReview's locked reservation (line 2464), after a first fence before the pool request (line 2420). Proposal 2 of intent/codebase-first-study.md removed it (mutant M5, on 2c260870): the tests under tests/scenarios, tests/core, tests/infra and tests/surface all pass on the behaviour (seven build tests failed only because that mutant did not typecheck). A prototype of this test in a scratch copy of 5dee0caf passes in 0.3 s on main; with the line replaced by `void now;` the typecheck is clean and the test fails: the reviewer runs once, the result is discarded (`discarded: ownership lost`) and A writes an ownership STOP onto the run B now owns, which B's next card next clears (OPERATIONS, ownership row). The same discard and stop follow a takeover during the reviewer run on main, where no fence can prevent them; this card is about the window before the reservation only."
forbid: [a change to src/, a change to docs/, a change to an existing test file, weakening or skipping a test to go green]
non_goals:
  - "the other two fences of the same text (the R2 reservation and the close step), which the scenario tests already catch (mutants M6 and M7)"
  - "the ownership STOP the commit fence writes after a takeover during the reviewer run, which the new owner's next card next clears as documented"
  - "a multi-process interleaving harness, which proposal 2 decided against"
hygiene: "From the proposal 2 measurement (_local, untracked) and Codex round 2, which found the fence reachable. tdd false: the test pins behaviour main already has, so no RED exists on main; acceptance 3 is the RED against the removed guard. No behaviour of aidlc changes, so no changelog fragment and no document change."
doc_sync: none
---

# T0-R3-RESERVE-FENCE-TEST

From the measurement of proposal 2 of `intent/codebase-first-study.md` (2026-11-26).

## Why
The lease fence at the R3 reservation is the only one of twelve concurrency guards whose removal no test catches. Without it, an owner that lost the card between its first fence and the reservation runs the reviewer, and the discarded result stops the new owner's run until its next card next.

## Deliverable
`tests/scenarios/r3-reserve-fence.test.ts`: one test with a takeover injected through the queue's `enqueue`.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/r3-reserve-fence.test.ts tests/scenarios/two-windows.test.ts
```
- Expected exit code: 0
- Assertion: a takeover after the first fence refuses A's reservation, no reviewer runs, and B's run stays in SHIP.
