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

Measured on 2026-11-23 with main at 636a8fb9, for a study of
`github.com/markrussinovich/agent-session-insights` (commit 735792d8; read, not run):

- `bench/outcome/run.ts:44` reads the live session logs on every run, and `writeTables`
  (`bench/outcome/ingest.ts:182-183`) replaces each table, so a run keeps nothing an earlier
  run read. The earliest Claude Code request in this repository's logs is of 2026-10-19; an
  extract of 2026-11-09 kept outside the repository starts on 2026-10-07. The requests before
  2026-10-19 are in that extract and no longer in the logs, and no output names the period a
  run read.
- The usage table carries no request identity (`bench/outcome/ingest.ts:30`). `claudeUsage`
  keys a request by `message.id` and `requestId` (`bench/outcome/usage.ts:85`) and writes
  neither, so two extracts cannot be joined by request.
- A Codex row is the last cumulative `total_token_usage` of its session file
  (`bench/outcome/usage.ts:127`), so a sum over two extracts that hold one session counts its
  tokens twice.
- No table holds what a person typed. The 80 main-session files of this repository
  (2026-10-19 to 2026-11-23) hold 332 inputs, 306 typed and 26 queued, counted by the rule of
  `sources.py:233-245` of that study: a user record of the main session that is no compact
  summary and no meta record and does not start with a task notification, an agent message,
  a system reminder, the continuation notice or the interrupt notice, and a queued command
  marked as a person's.
- 51 of those 332 turns name several cards in the journal and hold 64.5% of the main-session
  tokens, so a turn does not name a card. The card of the last journal event the same session
  wrote at or before a request covers 81.8% of the main-session tokens inside the same turn
  and 88.7% anywhere earlier in the session. These are the shares the rule assigns; nothing
  checks that the card is the right one.

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

Additions to part A, on the owner's word of 2026-11-23 (the study named under Problem):

a. The cost sums are named observed priced subtotals. `summary.json` records, per source, the
   earliest and the latest request the run read, as the coverage the run observed and not as
   a statement that the period is complete.
b. Each run keeps its usage extract under a dated name and never changes it, with the price
   card it used and, on every row, a request identity that names its source. The rows and
   the price card go to a private archive that has a backup, and this repository holds one
   manifest per extract; an extract counts as kept only when the archive copy matches the
   hash in its manifest. A later run joins the kept extracts and the live logs by the
   identity, under the rule of Decisions: a request that a later extract no longer holds
   stays, the later observation of one identity replaces the earlier one and is never added
   to it, and a conflict that cannot be ordered is reported and left out of the subtotals. A
   comparison of two runs uses one price card.
c. A `human_inputs` table holds counts only: session id, time, kind (typed or queued) and a
   deduplication identity, and no text.
d. Before the rule of outcome 3 is adopted, it is compared with attribution rule 4
   (`bench/outcome/README.md:90`) on a sample of requests that the owner labels by hand,
   drawn and judged as Decisions states. The comparison reports the precision of each rule
   and the share of requests each leaves unattributed.

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
`bench/outcome/usage.ts`, `bench/outcome/run.ts`, `bench/outcome/ingest.ts`,
`bench/outcome/README.md`, `docs/reliability/`, `docs/OPERATIONS.md`.

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
- A kept extract and the `human_inputs` table hold no message text.

## Decisions (owner, 2026-11-24, in the session)
The owner replied "apply codex advice" to the advice Codex gpt-6-astra gave on 2026-11-24 on
five points the coordinator session had put to it. The coordinator read every line Codex
cited and found each as described.

- Kept extracts (outcome b). The rows and the price card are stored in a private archive
  that has a backup, and not in this repository, which is public: a row holds a session id,
  a working directory and agent ids, and `bench/outcome/summary.json` holds none of them.
  The repository holds one manifest per extract: a name that names no session and no
  directory, the SHA-256, the schema version, the row count, the observed coverage per
  source and the hash of the price card. A manifest alone recovers no row. The suggestion of
  2026-11-23, rows in a directory git ignores, is withdrawn: it keeps them on one machine,
  which is the loss outcome b answers.
- Identity and conflicts (outcome b). Identical observations count once. A Claude Code
  request is (source, `message.id`, `requestId`), and the later observation by the order or
  the timestamp of its source wins; a line without a `requestId` keeps an identity made of
  its log and its place in it. A Codex session is (source, session id), and the latest valid
  cumulative observation replaces the earlier one. A review log is (source, repository,
  goal, relative log path), and a later total replaces an earlier one only when the later
  file extends the same invocation. A request that a later extract no longer holds stays.
  Counts in conflict are never added, and the larger is never chosen because it is larger. A
  conflict that cannot be ordered (an identity is missing, the order cannot be told, a
  cumulative total falls) is reported, and its identity is left out of the published
  subtotals. The suggestion of 2026-11-23, the record read later wins, is withdrawn: the
  totals would depend on the order of reading.
- The sample (outcome d). 240 main-session requests drawn at random, 80 from each of three
  strata: turns that name no card in the journal, turns that name exactly one, and turns
  that name several. Requests before the first input of a session are audited and reported
  apart. The selection probabilities are kept, the results are weighted back to requests and
  to tokens, and the intervals account for requests that share a session. The rule under
  test is frozen before the labelling starts. The owner labels each request without seeing
  the answer of either rule, as one card, a set of cards, no card or not enough evidence. A
  rule that names one card for a request labelled as a set is wrong there, and the requests
  labelled not enough evidence are reported apart. The coordinator estimates 2 to 4 hours of
  labelling with a view that shows the context of each request; that figure is not measured.
- The figures that decide (outcome d). The rule of outcome 3 is adopted when its precision
  is at least 95% by requests and by tokens, the lower end of each 95% interval is at least
  90%, its precision is at most 2 points below that of rule 4, and it leaves at most 20% of
  requests unattributed and at least 10 points fewer than rule 4. It is dropped when the
  upper end of its precision interval is below 90%, or when it is worse than rule 4 on both
  precision and unattributed share. In every other case it is kept beside rule 4, and rule 4
  stays the default.
- Sessions. `docs/OPERATIONS.md`, Coordinator sessions, stays as written: one coordinator
  session per card until the sample supports a replacement. Goal g-20261123055908-a12102 is
  a recorded exception: on 2026-11-23 one session coordinated both of its cards,
  T1-CARD-WRITER-LESSONS and T1-PACK-KEEP-NEWEST, on the owner's word. The next outcome
  report names that goal, gives its coordinator spend per card as an estimate and leaves the
  shared work unallocated.
- `aidlc intent validate` reads a wrapped question of the list below as one item per line
  (issue 465).

## Open questions
- Which goal runs under `aidlc run` for outcome 4, and with what spend ceiling?
- For outcome 7, does the alternating assignment apply to interactive sessions (the
  implementer subagent's model) or only to workers the driver starts?
- Where is the private archive of outcome b: a private repository or a folder with a backup?
