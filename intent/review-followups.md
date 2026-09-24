---
slug: review-followups
title: Close the five follow-ups the Opus 5.5 goal left open in the review loop, the rename path handling and the prompt check
author: asun28 (engineer)
status: accepted
created: 2026-09-24T05:20:00Z
source: human
---

# Intent: Close the five follow-ups the Opus 5.5 goal left open in the review loop, the rename path handling and the prompt check
Author: asun28 (engineer). Status: accepted.

## Problem
Goal g-20260923224425-e5e886 (PRs #32-#34) merged with five known gaps,
each found by a review or by the loop itself and parked because nothing
may be committed after a pass:

1. `aidlc card attempt --outcome success` on a `tdd: true` card accepts a
   success without a RED receipt, then refuses every further attempt
   (`episode already succeeded`), so the card stays in BUILD until the
   receipt is patched through `aidlc card report` (T1-OPUS55-R3-3).
2. The R2 verdict reader rejects a verdict wrapped in a ```json fence as
   malformed, which cost a no-verdict round on T1-OPUS55-PROMPTS.
3. A renamed file with a non-ASCII name keeps git's C-quoting and octal
   escapes in `renameSources`, so it misses a single-segment glob such as
   `src/core/*.ts` (T1-OPUS55-R3-3 R3 advisory).
4. The scope gate reads `git diff --name-only`, which names a renamed file
   by its destination only, so a file moved out of `allow_paths` is not
   refused.
5. The end-of-turn wording says a note after the verdict line is ignored,
   which holds only for a note with no JSON in it, and the removed-
   instruction patterns miss 'be very conservative', 're verify' and
   'verify ... with a subagent' with more than three words between
   (T1-OPUS55-PROMPTS R2 and R3 advisories).

## Proposed outcome
- The loop refuses a success attempt on a `tdd: true` card that carries no
  RED receipt, before it binds the candidate.
- A verdict inside a code fence is read as a verdict.
- Renamed files are listed by both paths, unquoted, for the scope gate and
  for the effort path rule.
- The end-of-turn wording matches the verdict reader, and the prompt check
  catches the missed phrasings.

## Affected users and systems
`src/loop/card-runner.ts`, `src/review/pre-review.ts`, `src/probes/git.ts`,
`src/core/review-effort.ts`, `tests/surface/prose.test.ts`,
`docs/OPERATIONS.md`, `CHANGELOG.md` and their tests.

## Constraints
- One card per PR, each small (budget 250 or less).
- Review policy, allowances and the verdict schema are unchanged.

## Open questions
- (none)
