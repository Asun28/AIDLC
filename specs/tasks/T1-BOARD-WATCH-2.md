---
id: T1-BOARD-WATCH-2
title: "`aidlc board --watch [--interval <s>]` re-renders a read-only screen of one goal under a stated output contract"
status: merged
branch: T1-BOARD-WATCH-2
worktree: D:\wt\AIDLC\T1-BOARD-WATCH-2
plan_ref: docs/plans/PLAN-v5.1-hardening.md#2026-11-09-follow-up-cards
allow_paths:
  - src/state/board.ts
  - src/cli/main.ts
  - tests/infra/board.test.ts
  - tests/scenarios/board-watch.test.ts
  - README.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-BOARD-WATCH.md
  - specs/tasks/T1-BOARD-WATCH-2.md
dod_command: npm run typecheck && node --test tests/infra/board.test.ts tests/scenarios/board-watch.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc board [goalId] --watch [--interval <s>]` shall render the screen of the Output contract below every interval seconds (a whole number from 1 to 3600, default 5) until Ctrl-C or a closed stdout.
  - R2. The watch shall read only the goal record, the card runs of `goal.cards`, the goal lease and those cards' leases, and the card registry; it shall not call `aidlc next`, `writeBoard`, `currentActor` or the journal, and shall write no file.
  - R3. The screen shall show record text only as enum values, card ids, the validated goal id, integers and ISO timestamps; a lease owner session or host that does not match `^[A-Za-z0-9._:-]{1,64}$` shall be printed as a JSON string with every code point outside U+0020 to U+007E escaped as `\uXXXX`.
  - R4. WHEN a record cannot be read or fails its schema, the watch shall print its error code on that record's row, keep running, and show the record again on the next good read.
  - R5. The exit code and stderr for each failure shall be those of the Output contract table.
acceptance:
  - 1. `tests/infra/board.test.ts`: `renderWatch` on a fixture snapshot returns exactly the six line groups of the Output contract, with the stop reason only and a card that is not in the registry marked. [R1] [dod arm 1]
  - 2. Same file: a `stop.detail`, `nextAction`, blocker, title and request text holding a newline, ESC `[2J`, U+009B, U+202E or DEL never appear on screen; a lease owner holding them prints as a `\uXXXX`-escaped JSON string. [R3] [dod arm 1]
  - 3. Same file: an unreadable goal, card run or lease prints `state unreadable: <CODE>` or `<label> unreadable: <CODE>`, and the next good read of scripted reads renders normally. [R4] [dod arm 1]
  - 4. `tests/scenarios/board-watch.test.ts`: the CLI with `--interval 1` on a temporary state directory and no session variables prints two screens, exits 0 when stdout closes, and leaves the state directory byte-identical (no `session-default`, board file, `_local` mirror or journal line). [R1] [R2] [R5] [dod arm 2]
  - 5. Same file: `--interval` 0, 3601, 1.5 and `abc`, `--interval` without `--watch`, a goal id that is not plain and an unknown goal exit 1 with the stderr of the table, never echoing the value. [R1] [R5] [dod arm 2]
  - 6. Same file: stopping the injectable loop as SIGINT does exits 0 and writes nothing after it; a real-signal test, if any, is skipped on win32 with the reason stated. [R5] [dod arm 2]
  - 7. `git diff --numstat origin/main...HEAD -- src` totals at most +110, and `src/loop/controller.ts`, `src/state/journal.ts` and `src/loop/directive.ts` are unchanged (git diff). [R2]
  - 8. `docs/OPERATIONS.md`, the `docs/ARCHITECTURE.md` board paragraph and README state the command and the Output contract (reviewer-verified against the diff). [R1]
depends_on: []
budget: 500
size_exception: "budget 500 carried from T1-BOARD-WATCH (approved by the user on 2026-11-09); this successor was committed before the T0-CARD-SIZE rule reached main"
tdd: true
sweep: "grep -rn 'aidlc board' README.md docs/OPERATIONS.md docs/ARCHITECTURE.md CLAUDE.md templates/CLAUDE.aidlc.md .claude/skills/aidlc-loop/*.md: docs/OPERATIONS.md:168 (Sessions, state commands), docs/ARCHITECTURE.md:14 and :176 (board.ts and the board file), CLAUDE.md:130, templates/CLAUDE.aidlc.md:13 and .claude/skills/aidlc-loop/arc.md:5 describe the board view and need no change, since --watch is optional."
forbid: [a call to aidlc next or the goal controller, any write under the state directory, a change to the Directive schema, record text on screen other than the R3 kinds, a longer README Multi-session section]
non_goals: [the coded intake error on the plan directive (a directive-contract change), a Bounds line (T1-BOUND-STATS), merging local branch T1-RUN-DRIVER-3, the state-copy preview of next, a change to renderBoard or the board file]
hygiene: "Continues the branch line of T1-BOARD-WATCH at 480e4fe: R3 decision 1 blocked 19bbd77 (F1 behavioural RED, F2 empty goal id, F3 controller constructed), 9d7b7c4 repaired them and passed decision 2 with a clean second pass, the base-sync merge 1728e4b passed its base-sync decision, Windows CI then failed acceptance 4 on a test fixture path (8.3 short path) and 480e4fe fixes the test only. Carry the attempt evidence under a History line. Pass --goal on every card and review command. The full suite runs locally before SHIP."
doc_sync: docs/OPERATIONS.md (Sessions), docs/ARCHITECTURE.md (board.ts), README.md, CHANGELOG.md
---

# T1-BOARD-WATCH-2

Replaces T1-BOARD-WATCH by the user's ruling of 2026-11-10 on its STOP/review: the CI repair 480e4fe needed a fourth review decision, one more than the allowance.

The watch view is part (b) of plan item W5. It went through T1-RUN-DRIVER, -2 and -3, got six consecutive blocking R3 decisions, and the user deferred it on 2026-10-09 to "a new planned card with an explicit output contract" (df9acd7). Most of those findings came from running `next` on a copy of the state; R2 removes that code path. The two findings left open at 7e3c56d, record text printed raw (`stop.detail`, blocker, lease owner), are closed by R3.

Change from plan 4.5 (b): the screen shows the `Next:` pointer below in place of the next directive, because computing the directive writes derived transitions.

## Output contract
Screen, in order:
1. `aidlc watch: <goalId> at <ISO now> (view only; Ctrl+C ends it)`
2. `Goal: <GoalState>[ (terminal)], generation <n>, revision <n>, deadline <ISO>`
3. `Stop: <StopReason>`, only when the goal has a stop; never its detail or next action.
4. `Cards:`, then per id in `goal.cards`: `  <CardId> <state>[ stop <StopReason>][ blocker][ not in the card registry]`, or `  <CardId> unreadable: <CODE>`, or `  (none)`.
5. `Leases:`, then per live lease: `  goal|<CardId> owner <session> host <host> generation <n> until <ISO>`, or `  <label> unreadable: <CODE>`, or `  (none)`.
6. `Next: not computed (view only); run aidlc next --goal <goalId>`

When the goal record cannot be read, the screen is line 1 and `state unreadable: <CODE>`. Codes: READ_FAILED, MALFORMED_JSON, SCHEMA_VIOLATION, NOT_FOUND, else UNREADABLE (`readErrorCode` in `src/state/claims.ts`).

| Case | Exit | stderr |
|---|---|---|
| interval not a whole number from 1 to 3600 | 1 | `aidlc: --interval must be a whole number of seconds from 1 to 3600` |
| `--interval` without `--watch` | 1 | `aidlc: --interval needs --watch` |
| goal id not plain | 1 | `aidlc: board --watch: INVALID_GOAL_ID` |
| goal list unreadable while choosing the default goal | 1 | `aidlc: board --watch: <CODE>` |
| unknown goal | 1 | `aidlc: unknown goal <id>` |
| stdout closed by the reader (EPIPE) | 0 | nothing |
| any other stdout error | 1 | `aidlc: board --watch: <errno code>` |
| SIGINT | 0 | nothing; the timer is cleared and nothing more is written |

## Deliverable
`aidlc board --watch` shows one goal's state, card states and live leases, refreshed on an interval, without writing anything and without printing text a record could use to fake screen lines.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/board.test.ts tests/scenarios/board-watch.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.

## Attempt evidence

History: T1-BOARD-WATCH. RED 7329077 (DoD exit 2 on missing exports) and the behavioural RED of its tests against inert stubs, retained as `red-behavioral-T1-BOARD-WATCH` (typecheck 0, assertion failures). R3 decision 1 blocked 19bbd77 (F1 nonbehavioral-red, F2 empty-goal-selects-default, F3 watch-constructs-controller); 9d7b7c4 repaired them and passed decision 2 with a clean second pass; the base-sync merge 1728e4b passed its base-sync decision; Windows CI on PR 242 failed acceptance 4 (the goal lease row) on a test fixture path, 480e4fe fixed the test only, and the fourth review decision it needed stopped the card (STOP/review). This card continues at 480e4fe; its merges of main are 003415b and 7103287.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/infra/board.test.ts`, "renders the six line groups of the Output contract" (exact lines: Stop reason only, live leases only, `T1-GONE SHIP not in the card registry`) and "says (none) for no cards and no live lease" | pass |
| 2 | Same file, "never prints stop detail, next action, blocker or request text": newline, ESC `[2J`, U+009B, U+202E and DEL in stop detail, next action, blocker and request text are absent; owner and host print as `"sX\n\u001b[2J\u009b\u202e\u007f"`; the screen holds only U+0020 to U+007E and line breaks. Card titles never reach `renderWatch`: the registry is read as a set of ids; and "keeps a registry card title ... off the screen": a card held in memory whose title keeps all five characters (asserted first) goes through `watchRegistry`, the projection the CLI uses, which keeps only its id; the T1-A row is unmarked and no part of the title is printed (fails when the projection keeps titles). The CLI test of acceptance 4 also loads a registry card with a hostile title, of which the YAML card file keeps only part | pass |
| 3 | Same file, "prints a code on the row of a record that cannot be read": scripted reads give `state unreadable: MALFORMED_JSON`, `NOT_FOUND`, `T1-A unreadable: SCHEMA_VIOLATION`, `goal unreadable: READ_FAILED`, `T1-A unreadable: UNREADABLE`, an unreadable registry marks no card, and each next good read renders the row | pass |
| 4 | `tests/scenarios/board-watch.test.ts`, "prints two screens, exits 0 when its reader closes stdout, and writes nothing": no session variables, two exact screens (T1-A in the registry unmarked, T1-B marked) with the goal lease read under the CLI's canonical key, exit 0, empty stderr, state and repository directories byte-identical, no `session-default`; the fixture canonicalizes its temporary directory, so the lease key matches the CLI on a Windows runner (480e4fe; reproduced with TEMP on a junction) | pass |
| 5 | Same file, "refuses a bad interval ..." (0, 3601, 1.5, abc; 1 and 3600 reach the goal check; `--interval` without `--watch`; three non-plain ids; unknown goal) and "with no goal id checks the default goal" (unreadable goal list, an empty positional id and `--goal ''` with that list still unreadable, stored id not plain): exit 1 and the exact stderr of the table; the empty-id cases fail when an empty id selects the default goal | pass |
| 6 | Same file, "stopped the way SIGINT stops it" (mock timers: two screens, abort, nothing rendered or written after) and "ends quietly on EPIPE, reports any other stdout error code, and clears a terminal"; the real-SIGINT test is skipped on win32 (no SIGINT delivery to a child process there); "exits 1 naming the errno code" writes stdout to /dev/full (ENOSPC), skipped where /dev/full is missing. Both passed on Linux (WSL Ubuntu, Node 24.3: 7 of 7) | pass (2 skipped on win32) |
| 7 | `git diff --numstat origin/main...HEAD -- src`, the same at this card: main.ts 44/5, board.ts 66/1, total +110 -6 (net +104); the watch path never constructs the goal controller (`ctx()` builds it on first use); `git diff origin/main -- src/loop/controller.ts src/state/journal.ts src/loop/directive.ts` is empty | pass |
| 8 | `docs/OPERATIONS.md` new section "Watching a goal" (command, six line groups, codes, exit table, writes nothing) and one sentence in the Sessions bullet; `docs/ARCHITECTURE.md` board.ts paragraph and the board file row; README Quick start sentence; CHANGELOG entry | reviewer reads the diff |
