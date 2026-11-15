---
id: T1-REVIEW-SEVERITY
title: Every R2 and R3 block reason opens with a [P0], [P1] or [P2] severity tag that the finding record stores, stats count and the bench reports for each hit, and no gate reads
status: todo
superseded_by: T1-REVIEW-SEVERITY-2
branch: T1-REVIEW-SEVERITY
worktree: D:\wt\AIDLC\T1-REVIEW-SEVERITY
plan_ref: plans/review-recall.md#order-of-work
allow_paths:
  - REVIEW.md
  - templates/REVIEW.md
  - aidlc.config.json
  - templates/aidlc.config.json
  - src/core/review-policy.ts
  - src/core/types.ts
  - src/review/pre-review.ts
  - src/review/stats.ts
  - src/review/bench.ts
  - tests/core/finding-severity.test.ts
  - tests/surface/stats.test.ts
  - tests/surface/review-bench.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - specs/tasks/T1-REVIEW-SEVERITY.md
dod_command: npm run typecheck && node --test tests/core/finding-severity.test.ts tests/core/review-policy.test.ts tests/scenarios/pre-existing.test.ts tests/surface/stats.test.ts tests/surface/review-bench.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R1. REVIEW.md shall gain a section `## Severity`, directly after `## What Important means here`, stating that every block reason opens with `[P0]`, `[P1]` or `[P2]` directly after its axis tag; P0 is a finding on dimensions 1 to 6 or a Security finding; P1 is a Bugs finding on a path a normal run reaches that breaks behaviour, a gate, a decision or a persisted record; P2 is every other block reason; a `[question]`, `[suggestion]` or `[pre-existing]` reason carries no severity; and the tag changes no outcome: a cited block reason blocks whatever its severity. templates/REVIEW.md shall stay identical to REVIEW.md.
  - R2. The reason pattern of `VERDICT_CONTRACT` (src/review/pre-review.ts:298-299) shall read `[spec|standards] [P0|P1|P2] <dimension> @ <file:line>: <why> -> <fix>`; nothing else in the contract changes.
  - R3. `findingSeverity(reason: string): 'P0' | 'P1' | 'P2'` (new, src/core/review-policy.ts) shall return the tag when the reason opens with `[P0]`, `[P1]` or `[P2]` (any letter case, leading white space allowed), or with an axis tag `[spec]` or `[standards]` followed by white space and that tag; in every other case, a tag elsewhere in the text included, it shall return `P1`.
  - R4. `ADVISORY_TAG` (src/core/review-policy.ts:261), and so `PRE_EXISTING_TAG` built from it (src/review/pre-review.ts:139), shall accept one optional severity tag of R3's form directly after the optional axis tag. A reason that is advisory or pre-existing on main stays so; `[standards] [P2] [suggestion] x`, `[spec] [P1] @ a.ts:3: [question] y` and `[standards] [P2] [pre-existing] @ a.ts:3: z` are tagged; `[standards] 9 errors [P2] [suggestion] @ a.ts:3: w` is classified as on main.
  - R5. `ReviewFinding` (src/core/types.ts:511-562) shall gain `severity` (optional, `P0` | `P1` | `P2`). `recordFindings` (src/core/review-policy.ts:385-440) shall set it from `findingSeverity` on every finding it creates, in both stages, and leave it unchanged on a re-raise. A record written before this card parses unchanged and has no severity.
  - R6. `FindingStats` (src/review/stats.ts:40-53) shall gain `bySeverity: { P0, P1, P2, none }`, counting the formal findings of a card run by their stored severity, `none` for a finding with none; every other field keeps its value.
  - R7. A bench case result with a `matched` reason (src/review/bench.ts:327-338) shall carry `matched.severity`, the `findingSeverity` of that reason.
  - R8. `reviewPolicyVersion` shall read `REVIEW.md@7` in aidlc.config.json and templates/aidlc.config.json.
  - R9. docs/OPERATIONS.md (the R3 section) and docs/ARCHITECTURE.md (the findings record) shall state R1, R3, R5 and R6, and that no gate reads the severity in this version.
acceptance:
  - 1. `tests/core/finding-severity.test.ts` (new), "T1-REVIEW-SEVERITY acceptance 1: findingSeverity reads the tag at the start or after the axis tag and gives P1 otherwise". Cases: each of P0, P1, P2 with and without each axis tag, lower case, a tag after the dimension, no tag, an empty reason. Fails on main (no export). [R3] [dod arm 1]
  - 2. Same file, "T1-REVIEW-SEVERITY acceptance 2: a severity tag before an advisory or pre-existing tag keeps the reason advisory, and one elsewhere changes nothing". The four reasons of R4 plus every advisory reason the existing tests of tests/core/review-policy.test.ts and tests/scenarios/pre-existing.test.ts name, through `ADVISORY_TAG`, `PRE_EXISTING_TAG` and `citedReasonsOf`. Fails on main for the first three reasons of R4. [R4] [dod arm 1]
  - 3. Same file, "T1-REVIEW-SEVERITY acceptance 3: recordFindings stores the severity of each new finding and keeps it on a re-raise". A block with a `[P0]`, a `[P2]` and an untagged reason, then a re-raise of the `[P2]` finding by a `[P0]` reason. Fails on main by assertion. [R5] [dod arm 1]
  - 4. `tests/surface/stats.test.ts`, new test "T1-REVIEW-SEVERITY acceptance 4: stats count formal findings by severity". One run with findings of each severity and one with none. Fails on main by assertion. [R6] [dod arm 1]
  - 5. `tests/surface/review-bench.test.ts`, new test "T1-REVIEW-SEVERITY acceptance 5: a bench hit carries the severity of its matched reason". Fails on main by assertion. [R7] [dod arm 1]
  - 6. `tests/surface/templates.test.ts`, tests/core/review-policy.test.ts and tests/scenarios/pre-existing.test.ts pass with no line of them changed. [R1] [R4] [dod arm 1]
  - 7. The REVIEW.md section, the contract line, the version and the doc sentences are as R1, R2, R8 and R9 state (reviewer-verified against the diff). [R1] [R2] [R8] [R9]
depends_on: []
budget: 230
tdd: true
sweep: "Main at 0f28b51e. `ADVISORY_TAG` src/core/review-policy.ts:261 (`^\\s*(?:\\[(?:spec|standards)\\]\\s*)?(?:[^@\\n]*?@\\s*[^\\s@:]+(?::\\d+(?:-\\d+)?)?\\s*:\\s*)?\\[(?:question|suggestion)\\]`); `PRE_EXISTING_TAG` src/review/pre-review.ts:139 replaces the `[(?:question|suggestion)]` group of that source and throws at :140 if the replacement does not apply, so the severity group must not change that substring. `findingClass` :266-271 tests `ADVISORY_TAG` first. `VERDICT_CONTRACT` pre-review.ts:298-299; `verdictContract` :308-310. `recordFindings` review-policy.ts:385-440 creates findings at :417-425 (`advisory` and `outsideDelta` set there). `ReviewFinding` types.ts:511-562. `countFindings` stats.ts:287-305, `FindingStats` :40-53. Bench `score` bench.ts:327-338 sets `matched: {reason, file, line}` at :334-336; `BenchCaseResult` :35-49. REVIEW.md and templates/REVIEW.md are identical (no line differs). `REVIEW.md@6` appears in aidlc.config.json:13 and templates/aidlc.config.json:13 only; tests use their own versions. No test pins the text of `VERDICT_CONTRACT` (`git grep -n 'standards] <dimension>' -- tests` prints nothing)."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test
  - a gate, decision, allowance or verdict classification that reads the severity
  - a change to the verdict JSON schema (`VERDICT_SCHEMA`) or to `MAX_R3_DECISIONS`
  - editing .aidlc state by hand
non_goals: [making P2 non-blocking, rounds inside a decision, the follow-up issue, finding identity, a change to CHANGELOG.md (T1-ARMS-REPORT carries the goal's entry)]
hygiene: "Line numbers are from main at 0f28b51e; read them again at PREPARE. The severity group goes between the axis group and the location group of ADVISORY_TAG, so PRE_EXISTING_TAG's replacement still finds `\\[(?:question|suggestion)\\]`."
doc_sync: docs/OPERATIONS.md (R3), docs/ARCHITECTURE.md (findings)
---

# T1-REVIEW-SEVERITY

## Deliverable
Each block reason a reviewer writes opens with a severity tag, and the loop records it on the finding, counts it in `aidlc review stats` and reports it for each bench hit. Nothing decides on it yet.

## Why
The owner's decisions of 2026-11-16 (intent/review-recall.md): rounds inside one R3 decision run only for a block that holds a P0 or P1 finding, and P2 findings may stop blocking only if the bench shows that at most 15% of true-defect hits are P2. Both need the severity recorded first. An untagged reason counts as P1, so a reviewer that ignores the instruction loses nothing.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/finding-severity.test.ts tests/core/review-policy.test.ts tests/scenarios/pre-existing.test.ts tests/surface/stats.test.ts tests/surface/review-bench.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; no existing test line changes.
