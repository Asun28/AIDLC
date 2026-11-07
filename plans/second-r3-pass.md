---
slug: second-r3-pass
title: A second R3 pass with matched rules
spec: specs/second-r3-pass.md
size: T1
status: draft
created: 2026-11-07T07:10:00Z
---

# Plan: a second R3 pass with matched rules (from specs/second-r3-pass.md)

## 1. Goal and boundaries
After the first R3 pass of a card run, one more R3 runs on the same candidate with the rules that match its diff. Success: both cards merged with DoD, review and CI green, this repository's `aidlc.config.json` has the option on, and the next card that passes R3 runs the second pass with no manual step.

## 2. Minimal acceptable loop
The selection first, with `aidlc review bench run --rules matched` as its first caller, so the second card builds on code that has already run against real cases.

## Files that change
- T1-LESSON-MATCH: `src/artifacts/lessons.ts` (`matchedLessons`), `src/probes/git.ts` (`commitFiles`), `src/review/pre-review.ts:424` (the sentence on omitted rules), `src/review/bench.ts` and `src/cli/main.ts` (`--rules`), tests, docs.
- T1-R3-SECOND-PASS: `src/config.ts`, `src/core/types.ts` (`ReviewInvocation.secondPass`), `src/loop/card-runner.ts` (gate, allowance, dispatch, ship re-check), `src/review/stats.ts`, both config files, tests, docs.

## Order of work
1. T1-LESSON-MATCH: the selection, reachable from the bench and from no loop path.
2. T1-R3-SECOND-PASS: the gate and the dispatch, off by default, on in this repository in the same card. Depends on 1.

One worker: card 2 reads the API card 1 adds.

## Risks
- The gate is the protocol the fault-point check covers. No new write kind is added: a second pass is an R3 dispatch with one more field. The fault-point test and the skill's sync step run on card 2.
- A dispatch that adds a field to an event can lose it on recovery if the field rides on `extra` (`docs/LESSONS.md`, T0-REVIEW-CANDIDATE-PINS). `secondPass` goes in the persisted event data.
- `shipDrift` reads only the last decision. A pass recorded by another window between the gate and the ship would admit a ship with the second pass due, so it re-checks.
- "Review after 15 cards" in `docs/OPERATIONS.md` compares R3 findings per card with a baseline. A second pass raises that number, so the check has to read second-pass findings separately.
- The replay measured codex on one commit. The first 15 cards with the option on are the real measure.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: `matchedLessons` at the merged commit picks the same rules as `_local/bench-step4/arms.json` arm B for the 30 cases, using the file at each case's base.
- Arc: `aidlc review bench run --stage formal --rules matched --case <id>` on one bug case and one clean case.
- Arc: a scenario run shows a first pass, the second-pass directive, and the ship.
