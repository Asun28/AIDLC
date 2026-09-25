---
id: T0-R3-OPUS-PRIMARY
title: This repository runs its formal review (R3) on a headless Claude Opus 5.5 with no fallback while Codex is unavailable, and the docs keep the Codex gpt-6-sol command as the restore path
status: merged
branch: T0-R3-OPUS-PRIMARY
worktree: D:\wt\AIDLC\T0-R3-OPUS-PRIMARY
allow_paths:
  - aidlc.config.json
  - tests/surface/config.test.ts
  - docs/OPERATIONS.md
  - CLAUDE.md
  - src/review/pre-review.ts
  - CHANGELOG.md
  - specs/tasks/T0-R3-OPUS-PRIMARY.md
dod_command: npm run typecheck && node --test tests/surface/config.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc.config.json` shall run R3 on `claude -p --model claude-opus-5-5 --effort {effort} --tools Read,Grep,Glob --setting-sources= --strict-mcp-config --no-session-persistence` with reviewer `claude-opus-5-5`, the existing effort policy and timeout, and no `formalReview.fallback`.
  - R2. `docs/OPERATIONS.md`, `CLAUDE.md` and the header comment of `src/review/pre-review.ts` shall name Claude Opus 5.5 as this repository's R3 reviewer, and `docs/OPERATIONS.md` shall keep the Codex `gpt-6-sol` command as the documented way to restore Codex as the primary or add it as the fallback.
acceptance:
  - 1. The repository-config test in `tests/surface/config.test.ts` asserts the R1 argv, the reviewer `claude-opus-5-5`, the effort policy (medium; high from 500 changed lines or a change under `src/core`, `src/coordination` or `src/state`), the timeout 1200000, the read-only tool list, no setting sources, no MCP servers, no empty argument and no configured fallback; the template config test is unchanged. [R1] [dod arm 1]
  - 2. `docs/OPERATIONS.md` (Formal review (R3) as a command) shows the new configuration and keeps the Codex command with `"model_reasoning_effort={effort}"` as the restore path; `CLAUDE.md` says this repo uses DeepSeek for R2 and Claude Opus 5.5 for R3; `CHANGELOG.md` Unreleased carries the entry; a test reads the exact sentences this card adds and fails with any one removed. [R2] [dod arm 1]
depends_on: []
budget: 120
tdd: true
sweep: "grep -rn -i 'codex\\|gpt-6-sol' aidlc.config.json docs/OPERATIONS.md CLAUDE.md src/review/pre-review.ts tests/surface/config.test.ts: the formalReview block of aidlc.config.json, the R3 paragraph and JSON block of OPERATIONS.md (:196-:206), CLAUDE.md:88, the pre-review.ts header (:6) and the repository-config test (config.test.ts:95). The template config, the src/config.ts reviewer default and the historical CHANGELOG, plan and state entries keep their Codex text."
non_goals: [changing templates/aidlc.config.json or the src/config.ts defaults, changing the effort policy, removing Codex support from the code, the R2 reviewer]
forbid: [weakening the read-only reviewer flags, an empty argv argument]
hygiene: "User ruling 2026-09-25: Codex is unavailable, so commit the local swap that ran R3 on Opus 5.5 for goals g-20260924103834-4b1732 and g-20260924194613-9be85e. Left uncommitted, the swap kept the committed-config test and the regression eval red in the main checkout."
doc_sync: docs/OPERATIONS.md, CLAUDE.md, CHANGELOG.md
---

# T0-R3-OPUS-PRIMARY

## Deliverable
Codex is unavailable, so this repository's R3 runs on the headless Claude Opus 5.5 reviewer that was its fallback, with no fallback of its own: a Codex fallback would be dispatched on an Opus quota hold and fail. The committed-config test and the docs follow, and OPERATIONS keeps the Codex command for when it returns.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/config.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
