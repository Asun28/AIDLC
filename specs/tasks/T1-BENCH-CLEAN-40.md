---
id: T1-BENCH-CLEAN-40
title: The reviewer bench holds at least 40 confirmed clean cases, the 15 of T1-REPLAY-CLEAN kept and 25 or more added by the same seeded rule, and the clean case both arms false-blocked is checked and its label recorded
status: todo
superseded_by: T1-BENCH-CLEAN-40-2
branch: T1-BENCH-CLEAN-40
worktree: D:\wt\AIDLC\T1-BENCH-CLEAN-40
plan_ref: plans/review-panel.md#order-of-work
allow_paths:
  - bench/outcome/clean.ts
  - evals/review/clean/
  - evals/review/README.md
  - tests/surface/outcome-clean.test.ts
  - specs/tasks/T1-BENCH-CLEAN-40.md
dod_command: npm run typecheck && node --test tests/surface/outcome-clean.test.ts tests/surface/review-bench.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `selectClean` (bench/outcome/clean.ts) shall take the cases already in evals/review/clean/ and keep each of them first, then add drafts by the rule and order of main (`CLEAN_RULE`, sha256 of the draft id ascending, one per candidate, no replay candidate) until the set holds `WANT` cases; `WANT` becomes 40. When fewer are eligible the result names the shortfall as on main.
  - R2. `node bench/outcome/clean.ts --extend` shall write only the added cases and leave every existing case file byte-identical; without `--extend` a non-empty evals/review/clean/ is refused as on main.
  - R3. The clean case T0-INTAKE-TARGET-2.g-20261107061914-d4ca11.clean, false-blocked by both the rounds and the order arm (intent/review-panel.md, Problem), shall be checked by hand at its candidate: it stays confirmed with a `note` that names the arms' block reason and why it is not a defect, or it becomes `confirmed: false` with a `note` naming the defect, and evals/review/README.md says which.
  - R4. evals/review/README.md shall give the new count and the `--extend` command.
acceptance:
  - 1. tests/surface/outcome-clean.test.ts, new test "T1-BENCH-CLEAN-40 acceptance 1: existing cases are kept first and drafts are added in seeded order up to 40". Fails on main (existing cases not an input). [R1] [dod arm 1]
  - 2. Same file, new test "T1-BENCH-CLEAN-40 acceptance 2: --extend writes only added files and a plain run on a non-empty directory is refused". Fails on main. [R2] [dod arm 1]
  - 3. Same file, new test "T1-BENCH-CLEAN-40 acceptance 3: evals/review/clean/ holds at least 40 cases that parse, 15 of them the files of main unchanged". Fails on main (15 cases). [R1] [R2] [dod arm 1]
  - 4. review-bench.test.ts and prose.test.ts pass with no line changed; the existing tests of outcome-clean.test.ts pass with no line changed other than the literal 15 that pins `WANT`. [R1] [dod arm 1]
  - 5. The label and note of the T0-INTAKE-TARGET-2 case and the README text are as R3 and R4 state (reviewer-verified against the diff and the candidate). [R3] [R4]
depends_on: []
parallelizable_with: [T1-BENCH-FORMAL-COMMAND, T1-REVIEW-POLICY-PIN]
budget: 120
tdd: true
sweep: "Main at ff925160. bench/outcome/clean.ts: CLEAN_RULE and WANT :14-15, selectClean :20-33, the non-empty refusal :50, main :48-67. Drafts come from `aidlc review bench export --clean --dir _local/clean-drafts` (evals/review/README.md :29). Shared false block: _local/arms/rounds-clean.json and order-clean.json."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test other than the WANT literal of acceptance 4
  - editing a bug case under evals/review/ or evals/review/replay/
non_goals: [new bug cases, a bench run of the new clean cases (the panel arms run does that)]
hygiene: "The case files are data written by the script; count the script and test lines against the budget, not the case files."
---

# T1-BENCH-CLEAN-40

## Deliverable
One false block moves the clean rate 2.5 points instead of 6.7, so the panel arms can tell a false-block change from noise.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-clean.test.ts tests/surface/review-bench.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the three new tests pass and the existing tests pass with only the WANT literal changed.
