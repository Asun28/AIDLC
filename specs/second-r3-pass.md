# Spec: a second R3 pass with matched rules

## Problem
R3 is now the only review a candidate gets: `preReview.command` is empty on main. One R3 pass finds about half of the known defects, and a repeat with identical rules changed the result on 5 of 20 cases.

The replay on 2026-11-07 ran 60 reviews on 20 confirmed bug cases and 20 on 10 confirmed clean cases, with codex, on one commit, using only the rules that existed at each case's base. The results are in `_local/bench-step4/` and the confirmed cases are in `evals/review/`.

| | One pass, newest rules | Two passes, newest then matched |
|---|---|---|
| Known defects caught | 9 to 10 of 20 | 13 to 14 of 20 |
| Clean cases blocked | 1 of 10 | 2 of 10 |

Replacing the newest rules with matched rules gained nothing: 9 of 20 against 10. Two runs of the newest rules caught 12 of 20, so a second pass with matched rules caught 1 or 2 more than a second pass with the same rules.

## Accepted behaviour
- With `formalReview.secondPass` on, the first R3 pass of a card run does not admit the ship. One more R3 runs on the same candidate, with the rules that best match its diff, and with no delta and no advisory notes, so it does not read as a follow-up to the first pass.
- A pass hands the candidate to the ship and spends no R3 decision.
- A block is an R3 block: the card goes to REVIEW_FIX, it spends a decision, and the repaired candidate needs one R3 pass.
- A card run gets at most one second pass, so a card costs at most one extra review.
- `aidlc review stats` reports second-pass decisions and blocks, so the option can be judged on real cards.
- The option is on in this repository and off in the template.

## Out of scope
- Replacing the newest rules in the first pass.
- Re-running the replay as part of these cards.
- The ship-path reviewer (`formalReview.command` empty), R2, and a second pass that uses another model.
- Skipping the second pass by card size.
