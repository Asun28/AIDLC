---
id: T1-TEST-AUDIT-LIST
title: docs/reliability/test-audit.md lists the tests that no longer match the code, each with checkable evidence and a proposed action, for the owner to approve; no test file changes
status: todo
branch: T1-TEST-AUDIT-LIST
worktree: D:\wt\AIDLC\T1-TEST-AUDIT-LIST
plan_ref: plans/test-time.md#order-of-work
allow_paths:
  - docs/reliability/test-audit.md
  - tests/surface/test-audit.test.ts
  - changelog.d/T1-TEST-AUDIT-LIST.md
  - specs/tasks/T1-TEST-AUDIT-LIST.md
dod_command: npm run typecheck && node --test tests/surface/test-audit.test.ts
dod_exit: 0
requirements:
  - R1. `docs/reliability/test-audit.md` shall hold one Markdown table with the columns `file`, `test`, `class`, `evidence`, `covered by`, `action`. `test` is the exact name of an `it`/`test` call in `file` (the full name a reader can pass to `--test-name-pattern`); `class` is one of `removed-behaviour`, `duplicate`, `removed-path`, `superseded-card`; `action` is `update` or `remove`.
  - R2. Each row's evidence shall be checkable from the repository: for `removed-behaviour` and `removed-path`, the commit or card that removed the behaviour or path and the line of the test that still pins it; for `duplicate`, the other test asserting the same thing; for `superseded-card`, the card id with `superseded_by` and its successor's covering test. `covered by` names the covering test or `none`. A row whose behaviour is covered by no other test shall propose `update`, never `remove`.
  - R3. The search shall cover every file under `tests/`, and the document shall state, above the table, how it searched (for example: card ids in test names against cards with `superseded_by`; config keys, flags, commands and exported names a test uses against the current sources; tests with the same assertions) and the commit it searched at. An empty table is a valid result when the search finds nothing.
  - R4. `tests/surface/test-audit.test.ts` shall check that the document parses into rows, that each row's `file` exists, that its `test` name occurs as an `it(`/`test(` name in that file, that `class` and `action` take the values of R1, and that a row with `covered by` = `none` has `action` = `update`.
acceptance:
  - 1. `tests/surface/test-audit.test.ts` (new), "T1-TEST-AUDIT-LIST acceptance 1: every row names an existing test with a valid class and action". Fails on main (the document does not exist). [R1] [R4] [dod arm 1]
  - 2. Same file, "T1-TEST-AUDIT-LIST acceptance 2: no row proposes remove without a covering test". [R2] [R4] [dod arm 1]
  - 3. The search method and commit are stated, and a sample of rows checked by the reviewer holds the evidence it claims (reviewer-verified). [R2] [R3]
depends_on: []
budget: 120
tdd: true
forbid:
  - changing, skipping or deleting any existing test file
  - a change under src/
non_goals: [acting on any row (a later card, after the owner approves the list)]
hygiene: "Changelog entry in changelog.d/T1-TEST-AUDIT-LIST.md. Owner decision 2026-11-19: the list is approved by the owner before any test is changed or removed."
---

# T1-TEST-AUDIT-LIST

## Deliverable
The owner can read one table of tests that no longer match the code, check each row's evidence, and approve the actions.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/test-audit.test.ts
```
- Expected exit code: 0
- Assertion: the two acceptance tests pass; they fail on main because the document does not exist.

## Attempt evidence
RED: `3df0bd16:tests/surface/test-audit.test.ts` acceptance 1 and 2 fail with ENOENT on `docs/reliability/test-audit.md` (pass 0, fail 2).

Guard sweep of `tests/surface/test-audit.test.ts` (each guard loosened in turn, the file run, then restored):

| Guard | Loosened form | Result |
| --- | --- | --- |
| header row equals the six columns in order | any table line | acceptance 1 fails |
| rows end at the first non-table line | skip non-table lines | acceptance 1 fails |
| split only at an unescaped pipe | split at every pipe | acceptance 1 fails |
| `it(`/`test(` not preceded by a word character, `$` or `.` | no lookbehind | acceptance 1 fails |
| the name is the whole literal (closing quote) | no closing quote | acceptance 1 fails |
| quotes inside the name are escaped | no escaping | acceptance 1 fails |
| a missing file is a problem | no problem | acceptance 1 fails |
| class in the four values | any class | acceptance 1 fails |
| action in the two values | any action | acceptance 1 fails |
| empty evidence is a problem | not checked | acceptance 1 fails |
| empty covered by is a problem | not checked | acceptance 1 fails |
| remove without cover: `covered by` is `none` | any row with remove | acceptance 2 fails |
| remove without cover: action is not update | any row with none | acceptance 2 fails |

Repair after R3 decision 1 (candidate 20f59f6c, findings F1 to F4). F1: the two uncovered rows carry exactly `none`, and a `covered by` that starts with the word `none` in any letter case but is not exactly `none` is refused (before the repair the test failed on those two rows). F2: the plan.test.ts row is `update` with `none`, the skeleton assertions named in its evidence. F3: test names are read from `it`/`test` call expressions of the TypeScript AST, so text in comments, strings and fixture objects is not a name. F4: the header must be followed by a six-cell separator line. Sweep of the guards after the repair (each loosened in turn, the file run, then restored; all 22 fail a test):

| Guard | Loosened form | Result |
| --- | --- | --- |
| header row equals the six columns in order | any table line | acceptance 1 fails |
| separator line required after the header | not checked | acceptance 1 fails |
| separator line starts with a pipe | any line | acceptance 1 fails |
| separator has six cells | any count | acceptance 1 fails |
| separator cells are dashes | anything | acceptance 1 fails |
| separator cells may carry alignment colons | dashes only | acceptance 1 fails |
| rows end at the first non-table line | skip non-table lines | acceptance 1 fails |
| split only at an unescaped pipe | split at every pipe | acceptance 1 fails |
| callee is an identifier | last name of any callee (`t.test`) | acceptance 1 fails |
| callee is `it` or `test` | any identifier | acceptance 1 fails |
| first argument is a string literal | source text includes the name | acceptance 1 fails |
| name equals the literal value | literal starts with the name | acceptance 1 fails |
| a missing file is a problem | no problem | acceptance 1 fails |
| class in the four values | any class | acceptance 1 fails |
| action in the two values | any action | acceptance 1 fails |
| empty evidence is a problem | not checked | acceptance 1 fails |
| empty covered by is a problem | not checked | acceptance 1 fails |
| covered by starting with none must be exactly none | not checked | acceptance 1 fails |
| that check stops at a word boundary | any prefix `none` | acceptance 1 fails |
| that check ignores letter case | case-sensitive | acceptance 1 fails |
| remove without cover: `covered by` is `none` | any row with remove | acceptance 2 fails |
| remove without cover: action is not update | any row with none | acceptance 2 fails |
