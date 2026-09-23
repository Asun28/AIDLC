---
slug: opus-5-5
title: Run R3 at an effort that follows the diff, and bring the Claude defaults and prompts in line with the Opus 5.5 guides
author: asun28 (engineer)
status: accepted
created: 2026-09-23T22:50:00Z
source: human
---

# Intent: Run R3 at an effort that follows the diff, and bring the Claude defaults and prompts in line with the Opus 5.5 guides
Author: asun28 (engineer). Status: accepted.

## Problem
R3 runs on Codex gpt-6-sol with Claude Opus 5.5 as the fallback, the
fallback at `--effort max` for every candidate. The Opus 5.5 guides say that `medium`, the model's
default, matches or beats Opus 5 at `high` on coding work, and that
Opus 5.5 thinks more per turn at `xhigh` and `max`, so those two levels
should be used only where a gain has been measured. A fixed `max` makes
small diffs slow and costly and risks the 20-minute R3 timeout, which
leaves no verdict and spends a decision.

The Claude role defaults (`src/core/roles.ts`) and the API provider
(`src/providers/claude-api.ts`) still name `claude-opus-5`. The agent
prompts, skills and reviewer prompts were written before Opus 5.5 and
were not checked against the Opus 5 and 5.5 prompting guides: for
example, Opus 5.5 can end an unattended turn with a progress note
instead of the requested output, which in a headless reviewer is a
missing verdict.

## Proposed outcome
- Codex gpt-6-sol stays the R3 primary and headless Claude Opus 5.5 the
  fallback; each receives the chosen effort through its own flag.
- The R3 effort is chosen per candidate: `medium` by default, raised to
  `high` for a large diff or a diff that touches the core modules, never
  `low`. The chosen level is recorded with the decision.
- The Claude role defaults and the API provider use `claude-opus-5-5`
  and send only request settings Opus 5.5 accepts.
- The agent prompts, skills and review prompts follow the Opus 5 and
  5.5 prompting guides where a guide names a change that applies here.

## Affected users and systems
`aidlc.config.json` and its template, `src/config.ts`,
`src/loop/card-runner.ts`, `src/core/` (roles, effort, a new review
effort policy), `src/providers/claude-api.ts`, `src/review/pre-review.ts`
(prompts), `.claude/agents/`, `.claude/skills/` and their `templates/`
mirrors, `docs/`, `CHANGELOG.md`; every downstream repository on its next
`aidlc init`.

## Constraints
- Review policy is unchanged: two R3 decisions, the same verdict schema,
  the same read-only reviewer tools.
- The fallback mechanism of T0-R3-FALLBACK-2 is reused, not changed.
- Each card ships as its own PR; no card over about 400 net lines.
- Sources: Prompting Claude Opus 5.5, Prompting Claude Opus 5, Effort
  (recommended levels for Opus 5.5) and the Opus 5.5 migration guide on
  platform.claude.com, read 2026-09-24.

## Open questions
- (none: the engineer chose medium as the default R3 effort, raised
  dynamically, Codex primary and Opus 5.5 fallback)
