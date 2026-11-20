---
id: T1-TEST-AUDIT-LIST-2
title: (replaces T1-TEST-AUDIT-LIST and carries its candidate) The test audit rows live in docs/reliability/test-audit.json, which the test validates, and the table of docs/reliability/test-audit.md is checked to be exactly the rendering of that file
status: todo
branch: T1-TEST-AUDIT-LIST-2
worktree: D:\wt\AIDLC\T1-TEST-AUDIT-LIST-2
plan_ref: plans/test-time.md#order-of-work
allow_paths:
  - docs/reliability/test-audit.json
  - docs/reliability/test-audit.md
  - tests/surface/test-audit.test.ts
  - changelog.d/T1-TEST-AUDIT-LIST-2.md
  - changelog.d/T1-TEST-AUDIT-LIST.md
  - specs/tasks/T1-TEST-AUDIT-LIST-2.md
  - specs/tasks/T1-TEST-AUDIT-LIST.md
dod_command: npm run typecheck && node --test tests/surface/test-audit.test.ts
dod_exit: 0
requirements:
  - R1. `docs/reliability/test-audit.json` shall hold `{ "commit": "<sha searched>", "rows": [...] }`, each row an object with exactly the keys `file`, `test`, `class`, `evidence`, `coveredBy`, `action`, all non-empty strings; `class` one of `removed-behaviour`, `duplicate`, `removed-path`, `superseded-card`; `action` one of `update`, `remove`; `coveredBy` the exact name of a covering test or the exact string `none`. The rows shall be the four rows of the carried candidate 36cd563c, unchanged in substance.
  - R2. `tests/surface/test-audit.test.ts` shall parse the JSON with a strict schema (unknown or missing keys refused), and check that each row's `file` exists under `tests/`, that `test` is the name of an `it`/`test` call in that file read from the TypeScript syntax tree (the check of the carried candidate), that a row with `coveredBy` = `none` has `action` = `update`, and that a `coveredBy` other than `none` names an `it`/`test` call in some file under `tests/`.
  - R3. The test shall render the rows into a Markdown table (header `| file | test | class | evidence | covered by | action |`, separator, one line per row in JSON order, `|` inside a cell escaped as `\|`) and assert that `docs/reliability/test-audit.md` contains that rendering exactly once, between the lines `<!-- audit-table:start -->` and `<!-- audit-table:end -->`, each occurring exactly once; it shall not otherwise parse Markdown.
  - R4. The prose of `docs/reliability/test-audit.md` (search method, commit, owner decision) shall be kept, and shall say that the JSON file is the source and the table its rendering.
acceptance:
  - 1. `tests/surface/test-audit.test.ts`, "T1-TEST-AUDIT-LIST-2 acceptance 1: the JSON rows are valid and each names an existing test with a valid class and action" over the repository file, plus refusals for an unknown key, a missing key, a class or action outside the sets, a test name that occurs only in a string or comment, and `coveredBy` naming no test. Fails on the carried candidate (the JSON file does not exist). [R1] [R2] [dod arm 1]
  - 2. Same file, "T1-TEST-AUDIT-LIST-2 acceptance 2: no row proposes remove without a covering test". [R2] [dod arm 1]
  - 3. Same file, "T1-TEST-AUDIT-LIST-2 acceptance 3: the Markdown table is exactly the rendering of the JSON rows", plus refusals for a changed cell, an added row, a missing or doubled marker, and the rendering occurring twice. [R3] [dod arm 1]
  - 4. The four rows match the carried document's rows in file, test, class, coveredBy and action (reviewer-verified against 36cd563c). [R1] [R4]
depends_on: []
budget: 90
tdd: true
sweep: "Carried candidate 36cd563c on branch T1-TEST-AUDIT-LIST (commits 3df0bd16..36cd563c): docs/reliability/test-audit.md with four removed-path rows (pre-review.test.ts x2, reviewer-env.test.ts, plan.test.ts), all action update, two with covered by none; tests/surface/test-audit.test.ts parses the Markdown table and reads it/test names from the TypeScript AST (keep that name check). T1-TEST-AUDIT-LIST stopped for review after four R3 blocks of one class, markdown-row-bypass (verdicts .review/T1-TEST-AUDIT-LIST.r3.1..r3.4 in its worktree): fenced code, indented code, <pre>, blockquotes and second tables hid rows from the Markdown parse. R3 of this card removes the Markdown parse: the JSON is the only input the checks read, and the Markdown table must equal its rendering."
forbid:
  - changing, skipping or deleting any existing test file other than tests/surface/test-audit.test.ts
  - a change under src/
  - parsing Markdown structure (tables, code blocks, quotes) in the test beyond locating the two marker lines
non_goals: [acting on any row (a later card, after the owner approves the list), new audit rows]
hygiene: "Replaces T1-TEST-AUDIT-LIST, stopped for review after R3 decision 4. Owner decision 2026-11-20 in the session: a successor with a JSON source. Start the branch from T1-TEST-AUDIT-LIST (carries 36cd563c), merge main, set specs/tasks/T1-TEST-AUDIT-LIST.md to `superseded_by: T1-TEST-AUDIT-LIST-2` if main does not already have it, and rename changelog.d/T1-TEST-AUDIT-LIST.md into changelog.d/T1-TEST-AUDIT-LIST-2.md updated for the change."
---

# T1-TEST-AUDIT-LIST-2

## Deliverable
The owner reads the same four-row audit table, and the checks read only the JSON file it is rendered from, so no Markdown form can hide a row from them.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/test-audit.test.ts
```
- Expected exit code: 0
- Assertion: the three acceptance tests pass; they fail on the carried candidate because the JSON file does not exist.

## Attempt evidence
RED: `2ea3a39b:tests/surface/test-audit.test.ts` acceptance 1, 2 and 3 fail with ENOENT on `docs/reliability/test-audit.json` (pass 0, fail 3).

Rows against 36cd563c (acceptance 4): file, test, class and action are the same in all four rows, and coveredBy in rows 1, 2 and 4 (`none`). Row 3's covered-by cell was prose ("the `runReviewPanel` arm of this same test ..."); R1 needs the exact name of a covering test, so `coveredBy` is now the name of that same test, which holds the `runReviewPanel` arm, and the prose moved to the end of its evidence. Each evidence text is the old cell unchanged, with that one sentence added to row 3. The Markdown table parser, its helpers and its regression cases are removed; the only Markdown the test reads are the two marker lines.

Guard sweep of `tests/surface/test-audit.test.ts` (each guard loosened in turn, the file run, then restored; all 20 fail a test; the first run left five alive, and the subtest, non-test call, template name, outside-tests file and inline-marker cases were added for them):

| Guard | Loosened form | Result |
| --- | --- | --- |
| strings are non-empty | any string | acceptance 1 fails |
| row object is strict | unknown keys kept | acceptance 1 fails |
| top-level object is strict | unknown keys kept | acceptance 1 fails |
| class in the four values | any string | acceptance 1 fails |
| action in the two values | any string | acceptance 1 fails |
| commit is a sha | any string | acceptance 1 fails |
| callee is an identifier | last name of any callee (`t.test`) | acceptance 1 fails |
| callee is `it` or `test` | any identifier | acceptance 1 fails |
| first argument is a string literal | the text of any first argument | acceptance 1 fails |
| file is under `tests/` | any path | acceptance 1 fails |
| a missing file is a problem | no problem | acceptance 1 fails |
| the test name is an it/test call of the file | not checked | acceptance 1 fails |
| `coveredBy` none needs update | not checked | acceptance 2 fails |
| `coveredBy` other than none names a test under tests/ | not checked | acceptance 1 fails |
| `coveredBy` none is exempt from that check | checked too | acceptance 1 fails |
| a pipe in a cell is rendered as `\|` | not escaped | acceptance 3 fails |
| each marker line occurs exactly once | at least once | acceptance 3 fails |
| the lines between the markers are the rendering | not checked | acceptance 3 fails |
| the rendering occurs exactly once | at least once | acceptance 3 fails |
| a marker is a whole line | any line holding it | acceptance 3 fails |

Coordinator correction before R3: row 3 named its own test as its cover. Its `coveredBy` is now `none` (it proposes update), the note on the `runReviewPanel` arm stays in its evidence, and the table is rendered again. New guard, swept with the other 20 (all 21 fail a test when loosened):

| Guard | Loosened form | Result |
| --- | --- | --- |
| `coveredBy` is not the row's own test name | not checked | acceptance 1 fails |

Repair after R3 decision 1 (candidate 83e5c5a3). F1: the self-cover request was wrong; `docs/reliability/test-audit.json` and `docs/reliability/test-audit.md` are byte-identical to 662a055c again (row 3 `coveredBy` is the exact name of its own test, whose `runReviewPanel` arm is the carried cover, explained in its evidence), and the self-cover check, its case and its fixture change are removed. F2: every file the test reads under `tests/`, for a row and for the coveredBy search, goes through `testsPath(base, file)`: refused when the path holds a backslash, is absolute, is not already normalised (decision: `tests/../tests/x.test.ts` and `tests/./x` are refused, not normalised), is not `.ts` or does not exist; otherwise the file is resolved with links followed and must lie inside the resolved tests directory, `..` read as a whole first segment. This containment replaces the `startsWith('tests/')` check, which it implies.

Input forms and their assertions (acceptance 1):

| Input | Result | Assertion message |
| --- | --- | --- |
| `tests/surface/test-audit.test.ts` | read | a file under tests/ |
| `tests/../specs/tasks/T0-AUDIT-BINDING.md`, `tests\..\specs\tasks\T0-AUDIT-BINDING.md` | refused | refused: (each) |
| absolute path with backslashes, `/tests/surface/test-audit.test.ts` | refused | refused: (each) |
| `tests/../tests/surface/test-audit.test.ts`, `tests/./surface/test-audit.test.ts` | refused | refused: (each) |
| `tests/surface/../../src/config.ts`, `src/config.ts`, `package.json` | refused | refused: (each) |
| `tests\surface\test-audit.test.ts` (inside on win32) | refused | refused: (each) |
| `tests/x.md` (non-.ts), `tests/missing.ts` | refused | a file that is not .ts; a file that does not exist |
| `tests/..x.ts` | read | a name that starts with two dots is inside |
| link in tests/ to a sibling or to this file (another drive) | refused | a link out of tests/: near.ts, far.ts (skipped where links are refused) |
| coveredBy search over a tests/ holding a link out | name not read | the coveredBy search reads no linked file outside tests/ (skipped where links are refused) |

Sweep (28 guards, each loosened in turn, the file run, restored): 26 fail a test on this host. Two are not detectable here because this host refuses symbolic links (EPERM), which skips the link cases: "resolved path is not absolute" (reachable only through a link to another drive on win32; the far.ts case covers it where links are allowed) and "the coveredBy search reads through testsPath" (the near.ts search case covers it where links are allowed, which includes the Linux CI runners). New guards:

| Guard | Loosened form | Result |
| --- | --- | --- |
| no backslash | not checked | acceptance 1 fails |
| not absolute | not checked | acceptance 1 fails |
| already normalised | not checked | acceptance 1 fails |
| a .ts file | any file | acceptance 1 fails |
| exists | not checked | acceptance 1 fails |
| resolved inside tests: no `..` first segment | not checked | acceptance 1 fails |
| `..` is a whole segment | prefix `..` | acceptance 1 fails |
| resolved path not absolute | not checked | not detectable on this host (links refused) |
| coveredBy search reads through testsPath | reads every file found | not detectable on this host (links refused) |
| a missing file is a problem | no problem | acceptance 1 fails |
