---
slug: review-followups
title: Close the five follow-ups the Opus 5.5 goal left open in the review loop, the rename path handling and the prompt check
intent: intent/review-followups.md
status: accepted
created: 2026-09-24T05:20:00Z
skills_applied: []
---

# Spec: Close the five follow-ups the Opus 5.5 goal left open
From intent: intent/review-followups.md. Status: accepted. Skills applied: (none).

## Requirements (EARS)
- R1. IF a success attempt is recorded for a `tdd: true` card whose run and input carry no RED receipt, THEN `aidlc card attempt` shall refuse it with an error naming the missing receipt and record nothing.
- R2. WHEN a reviewer's output wraps its verdict JSON in a Markdown code fence, the verdict reader shall read the fenced document as the verdict.
- R3. The changed-path listing used by the scope gate and the effort path rule shall name a renamed file by both its source and its destination path, unquoted.
- R4. The end-of-turn wording shall say that a note after the verdict line is ignored only when it contains no JSON.
- R5. The removed-instruction check shall catch 'be very conservative', 'be more conservative', 're verify' and 'verify ... with a subagent' with any number of words between within one sentence.

## Design
R1: a guard at the top of `recordAttempt` (`src/loop/card-runner.ts:845`).
R2: strip a fence around the last document before `topLevelDocuments`
(`src/review/pre-review.ts:413`). R3: `--no-renames` on the name listings
(`src/review/pre-review.ts:690`, `src/probes/git.ts:137`), which lists a
rename as a deletion and an addition with `-z` and no quoting; the effort
path rule then reads the sources from that list and `renameSources` is
removed. R4, R5: text and pattern changes.

## Interfaces and contracts
No schema change. `aidlc card attempt` gains one refusal.

## Data model and migration impact
None.

## Flagged concerns (route to policy owners)
- (none)

## Non-goals
- Changing the verdict schema, the review allowances or the effort rule itself.
- Detecting copies (`--find-copies`).

## Acceptance
- 1. A success without a RED receipt on a `tdd: true` card is refused and records nothing. [R1]
- 2. A fenced verdict is read. [R2]
- 3. A rename out of an allowed path is refused by the scope gate; a non-ASCII rename source matches a single-segment glob. [R3]
- 4. The wording and the patterns follow R4 and R5. [R4] [R5]
