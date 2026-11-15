---
slug: review-recall
title: Find more of a candidate's defects in one R3 decision, measured on the recall baseline before any loop change
author: asun28 (owner)
status: accepted
created: 2026-11-15T10:50:00Z
source: human
---

# Intent: Find more of a candidate's defects in one R3 decision, measured on the recall baseline before any loop change
Author: asun28 (owner). Status: accepted.

## Problem
`docs/reliability/baseline.md` (merged 2026-11-15, commit 05d5e9a) shows
that R3's blocks are mostly real defects and that a third of the cards
need two or more blocks:

- 303 cards with a formal decision; 45.2% passed at decision 1; 33.3% had
  two or more blocks; mean decisions to a pass 1.53.
- Successor rate 28.7% (93 of 324 card attempts); 681.21 USD of
  1854.76 USD attributed spend went to superseded cards.
- 104 of the labelled findings are true defects by two-model agreement;
  the owner's 20-row check of contested findings labelled all 20 true
  defects.
- Recall baseline: 124 bug cases on 57 candidate/base/card triples, 89
  hits, recall 71.8%, one run of main's R3. The set holds no clean case,
  so no false-block rate exists.
- Not measured: repeat blocks, the findings followed by a fix, rulings
  (T1-OUTCOME-HISTORY stopped at R3 decision 4, unmerged).

An outside review of alibaba/open-code-review (OCR, v1.13.10, commit
7e5ce06) proposes, from these numbers, that the work is to find every
defect at decision 1, cut review cost and record what was reviewed, and
withdraws its earlier precision-filter advice (downgrading findings
outside changed hunks, a delete-only fact check, advisory new findings on
unchanged lines from decision 2, blocking only on findings two runs both
raise). OCR's figures come from its owner's own benchmark; they are leads,
not evidence.

## The proposals checked against this repository
| Row | Proposal | What exists here |
| --- | --- | --- |
| P0 | A second round inside one decision: round 2 gets the found findings marked "do not repeat" and looks for misses; stop when a round finds nothing new | Nothing. `formalReview.secondPass` runs one more R3 only after a pass, with matched rules (`plans/second-r3-pass.md`); nothing reruns after a block |
| P0 | A cheap first pass before R3 (OCR quotes 12.7% recall, so a prefilter only) | R2 exists and is off: `preReview.command` is `[]`, `preReview.reviewer` names `deepseek-v4-pro`, the `deepseek` CLI is installed. `aidlc review bench run --stage pre` scores R2 on the replay set |
| P0 | Finding identity in code: path, category, whitespace-normalised quoted code, no model call | Findings link only by the reviewer's `re:F<n>` and the cited file (`src/core/review-policy.ts:237`). Verdict reasons carry `@ <file:line>` and no quoted code |
| P1 | A coverage manifest: each selected file completed, failed, waived or excluded; run state from coverage | A diff above `maxDiffBytes` is refused before dispatch, never cut (`src/review/pre-review.ts:978`); a timeout gives no verdict and fails closed. The "pass after a truncated diff" case does not occur. Missing: no record of which changed files a pass read |
| P1 | Rules by file type, bounded tools | Matched rules exist (T1-LESSON-MATCH, `--rules matched`). Tools are bounded: Codex `--sandbox read-only`, Claude fallback `--tools Read,Grep,Glob`. R3 runs on a subscription, so its token cost is a list-price estimate |
| P1 | Resume with an input/provider/model identity check | Not examined |
| P2 | Old and new side reads | `[pre-existing]` with `changedLineRanges` (T1-REVIEW-PRE-EXISTING) already checks in code that a tagged finding's line is unchanged |
| - | Verdict field order: analysis before verdict | The verdict shape puts `verdict` before `reasons` (`src/review/pre-review.ts:299`) |
| - | Before the gate: smaller cards, executable acceptance, edge cases listed before work | Card authoring rules; not part of R3 |

## Proposed outcome
1. Each candidate change (rounds inside a decision, a DeepSeek R2
   prefilter, analysis-first field order) is run as a bench arm on the
   124 recall cases and reported against the 71.8% baseline before the
   loop changes.
2. A change whose measured result meets the keep rule set in this intent
   is switched on in this repository; one that misses it is recorded as
   measured and dropped.
3. Each formal finding carries an identity computed in code from the
   cited path, its class or dimension and the whitespace-normalised cited
   lines read from the candidate commit, and `aidlc review stats` reports
   repeat findings across decisions by that identity.

## Affected users and systems
`src/review/bench.ts`, `src/review/pre-review.ts`,
`src/core/review-policy.ts`, `src/core/types.ts`,
`src/loop/card-runner.ts`, `src/review/stats.ts`, `src/config.ts`,
`aidlc.config.json` and `templates/aidlc.config.json`, `evals/review/`,
`docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`.

## Constraints
- No change is kept in the loop before its bench arm has run and its
  result is recorded.
- A missing or malformed verdict still fails closed; `MAX_R3_DECISIONS`
  stays 4.
- The precision filters the outside review withdrew are not built.
- OCR figures and the outside review are leads, never evidence.
- Provider and reviewer commands stay argv arrays.

## Decisions (owner, 2026-11-16)
- Scope: finding identity in code; bench arms for rounds inside one R3
  decision, a DeepSeek R2 prefilter and analysis-before-verdict field
  order; a change that meets its keep rule is switched on in this goal.
  Dropped: the coverage manifest and old/new side reads (the table above
  shows why). Later goals: rules by file type and bounded tools, resume
  with an identity check, the card-authoring advice.
- Finding identity records and reports only. `re:F<n>` stays the only
  link that changes which findings a decision resolves.
- 15 clean cases join the replay set: candidates whose R3 decision 1
  passed, that merged, and whose card has no successor.
- Spend: about 100 Codex R3 reviews (subscription, about 1.4 USD each at
  list price) and at most 10 USD billed for DeepSeek; the run stops when
  either is reached. The rounds arm and the field-order arm run on the 25
  replay triples that hold the 35 baseline misses; the R2 arm runs on all
  57 triples; every arm also runs the clean cases.
- Rounds keep rule: rounds 2 and later add hits on at least 6 cases, and
  the median wall time of a blocked decision is at most 2x that of its
  round 1. Round 3 is kept only if it adds at least 2 hits beyond
  round 2.
- Rounds run on every block decision whose block holds a P0 or P1
  finding: a block at decision 2 or 3 also starts a repair round, so it
  names every P0/P1 defect too. Advisory findings and P2 findings are
  logged as follow-ups.
- Severity: the reviewer opens each block reason with `[P0]`, `[P1]` or
  `[P2]` inside the reason text (no verdict schema change). P0 is a
  finding on dimensions 1 to 6 or a Security finding; P1 is a Bugs
  finding a normal run reaches that breaks behaviour or a persisted
  record; P2 is the rest. A block reason with no severity tag counts as
  P1.
- P2 findings stop blocking only after the bench reports the share of
  true-defect cases whose matched finding is P2, and only if that share
  is at most 15%; otherwise P2 findings keep blocking and are logged.
- Follow-up log: when a card ships, the loop files one GitHub issue
  listing that run's advisory and non-blocking findings, labelled
  `review-followup`, and records its number on the run.
- R2 keep rule: R2 hits at least 20% of the 124 bug cases, false-blocks
  at most 2 of the 15 clean cases, and its median review costs at most
  0.30 USD billed.
- Field-order keep rule: at least 3 more hits than the paired round 1 of
  the rounds arm on the same triples, and no added false block on the
  clean cases.

- Two goals (owner, 2026-11-16): this goal holds the measure cards (finding
  identity, severity tags recorded and not gating, 15 clean cases, the
  bench arm options, the arms run and its report) and the follow-up issue
  card, which does not depend on a measurement. Switching a kept change
  on in the loop (rounds, R2, field order, P2 non-blocking) is a second
  goal written from this goal's report. The arc deadline is extended by
  24 h to 2026-11-16T22:48Z.

- Unattended run (owner, 2026-11-16, in the session): the owner is not
  available; the goal runs to its end. When a card stops at R3 and its
  open findings hold no big blocker, each open finding is deferred with
  `aidlc review rule --defer`, its follow-up recorded as a bug or
  follow-up card, and the candidate ships. "Big" is read as P0 or P1 by
  the severity rule above (a reason with no tag is P1); a card that stops
  with an open P0 or P1 finding stays stopped for the owner.
- Delegated decisions (owner, 2026-11-16, in the session): a decision that
  would need the owner during this run is settled by consulting Claude
  Fable 5.2 or by the coordinator's own pick; each is recorded with its
  reason in the commit or card amendment that applies it. This does not
  widen the ruling rule above.

## Open questions
- (none)
