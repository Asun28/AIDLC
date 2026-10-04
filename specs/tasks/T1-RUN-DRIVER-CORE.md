---
id: T1-RUN-DRIVER-CORE
title: Bounded CLI driver over existing goal directives and the command-capable provider
status: merged
branch: T1-RUN-DRIVER-CORE
worktree: D:\wt\AIDLC\T1-RUN-DRIVER-CORE
plan_ref: plans/run-driver-core.md#design
allow_paths:
  - src/loop/run-driver.ts
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - tests/scenarios/run-driver.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - README.md
  - CHANGELOG.md
  - specs/tasks/T1-RUN-DRIVER-CORE.md
  - specs/tasks/T1-RUN-DRIVER.md
  - plans/run-driver-core.md
dod_command: npm run check
dod_exit: 0
requirements:
  - R1. The driver shall dispatch one existing goal directive at a time to a command-capable provider, then re-read controller state rather than treating model prose as a report.
  - R2. The driver shall return without dispatch on human gates, review blocks or review quota holds, and bound all waits and provider calls by the remaining deadline and step allowance.
  - R3. The CLI shall print the returned directive and reject invalid limits or a provider incapable of command execution before dispatch.
acceptance:
  - 1. Scenario tests drive plan, project-cards, run-card, verify-arc and close through a scripted provider using existing controller reports, and assert the driver adds no state files beyond those commands. [R1]
  - 2. Tests prove checkpoint, stop, ask, release and done cause no provider call or report; persisted card review blocks and review quota holds stop before another dispatch, including when the goal directive is wait. Ordinary waits poll without provider calls. [R2]
  - 3. Tests prove positive integer max-steps bounds dispatch and polling, an expired goal or card deadline prevents dispatch, each provider timeout is bounded by remaining time, and generation changes prevent continuing stale work. [R2]
  - 4. Tests prove provider quota, refusal, error and malformed results return without retry or fabricated reports; a provider that reports no state progress is bounded by max-steps. The context pack, explicit goal identity and current directive reach the provider. [R1] [R2]
  - 5. CLI scenario tests exercise run help, invalid max-steps, unsupported providers and printed terminal directives; npm run check and npm run build pass. OPERATIONS, README and CHANGELOG describe the command and its gates. [R3]
depends_on: [T1-RUN-CONTEXT-PACK-2]
budget: 1000
tdd: true
sweep: "Inspected controller.next/report, directive schemas, providerFor, ClaudeCodeProvider, ClaudeApiProvider and MockProvider. next owns derived transitions and board writes; Claude Code alone executes tools. Split R1 from T1-RUN-DRIVER while telemetry and init surface are owned by other sessions. Remote main has context pack; local main has divergent planning commits."
forbid: [driver-owned state files, synthesizing reports from model prose, automatically approving checkpoints, driver calls that merge or publish, weakening existing review or authorization gates]
non_goals: [board watch, telemetry, text-only provider tool execution, parallel goals, changing existing provider model defaults]
hygiene: "The 2026-10-05 user request delegates all decisions and permits multiple PRs. Independent driver split authorized; W5 source allowance gains at most 260 lines for this card, with measured actual delta retained. Prior reviews and all other sessions' ownership remain unchanged."
doc_sync: docs/OPERATIONS.md, docs/ARCHITECTURE.md, README.md, CHANGELOG.md
---

Deliver T1-RUN-DRIVER R1 independently. The parent retains the watch view and integrated acceptance after telemetry merges. Reviews and CI remain mandatory.

## R3 repair contract

Under the same delegated authority, formal-review F4-F13 require an execution-scoped no-ship mode in the native card runner, enabled only for driver worker subprocesses. Both implicit next-to-ship and explicit scaffold ship must refuse before the adapter or merge-operation intent; normal invocations retain their existing behavior. The driver returns at this boundary. Tests must prove zero ship-adapter calls; complete integration by an external operator between driver invocations, not by merging inside the provider callback. This is a native-command boundary against accidental auto-shipping, not a hostile-code sandbox; the coding provider retains the existing permissions and could deliberately bypass the mode with arbitrary shell code.

The repair also binds child AIDLC_STATE_DIR to the resolved absolute root, detects outstanding ship-review holds independently of pre-review passes, applies outstanding card deadlines during CLOSE, and refuses non-finite deadline parses. Add behavioral regressions for each finding, including real child-process state-root propagation. No persisted schema, existing authorization or review-limit change is permitted. Source cap +260 and total changed-line cap 1000 remain.
