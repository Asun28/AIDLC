---
id: T0-REVIEWER-UTF8
title: Every reviewer process runs with PYTHONUTF8=1 and PYTHONIOENCODING=utf-8 unless the environment sets them, so a Python reviewer on Windows reads its piped prompt as UTF-8 instead of the code page (issue 99)
status: todo
branch: T0-REVIEWER-UTF8
worktree: D:\wt\AIDLC\T0-REVIEWER-UTF8
allow_paths:
  - src/review/pre-review.ts
  - tests/surface/reviewer-env.test.ts
  - tests/surface/reviewer-env.child.ts
  - tests/scenarios/r2-fallback.test.ts
  - tests/scenarios/r3-fallback.test.ts
  - tests/scenarios/base-sync-review.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-REVIEWER-UTF8.md
dod_command: npm run typecheck && node --test tests/surface/reviewer-env.test.ts tests/surface/pre-review.test.ts tests/scenarios/r2-fallback.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/base-sync-review.test.ts
dod_exit: 0
requirements:
  - R1. `reviewerEnv` (src/review/pre-review.ts) shall return the process environment, unchanged and not mutated, plus `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8`, each decided on its own, only when the environment does not already give that variable a non-empty value; a value the user set wins (`PYTHONUTF8=0` stays 0), and an empty one, which Python ignores, is replaced. On Windows a variable is matched in any letter case, as Windows reads it, and an empty spelling in another case is dropped before ours is set; elsewhere only the exact name matches.
  - R2. Every reviewer process shall be spawned with `reviewerEnv()`: `runReviewPanel`, which runs R2 (the primary and `preReview.fallback`) and R3 (the primary, `formalReview.fallback` and `formalReview.baseSync`), and `runPreReview`. The card runner is unchanged: every one of those reviewers reaches `runReviewPanel`. A reviewer that is not Python (`claude`, `codex`) ignores both variables.
  - R3. On Windows, a Python probe spawned through `runReviewPanel` with the real async runner and `✖ 码 再 运` on stdin shall read those characters intact and report `utf-8` as its stdin encoding; the test is skipped on other platforms.
  - R4. The receipt shape of issue 99 shall be replayed: a scripted reviewer that reads its prompt as Python does without UTF-8 mode (cp1252 with `surrogateescape`, so the UTF-8 bytes 0x81, 0x8D, 0x8F, 0x90 and 0x9D become lone surrogates the API refuses) answers `ERROR 400: ... lone leading surrogate in hex escape ...`, which is a no-verdict (`tool_error`); through the card runner, an R2 round whose diff carries `码 再 运` passes with that reviewer, since it is spawned with the reviewer environment.
  - R5. `docs/OPERATIONS.md` (after the pre-review command paragraph) and `CHANGELOG.md` shall state the rule and its limit. The limit, stated before the first review: a user who sets `PYTHONIOENCODING` to another encoding keeps the failure of issue 99, since their value wins (a user `PYTHONUTF8=0` alone does not: the added `PYTHONIOENCODING=utf-8` still sets the stdin encoding, R2 cycle 0 round 1 advisory); a reviewer that reads its prompt through another runtime decodes it by that runtime's own rules.
acceptance:
  - 1. tests/surface/reviewer-env.test.ts - `reviewerEnv` adds both variables to an environment without them and keeps every other key; keeps a user value (`PYTHONUTF8=0`, `PYTHONIOENCODING=cp1252`); replaces an empty value; on Windows keeps a user value set in another letter case and replaces an empty one spelled so; on Linux adds ours next to a lower-case key; adds `PYTHONIOENCODING=utf-8` next to a user `PYTHONUTF8=0`; with its defaults reads the base as the process platform does; never mutates its input, and the tests never mutate `process.env`. [R1] [dod arm 1]
  - 2. tests/surface/reviewer-env.test.ts and the three scenario files - `runPreReview` and every angle of `runReviewPanel` spawn with an environment deepEqual to `reviewerEnv()`, and through the card runner so do the R2 primary and fallback (tests/scenarios/r2-fallback.test.ts), the R3 primary and fallback (tests/scenarios/r3-fallback.test.ts) and the R3 base-sync reviewer (tests/scenarios/base-sync-review.test.ts). [R2] [dod arm 1]
  - 3. tests/surface/reviewer-env.test.ts and tests/surface/reviewer-env.child.ts - the default-environment scenarios (this item and acceptance 4) run in a child process whose environment has both variables removed in any letter case, once from the process environment and once from a user PYTHONUTF8=0 and PYTHONIOENCODING=cp1252, so the proof never depends on the developer's own values (R3 decision 1); on Windows a Python probe spawned through `runReviewPanel` with the real runner reads `✖ 码 再 运` intact and reports `utf-8`; skipped elsewhere. [R3] [dod arm 1]
  - 4. tests/surface/reviewer-env.child.ts, run by tests/surface/reviewer-env.test.ts - the receipt shape of issue 99 is a no-verdict with `tool_error`; the replaying reviewer answers it when spawned without the reviewer environment and passes with it; through the card runner an R2 round on a diff carrying `码 再 运` passes. [R4] [dod arm 1]
  - 5. docs/OPERATIONS.md and CHANGELOG.md Unreleased carry the rule under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R5] [dod arm 1]
depends_on: []
budget: 360
tdd: true
sweep: "grep -n 'runner(cmd, args' src/review/pre-review.ts: runPreReview (line 835) and runReviewPanel (line 1014) spawn the reviewer with cwd, input, timeoutMs and shell only, so the child inherits the process environment and a Python reviewer on Windows reads its piped prompt with the ANSI code page."
forbid: [weakening or skipping a test to go green (the Windows probe is skipped on other platforms only), a change to aidlc.config.json or its template, a change to src/loop/card-runner.ts, an environment variable other than PYTHONUTF8 and PYTHONIOENCODING, overriding a non-empty value the user set, mutating process.env]
non_goals: [the git and gh probes, the ship paths' own processes, the DoD and verify commands, the reviewer CLIs themselves (the local deepseek wrapper), a per-command env field in the configuration]
diagnosis:
  root_cause: "The reviewer spawns in src/review/pre-review.ts (runPreReview:835, runReviewPanel:1014) pass no env, so the reviewer inherits the process environment. The DeepSeek reviewer is a Python CLI reading its prompt from stdin; on Windows Python decodes a piped stdin with the ANSI code page (cp1252) and surrogateescape unless UTF-8 mode is on, so every non-ASCII character reaches it as mojibake, and the UTF-8 bytes cp1252 leaves undefined (0x81, 0x8D, 0x8F, 0x90, 0x9D; 码, 再 and 运 carry them) become lone surrogates the API rejects with HTTP 400: R2 round 1 of T0-SHIP-FAILING-LINE (candidate a1efe1a) had no verdict on all three angles (issue 99). PYTHONUTF8=1 in the environment fixed the retry."
  same_class: "Every reviewer the loop spawns: R2 primary and fallback, R3 primary, fallback and base-sync, all through runReviewPanel, and runPreReview."
hygiene: "Issue 99, filed from T0-SHIP-FAILING-LINE (goal g-20260927003753-d44c6c). No card-runner.ts edit: every reviewer reaches runReviewPanel in pre-review.ts. Run the mutation sweep over every new branch before the first review; the doc test reads the exact sentences (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS); a new helper gets a seam commit before the RED so the RED fails on assertions (docs/LESSONS.md 2026-09-26 T1-PARSE-GUARD); Windows variable names are matched in any letter case (docs/LESSONS.md 2026-09-15 T0-BIN-STALE-DIST-4). This card's own R2 runs without the PYTHONUTF8=1 workaround, from the candidate's CLI, to prove the fix on the real reviewer."
doc_sync: docs/OPERATIONS.md (pre-review command), CHANGELOG.md
---

# T0-REVIEWER-UTF8

## Deliverable
A Python reviewer on Windows reads the prompt the loop pipes to it as UTF-8, so a prompt with non-ASCII text (the diff, the card, REVIEW.md) reaches it intact and a UTF-8 byte the code page leaves undefined no longer turns the round into a no-verdict.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/reviewer-env.test.ts tests/surface/pre-review.test.ts tests/scenarios/r2-fallback.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/base-sync-review.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
