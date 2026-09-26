---
id: T0-UNATTENDED-TEST-SCAN
title: The unattended-runs doc test proves the /goal hands-off clause against the docs, for every /goal prompt they show, and scans single-quoted --dod-receipt examples as well as double-quoted ones
status: todo
branch: T0-UNATTENDED-TEST-SCAN
worktree: D:\wt\AIDLC\T0-UNATTENDED-TEST-SCAN
allow_paths:
  - tests/surface/unattended.test.ts
  - CHANGELOG.md
  - specs/tasks/T0-UNATTENDED-TEST-SCAN.md
dod_command: npm run typecheck && node --test tests/surface/unattended.test.ts
dod_exit: 0
requirements:
  - R1. The acceptance 1 test of T0-UNATTENDED-RUNS shall prove the hands-off clause against the docs, not against its own constants: `docs/OPERATIONS.md` holds the clause, and every `/goal ` prompt line that `docs/OPERATIONS.md` or `README.md` shows carries it, with at least one such line in `docs/OPERATIONS.md`; the constant-only assertion `GOAL_PROMPT.includes(HANDS_OFF)` is removed.
  - R2. The acceptance 4 test shall scan `--dod-receipt` examples written in single quotes as well as in double quotes, so every example in either style must name an exit code and a pass count.
  - R3. `CHANGELOG.md` Unreleased shall carry the change under this card id.
acceptance:
  - 1. `tests/surface/unattended.test.ts` asserts the clause in `docs/OPERATIONS.md` and on every `/goal ` prompt line of `docs/OPERATIONS.md` and `README.md`; the mutant that adds a second `/goal` prompt without the clause to `docs/OPERATIONS.md` passes the old test and fails the new one. [R1] [dod arm 1]
  - 2. The same file's receipt scanner reads both quote styles; the mutant that adds `--dod-receipt 'exit 0'` to `README.md` passes the old test and fails the new one, and a single-quoted example naming an exit code and a pass count passes. [R2] [dod arm 1]
  - 3. A test reads the exact CHANGELOG Unreleased sentence this card adds and fails with it removed. [R3] [dod arm 1]
depends_on: []
budget: 60
tdd: false
forbid: [weakening or removing an assertion other than the constant-only one R1 replaces, editing docs/OPERATIONS.md or README.md in the candidate]
non_goals: [backtick-quoted or unquoted --dod-receipt examples, the /loop prompt checks, any source file]
hygiene: "Filed from issue #62 (R2 cycle 1 and R3 decision 2 advisories on T0-UNATTENDED-RUNS, PR #61). Test-only hardening: the docs already satisfy both rules, so no test goes red on the current tree. The proof in place of a RED receipt is the two mutants of the acceptance, each run against the test at the base and at the candidate and retained as evidence (the old test passes both, the new one fails both)."
doc_sync: CHANGELOG.md
---

# T0-UNATTENDED-TEST-SCAN

## Deliverable
The doc test of the unattended-runs card stops asserting a fact about its own constants. The `/goal` hands-off clause is proven against the docs, and against every `/goal` prompt they show, so a second prompt without the clause fails the suite. The `--dod-receipt` scan also reads single-quoted examples, so one without a pass count cannot hide behind the quote style.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/unattended.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
