---
slug: loop-evidence
title: The loop records the DoD it runs, and R3 blocks only on supported findings
spec: specs/loop-evidence.md
size: T1
status: draft
created: 2026-11-14T08:55:00Z
---

# Plan: loop-run DoD record and supported R3 findings (from specs/loop-evidence.md)

## 1. Goal and boundaries
`aidlc card attempt --outcome success` runs and records the card's DoD, and R3 blocks only on
supported findings, checked on the reviewer bench against main's reviewer. Success: three cards
merged with DoD, R3 and CI green; the bench comparison of card 2 decided by the owner.
Not in this plan: every non-goal of the spec. Budget: shared with plans/reliability-baseline-2.md,
$300 of model spend for both goals; this goal's share about $150.

## 2. Minimal acceptable loop
The DoD record first: it changes no state, and it is the mechanism every later loosening of
the review depends on. Then the review text, against the baseline arm. Then the docs.

## 4.5 Module design
- `src/review/mutants.ts` -> a shared DoD runner (command, worktree, timeout, process-tree stop).
- `src/loop/card-runner.ts`: `recordAttempt` calls it on a success and stores the record.
- `src/core/types.ts`: the optional record on the attempt.
- `src/review/pre-review.ts`, `REVIEW.md`, `templates/REVIEW.md`, the reviewer agent files: the
  finding standard.

## 6. Contracts and core interfaces
- Attempt record gains an optional DoD run record (commit, clean, exit or timeout, expected exit,
  duration, output sha256, output tail).
- `reviewPolicyVersion` `REVIEW.md@7`.

## Files that change
- src/review/mutants.ts
- src/loop/card-runner.ts
- src/core/types.ts
- src/cli/main.ts
- tests/scenarios/dod-record.test.ts (new)
- src/review/pre-review.ts
- REVIEW.md
- templates/REVIEW.md
- .claude/agents/reviewer.md
- templates/claude/agents/reviewer.md
- aidlc.config.json
- templates/aidlc.config.json
- tests/surface/pre-review.test.ts
- tests/surface/templates.test.ts
- docs/OPERATIONS.md
- CHANGELOG.md
- docs/ARCHITECTURE.md
- .claude/agents/implementer.md
- templates/claude/agents/implementer.md
- tests/surface/loop-evidence-docs.test.ts (new)

## Order of work
1. T1-DOD-RECORD: the shared runner, the record on a successful attempt, `card status`.
2. T1-R3-SUPPORTED-FINDINGS: the finding standard; bench comparison before SHIP; delivered from
   the main checkout. Depends on 1 and on T1-OUTCOME-REPLAY (plans/reliability-baseline-2.md).
3. T1-EVIDENCE-DOCS: CHANGELOG, OPERATIONS and ARCHITECTURE for 1 and 2. Depends on 1 and 2.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-DOD-RECORD | MUST | `card attempt` runs and records the DoD; no state change | - | W1 | - |
| T1-R3-SUPPORTED-FINDINGS | MUST | supported-finding standard in the prompt and REVIEW.md, REVIEW.md@7 | T1-DOD-RECORD, T1-OUTCOME-REPLAY | - | - |
| T1-EVIDENCE-DOCS | MUST | CHANGELOG, OPERATIONS and ARCHITECTURE entries | T1-DOD-RECORD, T1-R3-SUPPORTED-FINDINGS | - | - |

T1-DOD-RECORD shares window W1 with T1-OUTCOME-FIRST-DECISION or T1-OUTCOME-LABELS of
plans/reliability-baseline-2.md: disjoint paths, at most two workers on the host.

## Risks
- T1-R3-SUPPORTED-FINDINGS lists 10 allowed paths, over the 8 of the intent: the two mirror pairs (REVIEW.md, the reviewer agent), both configs, and tests/surface/templates.test.ts and docs/OPERATIONS.md, which pin `REVIEW.md@6` and must move to `REVIEW.md@7` in the same commit. Recorded as an exception for the owner's approval at the checkpoint.
- A DoD inside `card attempt` adds minutes per attempt and shows slow or flaky DoDs on Windows
  that pasted text hid. The timeout is a constant (9 minutes, so `card attempt` fits in one 10-minute shell call of the worker) this goal; the record says so.
- T1-R3-SUPPORTED-FINDINGS changes the gate that reviews it. Guard: every aidlc command of its run
  from the clean main checkout, main commit and REVIEW.md and config hashes recorded at PREPARE and
  checked before SHIP, no other card between its attempt and its ship, owner approval of the text
  before the run starts.
- The second pass stays on; its effect on the bench is measured, not changed.
- Advisory questions and suggestions pile up. The docs card counts them at goal close; the next
  goal decides from that count and the 14-day revert and main-CI record.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: on the final main, a scratch card run with a passing DoD and one with a failing DoD each
  record the loop-run DoD, and the card state equals the state without the record.
- Arc: `aidlc review bench compare` of the baseline arm and the candidate arm is attached to the
  goal evidence.

## 10. After merge
none this version (development-only target)
