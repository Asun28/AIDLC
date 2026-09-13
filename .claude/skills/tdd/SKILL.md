---
name: tdd
description: >-
  Test quality reference for a card's RED receipt. Use when about to write
  or change a test for a card in BUILD, or when judging a test against
  REVIEW.md dimensions 6 and 11. Not a router: the loop decides when BUILD
  runs and card-loop.md owns the process rules.
---
# tdd: tests worth keeping

Delta to `card-loop.md` BUILD (RED first, the RED receipt, the diff
budget, never weaken a test). This file says what a test must be.

## A good test
- Observes behaviour through a public interface; a refactor that keeps
  behaviour keeps the test green.
- Reads like a specification: the name states what holds, not how.
- One logical assertion; the expected value comes from an independent
  source (a known literal, a worked example, the `[R<n>]` line), never
  from re-running the code's own arithmetic.

## Seams
A seam is the public boundary the test observes through. The agreed
seams are the card's `acceptance:` items and the public interfaces they
exercise; a bugfix card's `diagnosis:` may add the regression seam.
- No test at a seam the card does not name; a gap is a `[FOLLOW-UP]`,
  not a new test. A missing seam is reported, never invented.
- Prefer the highest existing seam that still isolates the behaviour;
  fewer seams beat more.
- Read the existing tests for that seam once; match their vocabulary and
  placement (new units get new files).

## Anti-patterns (a fake RED)
- Implementation-coupled: mocks internal collaborators, calls private
  functions, asserts call counts or order, verifies through a side
  channel (querying the store instead of the interface). Tell: it breaks
  on a refactor without a behaviour change.
- Tautological: the assertion recomputes the expected value the way the
  code does, so it can never disagree with the code.
- Horizontal slicing: all tests first, then all code. Bulk tests assert
  an imagined shape. Work in vertical slices: one test, one
  implementation, repeat; each test answers what the last cycle taught.

## Mocks
Only at system boundaries: external APIs, network, clock, randomness,
the filesystem when it is the boundary. Never your own modules or
internal collaborators. Inject boundary dependencies as parameters; give
each external operation its own function so a mock returns one shape
(no conditional logic inside a mock). Fixed ISO timestamps, never
`Date.now()`.

## The loop
1. RED: the test fails for the right reason (the assertion, not a typo
   or a missing import). Receipt: `aidlc card attempt <id> --red-receipt
   "<sha>:<test>"` (scaffold ship path: `aidlc card red <id>`).
2. GREEN: the least code inside `allow_paths` that passes; nothing
   speculative for a later test.
3. One slice per cycle. Refactoring is review work (R2/R3 findings), not
   part of the cycle.
A wrong test is corrected with evidence and re-run RED, never weakened,
skipped or deleted to go green.

Adapted from mattpocock/skills (MIT, (c) 2026 Matt Pocock); notice in
docs/THIRD-PARTY-NOTICES.md.
