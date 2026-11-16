---
slug: run-attribution
title: Attribute every model request of a card to that card, bound each worker run, coordinate one goal in code, and choose the implementer model by card
author: asun28 (owner)
status: draft
created: 2026-11-16T02:30:00Z
source: human
---

# Intent: attribute every model request to its card, bound each worker run, coordinate one goal in code, choose the model by card
Author: asun28 (owner). Status: draft.

## Problem
`bench/outcome/summary.json` (commit e74113d) as read by an outside review of 2026-11-16 and
`docs/reliability/baseline.md`:

- 9568 usage requests and 49.1% of tokens are attributed to no card; the cost is a list-price
  estimate that no invoice reconciles.
- By stage, of 1854.76 USD: implement 33.7%, review 30.7%, coordinate 22.0%, subagent 13.6%.
  For merged cards a coordinator request reads 337,715 cached tokens (777,757,100 over 2,303
  requests, view `summary_cost_by_stage`) and costs 0.127 USD at list price, with about 11.5
  such requests per merged attempt (201 merged).
- 7.65 USD is the median cost of a card family, not of a merged card
  (`docs/reliability/baseline.md`, Cost).
- `src/core/roles.ts:27` gives the implementer `claude-opus-5-5`, and
  `.claude/agents/implementer.md` took the session's model: 4,096 of the recorded Claude Code
  requests ran on `claude-fable-5-2` (view `summary_cache_share`). Card T1-IMPLEMENTER-MODEL
  of `plans/loop-throughput.md` names the model in the agent file; no rule picks it by card.
- `runGoal` (`src/loop/run-driver.ts`) starts one `claude -p` per directive with a timeout of
  the remaining deadline (`:84`) and no turn or spend limit; this repository's
  `aidlc.config.json` sets `provider: mock`, so the driver is not what runs its goals and a
  model session does the coordination. Under the driver a worker does not ship: the runner
  answers `wait` on `driver-ship-boundary` (`src/loop/card-runner.ts:1340-1342` on main at
  2ef2bbf4) and an operator session ships.

Checked against the Claude Code documentation on 2026-11-16 (cli-reference, monitoring-usage,
headless, settings): `--max-turns`, `--max-budget-usd`, `--json-schema` and
`--append-system-prompt-file` exist; `CLAUDE_CODE_ENABLE_TELEMETRY=1` with
`OTEL_RESOURCE_ATTRIBUTES=key=value,...` adds custom attributes to every metric and event;
the event `claude_code.api_request` carries `cost_usd`, `model` and the four token counts; the
telemetry variables must be set in the environment that starts `claude`, not in a settings
`env` block.

## Proposed outcome
Part A, which needs no other goal:

1. Each worker the driver starts carries the goal, card, stage and attempt as telemetry
   resource attributes, and the outcome ingest reads the exported events, so a request started
   by the driver is attributed in code.
2. The driver passes a turn limit and a spend limit to each worker from the configuration.
3. A session the driver did not start (the interactive coordinator, the operator session that
   ships) is attributed by its session id and the journal's time window.
4. One goal of this repository runs under `aidlc run` with the Claude Code provider, so code
   coordinates and each directive runs in a new bounded session. Its spend per merged card,
   its family spend and its coordinate and subagent share are reported beside the baseline.

Part B, after card T1-DOD-GATE of `plans/execution-gate.md`:

5. A `run-card` directive names the implementer model: a T0 or T0-bugfix card whose
   `allow_paths` avoid `src/core/`, `src/coordination/` and `src/state/` starts on Sonnet 5.5,
   and a failed loop-run DoD raises the effort and then the model.
6. The review effort and the second R3 pass are chosen by the same card risk.
7. Outcomes 5 and 6 are measured before either becomes the default: first on paired
   adjudicated defect and clean cases of the review bench (`plans/review-recall.md`) and on
   total family spend, by alternating assignment over 30 cards; confirmed regressions after
   merge are a later check.

## Affected users and systems
`src/loop/run-driver.ts`, `src/providers/claude-code.ts`, `src/providers/types.ts`,
`src/loop/directive.ts`, `src/loop/controller.ts`, `src/core/effort.ts`, `src/config.ts`,
`bench/outcome/usage.ts`, `docs/reliability/`, `docs/OPERATIONS.md`.

## Constraints
- Part B starts after card T1-DOD-GATE has merged: a cheaper model is safe only when the
  loop's own DoD run decides a success. Part A does not wait for it (owner approval of
  2026-11-17 of the reviewed plan).
- The second R3 pass stays on until the measurement of outcome 7 is reported. The count of
  bugfix merges that mention a merged card (card T1-OUTCOME-ESCAPED) is a proxy and decides
  nothing here.
- No new provider. An OpenTelemetry collector is optional and local; with none configured the
  driver exports to a file or not at all.
- Cards are written when the goal starts; the cards of part B cite code that T1-DOD-GATE
  changes.

## Open questions
- Which goal runs under `aidlc run` for outcome 4, and with what spend ceiling?
- For outcome 7, does the alternating assignment apply to interactive sessions (the
  implementer subagent's model) or only to workers the driver starts?
