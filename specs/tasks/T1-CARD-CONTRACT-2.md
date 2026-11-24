---
id: T1-CARD-CONTRACT-2
title: "A card run is created only for a card the registry holds and records one digest for each contract field of it, and pure rules give the fields that changed, the evidence they touch and the digest of an amended candidate (replaces T1-CARD-CONTRACT: carries its code, states the parser's rule for a list item and refuses a run for a card the registry lacks)"
status: merged
branch: T1-CARD-CONTRACT-2
worktree: D:\wt\AIDLC\T1-CARD-CONTRACT-2
plan_ref: plans/card-continuation.md#order-of-work
allow_paths:
  - src/core/types.ts
  - src/core/contract.ts
  - src/loop/controller.ts
  - tests/core/contract.test.ts
  - tests/scenarios/card-contract.test.ts
  - tests/scenarios/arc-reentry.test.ts
  - docs/ARCHITECTURE.md
  - changelog.d/T1-CARD-CONTRACT-2.md
  - specs/tasks/T1-CARD-CONTRACT-2.md
dod_command: npm run typecheck && node --test tests/core/contract.test.ts tests/scenarios/card-contract.test.ts tests/scenarios/arc-reentry.test.ts tests/core/amendments.test.ts tests/scenarios/fault-points.test.ts && npm run build && npm run bench -- --check
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The function `contractDigests` of `src/core/contract.ts` shall return one SHA-256 hex digest for each of `requirements`, `acceptance`, `allow_paths`, `forbid`, `non_goals`, `dod_command`, `dod_exit`, `budget` and `tdd`, computed over `JSON.stringify` of the value the parsed card holds for that field, with an absent `requirements`, `forbid` or `non_goals` taken as an empty list and an absent `budget` as `null`.
  - R2. WHEN `ensureCardRun` is called for a card that has no run in the goal and that the registry of the main checkout holds, the controller shall create the run with `contract`, the nine digests of that card as the registry holds it at that call.
  - R3. IF the card has no run in the goal and the registry of the main checkout does not hold it, THEN `ensureCardRun` shall throw with a cause that names the card, before any write and any journal append.
  - R4. WHEN the card has a run in the goal, `ensureCardRun` shall return that run as it is, whether or not the registry still holds the card and whatever the card file holds now.
  - R5. The function `changedContractFields` shall return, in the order of R1, the fields whose digest in a recorded contract differs from the digest of the card or is absent from the recorded contract.
  - R6. The function `invalidatedBy` shall return `dod` when the changed fields hold `acceptance`, `dod_command`, `dod_exit` or `tdd`, `review` when they hold `requirements`, `acceptance`, `allow_paths`, `forbid` or `non_goals`, both when both hold, and neither for `budget` alone and for no field.
  - R7. The function `amendedDigest` shall return its digest argument for a count of 0 and otherwise the SHA-256 hex digest of the previous result followed by a line feed and the word `amended`, applied that count of times.
  - R8. The `CardRun` schema shall hold an optional `contract`, a record from contract field to digest, and `amendments`, an array that defaults to empty, of entries with `at`, `by`, `reason`, `revision`, `changed` and `invalidated`.
  - R9. The file `docs/ARCHITECTURE.md` shall name `src/core/contract.ts` and state R1 to R8; `changelog.d/T1-CARD-CONTRACT-2.md` says in one entry that a new card run records a digest of each contract field, that no run is created for a card the registry does not hold, and that the command arrives with T1-AMEND-COMMAND.
acceptance:
  - 1. `tests/core/contract.test.ts`. `contractDigests` returns the nine keys of R1, each equal to the SHA-256 the test computes from the value. For each field, two cards that differ in that field alone differ in that digest alone. A card that leaves `forbid` out and one that gives it empty have the same digest for it, and so for `requirements` and `non_goals`; a card with no `budget` and one with a budget differ in that digest. [R1] [dod arm 2]
  - 2. Same file, card files read by the real parser. Two files that parse to the same card values give the same nine digests, one row each: another key order; a flow list against a block list; CRLF against LF line endings; a list item followed by an indented continuation line, which `blockList` (src/artifacts/frontmatter.ts) does not read. A file whose list item is folded so that the item's first line differs parses to another value, and that field's digest differs and no other. [R1] [dod arm 2]
  - 3. Same file. `changedContractFields` returns the differing fields in the order of R1, none for equal contracts, and all nine for an empty recorded contract. `invalidatedBy` gives the row of R6 for each of the nine fields alone, `dod` and `review` for `budget` with `acceptance`, and nothing for no field. [R5] [R6] [dod arm 2]
  - 4. Same file. `amendedDigest(d, 0)` is `d`; `amendedDigest(d, 1)` is the SHA-256 hex digest of `d`, a line feed and `amended`; `amendedDigest(d, 2)` equals `amendedDigest(amendedDigest(d, 1), 1)`, differs from `d` and differs from `amendedDigest(d, 1)`. [R7] [dod arm 2]
  - 5. `tests/scenarios/card-contract.test.ts`. A run that `ensureCardRun` creates holds `contract` deep-equal to `contractDigests` of its card. After the card file changes on disk, and after the card file is removed, `ensureCardRun` returns the run with the same `contract` and writes nothing. For a card the registry does not hold and that has no run, `ensureCardRun` throws with a cause that names the card, no run file exists afterwards and the goal's journal is byte-identical. `CardRun.parse` of a record without `contract` and without `amendments` gives `undefined` for the first and an empty array for the second, and a record with one amendment round-trips. [R2] [R3] [R4] [R8] [dod arm 2]
  - 6. `tests/scenarios/arc-reentry.test.ts` passes, and its only change is how the rows whose card has no registry entry get their run, with every assertion of the file as on main. [R3] [dod arm 2]
  - 7. The typecheck passes, `tests/core/amendments.test.ts` and `tests/scenarios/fault-points.test.ts` pass with no line changed, and `npm run build && npm run bench -- --check` exits 0. [dod arm 1] [dod arm 2] [dod arm 3]
  - 8. Each of the two texts holds what R9 assigns to it and no more is required of it (reviewer-verified against the diff). [R9]
depends_on: [T1-CONTINUE-CI]
budget: 250
sweep: "On main at 5cbc0077. `ensureCardRun` (src/loop/controller.ts, about :770) is the one place a run is created. git grep -n 'ensureCardRun(' -- src tests: the callers in src reach it after the card was read from the registry (src/cli/main.ts `runCtx` reads `cardOf` first) or through `aidlc card report`; in tests, tests/scenarios/arc-reentry.test.ts:63-66 (`seedRun`) calls it for two rows whose card has no registry entry (:120-122), the one test of the suite that R3 breaks, found by a full run with the refusal in place. `blockList` (src/artifacts/frontmatter.ts:202-215) reads the first line of a list item and skips an indented line that is not an item. The card schema is `Card` in src/core/types.ts; its nine contract fields hold strings, whole numbers, a boolean and lists of strings, so `JSON.stringify` of a value is canonical. No file of src/core imports from src/state."
forbid: [weakening or skipping a test to go green, changing or removing an assertion of tests/scenarios/arc-reentry.test.ts, a digest over the card file's bytes, a change to `candidate.digest` of any run, a change to src/artifacts/frontmatter.ts, editing .aidlc state by hand]
non_goals: [a change to how the parser reads a folded list item, the act that records an amendment and the use of `amendedDigest` in `recordAttempt` (T1-CARD-AMEND), a `contract` for a run created before this card, a report or a gate when the card differs from the recorded contract, a change to `routeAmendment` or to goal revisions]
hygiene: "Carries the code of the branch T1-CARD-CONTRACT at e16e4a72 (src/core/contract.ts, the schema fields, the tests), with two changes. Its `ensureCardRun` gave a run of a card the registry lacks an empty contract; this card refuses that run (R3), as the test at commit 446e089f of that branch asserted. Its tests/scenarios/arc-reentry.test.ts was outside the card; here `seedRun` gets the run of a row with no registry entry another way (write the card, create the run, remove the card file, or save a parsed record), and no assertion changes. Why the card was replaced: its acceptance 1 named 'other line breaks inside a list item' among layouts that parse to the same values, the first failing test expected a folded item to digest like the unfolded one, and the parser reads only an item's first line, in a file the card could not change; and the refusal that R3 of the review asked for (decisions 1 and 2, F3) broke arc-reentry.test.ts, outside its allow_paths. Start the branch from main and commit the tests alone first, so the first failing-test commit holds only assertions this card's acceptance states. Run `npm test` once before the attempt is recorded, name the new module in docs/ARCHITECTURE.md (tests/surface/module-map.test.ts) and run every test file that reads that document. The benchmark count of `cli.start` modules rises by one, within the ceiling's allowance."
doc_sync: docs/ARCHITECTURE.md
---

# T1-CARD-CONTRACT-2

## Deliverable
Each new card run records what its card's contract was when the run started, no run starts for a card the registry does not hold, and four pure functions hold the rules an amendment applies. No caller amends yet.

## Why
`specs/card-continuation.md`, R10 and R12 to R14: nothing binds a run to its card text today, so no command can say what an amendment changed or which evidence it touches.

This card replaces T1-CARD-CONTRACT for two defects of that card's text. One acceptance example could not hold: a list item folded over two lines does not parse to the value of the unfolded item, because the parser reads an item's first line. And the card left out the one test file that creates a run for a card with no registry entry, so the refusal the review asked for could not be made inside it.

## Rules that decide edge cases
- A digest is over the parsed value, never over the file's bytes: a layout the parser reads the same way is no change of contract, and text the parser does not read is not part of the contract.
- A run starts with all nine digests or does not start.
- `acceptance` touches both kinds of evidence; `budget` touches none.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/contract.test.ts tests/scenarios/card-contract.test.ts tests/scenarios/arc-reentry.test.ts tests/core/amendments.test.ts tests/scenarios/fault-points.test.ts && npm run build && npm run bench -- --check
```
- Expected exit code: 0
- Assertion: the typecheck reports no error, every test of the five files passes, the build succeeds and every benchmark count is within its ceiling.

## Attempt evidence
| Item | Evidence |
|---|---|
| RED | commit 842ce845: the tests of c640599a against stubs of the four functions (`{}`, `[]`, `[]`, the digest unchanged) and `types.ts` and `ensureCardRun` as on main. 24 tests ran, 20 failed on an assertion, none on an import, e.g. a digest `+ 'dda18a0e...' - 'f0b463d6...'` (R1/R5/R6 requirements row), the missing `contract` `undefined !== {}` (R2/R4), the missing refusal `Missing expected exception.` (R3). The four layout rows passed: they compare two digests of the same stub, `{}` with `{}`, so they prove nothing at RED. The typecheck fails there on `contract` and `amendments` absent from `CardRun`. Commit 230b652b, the import-only RED (`ERR_MODULE_NOT_FOUND`), was refused by R3 decision 1 |
| 1 | `tests/core/contract.test.ts`: nine keys in R1 order, each equal to the test's own SHA-256 of the value; nine single-field rows; absent `requirements`, `forbid`, `non_goals` = digest of `[]` = that of an empty list; absent `budget` = digest of `null`, not that of a budget |
| 2 | four layout rows through `parseCardText` (key order, block against flow list, CRLF, an indented continuation line after an item), each with equal values and nine equal digests; a folded item parses to `['R1. The x shall']` and changes `requirements` alone |
| 3 | nine rows give `changedContractFields` = `[field]` and the R6 row of `invalidatedBy`; order `['requirements','budget','tdd']`; equal = `[]`; recorded `{}` = all nine; `budget`+`acceptance` = `['dod','review']`; `[]` = `[]` |
| 4 | R7 test: counts 0, 1, 2 against the test's own chain; 2 = 1 applied twice; differs from `d` and from count 1 |
| 5 | `tests/scenarios/card-contract.test.ts`: `contract` deep-equals `contractDigests`; after the card file changes and is removed the same `contract`, run file bytes unchanged; absent card: throws naming T1-L, no run file, journal bytes unchanged; R8 parse, round trip, six rejected amendments |
| 6 | `seedRun` writes a card file for a row with no registry entry, creates the run and removes the file; no assertion changed; 5 of 5 pass |
| 7, 8 | DoD exit 0, 64 tests; `cli.start` modules 255/254; docs/ARCHITECTURE.md bullet (module, R1 to R8) and the changelog line |

Guard sweep (each loosened, the two card test files run, restored; every one fails a test): `?? []` and each `LISTS` member, `: null`, the `recorded[f] !== current[f]` filter, each member of `TOUCHES_DOD` and `TOUCHES_REVIEW`, `i < count`; in `ensureCardRun` the refusal (removed, and without the card's name), the digests (to `undefined`) and the existing-run return; `amendments` default, `contract` optional and each `CardAmendment` constraint.

R3 decision 1 (candidate c640599a, block), repair attempt 2. RED: commit 842ce845, 20 of 24 tests failed on an assertion against the stubs, the first "R1: contractDigests gives the nine fields, each the SHA-256 of the JSON of its value".
- F1 (import-only-red): RED 230b652b stopped at `ERR_MODULE_NOT_FOUND`; commit 842ce845 runs the unchanged tests against importable stubs and main's `ensureCardRun`, and the GREEN commit restores the code of c640599a with no test line changed.
