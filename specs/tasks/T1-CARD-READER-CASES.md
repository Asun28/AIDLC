---
id: T1-CARD-READER-CASES
title: bench/outcome/reader-cases.ts builds the reader's case file, the 30 most recently added replaced cards with an item their successor changed and the 15 first-pass cards of evals/review/clean, each with the commit that first added the card, and exports the hit rule; bench/outcome/reader-cases.json is one such run
status: todo
branch: T1-CARD-READER-CASES
worktree: D:\wt\AIDLC\T1-CARD-READER-CASES
plan_ref: plans/card-preflight.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - bench/outcome/reader-cases.ts
  - bench/outcome/reader-cases.json
  - tests/surface/outcome-reader.test.ts
  - specs/tasks/T1-CARD-READER-CASES.md
dod_command: npm run typecheck && node --test tests/surface/outcome-reader.test.ts
dod_exit: 0
requirements:
  - R1. `bench/outcome/reader-cases.ts` (new) shall export `buildCases(deps)`, with `deps` of `{ git, pairs, successorCard, firstPass }` as body section Inputs defines them, which returns `{ ok: true, document }` with `document` of `{ considered, cases }` by the steps of body section Selection, or `{ ok: false, error }` for a failure of that section, and which reads no file and starts no process except through `deps.git`.
  - R2. Each case shall be `{ id, kind, successor, commit, items, changed }`, where `kind` is `replaced` or `first-pass`, `successor` is the successor's id or null, `commit` is the 40-hex commit that first added `specs/tasks/<id>.md`, and, for a replaced case, `items` and `changed` are those of `changedItems` (export of bench/outcome/replace-cause.ts, card T1-OUTCOME-REPLACE-CAUSE) over the card as it stood at `commit` and the successor's card of the registry; a first-pass case has `items` 0 and `changed` empty.
  - R3. The module shall export `isHit(result, c)`, a pure function over a reader result `{ unsupported: [{ item }] }` and a case, true exactly when the case's kind is `replaced` and an entry's `item` is a member of the case's `changed`; an entry with the item `body`, and an `R<n>` or `acceptance <n>` outside `changed`, never makes a hit.
  - R4. Run as `node bench/outcome/reader-cases.ts`, the script shall call `buildCases` with a `git` that runs `git` in the repository root through `runSync` (src/probes/exec.ts:220) with a 120 s timeout, the pairs of `replaceCause` (export of bench/outcome/replace-cause.ts) over `loadCardRegistry` of `specs/tasks`, and the `card.id` of each case that `loadBenchCases` (src/review/bench.ts:117) reads from `evals/review/clean`; on `ok` it writes `JSON.stringify(document, null, 2)` and one line feed to `bench/outcome/reader-cases.json` beside itself and exits 0; on an error it prints `reader-cases: <error>` on stderr, writes nothing and exits 1; any argument exits 1 with a usage line and writes nothing.
  - R5. `bench/outcome/reader-cases.json` shall be the document of one run of the script at the card's candidate, with 30 cases of kind `replaced` followed by 15 of kind `first-pass`.
acceptance:
  - 1. `tests/surface/outcome-reader.test.ts` (new), test "T1-CARD-READER-CASES acceptance 1: buildCases takes the 30 most recently added replaced cards with a changed item, in date order with ties by id, and the first-pass cards by id". `deps.git` is a function of the test that answers from tables and starts nothing. 33 pairs: 31 with a changed item, one newer than all others whose successor changed no item of the first text, one whose predecessor has no first-add record; two of the 31 share a commit date. The 30 replaced cases are the expected ids in the expected order, each with the `commit`, `items` and `changed` the tables give; the pair without a changed item is in `considered` with `eligible` false; the pair without a record is in neither list; the 15 first-pass cases follow in id order with `successor` null, `items` 0 and `changed` empty. Fails on main (no module). [R1] [R2] [dod arm 1]
  - 2. Same file, test "T1-CARD-READER-CASES acceptance 2: each failure returns its error and no document, and a pair that cannot be read is left out". One row each: `git rev-parse --is-shallow-repository` prints `true` (error holds `history`); it exits 128 (error holds `history`); `git log` exits 128 (error holds `git log` and the first stderr line); 29 eligible pairs (error holds `29 of 30`); 14 first-pass ids (error holds `14 of 15`); a first-pass id with no first-add record (error names the id). Left out, the run still `ok`: a pair for which `git show` exits 128, and a pair whose text at its commit does not parse; neither is in `considered` or in `cases`. Fails on main. [R1] [dod arm 1]
  - 3. Same file, test "T1-CARD-READER-CASES acceptance 3: isHit is true only for a replaced case and a named item of its changed list". For a replaced case with `changed` of `['R2', 'acceptance 3']`: true for a result that names `R2`, and for one that names `body` and `acceptance 3`; false for `R1`, for `acceptance 2`, for `body` alone, for `r2`, for `R2 ` with a trailing blank, and for an empty list. For a first-pass case: false for every result. Fails on main. [R3] [dod arm 1]
  - 4. Same file, test "T1-CARD-READER-CASES acceptance 4: reader-cases.json holds 30 replaced and 15 first-pass cases, chosen by the rule from the rows it records, and they agree with the registry and with evals/review/clean". No git call. The file has 30 cases of kind `replaced`, then 15 of kind `first-pass`, 45 distinct ids, every `commit` 40 hex characters; the `considered` rows sorted by date descending and id ascending, filtered to `eligible`, give in their first 30 the ids of the replaced cases in order; each replaced case's card is in this repository's registry with `superseded_by` equal to the case's `successor`, has a non-empty `changed` of references of the form of R2 and `items` of at least `changed.length`; the first-pass ids are the sorted `card.id` values of `loadBenchCases` over `evals/review/clean`. Fails on main (no file). [R5] [dod arm 1]
  - 5. Same file, test "T1-CARD-READER-CASES acceptance 5: with the history present, each case's commit is the first that added its card and each settled case's changed list is the one the registry gives". Skipped with the reason `shallow clone` when `git rev-parse --is-shallow-repository` in the repository root does not print `false`. Otherwise the one `git log` call of body section Selection step 2 gives, for each of the 45 ids, a first-add commit equal to the case's `commit`; and for each replaced case whose `considered` row has `settled` true, `changedItems` over the card text of `git show <commit>:specs/tasks/<id>.md` and the registry's successor card deep-equals the case's `{ items, changed }`. Fails on main (no file). [R2] [R5] [dod arm 1]
  - 6. The script's entry of R4 is the composition the requirement states, and at the candidate a run of it leaves `bench/outcome/reader-cases.json` unchanged (`git status --short` prints nothing for the file); the worker records that run in the Attempt evidence. (reviewer-verified against the diff) [R4]
depends_on: [T1-OUTCOME-REPLACE-CAUSE]
budget: 200
tdd: true
sweep: "Main at 35de54fe. First-pass source, read on 2026-11-16: `evals/review/clean/` holds 15 case files; each has `confirmedBy` equal to `CLEAN_RULE` (bench/outcome/clean.ts:13), which begins `a clean draft of a card run whose first R3 decision passed, whose card file has status merged and no superseded_by`; a clean draft is made only for a run whose first decided R3 invocation passed (`cleanDraft`, src/review/bench.ts:589-594); tests/surface/outcome-clean.test.ts:67-75 pins the count of 15 and that each card is merged with no successor. The `clean` group of bench/outcome/labels.jsonl is not a first-pass set: bench/outcome/labels.ts:70 takes merged cards that have a merge-blocking formal finding, and its 15 cards share no id with the 15 of evals/review/clean (compared on 2026-11-16). Three of the 15 first-pass cards are successors of replaced cards: T0-BENCH-DRAFTS-IGNORE-2, T0-HOOK-CLASSIFIER-3, T0-INTAKE-TARGET-2. The first-add commit of each of the 15, and of each of the 30 most recently added eligible replaced cards at 35de54fe, changes no file under `src/` or `tests/` (`git show --name-only`, 2026-11-16). History: `git log --diff-filter=A --format=%x01%H%x09%cI --name-only -- specs/tasks` took 0.2 s at 35de54fe and listed every card file; one `git log --diff-filter=A -- specs/tasks/<id>.md` per card took minutes for 348 cards on Windows, hence the one call. CI checks out without history: .github/workflows/ci.yml:27 uses actions/checkout with no fetch-depth, so a test that needs old commits cannot run there; acceptance 5 skips, and acceptance 4 runs everywhere. Scratch run of 2026-11-16 at 35de54fe on the registry text: 101 pairs; an acceptance or requirements field differs in 90; a referenced item of the replaced card differs in or is absent from the successor in 81; in 9 the successor only added items, so those can never be hit and are not eligible; 496 of 1491 referenced items changed. `git grep -n 'reader-cases\\|outcome-reader' -- tests src bench docs`: no hit. tests/surface/bench.test.ts:211 forbids an import of `bench/` from `src/`; this card imports `src/` from `bench/` only."
forbid:
  - a front-matter parser other than `parseCardText` and `loadCardRegistry` of src/artifacts/card.ts, or a comparison other than `changedItems` of bench/outcome/replace-cause.ts
  - a model call, a network call, or a read of the state directory
  - a git call in acceptance 1 to 4, and a git call that writes anywhere
  - a case chosen or removed by hand in bench/outcome/reader-cases.json
  - a change to bench/outcome/replace-cause.ts, evals/review/clean or src/
  - a new CLI command or option of `aidlc`, and a gate that reads the case file
  - in the test file `Date.now()`, a temporary directory that does not come from `tmpDir` of tests/infra/helpers.ts, or a process left running
non_goals:
  - running the reader; the coordinator runs it on the 45 cases after this card and T1-CARD-READER-CLI merge (plans/card-preflight.md, Order of work, step 4)
  - a replaced card whose successor only added items; it has no changed item and is not eligible
  - a card file that was renamed; `git log --diff-filter=A` without rename detection reports the first commit that added a file of that path
  - a first-add commit that also holds the card's code; the script does not look, and the sweep records that none of the 45 commits found at 35de54fe changes `src/` or `tests/`
  - a first-pass card that was itself a successor; three of the 15 are, and the rule of evals/review/clean is kept as it is
  - a later amendment of a successor that is not settled; its case keeps the list of the run, and acceptance 5 compares settled cases only
  - a rerun after the registry gained replaced cards; it can choose other cases, so the file is regenerated only by a card that says so
  - a CHANGELOG.md entry and a document; T1-CARD-READER-REPORT writes docs/reliability/card-reader.md
hygiene: "Line numbers are from main at 35de54fe; read them again at PREPARE. Tests first: acceptance 1 to 3 fail on main for the missing module. Generate bench/outcome/reader-cases.json last, after the base is merged, from a checkout with full history. The JSON file is generated and is not counted in the budget; estimate for the rest: the script about 90 lines, the test about 105. Revert rows, each a scratch change restored afterwards: the date order reversed (acceptance 1 red); the tie broken by descending id (1 red); the registry text of the replaced card used in place of the text at its commit (1 red); `body` counted as a hit (3 red); a first-pass case counted as a hit (3 red); one case removed from the file (4 red); one commit of the file replaced by its parent (5 red)."
---

# T1-CARD-READER-CASES

## Deliverable
The case file the reader is measured on, the script that selects it, and the rule that decides in code whether a reader result hit a case.

## Why
Spec specs/card-preflight.md R6 and the design rule that a hit is decided in code. The reader must see a card as it was first written and the code as it was then, so each case carries the commit that first added the card file (plans/card-preflight.md, Risks). The changed list is therefore computed from the card text at that commit, not from the registry's text of the replaced card, which may have been amended before it was replaced.

Two differences from the outline, read in the data. The first-pass set is the 15 cards of `evals/review/clean`, not the `clean` group of bench/outcome/labels.jsonl, whose cards have blocking findings (sweep). Eligibility is by item, not by field: a successor that only added items changed no item the reader could name.

## Inputs
- `git(args)`: runs `git` with the argument array and returns `{ ok, stdout, stderr }`, `ok` true for exit code 0 without a timeout.
- `pairs`: rows of `{ id, successor, settled }`, as `replaceCause` returns them.
- `successorCard(id)`: the `Card` of that id in the registry, or undefined.
- `firstPass`: card ids.

## Selection
1. `git(['rev-parse', '--is-shallow-repository'])`. Not `ok`, or stdout, trimmed, other than `false`: error `the repository history is not complete; run from a checkout with full history`.
2. `git(['log', '--diff-filter=A', '--format=%x01%H%x09%cI', '--name-only', '--', 'specs/tasks'])`. Not `ok`: error `git log failed: ` and the first stderr line. The output is split at the byte 0x01; each record's first line is a commit and a committer date separated by a tab, and its other non-blank lines are paths. For each path the record that comes last in the output is its first add, since git prints the newest commit first.
3. For each pair, with the first-add record of `specs/tasks/<id>.md`: no record, `git(['show', '<commit>:specs/tasks/<id>.md'])` not `ok`, `parseCardText` of that text with `strict: false` returning an error, or no `successorCard`: the pair is left out. Otherwise a `considered` row `{ id, successor, commit, date, settled, eligible }`, `eligible` true when `changedItems(cardAtCommit, successorCard).changed` is not empty.
4. Sort `considered` by `date` descending, compared as instants (`Date.parse`), then by `id` ascending by code unit. The first 30 eligible rows are the replaced cases, in that order. Fewer than 30: error `<n> of 30 replaced cases`.
5. `firstPass` sorted ascending by code unit. Not 15 ids: error `<n> of 15 first-pass cases`. For each, the first-add record gives `commit`; no record: error `no first-add commit for <id>`. No `git show` is made for a first-pass card.
6. `document` is `{ considered, cases }`, the 30 replaced cases followed by the 15 first-pass cases.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-reader.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; acceptance 5 runs, not skips, in the card worktree.
