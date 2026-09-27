---
id: T0-PASS-REASONS-WORDING
title: The review prompt says `reasons` is empty on a pass that carries no notes, so it agrees with the pass-notes line T0-R2-PASS-NOTES added (issue #91)
status: todo
branch: T0-PASS-REASONS-WORDING
worktree: D:\wt\AIDLC\T0-PASS-REASONS-WORDING
allow_paths:
  - src/review/pre-review.ts
  - tests/surface/r2-pass-notes.test.ts
  - tests/surface/pre-review.test.ts
  - CHANGELOG.md
  - specs/tasks/T0-PASS-REASONS-WORDING.md
dod_command: npm run typecheck && node --test tests/surface/r2-pass-notes.test.ts tests/surface/pre-review.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `buildReviewPrompt` shall say `` `verdict` is the worse of the two axes; `reasons` is empty on a pass that carries no notes. `` in every review prompt (R2 and R3, a single pass and each angle, coverage on or off), in place of `` `verdict` is the worse of the two axes; `reasons` is empty on pass. ``, so it agrees with `` A pass that carries notes lists each note once, in the top-level `reasons`, and leaves the `reasons` of both axes empty, so the verdict line stays short. ``; no line of any prompt shall say that `reasons` is empty on every pass. Every other line stays byte for byte as it is; `REVIEW.md` and both configs are unchanged, so the policy hash is unchanged.
  - R2. The CHANGELOG Unreleased section shall state R1.
acceptance:
  - 1. `tests/surface/r2-pass-notes.test.ts`: every pre and formal prompt, a single pass and each angle of `PERSPECTIVES`, with coverage on and off, has the reworded line and the pass-notes line, each once; no line in it says `reasons` is empty on pass or on a pass without the `that carries no notes` qualifier, checked by a pattern with a self-test case for each form it refuses and each form it accepts. [R1] [dod arm 1]
  - 2. `tests/surface/pre-review.test.ts`: the pre-change hash pins still hold with the T1-OPUS55-PROMPTS and T0-R2-PASS-NOTES sentences removed and the reworded line put back to its old text, so no other byte of any prompt changed. [R1] [dod arm 1]
  - 3. `tests/surface/r2-pass-notes.test.ts` reads the exact entry this card adds to the CHANGELOG Unreleased section and fails with it removed; `tests/surface/prose.test.ts` passes over the reworded line. [R2] [dod arm 1]
depends_on: []
budget: 90
tdd: true
sweep: "grep -rn 'empty on pass' src tests docs templates .claude REVIEW.md: src/review/pre-review.ts:258 is the only prompt copy; .claude/agents/reviewer.md:32 and its template say `reasons` is empty on pass, but no R2 or R3 command reads the agent and it carries no pass-notes line, so it has no contradiction to fix here. docs/OPERATIONS.md does not quote the line. The hash pin test (pre-review.test.ts, T1-REVIEW-COVERAGE F2) strips the sentences cards add on purpose through `withoutAddedSentences` and pins the rest."
forbid: [editing REVIEW.md, templates/REVIEW.md or either aidlc.config.json (the policy hash stays unchanged), editing src/core/review-policy.ts or src/loop/card-runner.ts (the T1-STORE-CAS line), editing src/delivery/github-ship.ts, a change to the verdict contract line, VERDICT_SCHEMA or the reader]
non_goals: ["the reviewer agent files (.claude/agents/reviewer.md and its template): no R2 or R3 command reads them and they carry no pass-notes line", "docs/OPERATIONS.md: it does not quote the line"]
hygiene: "Filed from issue #91, the advisory note of the R2 review of T0-R2-PASS-NOTES (PR #90). Mutation sweep and a doc-sentence test before the first review (docs/LESSONS.md 2026-09-24); the pattern that refuses the old wording has a self-test case per form (docs/LESSONS.md 2026-09-24 T1-OPUS55-PROMPTS)."
doc_sync: CHANGELOG.md
---

# T0-PASS-REASONS-WORDING

## Deliverable
The review prompt no longer tells a reviewer both that `reasons` is empty on every pass and that a pass lists its notes in the top-level `reasons`: it says `reasons` is empty on a pass that carries no notes, so a reviewer with notes has one place to put them and does not write them into the axes again, the doubled form that ended one closing brace short in issue #82.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/r2-pass-notes.test.ts tests/surface/pre-review.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
