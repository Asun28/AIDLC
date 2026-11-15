---
id: T0-R3-POOL-WAIT-2
title: (replaces T0-R3-POOL-WAIT and carries its candidate) aidlc review r3 answers a review pool that does not admit the request with the wait directive card next gives and exit 75, and bin/aidlc.js prints an error thrown in a command's action as one line, so a busy pool is no longer an uncaught error with a stack trace (issue 318)
status: todo
branch: T0-R3-POOL-WAIT-2
worktree: D:\wt\AIDLC\T0-R3-POOL-WAIT-2
size_exception: "the coordinating session, 2026-11-15, under the owner's (asun28) instruction of that day to fix issues 316-318 through the loop and to pick answers itself while the owner is away: budget 380 for the successor of T0-R3-POOL-WAIT, which carries its candidate fe6b4f9c (377 changed lines: tests/scenarios/review-r3-wait.test.ts 300, src 51, bin 10, docs 4, card 12); the tests are the acceptance the card and its R3 findings call for"
allow_paths:
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - bin/aidlc.js
  - tests/scenarios/review-r3-wait.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-R3-POOL-WAIT.md
  - specs/tasks/T0-R3-POOL-WAIT-2.md
dod_command: npm run typecheck && node --test tests/scenarios/review-r3-wait.test.ts tests/scenarios/review-admit-foreign.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/manifest-lock.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `CardRunner.formalReview` finds that the shared review pool does not admit its request (admission `busy`, `behind`, `reset-pending` or any other status than `admitted`) or that a matching request is already running in the pool, it shall throw an error of an exported class that carries the card id, the pool, the admission status (or `running`), the requesters ahead and the reset time when there is one, with the message it throws today unchanged; no decision, invocation, journal event or card-run write is added by this change.
  - R2. WHEN `aidlc review r3` receives that error, the command shall write to stdout the JSON of a `wait` directive in the shape `card next` gives for the same state (`kind: "wait"`, `cardId`, `on: "review-pool:<pool>:<status>"` with `pollSeconds: 120`, or `on: "review:<request key>"` with `pollSeconds: 60` for a running match, and a `narration` that names the pool, the status and `aidlc review r3 <cardId>` as the command to run again), write nothing to stderr, and exit with code 75; every other error of the command keeps exit 1.
  - R3. WHEN the command line entry `bin/aidlc.js` receives a rejection from `main` (an error thrown in a command's action), it shall write `aidlc: <message>` with the message's line breaks joined by ` | ` and one line break to stderr and exit 1, so no such error prints a stack trace or more than one line; the direct entry `node src/cli/main.ts` keeps printing `aidlc: <message>` with the message as thrown and exit 1, and an error commander reports itself (a missing argument, an unknown option) keeps commander's own output.
  - R4. `docs/OPERATIONS.md` shall state the wait output and exit 75 of `review r3` where it describes the R3 command, and the one-line error of R3 limited to errors thrown in a command's action; `CHANGELOG.md` Unreleased shall carry R1 to R3 under the id T0-R3-POOL-WAIT.
acceptance:
  - 1. tests/scenarios/review-r3-wait.test.ts - with pool `default` at `maxConcurrent: 1`, `formalReview` of a card behind another card's admitted request rejects with the exported class, its fields naming the card, the pool, `behind` and the requester ahead, and the message tests/scenarios/review-admit-foreign.test.ts asserts, which passes unchanged; a pool whose reset is in the future gives `reset-pending` with its reset time; the card's run, `substantiveDecisions`, invocations and journal are equal before and after. [R1] [dod arm 1]
  - 2. tests/scenarios/review-r3-wait.test.ts - `node bin/aidlc.js review r3 <card> --goal <id>` against a busy pool exits 75 with stdout parsing as one JSON object with `kind` `wait`, the card id, `on` `review-pool:default:busy`, `pollSeconds` 120 and a narration naming `aidlc review r3`, and empty stderr; a running matching request gives `on` `review:<key>` and `pollSeconds` 60; a reset-pending pool gives `review-pool:default:reset-pending`. [R2] [dod arm 1]
  - 3. tests/scenarios/review-r3-wait.test.ts - `node bin/aidlc.js review r3` for a card with no card run exits 1 with exactly one stderr line starting `aidlc: ` and no line starting with `    at `; a rejection whose message spans lines prints one joined `aidlc: ` line through `bin/aidlc.js` and the message as thrown (first line `aidlc: `, no `    at ` line, exit 1) through `node src/cli/main.ts`; tests/scenarios/manifest-lock.test.ts, which reads the thrown message on the direct entry's stderr, passes unchanged. [R2] [R3] [dod arm 1]
  - 4. tests/scenarios/fault-points.test.ts (verify-card-run-writes) passes unchanged: no write of the card-run protocol is added, removed or reordered. [R1] [dod arm 1]
  - 5. docs/OPERATIONS.md and CHANGELOG.md Unreleased carry the rules; a test reads the exact sentences and fails with any one removed. [R4] [dod arm 1]
depends_on: []
budget: 380
tdd: true
sweep: "The candidate carried from T0-R3-POOL-WAIT (branch head fe6b4f9c): src/loop/card-runner.ts exports ReviewPoolWaitError, thrown at the two admission refusals of formalReview with the old messages; src/cli/main.ts catches it in the review r3 action only; bin/aidlc.js catches a rejection of main and joins its line breaks; tests/scenarios/review-r3-wait.test.ts holds every acceptance test, the R3 F1 and F2 tests and the doc test."
forbid: [weakening or skipping a test to go green, a change to the admission, the queue, the decision reservation or any card-run write, a change to the wait directive of card next, waiting or polling inside review r3, an exit code other than 75 for the wait or 1 for an error, a change to tests/scenarios/manifest-lock.test.ts or any test outside allow_paths]
non_goals: [waiting for admission inside review r3 within the card deadline (issue 318 alternative), the same treatment for review pre (it takes no pool slot), bin/aidlc-hook.js, the output of errors commander reports itself, review r3 on a card with no card run dispatching the reviewer (issue 328)]
diagnosis:
  root_cause: "CardRunner.formalReview (src/loop/card-runner.ts) throws a plain Error when the review pool does not admit the request; the `review r3` action does not catch it and bin/aidlc.js awaits main() without a catch, so Node reports an unhandled rejection with the stack and exit 1. card next returns a structured wait directive for the same state. Reproduced in issue 318 (llm-wiki-flywheel, pool default/codex at maxConcurrent 1, two cards reaching R3 together)."
  same_class: "Every command whose action throws printed a stack through bin/aidlc.js; R3 fixes that for all of them."
hygiene: "Replacement of T0-R3-POOL-WAIT (goal g-20261115105933-77ed2a), which stopped for review: R3 decision 1 blocked on an untested reset-pending wait (F1) and multi-line error output in bin/aidlc.js (F2), both repaired (F2 repro reproduced); decision 2, the second pass and the base-sync decision passed; CI run 43712476165 on PR 331 then failed tests/scenarios/manifest-lock.test.ts because the F2 repair also joined lines in the direct entry, and attempt 4 (fe6b4f9c) restored the direct entry, after which `npm run check` passed (3683 pass, 0 fail); the review that candidate needs exceeded the two-decision allowance. This card differs from the predecessor only in R3 and R4 (the line joining is bin/aidlc.js's alone; commander's own errors are outside it, issue 330), acceptance 1 to 3 (reset-pending, the direct entry, manifest-lock), the DoD (manifest-lock added) and the budget; it carries the branch at fe6b4f9c and runs its own R3. formalReview is covered by the verify-card-run-writes skill: its check is in the DoD."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-R3-POOL-WAIT-2

## Deliverable
`aidlc review r3` answers a busy, behind or reset-pending review pool, and a matching review already running, with the `wait` directive JSON that `card next` gives for the same state and exit 75; `bin/aidlc.js` prints an error thrown in a command's action as one `aidlc: <message>` line, so an expected wait is never read as a crashed review and no such error prints a stack trace.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/review-r3-wait.test.ts tests/scenarios/review-admit-foreign.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/manifest-lock.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
