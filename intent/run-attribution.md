---
slug: run-attribution
title: Attribute every model request of a card to that card, bound each worker run, and choose the implementer model by card
author: asun28 (owner)
status: draft
created: 2026-11-16T02:30:00Z
source: human
---

# Intent: attribute every model request to its card, bound each worker run, choose the model by card
Author: asun28 (owner). Status: draft.

## Problem
`bench/outcome/summary.json` (commit e74113d) as read by an outside review of 2026-11-16 and
`docs/reliability/baseline.md`:

- 9568 usage requests and 49.1% of tokens are attributed to no card; the cost is a list-price
  estimate that no invoice reconciles.
- By stage, of 1854.76 USD: implement 33.7%, review 30.7%, coordinate 22.0%, subagent 13.6%.
  The review computed about 338,000 cached tokens per coordinator request from the same view.
- `src/core/roles.ts:26` gives the implementer `claude-opus-5-5` for every card;
  `.claude/agents/implementer.md` inherits the session's model.
- `runGoal` (`src/loop/run-driver.ts`) starts one `claude -p` per directive with a timeout of
  the remaining deadline (`:84`) and no turn or spend limit; this repository's
  `aidlc.config.json` sets `provider: mock`, so the driver is not what runs its goals.

Checked against the Claude Code documentation on 2026-11-16 (cli-reference, monitoring-usage,
headless, settings): `--max-turns`, `--max-budget-usd`, `--json-schema` and
`--append-system-prompt-file` exist; `CLAUDE_CODE_ENABLE_TELEMETRY=1` with
`OTEL_RESOURCE_ATTRIBUTES=key=value,...` adds custom attributes to every metric and event;
the event `claude_code.api_request` carries `cost_usd`, `model` and the four token counts; the
telemetry variables must be set in the environment that starts `claude`, not in a settings
`env` block.

## Proposed outcome
1. Each worker the driver starts carries the goal, card, stage and attempt as telemetry
   resource attributes, and the outcome ingest reads the exported events, so a request started
   by the driver is attributed in code.
2. The driver passes a turn limit and a spend limit to each worker from the configuration.
3. One goal of this repository runs under `aidlc run` with the Claude Code provider, and the
   coordinate and subagent share of its cost is reported beside the baseline.
4. A `run-card` directive names the implementer model: a T0 or T0-bugfix card whose
   `allow_paths` avoid `src/core/`, `src/coordination/` and `src/state/` starts on Sonnet 5.5,
   a failed loop-run DoD raises the effort and then the model. The rule is measured by
   alternating assignment over 30 cards before it becomes the default.

## Affected users and systems
`src/loop/run-driver.ts`, `src/providers/claude-code.ts`, `src/providers/types.ts`,
`src/loop/directive.ts`, `src/loop/controller.ts`, `src/core/effort.ts`, `src/config.ts`,
`bench/outcome/usage.ts`, `docs/reliability/`, `docs/OPERATIONS.md`.

## Constraints
- Starts after card T1-DOD-GATE of `plans/execution-gate.md` has merged: a cheaper model is
  safe only when the loop's own DoD run decides a success.
- No new provider. An OpenTelemetry collector is optional and local; with none configured the
  driver exports to a file or not at all.
- Cards are written when the goal starts, since they cite code that T1-DOD-GATE changes.

## Open questions
- Which goal runs under `aidlc run` for outcome 3, and with what spend ceiling?
- For outcome 4, does the alternating assignment apply to interactive sessions (the
  implementer subagent's model) or only to workers the driver starts?
- Are sessions that are not started by the driver (the interactive coordinator) attributed by
  session id and time window from the journal, or left unattributed and reported as such?
