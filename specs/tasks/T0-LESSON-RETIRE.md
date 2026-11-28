---
id: T0-LESSON-RETIRE
title: "`aidlc lessons retire` appends one validated retirement entry, and `aidlc doctor` lists entries that do not resolve"
status: todo
branch: T0-LESSON-RETIRE
allow_paths:
  - src/artifacts/lessons.ts
  - src/cli/main.ts
  - tests/surface/lesson-retire.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T0-LESSON-RETIRE.md
  - specs/tasks/T0-LESSON-RETIRE.md
dod_command: npm run typecheck && npm run check:tree && node --test tests/surface/lesson-retire.test.ts tests/surface/lesson-retired.test.ts tests/surface/lesson-retired-validator.test.ts tests/surface/lessons.test.ts tests/scenarios/lesson-dup.test.ts tests/surface/doctor-interrupted-writes.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `src/artifacts/lessons.ts` shall export `retireLesson(lessonsFile, { line, by, reason, date })`, which reads the lessons file and the `LESSONS-RETIRED.md` beside it, builds the entry for lines `line` and `by` in the form `RETIRED_LINE` of card T0-LESSON-ACTIVE-VIEW (the given UTC date; the date, ref and SHA-256 of each line computed from the file; the reason), and appends it through `appendRetirement` only when both are valid lesson lines, the reason is one non-empty line, `line` is not already retired by a resolving entry of that retired file, and `lessonRetirements` over the two texts with the new entry added reports no problem for it; it returns the entry and the absolute path written, or the failed check with nothing written. `aidlc lessons retire --line <n> --by <m> --reason "<text>"` shall call it on `docs/LESSONS.md` of the checkout it runs in (`repo.worktreeRoot`, `src/cli/main.ts:75-84`) with today's UTC date, print the entry and the path (`--json`: both as fields), or exit non-zero naming the failed check.
  - R2. `src/artifacts/lessons.ts` shall export `appendRetirement(file, entryLine)`, which creates the file with its header and the entry in one exclusive append and otherwise appends the entry as one literal line, as `appendLesson` does (`:117-131`); no code path writes the retired file in any other way, so bytes another writer appends after `retireLesson` reads the file survive its write.
  - R3. `aidlc doctor` shall add a `lessonRetirements` check over the main checkout's two files (`repo.mainRoot`), computed by `lessonRetirements` and nothing else: the text `none` when the retired file is absent, `ok (<k> entries)` when it has no problem, with k the number of entry lines, else `PROBLEMS: ` followed by `entry <line>: <check>` for each problem, joined by `; `; in `--json` the value is `{ entries, problems }` with `entries` the number of entry lines (0 when the file is absent) and `problems` the validator's records.
  - R4. `docs/OPERATIONS.md`, the Lessons paragraph, shall state R1 and R3 in at most two sentences placed after the sentence pair that `tests/scenarios/lesson-dup.test.ts:104-115` pins and after the sentences of card T0-LESSON-ACTIVE-VIEW; one changelog fragment shall record the card.
acceptance:
  - 1. `tests/surface/lesson-retire.test.ts`, new: in a temp git repository with a linked worktree whose `docs/LESSONS.md` differs from the main checkout's (other lines at the requested numbers, so hashes taken from main would differ) and whose `docs/LESSONS-RETIRED.md` differs too: `aidlc lessons retire` run in the worktree appends one entry to the worktree's retired file whose hashes, dates and refs are those of the worktree's lines, which `lessonRetirements` over the worktree's files resolves with the requested old and replacement lines, and prints it and the absolute path; a line that the worktree's retired file already retires and main's does not is refused, and a line that main's retired file retires and the worktree's does not is retired; the main checkout's two files stay byte-identical in every case. RED on main (no `lessons` command). [R1] [dod arm 3]
  - 2. Same file, one test each, each leaving the retired file byte-identical or absent: line n or m not a lesson line; an empty or multi-line reason; line n already retired; lessons A, C, A with line 1 retired by line 2, which the validator refuses (`order`), so the command refuses it although 2 is greater than 1. [R1] [dod arm 3]
  - 3. Same file, three tests: with no file, two `appendRetirement` calls write the header once and both entries; a file that another creator made empty and has not written to gets the entry appended and loses nothing, with no header written by this call; and a deterministic interleaving inside `retireLesson`: a stub of `fs.readFileSync` (installed with `mock.method` and `syncBuiltinESMExports`, as `tests/scenarios/context-pack.test.ts:122-136` does) returns the retired file's bytes to the first read of that file and then appends entry E2 through the real fs, so E2 lands after `retireLesson` read the file and before it writes; afterwards the file holds the bytes it had before the call, then E2, then the new entry E1. An implementation that writes the whole file from its read loses E2 and fails. [R2] [dod arm 3]
  - 4. Same file: `aidlc doctor --json` in a temp repository gives `lessonRetirements` `{ entries: 0, problems: [] }` with no retired file, `{ entries: 1, problems: [] }` with one resolving entry, and `{ entries: 2, problems: [{ line, check }] }` with one resolving and one unresolved entry; a separate test of the human output gives `none`, `ok (1 entries)` and `PROBLEMS: entry <line>: <check>` for the same three files. [R3] [dod arm 3]
  - 5. R2's single write path and R4 hold (reviewer-verified against the diff); the changelog fragment holds one line in the form of `changelog.d/README.md`. [R2] [R4] [dod arm 3]
  - 6. The typecheck and `npm run check:tree` are clean. [dod arm 1] [dod arm 2]
depends_on: [T0-LESSON-ACTIVE-VIEW]
budget: 190
tdd: true
sweep: "On main at fc3b8684. `aidlc doctor` builds its checks at `src/cli/main.ts:321-358`; tests that read its output: `tests/surface/doctor-interrupted-writes.test.ts`, `tests/infra/stray-processes.test.ts`, `tests/surface/hook-wiring-local.test.ts`, `tests/surface/init-no-package.test.ts`, `tests/surface/readme.test.ts` (none lists every key). No test enumerates the top-level commands. `repo.worktreeRoot` is the checkout the CLI runs in and `repo.mainRoot` the main checkout (`src/cli/main.ts:75-84`); `aidlc review bench export` already writes under `worktreeRoot` (`:1359`). `docs/OPERATIONS.md:855` holds the sentence pair `tests/scenarios/lesson-dup.test.ts:104-115` pins. The ten newest lessons were checked as for T0-LESSON-ACTIVE-VIEW."
forbid: [network]
non_goals:
  - "any entry in this repository's files, and the close hint: card T0-LESSON-RETIRE-DATA"
  - "a command that unretires a line; a wrong entry is followed by a correcting card"
  - "retirement by age, delivery count, outcome or a model's judgement; an audit of candidates"
  - "README.md and docs/ARCHITECTURE.md text"
hygiene: "P0 card 2 of 3 of the agreed result of 2026-11-28. The command writes the checkout it runs in, so a card writes its entries in its worktree and a close writes them in the main checkout; doctor and delivery read the main checkout, which is what the loop uses. The tests write temp repositories only; the doctor tests set AIDLC_STATE_DIR to their temp state directory as tests/surface/doctor-interrupted-writes.test.ts does. RED first: acceptance 1 on main."
---

# T0-LESSON-RETIRE

## Why
Card T0-LESSON-ACTIVE-VIEW makes delivery honour `docs/LESSONS-RETIRED.md`; this card writes it. Typing a 64-character hash by hand is the error lesson line 237 records, so the command computes both hashes from the file and checks the entry with the same validator delivery uses. An entry that stops resolving retires nothing, so doctor makes it visible.

## Deliverable
`aidlc lessons retire`, an append-only writer and a doctor check. No entry in this repository.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && npm run check:tree && node --test tests/surface/lesson-retire.test.ts tests/surface/lesson-retired.test.ts tests/surface/lesson-retired-validator.test.ts tests/surface/lessons.test.ts tests/scenarios/lesson-dup.test.ts tests/surface/doctor-interrupted-writes.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the command appends one entry the validator resolves, in the checkout it runs in, or refuses and writes nothing; concurrent writers lose nothing; doctor reports the main checkout's entries and problems.

## PR summary

### What
This change adds `aidlc lessons retire`, an append-only writer for `LESSONS-RETIRED.md` and a `lessonRetirements` doctor check.

### Why / Intent
Card T0-LESSON-ACTIVE-VIEW reads retirement entries, but nothing wrote them. A hash typed by hand is easy to get wrong.

### How / Behaviour
The command computes the dates, refs and hashes from the lessons file. It appends the entry only when the delivery validator resolves it. Otherwise it names the failed check and writes nothing.

### System impact
The command writes the checkout it runs in. Doctor reads the main checkout, which delivery also reads.

### Security
No new input reaches a shell. The command writes one file beside `docs/LESSONS.md` and opens it only in append mode.

### Tests and review
`tests/surface/lesson-retire.test.ts` covers the linked worktree, each refusal, the append race and the doctor output. Each guard was loosened once and a test failed.

### Risk
Low. An entry that does not resolve retires nothing, and doctor lists it.

### Ownership
The aidlc maintainers own the lessons files and this command.

### Docs
`docs/OPERATIONS.md`, Lessons paragraph, states the command and the doctor check. The changelog fragment records the card.

## Attempt evidence

| # | Proving test or command | Result |
|---|---|---|
| 1 | lesson-retire.test.ts: acceptance 1, linked worktree | pass |
| 2 | lesson-retire.test.ts: acceptance 2, four refusal tests | pass |
| 3 | lesson-retire.test.ts: acceptance 3, three appendRetirement and retireLesson tests | pass |
| 4 | lesson-retire.test.ts: acceptance 4, doctor --json and human output | pass |
| 5 | single write path: `appendRetirement` is the only writer of the retired file; OPERATIONS.md Lessons paragraph two sentences; changelog-fragments.test.ts | pass |
| 6 | `npm run typecheck`, `npm run check:tree` | pass |

Guard sweep (each loosened once, `node --test tests/surface/lesson-retire.test.ts`):

| Guard | Loosened form | Test that failed |
|---|---|---|
| `appendRetirement` exclusive create `flag: 'ax'` | `flag: 'a'` | acceptance 1, 3 (all three) |
| line feed before an entry when the file lacks one | never added | acceptance 3, empty file |
| line n not a lesson line | check removed | acceptance 2, not a lesson line |
| line m not a lesson line | check removed | acceptance 2, not a lesson line |
| reason `trim()` non-empty | removed | acceptance 2, reason |
| reason one line | removed | acceptance 2, reason |
| line n already retired | `some(() => false)` | acceptance 1; acceptance 2, already retired |
| validator problem refuses | check removed | acceptance 2, order |
| problem matched at the entry's line | `at + 1` | acceptance 2, order |
| line feed added to a retired text without one before validation | never added | acceptance 2, order (file without a last line feed) |
| doctor: absent file gives `none` and 0 entries | check removed | acceptance 4, both tests |
| doctor: entries counts resolving and problem lines | resolving only | acceptance 4, --json |
| doctor: `none` text | never | acceptance 4, human |
| doctor: `ok` when no problem | always `ok` | acceptance 4, human |

equivalent: `retiredText.length > 0` in the line feed check: an empty text then validates with a blank first line, which is not an entry, and the problem lookup reads the same text, so no input gives a different outcome.
