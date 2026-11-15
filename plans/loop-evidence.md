---
slug: loop-evidence
title: The loop records the DoD it runs
spec: specs/loop-evidence.md
size: T1
status: draft
created: 2026-11-14T08:55:00Z
---

# Plan: loop-run DoD record (from specs/loop-evidence.md)

## 1. Goal and boundaries
`aidlc card attempt --outcome success` runs and records the card's DoD, and the docs and the
implementer agent say so. Success: both cards merged with DoD, R3 and CI green.
Not in this plan: every non-goal of the spec. T1-R3-SUPPORTED-FINDINGS was cancelled by the owner
on 2026-11-15 (spec, preamble). Budget: shared with plans/reliability-baseline-2.md, $450 of model
spend at list price for both goals.

## 2. Minimal acceptable loop
The record first (merged as PR 314, T1-DOD-RECORD-2), then its docs.

## 4.5 Module design
- `src/review/mutants.ts` -> `dodCall`, the DoD call shared with the mutant sweep.
- `src/loop/card-runner.ts`: `recordAttempt` runs it on a success and stores `loopDod`.
- `src/core/types.ts`: the optional record on the attempt.
- `src/cli/main.ts`: the `loopDod=` line of `card status`.

## 6. Contracts and core interfaces
- Attempt record gains the optional `loopDod` (commit, clean, exit or timeout, expected exit,
  duration, output sha256, output tail).

## Files that change
- src/review/mutants.ts
- src/loop/card-runner.ts
- src/core/types.ts
- src/cli/main.ts
- tests/scenarios/dod-record.test.ts (new)
- CHANGELOG.md
- docs/OPERATIONS.md
- docs/ARCHITECTURE.md
- .claude/agents/implementer.md
- templates/claude/agents/implementer.md
- tests/surface/loop-evidence-docs.test.ts (new)

## Order of work
1. T1-DOD-RECORD-2 (replaced T1-DOD-RECORD and carried its candidate): the record. Merged, PR 314.
2. T1-EVIDENCE-DOCS: CHANGELOG, OPERATIONS, ARCHITECTURE and the implementer instruction. Depends
   on 1.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-DOD-RECORD-2 | MUST | `card attempt` runs and records the DoD; no state change | - | - | - |
| T1-EVIDENCE-DOCS | MUST | CHANGELOG, OPERATIONS, ARCHITECTURE and implementer instruction | T1-DOD-RECORD-2 | - | - |

## Risks
- A DoD inside `card attempt` adds minutes per attempt (the summary card's took 208 s). The
  timeout is a constant of 9 minutes so `card attempt` fits in one 10-minute shell call of the
  worker; the docs card tells the worker to set that timeout.
- A process of the DoD can outlive the timeout when its root already exited or when taskkill, ps
  or the tree helper fails (exec.ts); no card of this goal adds cleanup for those cases.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: on the final main, `aidlc card status` of a card attempted after PR 314 prints a
  `loopDod=` line whose exit matches its DoD receipt (T1-OUTCOME-SUMMARY: `exit=0 dod_exit=0
  matches`).

## 10. After merge
none this version (development-only target)
