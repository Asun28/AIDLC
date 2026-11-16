---
slug: loop-throughput
title: CI on a pull request finishes in about half the time, the implementer's model is named, and a card's changelog entry is its own file
author: asun28 (owner)
status: draft
created: 2026-11-16T21:30:00Z
source: human
---

# Intent: CI on a pull request finishes in about half the time, the implementer's model is named, and a card's changelog entry is its own file
Author: asun28 (owner). Status: draft.

## Problem
The review of the plan of 2026-11-16 by the coordinator and the Codex gpt-6-astra reviewer
(2026-11-17 local time, approved by the owner in the session) measured three costs that no
card of that plan addressed. All numbers are from main at 2ef2bbf4.

- CI wall time is the Windows test job. On the head of pull request 342 the checks took:
  `check (windows-latest, 22)` 18 min 23 s, `build-test` 5 min 44 s,
  `check (ubuntu-latest, 22)` 5 min 21 s, `bench` 20 s, `Gitleaks (committed history)` 17 s
  (`gh pr view 342 --json statusCheckRollup`). In run 43831983917 the step `npm test` took
  17 min 35 s on Windows and 4 min 49 s on Ubuntu. `.github/workflows/ci.yml` runs the suite
  unsharded and has no `concurrency` group, so each repair push adds a full run and an older
  run keeps going. The card lead time p50 is 0.85 hours (`docs/reliability/baseline.md`),
  and R3 takes 4.0 minutes per card at p50 (`aidlc review stats`, 323 cards), so the Windows
  job alone is about a third of the lead time.
- The implementer runs on the coordinator's model. `.claude/agents/implementer.md:5` is
  `model: inherit` (card T1-EFF-AGENTS-DOD). Of the recorded Claude Code requests, 4,096 ran
  on `claude-fable-5-2` and 16,665 on `claude-opus-5-5`
  (`bench/outcome/summary.json`, view `summary_cache_share`); `src/core/roles.ts:27` names
  `claude-opus-5-5` for the implementer.
- Nearly every card edits `CHANGELOG.md`. 84 test files read it, most to assert one exact
  entry. Two cards that run at the same time conflict there, and a changelog-only base-sync
  conflict becomes a new candidate that is verified and reviewed from the start (card
  T0-BASE-SYNC-CHANGELOG-2). `plans/install-portability.md` runs its cards one at a time for
  this reason, although `maxWorkers` is 2.

## Proposed outcome
1. The Windows suite of the `ci` workflow runs in four shards. The check
   `check (windows-latest, 22)` still exists and succeeds only when all four succeeded. A new
   head of a pull request cancels the older run of that workflow for that pull request, and a
   cancelled run of an old head does not stop the ship of the current head.
2. Both implementer agent files name their model.
3. A card records its behaviour change in its own file under `changelog.d/`, and a check
   refuses a file there that is not one entry of a registered card. `CHANGELOG.md` and the
   tests that read it stay as they are.

## Affected users and systems
Every card run (CI wait, implementer model, changelog entry); `.github/workflows/ci.yml`,
`.claude/agents/implementer.md` and its template copy, the `arc.md` skill
file and its template copy, `changelog.d/` (new), `CLAUDE.md`, `tests/surface/`,
`docs/OPERATIONS.md`, `CHANGELOG.md`; GitHub Actions (four shard jobs and one job that
reports the existing check name).

## Constraints
- No test file is moved, split, skipped or deleted, and `npm test` keeps running the whole
  suite for local use.
- The names in `github.requiredChecks` (`aidlc.config.json`) and the GitHub ruleset
  `main required checks` do not change.
- The R3 policy, its allowances and `REVIEW.md` do not change.
- No existing `CHANGELOG.md` entry moves, and the base-sync changelog merge of card
  T0-BASE-SYNC-CHANGELOG-2 stays.
- The implementer's `effort` stays `medium`; choosing the model by card is part B of
  `intent/run-attribution.md`.
- The saving of outcome 1 is an estimate (a Windows critical path of about 8 minutes against
  18 min 23 s; the second shard is the heaviest) until the
  first run after the merge is read.
- Cards of at most 200 changed lines and at most 8 allowed paths.

## Open questions
- (none)
