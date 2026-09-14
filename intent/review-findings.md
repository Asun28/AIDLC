---
slug: review-findings
title: Review findings with identity, dispositions and a bounded re-review
author: asun28 (owner)
status: accepted
created: 2026-09-14T03:00:00Z
source: human
---

# Intent: Review findings with identity, dispositions and a bounded re-review
Author: asun28 (owner). Status: accepted.

## Problem
A review block gives the author free-text reasons, and the only recorded
response is a repaired candidate. The same candidate can be re-reviewed
after a block, which spends a round or the last decision without new
information; a truncated diff can still pass; the second round re-reads the
whole diff with no delta; a finding the author disagrees with has no
recorded dispute, so the maker/checker deadlock rule in CLAUDE.md is not
enforced by code. The last two cards of this repository spent about twenty
minutes on one questionable R2 finding, and their second R3 decision was
spent on findings in code unchanged since the first decision; nothing
measures how often that happens. Source: the V2 PR-review workflow
notes (findings as identified candidates with dispositions, SHA-bound
re-review over the delta, coverage never inferred from a truncated input,
metrics before believing a configuration is faster).

## Proposed outcome
Every block reason becomes a finding with a stable id that the next round
names; the author can accept or dispute a finding with a recorded note and
the reviewer sees the note; a candidate already blocked is never re-reviewed
unchanged unless every open finding is disputed; a finding re-raised after
two disputes stops the card for a human ruling; a diff over the byte cap is
never sent; every verdict records the policy hash it was judged under; round
two and decision two receive the delta since the last reviewed candidate and
findings outside that delta are labelled first-round-miss; questions and
suggestions have their own tags and never block; `aidlc review stats`
reports rounds, blocks, durations, disputes and first-round misses per card
and across a superseded card family.

## Affected users and systems
`src/review/pre-review.ts`, `src/core/review-policy.ts`, `src/core/types.ts`,
`src/loop/card-runner.ts`, `src/cli/main.ts`, `REVIEW.md` and its template,
the aidlc-loop skill text, `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`,
and every downstream repository on its next `aidlc init`.

## Constraints
Persisted records gain defaulted fields only; runs written before this
change parse unchanged. The R2 rounds cap, the two R3 decisions and the
effort ladder are unchanged. The Codex output schema stays a superset of
the current verdict document. `card-loop.md` has 12 bytes of headroom under
its cap. Each card ships through the loop's own R2, R3 and GitHub ship.

## Open questions
- (none)
