---
slug: loop-integration
title: Companion skills, lessons and CI gates driven by the loop itself
spec: specs/loop-integration.md
size: T1
status: accepted
created: 2026-09-14T00:00:00Z
---

# Plan: Companion skills, lessons and CI gates driven by the loop itself (from specs/loop-integration.md)

## 1. Goal and boundaries
Make the PR #7 additions machine-driven: skills named by directives, lessons as a closure predicate, the secret scan as a gate, required checks from config. In scope: R1-R8. Cut: nothing. Deferred: R9 (evals under the real provider) until the repository has an ANTHROPIC_API_KEY secret. Success: the three cards merge through the loop's own R2, R3 and GitHub ship, each in one review round.

## 2. Minimal acceptable loop
aidlc goal new with --intent prints skills=; a fresh card's build directive names tdd; a card closes only after a lesson disposition; a PR with a red secret scan stops with reason risk.

## 3. Tech stack
none this version

## 4. Directory structure
none this version

## 4.5 Module design
- src/core/router.ts: computes skills next to modules; formatRouting prints them.
- src/loop/directive.ts and src/loop/controller.ts: directive base carries skills; PLAN names grilling and reads the open questions of the intent.
- src/loop/card-runner.ts: build and prepare directives name their skills; a merge-conflict ship outcome returns to BUILD with the episode reopened; markClosure records a lesson disposition.
- src/artifacts/lessons.ts (new): format, append, read.
- src/core/ci-policy.ts, src/config.ts, src/delivery/github-ship.ts: security class, github config block, absent required check is pending.

## 5. Data model and state machine
none this version

## 6. Contracts and core interfaces
See the spec section Interfaces and contracts; the docs/LESSONS.md line format is frozen.

## Files that change
- src/core/types.ts
- src/core/router.ts
- src/loop/directive.ts
- src/loop/controller.ts
- src/loop/card-runner.ts
- src/cli/main.ts
- src/core/ci-policy.ts
- src/config.ts
- src/delivery/github-ship.ts
- src/artifacts/lessons.ts (new)
- .github/workflows/security-scanners.yml
- templates/github/workflows/security-scanners.yml
- aidlc.config.json
- templates/aidlc.config.json
- tests/core/_fixtures.ts
- tests/core/router.test.ts
- tests/core/types.test.ts
- tests/core/ci-policy.test.ts
- tests/scenarios/t0-flow.test.ts
- tests/scenarios/ci-rerun.test.ts
- tests/scenarios/_harness.ts
- tests/infra/github-ship.test.ts
- tests/surface/hooks.test.ts
- tests/surface/lessons.test.ts (new)
- docs/ARCHITECTURE.md
- docs/OPERATIONS.md
- CHANGELOG.md

## Order of work
1. T1-LOOP-SKILLS: routing and directive skills, PLAN grilling with the open questions of the intent, build and prepare narration, merge-conflict return to BUILD with the episode reopened.
2. T1-LOOP-GATES: blocking secret scan, security CI class, github config block and required-check passthrough.
3. T1-LOOP-LESSONS: lessons artifact, sixth closure predicate, card close lesson flags, prepare context.

## 7. Task split (dependencies and parallel windows)

| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-LOOP-SKILLS | MUST | skills in routing and directives; grilling at PLAN; merge-conflict return to BUILD | - | W1 | - |
| T1-LOOP-GATES | MUST | blocking secret scan; security CI class; required checks from config | T1-LOOP-SKILLS | W2 | - |
| T1-LOOP-LESSONS | MUST | lessons closure predicate; card close lesson flags; prepare context | T1-LOOP-GATES | W3 | - |

## Risks
- The GitHub ship path has scripted-runner tests only; the first live ship may stop with a tooling error that is fixed in place before the next card.
- The three cards share card-runner.ts and types.ts; they run one at a time so no card starts on a moved base.
- Returning to BUILD after a successful attempt must reopen the effort episode or the next attempt throws.

## Proof
- Router and types tests assert skills per size and the defaults.
- Scenario tests assert the build, prepare and close directives and the merge-conflict return with a following attempt accepted.
- CI policy and github-ship tests assert the security class, no rerun, and the absent-check-is-pending rule.
- Lessons tests assert the frozen line format, append-only behaviour and the closure predicate.
- Each card's PR shows the secret scan as a passing required check.

## 10. After merge
none this version (development-only target)
