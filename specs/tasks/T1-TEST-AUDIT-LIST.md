---
id: T1-TEST-AUDIT-LIST
title: docs/reliability/test-audit.md lists the tests that no longer match the code, each with checkable evidence and a proposed action, for the owner to approve; no test file changes
status: todo
superseded_by: T1-TEST-AUDIT-LIST-2
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

Repair after R3 decision 2 (candidate 4109a8a8, markdown-row-bypass). Choice: as in Markdown, every line after the separator up to the first blank (or whitespace-only) line is a row; this checker accepts only rows that start with a pipe and hold six cells, and any other line there refuses the whole table, so acceptance 1 and 2 fail on it (acceptance 2 now also asserts the table parses). Parsing rows with optional outer pipes was the alternative; refusing keeps one rule for the header, the separator and the rows (all start with a pipe). RED: the new cases run against the `auditRows` of 4109a8a8 fail acceptance 1 with "a row without an initial pipe right after the separator" (pass 1, fail 1).

Input forms the parser and the name check handle after both repairs, each with its assertion in `tests/surface/test-audit.test.ts` (acceptance 1 unless noted):

| Input form | Result | Assertion message |
| --- | --- | --- |
| header of other columns, valid separator | no table | another six-column table |
| header with no separator line | no table | a header without its separator |
| separator of five cells | no table | a separator of five cells |
| separator cell that is not dashes | no table | a separator cell that is not dashes |
| separator without leading pipe | no table | a separator without the leading pipe the rows need |
| separator with alignment colons | table | alignment colons |
| row without an initial pipe right after the separator | no table | a row without an initial pipe right after the separator |
| the same row after a valid piped row | no table | a row without an initial pipe after a piped row |
| row of five cells, row of seven cells | no table | a row of five cells; a row of seven cells |
| whitespace-only line, then prose | table ends at it | a whitespace-only line ends the table |
| escaped pipe in a cell | one cell holding a pipe | the `['a \| b']` deepEqual |
| test name only in a comment, a string, fixture text, or a `t.test` subtest | not a test name | a call inside a comment; a call inside a string; fixture text of this file is not a test name; a t.test subtest is not an it or test call |
| `it` with a double-quoted name holding escaped quotes | test name | the first `rowProblems` deepEqual |
| covered by `none: ...` or `None` | problem | a covered by that starts with none; a covered by of another letter case |
| covered by `nonexistent-path test` | no problem | a word that only starts with the letters none |
| document with no parsable table | acceptance 1 and 2 fail | the `assert.ok(rows, ...)` of both tests |

Not handled, as before the repairs: a name built by concatenation or a template with substitutions, and `test.only`/`test.skip` calls; such a row is refused as naming no test.

Sweep of the guards this repair adds (each loosened, the file run, restored; the other 21 guards of the decision 1 sweep were run again and all still fail a test; its guard "rows end at the first non-table line" no longer exists):

| Guard | Loosened form | Result |
| --- | --- | --- |
| a blank line ends the table | skip blank lines | acceptance 1 fails |
| a row without an initial pipe refuses the table | not checked | acceptance 1 fails |
| a row of other than six cells refuses the table | not checked | acceptance 1 fails |
| (whole change) | the 4109a8a8 loop: a non-pipe line ends the table | acceptance 1 fails |

Repair after R3 decision 3 (candidate 2108f82f, markdown-row-bypass re:F5). One document rule in place of single cases, stated above `auditRows` and in one line above the table in `docs/reliability/test-audit.md`: (a) no fenced code block (a line starting with ``` or ~~~ after any indentation) and no HTML comment (a line holding `<!--`); (b) exactly one line whose cells equal the header, and it starts with a pipe; (c) a six-cell separator right after it, the table running to the first blank line, and no other line in the document that starts with a pipe after any indentation or has the shape of a delimiter row (a line holding a pipe whose cells are all dashes with optional colons); (d) every row starts with a pipe and holds six cells. Indented code blocks: a pipe line indented four or more spaces is pipe-leading (`trimStart`), so (c) refuses it. HTML comments: refused by (a), so a table inside one cannot be the checked table while the reader sees none. A table without outer pipes needs a delimiter row, which (c) refuses outside the checked table. RED: the new cases run against the `auditRows` of 2108f82f fail acceptance 1 with "R3 decision 3: a fenced header and separator before the real table" (pass 1, fail 1). The current document holds no fence, comment or other pipe line and passes unchanged apart from the rule line.

What this repair newly refuses, by design: any second table, any pipe-leading line outside the table, a line starting with ``` or ~~~ even when it is inline code at the start of a prose line, and `<!--` anywhere, inline code included. The decision 2 case "escaped pipe in a cell" ended with a pipe line after a blank line, which rule (c) now refuses; its trailing line is prose instead.

Input forms added by this repair, each with its assertion in acceptance 1 (the forms of the decision 2 list still hold):

| Input form | Result | Assertion message |
| --- | --- | --- |
| R3's document: fenced header and separator, blank, closing fence, real table with the bad row | refused | R3 decision 3: a fenced header and separator before the real table |
| fenced example alone (backtick, tilde, indented fence) | refused | a fenced example alone; a tilde fence; an indented fence |
| table inside an HTML comment | refused | a table inside an HTML comment |
| second audit table | refused | a second audit table |
| second table of other columns, with or without outer pipes | refused | a second table of other columns; a second table without outer pipes |
| pipe line after or before the table | refused | a pipe line after the table; a pipe line before the table |
| pipe line indented four spaces | refused | an indented pipe line |
| second header line without pipes | refused | a second header line without pipes |
| header line without outer pipes | refused | a header line without its outer pipes |
| prose holding a pipe and dashes | accepted | prose with a pipe inside a line |
| thematic break `---` | accepted | a thematic break is not a separator |

Sweep after this repair: 36 guards, each loosened in turn, the file run, restored; all 36 fail a test. The first run left eight alive, and each got a case: the four fence and comment guards (the fixtures had no blank line before the closing fence, so the row rule refused them first), "exactly one header" (the pipeless second header now stands after the table), "header starts with a pipe" (new case), and "a delimiter-like line holds a pipe" (new thematic break case). New guards and loosened forms:

| Guard | Loosened form | Result |
| --- | --- | --- |
| a fence line refuses the document | not checked | acceptance 1 fails |
| a tilde fence counts | backtick only | acceptance 1 fails |
| a fence after indentation counts | column 0 only | acceptance 1 fails |
| `<!--` refuses the document | not checked | acceptance 1 fails |
| exactly one header line | first one taken | acceptance 1 fails |
| the header starts with a pipe | any line | acceptance 1 fails |
| separator starts with a pipe after indentation | not checked | acceptance 1 fails |
| a delimiter-like line holds a pipe | not checked | acceptance 1 fails |
| the table ends at the first blank line | runs to the end | acceptance 1 fails |
| pipe-leading after indentation | column 0 only | acceptance 1 fails |
| outside the table: a pipe-leading line refuses | not checked | acceptance 1 fails |
| outside the table: a delimiter-like line refuses | not checked | acceptance 1 fails |
| outside covers lines before the table | after only | acceptance 1 fails |
| outside covers lines after the table | before only | acceptance 1 fails |
