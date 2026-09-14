---
slug: review-findings
title: Review findings with identity, dispositions and a bounded re-review
spec: specs/review-findings.md
size: T1
status: accepted
created: 2026-09-14T03:00:00Z
---

# Plan: Review findings with identity, dispositions and a bounded re-review (from specs/review-findings.md)

## 1. Goal and boundaries
Adopt the parts of the V2 PR-review workflow notes that the loop's own evidence supports: findings with identity and dispositions, no re-review of an unchanged candidate without new information, no review of a truncated diff, the policy hash on every verdict, the delta on later rounds with first-round misses labelled, question and suggestion tags that never block, and statistics per card and card family. In scope: R1-R13. Cut: a human ruling command, a verification stage with executed evidence, CI in parallel with review (all listed as non-goals in the spec). Success: three cards merge through the loop's own R2, R3 and GitHub ship; `aidlc review stats` reports the rounds this goal itself consumed.

## 2. Minimal acceptable loop
A blocked candidate lists its findings with ids; `aidlc review dispute` records a note; `aidlc review pre` on the unchanged candidate is refused until every finding is disputed and then runs with the note in the prompt; `aidlc review stats` prints the rounds.

## 3. Tech stack
none this version

## 4. Directory structure
none this version

## 4.5 Module design
- src/core/types.ts: `ReviewFinding`, `CardRun.findings`, optional `policyHash` and `candidateSha` fields, two journal event types.
- src/core/review-policy.ts: pure finding bookkeeping: `recordFindings` (new ids, `re:F<n>` re-raises, resolution, `outsideDelta`), `rerunAllowed`, `deadlocked`, `findingReference`.
- src/review/pre-review.ts: prompt sections (prior findings with dispositions, delta, policy hash, rule files, tags), `policyHash`, `ruleFilesIn`.
- src/review/stats.ts (new): `summarizeReviews(runs, registry)`; family through `superseded_by`.
- src/loop/card-runner.ts: findings recorded after every block; same-candidate guard in `preReview` and `formalReview`; pass valid across cycles; truncation refused before dispatch; delta collected from the last reviewed candidate; hashes recorded; deadlock named in stop details and residuals; `dispute`, `accept`, `listFindings`.
- src/cli/main.ts: `review dispute`, `review accept`, `review findings`, `review stats`; the R2 summary prints advisory notes.
- REVIEW.md and templates/REVIEW.md: output contract with `[question]` and `[suggestion]`; both configs at `REVIEW.md@3`.

## 5. Data model and state machine
none this version (card states unchanged; findings are evidence on the run)

## 6. Contracts and core interfaces
See the spec section Interfaces and contracts. The verdict JSON document and the Codex output schema are unchanged; references and tags live inside reason strings.

## Files that change
- src/core/types.ts
- src/core/review-policy.ts
- src/review/pre-review.ts
- src/review/stats.ts (new)
- src/loop/card-runner.ts
- src/state/goal-store.ts
- src/cli/main.ts
- REVIEW.md
- templates/REVIEW.md
- aidlc.config.json
- templates/aidlc.config.json
- .claude/skills/aidlc-loop/card-loop.md
- templates/claude/skills/aidlc-loop/card-loop.md
- tests/infra/goal-store.test.ts
- tests/core/review-policy.test.ts
- tests/core/types.test.ts
- tests/surface/pre-review.test.ts
- tests/surface/stats.test.ts (new)
- tests/scenarios/t0-flow.test.ts
- tests/scenarios/review-block.test.ts
- tests/surface/templates.test.ts
- docs/ARCHITECTURE.md
- docs/OPERATIONS.md
- CHANGELOG.md

## Order of work
1. T1-REVIEW-FINDINGS, replaced by T1-REVIEW-FINDINGS-2 and then T1-REVIEW-FINDINGS-3 after two R3 decisions each (same change, every finding repaired; card 3 adds the run revision compare-and-set and the one-in-flight limits): finding records, re-raise references, dispositions and their CLI, the prior-findings prompt section, the same-candidate guard, the pass valid across cycles, deadlock naming, the dispatch snapshot, every card-run write under one lock.
2. T1-REVIEW-INPUTS: truncation refused before dispatch, policy hash and rule-file note, delta section with `outsideDelta`, question and suggestion tags, R2 advisory notes into R3, REVIEW.md@3.
3. T1-REVIEW-STATS: `summarizeReviews`, `aidlc review stats`, family totals.

## 7. Task split (dependencies and parallel windows)

| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-REVIEW-FINDINGS | MUST | findings with ids and dispositions; prompt carries them; unchanged candidate never re-reviewed without disputes; deadlock named (stopped after two R3 decisions; superseded by T1-REVIEW-FINDINGS-2) | - | W1 | - |
| T1-REVIEW-FINDINGS-2 | MUST | the T1-REVIEW-FINDINGS change with every R3 finding repaired; rounds bound to the dispatched snapshot; every card-run write under the card-run lock (stopped after two R3 decisions; superseded by T1-REVIEW-FINDINGS-3) | - | W1 | - |
| T1-REVIEW-FINDINGS-3 | MUST | the T1-REVIEW-FINDINGS-2 change with findings 1-7 of its decision 2 repaired: a run revision with compare-and-set on every snapshot write, one round and one decision in flight per card | - | W1 | - |
| T1-REVIEW-INPUTS | MUST | truncation refused; policy hash; delta with first-round misses; question and suggestion tags; REVIEW.md@3 | T1-REVIEW-FINDINGS-3 | W2 | - |
| T1-REVIEW-STATS | MUST | `aidlc review stats` per card and family | T1-REVIEW-INPUTS | W3 | - |

## Risks
- The three cards share `card-runner.ts`, `types.ts` and `pre-review.ts`; they run one at a time so no card starts on a moved base.
- `card-loop.md` has 12 bytes of headroom; the dispute sentence needs an equal cut in the same file.
- Another goal (T1-LOOP-GATES-2) holds an unmerged branch on `card-runner.ts`; whichever merges second syncs its base by merge.
- A reviewer that never writes `re:F<n>` produces new findings instead of re-raises; the first-round-miss label and the stats still work, the deadlock rule then relies on the existing caps.
- Bumping `reviewPolicyVersion` changes the admission key; a pass recorded under `REVIEW.md@2` for an in-flight candidate stays valid for that candidate only.

## Proof
- review-policy tests: ids, re-raises, resolution, dispositions, rerun rule, deadlock naming, `outsideDelta`.
- pre-review tests: prompt sections, policy hash, rule files, tags advisory, delta and the no-change note, truncation refusal.
- scenario tests: R2 block with dispute then re-run; R3 block with dispute then decision two; pass valid across cycles; residual and stop details name the deadlocked finding; journal events.
- stats tests: fixture runs and a two-card family; a card without reviews.
- templates and mirror tests: skill copies equal and under the caps; REVIEW.md mirrored; both configs at `REVIEW.md@3`.

## 10. After merge
none this version (development-only target)
