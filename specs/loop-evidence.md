---
slug: loop-evidence
title: The loop records the DoD it runs
intent: intent/loop-evidence.md
status: draft
created: 2026-11-14T08:55:00Z
skills_applied: []
---

# Spec: the loop records the DoD it runs
From intent: intent/loop-evidence.md. Status: draft. Skills applied: (none).

On 2026-11-15 the owner cancelled the second half of this spec, the R3 finding standard
(T1-R3-SUPPORTED-FINDINGS): in a blind check of 20 disputed findings the owner labelled all 20
true defects, siding with the reviewer's model family every time, so the loosening it proposed is
not supported by the owner's own judgement (intent, Decisions after the spot check).

## Requirements (EARS)
- R1. WHEN `aidlc card attempt <card> --outcome success` is recorded, the loop shall run the card's
  `dod_command` in the card worktree and store on the attempt the commit, whether the worktree was
  clean, the exit code, the expected exit, the duration, the sha256 of the output and its last
  4 KB.
- R2. The record of R1 shall change no card state, outcome or allowance in this goal; `aidlc card
  status` shall show it and say when the exit differs from `dod_exit`.
- R3. IF the DoD does not end within the timeout, THEN the loop shall stop its process tree with
  the runner's existing tree kill and record a timeout in place of an exit code.
- R4. CHANGELOG.md, docs/OPERATIONS.md and docs/ARCHITECTURE.md shall describe R1 to R3, and the
  implementer agent shall tell the worker to run `card attempt --outcome success` with the shell
  tool's timeout at its 10-minute maximum.

## Design
R1 reuses the DoD call of the mutant sweep (`src/review/mutants.ts`, `dodCall`). The record is an
optional field on the attempt, so records written before it parse unchanged.

## Interfaces and contracts
- New optional field `loopDod` on the card-run attempt record (zod schema in `src/core/types.ts`).

## Data model and migration impact
Additive optional field; no migration.

## Flagged concerns (route to policy owners)
- (none open; the R3 text change was cancelled by the owner on 2026-11-15)

## Non-goals
- A SHIP gate on the loop-run DoD; removing the worker's DoD receipt.
- Any change to the R3 prompt, REVIEW.md or `reviewPolicyVersion`.
- The card contract pin, an `[unstated]` tag, the delta rule, a dimension filter, a two-decision
  cap, removing the second pass.
- A configuration key for the DoD timeout (a constant, 9 minutes).

## Acceptance
- 1. A scenario records a loop-run DoD on a successful attempt, with the fields of R1, and the
  card state is the same as without it. [R1] [R2]
- 2. A scenario with a DoD that runs past the timeout records a timeout and leaves no process. [R3]
- 3. The docs and the implementer agent carry R1 to R4 (surface tests). [R4]
