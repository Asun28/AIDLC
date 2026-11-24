---
id: T0-REVIEW-VERSION-TITLES
title: The test titles of tests/surface/templates.test.ts name REVIEW.md@7, the policy version their assertions check, and the OPERATIONS.md stale-version check rejects every version below the current one, not only @5 (issue 340)
status: merged
branch: T0-REVIEW-VERSION-TITLES
worktree: D:\wt\AIDLC\T0-REVIEW-VERSION-TITLES
allow_paths:
  - tests/surface/templates.test.ts
  - specs/tasks/T0-REVIEW-VERSION-TITLES.md
dod_command: npm run typecheck && node --test tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R1. Every test title in `tests/surface/templates.test.ts` that names a `REVIEW.md@<n>` version shall name the version both configs carry as `reviewPolicyVersion`, `REVIEW.md@7`; on main at b474d7eb the titles at about lines 196, 567, 666 and 738 name `REVIEW.md@6` and the title at about line 549 names `REVIEW.md@5`, while their assertions check `REVIEW.md@7`.
  - R2. The test of `docs/OPERATIONS.md` at about line 738 shall fail when the document names, in the form "`reviewPolicyVersion` is `REVIEW.md@<n>`", any version `n` below the current one (the `reviewPolicyVersion` of `aidlc.config.json`), for every `n` from 1 to the current version minus one; today it fails only for `n` = 5.
  - R3. The change shall keep every assertion of the file with its expected value, alter only test titles, the one stale-version check and the checks R1 and R2 add, and touch no file outside `tests/surface/templates.test.ts` apart from this card.
acceptance:
  - 1. tests/surface/templates.test.ts - a test reads the file's own source and asserts that every `REVIEW.md@<n>` named in a `test(` title equals the `reviewPolicyVersion` of `aidlc.config.json` and of `templates/aidlc.config.json`; on main at b474d7eb it fails naming the five stale titles. [R1] [dod arm 1]
  - 2. tests/surface/templates.test.ts - the test at about line 738 asserts that no "`reviewPolicyVersion` is `REVIEW.md@<n>`" in `docs/OPERATIONS.md` names an `n` below the current version, and that replacing the current-version sentence with each earlier version 1 to 6 fails the check. [R2] [dod arm 1]
  - 3. tests/surface/templates.test.ts passes whole and the typecheck is clean, with no assertion removed or its expected value changed. [R3] [dod arm 1]
depends_on: []
budget: 80
tdd: true
sweep: "Survey of main at b474d7eb. `git grep -n 'REVIEW.md@[0-9]' tests/` finds version-naming test titles only in tests/surface/templates.test.ts: :196, :567, :666 and :738 name @6 (issue 340) and :549 names @5 (same class, the issue does not list it); the strings at :538, :543, :644, :656 and :715 are pinned CHANGELOG and OPERATIONS sentences that record a past move, not titles, and stay. The stale check at :749 tests only '`reviewPolicyVersion` is `REVIEW.md@5`'. docs/OPERATIONS.md names the current version in that form at :365 and :434, both @7; it records earlier moves as 'moved `reviewPolicyVersion` to `REVIEW.md@<n>`', which the check does not read."
forbid: [weakening or skipping a test to go green, changing the expected value of an existing assertion, changing docs/OPERATIONS.md, CHANGELOG.md, REVIEW.md or either config]
non_goals: [rewording the pinned CHANGELOG and OPERATIONS sentences that record past version moves, the same check for README.md or CHANGELOG.md, deriving the pinned 'REVIEW.md@7' assertion literals from the config]
diagnosis:
  root_cause: "T1-REVIEW-SEVERITY-3 (PR 335) moved `reviewPolicyVersion` from REVIEW.md@6 to @7 and its allow list let it change only the pinned assertion literals, so the titles kept @6; T0-REVIEW-IMPACT-BAR wrote the stale check against the single version before its own (@5), so it never covered later moves."
  same_class: "The title at :549 kept @5 from T1-REVIEW-PRE-EXISTING for the same reason; acceptance 1 covers every title in the file, so a later version move fails the suite until the titles follow."
---

# T0-REVIEW-VERSION-TITLES

## Deliverable
A reader of `tests/surface/templates.test.ts` sees the policy version the assertions check in every title, and the OPERATIONS.md check fails when the document names any earlier version as current, so the next version move cannot leave either stale without a red suite.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: every test in the file passes and the typecheck is clean.

## Attempt evidence

RED on 037a15d0 (titles and stale check as on main 39dc7121): `node --test tests/surface/templates.test.ts` exit 1, 38 pass, 2 fail: acceptance 1 lists the five stale titles (:196, :549, :567, :666, :738) under `titles naming a version other than REVIEW.md@7`; acceptance 2 fails `naming REVIEW.md@1 as current still passes` under the old check, which rejects only `@5`.

| # | proof | result |
|---|---|---|
| 1 | `T0-REVIEW-VERSION-TITLES` acceptance 1 test; revert run: the :666 title set back to `REVIEW.md@6` | pass on the candidate; revert run red (39 pass, 1 fail) |
| 2 | `T0-REVIEW-IMPACT-BAR` acceptance 3 test, mutants `@1` to `@6` in the test; revert run: docs/OPERATIONS.md:434 changed to name `REVIEW.md@6` as current, which the old check passed | pass on the candidate; revert run red (`no version before the current one is named as current`) |
| 3 | `npm run typecheck && node --test tests/surface/templates.test.ts`; `git diff 39dc7121 -- tests/` removes no assertion line and changes no expected value | exit 0, 40 pass, 0 fail |
