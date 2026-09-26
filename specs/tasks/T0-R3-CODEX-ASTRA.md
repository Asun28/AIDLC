---
id: T0-R3-CODEX-ASTRA
title: This repository runs its formal review (R3) on Codex gpt-6-astra at medium effort with the headless Claude Opus 5.5 as its fallback, and the base-sync reviewer takes a name of its own
status: merged
branch: T0-R3-CODEX-ASTRA
worktree: D:\wt\AIDLC\T0-R3-CODEX-ASTRA
allow_paths:
  - aidlc.config.json
  - tests/surface/config.test.ts
  - tests/scenarios/base-sync-review.test.ts
  - docs/OPERATIONS.md
  - CLAUDE.md
  - src/review/pre-review.ts
  - CHANGELOG.md
  - specs/tasks/T0-R3-CODEX-ASTRA.md
dod_command: npm run typecheck && node --test tests/surface/config.test.ts tests/scenarios/base-sync-review.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc.config.json` shall run R3 on `codex exec -m gpt-6-astra -c model_reasoning_effort={effort} --sandbox read-only --output-schema {schema}` with reviewer `codex`, timeout 1200000, maxDiffBytes 800000 and the effort policy `{ "default": "medium" }` with no `high` rule.
  - R2. `aidlc.config.json` shall configure `formalReview.fallback` as the headless Claude Opus 5.5 reviewer that R3 runs on today: the same argv, reviewer `claude-opus-5-5`, timeout 1200000, maxDiffBytes 800000 and the current effort policy (medium; high from 500 changed lines or a change under `src/core`, `src/coordination` or `src/state`) as `formalReview.fallback.effort`.
  - R3. `aidlc.config.json` shall name the base-sync reviewer `codex-base-sync` with its command and effort unchanged, since the configuration refuses a base-sync reviewer named like the primary.
  - R4. `docs/OPERATIONS.md`, `CLAUDE.md` and the header comment of `src/review/pre-review.ts` shall name Codex gpt-6-astra as this repository's R3 reviewer and Opus 5.5 as its fallback, and `docs/OPERATIONS.md` shall state that `gpt-6-sol` is refused for a Codex login with a ChatGPT account and name the base-sync reviewer `codex-base-sync`.
acceptance:
  - 1. The repository-config test in `tests/surface/config.test.ts` asserts the R1 argv, the reviewer `codex`, the timeout 1200000, the maxDiffBytes 800000, the effort `{ default: 'medium' }` with no `high` rule, the read-only sandbox, the output schema placeholder and no empty argument. [R1] [dod arm 1]
  - 2. The same test asserts the fallback: the Opus 5.5 argv unchanged, the reviewer `claude-opus-5-5`, the timeout, the maxDiffBytes, the effort policy of R2, the Read, Grep and Glob tool list, no setting sources, no MCP servers and no empty argument. [R2] [dod arm 1]
  - 3. The base-sync repository test asserts the reviewer `codex-base-sync` with the command and the medium effort unchanged, and `ProjectConfig.parse` accepts the repository config, so the three reviewer names differ; the base-sync doc test in `tests/scenarios/base-sync-review.test.ts` reads the reviewer `codex-base-sync` in the OPERATIONS sentence; the template config tests are unchanged. [R3] [dod arm 1]
  - 4. `docs/OPERATIONS.md` (Formal review (R3) as a command, and the base-sync paragraph), `CLAUDE.md` and `CHANGELOG.md` Unreleased carry the new configuration; a test reads the exact sentences this card adds and fails with any one removed. [R4] [dod arm 1]
depends_on: []
budget: 120
tdd: true
sweep: "grep -rn -i 'opus 5.5\\|claude-opus-5-5\\|gpt-6-sol\\|gpt-6-astra\\|\"codex\"' aidlc.config.json CLAUDE.md docs/OPERATIONS.md src/review/pre-review.ts tests/surface/config.test.ts: the formalReview block of aidlc.config.json (:69-:113), CLAUDE.md:88, the R3 paragraph and JSON block of OPERATIONS.md (:222-:236), the base-sync paragraph (OPERATIONS.md:242), the pre-review.ts header (:6), the repository-config tests (config.test.ts:95-:129 and :240-:247) and the base-sync doc sentence test (base-sync-review.test.ts:268), which pins reviewer `codex`. The src/config.ts reviewer-name rule (:123-:132) refuses a base-sync reviewer named like the primary. The template config, the src/config.ts defaults, ARCHITECTURE.md's provider default and the historical CHANGELOG, card and state entries keep their text."
non_goals: [changing templates/aidlc.config.json or the src/config.ts defaults, changing the reviewer code, the R2 reviewer, the base-sync reviewer's command]
forbid: [weakening the read-only reviewer flags, an empty argv argument, a fallback on the same Codex account as the primary]
hygiene: "User ruling 2026-09-26: run R3 on Codex with medium effort. gpt-6-sol was probed on 2026-09-26 and refused ('The gpt-6-sol model is not supported when using Codex with a ChatGPT account'); gpt-6-astra answered. Replaces the assertions of T0-R3-OPUS-PRIMARY (R3 on Opus with no fallback) and moves the effort object into formalReview.fallback.effort as issue #43 asks. This card's own R3 runs on the committed main config (Opus 5.5), since the CLI reads aidlc.config.json from the main checkout."
doc_sync: docs/OPERATIONS.md, CLAUDE.md, CHANGELOG.md
---

# T0-R3-CODEX-ASTRA

## Deliverable
R3 returns to Codex, on the model this account can run: `gpt-6-astra` at medium effort, with the headless Claude Opus 5.5 reviewer as the fallback that runs while Codex holds a quota. The base-sync reviewer keeps its Codex command under the name `codex-base-sync`, because the primary now uses `codex`. The committed-config tests and the docs follow.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/config.test.ts tests/scenarios/base-sync-review.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
