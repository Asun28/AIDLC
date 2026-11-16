---
id: T1-OUTCOME-REPLACE-CAUSE
title: bench/outcome/replace-cause.ts compares every card that carries superseded_by with its successor through the repository's card parser and prints which of five fields and which items changed and which paths were added; bench/outcome/replace-cause.json is one such run, and a surface test recomputes its settled pairs from the registry
status: todo
branch: T1-OUTCOME-REPLACE-CAUSE
worktree: D:\wt\AIDLC\T1-OUTCOME-REPLACE-CAUSE
plan_ref: plans/card-preflight.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - bench/outcome/replace-cause.ts
  - bench/outcome/replace-cause.json
  - tests/surface/outcome-replace-cause.test.ts
  - specs/tasks/T1-OUTCOME-REPLACE-CAUSE.md
dod_command: npm run typecheck && node --test tests/surface/outcome-replace-cause.test.ts
dod_exit: 0
requirements:
  - R1. `bench/outcome/replace-cause.ts` (new) shall export `replaceCause(registry, readText)`, which takes a `CardRegistry` as `loadCardRegistry` returns it (src/artifacts/card.ts:224) and a function that returns the text of a card file, and returns `{ pairs, successorMissing, totals }`, where `pairs` holds one row, in the order of `registry.cards`, for each card whose `card.superseded_by` is the id of a card of the registry, and `successorMissing` holds the id of each card whose `superseded_by` is the id of no card of the registry.
  - R2. Each row shall be `{ id, successor, settled, changed, budget, items, changedItems, addedPaths }` as body section Row defines it, every comparison made on text in which each occurrence of the longer of the two card ids and then of the shorter is replaced by `ID`, so that `T1-FOO` in the replaced card and `T1-FOO-2` in its successor compare equal.
  - R3. The module shall export `changedItems(predecessor, successor)`, which returns `{ items, changed }` over two `Card` values as body section Row defines them, and `totalsOf(pairs, successorMissing, cards, parseErrors)`, which returns the totals of body section Totals; `replaceCause` computes its rows and totals through them.
  - R4. Run as `node bench/outcome/replace-cause.ts`, the script shall read `specs/tasks` under the repository root that holds it (two directories above its own file) with `loadCardRegistry`, with no archive directory, and print `JSON.stringify(document, null, 2)` and one line feed on stdout with exit 0; with `--out <file>` it writes those bytes to the file, resolved against the process directory, and prints nothing; any other argument, or `--out` without a value, exits 1 with one usage line on stderr and writes nothing.
  - R5. `bench/outcome/replace-cause.json` shall be the document of one run of the script at the card's candidate; in every later registry each of its rows with `settled` true equals the row `replaceCause` computes for that pair, and its `totals` equal `totalsOf` over its own `pairs` and `successorMissing` with its own `totals.cards` and `totals.parseErrors`.
acceptance:
  - 1. `tests/surface/outcome-replace-cause.test.ts` (new), test "T1-OUTCOME-REPLACE-CAUSE acceptance 1: a row names the changed fields, the changed items and the added paths with the card ids normalised". The registry is built in memory from card texts given to `parseCardText` (src/artifacts/card.ts:85) with a file name each, and `readText` returns those texts, so nothing is read from disk: the pairs of body section Test cases, each row deep-equal to the expected row. Fails on main (no module). [R1] [R2] [R3] [dod arm 1]
  - 2. Same file, test "T1-OUTCOME-REPLACE-CAUSE acceptance 2: the totals count each row once and a missing successor is listed, not paired". Over the registry of acceptance 1 plus a card whose `superseded_by` names no card, `totals` deep-equals the literal object the test states, with every key of body section Totals, and `successorMissing` holds that card's id. Fails on main. [R1] [R3] [dod arm 1]
  - 3. Same file, test "T1-OUTCOME-REPLACE-CAUSE acceptance 3: replace-cause.json holds the registry's settled pairs as the registry gives them, and its totals are those of its rows". `replaceCause` over `loadCardRegistry` of this repository's `specs/tasks`, with a `readText` that reads the file. For each row of the committed file with `settled` true, the computed pairs hold a row of that `id` and it deep-equals the file's row; for each row with `settled` false, the computed pairs hold a row of that `id` and `successor`; the file's `totals` deep-equal `totalsOf` over the file's own `pairs`, `successorMissing`, `totals.cards` and `totals.parseErrors`; the file holds at least one pair. Pairs the registry gained after the file was written are not compared. Fails on main (no file). [R5] [dod arm 1]
  - 4. Same file, test "T1-OUTCOME-REPLACE-CAUSE acceptance 4: the script prints the document, --out writes it, and any other argument exits 1 with nothing written". Runs of `node bench/outcome/replace-cause.ts` with the repository root as the process directory. No argument: exit 0, and stdout parses to the value `replaceCause` computes in the test process. `--out <file in a directory from tmpDir of tests/infra/helpers.ts>`: exit 0, empty stdout, and the file parses to the same value. `--bogus`, then `--out` alone: each exit 1, empty stdout, one stderr line that starts with `usage:`, and the temporary directory holds no new file. Fails on main. [R4] [dod arm 1]
  - 5. At the candidate, `node bench/outcome/replace-cause.ts` prints a document that parses to the same value as `bench/outcome/replace-cause.json`; the worker records the comparison in the Attempt evidence. (reviewer-verified against the diff) [R5]
depends_on: []
budget: 200
tdd: true
sweep: "Main at 35de54fe. `git grep -n 'replace-cause' -- tests src bench docs README.md CHANGELOG.md templates .claude scripts`: no hit. `git grep -n readdirSync -- tests/surface/outcome-*.test.ts tests/surface/bench.test.ts`: no test lists `bench/outcome/` (outcome-clean.test.ts:69 lists `evals/review/clean`, outcome-replay.test.ts:72 `evals/review/replay`, outcome-usage.test.ts:136 and :236 fixture directories, bench.test.ts:148 a temporary directory, and bench.test.ts:224 walks `src/` for imports of `bench/`, which this card does not add). tests/surface/outcome-baseline.test.ts reads five named files of bench/outcome (:10) and no other. tsconfig.test.json includes `bench/**/*.ts`, so `npm run typecheck` covers the script. Parser facts read: `superseded_by`, `budget` and `dod_command` are scalars with a trailing comment removed (card.ts:101-103, :128; frontmatter.ts:185, :102); `acceptance` and `requirements` are block lists, one string per item (card.ts:115-116; frontmatter.ts:202); `loadCardRegistry` skips files whose name starts with `_` and puts a file `parseCardText` rejects into `errors` (card.ts:230-236). bench/outcome/clean.ts:35 and :63 show the house form of a script that resolves the root from its own file and runs `main` only when it is the entry. Why the test compares settled pairs only: a push that changes only `specs/**` starts no CI run (.github/workflows/ci.yml:6-12), and cards are amended in place on main while they are open (commits 64ce6f58 and b474d7eb of 2026-11-16 are two such amendments), so a comparison of every pair would fail on the next pull request after an unrelated card commit. Scratch run of 2026-11-16 at 35de54fe with this card's rules and the repository parser: 348 cards, 0 parse errors, 101 pairs, 0 missing successors, 0 pairs not settled; acceptance changed in 89, requirements in 74, allow_paths in 26, dod_command in 18, budget in 64 (raised 59, lowered 5); 10 pairs with no field changed; a path added in 22 pairs (a test path in 17, a src path in 12, a doc path in 2, another path in 2); 46 added paths, 5 named in the replaced card's text; 1491 item references, 496 changed, in 81 pairs; every requirement and acceptance item of the 101 replaced cards has a reference and none repeats. These are orientation, not acceptance values: main has gained cards since. Budget estimate: the script about 90 lines, the test about 85."
forbid:
  - a front-matter parser other than `loadCardRegistry` and `parseCardText` of src/artifacts/card.ts
  - an import of `bench/` from `src/`
  - a git call, a network call or a read of the state directory in the script or in the test
  - a row or a total written or corrected by hand in bench/outcome/replace-cause.json
  - a new CLI command or option of `aidlc`
  - editing docs/, bench/outcome/README.md, CHANGELOG.md or any card file but this one
  - in the test file `Date.now()`, a temporary directory that does not come from `tmpDir`, or a process left running
non_goals:
  - the report document; T1-OUTCOME-REPLACE-REPORT writes docs/reliability/replacement.md from the committed file
  - the stop reason of each replaced card; bench/outcome/summary.json holds stop reasons as totals per reason only (`/views/summary_stop_reasons`, rows of `stopReason` and `runs`; bench/outcome/views/10-cards.sql:81), and the per-card reason is in the state directory, which is not committed
  - a CHANGELOG.md entry and a section in bench/outcome/README.md; the script changes no behaviour of the loop or of the CLI
  - the archive directory; the script reads `specs/tasks` only, and an absent `specs/tasks` gives a document with no pair, as `loadCardRegistry` returns no card for an absent directory (card.ts:228)
  - a card file that does not parse; it is counted in `totals.parseErrors` and is in no pair
  - an item of `requirements` or `acceptance` without a reference at its start; it is counted in no item total, and the field comparison still sees it
  - a later edit of a compared field of a card in a settled pair, or of the text of its replaced card; acceptance 3 then fails until the file is regenerated with `node bench/outcome/replace-cause.ts --out bench/outcome/replace-cause.json`
  - why a field changed; the comparison reads text only
hygiene: "Line numbers are from main at 35de54fe; read them again at PREPARE. Tests first: acceptance 1, 2 and 4 fail on main for the missing module. Generate bench/outcome/replace-cause.json last, after the base is merged, with `node bench/outcome/replace-cause.ts --out bench/outcome/replace-cause.json`. The JSON file is generated and is not counted in the budget; the script and the test are. Revert rows, each a scratch change restored afterwards: the shorter id replaced first (acceptance 1 red); a path only the successor names counted as named (1 red); `settled` taken from the replaced card (1 red); a missing successor counted as a pair (2 red); one settled row of the JSON edited by hand (3 red)."
---

# T1-OUTCOME-REPLACE-CAUSE

## Deliverable
A script that reads the card registry with the repository's own parser and states, for each replaced card, what its successor changed, and one committed run of it that a test checks against the registry.

## Why
docs/reliability/baseline.md (Outcome) reports that 93 of 324 card attempts were replaced by a successor. intent/card-preflight.md gives totals from a scratch script that read front matter with its own parser and is not committed. Spec specs/card-preflight.md R1 asks for the comparison as a committed script. T1-OUTCOME-REPLACE-REPORT reports the totals, and T1-CARD-READER-CASES reuses `replaceCause` and `changedItems` to pick its cases.

The committed registry changes with every new card (sweep). tests/surface/outcome-baseline.test.ts avoids that by reading committed snapshot files only. This card keeps a snapshot too, and recomputes from the registry only the pairs that the loop's rules no longer let change: the pairs whose successor is merged or is itself replaced.

Difference from the planner's scratch totals: with the card ids normalised in all five fields, 10 pairs have no changed field, not 2.

## Row
For a replaced card P and its successor S (both `ParsedCard`), with `n(text)` the id normalisation of R2:

- `id`, `successor`: the two card ids.
- `settled`: true when S has status `merged` or carries `superseded_by` (the opposite of the `active` rule at src/artifacts/card.ts:150).
- `changed`: five booleans. `acceptance`: the lists `P.card.acceptance` and `S.card.acceptance`, each item through `n`, differ in length or in any item. `requirements`: the same over `card.requirements`, an absent list read as empty. `allow_paths`: the sets of `n(entry)` differ. `dod_command`: `n(P.card.dod_command)` differs from `n(S.card.dod_command)`. `budget`: `P.card.budget` differs from `S.card.budget`, an absent budget differing from a number.
- `budget`: `raised` when both cards have a budget and S's is larger, `lowered` when both have one and S's is smaller, else `null`.
- `items`, `changedItems`: the `items` and `changed` of `changedItems(P.card, S.card)`. An item reference is `R<n>` for a `requirements` item that matches `^R(\d+)\.\s*(.*)$` and `acceptance <n>` for an `acceptance` item that matches `^(\d+)\.\s*(.*)$`; its text is the second group through `n`. `items` is the number of references of P. `changed` lists, requirements first and then acceptance, in P's order, each reference of P whose text differs from the text of the same reference in S or that S does not have.
- `addedPaths`: for each `n(entry)` of S's `allow_paths` that is not among P's, in S's order, `{ path, kind, named }`. `path` is the normalised entry. `kind` is read from the path with backslashes as slashes and a leading `./` removed: `test` when it starts with `tests/`, `src` when it starts with `src/`, `doc` when it starts with `docs/` or holds no slash and ends in `.md`, else `other`. `named` is true when `n(readText(P.file))` contains `path`.

## Totals
`cards` (`registry.cards.length`), `parseErrors` (`registry.errors.length`), `pairs`, `successorMissing` (a count), `acceptance`, `requirements`, `allow_paths`, `dod_command`, `budget` (pairs with that boolean true), `budgetRaised`, `budgetLowered`, `unchanged` (pairs with all five booleans false), `pairsWithChangedItem`, `items`, `changedItems` (sums over pairs), `pairsWithAddedPath`, `pairsAddingTest`, `pairsAddingSrc`, `pairsAddingDoc`, `pairsAddingOther` (pairs with at least one added path of that kind), `addedPaths`, `addedPathsNamed`. All are integers.

## Test cases
Acceptance 1 uses at least these pairs, written as card texts in the test:
- `T1-FOO` replaced by `T1-FOO-2`: the acceptance item names the card's own id in both cards and is otherwise equal (not changed); R1 differs (changed, `changedItems` is `['R1']`); `allow_paths` holds `specs/tasks/T1-FOO.md` in one and `specs/tasks/T1-FOO-2.md` in the other (equal after normalisation), and S adds `tests/x.test.ts`, which P's body names (`test`, named), and `docs/A.md`, which P does not name (`doc`, not named); budget 100 against 150 (`raised`).
- `T1-BAR-2` replaced by `T1-BAR-3`, S in status `todo` (`settled` false): acceptance 2 is absent from S (`changedItems` is `['acceptance 2']`); S adds acceptance 3 (the field is changed, the list of changed references is not longer for it); S adds `README.md` (`doc`), `src\a.ts` written with a backslash (`src`) and `.claude/x.md` (`other`); budget 200 against 100 (`lowered`).
- `T1-RUN` replaced by `T1-OTHER`, a successor with an unrelated id, in status `merged`: every field equal after normalisation; `unchanged` counts it.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-replace-cause.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.
