---
slug: review-findings
title: Review findings with identity, dispositions and a bounded re-review
intent: intent/review-findings.md
status: accepted
created: 2026-09-14T03:00:00Z
skills_applied: [tdd, grilling]
---

# Spec: Review findings with identity, dispositions and a bounded re-review
From intent: intent/review-findings.md. Status: accepted. Skills applied: tdd, grilling (one scope question, answered: three cards).

## Requirements (EARS)
- R1. WHEN a pre-review round or a formal decision ends in a block, the loop shall record one finding with a stable id per cited reason and record a reason that references an earlier finding as a re-raise of that finding.
- R2. The loop shall let the author dispute an open finding with a note, withdraw a dispute, and list the findings of a card, each journaled.
- R3. WHEN a review prompt is built after a block, the loop shall list every open finding as one to verify and every disputed finding with its note as one to re-raise only with evidence the note does not answer.
- R4. IF the current candidate was blocked by the same stage and any finding of that block is open, THEN the loop shall refuse a new round or decision on that candidate.
- R5. WHILE a candidate holds a pre-review pass from any cycle, the loop shall accept it as pre-reviewed for the formal review.
- R6. WHEN a finding is re-raised after two disputes, the loop shall name it as a deadlock in the stop detail or in the residual findings handed to R3.
- R7. IF the committed diff exceeds the stage's byte cap, THEN the loop shall refuse the review before dispatch, with no round, decision or model call recorded.
- R8. The loop shall record the hash of the applied review policy on every round, decision, retained verdict document and journal event, and name it in the prompt together with any rule file the candidate changes.
- R9. WHEN a round or decision follows an earlier one of the same stage, the loop shall include the delta since the last reviewed candidate in the prompt and mark a new finding outside that delta as a first-round miss.
- R10. The loop shall treat reasons tagged `[question]` or `[suggestion]` as advisory in both stages and pass the pre-review's advisory notes to the formal review.
- R11. The loop shall report review statistics per card: rounds, decisions, blocks, durations, findings by disposition, re-raises and first-round misses.
- R12. WHERE a card supersedes earlier cards, the statistics shall include the superseded family's totals.
- R13. The loop shall document the behaviours above in the operating guide, the architecture note, the skill text and the changelog.

## Design
Findings are a persisted list on the card run. When a round or decision blocks, each cited reason becomes a finding `F<n>` (sequential per card run) unless it carries `re:F<k>`, in which case it is recorded on `F<k>` as a re-raise and `F<k>` returns to open. The author records dispositions with the CLI; the next prompt renders open findings as "verify resolved" and disputed findings with the note as "re-raise only with new evidence". A round or decision on a candidate that the same stage already blocked runs only when every finding of that block is disputed, so an unchanged candidate is never re-reviewed without new information. The existing caps decide deadlocks: R3's second substantive block is STOP/review and R2's exhausted rounds either stop or hand the residual to R3; both name a finding disputed twice and re-raised twice. Prompts receive the policy hash, the rule files in the diff, and on later rounds the delta since the last reviewed candidate; a new finding whose cited file is outside that delta is a first-round miss. Reasons tagged `[question]` or `[suggestion]` already fail the citation rule and stay advisory; the prompt and REVIEW.md now say so. Statistics are a pure function over card runs and the card registry.

## Interfaces and contracts
- `ReviewFinding` (types.ts): `id` (`F<n>`), `stage` (`pre|formal`), `cycle`, `round`, `perspective`, `reason`, `file`, `candidateSha`, `raisedAt`, `disposition` (`open|disputed`), `disputes[]` (`at`, `note`), `reraised[]` (`stage`, `round`, `candidateSha`, `at`, `reason`), `resolvedAt`, `outsideDelta`. `CardRun.findings` defaults to `[]`.
- Reason reference: `re:F<n>` (optional space after the colon) anywhere in a reason; an unknown id is ignored and the reason is a new finding.
- `aidlc review dispute <card> <id> --note "<why>"`, `aidlc review accept <card> <id>`, `aidlc review findings <card>`; journal events `FINDING_DISPUTED`, `FINDING_ACCEPTED`; `PRE_REVIEW_DECIDED` and `REVIEW_DECIDED` carry `findings` and `reraised` id lists.
- Prompt sections: `## Prior findings` replaces `## Findings to verify`; `## Delta since the last reviewed candidate` on later rounds; the policy heading carries `sha256 <hash>`; a note lists rule files in the diff (`REVIEW.md`, `CLAUDE.md`, `AGENTS.md`, `.claude/`, `templates/claude/`).
- `PreReviewRound.policyHash`, `ReviewInvocation.policyHash`, `ReviewInvocation.candidateSha` (all optional); retained verdict documents carry `policy_hash`.
- REVIEW.md output contract: `[question]` and `[suggestion]` tags; `reviewPolicyVersion` becomes `REVIEW.md@3` in both configs.
- `aidlc review stats [--goal <id>] [--card <id>]` prints per card: `r2` (rounds, blocks, noVerdict, quotaHolds, durationMs, blocksByPerspective), `r3` (decisions, blocks, durationMs), `findings` (total, pre, formal, open, disputed, reraised, firstRoundMiss, resolved), `wallMs`, and `family` (predecessors by `superseded_by`, same fields, totals).

## Data model and migration impact
Card runs gain `findings` (default empty); rounds and invocations gain optional hash and sha fields. Records written before this change parse unchanged. No migration.

## Flagged concerns (route to policy owners)
- A dispute lets the author answer a reviewer; the human ruling path stays the existing STOP/review hand-off (no ruling command this version).

## Non-goals
- A human ruling command or a card resume; the STOP/review hand-off is the ruling path.
- A verification stage with executed evidence (a further model call per round).
- CI in parallel with the reviews (changes the ship path).
- Changing the R2 rounds cap, the R3 decision allowance or the effort ladder.
- Matching a re-raised finding without an explicit `re:F<n>` reference.
- New fields in the Codex output schema.

## Acceptance
- 1. A block records one finding per cited reason with sequential ids; a later reason carrying `re:F<n>` is a re-raise of F<n>, not a new finding, and returns it to open. [R1]
- 2. `review dispute` records the note and the disposition, `review accept` withdraws it, `review findings` lists them; a second dispute needs a re-raise in between; both commands are journaled. [R2]
- 3. The next prompt lists open findings as ones to verify and disputed findings with the note as ones to re-raise only with new evidence. [R3]
- 4. `review pre` and `review r3` on the blocked, unchanged candidate are refused while a finding of that block is open, and run when every one is disputed; a pre-review pass stays valid for R3 across cycles. [R4] [R5]
- 5. A finding disputed twice and re-raised twice is named in the STOP detail (R3 second block; R2 exhausted with `onExhausted: stop`) and in the residual handed to R3 (`onExhausted: ship`). [R6]
- 6. A diff above `maxDiffBytes` is refused before dispatch; no round, decision or receipt is recorded. [R7]
- 7. Every round, decision, retained verdict document and journal event carries the policy hash; the prompt names it and lists rule files in the diff. [R8]
- 8. Round two and decision two receive the delta section, or a "no change since the last reviewed candidate" note; a new finding outside the delta carries `outsideDelta`. [R9]
- 9. `[question]` and `[suggestion]` reasons are advisory in both stages; the prompt and REVIEW.md say so; R3 receives R2's advisory notes; the R2 summary prints them; `reviewPolicyVersion` is `REVIEW.md@3`. [R10]
- 10. `review stats` reports the per-card and family aggregates from fixture runs; a card without reviews reports zeros. [R11] [R12]
- 11. `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`, both `card-loop.md` copies (under the byte cap) and `CHANGELOG.md` record the behaviour. [R13]
