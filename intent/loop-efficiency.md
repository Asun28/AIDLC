---
slug: loop-efficiency
title: Cut the measured cost of running the loop and fit it to Claude Opus 5.5 and Sonnet 5.5
author: asun28 (engineer)
status: accepted
created: 2026-10-19T09:30:00Z
source: human
---

# Intent: Cut the measured cost of running the loop and fit it to Claude Opus 5.5 and Sonnet 5.5
Author: asun28 (engineer). Status: accepted.

## Problem
The engineer asked for the loop to be made more efficient, without more
blocking gates or local tests, and to suit Claude Opus 5.5 and Sonnet 5.5,
after a study of google-research/harness2 (Harness², arXiv 2610.14224).
Its main measured result is that on-demand mechanism beats prose that is
paid for on every turn (removing skills cost 5.3 points, scripts 3.7, the
always-on prompt group 1.5), and that refinement should stop when a probe
adds no new evidence rather than at a fixed count.

The loop's own records say where it loses time and tokens. The journal
(121 goals, 157 card runs, 2026-09-10 to 2026-10-14) puts 145 of 209
active card hours in review:

1. R3 allows two decisions; a second block stops the card for a human
   ruling. R3 blocks 61% of its decisions (139/228). 53 STOP/review stops
   cost 39.8 active hours waiting; 20 of them ended in a merge with no
   further review and 27 in a replacement card. 82 of 86 R3 blocks led to
   a real fix, so the blocks are worth acting on; the stop is the cost.
2. R2 (three DeepSeek angles, three rounds per R3 cycle) took 47.6 active
   hours of runtime and 31.6 hours of block loops, yet R3 blocked 129 of
   the 215 candidates R2 had passed. The `coverage: shadow` request never
   changes an outcome (`src/review/pre-review.ts`).
3. 26 R2 rounds ended without a verdict (14 malformed, 8 tool error, 3
   timeout) on 21 runs and cost 16.5 hours: one failed angle discards the
   whole round, and `preReview.fallback` runs only on a quota hold.

The Claude Code transcripts (34 sessions, 5.24 billion tokens, 98.8% cache
reads, so cost follows the number of model calls) show two hooks that
spend turns without enforcing anything:

4. The Stop guard's DoD reminder fired 1,397 times; 95.8% repeated a
   reminder the session already had for the same card, 1,305 fired while a
   background agent was working, and 1,392 forced an extra model turn:
   22.4% of all tokens. The card machine already refuses SHIP without a
   DoD receipt (`src/loop/card-runner.ts`), and the guard never blocks.
5. The routing guard fired on 474 prompts, 33 of them typed by a person;
   the rest were background-agent notifications, cross-session messages,
   scheduled ticks and compaction summaries, routed as new work (for
   example a notification routed as `T1 bugfix target=production`).

Local verification: 394 full-suite runs (435 minutes) in the sessions,
while CI runs the full suite on two operating systems for every candidate;
14 cards used `npm run check` as their DoD.

Models: the R2 fallback (`aidlc.config.json`) and the investigator default
(`src/core/roles.ts`) still name `claude-sonnet-5`. The `run-card`
directive carries an effort level, but nothing hands it to the session or
subagent that implements the card, and no agent file names a model or an
effort, so on Opus 5.5 (default effort `medium`) and Sonnet 5.5 (default
`high` in the API, `medium` in Claude Code) the effort ladder never reaches
the model.

## Proposed outcome
- The Stop guard reminds once per card state and stays quiet while
  background work runs or when it already continued the turn.
- The routing guard ignores prompts a person did not type.
- R3 stops for a ruling when it repeats an unresolved finding (the
  maker/checker deadlock) or at its fourth decision, not at the second
  block; a block of only new findings gets another repair round.
- R2 runs one round per R3 cycle with coverage off; a failed angle is
  rerun alone on the fallback instead of discarding the round.
- Card DoDs run the typecheck and the card's own tests; the full suite
  runs in CI.
- Claude Sonnet 5.5 replaces Sonnet 5; agent files carry a model and an
  effort, and the implementer is started at the directive's effort.

## Affected users and systems
`aidlc.config.json`, `src/core/roles.ts`, `src/hooks/`, `src/core/review-policy.ts`,
`src/core/types.ts`, `src/loop/card-runner.ts`, `src/loop/controller.ts`,
`src/loop/directive.ts`, `src/review/pre-review.ts`, `.claude/agents/`,
`.claude/skills/aidlc-loop/` and their `templates/` mirrors,
`templates/cards/_TEMPLATE.md`, CLAUDE.md, `templates/CLAUDE.aidlc.md`,
`docs/`, `CHANGELOG.md`; every downstream repository on its next
`aidlc init`.

## Constraints
- One card per PR, each in its own worktree; cards run one at a time
  because every card edits `CHANGELOG.md`.
- No new blocking gate and no new local test suite: tests extend the
  existing files and each card's DoD runs only its own test files.
- The maker/checker deadlock rule of CLAUDE.md stays: a finding the author
  disputed and the reviewer raises again stops the card for a ruling.
- No change to the verdict schema, the no-verdict retry allowance, the
  deadlines, quota-hold handling or the production gate.
- The engineer approved the four policy changes (R3 stop rule, R2 rounds
  and coverage, R2 per-angle fallback, targeted DoD) on 2026-10-19.

## Open questions
- (none)
