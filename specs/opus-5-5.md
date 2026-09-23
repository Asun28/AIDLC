---
slug: opus-5-5
title: Run R3 on Claude Opus 5.5 at an effort that follows the diff, and bring the Claude defaults and prompts in line with the Opus 5.5 guides
intent: intent/opus-5-5.md
status: accepted
created: 2026-09-23T22:50:00Z
skills_applied: []
---

# Spec: Run R3 on Claude Opus 5.5 at an effort that follows the diff, and bring the Claude defaults and prompts in line with the Opus 5.5 guides
From intent: intent/opus-5-5.md. Status: accepted. Skills applied: (none).

## Requirements (EARS)
- R1. The formal reviewer config (the primary and the fallback) shall accept an optional `effort` object with `default` and an optional `high` rule (`minChangedLines`, `paths`), whose levels are `medium`, `high`, `xhigh` or `max`.
- R2. WHEN R3 dispatches a reviewer whose argv carries `{effort}`, the loop shall expand it to `high` if the candidate's changed lines (added plus deleted against the base) reach `high.minChangedLines` or a changed path matches `high.paths`, and to `default` otherwise; `default` is `medium` when the object is absent.
- R3. The formal review invocation record shall carry the effort level the decision ran at, when its argv carried `{effort}`.
- R4. This repository's R3 primary shall be headless Claude Opus 5.5 with `--effort {effort}`, and its fallback Codex gpt-6-sol.
- R5. The Claude role defaults and the Claude API provider's default model shall be `claude-opus-5-5`, and the Claude effort ladder shall include `xhigh` between `high` and `max`.
- R6. The Claude API provider shall send an explicit effort on every request and no setting Opus 5.5 rejects (`thinking` disabled or with a budget, forced `tool_choice`, non-default sampling, an assistant prefill).
- R7. The formal and pre-review prompts and the reviewer agent shall state that the reply ends with the verdict JSON line and that a progress note is not an end of the review.
- R8. The agent prompts and skills shall carry the Opus 5 and 5.5 guide changes that apply to them, and no instruction a guide says to remove.

## Design
A pure `selectReviewEffort(policy, { changedLines, changedPaths })` in
`src/core/review-effort.ts` picks the level; `pathAllowed` supplies the
glob match. `card-runner.ts` computes the numstat of the candidate
against the base, adds `effort` to the R3 argv vars and the invocation
record. The fallback uses its own `effort` object, so a Codex fallback
without `{effort}` in its argv is unaffected.

## Interfaces and contracts
- `formalReview.effort` and `formalReview.fallback.effort`:
  `{ "default": "medium", "high": { "minChangedLines": 500, "paths": ["src/core/**"] } }`.
- Argv placeholder `{effort}`, alongside `{schema}` `{cwd}` `{base}` `{head}` `{card}`.
- `ReviewInvocation.effort` (optional; absent on older records).

## Data model and migration impact
One optional field on `ReviewInvocation`; older records parse unchanged.
No migration.

## Flagged concerns (route to policy owners)
- The author sessions and the R3 reviewer are both Claude Opus 5.5. The
  reviewer is a separate headless process with no session, settings or
  MCP servers and read-only tools; `reviewerIndependent` is not
  consulted by the command path. Accepted by the engineer for the period
  Codex is out; restoring Codex as primary restores the cross-family
  review.

## Non-goals
- Changing the effort between decision 1 and decision 2 of one card.
- `low` effort for R3, per-message effort, or effort for R2.
- An effort sweep or eval harness for reviewer levels.
- Rewriting archived plans under `docs/plans/`.

## Acceptance
- 1. The effort policy picks `medium` below the line threshold with no core path, `high` at the threshold or on a core path, and `medium` without a policy. [R1] [R2]
- 2. An R3 dispatch expands `{effort}` in argv and records the level on the invocation. [R2] [R3]
- 3. `aidlc.config.json` runs R3 on Claude Opus 5.5 with `{effort}` and falls back to Codex gpt-6-sol. [R4]
- 4. Role defaults, the provider default model and the ladder follow R5; a provider request carries an explicit effort and no rejected setting. [R5] [R6]
- 5. The review prompts and the reviewer agent carry the end-of-turn rule; the agent and skill files carry the applicable guide changes. [R7] [R8]
