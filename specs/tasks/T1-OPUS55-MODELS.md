---
id: T1-OPUS55-MODELS
title: The Claude role defaults and the Claude API provider use claude-opus-5-5, the Claude effort ladder includes xhigh, and every provider request carries an explicit effort and no setting Opus 5.5 rejects
status: todo
branch: T1-OPUS55-MODELS
worktree: D:\wt\AIDLC\T1-OPUS55-MODELS
allow_paths:
  - src/core/roles.ts
  - src/core/effort.ts
  - src/providers/claude-api.ts
  - tests/core/roles.test.ts
  - tests/core/effort.test.ts
  - tests/surface/providers.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-OPUS55-MODELS.md
dod_command: npm run typecheck && node --test tests/core/roles.test.ts tests/core/effort.test.ts tests/surface/providers.test.ts
dod_exit: 0
requirements:
  - R5. The Claude role defaults and the Claude API provider's default model shall be `claude-opus-5-5`, and the Claude effort ladder shall include `xhigh` between `high` and `max`.
  - R6. The Claude API provider shall send an explicit effort on every request and no setting Opus 5.5 rejects (`thinking` disabled or with a budget, forced `tool_choice`, non-default sampling, an assistant prefill).
acceptance:
  - 1. `DEFAULT_MODELS.claude` names `claude-opus-5-5` for planner, implementer, reviewer and release-specialist and keeps `claude-sonnet-5` for investigator; the comment above it names Opus 5.5 (roles.test.ts). [R5] [dod arm 1]
  - 2. `EFFORT_LADDERS.claude` is `low, medium, high, xhigh, max`; `assessTaskEffort` over it never returns `max` (the top stays escalation headroom), and an episode at baseline `high` escalates to `xhigh`, not `max` (effort.test.ts, roles.test.ts). [R5] [dod arm 1]
  - 3. `ClaudeApiProvider.complete` with no `model` and no `defaultModel` sends `claude-opus-5-5`; the request sent (captured through an injected client) carries `output_config.effort` equal to the request's effort, `thinking` either absent or `{ type: 'adaptive' }`, no `temperature`, `top_p`, `top_k` or `tool_choice`, and a last message whose role is `user` (providers.test.ts). [R5] [R6] [dod arm 1]
  - 4. A response whose first content block is a `thinking` block with empty text, followed by a `text` block, yields the text block's text only; a `stop_reason: "refusal"` yields outcome `refusal` (providers.test.ts). [R6] [dod arm 1]
  - 5. `docs/OPERATIONS.md` and `docs/ARCHITECTURE.md` name `claude-opus-5-5` wherever they name the Claude defaults; CHANGELOG.md Unreleased carries the entry. [R5] [dod arm 1]
depends_on: [T1-OPUS55-R3-2]
plan_ref: plans/opus-5-5.md#7
budget: 250
tdd: true
sweep: "grep -rn 'claude-opus-5\\b\|EFFORT_LADDERS\|output_config\|thinking:' src/ docs/OPERATIONS.md docs/ARCHITECTURE.md: roles.ts:24-30, claude-api.ts:4 and :63 and :74-75, effort.ts:170"
non_goals: [the R3 reviewer command (T1-OPUS55-R3-2), prompt text (T1-OPUS55-PROMPTS), the gpt family defaults, max_tokens retuning, progress-update display, per-message effort, archived plans under docs/plans]
forbid: [network calls in tests, credentials]
hygiene: "Opus 5.5 rejects thinking disabled, thinking budgets, forced tool_choice, non-default sampling and a prefill (migration guide, read 2026-09-24); the provider sends none today, so acceptance 3 pins that. The provider may need a client injection seam for the test; a seam is the only structural change allowed."
doc_sync: docs/OPERATIONS.md, docs/ARCHITECTURE.md, CHANGELOG.md
---

# T1-OPUS55-MODELS

## Deliverable
The Claude role defaults and the API provider still name `claude-opus-5`. This card moves them to `claude-opus-5-5`, adds `xhigh` to the Claude effort ladder (Opus 5.5 supports all five levels and the guides reserve `max` for measured gains, so an escalation from `high` goes to `xhigh`), and pins with tests that the provider sends an explicit effort and none of the request settings Opus 5.5 rejects.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/roles.test.ts tests/core/effort.test.ts tests/surface/providers.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
