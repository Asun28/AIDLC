---
id: T1-BENCH-CLEAN-40-2
title: The reviewer bench holds 40 confirmed clean cases, the 15 files of main kept and the rest added by the same seeded rule, and the clean case both arms blocked is marked unconfirmed with the two defects a hand check reproduced
status: todo
branch: T1-BENCH-CLEAN-40-2
worktree: D:\wt\AIDLC\T1-BENCH-CLEAN-40-2
plan_ref: plans/review-panel.md#order-of-work
allow_paths:
  - bench/outcome/clean.ts
  - evals/review/clean/
  - evals/review/README.md
  - tests/surface/outcome-clean.test.ts
  - tests/surface/review-bench.test.ts
  - specs/tasks/T1-BENCH-CLEAN-40-2.md
dod_command: npm run typecheck && node --test tests/surface/outcome-clean.test.ts tests/surface/review-bench.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `selectClean` (bench/outcome/clean.ts) shall take the cases already in evals/review/clean/ and keep each of them, then add drafts by the rule and order of main (`CLEAN_RULE`, sha256 of the draft id ascending, one per candidate, no replay candidate, no candidate already held) until the set holds `WANT` confirmed cases; `WANT` becomes 40. When fewer are eligible the result names the shortfall as on main.
  - R2. `node bench/outcome/clean.ts --extend` shall write only the added cases and leave every existing case file byte-identical apart from the case of R3; without `--extend` a non-empty evals/review/clean/ is refused as on main.
  - R3. The case T0-INTAKE-TARGET-2.g-20261107061914-d4ca11.clean shall have `confirmed: false` and the note "R4: BUG text that INCIDENT also matches gets kind incident (router.ts:138); R3: CR-only and U+2028 line breaks are not sentence boundaries (router.ts:43), so such text routes to staging" (hand check at candidate 72db0897 under T1-BENCH-CLEAN-40 attempt 1; both arms of 2026-11-16 blocked it). It does not count toward `WANT`.
  - R4. evals/review/README.md shall give the count of R1, the `--extend` command and the case of R3, and `CASES_README` in tests/surface/review-bench.test.ts shall carry the changed paragraphs.
acceptance:
  - 1. tests/surface/outcome-clean.test.ts, new test "T1-BENCH-CLEAN-40-2 acceptance 1: existing cases are kept and drafts are added in seeded order until 40 are confirmed, skipping held candidates". Fails on main (existing cases not an input). [R1] [dod arm 1]
  - 2. Same file, new test "T1-BENCH-CLEAN-40-2 acceptance 2: --extend writes only added files and a plain run on a non-empty directory is refused". Fails on main. [R2] [dod arm 1]
  - 3. Same file, new test "T1-BENCH-CLEAN-40-2 acceptance 3: evals/review/clean/ holds 40 confirmed cases on distinct candidates plus the unconfirmed case of R3, and the other 14 files of main are byte-identical". Fails on main (15 cases). [R1] [R2] [R3] [dod arm 1]
  - 4. The existing tests of outcome-clean.test.ts and review-bench.test.ts pass; their only changed lines are the values that follow from `WANT` and R3 in the tests "T1-REPLAY-CLEAN acceptance 1" to "3" (the counts 15, the shortfall 4 and `15 - want.length`, `shortBy` undefined, and the all-confirmed count) and the `CASES_README` entries of R4, each named in the Attempt evidence. prose.test.ts passes with no line changed. [R1] [R4] [dod arm 1]
  - 5. The case of R3 and the README text are as R3 and R4 state (reviewer-verified against the diff). [R3] [R4]
depends_on: []
parallelizable_with: [T1-BENCH-FORMAL-COMMAND, T1-REVIEW-POLICY-PIN]
budget: 140
tdd: true
sweep: "Main at 1def7f99. bench/outcome/clean.ts: CLEAN_RULE and WANT :14-15, selectClean :20-33, the non-empty refusal :50. outcome-clean.test.ts: T1-REPLAY-CLEAN acceptance 1 :40-55 (slice 15, shortBy undefined, 15 - want.length), acceptance 2 :59-64 (shortBy 4), acceptance 3 :67-74 (15 files, 15 cases, 15 candidates). review-bench.test.ts: CASES_README :455-497 checked through docsHold. T1-BENCH-CLEAN-40 attempt 1 (fail, card contradiction) left 162 drafts in its worktree's _local/clean-drafts, 151 eligible; four new drafts rank inside the first 15 by hash, so R1 keeps the existing cases first."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test other than those acceptance 4 names
  - editing a bug case under evals/review/ or evals/review/replay/
non_goals: [new bug cases (the defects of R3 become no bug case here), a bench run of the new clean cases]
hygiene: "The case files are data written by the script; count the script and test lines against the budget, not the case files. Run `npm run check` once and put its totals in the Attempt evidence."
---

# T1-BENCH-CLEAN-40-2

Successor of T1-BENCH-CLEAN-40, whose attempt 1 stopped on two contradictions in its card: R3 and R4 changed evals/review/README.md, which review-bench.test.ts pins and acceptance 4 forbade changing; and the existing selection tests pin 15 in values the WANT-literal exemption did not cover.

## Deliverable
One false block moves the clean rate 2.5 points instead of 6.7, so the panel arms can tell a false-block change from noise.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-clean.test.ts tests/surface/review-bench.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the three new tests pass and the existing tests pass with only the lines acceptance 4 names changed.
