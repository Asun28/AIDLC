---
slug: loop-evidence
title: The loop records the DoD it runs, and R3 blocks only on supported findings
intent: intent/loop-evidence.md
status: draft
created: 2026-11-14T08:55:00Z
skills_applied: []
---

# Spec: the loop records the DoD it runs, and R3 blocks only on supported findings
From intent: intent/loop-evidence.md. Status: draft. Skills applied: (none).

## Requirements (EARS)
- R1. WHEN `aidlc card attempt <card> --outcome success` is recorded, the loop shall run the card's
  `dod_command` in the card worktree and store on the attempt the commit, whether the worktree was
  clean, the exit code, the expected exit, the duration, the sha256 of the output and its last
  4 KB.
- R2. The record of R1 shall change no card state, outcome or allowance in this goal; `aidlc card
  status` shall show it and say when the exit differs from `dod_exit`.
- R3. IF the DoD does not end within the timeout, THEN the loop shall stop its process tree and
  record a timeout in place of an exit code.
- R4. The reviewer instructions the R3 prompt builder writes, and REVIEW.md, shall not contain
  "actively try to disprove", "when uncertain, block" or "be exhaustive" (card, diff and finding
  text quoted into a prompt are evidence and may contain them), and shall require that a blocking finding cite a file and line of the
  candidate and state either an observable failure (input, then wrong result or crash) or the
  stated requirement, acceptance item or forbid item it breaks; anything else is a question or a
  suggestion and does not block. The hard boundaries (security, secrets, data loss, forbid items,
  frozen paths) keep blocking.
- R5. Before SHIP of the card that makes R4, the bench result of its candidate shall be compared
  with the baseline arm of T1-OUTCOME-REPLAY, and the owner shall decide the card's manual
  acceptance item on that comparison.
- R6. CHANGELOG.md, docs/OPERATIONS.md and docs/ARCHITECTURE.md shall describe R1 to R4.

## Design
R1 reuses the DoD runner of the mutant sweep (`src/review/mutants.ts`) rather than a second one,
through one shared function. The record is an optional field on the attempt, so records written
before it parse unchanged. R4 is a text change in the prompt builder and REVIEW.md, versioned as
`REVIEW.md@7`.

## Interfaces and contracts
- New optional field on the card-run attempt record (zod schema in `src/core/types.ts`).
- `reviewPolicyVersion`: `REVIEW.md@6` becomes `REVIEW.md@7`.

## Data model and migration impact
Additive optional field; no migration.

## Flagged concerns (route to policy owners)
- The owner approves the exact R4 text before T1-R3-SUPPORTED-FINDINGS starts.
- The card of R4 changes the gate that reviews it. Every aidlc command of its run is run from the
  clean main checkout (`node D:\Projects\AIDLC\bin\aidlc.js`), which runs main's code,
  configuration and REVIEW.md until the card merges; the main commit and the sha256 of REVIEW.md
  and aidlc.config.json are recorded at its PREPARE and checked before its SHIP.

## Non-goals
- A SHIP gate on the loop-run DoD; removing the worker's DoD receipt.
- The card contract pin, an `[unstated]` tag, the delta rule, a dimension filter, a two-decision
  cap, removing the second pass.
- A configuration key for the DoD timeout (a constant this goal).

## Acceptance
- 1. A scenario records a loop-run DoD on a successful attempt, with the fields of R1, and the
  card state is the same as without it. [R1] [R2]
- 2. A scenario with a DoD that runs past the timeout records a timeout and leaves no process. [R3]
- 3. A surface test finds none of the three phrases and finds the R4 text in the prompt and in
  REVIEW.md and its template. [R4]
- 4. The bench comparison is attached and the owner has decided it (manual). [R5]
- 5. The docs carry R1 to R4 (surface tests). [R6]
