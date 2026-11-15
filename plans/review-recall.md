---
slug: review-recall
title: Severity, finding identity, clean cases and three bench arms measured on the recall baseline, and a follow-up issue per shipped card
spec: specs/review-recall.md
size: T1
status: draft
created: 2026-11-16T19:30:00Z
---

# Plan: find more of a candidate's defects in one R3 decision, measured first (from specs/review-recall.md)

## 1. Goal and boundaries
The owner can read `docs/reliability/arms.md` for the measured result of three review changes
(rounds inside one R3 decision, a DeepSeek R2 prefilter, analysis-before-verdict field order)
against the keep rules of intent/review-recall.md, plus the share of true-defect hits whose
matched finding is P2. Every formal finding records a severity and an identity, and
`aidlc review stats` reports both. A shipped card files one follow-up issue for its advisory
and deferred findings. No gate reads the severity or the identity in this goal; switching a
kept change on is a second goal (owner, 2026-11-16).
Budget: about 100 Codex R3 reviews (subscription) and at most 10 USD billed for DeepSeek.

## 2. Minimal acceptable loop
Severity first, since the round rule and the P2 share read it. Identity next, since a round's
"new finding" is decided by it. The bench options read both. The clean cases need neither and
run beside severity. The arms run from a worktree pinned at the merge of the bench options;
the report card carries their reports.

## 4.5 Module design
- `src/core/review-policy.ts`: `findingSeverity`, `findingIdentity` (pure; the identity takes a
  line reader), the advisory and pre-existing tag patterns accept a severity tag.
- `src/core/types.ts`: `ReviewFinding.severity`, `ReviewFinding.identity`, `RecordFindingsInput`
  identity map, `CardRun.followupIssue`, closure flag `followups`.
- `src/loop/card-runner.ts`: reads the cited lines at the candidate before recording findings;
  the `followups` closure step.
- `src/probes/gh.ts`: issue lookup by marker and issue creation.
- `src/review/bench.ts`, `src/review/pre-review.ts`, `src/cli/main.ts`: `--rounds`, `--order`,
  `--pre-command`; the found-in-this-decision prompt section; the verdict order.
- `src/review/stats.ts`: findings by severity, repeat findings by identity.
- `bench/outcome/clean.ts`, `evals/review/clean/`: the 15 clean cases.
- `bench/outcome/arms.ts`, `bench/outcome/arms.json`, `docs/reliability/arms.md`: the report.

## Files that change
- REVIEW.md
- templates/REVIEW.md
- aidlc.config.json
- templates/aidlc.config.json
- src/core/review-policy.ts
- src/core/types.ts
- src/review/pre-review.ts
- src/review/stats.ts
- src/review/bench.ts
- src/cli/main.ts
- src/loop/card-runner.ts
- src/probes/gh.ts
- tests/core/review-policy.test.ts
- tests/core/finding-severity.test.ts (new)
- tests/core/finding-identity.test.ts (new)
- tests/scenarios/finding-identity.test.ts (new)
- tests/surface/stats.test.ts
- tests/surface/review-bench-rounds.test.ts (new)
- tests/surface/review-bench-order-pre.test.ts (new)
- tests/infra/gh.test.ts
- tests/scenarios/followup-issue.test.ts (new)
- tests/scenarios/fault-points.test.ts
- .claude/skills/verify-card-run-writes/SKILL.md
- bench/outcome/clean.ts (new)
- evals/review/clean/ (new)
- evals/review/README.md
- tests/surface/outcome-clean.test.ts (new)
- bench/outcome/arms.ts (new)
- bench/outcome/arms.json (new)
- bench/outcome/deepseek-r2.json (new)
- docs/reliability/arms.md (new)
- tests/surface/outcome-arms.test.ts (new)
- docs/OPERATIONS.md
- docs/ARCHITECTURE.md
- CHANGELOG.md

## Order of work
1. T1-REVIEW-SEVERITY: the severity tag in REVIEW.md, the contract and the finding record; stats
   by severity; the bench's matched severity. Starts beside 2.
2. T1-REPLAY-CLEAN: 15 confirmed clean cases under evals/review/clean/. Starts beside 1.
3. T1-FINDING-IDENTITY: the identity on each formal finding; stats repeat findings. Depends on 1.
4. T1-BENCH-ROUNDS: `--rounds`, the found-in-this-decision section. Depends on 1 and 3.
4a. T1-BENCH-ORDER-PRE: `--order analysis-first`, `--pre-command`. Depends on 4 (same files).
4b. T1-GH-ISSUES: `GhProbe.issuesWithLabel` and `createIssue`. No dependency; starts when a
   worker is free.
5. Arms run (coordinator, no card): from a worktree pinned at the merge commit of 4a, with the
   clean cases of 2 on main. Rounds arm (`--rounds 3`) and order arm (`--order analysis-first`)
   on the case files of the 25 triples that hold a baseline miss and on the clean cases; R2 arm
   (`--stage pre --pre-command`) on all 124 replay cases and the clean cases, in batches, with
   the DeepSeek balance read before and after each batch and the run stopped before a batch
   that would pass 10 USD. Reports go to `_local/arms/`.
6. T1-REVIEW-FOLLOWUP-ISSUE: the `followups` closure step. Depends on 3 (shared files) and 4b.
   Runs while 5 runs.
7. T1-ARMS-REPORT: arms.json, arms.md, the goal's CHANGELOG entry. Depends on 2, 4a, 6 and the
   reports of 5.

The bench options and the follow-up issue are split in two cards each: a `src/` card is capped
at a budget of 250 (`MAX_CODE_CARD_BUDGET`) and no size exception is recorded.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-REVIEW-SEVERITY-3 | MUST | severity tag recorded on every finding, gating nothing (replaces T1-REVIEW-SEVERITY-2, which replaced T1-REVIEW-SEVERITY; carries its candidate) | - | W1 | - |
| T1-REPLAY-CLEAN | MUST | 15 confirmed clean cases | - | W1 | - |
| T1-FINDING-IDENTITY | MUST | identity on every formal finding, repeat findings in stats | T1-REVIEW-SEVERITY | - | - |
| T1-BENCH-ROUNDS | MUST | rounds inside one decision in the bench | T1-REVIEW-SEVERITY, T1-FINDING-IDENTITY | - | - |
| T1-BENCH-ORDER-PRE | MUST | field order and an R2 argv for one bench run | T1-BENCH-ROUNDS | - | yes |
| T1-GH-ISSUES | MUST | list issues by label, create a labelled issue | - | W1 or W2 | - |
| T1-REVIEW-FOLLOWUP-ISSUE | MUST | one follow-up issue per shipped card | T1-FINDING-IDENTITY, T1-GH-ISSUES | W2 (with the arms run) | - |
| T1-ARMS-REPORT | MUST | the measured report and the goal's CHANGELOG entry | T1-REPLAY-CLEAN, T1-BENCH-ORDER-PRE, T1-REVIEW-FOLLOWUP-ISSUE | - | - |

W1 cards have disjoint allow_paths. Only T1-ARMS-REPORT edits CHANGELOG.md.

## Risks
- The severity instruction changes R3's prompt, so it can change recall. The arms compare paired
  runs on one policy; the 71.8% baseline of REVIEW.md@6 is quoted, not compared.
- An advisory reason with a severity tag before its `[suggestion]` tag must stay advisory: the
  tag patterns accept the severity tag, tested in both directions.
- The rounds arm and the order arm run on 25 triples chosen for their baseline misses, so the P2
  share is measured on a biased sample; arms.md says so.
- The `deepseek` CLI prints no usage; the billed cost is the balance difference over each batch,
  so a per-review median is not available and the mean stands for it (stated in arms.md).
- Filing an issue is outward-facing. It is idempotent by a marker in the issue body, runs only on
  the github ship path, and only at CLOSE after the merge is verified.
- The follow-up step adds a store write to `card close`; the fault-point test covers it.
- A card that stops at R3 runs unattended: open P2 or advisory findings are deferred by the
  owner's standing instruction of 2026-11-16 to a follow-up card; an open P0 or P1 keeps the stop.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: `aidlc review stats --goal <this goal>` on main lists severity counts and repeat findings.
- Arc: `aidlc review bench run --stage formal --dir evals/review/clean --case <one id>` loads a
  clean case and scores it.
- Arc: `node --test tests/surface/outcome-arms.test.ts` passes on main.
- Arc: the follow-up step ran at CLOSE of at least one card of this goal on the github ship path
  (an issue number or "no follow-up finding" recorded on its run).

## 10. After merge
none this version (development-only target)
