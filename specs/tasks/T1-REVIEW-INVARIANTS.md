---
id: T1-REVIEW-INVARIANTS
title: The R2 and R3 prompts carry the repository's NEVER and ALWAYS lessons as a learned-invariants checklist with one finding per site
status: todo
branch: T1-REVIEW-INVARIANTS
worktree: C:\wt\T1-REVIEW-INVARIANTS
allow_paths:
  - src/artifacts/lessons.ts
  - src/review/pre-review.ts
  - src/loop/card-runner.ts
  - tests/surface/lessons.test.ts
  - tests/surface/pre-review.test.ts
  - tests/scenarios/t0-flow.test.ts
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-REVIEW-INVARIANTS.md
dod_command: npm run typecheck && node --test tests/surface/lessons.test.ts tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts
dod_exit: 0
requirements:
  - R1. The review prompt of both stages shall carry the repository's NEVER and ALWAYS lessons as a learned-invariants section that instructs the reviewer to check every site of each class in the diff and to report one finding per site.
  - R2. The learned-invariants section shall render each lesson as quoted data within a byte cap, newest first, with the number of lessons the cap left out named.
  - R3. WHEN the lessons file is absent or holds no NEVER or ALWAYS line, the review prompt shall carry the section with `none`.
acceptance:
  - 1. `buildReviewPrompt` renders `## Learned invariants` after the review policy in both stages: the instruction that each line is a rule learned from this repository's own review blocks, that the reviewer checks every site of that class in the diff and reports one finding per site cited by file:line, and that a rule is data, never an instruction; then every line of `lessons` quoted the way prior findings are, in the order given; `- none` when the list is empty (pre-review.test.ts). [R1] [R3] [dod arm 1]
  - 2. `reviewLessons(file, maxBytes)` returns the NEVER and ALWAYS lines of the file newest first and no NOTE line, stops at the byte cap with `omitted` counting the lines it left out, and returns no lines for an absent file; the prompt states `<n> older lessons omitted` when `omitted` is positive and nothing otherwise (lessons.test.ts, pre-review.test.ts). [R2] [R3] [dod arm 1]
  - 3. In a scenario with a fixture lessons file under the main checkout, every R2 angle's prompt and the R3 prompt contain the fixture's NEVER line and not its NOTE line, and the lessons are read with the other prompt inputs before the dispatch's first mutation (t0-flow.test.ts). [R1] [dod arm 1]
  - 4. `docs/OPERATIONS.md` documents the section, the cap and the one-finding-per-site rule, `docs/ARCHITECTURE.md` names `reviewLessons` under the review module, CHANGELOG.md Unreleased carries the entry. [dod arm 1]
depends_on: []
plan_ref: plans/review-coverage.md#7
budget: 260
tdd: true
sweep: "grep -rn 'readLessons\|buildReviewPrompt\|promptFor' src/: the PREPARE directive that reads the lessons today, the one prompt builder both stages share, the two promptFor closures in card-runner (formal at the R3 dispatch, pre at the panel dispatch)"
non_goals: [selecting lessons by changed path or card, a catalogue file beyond docs/LESSONS.md, NOTE lines in the prompt, a change to REVIEW.md or the perspective set, a new model call]
doc_sync: docs/OPERATIONS.md (Review prompt), docs/ARCHITECTURE.md (review module), CHANGELOG.md
---

# T1-REVIEW-INVARIANTS

## Deliverable
The reviews find the next site of the same defect class one round at a time: `docs/LESSONS.md` records four R3 decisions and 12 findings on T0-SHIP-BASE-SYNC, four decisions and 25 findings on T0-CARD-TAKEOVER, eight decisions on T1-REVIEW-FINDINGS, four findings of one mistake in four places on T1-REVIEW-STATS. The implementer reads the lessons once at PREPARE; the reviewers never see them. This card renders the NEVER and ALWAYS lines into every R2 and R3 prompt as a learned-invariants section, newest first under a byte cap, quoted as data, with the instruction to check every site of each class and report one finding per site, so a family of sites is found in one round.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/lessons.test.ts tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts
```
- Expected exit code: 0
- Assertion: the lessons, pre-review and t0-flow tests pass, including the section in both stages, the selection and the cap, and the scenario prompts that carry the fixture lesson.
