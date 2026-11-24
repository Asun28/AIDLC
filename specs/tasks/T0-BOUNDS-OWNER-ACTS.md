---
id: T0-BOUNDS-OWNER-ACTS
title: "`aidlc bounds` reports the recorded owner acts by month (deadline extensions and how many came after the deadline, continuations, amendments, rulings), who recorded them, and the card runs left in STOP by month"
status: merged
branch: T0-BOUNDS-OWNER-ACTS
worktree: D:\wt\AIDLC\T0-BOUNDS-OWNER-ACTS
allow_paths:
  - src/state/bounds.ts
  - tests/infra/bounds.test.ts
  - tests/surface/bounds.test.ts
  - docs/OPERATIONS.md
  - README.md
  - changelog.d/T0-BOUNDS-OWNER-ACTS.md
  - specs/tasks/T0-BOUNDS-OWNER-ACTS.md
dod_command: npm run typecheck && node --test tests/infra/bounds.test.ts tests/surface/bounds.test.ts tests/surface/readme.test.ts tests/surface/command-lines.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `summarizeBounds` shall count four kinds of act from the records it is given, an entry of `deadlines.extensions` of a goal, an entry of `continuations` of a card run, an entry of `amendments` of a card run, and a finding of a card run that holds a `ruling` (one act per ruled finding, at `ruling.at`), each under the UTC calendar month `YYYY-MM` that is the first seven characters of its `at`.
  - R2. `BoundStats.acts` shall hold one entry per month with at least one act, earliest month first, with `month`, `extensions`, `extensionsAfterDeadline`, `hoursLateMedian`, `continuations`, `hoursFromStopMedian`, `amendments` and `rulings`.
  - R3. An extension shall count in `extensionsAfterDeadline` when its `at` is later than the deadline in force before it, which is `goalDeadline` for the first entry of a goal's `extensions` and the `newDeadline` of the entry before it for every other entry, in the order of the array.
  - R4. `hoursLateMedian` shall be the median of `at` minus that deadline over the month's `extensionsAfterDeadline` entries and `hoursFromStopMedian` the median of `at` minus `stop.at` over the month's continuations, each in hours, the lower of the two middle values for an even count, rounded to one decimal place, and `null` when the month has no such entry.
  - R5. `BoundStats.actors` shall hold one entry per distinct `by` text of the acts, the empty text included, ordered by that text in code unit order, with `by` and the four counts `extensions`, `continuations`, `amendments` and `rulings`.
  - R6. `BoundStats.stopped` shall hold one entry per month of `stop.at` with at least one card run that is in `STOP`, has a `stop`, and whose goal, when the records given hold it, is neither `DONE` nor stopped with the reason `cancelled`, earliest month first, with `month` and `reasons`, the count of those runs per stop reason in `StopReason` order with no zero entry.
  - R7. `formatBounds` shall print, after its `Extensions:` line, the three lines of the Line form section, with every `by` text printed through `asciiJson`.
  - R8. The Bound statistics section of `docs/OPERATIONS.md` shall state R1 to R7 and the four limits of the Limits section, and its command comment shall say five lines where it says two.
  - R9. The `aidlc bounds` sentence of `README.md` and `changelog.d/T0-BOUNDS-OWNER-ACTS.md` shall each say that the command reports the recorded owner acts by month, who recorded them, and the card runs left in STOP by month.
acceptance:
  - 1. `tests/infra/bounds.test.ts`, new tests on the fixture of the Fixture section. `summarizeBounds` gives exactly the `acts` and `actors` of that section. Each of these changes one number and is a case of its own, an extension at the deadline in force (not after it), an extension whose `by` is the empty text, a month with after-deadline extensions and an even count (the lower middle value), a month with no continuation (`hoursFromStopMedian` null), an act at `2026-10-01T00:00:00.000Z` (counted in `2026-10`). RED on main, where `BoundStats` holds neither key. [R1] [R2] [R3] [R4] [R5] [dod arm 2]
  - 2. Same file. `stopped` on the four runs of the Fixture section is the two entries given there, the run of the `DONE` goal and the run of the cancelled goal are in neither, and a run in `STOP` whose goal is not among the goals given is counted. [R6] [dod arm 2]
  - 3. Same file. `formatBounds` on the fixture prints the three lines of the Fixture section after its first two lines, and on records with no act and no stopped run prints `Acts: none`, `By: none` and `Stopped: none`. A `by` text holding an escape character and a character outside ASCII reaches the `By:` line escaped as the goal id of line 143 to 146 is. [R7] [dod arm 2]
  - 4. The three assertions that compare the whole text of the two-line form gain the new lines and nothing else of them changes, `tests/infra/bounds.test.ts:128` (`Acts: none`, `By: none`, `Stopped: none`), `:137` (`Acts: 2026-09 extensions 2 (0 after the deadline), continuations 0, amendments 0, rulings 0`, `By: "user" extensions 2, continuations 0, amendments 0, rulings 0`, `Stopped: none`) and `tests/surface/bounds.test.ts:67` (the three `none` lines). The JSON of the surface test carries `acts`, `actors` and `stopped` as empty lists for its records, and the `Payload` type of that file names them. Every other assertion of both files passes with no line changed. [R7] [dod arms 2, 3]
  - 5. Doc text (reviewer-verified against the diff). `docs/OPERATIONS.md`, Bound statistics, states R8, keeps its three existing limits and adds the four of the Limits section. `README.md` and the fragment state R9, the fragment in the form of `changelog.d/README.md`. [R8] [R9] [dod arms 4, 5, 6, 7]
  - 6. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 200
tdd: true
sweep: "On main at 9bdcf00b. `git grep -n -F 'Extensions: ' -- tests src docs README.md` finds src/state/bounds.ts:80, docs/OPERATIONS.md:543, tests/infra/bounds.test.ts (127, 128, 137, 145) and tests/surface/bounds.test.ts:67. Of those, 128, 137 and 67 compare the whole text of `formatBounds` or of the command's output and change with this card; 145 reads the second line alone and stays. `git grep -n -F 'two lines otherwise' -- docs README.md tests` finds docs/OPERATIONS.md:540 only. `git grep -n 'deadline extension count' -- tests docs README.md` finds README.md:156 and no test. `src/cli/main.ts:642-643` prints `asciiJson(stats, 2)` or `formatBounds(stats)` and needs no change. No surface test reads the Bound statistics paragraph."
forbid: [network]
non_goals:
  - "telling the owner from a delegate: `by` is free text and is printed as recorded"
  - "the time a run waited for a person: no record says who is awaited or when the request began"
  - "whether a stopped run was later replaced by a successor card: the command reads goal and card-run records only, as today"
  - "a change to `aidlc goal extend`, to a deadline, to a stop, or to what the nine bounds count"
  - "an extension paired with the act beside it (`_local/anthropic-practices-consensus/facts7.ts` holds that reading)"
hygiene: "From `intent/anthropic-practices-study.md`, P0 of the two-party result of 2026-11-24. The records hold 62 extensions in November 2026, 40 of them after the deadline, and no command prints them by month. RED first: the new tests of acceptance 1 to 3 and the three changed assertions of acceptance 4, committed before the source change. The expected values of the Fixture section were computed by a prototype of R1 to R7 that builds the fixture with tests/core/_fixtures.ts (`_local/anthropic-practices-consensus/bounds-proto.ts`, not tracked; both parties ran it); compute them again through `summarizeBounds` at GREEN and stop if one differs. `summarizeBounds` stays pure and takes no clock. Other open cards allow `docs/OPERATIONS.md` and `README.md`: run this card beside none of them and read the line numbers again at PREPARE. Checked against the newest lessons of docs/LESSONS.md on 2026-11-24: the empty `by` text is a case of its own (T0-PR-SUMMARY), every whole-text assertion of the changed output is named in the sweep (T0-RED-PATH-TEXT), the line count in the command comment moves with the lines (T0-PR-SUMMARY-REUSED), each document gets the whole rule (T0-PR-SUMMARY-REUSED), a record-sourced text is escaped before it reaches a line (T0-PREPARE-START-CMD), and each expected value was computed through code before registration (T0-DOD-VENV: `summarizeBounds` holds no such keys on main, so the prototype stands in for it); the two lessons of 2026-11-24 do not apply (the new tests exercise pure functions, and this card introduces no environment-dependent behaviour and leaves the existing CLI environment setup unchanged, T0-INIT-CLI-PATH; it adds no reader of the latest R3 decision, T0-ADVISORY-WITHDRAW)."
doc_sync: docs/OPERATIONS.md, README.md, changelog.d/T0-BOUNDS-OWNER-ACTS.md
---

# T0-BOUNDS-OWNER-ACTS

From `intent/anthropic-practices-study.md` (P0).

## Why
The acts the owner records to keep a run going are in the goal and card-run records and no command counts them. `aidlc bounds` prints how often each bound fired and a count of extensions per goal. Read by a script on 2026-11-24, the records hold 62 deadline extensions in November 2026 on 43 goals, 40 of them granted after the deadline had passed, about 5 hours after it at the median (the two middle values are 4.6 and 5.1 hours). The sources of the study name human time as the quantity to measure before a gate is loosened.

## Deliverable
`BoundStats` gains `acts`, `actors` and `stopped`, and the line form gains three lines. No command changes what it does.

## Line form
After the `Extensions:` line:
- `Acts: <month> extensions <n>[ (<m> after the deadline[, median <h> h late])], continuations <n>[ (median <h> h after the stop)], amendments <n>, rulings <n>; ...` with the first bracket printed when `<n>` of extensions is above 0, the median inside it when `<m>` is above 0, and the continuation bracket when its `<n>` is above 0; `<h>` always with one decimal. `Acts: none` when no act is recorded.
- `By: <by as a JSON string> extensions <n>, continuations <n>, amendments <n>, rulings <n>; ...`. `By: none` when no act is recorded.
- `Stopped: <month> <reason> <n>[, <reason> <n>]; ...`. `Stopped: none` when R6 counts no run.

## Fixture
Times are offsets from `T0` of `tests/core/_fixtures.ts` (`2026-09-11T00:00:00.000Z`); `goal()` gives a goal deadline of `T0` + 3 h.

Goal `g1`, `extensions` in array order: (1) at +2 h by `owner`, new deadline +6 h; (2) at +8 h by `owner`, new deadline +12 h; (3) at +13 h by the empty text, new deadline +20 h; (4) at +20 h by `owner`, new deadline +40 h. Goal `g2`, one extension at `2026-10-01T00:00:00.000Z` by `owner`, new deadline `2026-10-02T00:00:00.000Z`.

One card run of `g1`: `continuations` at +10 h (stop at +4 h), at +11.5 h (stop at +11 h) and at +12 h (stop at +9 h), each by `owner`; one amendment at +5 h by `owner`; finding F1 ruled at +7 h by `owner`, F2 with no ruling, F3 ruled at `2026-10-03T00:00:00.000Z` by `second`.

Expected `acts`:
- `2026-09`: extensions 4, extensionsAfterDeadline 2 (entry 2 is 2.0 h after +6 h, entry 3 is 1.0 h after +12 h; entry 1 is before +3 h and entry 4 is at +20 h), hoursLateMedian 1, continuations 3, hoursFromStopMedian 3 (of 6.0, 0.5 and 3.0), amendments 1, rulings 1.
- `2026-10`: extensions 1, extensionsAfterDeadline 1, hoursLateMedian 477 (from `2026-09-11T03:00:00.000Z`), continuations 0, hoursFromStopMedian null, amendments 0, rulings 1.

Expected `actors`: the empty text (extensions 1, the rest 0); `owner` (extensions 4, continuations 3, amendments 1, rulings 1); `second` (rulings 1, the rest 0).

Expected lines:
- `Acts: 2026-09 extensions 4 (2 after the deadline, median 1.0 h late), continuations 3 (median 3.0 h after the stop), amendments 1, rulings 1; 2026-10 extensions 1 (1 after the deadline, median 477.0 h late), continuations 0, amendments 0, rulings 1`
- `By: "" extensions 1, continuations 0, amendments 0, rulings 0; "owner" extensions 4, continuations 3, amendments 1, rulings 1; "second" extensions 0, continuations 0, amendments 0, rulings 1`

Stopped runs, each in `STOP` with a `stop`: run A of a goal in `STOP` for `review`, stopped for `review` at +1 h; run B of the same goal, stopped for `time` at `2026-10-02T00:00:00.000Z`; run C of a goal in `DONE`; run D of a goal in `STOP` with the reason `cancelled`. Expected `stopped`: `2026-09` with `review` 1, then `2026-10` with `time` 1. Expected line: `Stopped: 2026-09 review 1; 2026-10 time 1`.

## Limits
The four limits the documentation adds:
- An act is counted as recorded: an extension recorded by a coordinator under a delegation and one recorded by the owner differ only in their `by` text.
- An extension granted before a deadline passed and one granted to lift a time stop are both extensions; only `extensionsAfterDeadline` tells them apart.
- `stopped` counts runs left in `STOP`, a run whose card a later card replaced included; it does not say that anyone is awaited.
- A ruling is counted per finding, so one occasion on which the owner ruled several findings counts several times.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/bounds.test.ts tests/surface/bounds.test.ts tests/surface/readme.test.ts tests/surface/command-lines.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the fixture gives the acts, the actors, the stopped runs and the three lines of this card, the three whole-text assertions hold the new lines, and the README, command-line, changelog and prose checks pass.

## PR summary

### What
`aidlc bounds` now reports the recorded owner acts by month and who recorded them. It also reports the card runs left in STOP by month.

### Why / Intent
The owner records acts that keep a run going, and no command counted them by month. The study of Anthropic's articles asks for this measure before a gate changes.

### How / Behaviour
The JSON form gets `acts`, `actors` and `stopped`. The line form gets three lines after `Extensions:`. An extension is late when it comes after the deadline in force before it.

### System impact
Only `src/state/bounds.ts` changes under `src/`. No command changes what it does, and no record changes.

### Security
The command adds no input, network call or write. Each `by` text goes through `asciiJson` before it reaches a line.

### Tests and review
`tests/infra/bounds.test.ts` holds the fixture of the card and the edge cases. `tests/surface/bounds.test.ts` reads the command. R3 reviews the candidate.

### Risk
Low. A script that reads exactly two lines of the line form now gets five lines.

### Ownership
The aidlc loop maintainers.

### Docs
`docs/OPERATIONS.md`, `README.md` and `changelog.d/T0-BOUNDS-OWNER-ACTS.md` state the change.

## Attempt evidence
RED at a95ce1ad: 23 of the 41 tests of the two files failed. The new tests failed because `BoundStats` held no `acts`, `actors` or `stopped`, and the whole-text assertions because the line form had two lines.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/infra/bounds.test.ts`, the describe block `acceptance 1`: the fixture, the five named cases and the rounding, array-order, month-opening and code-unit cases | pass after the change |
| 2 | Same file, the describe block `acceptance 2`: the four runs, the unknown goal, a run not in STOP or with no stop, the StopReason order | pass after the change |
| 3 | Same file, the describe block `acceptance 3`: the fixture lines, the Stopped line, the none lines, the brackets, the escaped `by` text | pass after the change |
| 4 | The three whole-text assertions gain the new lines; the surface test reads the empty lists and its `Payload` type names the three keys; no other assertion of either file changed | pass after the change |
| 5 | `docs/OPERATIONS.md` (R1 to R7, the four limits, "five lines"), `README.md`, the fragment; `readme`, `command-lines`, `changelog-fragments` and `prose` tests | reviewer-verified; pass |
| 6 | DoD arm 1, `npm run typecheck` | pass |

Fixture values: `summarizeBounds` and `formatBounds` give the values of the Fixture section, and the three lines of the real records equal the prototype's on the same records (2026-11-24).

Guards: 33 loosened forms of the new conditions were run one at a time against `tests/infra/bounds.test.ts`, and a test failed for each.

Mutants: `aidlc card mutants` at 5b1b5ffe ran 18 mutants under the DoD, 17 killed and 1 survived. `equivalent:` the survivor, `a < b` to `a <= b` in the sort of `grouped`, since the keys of a Map are distinct and no comparison sees two equal ones.

DoD: exit 0; tests 83, pass 83, fail 0.
