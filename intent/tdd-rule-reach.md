---
slug: tdd-rule-reach
title: The rule to read the tdd skill before writing a test reaches a plain request to add a test
author: asun28 (engineer)
status: proposed
created: 2026-11-09T02:40:00Z
source: monitoring
---

# Intent: The rule to read the tdd skill before writing a test reaches a plain request to add a test
Author: asun28 (engineer). Status: proposed.

## Problem
The agent eval `evals/agent/add-test-reads-tdd-skill.json` (card T1-EVAL-TRANSCRIPT-2) asks the agent to add one test to `tests/surface/providers.test.ts` and checks for a `Read` of `.claude/skills/tdd/SKILL.md`. In the integrated acceptance of goal g-20261107095106-c08940 on main 81c9a48 (2026-11-09) it failed 7 runs of 7: once in `aidlc evals run --dir evals/agent --provider claude-code` and 3 trials on each side of `--variant HEAD~1 --trials 3`. The other two agent cases passed 7 of 7.

The rule "`tdd` before any test" is written only in `.claude/skills/aidlc-loop/SKILL.md` (Companion skills), and in the implementer agent definition for a dispatched card. A plain request to add a test loads neither: the aidlc-loop skill triggers on build, implement, fix or ship requests, and the tdd skill's description limits it to "a test for a card in BUILD". Nothing in CLAUDE.md names the tdd skill.

## Outcome wanted
A session asked to add or change a test reads `.claude/skills/tdd/SKILL.md` first, and the agent eval case passes.

## Measure
`aidlc evals run --dir evals/agent --provider claude-code --variant main --trials 3` from the change: `better` on `agent-add-test-reads-tdd-skill` with no loss on the other two cases (the practice in `docs/OPERATIONS.md`, Evals).

## Open questions
- Where the rule goes: a line in CLAUDE.md and `templates/CLAUDE.aidlc.md` (every downstream repository inherits it), a wider tdd skill description, or both.
- Whether the rule applies to every test change or only to tests in a card's allow_paths.
