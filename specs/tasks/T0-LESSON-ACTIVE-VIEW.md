---
id: T0-LESSON-ACTIVE-VIEW
title: "Lesson delivery leaves out every line that a resolving entry of docs/LESSONS-RETIRED.md retires"
status: todo
branch: T0-LESSON-ACTIVE-VIEW
allow_paths:
  - src/artifacts/lessons.ts
  - src/loop/context-pack.ts
  - tests/surface/lesson-retired.test.ts
  - tests/surface/lesson-retired-validator.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T0-LESSON-ACTIVE-VIEW.md
  - specs/tasks/T0-LESSON-ACTIVE-VIEW.md
dod_command: npm run typecheck && npm run check:tree && node --test tests/surface/lesson-retired.test.ts tests/surface/lesson-retired-validator.test.ts tests/surface/lessons.test.ts tests/surface/lesson-match.test.ts tests/scenarios/context-pack.test.ts tests/scenarios/card-writer-lessons.test.ts tests/scenarios/lesson-dup.test.ts tests/scenarios/second-pass.test.ts tests/surface/review-bench.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `src/artifacts/lessons.ts` shall export `RETIRED_LINE`, the anchored form `- <YYYY-MM-DD> RETIRE <old date> <old ref> <old sha256> BY <new date> <new ref> <new sha256>: <reason>` (each sha256 64 lowercase hex characters, the reason one line), and a pure `lessonRetirements(lessonsText, retiredText)` returning `{ retired, entries, problems }`: `retired` the set of retired lesson line texts; `entries` one record per resolving entry line, in file order, `{ line, old, by }` with `line` its 1-based line number in the retired text, `old` the 1-based line numbers in the lessons text it retires and `by` that of its replacement; `problems` one record per non-resolving entry line, `{ line, check }`. The entry count of the file is `entries.length + problems.length`; two identical resolving entry lines are two entries.
  - R2. An entry line (a line of the retired text that starts with `- `) shall resolve only when it matches `RETIRED_LINE`, its old hash is the SHA-256 of the exact text (no line terminator) of one or more valid lesson lines of the lessons text, its new hash is that of a valid lesson line of any kind after the last of them, and the date and ref of each side equal those of the lines it names; it then retires every lesson line with the old text. Otherwise it retires nothing and gives one problem naming the first failed check, in this order: `format`, `old line`, `replacement`, `date or ref`, `order`. Lines not starting with `- ` are ignored. A missing retired file retires nothing and reports nothing.
  - R3. The retired file shall be `LESSONS-RETIRED.md` beside the lessons file. `readLessons` (its count and its recent lines), `reviewLessons` and `matchedLessons` shall drop every retired line before they exclude NOTE lines, count, score (so idf is computed over the active lines only), rank or apply a cap. Every caller, the review bench (`src/review/bench.ts:236`, `:418`) included, gets this through these functions.
  - R4. `loadContextPack` (`src/loop/context-pack.ts:105`) shall read `docs/LESSONS-RETIRED.md` through its checked source read, with that path as the only allowed location for it (a path that resolves elsewhere throws as the lesson source does at `:122`), and pass `contextPack` the lessons text without its retired lines. A missing retired file adds nothing to `missingSources`. `contextPack` itself shall be unchanged.
  - R5. `hasLesson`, `findLesson` and `appendLesson` shall be unchanged and keep reading and writing the whole lessons file, so a close that repeats a retired lesson finds it and appends nothing.
  - R6. `docs/OPERATIONS.md`, the Lessons paragraph (`:855`), shall state R2 to R5 in at most two sentences placed after the sentence pair that `tests/scenarios/lesson-dup.test.ts:104-115` pins (`LESSONS_ANCHOR` directly followed by `OPERATIONS_SENTENCE`), which stays adjacent and unchanged; one changelog fragment shall record the card.
acceptance:
  - 1. `tests/surface/lesson-retired.test.ts`, new, importing only exports main has and computing entry hashes with `node:crypto`. Fixture lessons text, in order: A (ALWAYS, code term `fooBar`), B (NEVER, term `bazQux`), A again (identical text), D (ALWAYS, term `fooBar`), N (NOTE, the replacement); one entry retires A by N. One test each, each RED on main as its first failing assertion: `readLessons(file, 3)` gives count 3 and recent `[B, D, N]`; `reviewLessons` with a cap that fits two rules gives exactly `[D, B]` and the omitted count over the active rules; `matchedLessons` with a diff holding `fooBar` and `bazQux` and a cap that fits one rule gives exactly `[D]` (scoring all lines and then dropping A gives `[B]`, since A's copies lower the idf of `fooBar`). [R2] [R3] [dod arm 3]
  - 2. Same file, two separate tests: `loadContextPack` in a fixture repository whose card allows a path that A and D name returns lessons without A and with D, RED on main; a `docs/LESSONS-RETIRED.md` that is a link resolving outside that path throws, RED on main (main never reads it), skipped where links cannot be made as the link tests of `tests/scenarios/context-pack.test.ts` are. With no retired file, `missingSources` equals that of the same fixture on main. [R4] [dod arm 3]
  - 3. `tests/surface/lesson-retired-validator.test.ts`, new: for the fixture of acceptance 1, `lessonRetirements` returns `entries` `[{ line, old: [1, 3], by: 5 }]` and no problem; one entry line for each failed check of R2 (malformed, unknown old hash, unknown replacement hash, a date or ref that differs, a replacement before the last old line) gives one problem with that line and check and retires nothing, and the delivery results of acceptance 1 then equal those with no retired file; two identical resolving entry lines give two entries. [R1] [R2] [dod arm 3]
  - 4. `tests/surface/lesson-retired.test.ts`: with A retired, `findLesson` for A's card, kind, rule and source returns A and `hasLesson` for A's line is true. The existing lesson, match, pack, card-writer, lesson-dup, second-pass and review-bench tests pass unchanged; `git diff origin/main --stat -- tests/` lists only the two new files. [R3] [R5] [dod arm 3]
  - 5. R6 holds (reviewer-verified against the diff; `tests/scenarios/lesson-dup.test.ts` passes); `changelog.d/T0-LESSON-ACTIVE-VIEW.md` holds one line in the form of `changelog.d/README.md`. [R6] [dod arm 3]
  - 6. The typecheck and `npm run check:tree` are clean. [dod arm 1] [dod arm 2]
depends_on: []
budget: 190
tdd: true
sweep: "On main at fc3b8684. Lesson readers: `readLessons` (`src/artifacts/lessons.ts:134`), called at `src/loop/card-runner.ts:1525` (PREPARE) and `src/loop/controller.ts:320` (plan, project-cards); `ruleLines` (`lessons.ts`) under `reviewLessons` and `matchedLessons`, called at `card-runner.ts:2557-2565`, `:3211` and `src/review/bench.ts:236`, `:418`; `loadContextPack` (`src/loop/context-pack.ts:105`, called at `controller.ts:464` with the main root), which refuses a lesson source other than `docs/LESSONS.md` (`:122`) and keeps any `- ` line (`:85`). Tests that read lesson code: `tests/surface/lessons.test.ts`, `lesson-match.test.ts`, `pre-review.test.ts`, `review-bench.test.ts`, `gitleaks-ignore.test.ts`, `outcome-*.test.ts`, `release-version.test.ts`, `tests/scenarios/context-pack.test.ts`, `card-writer-lessons.test.ts`, `lesson-dup.test.ts`, `second-pass.test.ts`, `t0-flow.test.ts`, `tests/infra/init.test.ts`. Doc pins: `tests/scenarios/lesson-dup.test.ts:104-115` pins a sentence pair of `docs/OPERATIONS.md:855`; `tests/surface/prose.test.ts` caps the Sessions section only. The ten newest lessons were checked: sentence-pair and size pins (T0-README-PLAIN, T0-BOARD-SUPERSEDED), one RED test per behaviour whose first failing assertion is that behaviour (T0-STOP-JOURNAL), no new src file (T0-PROTECT-GIT)."
forbid: [network]
non_goals:
  - "a writer of the retired file, a CLI command, an `aidlc doctor` check and any entry: cards T0-LESSON-RETIRE and T0-LESSON-RETIRE-DATA"
  - "any change to the line format of `docs/LESSONS.md`, a new lesson kind, an id field, an audience mark or a score change (`intent/lesson-delivery.md`)"
  - "removing or moving any line of `docs/LESSONS.md`; the file keeps every line"
  - "retirement by age, delivery count, outcome or a model's judgement"
hygiene: "The owner asked in session (2026-11-28) for an improvement that removes old, unhelpful lessons and rules, planned with Codex; this is P0 card 1 of 3 of the agreed result. Five lines of docs/LESSONS.md are named by a later line as superseded or replaced and no code reads that: after the superseding day, 4 retained R3 prompts carried a superseded rule without its correction (all four decisions passed). The tests of existing readers import no new export, so on main they fail on the behaviour and not on the import (T0-STOP-JOURNAL). The tests write temp files only and set no variable the code reads."
---

# T0-LESSON-ACTIVE-VIEW

## Why
`docs/LESSONS.md` is append-only and a superseded lesson gets a later line that names it, but no code reads that: the superseded line keeps reaching PREPARE, the context pack and review prompts, and three of the corrections are NOTE lines, which never reach a reviewer. arXiv 2611.28244 found that removing skills from what the agent is offered beat merging them or promoting them to standing rules; here removal from delivery is done without rewriting the file, so the append guarantee, the duplicate guard and the citations of 98 card files stay as they are.

## Deliverable
A reader of `docs/LESSONS-RETIRED.md` and one validator shared by every delivery path; a retired line is left out of PREPARE, plan, project-cards, the context pack, both review selections and the review bench, and the remaining lines are counted, scored and capped as if it were absent. An entry that does not resolve retires nothing. No writer.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && npm run check:tree && node --test tests/surface/lesson-retired.test.ts tests/surface/lesson-retired-validator.test.ts tests/surface/lessons.test.ts tests/surface/lesson-match.test.ts tests/scenarios/context-pack.test.ts tests/scenarios/card-writer-lessons.test.ts tests/scenarios/lesson-dup.test.ts tests/scenarios/second-pass.test.ts tests/surface/review-bench.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: a lesson retired by a resolving entry reaches no delivery path and does not count toward selection; an unresolved entry retires nothing and is a problem.

## PR summary

### What
Lesson delivery now leaves out each line of `docs/LESSONS.md` that a resolving entry of `docs/LESSONS-RETIRED.md` retires. A new pure validator, `lessonRetirements`, checks each entry.

### Why / Intent
A superseded lesson still reached PREPARE, the context pack and review prompts. This change removes it from delivery and keeps the file append-only.

### How / Behaviour
An entry names the old and new lines by date, ref and SHA-256. `readLessons`, `reviewLessons`, `matchedLessons` and `loadContextPack` drop retired lines before they count, score or cap. An entry that fails a check retires nothing and gives one problem.

### System impact
PREPARE, plan, project-cards, the context pack, both R3 rule selections and the review bench get fewer lines when entries exist. With no retired file, nothing changes.

### Security
The context pack reads the retired file through its checked source read. A link that resolves to another path is refused.

### Tests and review
Two new test files cover acceptance 1 to 4. Existing lesson, match, pack, card-writer, lesson-dup, second-pass and review-bench tests pass unchanged.

### Risk
Low. A wrong entry retires nothing, so the failure mode is the current behaviour.

### Ownership
The loop maintainers own `src/artifacts/lessons.ts` and `src/loop/context-pack.ts`.

### Docs
`docs/OPERATIONS.md`, Lessons paragraph, gets two sentences. One changelog fragment records the card.

## Attempt evidence
Build attempt 1. RED receipt `c5f87bdd:T0-LESSON-ACTIVE-VIEW acceptance 1: readLessons counts and lists only the lines no entry retires [R3]` (acceptance 1 and 2 tests failed on their first assertion against main; the validator file failed on the missing `lessonRetirements` export, a new interface).

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/surface/lesson-retired.test.ts`, the three `acceptance 1` tests | pass (failed at RED: count 5, `[D, A]` omitted 3, `[B]`) |
| 2 | `tests/surface/lesson-retired.test.ts`, the two `acceptance 2` tests | pass (failed at RED: lessons `[A, A, D]`, no throw) |
| 3 | `tests/surface/lesson-retired-validator.test.ts`, four `acceptance 3` tests | pass |
| 4 | `acceptance 4` test; existing lesson, match, pack, card-writer, lesson-dup, second-pass, review-bench tests unchanged; `git diff origin/main --stat -- tests/` lists the two new files only | pass |
| 5 | `tests/scenarios/lesson-dup.test.ts`, `tests/surface/changelog-fragments.test.ts`; `docs/OPERATIONS.md` Lessons paragraph, two sentences after the pinned pair | pass |
| 6 | `npm run typecheck`, `npm run check:tree` | exit 0 |

Repair attempt 2 (R3 decision 1, F1, R6): the two `docs/OPERATIONS.md` sentences now also state R3 (the retired file is `LESSONS-RETIRED.md` beside the lessons file) and R4 (`loadContextPack` reads `docs/LESSONS-RETIRED.md` through its checked source read and throws when that path resolves elsewhere). Still two sentences after the pinned pair; `tests/scenarios/lesson-dup.test.ts` and `tests/surface/prose.test.ts` pass.

Guard sweep (each guard loosened, its test file run, restored):

| Guard | Loosened form | Failing test |
|---|---|---|
| `RETIRED_LINE` `^` anchor | removed | acceptance 3, each failed check |
| `RETIRED_LINE` `$` anchor | removed | acceptance 3, each failed check (reason with a lone CR) |
| old and new hash class `[0-9a-f]{64}` | `[0-9a-fA-F]{64}` | acceptance 3, each failed check |
| entry, old and new date class | `\S+` | acceptance 3, each failed check |
| old and new ref class `\S+` | `.+` | acceptance 3, each failed check |
| entry line filter `startsWith('- ')` | removed | acceptance 3, resolving entry, each failed check, two entries |
| hash only valid lesson lines | every line hashed | acceptance 3, each failed check |
| old date, old ref, new date, new ref equal | each comparison removed | acceptance 3, each failed check and delivery |
| replacement after the last old line `n.at > last` | `>=`; `last` as the first old line | acceptance 3, each failed check and delivery |
| delivery drops retired lines | filter keeps all | acceptance 1, three tests |
| missing retired file reads as empty | file never read | acceptance 1, three tests |
| pack: missing retired file not a missing source | always pushed | `tests/scenarios/context-pack.test.ts` and acceptance 2 |
| pack: retired file only at its own path | check skipped for it | acceptance 2, link test |
| pack: lessons without retired lines | retired text empty | acceptance 2, both tests |
