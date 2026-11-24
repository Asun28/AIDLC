---
slug: review-panel
title: Measure a two-reviewer R3 panel (Codex gpt-6-astra and Claude Fable 5.2) on the reviewer bench, then run it in the loop only if it meets its keep rule
author: asun28 (owner)
status: accepted
created: 2026-11-18T23:00:00Z
source: human
---

# Intent: Measure a two-reviewer R3 panel (Codex gpt-6-astra and Claude Fable 5.2) on the reviewer bench, then run it in the loop only if it meets its keep rule
Author: asun28 (owner). Status: accepted.

## Problem
R3 is one Codex `gpt-6-astra` pass per decision. Its result varies a lot
between runs of the same candidate, and the loop pays for that variance in
repair rounds:

- `docs/reliability/baseline.md`: 45.2% of cards pass R3 at decision 1,
  33.3% have two or more blocks, 28.7% of card attempts get a successor.
- The unfinished arms run (`_local/arms/`, main at ff925160, not yet
  reported by T1-ARMS-REPORT), on the 64 bug cases of the 25 triples that
  held a baseline miss: two independent single-round Codex runs hit 33 and
  35, agree on 27, and their union hits 41. Sequential rounds inside one
  decision moved 33 to 34. Both runs false-block the same 1 of 15 clean
  cases (T0-INTAKE-TARGET-2).
- The replay of 2026-11-07 (docs/OPERATIONS.md, Second pass) found 9 to 10
  of 20 known defects with one pass and 13 to 14 with two, and blocked 1 of
  10 clean cases with one pass and 2 with two.

These numbers show that two independent samples find more than one. They do
not show that a second model family finds more than a second Codex run: every
sample above is Codex. The 64 cases were chosen for a baseline miss, so part
of the gain is regression to the mean.

## Existing bench records (read 2026-11-19)
| Record | Policy | What it shows |
| --- | --- | --- |
| `_local/bench-step4/` (2026-11-07, 20 bug and 10 clean cases, method fixed before any review) | bbbdb10f | Codex run A1 hit 10, an identical rerun A2 hit 9; 5 of 20 cases flipped between identical runs; A1 or A2 hit 12, any of three runs 15; 5 cases no run hit. Clean: one pass blocked 1 of 10, two passes 2 (neither a plain false block on reading) |
| `bench/outcome/replay-main.json` (124 bug cases, one run) | e5aa06ae | recall 89 of 124 (71.8%) |
| `_local/arms/rounds-*.json`, `order-*.json` (2026-11-16, 64 bug cases of 25 triples, 15 clean) | aa7f80ba | round 1 hit 33, field-order run 35, 27 shared, union 41; rounds 2 and 3 added 1; the same 1 of 15 clean cases blocked by both |
| `_local/arms/r2-*.json` (DeepSeek v4-pro as R2, 29 of the planned reports, 11.67 CNY) | aa7f80ba | 1 hit of 24 scored bug cases, 1 false block of 12 clean, 4 no-verdict: far under the 20% keep rule |
| `bench/outcome/adjudication.json` (Claude Opus 5.5 as a third labeller of contested findings) | n/a | wrong on 17 of the 20 rows the owner checked (85%) |

No record holds a Fable 5.2 review or a Claude formal review of any bench
case. The policy changed between the three Codex sets, so only the two
2026-11-16 runs pair with each other.

Consequences for this goal:
- Codex+Codex needs no new reviews to start: the two 2026-11-16 runs are a
  matched pair on 64 bug and 15 clean cases.
- A per-finding verification call by a second model is dropped, not
  deferred: the only measured model judge of contested findings was wrong
  85% of the time, which would turn true blocks into advisories.
- The DeepSeek R2 arm needs no more spend for this question.

## Sources
Outside designs (research of 2026-11-19; leads, not evidence):
- Anthropic Code Review (code.claude.com/docs/en/code-review): parallel
  finder agents, a verification step per candidate finding, dedupe and rank;
  REVIEW.md read from the base branch only; delta re-review.
- anthropics `/code-review` plugin and claude-code-security-review: one
  validator call per finding; a failed filter call keeps the finding.
- Cursor Bugbot v1: 8 parallel passes with shuffled diff order, findings
  bucketed, validator after. SWR-Bench (FSE 2026): n runs merged raised
  recall 119% at n=10, levelling off after n=5; a multi-agent reviewer
  scored lowest.
- CodeRabbit learnings (scoped, applied after merge), Greptile suppression
  by past rejections, the CodeRabbit PR-reviewer skill's valid / debatable /
  invalid label per finding.

Design panel (2026-11-19, read-only in this repository): Codex `gpt-6-astra`
(high effort) and Claude Fable 5.2 (high effort), on one brief. Both said:
measure before the loop changes; compare Codex+Fable against Codex+Codex at
equal calls; do not block only on findings both raise (the filter
intent/review-recall.md withdrew); keep sequential rounds out of the loop;
one reservation, one findings snapshot and one decision per panel; never add
a reviewer after a deadlock. Fable added: the bench cannot score a second
formal reviewer today (`src/review/bench.ts:172` refuses `--pre-command` on
the formal stage); 15 clean cases are too few; `findingIdentity` will not
fold one defect cited at two lines; a quota hold outranks a block in
`aggregateVerdicts` (`src/review/pre-review.ts:1216`). Codex added: read the
review policy from a fixed commit rather than the main checkout's working
tree (`src/loop/card-runner.ts:424`).

## Proposed outcome
1. The reviewer bench scores any formal reviewer from a file, and the report
   script combines saved reports into union and intersection scores.
2. The clean set holds at least 40 confirmed cases.
3. `docs/reliability/panel.md` reports single Codex, Codex+Codex and
   Codex+Fable on all 124 bug cases and every clean case, 3 trials each,
   against the keep rule below.
4. Only if the keep rule holds: `formalReview.panel` runs both members on
   each R3 decision in this repository, with `secondPass` off.
5. The review policy a decision applies is read from the run's base commit.

## Affected users and systems
`src/review/bench.ts`, `src/review/pre-review.ts`, `src/core/review-policy.ts`,
`src/core/types.ts`, `src/config.ts`, `src/loop/card-runner.ts`,
`src/cli/main.ts`, `bench/outcome/`, `evals/review/`, `aidlc.config.json`,
`templates/aidlc.config.json`, `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`,
`docs/reliability/`.

## Constraints
- No loop change before its bench arm has run and its result is recorded
  (as intent/review-recall.md).
- A missing or malformed verdict fails closed; a pass never stands on fewer
  verdicts than the panel has members; `MAX_R3_DECISIONS` stays 4.
- The deadlock rule stands: a panel is fixed in configuration before a card
  run starts and is never widened after a dispute.
- No agreement filter (block only when both members raise a finding).
- Reviewer commands stay argv arrays.

## Keep rule (accepted by the owner, 2026-11-19)
On all 124 bug cases and every clean case, 3 trials, scored by triple:
- Panel against single Codex: at least 7 more hits at the median, at most 1
  more false block, median decision wall time at most 1.5 times.
- Codex+Fable against Codex+Codex: Fable is the second member only with at
  least 5 more hits at the median and at most 1 more false block; otherwise
  the panel is two Codex runs.
- After 30 cards with the panel on: the share of cards with two or more R3
  blocks below 33.3% and the STOP/review rate not higher than before, else
  the panel goes off.

## Not in this goal
- A verification call per finding (the other model refutes a single-member
  finding): dropped on the 85% adjudicator error above, and it reopens the
  "delete-only fact check" withdrawn in intent/review-recall.md.
- Suppression by past rejections (Greptile), shuffled diff order, a line
  citation required on every Bugs block.

## Decisions (owner, 2026-11-19, in the session)
- Stage 1 approved: one Fable 5.2 trial (`bench/outcome/fable-r3.json`) on
  the 25 triples and 15 clean triples the 2026-11-16 Codex pair covered,
  about 40 reviews, about 3 h, compared with that Codex pair.
- Stage 2 (Codex and Fable at 3 trials on all 57 replay triples and 40 clean
  triples, about 580 reviews) is not approved yet: it runs only when stage 1
  meets its gate (Fable's unique hits over Codex round 1 at least 8) and the
  owner approves it on that result.
- The keep rule above is accepted as written.
- Fable 5.2 quota: confirmed that the subscription can carry one Fable R3
  review per decision.
- Stage 1 result (2026-11-19, 17:28 NZDT): on 61 scored bug cases Codex round 1 hit 33, the second Codex run 34, Fable 5.2 20; Codex+Codex 40, Codex+Fable 38. Fable added 5 hits over Codex round 1, the second Codex run 7: the stage 2 gate fails. Fable hit its usage limit after about 23 reviews (no clean-case data; issue 385).
- Owner, 2026-11-19, on that result: report stage 1 (T1-PANEL-ARMS-REPORT), then stop. T1-R3-PANEL, T1-R3-PANEL-FOLD and T1-R3-PANEL-ON leave this goal and wait in issue 386 for a Codex-only stage 2. T1-REVIEW-POLICY-PIN left earlier (issue 383).

## Open questions
- (none)
