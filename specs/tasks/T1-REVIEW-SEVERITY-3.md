---
id: T1-REVIEW-SEVERITY-3
title: (replaces T1-REVIEW-SEVERITY-2 and carries its candidate) Every R2 and R3 block reason opens with a [P0], [P1] or [P2] severity tag that the finding record stores, stats count and the bench reports for each hit, and no gate reads
status: todo
branch: T1-REVIEW-SEVERITY-3
worktree: D:\wt\AIDLC\T1-REVIEW-SEVERITY-3
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
  - tests/core/review-policy.test.ts
  - tests/surface/stats.test.ts
  - tests/surface/review-bench.test.ts
  - tests/surface/templates.test.ts
  - tests/surface/pre-review.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - specs/tasks/T1-REVIEW-SEVERITY-3.md
dod_command: npm run typecheck && node --test tests/core/finding-severity.test.ts tests/core/review-policy.test.ts tests/scenarios/pre-existing.test.ts tests/surface/stats.test.ts tests/surface/review-bench.test.ts tests/surface/templates.test.ts tests/surface/pre-review.test.ts
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
  - R9. docs/OPERATIONS.md (the R3 section) and docs/ARCHITECTURE.md (the findings record) shall state R1, R3, R5 and R6, and that no gate reads the severity in this version; the OPERATIONS.md sentence that names `reviewPolicyVersion` as `REVIEW.md@6` in both configs shall name `REVIEW.md@7`.
  - R10. The existing assertions that pin the shapes R5 to R8 and R9 change shall change their expected literal to the new shape or text and nothing else: at candidate 42abbcbe, tests/core/review-policy.test.ts:674-675 (`asMain`, R5), tests/surface/stats.test.ts:131, 141, 177 and 549 (the `findings` deepEqual, R6), tests/surface/review-bench.test.ts:177 (`matched`, R7), tests/surface/templates.test.ts:202, 563 and 675 (`'REVIEW.md@6'`, R8) and :571, :683, :694 and :746 (the OPERATIONS.md sentence, R9; `@6` becomes `@7`) and :741 (the version-history clause of that sentence, which becomes two array elements on that one line, `'(card T1-REVIEW-SEVERITY added the severity section;'` and `' T0-REVIEW-IMPACT-BAR moved it to `REVIEW.md@6` with the impact bar;'`, so the loop that removes each clause still removes them one at a time). Each stays an exact comparison of the same value.
  - R11. In tests/surface/pre-review.test.ts, `withoutAddedSentences` (:1155-1157 at candidate 3edf4987) shall also put the reason pattern of R2 back as it read before (`[spec|standards] [P0|P1|P2] <dimension>` becomes `[spec|standards] <dimension>`), through a constant `SEVERITY_PATTERN = { now, before }` beside `DECISIONS_CLAUSE` and one more `.replace` in the chain, and its doc comment shall name T1-REVIEW-SEVERITY among the cards whose wording it removes; the six `PRE_CHANGE` hashes (:869-876) and every other line of the file stay unchanged, so the pinned prompts stay byte-equal apart from the named additions. This is the method T1-OPUS55-PROMPTS, T0-R2-PASS-NOTES and T1-EFF-R3-PROGRESS-2 used for their wording.
acceptance:
  - 1. `tests/core/finding-severity.test.ts` (new), "T1-REVIEW-SEVERITY acceptance 1: findingSeverity reads the tag at the start or after the axis tag and gives P1 otherwise". Cases: each of P0, P1, P2 with and without each axis tag, lower case, a tag after the dimension, no tag, an empty reason. Fails on main (no export). [R3] [dod arm 1]
  - 2. Same file, "T1-REVIEW-SEVERITY acceptance 2: a severity tag before an advisory or pre-existing tag keeps the reason advisory, and one elsewhere changes nothing". The four reasons of R4 plus every advisory reason the existing tests of tests/core/review-policy.test.ts and tests/scenarios/pre-existing.test.ts name, through `ADVISORY_TAG`, `PRE_EXISTING_TAG` and `citedReasonsOf`. Fails on main for `[standards] [P2] [suggestion] x` and `[standards] [P2] [pre-existing] @ a.ts:3: z`; `[spec] [P1] @ a.ts:3: [question] y` is advisory on main already, since the location group absorbs `[P1] `. [R4] [dod arm 1]
  - 3. Same file, "T1-REVIEW-SEVERITY acceptance 3: recordFindings stores the severity of each new finding and keeps it on a re-raise". Fails on main by assertion. [R5] [dod arm 1]
  - 4. `tests/surface/stats.test.ts`, new test "T1-REVIEW-SEVERITY acceptance 4: stats count formal findings by severity". Fails on main by assertion. [R6] [dod arm 1]
  - 5. `tests/surface/review-bench.test.ts`, new test "T1-REVIEW-SEVERITY acceptance 5: a bench hit carries the severity of its matched reason". Fails on main by assertion. [R7] [dod arm 1]
  - 6. tests/core/review-policy.test.ts, tests/surface/templates.test.ts, tests/surface/stats.test.ts, tests/surface/review-bench.test.ts and tests/scenarios/pre-existing.test.ts pass with no line changed other than the expected literals of R10 (`git diff main -- <file>` shows only those and the new tests of acceptance 4 and 5). [R4] [R10] [dod arm 1]
  - 7. `tests/surface/pre-review.test.ts` passes, "T1-REVIEW-COVERAGE R3 decision 1 (F2): the off prompts are byte-equal to the pre-change prompts ..." included, with only the lines of R11 changed (`git diff main -- tests/surface/pre-review.test.ts`). It fails at candidate 3edf4987 (CI run 43757539597: `pre/single with coverage off is the pre-change prompt`). [R2] [R11] [dod arm 1]
  - 8. The REVIEW.md section, the contract line, the version and the doc sentences are as R1, R2, R8 and R9 state (reviewer-verified against the diff). [R1] [R2] [R8] [R9]
depends_on: []
budget: 250
tdd: true
sweep: "Carried candidate 3edf4987 of T1-REVIEW-SEVERITY-2: R3 decision 1 blocked (F1 severity-prefix-whitespace, F2 pre-existing-citation-coverage, F3 incomplete-severity-documentation), all repaired; decision 2 and the second pass passed; CI run 43757539597 on PR 334 failed 1 of 3719 tests, tests/surface/pre-review.test.ts:863, whose pinned prompt hashes the R2 contract line changes, and the effort ladder of T1-REVIEW-SEVERITY-2 admitted no repair. Before that, carried candidate 42abbcbe of T1-REVIEW-SEVERITY (RED 9511700e): every requirement R1 to R9 implemented, the five new acceptance tests pass, and its DoD exited 1 with 154 tests, 145 pass, 9 fail, each failure one of the R10 assertions, which T1-REVIEW-SEVERITY forbade changing. The R10 line numbers are those at 42abbcbe. Main at 31939a9e otherwise as T1-REVIEW-SEVERITY's sweep states."
forbid:
  - changing a `PRE_CHANGE` hash of tests/surface/pre-review.test.ts
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test other than the expected literals R10 names
  - a gate, decision, allowance or verdict classification that reads the severity
  - a change to the verdict JSON schema (`VERDICT_SCHEMA`) or to `MAX_R3_DECISIONS`
  - editing .aidlc state by hand
non_goals: [making P2 non-blocking, rounds inside a decision, the follow-up issue, finding identity, a change to CHANGELOG.md (T1-ARMS-REPORT carries the goal's entry)]
hygiene: "The branch starts at 3edf4987, the head of branch T1-REVIEW-SEVERITY-2; RED commit 9511700e is the RED of this card, and 80f4dc69 the RED of the F1 repair. Run `npm run check` (typecheck and the full suite, as CI runs it) in the worktree before recording the attempt and put its totals in the Attempt evidence: the narrow DoD of the predecessor missed the hash pin. The acceptance test names keep the T1-REVIEW-SEVERITY prefix the carried tests already use."
doc_sync: docs/OPERATIONS.md (R3), docs/ARCHITECTURE.md (findings)
---

# T1-REVIEW-SEVERITY-3

## Deliverable
Each block reason a reviewer writes opens with a severity tag, and the loop records it on the finding, counts it in `aidlc review stats` and reports it for each bench hit. Nothing decides on it yet.

## Why
T1-REVIEW-SEVERITY-2 passed R3 at decision 2 and its second pass, and CI failed one test outside its DoD: tests/surface/pre-review.test.ts pins the hashes of the review prompts, and the R2 contract line changes them. That test removes each wording a card adds on purpose before it compares (`withoutAddedSentences`); this card adds the severity tag to that list (R11). The predecessor's effort ladder had no attempt left (attempt 2 was withdrawn for a file outside allow_paths), so this card carries its candidate. Decided by the coordinating session under the owner's instruction of 2026-11-16 to pick answers while away.

Before that, T1-REVIEW-SEVERITY required new fields on three records and a policy version bump, and also forbade changing the existing assertions that pin those records and that version, so no candidate could pass its DoD (attempt 1, candidate 42abbcbe, 9 failures, all such pins). This card carries that candidate and names the pinned literals that change. Decided by the coordinating session under the owner's instruction of 2026-11-16 to pick answers while away (intent/review-recall.md). The reason for the feature is unchanged: rounds inside one R3 decision run only for a P0 or P1 block, and P2 may stop blocking only if the bench shows at most 15% of true-defect hits are P2.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/finding-severity.test.ts tests/core/review-policy.test.ts tests/scenarios/pre-existing.test.ts tests/surface/stats.test.ts tests/surface/review-bench.test.ts tests/surface/templates.test.ts tests/surface/pre-review.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; the only changed lines of existing tests are the R10 literals.

## Attempt evidence

Attempt 1 (effort medium), carrying candidate 3edf4987 of T1-REVIEW-SEVERITY-2 (R3 decision 2 and the second pass passed there; CI run 43757539597 failed tests/surface/pre-review.test.ts:863).

RED:
- Commit `9511700e` adds acceptance tests 1 to 5; on main they fail as stated: acceptance 1 `TypeError: policy.findingSeverity is not a function`; acceptance 2 `AssertionError: ADVISORY_TAG: [standards] [P2] [suggestion] x` (actual false); acceptance 3 `AssertionError: pre: severity of each new finding` (actual `[['F1', undefined], ...]`); acceptance 4 `AssertionError: the formal findings by stored severity; ...` (actual undefined); acceptance 5 `AssertionError` (actual `[['a-tagged', 'hit', undefined], ['b-untagged', 'hit', undefined]]`).
- Commit `80f4dc69` (repair of R3 decision 1 F1 on T1-REVIEW-SEVERITY-2): acceptance 2 failed with `AssertionError: ADVISORY_TAG: [standards][P2] [suggestion] @ src/a.ts:3: broken -> fix` (actual true, expected false).
- Acceptance 7 at the carried candidate 08fa9fa6 (3edf4987 plus main): `AssertionError: pre/single with coverage off is the pre-change prompt`, actual `8f62e0bc...`, expected `727bbd90...`, as in CI.

R11: `VERDICT_CONTRACT` is emitted once per prompt (src/review/pre-review.ts:409, `verdictContract(coverage)`), and neither REVIEW.md copy nor the test fixture holds `[P0|P1|P2]`, so the one `.replace` puts the pattern back in every pinned prompt; the six `PRE_CHANGE` hashes are unchanged.

| Item | Proof | Result |
| --- | --- | --- |
| 1 | tests/core/finding-severity.test.ts, acceptance 1 | pass |
| 2 | tests/core/finding-severity.test.ts, acceptance 2 | pass |
| 3 | tests/core/finding-severity.test.ts, acceptance 3 | pass |
| 4 | tests/surface/stats.test.ts, acceptance 4 | pass |
| 5 | tests/surface/review-bench.test.ts, acceptance 5 | pass |
| 6 | DoD: review-policy, templates, stats, review-bench and pre-existing test files | pass |
| 6 | `git diff main -- <file>`: review-policy.test.ts :674; stats.test.ts :131, :141, :177, :549 plus acceptance 4; review-bench.test.ts :177 plus acceptance 5; templates.test.ts :202, :563, :571, :675, :683, :694, :741, :746; pre-existing.test.ts empty | R10 literals and new tests only |
| 7 | DoD: tests/surface/pre-review.test.ts, "T1-REVIEW-COVERAGE R3 decision 1 (F2): the off prompts are byte-equal ..." included | pass |
| 7 | `git diff main -- tests/surface/pre-review.test.ts`: `SEVERITY_PATTERN` and its comment beside `DECISIONS_CLAUSE`, two doc-comment lines naming T1-REVIEW-SEVERITY, one `.replace` in `withoutAddedSentences` | R11 lines only |
| 8 | diff of REVIEW.md, templates/REVIEW.md, pre-review.ts contract, both configs, OPERATIONS.md, ARCHITECTURE.md | reviewer to verify |

Input forms the changed patterns handle (all in tests/core/finding-severity.test.ts):

| Form | Example | Result | Test |
| --- | --- | --- | --- |
| axis, white space, severity, advisory tag | `[standards] [P2] [suggestion] x` | advisory | acceptance 2 |
| axis, white space, severity (findingSeverity) | `[standards] [P0] 9 ...` | P0 | acceptance 1 |
| axis, no white space, severity, advisory tag | `[standards][P2] [suggestion] @ src/a.ts:3: broken -> fix` | block (stripAdvisoryTags, citedReasonsOf) | acceptance 2 |
| axis, no white space, severity, `[pre-existing]` | `[standards][P2] [pre-existing] @ src/a.ts:3: broken -> fix` | not pre-existing, cited | acceptance 2 |
| axis, no white space, severity (findingSeverity) | `[standards][P0] 9 ...` | P1 | acceptance 1 |
| no axis, severity, advisory tag | `[P2] [suggestion] x`, `  [p0] @ a.ts:3: [question] y` | advisory | acceptance 2 |
| no axis, severity, `[pre-existing]` | `[P1] [pre-existing] @ a.ts:3: z` | pre-existing | acceptance 2 |
| no axis, severity (findingSeverity) | `[P0] 9 ...`, `  [P0] 9 ...` | P0 | acceptance 1 |
| lower case | `[spec] [p1] [question] y`; `[standards] [p0] 9 ...` | advisory; P0 | acceptance 2; acceptance 1 |
| severity before a location | `[spec] [P1] @ a.ts:3: [question] y`; `[standards] [P2] [pre-existing] @ a.ts:3: z` | advisory; pre-existing | acceptance 2 |
| no white space, tag after the location | `[spec][P1] @ a.ts:3: [question] y` | advisory, as on main | acceptance 2 |
| severity elsewhere | `[standards] 9 errors [P2] [suggestion] @ a.ts:3: w`; `... [P0] @ ...`, `... @ src/a.ts:3: [P2] ...` | block; P1 | acceptance 2; acceptance 1 |
| `[question]`, `[suggestion]` without severity | existing reasons of review-policy and pre-existing tests | advisory | acceptance 2 |
| `[pre-existing]` without severity | existing reasons of pre-existing tests | pre-existing, cited without a changed-line map | acceptance 2 |

DoD: `npm run typecheck && node --test <7 files>` exit 0; 228 tests, 27 suites, 228 pass, 0 fail; typecheck clean.

Full suite: `npm run check` exit 0; 3719 tests, 259 suites, 3691 pass, 0 fail, 0 cancelled, 28 skipped, 0 todo.
