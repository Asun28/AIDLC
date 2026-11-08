---
slug: pstack-study
title: Adopt the review, validation and eval practices of the cursor pstack skills where they beat the loop's
author: asun28 (engineer)
status: accepted
created: 2026-11-07T09:55:00Z
source: human
---

# Intent: Adopt the review, validation and eval practices of the cursor pstack skills where they beat the loop's
Author: asun28 (engineer). Status: accepted.

## Problem
The engineer asked for the skills in `github.com/cursor/plugins/tree/main/pstack/skills`
(pstack 0.15.36, read on 2026-11-07) to be compared with this loop on
validation, PR review and evals, and for each practice worth adopting to
become a card.

The loop already has what pstack's formal-verification skills teach (goal
`review-verification`: the fault-point check, its verify skill with a sync
commit, the mutant report), and it measures its reviewers, which pstack does
not. Five pstack practices have no counterpart here:

1. **A finding is proven by a run** (`interrogate`, `blast-radius`, the
   red-first rule of the `babysit` playbook). `aidlc review stats` on
   2026-11-07: 678 findings over 232 card records, 438 answered fixed and 59
   answered wrong. No record shows that a fixed finding failed on the
   reviewed candidate and passed on the repair, or that a finding answered
   wrong did not reproduce; the RED receipt is a string the loop never runs.
2. **A verdict covers a patch, not a commit** (`shipping` playbook step 3:
   compare `git patch-id` before trusting an older verdict). 18 card runs
   record a CHANGELOG-only base-sync merge (`[SHIP-BASE-SYNC-MERGED]`); each
   merge commit ran the DoD and R3 again although the code R3 had reviewed
   was unchanged. Not adopted: see Cut or deferred.
3. **A number is reported with its run count, spread and a verdict**
   (`principle-explain-the-number`, `benchmark-checklist`). The reviewer
   bench reviews each case once, so recall carries no spread. On 20 confirmed
   cases a repeat with identical rules changed the result on 5
   (`specs/second-r3-pass.md`). `docs/OPERATIONS.md` says to keep a REVIEW.md
   change only when recall does not drop, and no command decides that.
4. **An agent eval is graded from what the agent did, not what it said**
   (`poteto-mode/playbooks/eval.md` step 6). `evals/` holds one case. The
   claude-code provider asks for `--output-format json` and keeps only the
   final text, so no check can see which files the agent read or which
   commands it ran.
5. **A skill change is tested blinded against the version before it**
   (the same playbook). A change to `.claude/skills/**` or CLAUDE.md is
   checked only by `--skip-model` command checks; nothing runs both versions
   on the same prompts and compares.

## Proposed outcome
- The author of a repair can record, per finding, a command that fails on
  the reviewed candidate and passes on the repair; the loop runs it at both
  commits and records the result. The next R3 decision and `aidlc review
  stats` show it. No gate changes.
- `aidlc review bench run --trials <n>` reports the median and range of
  recall and false-block rate, and `aidlc review bench compare` gives a
  verdict on two reports: better, worse, no measurable difference or
  inconclusive.
- An eval can check the files the agent read and the commands it ran, from
  the provider's recorded tool calls; a model-backed eval runs in a temporary
  checkout; an eval prompt that names the measurement is refused.
- `aidlc evals run --variant <ref> --trials <n>` runs the same evals on the
  current checkout and on a checkout of `<ref>` and gives the same verdict.

## Affected users and systems
`src/review/` (bench, stats, prompt), `src/loop/card-runner.ts`,
`src/core/types.ts`, `src/evals/runner.ts`, `src/providers/claude-code.ts`, `src/cli/main.ts`,
`evals/`, `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`;
every downstream repository on its next `aidlc init` for the generic parts.

## Constraints
- No gate changes. The repro record and the bench and eval verdicts are
  evidence.
- Persisted records gain optional fields only; runs written before this
  goal parse unchanged. The verdict JSON schema does not change.
- No new runtime or dev dependency. The bench, the repro runs and the
  variant evals call models or run commands outside CI; CI runs only the
  deterministic tests.
- One card per PR, one at a time: every card edits `CHANGELOG.md`.
- `card-loop.md` is at its byte cap; a new step reaches the agent through a
  directive's narration.

## Cut or deferred
The pstack practices below were read and not carded in this goal:
- Keeping an R3 pass across a CHANGELOG-only base-sync merge with an equal
  code patch id (`shipping` playbook step 3; card T1-VERDICT-PATCH-ID in
  36ce1de): dropped by the engineer on 2026-11-08 (goal revision 1). The
  card-run records hold 21 such merges; 20 could be checked (one merge
  commit is gone). All 20 had an equal patch id and equal paths, but the
  card's rule also needs the base to change none of the card's files, and
  that held for 3; main had changed one of the card's files in the other 17.
  Each carry would save one R3 run of 44 to 214 s. The first R3 run after
  the merge blocked with new findings on an unchanged code patch after 5 of
  the 21 merges; the reason recorded with goal revision 1 says 5 of 19, a
  counting error (T1-STORE-CAS F3 to
  F5, T1-AUDIT-FACTS-2 F1 and F2, T0-EXIT-ZERO-NOT-MERGED F6,
  T0-HOOK-GIT-PREFETCH-2 F1, T1-INIT-HOOK-PATH F12), and
  T0-EXIT-ZERO-NOT-MERGED is one of the 3 the card would have carried. The
  review after a merge is another reviewer pass on the same code, not a
  repeat.
- `/correct` and `principle-encode-lessons-in-structure` (a table pairing
  each lesson with what enforces it, and a repeat of a prose-only lesson
  moved to a check): deferred. A lesson carries no defect class today, so a
  repeat cannot be counted without a person assigning one per lesson.
- `poteto-mode/references/bugbot-triage.md` (learned false-positive
  patterns): deferred until T1-FINDING-REPRO measures which answered-wrong
  findings fail to reproduce and T1-BENCH-TRIALS can show recall does not
  drop.
- `create-verification-skill` (a feature map that drives the real CLI):
  deferred; `tests/scenarios` drives the loop end to end.
- `arena`, `swarm`: the R2 panel and the second R3 pass already run several
  reviews on one candidate.
- `no-comments`: REVIEW.md dimension 16 covers comment noise.

## Open questions
- (none)
