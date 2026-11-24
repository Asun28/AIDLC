---
id: T1-PREPARE-LESSONS-REF
title: The PREPARE narration names the lesson count and docs/LESSONS.md for reference with no instruction to read the file, and the Lessons paragraph of docs/OPERATIONS.md says the loop reads it
status: merged
branch: T1-PREPARE-LESSONS-REF
worktree: D:\wt\AIDLC\T1-PREPARE-LESSONS-REF
plan_ref: plans/card-contract-scope.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/t0-flow.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T1-PREPARE-LESSONS-REF.md
  - specs/tasks/T1-PREPARE-LESSONS-REF.md
dod_command: npm run typecheck && node --test tests/scenarios/t0-flow.test.ts tests/scenarios/lesson-dup.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R4. The narration of the PREPARE directive shall name the lesson count, say that the most recent lessons are in the directive and name `docs/LESSONS.md` for reference, with no instruction to read the file.
  - R5. The Lessons paragraph of `docs/OPERATIONS.md` shall say that at PREPARE the loop reads `docs/LESSONS.md` and puts the count and the five most recent lines in the directive, and that the implementer is not asked to read the file.
acceptance:
  - 1. tests/scenarios/t0-flow.test.ts, the test at line 2087 whose title ends `PREPARE carries the count and the most recent lessons from docs/LESSONS.md`, gains one assertion - the narration holds no instruction to read `docs/LESSONS.md`. It fails on main, where the narration starts `Read docs/LESSONS.md once before the first attempt`. The assertion does not pin the whole new sentence. [R4] [dod arm 2]
  - 2. The same test keeps its assertions on the lessons file, the count, the five most recent lines and `6 lessons so far`, and the narration still names `docs/LESSONS.md`. [R4] [dod arm 2]
  - 3. The Lessons paragraph of `docs/OPERATIONS.md` states R5 in place of `PREPARE reads it once per card` (reviewer-verified against the diff). [R5]
  - 4. `changelog.d/T1-PREPARE-LESSONS-REF.md` holds one line in the form of `changelog.d/README.md` (reviewer-verified against the diff). [R4] [R5]
  - 5. `npm run typecheck` exits 0, and every other test of the DoD passes with no line changed. [R4] [dod arm 1] [dod arm 2]
depends_on: [T1-CARD-FORBID-BOUNDARY]
budget: 40
tdd: true
sweep: "Main at 83d3a778. `git grep -n 'lessons so far\\|before the first attempt\\|Read docs/LESSONS'` over src, tests, docs, .claude, templates, bench, evals and README.md finds src/loop/card-runner.ts:1110 (the narration) and tests/scenarios/t0-flow.test.ts:2106 (`6 lessons so far`). `readLessons` (src/artifacts/lessons.ts:134) returns the file, the count and the five most recent lines, and the test at t0-flow.test.ts:2087-2110 asserts all three. The Lessons paragraph is `docs/OPERATIONS.md:686`; tests/scenarios/lesson-dup.test.ts:106 pins its last sentence, which this card leaves as it is, and no test holds `PREPARE reads it once per card`."
forbid:
  - a change to the `lessons` field of the directive, to `readLessons` or to a review prompt
non_goals:
  - lesson matching at PREPARE, and the lessons a review prompt carries
  - the context pack's reading of `docs/LESSONS.md` (src/loop/context-pack.ts)
  - the guidance text of T1-CARD-FORBID-BOUNDARY
hygiene: "Line numbers are from main at 83d3a778; read them again at PREPARE. Card T0-ADOPT-EXTERNAL-MERGE-2 allows `src/loop/card-runner.ts` and `docs/OPERATIONS.md` and runs t0-flow.test.ts in its DoD; do not run beside it. The directive's `lessons` field is a persisted shape other code reads, which is why it is the one hard boundary. Not verified before the card runs - whether an implementer still opens the whole file once the narration stops asking; that is measured after the merge, on cached tokens per implement request against 147,571."
---

# T1-PREPARE-LESSONS-REF

## Deliverable
The first sentence of the PREPARE narration no longer tells the implementer to read `docs/LESSONS.md`; it gives the count, says the most recent lessons are in the directive and names the file for reference. The Lessons paragraph of `docs/OPERATIONS.md` says who reads the file.

## Why
Plan `plans/card-contract-scope.md`; the measurements are in `intent/card-contract-scope.md`, Problem. The file is 84,045 bytes, about 21,000 tokens, against 147,571 cached tokens per implement request, and the directive already carries the five most recent lines.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/t0-flow.test.ts tests/scenarios/lesson-dup.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: dod arm 1 is `npm run typecheck`, dod arm 2 is the `node --test` command; the new assertion of acceptance 1 fails on main and passes with the change.
