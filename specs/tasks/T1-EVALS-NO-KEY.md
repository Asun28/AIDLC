---
id: T1-EVALS-NO-KEY
title: The agent-evals job runs the deterministic eval checks with no ANTHROPIC_API_KEY, and the docs name the local Claude Code run
status: merged
branch: T1-EVALS-NO-KEY
worktree: D:\wt\AIDLC\T1-EVALS-NO-KEY
plan_ref: plans/evals-no-key.md#order-of-work
allow_paths:
  - .github/workflows/agent-evals.yml
  - templates/github/workflows/agent-evals.yml
  - evals/README.md
  - templates/evals/README.md
  - docs/OPERATIONS.md
  - tests/surface/command-lines.test.ts
  - CHANGELOG.md
  - specs/tasks/T1-EVALS-NO-KEY.md
dod_command: npm run typecheck && node --test tests/surface/command-lines.test.ts tests/infra/init.test.ts && node bin/aidlc.js evals run --skip-model --threshold 0.9
dod_exit: 0
requirements:
  - R1. The `evals` job of `.github/workflows/agent-evals.yml` and of `templates/github/workflows/agent-evals.yml` (kept identical) shall run the step `Run eval checks` as `npx aidlc evals run --skip-model --threshold 0.9 --json > evals-result.json`, with no job `env` block, no `Install Claude Code` step, no `Evals skipped` step and no line naming `ANTHROPIC_API_KEY`, `HAS_ANTHROPIC_KEY`, `claude-code` or `AIDLC_PROVIDER`.
  - R2. `evals/README.md` and `templates/evals/README.md` (kept identical) and the Evals section of `docs/OPERATIONS.md` shall state that CI runs `aidlc evals run --skip-model --threshold 0.9`, the deterministic checks with no model and no credentials, and that the model-backed run is `aidlc evals run --provider claude-code --threshold 0.9`, run locally on the Claude Code CLI login.
  - R3. The CHANGELOG Unreleased section shall carry an entry naming this card and T1-SWEEP-FLAGS-2.
acceptance:
  - 1. `tests/surface/command-lines.test.ts`: the two workflow files are byte-identical; the `Run eval checks` step is exactly `- name: Run eval checks` and the R1 `run:` line; the files contain none of `ANTHROPIC_API_KEY`, `HAS_ANTHROPIC_KEY`, `claude-code`, `AIDLC_PROVIDER`, `Install Claude Code` or `Evals skipped`, and exactly one `npx aidlc evals run` line. [R1] [dod arm 2]
  - 2. The same file: the two READMEs are byte-identical; each, and the OPERATIONS Evals section, names `aidlc evals run --skip-model --threshold 0.9` and `aidlc evals run --provider claude-code --threshold 0.9` and the words `Claude Code CLI login`. [R2] [dod arm 2]
  - 3. The same file reads a T1-EVALS-NO-KEY entry in the CHANGELOG Unreleased section naming T1-SWEEP-FLAGS-2. [R3] [dod arm 2]
  - 4. `tests/infra/init.test.ts` passes unchanged, and `aidlc evals run --skip-model --threshold 0.9` over this repository's `evals/` exits 0. [R1] [dod arms 3, 4]
depends_on: []
budget: 120
tdd: true
sweep: "grep -rn 'ANTHROPIC_API_KEY\|HAS_ANTHROPIC_KEY' outside .aidlc on main at 82395c3: the two workflow files (lines 21-38), tests/surface/command-lines.test.ts:42-54 (the T1-SWEEP-FLAGS-2 acceptance 1 test), src/providers/claude-api.ts:59-60 and tests/surface/providers.test.ts:106-115 (the claude-api provider, out of scope), tests/surface/hooks.test.ts:157 (secrets-guard fixture), and history records that stay as written: CHANGELOG.md:11, docs/LESSONS.md:69, intent/loop-integration.md:39, plans/loop-integration.md:13, plans/dead-code-sweep.md:88, specs/tasks/T1-SWEEP-FLAGS-2.md. grep -n 'evals run' README.md docs evals templates/evals CLAUDE.md: evals/README.md:12 and its template, docs/OPERATIONS.md:313,316, CLAUDE.md:149 and templates/CLAUDE.aidlc.md (the generic command, unchanged)."
forbid: [adding a repository secret, adding a CLI option, changing the eval threshold, changing src/]
non_goals: ["a model run in CI", "the claude-api provider and its key detection", "rewriting the T1-SWEEP-FLAGS-2 CHANGELOG entry or lesson"]
hygiene: "User ruling 2026-10-12, after T1-SWEEP-FLAGS-2 merged: no `gh secret set ANTHROPIC_API_KEY`; the owner runs Claude Code on its built-in CLI login, so the key goes. A hosted runner has no CLI login, so CI keeps the credential-free half of the suite (`--skip-model`). This replaces the T1-SWEEP-FLAGS-2 acceptance 1 test in tests/surface/command-lines.test.ts, whose key-gated steps are the behaviour this card removes; acceptance 2-4 of that card stay as they are."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T1-EVALS-NO-KEY

## Deliverable
The eval CI job runs every deterministic eval check on each matching PR and nightly with no API key or other credential, and the docs say the model-backed run is local on the Claude Code CLI login.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/command-lines.test.ts tests/infra/init.test.ts && node bin/aidlc.js evals run --skip-model --threshold 0.9
```
- Expected exit code: 0
- Assertion: every listed test passes, the typecheck is clean, and the eval gate passes with no model.
