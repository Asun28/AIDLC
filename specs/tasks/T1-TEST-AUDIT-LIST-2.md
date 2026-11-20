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
