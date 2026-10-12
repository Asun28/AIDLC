---
slug: evals-no-key
title: The agent-evals workflow needs no ANTHROPIC_API_KEY; model-backed evals run locally on the Claude Code CLI login
intent: intent/evals-no-key.md
status: accepted
created: 2026-10-12T00:55:47Z
skills_applied: []
---

# Spec: The agent-evals workflow needs no ANTHROPIC_API_KEY
From intent: intent/evals-no-key.md. Status: accepted. Skills applied: (none).

## Requirements (EARS)
- R1. The `evals` job of the agent-evals workflow and of its template shall run `npx aidlc evals run --skip-model --threshold 0.9 --json > evals-result.json` with no `ANTHROPIC_API_KEY` reference, no Claude Code install and no skip step.
- R2. The evals README, its template and the Evals section of `docs/OPERATIONS.md` shall state that CI runs the deterministic checks with no model and no credentials and that the model-backed run is local through the Claude Code CLI login.

## Design
R1: the job loses its `env` block, the `Install Claude Code` step, the
`ANTHROPIC_API_KEY` step env and the `Evals skipped` step; its run step
uses `--skip-model`, under which `runEval` calls no provider
(`src/evals/runner.ts:74`). R2: text.

## Interfaces and contracts
- None. `aidlc evals run` and its options are unchanged.

## Data model and migration impact
None.

## Flagged concerns (route to policy owners)
- (none)

## Non-goals
- Running a model in CI (a CLI login token secret was not asked for).
- Changing the `claude-api` provider or its key detection.

## Acceptance
- 1. Both workflow files are identical, run the R1 command and name neither `ANTHROPIC_API_KEY` nor `claude-code`. [R1]
- 2. The two READMEs and OPERATIONS name `--skip-model` for CI and `--provider claude-code` for the local run. [R2]
