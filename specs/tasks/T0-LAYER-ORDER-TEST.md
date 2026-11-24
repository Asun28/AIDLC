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

## PR summary

### What
A new test, `tests/surface/layers.test.ts`, checks the imports of `src/` against four layer rules. `CLAUDE.md` now states the layer order that the tree obeys.

### Why / Intent
`CLAUDE.md` stated an order and a pure `src/core/`, and no check held either statement. Three imports ran against the stated order. The test stops a new import against the order before it reaches main.

### How / Behaviour
The test reads each module specifier from the TypeScript syntax tree. The compiler resolves each relative specifier to its file, so `../config.js` names `src/config.ts`. A specifier that resolves to no file keeps its joined path. The test reports an import against the ranked order, an impure import in `src/core/`, a cycle between top-level units and a unit in no list.

### System impact
No file under `src/` changes. The Layers sentence of `CLAUDE.md` keeps its three lines, and the file keeps 199 lines.

### Security
The change adds no input, secret or network access. The test reads source files and starts no process.

### Tests and review
Test 1 covers each import form of R1. Test 2 covers each rule on built lists. Test 2 also covers a cycle through a `.js`, `.jsx`, extensionless or directory specifier. Test 3 checks the real tree, and the reversed order. A guard sweep loosened each guard, and a test failed for each guard apart from two equivalent forms.

### Risk
Low. A future import against the order now fails the test. The author must then move the import or change the order in the card process.

### Ownership
The aidlc maintainers own the test and the order. The R3 review gate checks the change.

### Docs
The Module map of `docs/ARCHITECTURE.md` gets one paragraph. It states the ranked order, the unranked units, the four rules and the test file.

## Attempt evidence
RED commit 536cbac2 holds `tests/surface/layers.test.ts` with a reader that returns no specifier and a check that returns no finding. Test 1 failed on `import { a } from './a.ts'` (`[]` for `['./a.ts']`), test 2 on `src/state/store.ts -> ../loop/controller.ts: []` (`0 !== 1`) and test 3 on `reversed order`; the typecheck was clean.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/surface/layers.test.ts`, test 1: nine forms each give their specifier; a variable argument, a comment, a string, a template literal, a template-literal argument and a `require` call give none | pass |
| 2 | Test 2: three order findings name both files; nine imports give none; three core findings; one cycle finding names `audit` and `evals`; eight unplaced cases each give one finding; a package named as a unit gives none; a cycle through `../config.js`, `../config.jsx`, `../config` and `..` each gives one finding; `../loop/controller.js` gives an order finding that names `src/loop/controller.ts`; `../loop/nothing.js` names its joined path; `../../bench/run.js` gives none | pass |
| 3 | Test 3: the 83 files under `src/`, `src/index.ts` included, give no finding with each relative specifier resolved by the compiler; the reversed order gives an order finding | pass |
| 4 | `CLAUDE.md` lines 46 and 47 changed (2 added, 2 deleted), 199 lines; `tests/surface/claude-md-size.test.ts` and `tests/surface/claude-md-reuse.test.ts` pass unchanged (reviewer-verified text) | pass |
| 5 | One paragraph added at the end of the Module map; `tests/surface/module-map.test.ts` and `tests/surface/prose.test.ts` pass unchanged (reviewer-verified text) | pass |
| 6 | DoD arm 1, `npm run typecheck`, exit 0 | pass |

DoD: exit 0; tests 34, pass 34, fail 0 (candidate after the repair of R3 decision 1).

Guard sweep: each guard loosened alone, `node --test tests/surface/layers.test.ts` run, then restored.

| Guard | Loosened form | Test that fails |
|---|---|---|
| unit in neither list | never reported | test 2 |
| unranked list | dropped | test 3 |
| core built-in check | never reported | test 2 |
| `crypto` exemption | dropped | tests 2 and 3 |
| `node:` prefix added | specifier kept as written | test 2 |
| same unit skipped | not skipped | tests 2 and 3 |
| core imports another unit | never reported | test 2 |
| order comparison `<` | `>` | tests 2 and 3 |
| order comparison `<` | `<=` | equivalent: the same-unit skip comes first, so two units never share an index |
| both units ranked | dropped | tests 2 and 3 |
| cycle reported | never reported | test 2 |
| peel of acyclic units | every unit peeled | test 2 |
| target under `src/` | any target | test 2 |
| relative specifier only | any specifier joined as a path | test 2 |
| Node built-in | never a built-in | test 2 |
| call is `import(...)` | any call | test 1 |
| dynamic argument `isStringLiteral` | `isStringLiteralLike` | test 1 |
| dynamic argument a literal | any argument | test 1 |
| `import('...')` type | not read | test 1 |
| declaration specifier `isStringLiteral` | dropped | equivalent: the parser puts only a string literal in that place |
| compiler resolution of a relative specifier | not called | test 2 |
| CommonJS resolution mode | ECMAScript mode | test 2 |
| fallback to the joined path | empty path | test 2 |
| posix form of the resolved path | native separators | tests 2 and 3 |

## Repair of R3 decision 1, F1
F1: a relative specifier was joined as text, so `../config.js` gave a vertex apart from `src/config.ts` and hid a cycle. `edgeOf` now takes the file that `ts.resolveModuleName` gives, with the options of `tsconfig.json`, in CommonJS mode. The coordinator proposed ECMAScript mode first, then CommonJS mode. A comparison over 385 specifiers (every relative specifier under `src/` and the probe spellings) found no specifier that ECMAScript mode resolves and CommonJS mode does not, and no specifier that they resolve to different files. So the first mode was removed. RED commit f4c4fc1e holds the new assertions alone; test 2 failed there on `../config.js: []` (`0 !== 1`). No `aidlc review repro` record exists: the check and its tests are one file, so the reviewed candidate with this file is the repaired candidate, and both runs would exit 0.

| Input form | Test that covers it |
|---|---|
| `../config.js`, root-file cycle | test 2, the cycle loop, first case |
| `../config.jsx` | test 2, the cycle loop, second case |
| `../config`, extensionless | test 2, the cycle loop, third case |
| `..`, directory, to `src/index.ts` | test 2, the cycle loop, fourth case |
| `.js` to a ranked file | test 2, `../loop/controller.js` names `src/loop/controller.ts` |
| a specifier that names no file | test 2, `../loop/nothing.js` keeps its joined path |
| a resolved file outside `src/` | test 2, `../../bench/run.js` gives none |
| `.ts` and every specifier of the tree | test 3 |

The compiler rejects these forms, so no case exists for them: `.mjs` and `.cjs` (TS2307), another letter case (TS1149). It also rejects a plain extensionless specifier (TS2835) and a directory specifier (TS2307, TS2834) in an ECMAScript import. The check still resolves those two in CommonJS mode, which is stricter, and test 2 covers them.

