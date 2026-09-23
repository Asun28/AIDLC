---
id: T1-OPUS55-R3
title: R3 runs on headless Claude Opus 5.5 at an effort chosen per candidate (medium by default, high for a large or core diff, never low) and recorded with the decision; Codex gpt-6-sol stays configured as the fallback
status: todo
branch: T1-OPUS55-R3
worktree: D:\wt\AIDLC\T1-OPUS55-R3
allow_paths:
  - src/core/review-effort.ts
  - src/config.ts
  - src/core/types.ts
  - src/loop/card-runner.ts
  - tests/core/review-effort.test.ts
  - tests/surface/config.test.ts
  - tests/scenarios/r3-fallback.test.ts
  - aidlc.config.json
  - templates/aidlc.config.json
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-OPUS55-R3.md
dod_command: npm run typecheck && node --test tests/core/review-effort.test.ts tests/surface/config.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/t0-flow.test.ts tests/core/types.test.ts
dod_exit: 0
requirements:
  - R1. The formal reviewer config (the primary and the fallback) shall accept an optional `effort` object with `default` and an optional `high` rule (`minChangedLines`, `paths`), whose levels are `medium`, `high`, `xhigh` or `max`.
  - R2. WHEN R3 dispatches a reviewer whose argv carries `{effort}`, the loop shall expand it to `high` if the candidate's changed lines (added plus deleted against the base) reach `high.minChangedLines` or a changed path matches `high.paths`, and to `default` otherwise; `default` is `medium` when the object is absent.
  - R3. The formal review invocation record shall carry the effort level the decision ran at, when its argv carried `{effort}`.
  - R4. This repository's R3 primary shall be headless Claude Opus 5.5 with `--effort {effort}`, and its fallback Codex gpt-6-sol.
acceptance:
  - 1. `selectReviewEffort(policy, { changedLines, changedPaths })` returns `medium` with no policy; the policy's `default` below `high.minChangedLines` with no path matching `high.paths`; `high` when changed lines equal or exceed the threshold; `high` when one changed path matches a `high.paths` glob (the `pathAllowed` matcher) at any size; the policy's `default` when `high` is absent (review-effort.test.ts). [R1] [R2] [dod arm 1]
  - 2. `FormalReviewConfig` and `FormalReviewFallback` parse an `effort` object and one without it; a level of `low` or an unknown level, a negative or fractional `minChangedLines` fail to parse with a ZodError naming the path (config.test.ts). [R1] [dod arm 1]
  - 3. An R3 dispatch whose primary argv carries `--effort {effort}` runs the reviewer with `--effort medium` for a small candidate and `--effort high` for a candidate whose numstat reaches the threshold, and the stored `ReviewInvocation` carries `effort` equal to the level passed; an argv without `{effort}` records no `effort` and is passed unchanged; a fallback dispatch uses the fallback's own `effort` policy (r3-fallback.test.ts). [R2] [R3] [dod arm 1]
  - 4. `ReviewInvocation` parses a record with `effort` and a record without it (types.test.ts). [R3] [dod arm 1]
  - 5. `aidlc.config.json` has `formalReview.reviewer` `claude-opus-5-5`, a command starting `claude -p --model claude-opus-5-5 --effort {effort}` with the read-only tool, `--setting-sources=`, `--strict-mcp-config` and `--no-session-persistence` arguments of the former fallback, `effort` `{ "default": "medium", "high": { "minChangedLines": 500, "paths": ["src/core/**", "src/coordination/**", "src/state/**"] } }`, and `fallback` the former Codex primary (`codex exec -m gpt-6-sol --sandbox read-only --output-schema {schema}`, reviewer `codex`); `templates/aidlc.config.json` gains only `formalReview.effort` `{ "default": "medium" }`, its command and reviewer unchanged (config.test.ts). [R4] [dod arm 1]
  - 6. `docs/OPERATIONS.md` documents the `effort` object, the `{effort}` placeholder, this repository's Opus-primary and Codex-fallback arrangement and how to restore Codex (swap the two blocks); `docs/ARCHITECTURE.md` names `src/core/review-effort.ts`; CHANGELOG.md Unreleased carries the entry. [R1] [R4] [dod arm 1]
depends_on: []
plan_ref: plans/opus-5-5.md#7
budget: 400
tdd: true
freeze: true
sweep: "grep -rn 'formalReview\|expandCommand\|numstat\|ReviewInvocation = ' src/: the config schema (config.ts:33-45), the R3 argv vars (card-runner.ts:1484), the numstat probe (git.ts:141), the invocation schema (types.ts:282)"
non_goals: [changing the effort between decision 1 and decision 2, low effort for R3, effort for R2, changing the template's formal reviewer command or reviewer, the reviewer prompt text (T1-OPUS55-PROMPTS), the role defaults and API provider (T1-OPUS55-MODELS)]
forbid: [changing the review allowances or the verdict schema, changing the fallback dispatch rules of T0-R3-FALLBACK-2]
hygiene: "The level is chosen from the candidate's own numstat against the base the decision is bound to, so a retry of the same candidate runs at the same level. Codex is kept as the fallback so restoring it as primary is a config swap with no code change. Author and reviewer share the Claude family while Codex is out; the spec flags this and the engineer accepted it."
doc_sync: docs/OPERATIONS.md (Formal review), docs/ARCHITECTURE.md (core module list), CHANGELOG.md
---

# T1-OPUS55-R3

## Deliverable
R3 runs on Codex, which is out of quota, and Claude Opus 5.5 runs only as its fallback at `--effort max` for every candidate. The Opus 5.5 guides say `medium` (the model's default) already matches Opus 5 at `high` on coding work and that `xhigh` and `max` are for measured gains. This card makes Opus 5.5 the primary R3 reviewer, keeps Codex as the fallback, and adds an `{effort}` argv placeholder that the loop expands per candidate: `medium` by default, `high` when the diff reaches 500 changed lines or touches `src/core`, `src/coordination` or `src/state`. The level is stored on the invocation record, so review statistics can later compare levels.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/review-effort.test.ts tests/surface/config.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/t0-flow.test.ts tests/core/types.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
