---
id: T0-LAYER-ORDER-TEST
title: "A test reads every import under src/ from the syntax tree and fails on an import against the declared layer order, on a dependency of src/core/ on another directory or on a Node built-in other than crypto, on a cycle between top-level units, and on a unit that is in no list"
status: todo
branch: T0-LAYER-ORDER-TEST
worktree: D:\wt\AIDLC\T0-LAYER-ORDER-TEST
allow_paths:
  - tests/surface/layers.test.ts
  - docs/ARCHITECTURE.md
  - specs/tasks/T0-LAYER-ORDER-TEST.md
dod_command: npm run typecheck && node --test tests/surface/layers.test.ts tests/surface/module-map.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The reader of `tests/surface/layers.test.ts` shall take the module specifiers of a TypeScript source text from its syntax tree (`ts.createSourceFile`), namely a static import, an `import type`, a side-effect import, a named re-export, `export * from`, `export * as ns from`, `export type * as ns from`, a dynamic import whose argument is a string literal and an `import('...')` type, and none from a comment, a string, a template literal or a dynamic import whose argument is not a literal.
  - R2. The check shall report an import between two of the ten ranked directories (`core`, `state`, `coordination`, `probes`, `delivery`, `review`, `loop`, `hooks`, `cli`, `scaffold`, the order of `CLAUDE.md` lines 45 to 47) whose importing directory comes before the imported one, unless the importing file and the imported file are one of the three allowed pairs of the Rules section.
  - R3. The check shall report a file under `src/core/` that imports a file of another top-level unit of `src/`, or a Node built-in other than `crypto`, named with or without the `node:` prefix.
  - R4. The check shall report a cycle in the graph of the top-level units of `src/`, where a unit is a directory, or a root file by its name.
  - R5. The check shall report a top-level unit that is neither ranked nor one of the unranked units `artifacts`, `audit`, `evals`, `maintain`, `providers`, `config.ts` and `index.ts`, taking the units from the list of source files, so that a unit whose files import nothing and are imported by nothing is reported too.
  - R6. The Module map of `docs/ARCHITECTURE.md` shall state the ranked order as the order of the `CLAUDE.md` sentence, the three allowed pairs as the imports that ran against it on 2026-11-24, the unranked units, the four rules and the name of the test file.
acceptance:
  - 1. `tests/surface/layers.test.ts`, a new file, test 1. For one source text per form of R1 the reader returns the specifier of each of the nine forms, and returns none for a dynamic import of a variable, a commented import, an import written inside a string and one inside a template literal. [R1] [dod arm 2]
  - 2. In test 2 the check runs on lists of source files and of imports built in the test. An import from `src/state/` to `src/loop/` gives one finding that names both files. An allowed pair gives none, and another file of the same two directories gives one. A file under `src/core/` gives a finding for an import of `src/artifacts/`, of `node:fs` and of `fs`, and none for `node:crypto`, `crypto` and a package. Two unranked units that import each other give a cycle finding that names both. A directory in no list gives a finding in four cases: its file imports a listed unit, a listed unit imports it, its file imports nothing, and its file imports only a package. A root file in no list gives one in the same four cases. [R2] [R3] [R4] [R5] [dod arm 2]
  - 3. In test 3, on the tree, every `.ts` file under `src/` and its imports, `src/index.ts` included, give no finding. RED on main: the same test with an empty list of allowed pairs fails, and its message names the three pairs of the Rules section and no other import. [R2] [R3] [R4] [R5] [dod arm 2]
  - 4. In test 4, with the three allowed imports removed from the imports of the tree and the list of files kept, the check gives no finding: a pair is allowed, not required. [R2] [dod arm 2]
  - 5. Doc text (reviewer-verified against the diff). One paragraph at the end of the Module map of `docs/ARCHITECTURE.md` states R6. `tests/surface/module-map.test.ts` and `tests/surface/prose.test.ts` pass with no line changed. [R6] [dod arms 3, 4]
  - 6. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 150
tdd: true
sweep: "On main at f48f727a. A probe of the tree with the reader of R1 (`_local/uncle-bob-consensus/layers-check.ts`, not tracked) reads 372 relative imports inside src/ and 95 imports of `node:` modules in 82 files, and reports no finding with the three pairs and exactly the three pairs without them. The graph of the 15 directories and the two root files has no cycle, nothing imports src/index.ts, and src/core/ imports no other unit and only `node:crypto` of Node (src/core/contract.ts, src/core/review-policy.ts). No file under src/ holds `export * as` today. `ts.preProcessFile` of TypeScript 5.9.3 returns no specifier for `export * as ns from` and `export type * as ns from`, so the reader walks the tree. `git grep -n 'inner to outer' -- . ':!specs/tasks'` finds CLAUDE.md:45 only. Four test files import `typescript` already (tests/core/parse-guard.test.ts, tests/scenarios/op-clock.test.ts, tests/surface/cli-cwd-paths.test.ts, tests/surface/providers.test.ts). 37 test files read docs/ARCHITECTURE.md; this card adds a paragraph and changes no sentence of it."
forbid: [network]
non_goals:
  - "a change to `CLAUDE.md`: it holds 198 of its 200 lines, and restating its order is the owner's (`scaffold` imports nothing and is listed last; `state` is listed before `probes`)"
  - "a place in the order for the unranked units; rules 3 and 4 hold for them"
  - "a `require` call with a computed path: it is not read. The one site, `src/hooks/lazy.ts:43`, loads five modules that the same file also names in `typeof import('...')` types, which the reader reads"
  - "a relative import that resolves outside `src/` and a package import: not an edge, apart from the Node built-ins of R3"
  - "the three tests that each pin one import rule for one file (`tests/surface/init-base-ci.test.ts:260`, `tests/surface/init-no-package.test.ts:321`, `tests/surface/review-bench.test.ts:416`): they stay"
  - "a test that compares the sentence of `CLAUDE.md` with the ranked list"
  - "a changelog fragment: no file of the package changes"
hygiene: "From `intent/agent-quality-study.md`, P2 of the two-party result of 2026-11-24. No cost of the three imports is measured; the card makes a fourth import against the stated order fail a test before it reaches main. RED first: the test file committed with an empty list of allowed pairs, then the three pairs. The test makes no temporary directory. Checked against the ten newest lessons of docs/LESSONS.md on 2026-11-24: every syntax of an import the reader takes or leaves is named and has a case (T0-VERIFY-SKILL-REFS). Not verified before the card runs: the run time of the test in CI; the probe read the tree in under one second on the development machine."
doc_sync: docs/ARCHITECTURE.md
---

# T0-LAYER-ORDER-TEST

From `intent/agent-quality-study.md` (P2).

## Why
`CLAUDE.md` states the layers of `src/` inner to outer and calls `src/core/` pure. Nothing checks either statement. Three imports run against the order today, and five directories and the root files have no place in it.

## Deliverable
One test file holds the order as data and a check of four rules over the imports of the tree, and the Module map says so.

## Rules
The four rules are R2 (order), R3 (core), R4 (no cycle) and R5 (every unit placed). The allowed pairs of R2, importing file then imported file:
- `src/state/claims.ts`, `src/probes/git.ts`
- `src/probes/hook-wiring.ts`, `src/scaffold/init.ts`
- `src/cli/main.ts`, `src/scaffold/init.ts`

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/layers.test.ts tests/surface/module-map.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the reader takes each import form, the check reports each rule on built lists and nothing on the tree, and the module map and prose checks pass.
