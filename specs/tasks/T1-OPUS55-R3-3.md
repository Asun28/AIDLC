---
id: T1-OPUS55-R3-3
title: R3 runs at an effort chosen per candidate (medium by default, high for a large or core diff, never low) and recorded with the decision, on Codex gpt-6-sol as the primary and headless Claude Opus 5.5 as the fallback, each with its own effort flag (replacement of T1-OPUS55-R3-2 after its two R3 decisions: every branch of the effort selection and its dispatch pinned by a test that turns red when that branch alone is removed)
status: merged
branch: T1-OPUS55-R3-3
worktree: D:\wt\AIDLC\T1-OPUS55-R3-3
allow_paths:
  - src/core/review-effort.ts
  - src/config.ts
  - src/core/types.ts
  - src/loop/card-runner.ts
  - src/review/pre-review.ts
  - tests/core/review-effort.test.ts
  - tests/core/types.test.ts
  - tests/surface/config.test.ts
  - tests/scenarios/r3-fallback.test.ts
  - tests/surface/pre-review.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/scenarios/review-block.test.ts
  - aidlc.config.json
  - templates/aidlc.config.json
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-OPUS55-R3-3.md
dod_command: npm run typecheck && node --test tests/core/review-effort.test.ts tests/surface/config.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/t0-flow.test.ts tests/core/types.test.ts tests/surface/pre-review.test.ts tests/scenarios/review-block.test.ts
dod_exit: 0
requirements:
  - R1. The formal reviewer config (the primary and the fallback) shall accept an optional `effort` object with `default` and an optional `high` rule (`minChangedLines`, `paths`), whose levels are `medium`, `high`, `xhigh` or `max`.
  - R2. WHEN R3 dispatches a reviewer whose argv carries `{effort}`, the loop shall expand it to `high` if the candidate's changed lines (added plus deleted against the base) reach `high.minChangedLines` or a changed path matches `high.paths`, and to `default` otherwise; `default` is `medium` when the object is absent.
  - R3. The formal review invocation record shall carry the effort level the decision ran at, when its argv carried `{effort}`.
  - R4. This repository's R3 primary shall be Codex gpt-6-sol with `-c model_reasoning_effort={effort}`, and its fallback headless Claude Opus 5.5 with `--effort {effort}`.
  - R5. The candidate diff collected for a review shall be taken without colour and without an external diff driver, and a non-empty collected diff with no `diff --git ` section shall select `high`, or the policy default when that is higher, rather than a count of zero.
  - R6. WHERE a changed file is a rename, the effort path rule shall match both its source and its destination path.
acceptance:
  - 1. `selectReviewEffort(policy, { changedLines, changedPaths }, matches)`, with the glob matcher injected so `src/core` imports no outer layer (the loop passes `pathAllowed`), returns `medium` with no policy; the policy's `default` below `high.minChangedLines` with no path matching `high.paths`; `high` when changed lines equal or exceed the threshold; `high` when one changed path matches a `high.paths` glob at any size; the policy's `default` when `high` is absent (review-effort.test.ts). [R1] [R2] [dod arm 1]
  - 2. `FormalReviewConfig` and `FormalReviewFallback` parse an `effort` object and one without it; a level of `low` or an unknown level, a negative or fractional `minChangedLines`, and a `default` of `xhigh` or `max` together with a `high` rule (the rule would lower the level for a large or core diff; R3 decision 1 advisory) fail to parse with a ZodError naming the path (config.test.ts). [R1] [dod arm 1]
  - 3. An R3 dispatch whose primary argv carries `--effort {effort}` runs the reviewer with `--effort medium` for a small candidate and `--effort high` for a candidate whose changed lines reach the threshold, the changed lines counted from the pinned candidate diff the reviewer receives (`<base>...<candidateSha>`, `--text`), so a binary-treated file counts its shown hunks and a moved HEAD changes nothing, and the stored `ReviewInvocation` carries `effort` equal to the level passed; an argv that carries `{effort}` inside a longer argument (`-c model_reasoning_effort={effort}`, the Codex primary form) receives `model_reasoning_effort=high` for a candidate reaching the threshold and `model_reasoning_effort=medium` for a small one and records that level (R3 decision 1 of T1-OPUS55-R3-2); an argv without `{effort}` records no `effort` and is passed unchanged; a fallback dispatch uses the fallback's own `effort` policy (r3-fallback.test.ts). [R2] [R3] [dod arm 1]
  - 4. `ReviewInvocation` parses a record with `effort` and a record without it (types.test.ts). [R3] [dod arm 1]
  - 5. `aidlc.config.json` keeps `formalReview.reviewer` `codex` with the command `codex exec -m gpt-6-sol -c model_reasoning_effort={effort} --sandbox read-only --output-schema {schema}` and keeps `fallback.reviewer` `claude-opus-5-5` with `--effort {effort}` in place of `--effort max` and every other argument unchanged (read-only tools, `--setting-sources=`, `--strict-mcp-config`, `--no-session-persistence`); both carry `effort` `{ "default": "medium", "high": { "minChangedLines": 500, "paths": ["src/core/**", "src/coordination/**", "src/state/**"] } }`; `templates/aidlc.config.json` gains only `formalReview.effort` `{ "default": "medium" }`, its command and reviewer unchanged (config.test.ts). [R4] [dod arm 1]
  - 6. `docs/OPERATIONS.md` documents the `effort` object, the `{effort}` placeholder, the effort flag each reviewer of this repository receives (Codex `-c model_reasoning_effort`, Claude `--effort`); `docs/ARCHITECTURE.md` names `src/core/review-effort.ts`; CHANGELOG.md Unreleased carries the entry. [R1] [R4] [dod arm 1]
  - 7. `collectCandidateDiff` runs `git diff` with `--text --no-color --no-ext-diff --no-textconv` on `<base>...<candidateSha>`, so the diff the reviewer receives and the diff the level is counted from carry no colour escapes and no external-driver output under any user git configuration (`color.ui=always`, `diff.external`, `GIT_EXTERNAL_DIFF`, a `textconv` driver); a non-empty collected diff with no `diff --git ` section selects `high`, or the policy default when that is higher (a decorated diff never lowers the level), never a count of zero, and a colour-escaped diff fixture is a case of it under a `medium`, an `xhigh` and a `max` default (`high`, `xhigh`, `max`) (pre-review.test.ts asserts the argv of the diff call; review-effort.test.ts the fail-closed case). [R5] [dod arm 1]
  - 8. An r3-fallback scenario on a repository with `isGit: true` whose runner answers `git diff` of `main...sha-1` with a diff reaching the threshold and `git diff` of `main...HEAD` with a small diff dispatches `--effort high`, so counting any range but the pinned candidate turns it red; a hunk carrying NUL bytes goes through the same dispatch and is counted (r3-fallback.test.ts). [R2] [R5] [dod arm 1]
  - 9. A candidate that renames a file out of `src/core/**` with fewer lines than the threshold selects `high`: the path rule matches the `rename from` source paths of the pinned diff as well as the changed paths (review-effort.test.ts, r3-fallback.test.ts). [R6] [dod arm 1]
  - 10. `ReviewEffortLevel` is derived from `EffortLevel` without `low` (one list of level names); the no-newline marker fixture in review-effort.test.ts carries a real backslash; docs/OPERATIONS.md says the level is counted from the pinned `--text` diff collected for the review (a reviewer whose argv carries `{instructions}` receives a diff command, not that text) (types.test.ts, review-effort.test.ts, config.test.ts doc test). [R1] [dod arm 1]
  - 11. `selectReviewEffortFromDiff` selects `high` for a two-line undecorated diff of `src/core/x.ts` with changed paths `['src/core/x.ts']` (a plain edit, no rename), and for a rename from `src/loop/a.ts` to `src/core/a.ts` with changed paths `['src/core/a.ts']` (the destination side); an r3-fallback dispatch with `SMALL_DIFF` and a policy whose `high.paths` names the card's changed path (no rename) passes `--effort high` and records `high`; each case turns red when the changed paths alone are dropped from the path rule or from the dispatch (review-effort.test.ts, r3-fallback.test.ts). [R2] [R6] [dod arm 1]
  - 12. Every branch of `src/core/review-effort.ts` (`countDiffLines`, `renameSources`, `selectReviewEffort`, `selectReviewEffortFromDiff`) and of the effort block of the formal dispatch in `src/loop/card-runner.ts` (placeholder detection, the level passed, the level recorded on each invocation write) has a test that turns red when that branch alone is removed or inverted; the ship evidence carries the table of branches, the mutation applied and the test that went red (review-effort.test.ts, r3-fallback.test.ts). [R1] [R2] [R3] [R5] [R6] [dod arm 1]
  - 13. Test hygiene: the r3-fallback retained-result helper cleans its fixture directory and lock file in a `finally` even when its own assertions fail; no unit case selects from a policy the schema refuses (the below-threshold case uses a policy `ReviewEffortPolicy` parses) (r3-fallback.test.ts, review-effort.test.ts). [dod arm 1]
depends_on: []
plan_ref: plans/opus-5-5.md#7
budget: 640
tdd: true
freeze: true
sweep: "grep -rn 'formalReview\|expandCommand\|numstat\|ReviewInvocation = ' src/: the config schema (config.ts:33-45), the R3 argv vars (card-runner.ts:1484), the numstat probe (git.ts:141), the invocation schema (types.ts:282)"
non_goals: [changing the effort between decision 1 and decision 2, low effort for R3, effort for R2, changing the template's formal reviewer command or reviewer, the reviewer prompt text (T1-OPUS55-PROMPTS), the role defaults and API provider (T1-OPUS55-MODELS)]
forbid: [changing the review allowances or the verdict schema, changing the fallback dispatch rules of T0-R3-FALLBACK-2]
hygiene: "The level is chosen from the added and deleted lines of the pinned candidate diff the reviewer receives, so a retry of the same candidate runs at the same level and the count never measures a moved HEAD (R3 decision 1). Codex stays the primary (engineer ruling 2026-09-24); while Codex is on a quota hold the Opus fallback reviews, so author and reviewer share the Claude family for that period, which the spec flags. Low is kept out of R3: it is the last review before the merge, and the engineer's effort table gives low to formatting, renames and simple scripts. Supersedes T1-OPUS55-R3 (branch T1-OPUS55-R3, candidate a78d071, STOP/review after R3 decision 2 blocked on two findings: the count's range was unpinned by any test because the harness runs with isGit false and answers every git diff range alike, and the porcelain diff taken under the user's git configuration can be coloured or produced by an external driver, which counted zero). This card re-applies that branch's change on main and adds R5, R6 and acceptance 7-10. The budget is 560 because the re-applied change is 384 net lines, most of them tests; the new work is about 150 lines. The old branch and worktree are removed at CLOSE. Supersedes T1-OPUS55-R3-2 (branch T1-OPUS55-R3-2, candidate e00b0d8, STOP/review after R3 decision 2 blocked on two test gaps with the code correct: no case selects high through a plain changed path under src/core or a rename destination, and no dispatch matches high.paths through the changed paths rather than a rename source). Engineer ruling 2026-09-24: option 2, a successor that adds the tests. This card re-applies that branch at e00b0d8 and adds acceptance 11-13; acceptance 12 asks for a branch-by-branch mutation table so no rule of the feature is left unpinned. Budget 640: 511 net re-applied plus tests. The old branch and worktree are removed at CLOSE."
doc_sync: docs/OPERATIONS.md (Formal review), docs/ARCHITECTURE.md (core module list), CHANGELOG.md
---

# T1-OPUS55-R3-3

## Deliverable
R3 runs every candidate at one fixed effort: Codex at its own default, the Claude Opus 5.5 fallback at `--effort max`. The Opus 5.5 guides say `medium` (the model's default) already matches Opus 5 at `high` on coding work and that `xhigh` and `max` are for measured gains; the engineer's rule is medium by default, raised for hard work. This card adds an `{effort}` argv placeholder that the loop expands per candidate from each reviewer's own `effort` policy: `medium` by default, `high` when the diff reaches 500 changed lines or touches `src/core`, `src/coordination` or `src/state`. Codex stays the primary with `-c model_reasoning_effort={effort}`, Opus 5.5 stays the fallback with `--effort {effort}`. The level is stored on the invocation record, so review statistics can later compare levels.

This card replaces T1-OPUS55-R3, stopped after its second R3 decision. It re-applies that change and fixes the two blocking findings: the review diff is taken with `--no-color --no-ext-diff` and an undecorated diff that yields no file section selects `high`, and a scenario with git on pins the counted range to the candidate. It also matches rename sources in the path rule.

This card replaces T1-OPUS55-R3-2, stopped after its second R3 decision on two test gaps. It re-applies that change and adds the missing path-rule tests, the test hygiene fixes and a branch-by-branch mutation check of the effort selection and its dispatch.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/review-effort.test.ts tests/surface/config.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/t0-flow.test.ts tests/core/types.test.ts tests/surface/pre-review.test.ts tests/scenarios/review-block.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
