---
id: T1-TEST-AUDIT-LIST-3
title: (replaces T1-TEST-AUDIT-LIST-2 and carries its candidate) The audit test creates its temporary directories through tmpDir of tests/infra/helpers.ts, so the temporary-directory sweep test passes
status: todo
branch: T1-TEST-AUDIT-LIST-3
worktree: D:\wt\AIDLC\T1-TEST-AUDIT-LIST-3
plan_ref: plans/test-time.md#order-of-work
allow_paths:
  - tests/surface/test-audit.test.ts
  - changelog.d/T1-TEST-AUDIT-LIST-2.md
  - changelog.d/T1-TEST-AUDIT-LIST-3.md
  - specs/tasks/T1-TEST-AUDIT-LIST-2.md
  - specs/tasks/T1-TEST-AUDIT-LIST-3.md
dod_command: npm run typecheck && node --test tests/surface/test-audit.test.ts tests/surface/test-temp.test.ts
dod_exit: 0
requirements:
  - R1. The requirements R1 to R4 of T1-TEST-AUDIT-LIST-2 shall hold on the carried candidate 5eb62ce8 merged with main.
  - R2. `tests/surface/test-audit.test.ts` shall create every temporary directory through `tmpDir` of `tests/infra/helpers.ts` and import no `mkdtemp`/`mkdtempSync`; its removal shall go through `cleanup` of the same file or the registration `tmpDir` makes.
acceptance:
  - 1. `tests/surface/test-temp.test.ts` passes with no line changed; it fails on the carried candidate (CI run 44689860765, "T0-TEST-TEMP-SWEEP acceptance 1": two sites in test-audit.test.ts at :4 and :151). [R2] [dod arm 1]
  - 2. `tests/surface/test-audit.test.ts` passes, and its acceptance tests are those of the carried candidate with no `assert`, `it(` or `test(` line changed. [R1] [dod arm 1]
depends_on: []
budget: 30
tdd: false
forbid:
  - changing, skipping or deleting any test file other than tests/surface/test-audit.test.ts
  - a change to docs/reliability/test-audit.json or docs/reliability/test-audit.md
  - a change under src/
non_goals: [new audit rows, acting on any row]
hygiene: "Replaces T1-TEST-AUDIT-LIST-2: R3 passed its candidate 5eb62ce8 (decision 4), and the ship stopped with STOP/ci because the CI gate failed on the temporary-directory sweep (tests/surface/test-temp.test.ts) and the gate log held no test output to classify. tdd is false: the change moves two lines to the shared helper and the failing sweep test is the oracle. Start the branch from T1-TEST-AUDIT-LIST-2 (carries 5eb62ce8), merge main, set specs/tasks/T1-TEST-AUDIT-LIST-2.md to `superseded_by: T1-TEST-AUDIT-LIST-3` if main does not have it, and rename changelog.d/T1-TEST-AUDIT-LIST-2.md into changelog.d/T1-TEST-AUDIT-LIST-3.md. PR 390 is closed unmerged."
---

# T1-TEST-AUDIT-LIST-3

## Deliverable
The reviewed audit list and its JSON check merge, with the audit test creating temporary directories the way every other test does.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/test-audit.test.ts tests/surface/test-temp.test.ts
```
- Expected exit code: 0
- Assertion: both files pass; the sweep test fails on the carried candidate.

## Attempt evidence
Before (carried candidate 5eb62ce8 merged with main at cac96590): `node --test tests/surface/test-temp.test.ts` exits 1, "T0-TEST-TEMP-SWEEP acceptance 1" lists `tests/surface/test-audit.test.ts:4 [module scope] reference of mkdtempSync` and `:151 [<anonymous>] call of mkdtempSync`. After: the temporary directory comes from `tmpDir('test-audit-')` and is removed by `cleanup(tmp)` in the same `finally`; `mkdtempSync`, `rmSync` and `os` leave the imports. Four lines change in `tests/surface/test-audit.test.ts` (two imports, the creation, the removal); no `assert`, `it(` or `test(` line changes. No guard is added, so there is no sweep.
