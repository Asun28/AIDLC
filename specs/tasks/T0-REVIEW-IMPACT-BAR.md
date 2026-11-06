---
id: T0-REVIEW-IMPACT-BAR
title: REVIEW.md states an impact bar, so a defect that needs the user to race their own files, or that can change only a report, is a suggestion and not a block, and states that `gateRequired` makes a `standards` block merge-blocking
status: todo
branch: T0-REVIEW-IMPACT-BAR
worktree: D:\wt\AIDLC\T0-REVIEW-IMPACT-BAR
allow_paths:
  - REVIEW.md
  - templates/REVIEW.md
  - aidlc.config.json
  - templates/aidlc.config.json
  - tests/surface/templates.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-REVIEW-IMPACT-BAR.md
dod_command: npm run typecheck && node --test tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. Both copies of `REVIEW.md` shall carry the section `## Impact bar`, worded as under Deliverable, between `## What Important means here` and `## Cap the nits`.
  - R2. `reviewPolicyVersion` shall be `REVIEW.md@6` in `aidlc.config.json` and `templates/aidlc.config.json`, and `docs/OPERATIONS.md` shall name that version wherever it names the current one.
  - R3. Under `## Two axes, never merged`, both copies shall replace the second sentence on `standards` findings with the text under Deliverable, and no other existing line of `REVIEW.md` shall change.
  - R4. The CHANGELOG Unreleased section shall have an entry naming this card.
acceptance:
  - 1. `tests/surface/templates.test.ts`, a new test: both copies hold the section text of Deliverable, after `## What Important means here` and before `## Cap the nits`. It fails on main. [R1] [dod arm 2]
  - 2. `tests/surface/mirror.test.ts` passes with no change to it, so the two copies are identical. [R1] [dod arm 2]
  - 3. Every assertion that pins the current version reads `REVIEW.md@6`; the sentences recording the moves to `@4` and `@5` stay; no other assertion changes. [R2] [dod arm 2]
  - 4. `git diff --numstat <base> -- REVIEW.md` reports 1 deleted line, the line replaced under R3. [R3]
  - 5. The CHANGELOG Unreleased section has a `T0-REVIEW-IMPACT-BAR` entry and `tests/surface/prose.test.ts` passes. [R4] [dod arm 2]
  - 6. `tests/surface/templates.test.ts`, a new test: both copies hold the `gateRequired` text of Deliverable under `## Two axes, never merged`, and neither holds `they never become a silent merge bar`. It fails on main. [R3] [dod arm 2]
depends_on: []
budget: 80
tdd: true
sweep: "Line numbers checked on main at 111a1c7. `classifyVerdict` (src/core/review-policy.ts:92) sets mergeBlocking to gateRequired, or to a spec block on tier S or an unset tier, so the sentence being replaced holds only without gateRequired; `templates/aidlc.config.json` sets no gateRequired, so the default is false downstream and the new text holds there too. The phrase in src/loop/card-runner.ts:1422 and tests/scenarios/t0-flow.test.ts:518 describes advisory findings and stays. `grep -n 'threat\\|impact\\|who runs' REVIEW.md .claude/agents/reviewer.md src/review/pre-review.ts docs/LESSONS.md` finds nothing, so no reviewer has a stated threat model. `src/review/pre-review.ts:388` puts the whole of REVIEW.md in the prompt with its hash, so the section reaches R2 and R3 with no code change. Current-version pins: tests/surface/templates.test.ts 186, 548, 556, 641, 660, 668, 679 and docs/OPERATIONS.md 253, 255; tests/surface/stats.test.ts uses `REVIEW.md@5` as sample data and stays."
forbid:
  - changing a must-block or should-flag dimension, the Untrusted content section or the output contract
  - changing `gateRequired`, `classifyVerdict` or how a `[suggestion]` reason is read
  - weakening or skipping a test to go green
non_goals:
  - a threat-model field on cards
  - making a should-flag dimension advisory
  - a project-specific threat model, since `aidlc init` installs this file downstream
hygiene: "Source: Anthropic, Building effective agents, on the evaluator-optimizer pattern, which needs clear evaluation criteria. Check after 15 cards with `aidlc review stats`: baseline from 2026-10-20 is R3 decision 1 passing 23 of 52 and 14 stops on 52 cards. Run T0-REVIEW-IMPACT-BAR and T0-R3-STOP-DISPUTED before T0-R2-OFF, so R2's removal is measured against the new R3 numbers."
---

# T0-REVIEW-IMPACT-BAR

## Deliverable
This section, in both copies of `REVIEW.md`:

```markdown
## Impact bar
Applies to Bugs and Security findings, on every dimension. A block names a path a normal run can reach: who supplies the input and what breaks for them. A finding is a `[suggestion]`, not a block, in two cases, unless the card's requirements or `forbid:` name it:
- The defect needs the person running the program, or a process of theirs, to swap, link or race their own files during the run. Concurrent runs the project supports are normal runs, so they are not this case.
- The defect can change only a report or a diagnostic, never a gate, a decision, a persisted record or user data.
A path or content that the diff, a reviewer or an external service supplies is normal-run input and stays untrusted.
```

And this text under `## Two axes, never merged`, where only the last two lines are new:

```markdown
A `spec` block on a Tier-S card stops the ship. `standards` findings are a
second opinion unless the project sets `gateRequired: true`, which makes every
block, on either axis, merge-blocking.
```

## Why
Three human rulings set this bar one card at a time, each after a STOP/review:

| Ruling | Card | Text kept in the card |
|---|---|---|
| 2026-11-05 | T1-VERIFY-MUTANT-GEN-2 | a misread adds or drops mutants, so the forms under Limits stay as stated |
| 2026-11-06 | T1-REVIEW-BENCH-EXPORT | whoever runs the export controls the checkout and the state directory; five of seven reasons left scope |
| 2026-11-06 | T1-VERIFY-MUTANTS | a DoD runs as the user and can write anywhere itself; R14 and R16 are not a sandbox |

Those three chains account for 5 of the 14 stops since 2026-10-20. A keyword match over the 156 R3 block reasons in that period puts about 19 of them in the local race and link class; this is an estimate, not a classification.

`REVIEW.md` says `standards` findings never become a silent merge bar, but `gateRequired: true`, which this repository sets, makes every block merge-blocking, and 24 of the 54 Codex blocks in that period were standards-only. Decided 2026-11-07: they keep blocking here, and the sentence is corrected to match. Behaviour does not change.

## Limits
This text lowers what R3 blocks on, so a real local race can ship as a suggestion. The concurrency sentence keeps two sessions or worktrees in scope, and the last sentence keeps a path committed in a candidate in scope.

## Attempt evidence
- RED on f706d00: `node --test tests/surface/templates.test.ts` exit 1, 9 of 38 tests fail by assertion: the five that pin the current version and the four new ones.
- Acceptance 4: `git diff --numstat origin/main -- REVIEW.md` reports `8	1	REVIEW.md`.
- R3 decision 1, re:F1: with the T1-REVIEW-CLASS-SWEEP clause removed from `docs/OPERATIONS.md`, `tests/surface/templates.test.ts` passes 38 of 38 before the repair and fails 1 after it.
