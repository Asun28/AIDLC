---
id: T1-BOUND-STATS
title: "`aidlc bounds [--goal <id>]` counts each loop bound that fired and the goal outcome after it, read only from the goal and card-run records"
status: todo
branch: T1-BOUND-STATS
worktree: D:\wt\AIDLC\T1-BOUND-STATS
plan_ref: docs/plans/PLAN-v5.1-hardening.md#2026-11-09-follow-up-cards
allow_paths:
  - src/state/bounds.ts
  - src/cli/main.ts
  - tests/infra/bounds.test.ts
  - tests/surface/bounds.test.ts
  - README.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-BOUND-STATS.md
dod_command: npm run typecheck && node --test tests/infra/bounds.test.ts tests/surface/bounds.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc bounds` shall read every goal record and every card run, or with `--goal <id>` that goal's, and shall write no file and append no journal line.
  - R2. For each row of the Derivation table below, the command shall count a firing from persisted fields only, never from `detail` text, counting card bounds per card run and goal bounds per goal.
  - R3. Each firing shall carry the current outcome of its goal: DONE, STOP/<goal stop reason>, or open.
  - R4. The command shall print one line `Bounds: <bound> <fired> (DONE n, STOP/<reason> n, open n); ...` with the bounds in the README Limits order, or `Bounds: none fired`, plus each goal's deadline extension count, and shall print JSON when stdout is not a TTY, as `aidlc review stats` does.
  - R5. WHEN a goal or card-run record cannot be read or fails its schema, the command shall exit 1 naming the file and its error code, without a stack trace.
  - R6. The docs shall state that a time STOP lifted by `aidlc goal extend` is not counted, that the outcome is the goal's current state, and that records are read one at a time with no snapshot across files.
acceptance:
  - 1. `tests/infra/bounds.test.ts` has one fixture per Derivation row, a STOP case and, where the row has one, a no-STOP case, each counted once under its bound. [R2] [dod arm 1]
  - 2. Same file: a card time STOP copied to the goal counts once; a CI STOP with no rerun for the candidate, R2 exhaustion, an ownership STOP and a `checkpoint` STOP with a `planRef` count under no bound. [R2] [dod arm 1]
  - 3. Same file: a firing takes its goal's current outcome; the run of a removed or superseded card is counted; a card with runs in two goals counts once per goal with each goal's outcome. [R3] [dod arm 1]
  - 4. Same file: the line keeps the Limits order, prints `Bounds: none fired` when nothing fired, and reports each goal's extension count; a time STOP that an extension lifted is not counted. [R4] [R6] [dod arm 1]
  - 5. `tests/surface/bounds.test.ts` runs the CLI on a temporary `AIDLC_STATE_DIR`: JSON when piped, `--goal` narrows, an unknown goal exits 1, a schema-invalid card run exits 1 naming the file and code with no stack trace, and the state directory is byte-identical afterwards. [R1] [R4] [R5] [dod arm 2]
  - 6. `git diff --numstat origin/main...HEAD -- src` totals at most +130, and `src/core/types.ts`, `src/loop/card-runner.ts`, `src/loop/controller.ts` and `src/state/journal.ts` are unchanged (git diff). [R1]
  - 7. README Limits, `docs/OPERATIONS.md` and the `docs/ARCHITECTURE.md` module map state the command and R6 (reviewer-verified against the diff). [R6]
depends_on: []
budget: 550
tdd: true
sweep: "grep -rn 'review stats\\|^## Limits' README.md docs/OPERATIONS.md docs/ARCHITECTURE.md CLAUDE.md templates/CLAUDE.aidlc.md: README.md:136 (Limits table), docs/OPERATIONS.md:368 (Review statistics, the command pattern to copy), docs/ARCHITECTURE.md:14 (src/state/ module list). CLAUDE.md and templates/CLAUDE.aidlc.md list no stats command and stay unchanged."
forbid: [a new journal event type, any write under the state directory, reading the journal, a new config key, a new lock, a change to any bound's value, a change to src/core/types.ts, src/loop/card-runner.ts, src/loop/controller.ts or src/state/journal.ts]
non_goals: [a Bounds line on the board (renderBoard or writeBoard), the board --watch view, the first terminal event after a firing, counting a time STOP that goal extend lifted, lifecycle repair cycles (not enforced in code), the worker cap (a cap, not a firing)]
doc_sync: README.md (Limits), docs/OPERATIONS.md (bound statistics), docs/ARCHITECTURE.md (module map), CHANGELOG.md
---

# T1-BOUND-STATS

Replaces the outbox design of T1-BOUND-TELEMETRY to -6, which the user stopped on 2026-10-09 ("bound telemetry returns as a smaller redesign on a new card"). No code of that line is reused. Its eight blocking R3 decisions were about the order between the persisted stop and the journal event; this card adds no write, so that order does not arise.

## Derivation
The pattern to copy is `aidlc review stats` (`src/cli/main.ts`, `src/review/stats.ts`): `listGoals`, `listCardRuns`, a pure summarizer with no clock, then `out()`.

| Bound | Reached, no STOP | Fired as a STOP |
|---|---|---|
| Card deadline | - | run `stop.reason` `time`, `unresolvedOperations` empty, `run.deadline` before the goal's `effectiveGoalDeadline` |
| Arc deadline | - | goal `stop.reason` `time`, `unresolvedOperations` empty, `stop.at` at or after `effectiveGoalDeadline` |
| Reconciliation grace | - | `stop.reason` `time` with `unresolvedOperations` not empty, on a run or a goal |
| Review decisions | `review.substantiveDecisions` at 2 or more | run stop `review` whose latest review invocation by `requestedAt` is an R3 block |
| No-verdict retry | `review.noVerdictRetriesUsed` at 1 or more | run stop `review` with `noVerdictRetriesUsed` above 1 |
| Transient CI rerun | a `ci.reruns` entry that is not `cancelled` | run stop `ci` with a rerun recorded for `candidate.digest` |
| Implementation attempts | `effort.escalationUsed` | run stop `card` with `effort.terminal` one of `same-cause-stop`, `exhausted`, `escalation-unavailable`, `escalation-failed` |
| Planning invocations | `counters.planningInvocations` at 2 or more | goal stop `checkpoint` with that counter at 2 or more and no `planRef` |
| Integration repair | `counters.integrationRepairCycles` at 1 or more | goal stop `arc-verify` |

A run without an `effort` field counts as attempts not fired. The extension count is `deadlines.extensions.length` of the goal record.

## Deliverable
`aidlc bounds [--goal <id>]` prints how often each loop bound fired and how the goals that hit it ended, derived from records the loop already writes. src/ gains one module, `src/state/bounds.ts`, and one command.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/bounds.test.ts tests/surface/bounds.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.

## Attempt evidence
Attempt 1. RED commit `6e6c160` (tests only): the DoD exited 2 there, `tsc` TS2307 for the missing `src/state/bounds.ts` and the CLI test failing on `unknown command 'bounds'`.
Attempt 2 repairs R3 decision 1: F1 adds the ci STOP whose only rerun is cancelled (fires once) and one whose rerun is for another candidate (does not fire); F2 adds the no-snapshot statement of R6 to the README Limits paragraph and the `docs/ARCHITECTURE.md` module map.

| Acceptance | Proved by | Result |
|---|---|---|
| 1 | `tests/infra/bounds.test.ts`, suite "Derivation rows": one test per row, the STOP case and, where the row has one, the reached case, each asserting the full set of fired bounds; the Transient CI rerun STOP case also alone (only a cancelled rerun) and with a rerun for another candidate | pass |
| 2 | same file, suite "STOPs that are not a bound": the card time STOP copied to the goal, both orders; ci STOP with no rerun, R2 exhaustion, ownership STOP, checkpoint STOP with a `planRef` | pass |
| 3 | same file, suite "outcomes": DONE, STOP/cancelled and open goals; a run of a card absent from `goal.cards`; one card with runs in two goals | pass |
| 4 | same file, suite "the line": exact line in Limits order, `Bounds: none fired`, `Extensions:` counts, an extension-lifted time STOP not counted, the effective deadline after an extension, escaped ids | pass |
| 5 | `tests/surface/bounds.test.ts`: piped JSON, `--goal` narrows, `--no-json` line, unknown and non-plain `--goal` exit 1, schema-invalid run and malformed goal exit 1 naming file and code with no stack trace, state directory snapshot byte-identical | pass |
| 6 | `git diff --numstat origin/main...HEAD -- src`: `src/cli/main.ts` +20, `src/state/bounds.ts` +101, total +121; `git diff origin/main...HEAD -- src/core/types.ts src/loop/card-runner.ts src/loop/controller.ts src/state/journal.ts` empty | pass |
| 7 | README.md Limits paragraph, `docs/OPERATIONS.md` "Bound statistics" (before "Review statistics", which tests pin to be followed by "Mutant sweep"), `docs/ARCHITECTURE.md` `src/state/` paragraph | reviewer to verify |
