---
id: T0-R3-POOL-WAIT
title: aidlc review r3 answers a review pool that does not admit the request with the wait directive card next gives and exit 75, and the CLI entry prints a thrown error as one line, so a busy pool is no longer an uncaught error with a stack trace (issue 318)
status: todo
branch: T0-R3-POOL-WAIT
worktree: D:\wt\AIDLC\T0-R3-POOL-WAIT
allow_paths:
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - bin/aidlc.js
  - tests/scenarios/review-r3-wait.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-R3-POOL-WAIT.md
dod_command: npm run typecheck && node --test tests/scenarios/review-r3-wait.test.ts tests/scenarios/review-admit-foreign.test.ts tests/scenarios/fault-points.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `CardRunner.formalReview` finds that the shared review pool does not admit its request (admission `busy`, `behind`, `reset-pending` or any other status than `admitted`) or that a matching request is already running in the pool, it shall throw an error of an exported class that carries the card id, the pool, the admission status (or `running`), the requesters ahead and the reset time when there is one, with the message it throws today unchanged; no decision, invocation, journal event or card-run write is added by this change.
  - R2. WHEN `aidlc review r3` receives that error, the command shall write to stdout the JSON of a `wait` directive in the shape `card next` gives for the same state (`kind: "wait"`, `cardId`, `on: "review-pool:<pool>:<status>"` with `pollSeconds: 120`, or `on: "review:<request key>"` with `pollSeconds: 60` for a running match, and a `narration` that names the pool, the status and `aidlc review r3 <cardId>` as the command to run again), write nothing to stderr, and exit with code 75; every other error of the command keeps exit 1.
  - R3. WHEN the command line entry `bin/aidlc.js` receives a rejection from `main`, it shall write `aidlc: <message>` and a line break to stderr and exit 1, as the direct entry `node src/cli/main.ts` does, so no command prints a stack trace for a thrown error.
  - R4. `docs/OPERATIONS.md` shall state the wait output and exit 75 of `review r3` where it describes the R3 command, and `CHANGELOG.md` Unreleased shall carry R1 to R3 under this card id.
acceptance:
  - 1. tests/scenarios/review-r3-wait.test.ts - with pool `default` at `maxConcurrent: 1` held by another card's admitted request, `formalReview` of a second card rejects with the exported class, its fields naming the card, the pool, `busy` (and, for a request behind another, `behind` and the requester ahead), and the message the existing tests of tests/scenarios/review-admit-foreign.test.ts assert, which pass unchanged; the second card's run, `substantiveDecisions`, invocations and journal are equal before and after. [R1] [dod arm 1]
  - 2. tests/scenarios/review-r3-wait.test.ts - `node bin/aidlc.js review r3 <card> --goal <id>` against that state (a temporary `AIDLC_STATE_DIR` and repository) exits 75 with stdout parsing as one JSON object with `kind` `wait`, the card id, `on` `review-pool:default:busy`, `pollSeconds` 120 and a narration naming `aidlc review r3`, and empty stderr; a running matching request gives `on` `review:<key>` and `pollSeconds` 60. [R2] [dod arm 1]
  - 3. tests/scenarios/review-r3-wait.test.ts - `node bin/aidlc.js review r3` for a card with no card run exits 1 with exactly one stderr line starting `aidlc: ` and no line starting with `    at `. [R2] [R3] [dod arm 1]
  - 4. tests/scenarios/fault-points.test.ts (verify-card-run-writes) passes unchanged: no write of the card-run protocol is added, removed or reordered. [R1] [dod arm 1]
  - 5. docs/OPERATIONS.md and CHANGELOG.md Unreleased carry the rules under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R4] [dod arm 1]
depends_on: []
budget: 200
tdd: true
sweep: "grep -n \"admit.status !== 'admitted'\\|already running in pool\" src/loop/card-runner.ts: formalReview throws a plain Error at about line 2011 (a matching request running) and 2013 (not admitted); next() at about line 1339 returns a wait directive for the same state. grep -n \"command('r3\" -A12 src/cli/main.ts: the action awaits formalReview with no catch. bin/aidlc.js awaits mod.main(process.argv) with no catch, so a rejection is an unhandled rejection that Node prints with its stack and exit 1; the direct entry at the end of src/cli/main.ts catches and prints `aidlc: <message>`."
forbid: [weakening or skipping a test to go green, a change to the admission, the queue, the decision reservation or any card-run write, a change to the wait directive of card next, waiting or polling inside review r3, an exit code other than 75 for the wait or 1 for an error]
non_goals: [waiting for admission inside review r3 within the card deadline (issue 318 alternative), the same treatment for review pre (it takes no pool slot), bin/aidlc-hook.js, the exit codes of other commands]
diagnosis:
  root_cause: "CardRunner.formalReview (src/loop/card-runner.ts about line 2013) throws a plain Error when the review pool does not admit the request; the `review r3` action does not catch it and bin/aidlc.js awaits main() without a catch, so Node reports an unhandled rejection with the stack and exit 1. card next returns a structured wait directive for the same state (about line 1343). Reproduced in issue 318 (llm-wiki-flywheel, pool default/codex at maxConcurrent 1, two cards reaching R3 together): exit 1 and the stack trace, substantiveDecisions 0, the same command passing once the pool freed."
  same_class: "Every command whose action throws prints a stack through bin/aidlc.js (R3 fixes that for all); the other expected waits of formalReview are the two named in R1."
hygiene: "formalReview is covered by the verify-card-run-writes skill: run its check (tests/scenarios/fault-points.test.ts, in the DoD) before SHIP. Run the revert table before the first review (docs/LESSONS.md 2026-11-14 T1-OUTCOME-SUMMARY); the doc test reads the exact sentences (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS)."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-R3-POOL-WAIT

## Deliverable
`aidlc review r3` answers a busy, behind or reset-pending review pool, and a matching review already running, with the `wait` directive JSON that `card next` gives for the same state and exit 75, and the CLI entry prints any thrown error as one `aidlc: <message>` line, so an expected wait is never read as a crashed review.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/review-r3-wait.test.ts tests/scenarios/review-admit-foreign.test.ts tests/scenarios/fault-points.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.

## Attempt evidence
| Item | Proving test | Result |
|---|---|---|
| 1 [R1] | tests/scenarios/review-r3-wait.test.ts "acceptance 1: behind a foreign admitted request ..."; tests/scenarios/review-admit-foreign.test.ts unchanged | pass |
| 2 [R2] | tests/scenarios/review-r3-wait.test.ts "acceptance 2 and 3: ..." (busy: exit 75, `review-pool:default:busy`, 120; running: `review:<key>`, 60; empty stderr) | pass |
| 3 [R2] [R3] | tests/scenarios/review-r3-wait.test.ts "acceptance 2 and 3: ..." (no card run: exit 1, one `aidlc: ` line, no `    at `) | pass |
| 4 [R1] | tests/scenarios/fault-points.test.ts unchanged | pass |
| 5 [R4] | tests/scenarios/review-r3-wait.test.ts "acceptance 5: ..." (both tests) | pass |
| R3 F1 [R1] [R2] | tests/scenarios/review-r3-wait.test.ts "F1: ... rejects with status reset-pending ..." (in process) and "F1: ... review-pool:default:reset-pending, exit 75 ..." (bin/aidlc.js) | pass |
| R3 F2 [R3] | tests/scenarios/review-r3-wait.test.ts "F2: a rejection whose message spans lines ..." (bin/aidlc.js one joined line; src/cli/main.ts the message as thrown) | pass |
| CI 43712476165 | tests/scenarios/manifest-lock.test.ts (direct entry prints the multi-line message as thrown again); `npm run check` | pass |
