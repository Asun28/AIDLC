---
id: T1-LESSON-MATCH
title: A review can take the learned rules that best match its diff instead of the newest, and `aidlc review bench run --rules matched` scores that selection
status: todo
branch: T1-LESSON-MATCH
worktree: D:\wt\AIDLC\T1-LESSON-MATCH
plan_ref: plans/second-r3-pass.md#order-of-work
allow_paths:
  - src/artifacts/lessons.ts
  - src/core/parse-guard.ts
  - src/probes/git.ts
  - src/review/pre-review.ts
  - src/review/bench.ts
  - src/cli/main.ts
  - tests/surface/lesson-match.test.ts
  - tests/surface/review-bench.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-LESSON-MATCH.md
dod_command: npm run typecheck && node --test tests/surface/lesson-match.test.ts tests/surface/lessons.test.ts tests/surface/review-bench.test.ts tests/surface/pre-review.test.ts
dod_exit: 0
requirements:
  - R1. `matchedLessons(file, input, maxBytes)` in `src/artifacts/lessons.ts` shall return the NEVER and ALWAYS lines of the file, highest score first, under the byte cap and stop rule of `reviewLessons`, in its `{ lines, omitted }` shape plus `matched: true`.
  - R2. The score of a rule shall be the sum of idf(p) over its paths the candidate changes plus the sum of idf(t) over its terms found in the diff text, where idf(x) = ln(1 + N / df(x)), N is the rule count and df(x) the rules holding x; equal scores keep newest first.
  - R3. The terms of a rule shall be its backticked spans and, outside them, the words with a capital right after a lowercase letter or digit, or with an underscore, dot or dash that is neither their first nor their last character. An all-capitals word such as `CI` is not a term, since the replay did not count one.
  - R4. `GitProbe.commitFiles(cwd, ref)` shall list the subject and changed files of each first-parent commit reachable from `ref`, read NUL-delimited so a name git quotes is listed as the candidate diff lists it and no name can pass for a commit, leaving out `CHANGELOG.md`, `docs/`, `specs/`, `plans/`, `intent/` and `evals/`, and shall return an empty list when git fails; the paths of a rule shall be the files of the commits whose subject names its card as a whole token.
  - R5. With `matched` set, the prompt's sentence on omitted rules shall read `- <n> other lessons omitted at the byte cap; the rules that best match this diff are above.`, or `- <n> other lessons omitted at the byte cap (not even the best match fits it).` when no rule fits, since no rule is then above it.
  - R6. `aidlc review bench run --rules <newest|matched>` shall default to `newest`, shall refuse any other value before a review, shall select matched rules per candidate from that candidate's diff and `commitFiles` at its base, and shall name the choice as `rules` in the report.
  - R7. `docs/OPERATIONS.md` (a new paragraph after Learned invariants, since tests pin the Reviewer bench section whole) and `CHANGELOG.md` shall state the selection and the flag.
acceptance:
  - 1. `tests/surface/lesson-match.test.ts`: with hand-computed idf values over a small rule file, a rule matching a changed path and a rule matching a diff term outrank a newer rule matching nothing, equal scores keep newest first, and a NOTE line is never returned. [R1] [R2] [dod arm 1]
  - 2. Same file: the cap stops at the first rule that does not fit and `omitted` counts the rest; when every score is 0 the lines and `omitted` equal those of `reviewLessons`. [R1] [dod arm 1]
  - 3. Same file: `git add -A`, `pinCandidate`, `update-ref`, `gc.pruneExpire`, `foo__bar`, `__dirname` and `parse2JSON` are terms; `Always`, `review` and `CI` are not; a term is matched case-sensitively. [R3] [dod arm 1]
  - 4. Same file, in a real git repository: a commit reached only through a merged side branch is not listed, a file under a left-out path is dropped, a name git quotes keeps its bytes and a left-out one is still dropped, two names starting with U+0001 stay names of their commit, an empty commit is listed with no files, an unknown ref returns an empty list, and a rule of `T1-X` takes the files of `feat: [T1-X] (#1)` and not those of `feat: [T1-X-2] (#2)`. [R4] [dod arm 1]
  - 5. Same file: `buildReviewPrompt` prints the exact sentences of R5 for matched rules, and the existing sentence is unchanged for the newest rules. [R5] [dod arm 1]
  - 6. `tests/surface/review-bench.test.ts`: with a scripted reviewer `--rules matched` puts the matching rule in the prompt and `rules: 'matched'` in the report, no flag gives `rules: 'newest'` and the same prompt as before, and `--rules other` exits non-zero with no review run. [R6] [dod arm 1]
  - 7. The docs and CHANGELOG state R1 to R6 (reviewer-verified against the diff). [R7]
depends_on: []
budget: 320
sweep: "git grep -n -E 'reviewLessons\\(|\\.lessons\\b|lessons:' -- src on main at 5f66da0: artifacts/lessons.ts:155 (the reader), loop/card-runner.ts:1753 (R3) and :2381 (R2), review/bench.ts:143 and :243, review/pre-review.ts:421 and :424 (the render, the one site that names the newest rules). context-pack.ts carries PREPARE lessons and is not this selection. Only bench.ts changes caller here."
forbid: [changing what `reviewLessons` returns, a change to `src/loop/`, a gate or refusal that depends on the git history, a change to `docs/LESSONS.md`]
non_goals: [using matched rules in a loop review (T1-R3-SECOND-PASS), rules older than the case in the bench (the bench reads `docs/LESSONS.md` from the checkout root), tags or new fields on lesson lines, a change to `REVIEW_LESSONS_MAX_BYTES`]
hygiene: "The score is the one fixed before the replay: _local/bench-step4/method.md and scripts/arms.mts hold the first version. Do not tune it. This card adds a parse of process output, so run `npm test` once before review (docs/LESSONS.md, T1-REVIEW-BENCH-EXPORT-3)."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T1-LESSON-MATCH

## Deliverable
`matchedLessons` picks rules for a diff, by paths and terms, and the bench can score that choice. No loop review uses it yet.

## Why
A rule is chosen by age today: `reviewLessons` takes the newest that fit 3000 bytes, about 5 to 8 of 77. Only 4 of 73 rules name a repository path in their text, so paths come from the commits of the card that wrote the rule. Those commits are named in subjects like `feat: [T0-R2-OFF] (#210)`.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/lesson-match.test.ts tests/surface/lessons.test.ts tests/surface/review-bench.test.ts tests/surface/pre-review.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.
