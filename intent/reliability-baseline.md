---
slug: reliability-baseline
title: Measure the loop's success rate, cost, lead time and review convergence from raw data before changing any behaviour
author: asun28 (engineer)
status: accepted
created: 2026-11-10T08:15:00Z
source: human
---

# Intent: Measure the loop's success rate, cost, lead time and review convergence from raw data before changing any behaviour
Author: asun28 (engineer). Status: accepted.

## Problem
82 of 263 cards (31%) were abandoned and replaced by a successor card. The
most common stated cause is R3 blocking again with a new finding at each
decision until a user ruling ends it; two more cards were replaced this way
on 2026-11-10. No per-card cost or outcome metric exists, so no change to
the review rules can be shown to help or hurt. The proposed fixes (decision
cap, delta re-review, grounding check, executable acceptance tests) come
with effect sizes measured on other code bases, mostly Python bug-fix
benchmarks, and none has been measured here.

## Proposed outcome
This goal is Phase 0 of the reliability task: baseline and diagnosis, with
no behaviour change. When it is done, the owner can read
`docs/reliability/baseline.md` and rerun `bench/outcome/` to get:

- PR success rate, cost per accepted change, lead time (p50, p90, split by
  stage) and review convergence, computed from raw data with the
  definitions in the task prompt.
- Cost and time per stage for merged and for superseded cards, and the
  total spent on superseded cards.
- The share of repeat R3 blocks whose cited line predates decision 1
  (`git blame`).
- The marginal value of R3 and of each R2 angle where R2 evidence exists.
- Verdict instability from rerunning the reviewer on stored candidates.
- Cache-read share of input tokens per provider.
- A label for every blocking finding on 30 superseded and 15 clean cards.
- The ruling set: every past user ruling with its candidate, findings and
  outcome.
- A list of every raw source that is missing or does not reconcile.

Phases 1 to 4 (review convergence, ablations, first-pass success and cost,
benchmark and stability) are later goals. Their targets are set from this
baseline and approved by the owner before Phase 1 starts.

## Affected users and systems
- The repository owner, who makes every ruling and card amendment today.
- New dev-only files: `bench/outcome/` (ingest, schema, SQL views, ruling
  set) and `docs/reliability/baseline.md`.
- Read only: `.aidlc/journal/` (190 files), `.aidlc/evidence/` (137 goals,
  30 with a review folder, 150 R3 result files, about 450 R2 files), git
  history (23 commits citing a user ruling), the GitHub API, Claude Code
  session JSONL (38 files for this checkout) and Codex session JSONL (317
  files).
- No change under `src/`, `templates/`, `.claude/` or `REVIEW.md`.

## Constraints
- No behaviour change, no new command, provider, stage or card type.
- Measurement code is dev-only and stays out of the published package.
- Paper and blog effect sizes, `docs/LESSONS.md` and earlier reports are
  leads, never evidence.
- Known gaps on 2026-11-10, to be measured and reported, not hidden:
  - No stored result carries `costUsd` or `cacheReadTokens`; R3 token
    counts exist only as a "tokens used" line in each reviewer log.
  - R3 runs on a ChatGPT subscription, so there is no billing export to
    reconcile it against; its cost can only be a list-price estimate.
  - `provider` is `mock`, so implementation cost is not recorded by aidlc
    and has to come from session JSONL.
  - `preReview.command` is empty, so R2 does not run in this repository
    today; R2 figures can only come from stored evidence.
  - 107 of 137 evidence goals have no review folder.
- Session JSONL lives outside the repository and holds private data; the
  ingest reads usage fields only and commits no transcript text.

## Decisions (owner, 2026-11-10)
- Budget: 50 USD of model spend and 2 working days for Phase 0. Stop and
  report when either runs out.
- Verdict-instability reruns: 10 stored candidates (5 superseded after an
  R3 block, 5 clean) x 3 runs of R3, 30 Codex runs. Widen only if the
  agreement figure is borderline.
- Finding labels: Claude labels; a second model (DeepSeek) labels blind
  from the same raw verdict and diff; the owner rules only on findings
  where the two disagree. The agreement rate is reported.
- Query engine: the DuckDB CLI, installed on the machine. No npm package;
  `package.json` and CI stay unchanged. Ingest scripts write JSONL and the
  views are `.sql` files.

## Decisions (owner, 2026-11-11)
- T1-OUTCOME-USAGE and T1-OUTCOME-GITHUB stopped at R3 decision 4, each
  blocked by the second pass on a commit that decision 3 had passed. Each
  is replaced by a successor card that carries its candidate, with the
  three open findings named as non-goals.
- The second R3 pass stays on. `aidlc review stats` on 2026-11-11: 29
  cards ran one, 5 were blocked by it, and 3 of those blocks were repaired
  as real defects (T0-CARD-LEASE-HEARTBEAT, T0-PREPARE-WORKTREE,
  T1-BOARD-WATCH-2), which meets the rule in docs/OPERATIONS.md for
  keeping it.
- The arc deadline is extended by 8 hours, to 2026-11-11T04:45:00Z.
- Budget: 60 USD more at list price for the two successors and
  T1-OUTCOME-HISTORY. Phase 0 had spent about 80 USD against 50 by then.
  Stop and report when it is reached.

## Open questions
- (none)
