# Review panel

Does a second R3 reviewer find enough more defects to run, and should it be Claude Fable 5.2 or a second Codex `gpt-6-astra` run? Stage 1 answers the first half on a small subset: Fable did not meet the stage 2 gate, so stage 2 did not run and the panel stays off. The owner decided to report stage 1 and stop (intent/review-panel.md, Decisions); the panel cards wait in issue 386.

## Method

`bench/outcome/panel.json` was written by `node bench/outcome/panel.ts assemble --commit c7a7ce14b8942c06ea53ced7fd70669f7f749e5a` on 2026-11-19 (card T1-PANEL-ARMS-REPORT). It reads saved bench reports and runs no review:

- Codex round 1: `rounds[0]` of each case of `_local/arms/rounds-miss.json` and `_local/arms/rounds-clean.json` (the three-round run of 2026-11-16).
- The field-order run: `_local/arms/order-miss.json` and `_local/arms/order-clean.json` (2026-11-16, one round, analysis first). It is the second Codex member.
- Fable: `_local/panel-arms/fable-miss.json` and `_local/panel-arms/fable-clean.json` (2026-11-19, `--formal-command bench/outcome/fable-r3.json`) on the same bug and clean cases.

The command refuses, writing nothing, when an input is missing or unparsable, a case result does not have the shape the bench writes (an id of the case id syntax, kind, outcome for its kind, duration, rounds) or repeats an id in a trial, a scored case of a multi-round report has no round or ends on a round with another outcome, a one-round report holds rounds, a report has the wrong number of trials, a report is not of the formal stage, a Fable report has no `options.formalCommand` or a Codex report has one, the policy hashes differ, a case breaks a saved-case rule of the bench (a scored outcome needs runStatus success; a pass, no-verdict or error cites nothing; only a hit has a matched finding, which is one of its cited reasons and cites the matched file), a report's ids (each miss, replay and clean report separately, in every trial) are not exactly those of its case directory, a case's kind is not its case file's, or a bug case's stored outcome is not the one its own cited reasons give against the expected sites of its case file. A clean case's false block cannot be recomputed from the saved report (a block may cite nothing), so clean cases are held to the saved-case rules only. An unscored case of a multi-round report (no-verdict or error, which the bench writes with no round) is left out, not refused. With stage 2 inputs it also refuses a case with no case file to name its triple, and a wall-time ratio that is not finite. `panel.json` holds the SHA-256 of each input.

`unionOf` scores a panel over the cases every member holds: a bug case is a union hit when any member hit it and an intersection hit when every member did; a clean case is a union false block when any member blocked it. A unique hit is a hit no other member has. To compare the three compositions on the same cases, a case is left out of all of them (`excluded`) when any of the three reviews gave it no verdict or an error.

Every number below is a table row; its source is a JSON pointer into `bench/outcome/panel.json` (an array counts its elements) or the record of intent/review-panel.md (Existing bench records) it comes from.

| Measure | Value | Source |
| --- | --- | --- |
| Policy hash of the stage 1 reports | aa7f80bac1a3df11a5b915c7f85a2ef0b1e268a065229b7790c5020c0dad537e | `/policyHash/stage1` |
| Cases left out of every composition (no verdict from a member) | 18 | `/measures/stage1/excluded` |
| Bug cases left out (no Fable verdict) | 3 | `/measures/stage1/excludedKinds/bug` |
| Clean cases left out (no Fable verdict) | 15 | `/measures/stage1/excludedKinds/clean` |

## Earlier records

From intent/review-panel.md, Existing bench records. Only the 2026-11-16 Codex pair shares the policy of the Fable run; the others are context.

| Measure | Value | Source |
| --- | --- | --- |
| 2026-11-07 Codex run A1, hits of the bug cases | 10 | `_local/bench-step4/` |
| 2026-11-07 identical rerun A2, hits | 9 | `_local/bench-step4/` |
| 2026-11-07 A1 or A2, hits | 12 | `_local/bench-step4/` |
| Recall baseline, bug cases | 124 | `bench/outcome/replay-main.json` |
| Recall baseline, hits | 89 | `bench/outcome/replay-main.json` |
| 2026-11-16 pair, bug cases of the triples with a baseline miss | 64 | `_local/arms/rounds-*.json` |
| 2026-11-16 Codex round 1, hits of the 64 | 33 | `_local/arms/rounds-*.json` |
| 2026-11-16 field-order run, hits of the 64 | 35 | `_local/arms/rounds-*.json` |
| 2026-11-16 pair, shared hits | 27 | `_local/arms/rounds-*.json` |
| 2026-11-16 pair, union hits | 41 | `_local/arms/rounds-*.json` |
| 2026-11-16 pair, clean cases (one blocked by both runs) | 15 | `_local/arms/rounds-*.json` |
| DeepSeek R2 arm, scored bug cases (1 hit) | 24 | `_local/arms/r2-*.json` |
| Claude Opus adjudicator, rows wrong of those the owner checked | 17 | `bench/outcome/adjudication.json` |
| Claude Opus adjudicator, rows the owner checked | 20 | `bench/outcome/adjudication.json` |

## Stage 1

Bug cases scored by all three reviews. No clean case is scored: Fable gave no verdict on any clean case, so the false-block columns of stage 1 are empty and the only clean-case figure for Codex is the earlier record above.

| Measure | Value | Source |
| --- | --- | --- |
| Bug cases scored by all three | 61 | `/measures/stage1/codex/bugCases` |
| Clean cases scored by all three | 0 | `/measures/stage1/codex/cleanCases` |
| Codex round 1 alone, hits | 33 | `/measures/stage1/codex/union/hits` |
| Field-order run alone, hits | 34 | `/measures/stage1/codexCodex/members/1/hits` |
| Fable alone, hits | 20 | `/measures/stage1/codexFable/members/1/hits` |
| Codex+Codex, union hits | 40 | `/measures/stage1/codexCodex/union/hits` |
| Codex+Codex, intersection hits | 27 | `/measures/stage1/codexCodex/intersection/hits` |
| Codex+Codex, unique hits of round 1 | 6 | `/measures/stage1/codexCodex/uniqueHits/0` |
| Codex+Codex, unique hits of the field-order run | 7 | `/measures/stage1/codexCodex/uniqueHits/1` |
| Codex+Fable, union hits | 38 | `/measures/stage1/codexFable/union/hits` |
| Codex+Fable, intersection hits | 15 | `/measures/stage1/codexFable/intersection/hits` |
| Codex+Fable, unique hits of round 1 | 18 | `/measures/stage1/codexFable/uniqueHits/0` |
| Codex+Fable, unique hits of Fable | 5 | `/measures/stage1/codexFable/uniqueHits/1` |

On these cases a second Codex run adds more hits to round 1 than Fable does, and Fable alone hits fewer cases than either Codex run.

## Stage 2

Stage 2 was not run: the gate needs Fable's unique hits over Codex round 1 to be at least the threshold, and they are below it. `panel.json` holds no stage 2 measures and no `panel` or `member2` verdict.

| Measure | Value | Source |
| --- | --- | --- |
| Gate value: Fable unique hits over Codex round 1 | 5 | `/keep/gate/fableUniqueHits` |
| Gate threshold | 8 | `/keep/gate/threshold` |
| For comparison: field-order run unique hits over round 1 | 7 | `/keep/gate/fieldOrderUniqueHits` |
| Stage 2 | skip | `/keep/stage2` |

## Keep rule

As the owner accepted it in intent/review-panel.md (Keep rule, Decisions), applied by `keep` in `bench/outcome/panel.ts`:

- Stage gate: stage 2 runs only when Fable's unique hits over Codex round 1 reach the threshold above.
- With stage 2 measures (three trials on all replay and clean cases): the panel is kept only when the better composition gains at least the panel gain in hits at the median over single Codex, with at most the extra false blocks below, and a median per-triple wall time of the slower member at most the ratio below times that of single Codex. Fable is the second member only when Codex+Fable gains at least the Fable gain in hits at the median over Codex+Codex with at most the extra false blocks below; otherwise the panel is two Codex runs. In stage 2, Codex+Codex in trial t pairs Codex trial t with Codex trial t+1 (mod 3), so every panel makes two calls per triple.

| Measure | Value | Source |
| --- | --- | --- |
| Panel gain: hits at the median over single Codex, at least | 7 | `/keep/rule/panelGain` |
| Extra false blocks at the median, at most | 1 | `/keep/rule/extraFalseBlocks` |
| Wall-time ratio over single Codex, at most | 1.5 | `/keep/rule/wallTimeRatio` |
| Fable gain: hits at the median over Codex+Codex, at least | 5 | `/keep/rule/fableGain` |

Stage 1 result: the gate is not met, so `keep.stage2` is `skip` and the panel is not measured for keeping.

## What these numbers do not show

- The stage 1 subset was chosen for baseline misses: every bug case comes from a triple where an earlier Codex run missed, so part of any gain is regression to the mean, and the hit counts are not recall on the full replay set.
- The field-order run is not an identical rerun of round 1: it put the analysis before the verdict, so the Codex+Codex gain mixes sampling variance with a prompt change.
- Fable ran with more lessons in docs/LESSONS.md than the 2026-11-16 Codex runs, more by the count in the rows below (the card estimated about ten), under the same REVIEW.md (the same policy hash). The count is of the NEVER, ALWAYS and NOTE lines the repository's lesson parser reads. The arms worktrees are gone and their reports name no commit, so the arms commit is the merge of T1-BENCH-ORDER-PRE, the pin plans/review-recall.md names for the arms run; the commits just before it (35de54fe) and after it (ef3e0ac3), where the two arms runs could also have started, hold the same count. The stage 1 commit is main when stage 1 started, 2026-11-19T01:46Z. A review prompt carries only the newest NEVER and ALWAYS lines that fit `REVIEW_LESSONS_MAX_BYTES` (src/artifacts/lessons.ts), so the reviewer saw the newest of the added lessons in place of older ones, not all of them on top.
- Fable hit its usage limit, so its clean cases and the bug cases counted in Method have no verdict (issue 385): stage 1 measures no false block for Fable or for either panel, and those bug cases are why stage 1 scores fewer bug cases than the 2026-11-16 pair holds.
- One replay set from this repository, one Fable trial and one trial per Codex run: no spread across trials is measured.
- No loop measure yet: nothing here shows the share of cards with two or more R3 blocks, or the STOP/review rate, with a panel on.

| Measure | Value | Source |
| --- | --- | --- |
| Arms commit (merge of T1-BENCH-ORDER-PRE) | 1418c7b9acc18621171384e3d92d7ffcbcde3a07 | `/lessons/arms/commit` |
| Lessons in docs/LESSONS.md at the arms commit | 171 | `/lessons/arms/lessons` |
| Stage 1 commit (main at 2026-11-19T01:46Z) | be8b2c8a584bd56b982e14d3f1c70f32d0e354f2 | `/lessons/stage1/commit` |
| Lessons in docs/LESSONS.md at the stage 1 commit | 187 | `/lessons/stage1/lessons` |
| Lessons added between the two | 16 | `/lessons/added` |
