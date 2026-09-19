---
id: T1-REVIEW-STATS
title: aidlc review stats reports rounds, decisions, blocks, durations, findings by disposition, re-raises and first-round misses per card and across a superseded card family
status: merged
branch: T1-REVIEW-STATS
worktree: D:\wt\AIDLC\T1-REVIEW-STATS
allow_paths:
  - src/review/stats.ts
  - src/cli/main.ts
  - tests/surface/stats.test.ts
  - tests/surface/templates.test.ts
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-REVIEW-STATS.md
dod_command: npm run typecheck && node --test tests/surface/stats.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R11. The loop shall report review statistics per card: rounds, decisions, blocks, durations, findings by disposition, re-raises and first-round misses.
  - R12. WHERE a card supersedes earlier cards, the statistics shall include the superseded family's totals.
acceptance:
  - 1. `summarizeReviews(runs, registry)` returns per card `r2` (rounds, blocks, noVerdict, quotaHolds, durationMs, blocksByPerspective), `r3` (decisions, blocks, durationMs), `findings` (total, pre, formal, open, disputed, reraised, firstRoundMiss, resolved) and `wallMs` from the first review request to the last pass, or to the last review when none passed; a card without reviews reports zeros (stats.test.ts). [R11] [dod arm 1]
  - 2. A card that supersedes earlier cards (the `superseded_by` chain in the registry) reports `family` with each predecessor's fields and the family totals (stats.test.ts). [R12] [dod arm 1]
  - 3. `aidlc review stats [--goal <id>] [--card <id>]` prints the summary as JSON when stdout is not a TTY and as one line per card otherwise, through an exported formatter (stats.test.ts). [R11] [dod arm 1]
  - 4. `docs/OPERATIONS.md` documents the command and its fields, `docs/ARCHITECTURE.md` names the module, CHANGELOG.md Unreleased carries the entry (templates.test.ts). [dod arm 1]
depends_on: [T1-REVIEW-INPUTS]
plan_ref: plans/review-findings.md#7
budget: 520
tdd: true
sweep: "grep -rn 'review status\|superseded_by\|PreReviewRound\|ReviewInvocation' src/cli/main.ts src/artifacts/card.ts src/core/types.ts: the review command group, the card registry field, the two ledgers the summary reads"
non_goals: [pruning rules for perspectives, cost accounting, statistics for the scaffold ship-path reviewer, persisting the summary]
doc_sync: docs/OPERATIONS.md (Review statistics), docs/ARCHITECTURE.md (review module), CHANGELOG.md
---

# T1-REVIEW-STATS

## Deliverable
Nothing measures how many rounds, blocks and minutes a card spends in review, how many findings were disputed or re-raised, or how many came from code unchanged since the previous round, so a change to the review configuration cannot be judged. This card adds a pure summary over the card runs and the card registry and the `aidlc review stats` command that prints it per card and across a family of superseded cards.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/stats.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: the stats and template tests pass, including the per-card fields, the zero report, the family totals and the formatter.

## Ruling
R2 passed twice (three perspectives, cycle 0 on 72776fd and cycle 1 on 71081de). R3 blocked twice: decision 1 (codex) on F1 (`--goal` starved the family of predecessor runs from other goals), F2 (the blocking angles were counted in a plain object, so an angle named `constructor` read the prototype) and F3 (`substantiveBlocks` counts only merge-blocking decisions, so an advisory block reported no block); decision 2 (codex) on F4 (an R2 round was measured one reviewer runtime after its request, which leaves out the wait for pool admission), a first-round miss. Every finding was repaired RED-first. The second substantive block stopped the card; under the human ruling of 2026-09-18 F4 was applied and the candidate merged without another review cycle, as PR #22 (squash 1ac3494), with all four CI checks green and the full suite at 671.

Two windows ran this card: the card lease expired during the first build (the 10-minute TTL is not renewed by `card attempt`) and a second session took it over at 23:43Z, which cost the card an hour and a STOP/ownership. The ruling of 2026-09-18 gave the card back to the first session, which finished it.
