---
slug: card-preflight
title: Find why cards are replaced, on 15 replaced cards and 5 controls, before a reader or an amendment rule is built
author: asun28 (owner)
status: accepted
created: 2026-11-16T02:30:00Z
source: human
---

# Intent: find why cards are replaced, on 15 replaced cards and 5 controls, before a reader or an amendment rule is built
Author: asun28 (owner). Status: accepted.

## Problem
`docs/reliability/baseline.md` (commit e74113d): 93 of 324 card attempts were replaced by a
successor, and 681.21 of 1854.76 USD of attributed list-price spend went to replaced cards.
`bench/outcome/summary.json`, view `summary_superseded_spend`: the 46 superseded cards with
usage cost 14.81 USD each on average. A scratch script over `specs/tasks/` at 35de54fe
(2026-11-16, not committed) compared each of the 101 cards that carry `superseded_by` with its
successor: the successor changed an `acceptance` item in 89 pairs, a `requirements` item in 74,
raised `budget` in 59 and added an `allow_paths` entry in 22.

Those numbers say what changed, not why the card was replaced:

- A changed item is not shown to be the cause. The cause is in the review findings that came
  before the replacement, and the registry does not hold them.
- The `github` ship path compares no diff with the card's `budget` (`docs/OPERATIONS.md`,
  the `budget-over` paragraph), so a raised budget is an estimate that grew, not a gate that
  fired.
- The owner already amends a running card by delegation: commits 74dba070, 64ce6f58, 4178f0a7
  and c04e294c amend T1-REVIEW-FOLLOWUP-ISSUE after its start. No number says how many
  replacements such an amendment would have avoided.

A first plan of 2026-11-16 (commit 33b32e01: a spec, a plan and six cards) built a reader
option on `aidlc cards validate` and measured it on 45 cases. The review of that plan on
2026-11-17 by the coordinator and the Codex gpt-6-astra reviewer, approved by the owner in the
session, withdrew it, because the experiment could not give a decision: a hit counted an item
the successor changed for any reason, naming items at random hit in 42 to 56% of the pairs,
30 cases leave about 18 points either way, and 3 flags among 15 controls is consistent with
a false-flag rate anywhere from about 7 to 45%. The withdrawn files stay in the history at
33b32e01.

## Proposed outcome
1. A committed report, `docs/reliability/replacement-study.md`, on 15 replaced cards drawn at
   random with a recorded seed from the cards that carry `superseded_by` and have a review
   ledger in the state directory, and on 5 first-pass cards as controls.
2. Each replaced card carries two labels that are kept apart: the defect cause (the card's
   contract was wrong; a code defect inside the contract; a finding outside the card) and the
   termination mechanism (the review allowance was used up; a CI stop; an owner decision;
   another).
3. One reader prompt is run by hand on each of the 20 cards, on the registered revision of the
   card against the base its run started from, and each thing it names is adjudicated against
   the labelled cause.
4. The report states the three screening numbers below and, for each replaced card, whether an
   amendment that kept the card's work would plausibly have avoided the replacement, with the
   reason.
5. The owner decides from the report: a prospective trial of the reader on new draft cards, a
   ruling on amendments that keep findings and invalidate only the evidence they touch, both,
   or neither.

## Affected users and systems
The owner and any session that drafts cards; `docs/reliability/`. No source file, no CLI
option and no configuration key changes in this study.

## Constraints
- Screening thresholds, set before the run: the reader gives an actionable, adjudicated
  finding that would have prevented the replacement on at least 5 of the 15 replaced cards;
  at least 80% of its findings are correct; it flags at most 1 of the 5 controls falsely. The
  study stops when a threshold can no longer be met. A reader output that cannot be read is no
  success.
- A pass leads to a prospective trial, never directly to a gate on registration.
- The avoided replacements are reported as plausible, each with its reason; the study measures
  no counterfactual.
- Labels and adjudications are made by the coordinator and by the Codex reviewer
  independently; where they differ the owner rules. A model label alone is not truth
  (`docs/reliability/baseline.md`: the adjudicator's error rate on the owner's sample was 85%).
- The reader runs read-only (Codex with `--sandbox read-only`) from a detached worktree at the
  card's base. At most 20 runs and their repeats, on the Codex subscription.
- No card and no code in this study. A measurement script kept under `_local/`, which is
  gitignored, is neither. What the study leads to is planned afterwards.

## Open questions
- (none)
