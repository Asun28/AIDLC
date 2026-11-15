# Reliability baseline

## Method

Every number below stands in a table row whose Source cell names a file under `bench/outcome/` and an expression read against it (the expression grammar is that of card T1-OUTCOME-REPORT, body section Source expressions); `tests/surface/outcome-baseline.test.ts` resolves each expression and compares the value. `summary.json` is the run of `node bench/outcome/run.ts --summary` (card T1-OUTCOME-SUMMARY) on the main checkout at commit e74113d066a454725b9ed26dda842ca473081b19, dated 2026-11-14 by its `ranAt`. `labels.jsonl` is the file of T1-OUTCOME-LABELS-2; `labels-final.jsonl` and `adjudication.json` are the files of T1-OUTCOME-ADJUDICATE; `replay-main.json` is the file of T1-OUTCOME-REPLAY-2. No number was taken from a new run or from the state directory.

## Sources and gaps

| Measure | Value | Source |
| --- | --- | --- |
| Usage requests attributed to no card | 9568 | `summary.json` `/views/summary_unattributed[measure=unattributed].requests` |
| Share of tokens attributed to no card | 49.1% | `summary.json` `/views/summary_unattributed[measure=unattributed].token_share` |
| Usage requests with no price | 299 | `summary.json` `/views/summary_unattributed[measure=unpriced].requests` |
| Cost at list price, USD, merged and superseded groups (a card in both groups counted in each) | 1854.76 | `summary.json` `/views/summary_cost_by_stage.cost_usd` |
| Rows of `ingest_errors` | 0 | `summary.json` `/tables/ingest_errors` |
| Rows of `usage_errors` | 1 | `summary.json` `/tables/usage_errors` |
| Rows of `github_errors` | 52 | `summary.json` `/tables/github_errors` |
| Labelled findings left out of the replay because their candidate commit could not be read | 9 | `replay-main.json` `/leftOut/candidateGone` |
| Rows adjudicated by a model | 117 | `adjudication.json` `/adjudicated` |
| Spot-check sample the owner labelled | 20 | `adjudication.json` `/spotCheck/sample` |
| Adjudicator's error rate on the sample | 85% | `adjudication.json` `/spotCheck/errorRate` |
| Rows whose final label is the adjudicator's, checked by no person | 97 | `labels-final.jsonl` `[source=adjudicator]` |

Usage attributed to no card and usage with no price are left out of every per-card cost. The cost is computed at list price; no invoice reconciles it, and the formal reviewer runs on a subscription. The error tables hold the rows the ingest, usage and GitHub readers could not read. The adjudicated labels that no person checked are the adjudicator rows above; the owner checked only the sample, and on it the adjudicator's error rate is the one shown.

Not measured in this goal, since T1-OUTCOME-HISTORY did not run: repeat blocks, the findings followed by a fix (reviewer value) and the ruling set.

## Outcome

| Measure | Value | Source |
| --- | --- | --- |
| Card attempts | 324 | `summary.json` `/views/summary_successor_rate/0/card_attempts` |
| Card attempts that failed | 93 | `summary.json` `/views/summary_successor_rate/0/failed` |
| Successor rate | 28.7% | `summary.json` `/views/summary_successor_rate/0/successor_rate` |
| Pull requests accepted | 161 | `summary.json` `/views/summary_pr_success/0/accepted` |
| Pull request success rate | 49.7% | `summary.json` `/views/summary_pr_success/0/pr_success_rate` |
| Pull requests accepted, strict | 120 | `summary.json` `/views/summary_pr_success/0/accepted_strict` |
| Pull request success rate, strict | 37.0% | `summary.json` `/views/summary_pr_success/0/pr_success_rate_strict` |
| Card lead time, p50, hours | 0.85 | `summary.json` `/views/summary_lead_time[measure=lead_p50].hours` |
| Card lead time, p90, hours | 3.21 | `summary.json` `/views/summary_lead_time[measure=lead_p90].hours` |
| Pull request lead time, p50, hours | 0.80 | `summary.json` `/views/summary_lead_time_pr/0/p50_hours` |
| Pull request lead time, p90, hours | 3.48 | `summary.json` `/views/summary_lead_time_pr/0/p90_hours` |
| Share of merged pull requests with a CI rerun | 0.83% | `summary.json` `/views/summary_ci/0/rerun_share` |
| Share of merged pull requests whose first CI attempt failed | 0.83% | `summary.json` `/views/summary_ci/0/first_attempt_failed_share` |

## Review convergence

| Measure | Value | Source |
| --- | --- | --- |
| Cards with a formal decision | 303 | `summary.json` `/views/summary_review_convergence/0/cards` |
| Share whose first formal decision passed | 45.2% | `summary.json` `/views/summary_review_convergence/0/first_decision_pass_share` |
| Mean formal decisions to a pass | 1.53 | `summary.json` `/views/summary_review_convergence/0/mean_decisions_to_pass` |
| Share with two or more blocks | 33.3% | `summary.json` `/views/summary_review_convergence/0/two_or_more_blocks_share` |
| Share stopped in review | 8.25% | `summary.json` `/views/summary_review_convergence/0/stop_review_share` |

## Cost

| Measure | Value | Source |
| --- | --- | --- |
| Cost of merged cards, USD at list price | 1173.55 | `summary.json` `/views/summary_cost_by_stage[cards=merged].cost_usd` |
| Cost of superseded cards, USD at list price | 681.21 | `summary.json` `/views/summary_cost_by_stage[cards=superseded].cost_usd` |
| Superseded spend, USD | 681.21 | `summary.json` `/views/summary_superseded_spend/0/cost_usd` |
| Cost per card family, p50, USD | 7.65 | `summary.json` `/views/summary_cost_per_card/0/p50_usd` |
| Cost per card family, p90, USD | 26.98 | `summary.json` `/views/summary_cost_per_card/0/p90_usd` |
| Adjudication spend, USD | 14.19 | `adjudication.json` `/spendUsd` |

## Finding labels

| Measure | Value | Source |
| --- | --- | --- |
| Labelled findings (rows) | 252 | `labels.jsonl` `[]` |
| Cards of the labelled findings | 49 | `labels.jsonl` `#cardId` |
| Rows, group superseded | 192 | `labels.jsonl` `[group=superseded]` |
| Cards, group superseded | 30 | `labels.jsonl` `[group=superseded]#cardId` |
| Rows, group clean | 41 | `labels.jsonl` `[group=clean]` |
| Cards, group clean | 15 | `labels.jsonl` `[group=clean]#cardId` |
| Rows, group second-pass | 19 | `labels.jsonl` `[group=second-pass]` |
| Cards, group second-pass | 9 | `labels.jsonl` `[group=second-pass]#cardId` |
| Agreement among labelled rows (Claude label equals Codex label) | 126 | `labels.jsonl` `[left=null,labelA=$labelB]` |
| Rows ruled by the owner, before adjudication | 0 | `labels.jsonl` `[ownerRuled=true]` |
| Rows with no label before adjudication | 126 | `labels.jsonl` `[final=null]` |
| Label before adjudication: true-defect | 104 | `labels.jsonl` `[final=true-defect]` |
| Label before adjudication: out-of-card-scope | 13 | `labels.jsonl` `[final=out-of-card-scope]` |
| Label before adjudication: speculative | 0 | `labels.jsonl` `[final=speculative]` |
| Label before adjudication: reviewer-misread | 9 | `labels.jsonl` `[final=reviewer-misread]` |
| Label before adjudication: ambiguous-card | 0 | `labels.jsonl` `[final=ambiguous-card]` |
| Final label from both models agreeing | 126 | `labels-final.jsonl` `[source=agreed]` |
| Final label from the owner | 20 | `labels-final.jsonl` `[source=owner]` |
| Final label from the adjudicator | 97 | `labels-final.jsonl` `[source=adjudicator]` |
| Rows left out, with no final label | 9 | `labels-final.jsonl` `[source=null]` |
| True defects both models agreed on (replay set source) | 104 | `labels-final.jsonl` `[source=agreed,final=true-defect]` |
| True defects by the owner's label (replay set source) | 20 | `labels-final.jsonl` `[source=owner,final=true-defect]` |
| Owner rows whose label equals the Codex label | 20 | `labels-final.jsonl` `[source=owner,final=$labelB]` |
| Owner's spot-check agreement with the adjudicator | 3 | `adjudication.json` `/spotCheck/agree` |
| Adjudicator's label, not used as truth: true-defect | 11 | `labels-final.jsonl` `[source=adjudicator,final=true-defect]` |
| Adjudicator's label, not used as truth: out-of-card-scope | 16 | `labels-final.jsonl` `[source=adjudicator,final=out-of-card-scope]` |
| Adjudicator's label, not used as truth: speculative | 47 | `labels-final.jsonl` `[source=adjudicator,final=speculative]` |
| Adjudicator's label, not used as truth: reviewer-misread | 0 | `labels-final.jsonl` `[source=adjudicator,final=reviewer-misread]` |
| Adjudicator's label, not used as truth: ambiguous-card | 23 | `labels-final.jsonl` `[source=adjudicator,final=ambiguous-card]` |

On every sampled disagreement the owner's label equals `labelB`, the label of the Codex model and so of the formal reviewer's model family (the rows `[source=owner]` and `[source=owner,final=$labelB]`). The owner and the adjudicator agree only on the rows of `/spotCheck/agree`. The adjudicator's labels are a measurement and are not used as truth: no replay case comes from them.

## Recall baseline

| Measure | Value | Source |
| --- | --- | --- |
| Bug cases of the recall baseline | 124 | `replay-main.json` `/run/cases` |
| Hits | 89 | `replay-main.json` `/run/totals/hits` |
| Misses | 35 | `replay-main.json` `/run/totals/misses` |
| Recall | 71.8% | `replay-main.json` `/run/totals/recall` |
| Cases with no verdict | 0 | `replay-main.json` `/run/totals/noVerdict` |
| Qualifying findings left out with no case | 0 | `replay-main.json` `/leftOut/trueDefectWithoutCase` |

The cases are the agreed and the owner's true defects whose candidate commit could be read; the findings left out for an unreadable commit are counted under Sources and gaps.

## Verdict instability

| Measure | Value | Source |
| --- | --- | --- |
| Trial cases | 10 | `replay-main.json` `/trials` |
| Trial cases whose three reviewer verdicts agree | 10 | `replay-main.json` `/trials[verdictAgree=true]` |
| Trial cases whose three bench outcomes agree (score agreement, not verdict agreement) | 9 | `replay-main.json` `/trials[agree=true]` |

A pass and a block that misses the expected site both score a miss, so score agreement can differ from verdict agreement.

## What these numbers do not show

- The replay set holds no clean case, so the report gives no false-block rate.
- The recall counts only defects a formal review finding named; a defect no finding named is in no case.
- The recall comes from one bench run on main's reviewer, and the instability rows from a few trials of a subset of the cases.
- The labels come from models and from the owner's sample; the adjudicator's labels are not truth, and its error rate is measured on the sample only.
- Costs are at list price, leave out usage attributed to no card or with no price, and are not reconciled with an invoice.
- The summary is one run at one commit; repeat blocks, reviewer value and rulings are not measured.
