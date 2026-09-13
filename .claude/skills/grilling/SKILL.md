---
name: grilling
description: >-
  Question rounds for a T1/T2 intent whose Open questions section is not
  empty, or a T2 plan checkpoint decision only the user can make. Use
  after routing and before the spec is written, or on "grill me". Never
  for T0 work or for facts the agent can look up.
---
# grilling: settle the decisions before the spec

Scope: T1/T2 intake (intent -> spec) and the T2 plan checkpoint. T0 and
T0-bugfix never grill. The router's "ask once" rule for an ambiguous id
and the planner's single sizing question are unchanged.

## The tree and the frontier
Every decision branches into the decisions that depend on it. The
frontier is every decision whose prerequisites are settled: the
questions you can ask now without guessing an answer you have not
heard. Ask the whole frontier in one round; a question that depends on
another open question waits for a later round.

## A round
Number the questions; put the recommended answer first, then the
question and its options. Wait for the answers, recompute the frontier,
ask the next round.

    Q1 <title>
    -> recommended: <answer and the one reason>
    <question body, with options when there are some>

At most three rounds. Anything still open becomes a `[TBD: <closed
question>]` line in the spec (the existing convention), and the plan
check reports it as `needs-clarification`.

## Facts versus decisions
Facts live in files, git, config and tools: look them up, never ask for
them. Decisions (trade-offs, scope, priority, budget, risk appetite)
are the user's: put each one and wait. Never fill a decision with a
default the user did not choose.

## Done
The frontier is empty and nothing is silently assumed. Write the
answers into `intent/<slug>.md` (Open questions resolved) and the spec
(`[SOURCE: ...]` where a number came from an answer). No extra
confirmation step: T1 work proceeds under the goal's authorization; the
T2 confirmation is `aidlc plan approve`.

Adapted from mattpocock/skills (MIT, (c) 2026 Matt Pocock); notice in
docs/THIRD-PARTY-NOTICES.md.
