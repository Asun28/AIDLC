---
slug: review-recall
title: Find more of a candidate's defects in one R3 decision, measured on the recall baseline before any loop change
intent: intent/review-recall.md
status: draft
created: 2026-11-16T19:00:00Z
skills_applied: [grilling]
---

# Spec: find more of a candidate's defects in one R3 decision, measured first
From intent: intent/review-recall.md. Status: draft. Skills applied: grilling.

This goal measures three changes to the review on the recall baseline of
`docs/reliability/baseline.md` and records what each finding is, so a
second goal can switch on the changes that meet their keep rules. The only
loop behaviour it changes is the follow-up issue a shipped card files; the
severity tag is recorded and gates nothing.

## Requirements (EARS)
- R1. When a formal finding is recorded, the loop shall store an identity
  computed in code, with no model call, from the cited path, the cited
  dimension or class, and the whitespace-normalised text of the cited lines
  at the candidate commit; a finding whose path, line or text cannot be
  read stores no identity. `re:F<n>` stays the only link that decides
  which findings a decision resolves. [SOURCE: owner, 2026-11-16,
  record and report only]
- R2. `aidlc review stats` shall report the repeat findings: formal findings
  raised at decision 2 or later whose identity equals that of a finding
  raised at an earlier decision of the same card run.
- R3. REVIEW.md and its template copy shall ask the reviewer to open each
  block reason with `[P0]`, `[P1]` or `[P2]` (P0: dimensions 1 to 6 or a
  Security finding; P1: a Bugs finding a normal run reaches that breaks
  behaviour or a persisted record; P2: the rest). Each formal finding
  shall store its severity, P1 when the reason carries no tag. No gate
  reads the severity in this goal. [SOURCE: owner, 2026-11-16]
- R4. The replay set shall hold 15 confirmed clean cases: candidates whose
  first R3 decision passed, whose card merged, and whose card has no
  successor, chosen by a fixed seeded rule. [SOURCE: owner, 2026-11-16]
- R5. `aidlc review bench run` shall take, for the formal stage, a round
  count of 1 to 3: after a round that blocks with a P0 or P1 reason, the
  bench reviews the same candidate again with the cited reasons so far
  given as found, not to be repeated, and stops at a round that adds no
  new cited reason. The report shall give each case's outcome after each
  round and each review's wall time.
- R6. The bench shall take an analysis-first order, in which the verdict
  schema and the prompt place the reasons before the verdict.
- R7. The bench shall run the pre stage with a reviewer argv given for that
  run, without writing `aidlc.config.json`, and shall report each
  review's billed cost where the reviewer's output gives its usage; a
  spend cap stops the run before the next review once the cap is reached.
- R8. The bench report shall give, for each hit, the severity of the
  finding that matched it.
- R9. The arms of intent/review-recall.md (Decisions, 2026-11-16) shall run
  once each, within about 100 Codex reviews and 10 USD billed for
  DeepSeek, and `docs/reliability/arms.md` shall report each arm's result
  against its keep rule, every number traced to a committed source file
  as in baseline.md, plus the share of true-defect hits whose matched
  finding is P2.
- R10. When a card ships, the loop shall file one GitHub issue labelled
  `review-followup` listing the run's advisory and non-blocking formal
  findings, once per card run, and record its number on the run; a run
  with no such finding files none. [SOURCE: owner, 2026-11-16]

## Design
The bench (`src/review/bench.ts`) stays the only producer of arm numbers;
each arm is a bench option, so the loop's R3 path is not touched until the
second goal. The identity and severity are pure functions in
`src/core/review-policy.ts`, stored on the finding record at the point
`recordFindings` already writes it. The clean cases are case files of the
existing `ReviewBenchCase` shape. The follow-up issue is filed through the
injected `gh` dependency, after the ship, keyed by the card run so a
recovery never files a second issue.

## Interfaces and contracts
- `ReviewFinding` gains optional `identity` and `severity`; records written
  before this goal parse unchanged.
- `aidlc review bench run` gains `--rounds <n>`, `--order analysis-first`,
  `--pre-command <file>` and `--max-usd <n>`.
- Card run record gains an optional follow-up issue number.
- New committed files: `bench/outcome/arms.json`,
  `docs/reliability/arms.md`, 15 clean case files under
  `evals/review/replay/`.

## Data model and migration impact
Additive optional fields on persisted zod records; no migration.

## Flagged concerns (route to policy owners)
- The severity instruction changes R3's prompt and so its policy hash: the
  arms are compared with a paired run on the same policy, not with the
  71.8% baseline of the old policy.
- Filing a GitHub issue is a new outward-facing side effect of SHIP.
