---
id: T0-R2-OFF
title: This repository runs no R2 panel, with `preReview.command` empty and the rest of the block kept, so a candidate goes from DoD to R3 and restoring R2 is one value
status: merged
branch: T0-R2-OFF
worktree: D:\wt\AIDLC\T0-R2-OFF
allow_paths:
  - aidlc.config.json
  - tests/surface/config.test.ts
  - CLAUDE.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - src/review/pre-review.ts
  - specs/tasks/T0-R2-OFF.md
dod_command: npm run typecheck && node --test tests/surface/config.test.ts tests/surface/command-lines.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc.config.json` shall set `preReview.command` to `[]` and shall keep every other `preReview` key unchanged.
  - R2. `CLAUDE.md` under `Review before ship` shall state that SHIP requires an R2 pass only when `preReview.command` is set, that this repository leaves it empty, and that R3 stays required.
  - R3. `docs/OPERATIONS.md` under `## Pre-review (R2)` shall state this repository's setting, the numbers under Why, the value that restores R2 and the check under Review after 15 cards.
  - R4. The CHANGELOG Unreleased section shall have an entry naming this card.
  - R5. The header comment of `src/review/pre-review.ts` shall stop naming DeepSeek as this repository's R2 reviewer and shall keep naming the R3 reviewer and its fallback.
acceptance:
  - 1. `tests/surface/config.test.ts`, the test at line 463, retitled: the raw and parsed `preReview.command` are empty, and reviewer, `answerMarker`, fallback, rounds and the absent coverage key are as on main. It fails on main. [R1] [dod arm 2]
  - 2. `tests/surface/command-lines.test.ts` and the other tests of `tests/surface/config.test.ts` pass with no change, apart from the two assertions at lines 140 and 141 of that file, which pin the sentences R2 and R5 rewrite: each keeps pinning the R3 reviewer and its fallback and no longer pins DeepSeek. [R1] [R2] [R5] [dod arm 2]
  - 3. `CLAUDE.md` contains `only when \`preReview.command\` is set`, and `docs/OPERATIONS.md` contains the restore value `["deepseek", "--model", "deepseek-v4-pro"]` in `## Pre-review (R2)`. [R2] [R3]
  - 4. The CHANGELOG Unreleased section has a `T0-R2-OFF` entry and `tests/surface/prose.test.ts` passes. [R4] [dod arm 2]
depends_on: []
budget: 60
tdd: true
sweep: "Line numbers checked on main at 111a1c7. `preReviewEligibility` (src/loop/card-runner.ts:297) returns eligible with `pre-review not configured` on an empty command, and card-loop.md already reads `Pre-review (R2) when preReview.command is set`, so no code or skill text changes. `ProjectConfig.safeParse` accepts the config with an empty command and the fallback kept (run on 713dee1). `templates/aidlc.config.json` already ships `command: []`, so downstream repositories are unaffected. In a scratch copy with the empty command, config, command-lines, templates, mirror and init tests ran and only tests/surface/config.test.ts:463 failed, the pin of this repository's R2 primary. tests/surface/pre-review.test.ts and tests/surface/stats.test.ts were not part of that run; run them once at SHIP. On main at 50ef58c, tests/surface/config.test.ts:140 pins the CLAUDE.md sentence naming DeepSeek for R2 and :141 pins the same claim in the header comment of src/review/pre-review.ts, so both assertions change with the text they pin. docs/PROJECT-STATE.md is a snapshot dated 2026-09-18 and stays."
forbid:
  - deleting or changing the code of `src/review/pre-review.ts`, beyond the header comment R5 names, or the panel, `preReview.fallback` or R2 tests
  - changing R3, `formalReview`, `gateRequired` or the required checks
  - changing `templates/aidlc.config.json`
  - weakening or skipping a test to go green
non_goals:
  - removing R2 code
  - a routing rule that runs R2 on some cards
  - fewer angles
hygiene: "Source: Anthropic, Building effective agents: add complexity only when it demonstrably improves outcomes. Reversible by one value. PR 204 also edits CLAUDE.md: whichever lands second merges the base. Run this card after T0-REVIEW-IMPACT-BAR and T0-R3-STOP-DISPUTED."
---

# T0-R2-OFF

## Deliverable
`preReview.command` becomes `[]` in `aidlc.config.json`. R3 stays as it is.

## Why
Measured from the journal and `aidlc review stats`, 2026-10-20 to 2026-11-06, 52 cards:

| | R2 (DeepSeek panel) | R3 (Codex) |
|---|---|---|
| Runs | 102 rounds | 106 decisions |
| Reviewer run time | 12.6 h | 3.6 h |
| Findings | 14 | 138 |

R2's verdict does not predict R3's:

| R2 result before the R3 decision | R3 pass | R3 block |
|---|---|---|
| clean | 45 | 48 |
| findings | 6 | 7 |

With `rounds: 1` and `onExhausted: ship`, an R2 block already hands its findings on to R3 and stops nothing, so R2 is advisory here.

## Limits
- These numbers do not show whether R3 would have caught R2's 14 findings. Some were real: T1-REVIEW-BENCH-2 had an acceptance item not implemented. Only 4 of the 12 R2 blocks were followed by an R3 decision citing the same file.
- R2 is a second model family, so removing it loses that independent view.
- Worst case on these numbers: up to 12 more R3 rounds over 52 cards, against 12.6 h and 102 runs saved.

## Review after 15 cards
Run `aidlc review stats` and compare with the baseline above, after T0-REVIEW-IMPACT-BAR and T0-R3-STOP-DISPUTED have landed: R3 decision 1 pass rate (23 of 52), stops per card (14 of 52), R3 findings per card (138 of 52). Restore R2 if the decision 1 pass rate drops by more than 10 points.
