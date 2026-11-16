---
slug: card-preflight
title: Measure why cards are replaced and check a draft card against main before it is registered
author: asun28 (owner)
status: draft
created: 2026-11-16T02:30:00Z
source: human
---

# Intent: measure why cards are replaced and check a draft card against main before registration
Author: asun28 (owner). Status: draft.

## Problem
`docs/reliability/baseline.md` (commit e74113d): 93 of 324 card attempts were replaced by a
successor, and 681.21 of 1854.76 USD of attributed list-price spend went to replaced cards. An
outside review of 2026-11-16 attributes the replacements to card text and proposes
deterministic checks of paths. A scratch script over `specs/tasks/` at 35de54fe (2026-11-16,
not committed) compared each of the 101 cards that carry `superseded_by` with its successor:

- The successor changed an `acceptance` item in 89 pairs and a `requirements` item in 74.
- It raised `budget` in 59 pairs and lowered it in 5.
- It added an `allow_paths` entry in 22 pairs (a test path in 17, a `src/` path in 12). Of the
  46 added paths, the predecessor's own text already named 5.
- 2 pairs differ in none of these fields (10 by the repository's card parser).

So a check that a path a card names is inside `allow_paths` would have applied to 5 added
paths, while the acceptance text changed in 89 of 101 replacements. In the baseline, 124 of
the 146 labelled blocking findings with an agreed or owner label are true defects (192 of the
252 labelled rows come from replaced cards), so the text usually changed after review found
real gaps. `docs/LESSONS.md` records a second reader checking a draft card against main before
any code and finding blocking points on T0-BANDS-RULES-REFUSE and T0-AUDIT-DOC-TRUTH. That
check is done by hand and no number says how often it finds what a successor later changed.

## Proposed outcome
1. A committed table of what each successor changed against the card it replaced, recomputed
   from `specs/tasks/` by a test. The outcome summary holds stop reasons as totals only, so the
   table carries none per card.
2. `aidlc cards validate --card <id> --reader` runs one read-only reader on a draft card
   against the checkout and prints each sentence about existing code, or each acceptance or
   requirement item, that the code does not support, with `file:line` and the item it is in.
3. The reader is run on a committed case set of replaced cards and first-pass cards, and the
   result is reported against the keep rule below before anything gates on it.

## Affected users and systems
The owner and any session that drafts cards; `src/review/` (reader prompt and run),
`src/cli/main.ts` (one option of `cards validate`), `src/config.ts`, `aidlc.config.json`,
`bench/outcome/`, `docs/reliability/`, `docs/OPERATIONS.md`, `CHANGELOG.md`.

## Constraints
- No new CLI command: the reader is an option of `aidlc cards validate`.
- The reader is read-only and its command is an argv array from the configuration; with no
  command configured the option reports that and exits non-zero.
- The reader gates nothing in this goal. Keep rule (set before the run): on the case set the
  share of replaced cards where it names an item the successor changed is at least 40% and at
  least 20 points above the share that naming as many items at random gives (one item named at
  random hits in 42% of the eligible pairs, two in 56%), and it names anything in at most 3 of
  the 15 first-pass cards. With 30 replaced cards the 95% interval of a share is about 18
  points either way.
- A path rule is not built: measured on 2026-11-16, a rule narrow enough to flag no card in
  the registry's history would have stopped none of the 101 replacements.
- Model labels are not truth: a hit is decided in code by comparing the named item with the
  successor's text.
- Cards of at most 200 changed lines and at most 8 allowed paths.

## Open questions
- (none)
