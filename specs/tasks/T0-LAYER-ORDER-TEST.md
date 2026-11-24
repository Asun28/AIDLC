---
id: T0-LAYER-ORDER-TEST
title: "CLAUDE.md states the layer order the tree obeys, and a test reads every import under src/ from the syntax tree and fails on an import against that order, on a dependency of src/core/ on another directory or on a Node built-in other than crypto, on a cycle between top-level units, and on a unit that is in no list"
status: todo
branch: T0-LAYER-ORDER-TEST
worktree: D:\wt\AIDLC\T0-LAYER-ORDER-TEST
allow_paths:
  - tests/surface/layers.test.ts
  - CLAUDE.md
  - docs/ARCHITECTURE.md
  - specs/tasks/T0-LAYER-ORDER-TEST.md
dod_command: npm run typecheck && node --test tests/surface/layers.test.ts tests/surface/module-map.test.ts tests/surface/prose.test.ts tests/surface/claude-md-size.test.ts tests/surface/claude-md-reuse.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The reader of `tests/surface/layers.test.ts` shall take the module specifiers of a TypeScript source text from its syntax tree (`ts.createSourceFile`), namely a static import, an `import type`, a side-effect import, a named re-export, `export * from`, `export * as ns from`, `export type * as ns from`, a dynamic import whose argument is a string literal and an `import('...')` type, and none from a comment, a string, a template literal or a dynamic import whose argument is not a literal.
  - R2. The check shall report an import between two of the ten ranked directories, which are `core`, `scaffold`, `probes`, `state`, `coordination`, `delivery`, `review`, `loop`, `hooks` and `cli` from inner to outer, whose importing directory comes before the imported one in that order.
  - R3. The check shall report a file under `src/core/` that imports a file of another top-level unit of `src/`, or a Node built-in other than `crypto`, named with or without the `node:` prefix.
  - R4. The check shall report a cycle in the graph of the top-level units of `src/`, where a unit is a directory, or a root file by its name.
  - R5. The check shall report a top-level unit that is neither ranked nor one of the unranked units `artifacts`, `audit`, `evals`, `maintain`, `providers`, `config.ts` and `index.ts`, taking the units from the list of source files, so that a unit whose files import nothing and are imported by nothing is reported too.
  - R6. The Module map of `docs/ARCHITECTURE.md` shall state that the ranked order is the order of the Layers sentence of `CLAUDE.md`, and name the unranked units, each of the four rules and the test file.
  - R7. The Layers sentence of `CLAUDE.md` shall read as the Rules section gives it, with no other sentence of the file changed and its count of lines unchanged.
acceptance:
  - 1. `tests/surface/layers.test.ts`, a new file, test 1. For one source text per form of R1 the reader returns the specifier of each of the nine forms, and returns none for a dynamic import of a variable, a commented import, an import written inside a string and one inside a template literal. [R1] [dod arm 2]
  - 2. In test 2 the check runs on lists of source files and of imports built in the test. An import from `src/state/` to `src/loop/`, from `src/probes/` to `src/state/` and from `src/scaffold/` to `src/probes/` each give one finding that names both files. An import from `src/state/` to `src/probes/`, from `src/probes/` to `src/scaffold/`, from `src/cli/` to `src/scaffold/`, between two files of one directory and from `src/state/` to `src/artifacts/` each give none. A file under `src/core/` gives a finding for an import of `src/artifacts/`, of `node:fs` and of `fs`, and none for `node:crypto`, `crypto` and a package. Two unranked units that import each other give a cycle finding that names both. A directory in no list gives a finding in four cases: its file imports a listed unit, a listed unit imports it, its file imports nothing, and its file imports only a package. A root file in no list gives one in the same four cases. [R2] [R3] [R4] [R5] [dod arm 2]
  - 3. In test 3, on the tree, every `.ts` file under `src/` and its imports, `src/index.ts` included, give no finding, and the same files and imports checked against the ten directories in the reverse order give an order finding. [R2] [R3] [R4] [R5] [dod arm 2]
  - 4. Doc text (reviewer-verified against the diff). The Layers sentence of `CLAUDE.md` reads as the Rules section gives it, on the lines it has today, and no other sentence of the file changes. `tests/surface/claude-md-size.test.ts` and `tests/surface/claude-md-reuse.test.ts` pass with no line changed. [R7] [dod arms 5, 6]
  - 5. Doc text (reviewer-verified against the diff). One paragraph at the end of the Module map of `docs/ARCHITECTURE.md` states R6, each of the four rules in whole. `tests/surface/module-map.test.ts` and `tests/surface/prose.test.ts` pass with no line changed. [R6] [dod arms 3, 4]
  - 6. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 150
tdd: true
sweep: "On main at e1f17a05. A probe of the tree with the reader of R1 and the order of R2 (`_local/uncle-bob-consensus/layers-check-b.ts`, not tracked) reads 83 source files, 375 relative imports inside src/ and 97 imports of Node built-ins, and reports no finding; with the order `CLAUDE.md` states before this card it reports three imports and no other (src/state/claims.ts to src/probes/git.ts, src/probes/hook-wiring.ts to src/scaffold/init.ts, src/cli/main.ts to src/scaffold/init.ts), and with the order of R2 reversed 194 order findings. It reports no finding on the five worktrees of that day either. The graph of the 15 directories and the two root files has no cycle, nothing imports src/index.ts, and src/core/ imports no other unit and only `node:crypto` of Node (src/core/contract.ts, src/core/review-policy.ts). No file under src/ holds `export * as` today. `ts.preProcessFile` of TypeScript 5.9.3 returns no specifier for `export * as ns from` and `export type * as ns from`, so the reader walks the tree. `CLAUDE.md` holds 199 lines and the Layers sentence is lines 45 to 47. The whole suite, run on main at 9278ab1d in a clone whose `CLAUDE.md` names the directories in the order of R2 on those three lines: 4,175 tests, 4,143 pass, 0 fail, 32 skipped. `tests/surface/claude-md-reuse.test.ts:12` pins the sentence that follows the list on line 47, and `tests/surface/claude-md-size.test.ts:12` the limit of 200 lines. A search of tests/ for five parts of the three lines (the opening words, `pure decision engines`, the first two directories after `core/`, the last two with `and`, and the sentence that follows the list) finds that line 12 only. `git grep -n 'inner to outer' -- . ':!specs/tasks'` finds CLAUDE.md:45 and intent/agent-quality-study.md:26, which reports the study. Six test files import `typescript` already. 37 test files read docs/ARCHITECTURE.md; this card adds a paragraph and changes no sentence of it."
forbid: [network]
non_goals:
  - "a change to a file under `src/`: the three imports that ran against the order `CLAUDE.md` stated before this card (`src/state/claims.ts` to `src/probes/git.ts`, `src/probes/hook-wiring.ts` to `src/scaffold/init.ts`, `src/cli/main.ts` to `src/scaffold/init.ts`) follow the order of R2 and stay"
  - "an import that is exempt from R2: the check holds no list of allowed imports"
  - "a place in the order for the unranked units; rules 3 and 4 hold for them"
  - "a `require` call with a computed path: it is not read. The one site, `src/hooks/lazy.ts:43`, loads five modules that the same file also names in `typeof import('...')` types, which the reader reads"
  - "a relative import that resolves outside `src/` and a package import: not an edge, apart from the Node built-ins of R3"
  - "the three tests that each pin one import rule for one file (`tests/surface/init-base-ci.test.ts:260`, `tests/surface/init-no-package.test.ts:321`, `tests/surface/review-bench.test.ts:416`): they stay"
  - "a test that compares the sentence of `CLAUDE.md` with the ranked list"
  - "a changelog fragment: no file of the package changes"
hygiene: "From `intent/agent-quality-study.md`, P2 of the two-party result of 2026-11-24, amended the same day before any run (the intent, Decisions): the card restates the order to the one the tree obeys and no import is exempt, where it first kept the sentence of `CLAUDE.md` and allowed three imports. No cost of the three imports is measured; the card makes an import against the order fail a test before it reaches main. RED first: the test file committed with a reader that returns no specifier and a check that returns no finding, so that test 1, test 2 and the reverse order of test 3 fail. The test makes no temporary directory and starts no process. Checked against the ten newest lessons of docs/LESSONS.md on 2026-11-24, T0-ADVISORY-WITHDRAW the newest: every syntax of an import the reader takes or leaves is named and has a case (T0-VERIFY-SKILL-REFS); every part of the sentence the card changes was searched in the tests and the test that pins words beside it is in the DoD (T0-RED-PATH-TEXT); the paragraph of the Module map states each rule in whole (T0-PR-SUMMARY-REUSED); each expected value of acceptance items 2 and 3 was computed with the probe the sweep field names (T0-DOD-VENV). Not verified before the card runs: the run time of the test in CI; the probe read the tree in under one second on the development machine."
doc_sync: docs/ARCHITECTURE.md
---

# T0-LAYER-ORDER-TEST

From `intent/agent-quality-study.md` (P2, as amended on 2026-11-24).

## Why
`CLAUDE.md` states the layers of `src/` inner to outer and calls `src/core/` pure. Nothing checks either statement. Three imports run against the stated order today: two because `scaffold/`, which imports no other unit under `src/`, is listed last, and one because `state/` is listed before `probes/`. Five directories and the root files have no place in the order.

## Deliverable
`CLAUDE.md` states an order the tree obeys, one test file holds that order as data and a check of four rules over the imports of the tree, and the Module map says so.

## Rules
The four rules are R2 (order), R3 (core), R4 (no cycle) and R5 (every unit placed). No import is exempt from R2.

The Layers sentence of `CLAUDE.md` is the sentence that begins `**Layers, inner to outer**`. After this card it reads:

> **Layers, inner to outer** (`src/`): `core/` (pure decision engines, no I/O), `scaffold/`, `probes/`, `state/`, `coordination/`, `delivery/`, `review/`, `loop/`, `hooks/` and `cli/`.

The sentence that follows it on its last line (`docs/ARCHITECTURE.md`, Module map, describes each.) stays as it is.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/layers.test.ts tests/surface/module-map.test.ts tests/surface/prose.test.ts tests/surface/claude-md-size.test.ts tests/surface/claude-md-reuse.test.ts
```
- Expected exit code: 0
- Assertion: the reader takes each import form, the check reports each rule on built lists and nothing on the tree, `CLAUDE.md` states the order of R2 with its count of lines unchanged, and the module map and prose checks pass.
