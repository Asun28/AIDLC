---
slug: review-coverage
title: Reviewers check the learned invariants and account for every acceptance item
author: asun28 (owner)
status: accepted
created: 2026-09-18T02:05:48Z
source: human
---

# Intent: Reviewers check the learned invariants and account for every acceptance item
Author: asun28 (owner). Status: accepted.

## Problem
Two gaps in the review loop, both visible in this repository's own history.

First, the reviews find the next site of the same defect class one round
at a time. `docs/LESSONS.md` records it: T0-SHIP-BASE-SYNC took four R3
decisions and 12 findings, each the next unencoded site; T0-CARD-TAKEOVER
four decisions and 25 findings, each the next read-then-write window;
T1-REVIEW-FINDINGS eight decisions, each the next store read from a weaker
binding; T0-ARC-EXTERN-DEP a successor card for the second reader of the
fact it fixed. The implementer reads the lessons once at PREPARE; the
reviewers never see them, so a rule the repository has already learned is
rediscovered per site, per round.

Second, the `ac-coverage` pre-review angle is asked, in prose, to name the
code and the test for each acceptance item, and to block on a gap. Its
verdict is one `pass|block` plus reasons; nothing records which items it
accounted for. An item the reviewer skipped looks the same as one it
verified, and the R3 decision then spends itself on "the next untested
claim of the same acceptance list" (T0-ARC-EXTERN-DEP-2 lesson). Nothing
measures how often an R2 pass left items unaccounted before an R3 spec
block.

Source: the GPT6 checked-graph card pack (`AIDLC-Graph-Card-Level-
Implementation-Pack.md`, 18 September 2026), briefs 06 (invariant
packets), 02-04 (evidence contract, coverage shadow, checked join) and 10
(qualification), reduced to what the repository's evidence supports. The
pack's other briefs are cut: 01 (timing: the round and pool-request records
already carry the wait, and T1-REVIEW-STATS measures it), 05 (required
mode: only after the shadow statistics exist), 07 (preflight: the plan and
spec checks and the grilling skill exist), 08 (traceability: card reference
validation exists), 09 (overlap: no measurement).

## Proposed outcome
Every R2 and R3 prompt carries the repository's NEVER and ALWAYS lessons as
an invariant checklist with the instruction to report one finding per site
of a class, so a family of sites is found in one round. The `ac-coverage`
verdict carries one coverage entry per acceptance item (supported,
violated or unknown, with the implementation and test it names); the
panel joins the entries per item across angles, labels an item no angle
reported as unaccounted and one reported both ways as conflicted, and
retains the result on the round without changing the round's outcome
(shadow). `aidlc review stats` reports coverage completeness per round,
per card and per family, and how many R3 spec findings landed on a
candidate whose last R2 round left items unaccounted: the evidence a
later decision on a required mode needs.

## Affected users and systems
`src/review/pre-review.ts`, `src/review/stats.ts`, `src/core/types.ts`,
`src/config.ts`, `src/loop/card-runner.ts`, `src/cli/main.ts`,
`aidlc.config.json` and its template, `docs/ARCHITECTURE.md`,
`docs/OPERATIONS.md`, and every downstream repository on its next
`aidlc init`.

## Constraints
Persisted records gain optional fields only; runs written before this
change parse unchanged. The Codex output schema (`VERDICT_SCHEMA`,
`additionalProperties: false`) is unchanged: coverage is requested from
the pre-review's `ac-coverage` angle only. The round outcome, the R2
rounds cap, the R3 decisions, the effort ladder and the R3 prompt are
unchanged by the coverage record. Lesson text and coverage entries are
data in the prompt and the record, never instructions. No new model call.
Each card ships through the loop's own R2, R3 and GitHub ship.

The scope decision was taken at intake on 2026-09-18: three cards (brief
06; briefs 02-04 merged into one; brief 10 as statistics), the rest cut or
deferred as listed under Problem.

## Open questions
- (none)
