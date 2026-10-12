---
slug: evals-no-key
title: The agent-evals workflow needs no ANTHROPIC_API_KEY; model-backed evals run locally on the Claude Code CLI login
spec: specs/evals-no-key.md
size: T1
status: draft
created: 2026-10-12T00:55:47Z
---

# Plan: The agent-evals workflow needs no ANTHROPIC_API_KEY (from specs/evals-no-key.md)

## 1. Goal and boundaries
One card, one PR. Cut: a model run in CI, the `claude-api` provider.

## 2. Minimal acceptable loop
The card merges on its own PR; the `evals` check of that PR runs the new
step, because the card edits `evals/README.md`.

## 3. Tech stack
none this version

## 4. Directory structure
none this version

## 4.5 Module design
- Workflows, the evals READMEs, OPERATIONS: text.

## 5. Data model and state machine
none this version

## 6. Contracts and core interfaces
none this version

## Files that change
- .github/workflows/agent-evals.yml
- templates/github/workflows/agent-evals.yml
- evals/README.md
- templates/evals/README.md
- docs/OPERATIONS.md
- tests/surface/command-lines.test.ts
- CHANGELOG.md

## Order of work
1. T1-EVALS-NO-KEY: the eval job runs the deterministic checks with no key; the docs name the local model run.

## 7. Task split (dependencies and parallel windows)

| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-EVALS-NO-KEY | MUST | eval job with no key on `--skip-model`; local model run documented | - | W1 | - |

## Risks
- CI no longer exercises the model half of an eval (`output-matches`,
  `json-field` checks read empty output under `--skip-model`). The current
  suite has one `command` check only; a future model-graded case fails CI
  until it is run locally instead, which the README states.

## Proof
- tests/surface/command-lines.test.ts: the workflow step lines and the doc sentences.
- The PR's `evals` check concludes success on the `--skip-model` run.

## 10. After merge
none this version (development-only target)
