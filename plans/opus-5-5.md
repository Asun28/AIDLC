---
slug: opus-5-5
title: Run R3 at an effort that follows the diff, and bring the Claude defaults and prompts in line with the Opus 5.5 guides
spec: specs/opus-5-5.md
size: T1
status: draft
created: 2026-09-23T22:50:00Z
---

# Plan: Run R3 at an effort that follows the diff (from specs/opus-5-5.md)

## 1. Goal and boundaries
R3 runs automatically at an effort chosen per candidate (medium by
default, high for a large or core diff) on Codex as the primary and
Claude Opus 5.5 as the fallback, and the Claude defaults and prompts
follow the Opus 5 and 5.5 guides. Three cards, one PR each. Cut: R2
effort, per-decision effort changes, eval sweeps, archived plans.

## 2. Minimal acceptable loop
T1-OPUS55-R3-2 merged: the next card's R3 dispatch runs Codex with
`-c model_reasoning_effort=medium|high`, or on a Codex quota hold the
Opus fallback with `--effort medium|high`, with the level in the
invocation record. The two later cards are reviewed by it.

## 3. Tech stack
none this version

## 4. Directory structure
none this version

## 4.5 Module design
- `src/core/review-effort.ts` (new): pure level selection from the policy, changed lines and changed paths.
- `src/loop/card-runner.ts`: numstat of the candidate, `{effort}` var, invocation field.
- `src/providers/claude-api.ts`, `src/core/roles.ts`, `src/core/effort.ts`: Opus 5.5 model id, request rules, ladder.
- `src/review/pre-review.ts`, `.claude/agents/`, `.claude/skills/`: prompt text.

## 5. Data model and state machine
One optional field, `ReviewInvocation.effort`. No state machine change.

## 6. Contracts and core interfaces
`formalReview.effort` / `formalReview.fallback.effort`
(`{ default, high?: { minChangedLines, paths } }`), argv `{effort}`.

## Files that change
- src/core/review-effort.ts (new)
- src/config.ts
- src/core/types.ts
- src/loop/card-runner.ts
- aidlc.config.json
- templates/aidlc.config.json
- src/core/roles.ts
- src/core/effort.ts
- src/providers/claude-api.ts
- src/review/pre-review.ts
- .claude/agents/reviewer.md
- .claude/agents/implementer.md
- .claude/skills/aidlc-loop/arc.md
- templates/claude/agents/reviewer.md
- templates/claude/agents/implementer.md
- templates/claude/skills/aidlc-loop/arc.md
- tests/core/review-effort.test.ts (new)
- tests/core/types.test.ts
- tests/core/roles.test.ts
- tests/core/effort.test.ts
- tests/surface/config.test.ts
- tests/surface/providers.test.ts
- tests/surface/pre-review.test.ts
- tests/surface/templates.test.ts
- tests/surface/prose.test.ts
- tests/scenarios/r3-fallback.test.ts
- docs/OPERATIONS.md
- docs/ARCHITECTURE.md
- CHANGELOG.md

## Order of work
1. T1-OPUS55-R3-2 (replaces T1-OPUS55-R3, stopped after two R3 decisions): config field, policy, dispatch, record; this repository's Codex primary and Opus fallback receive `{effort}`.
2. T1-OPUS55-MODELS: model ids, ladder, provider request rules.
3. T1-OPUS55-PROMPTS: end-of-turn rule in the review prompts and reviewer agent; guide audit of the agent and skill files.

## 7. Task split (dependencies and parallel windows)

| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-OPUS55-R3 | MUST | R3 per-candidate effort (medium default, high for large or core diffs) on the Codex primary and the Opus 5.5 fallback (stopped after two R3 decisions; superseded by T1-OPUS55-R3-2) | - | W1 | yes |
| T1-OPUS55-R3-2 | MUST | R3 per-candidate effort (medium default, high for large or core diffs) on the Codex primary and the Opus 5.5 fallback; the review diff undecorated, the counted range pinned by a test, rename sources matched | - | W1 | yes |
| T1-OPUS55-MODELS | MUST | Claude role defaults and API provider on claude-opus-5-5; xhigh on the Claude ladder; only accepted request settings | T1-OPUS55-R3-2 | W2 | - |
| T1-OPUS55-PROMPTS | MUST | review prompts and agents end on the verdict line; agent and skill files audited against the Opus 5 and 5.5 guides | T1-OPUS55-MODELS | W3 | - |

The three cards share `CHANGELOG.md` and `docs/`, so they run one at a
time.

## Risks
- Author and reviewer share the model family while Codex is on a quota
  hold and the Opus fallback reviews (flagged in the spec; accepted).
- `high` on a large diff may approach the 20-minute timeout; the
  threshold is a config value and the timeout is unchanged.
- The skill files have byte caps (tests/surface/templates.test.ts); the
  prompt card must stay under them.
- The prompt byte-equality tests in pre-review.test.ts pin the prompt
  text; changing the text changes their expected values on purpose.

## Proof
- tests/core/review-effort.test.ts (new): the selection table.
- tests/scenarios/r3-fallback.test.ts or a new scenario: argv carries the level; the invocation records it.
- tests/surface/config.test.ts: the repository config and the schema.
- tests/core/roles.test.ts, tests/surface/providers.test.ts: ids, ladder, request shape.
- tests/review or tests/surface prompt tests and templates.test.ts: prompt text and mirrors.

## 10. After merge
none this version (development-only target)
