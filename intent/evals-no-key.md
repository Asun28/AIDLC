---
slug: evals-no-key
title: The agent-evals workflow needs no ANTHROPIC_API_KEY; model-backed evals run locally on the Claude Code CLI login
author: asun28 (engineer)
status: accepted
created: 2026-10-12T00:55:47Z
source: human
---

# Intent: The agent-evals workflow needs no ANTHROPIC_API_KEY
Author: asun28 (engineer). Status: accepted.

## Problem
Card T1-SWEEP-FLAGS-2 (PR #154) made the `evals` job of
`.github/workflows/agent-evals.yml` and its template install Claude Code and
run `aidlc evals run --provider claude-code` only when the repository has an
`ANTHROPIC_API_KEY` secret, and print a skip warning otherwise. The owner
uses Claude Code through its built-in CLI login, not an API key, and asked
(2026-10-12) for no `gh secret set ANTHROPIC_API_KEY` and for the key to be
removed. A GitHub-hosted runner has no CLI login, so without a key the job
runs no eval check at all.

## Proposed outcome
- The workflow and its template reference no `ANTHROPIC_API_KEY` secret and
  install no Claude Code.
- CI runs the suite's deterministic checks with no model and no credentials:
  `aidlc evals run --skip-model --threshold 0.9`.
- The model-backed run is local: `aidlc evals run --provider claude-code
  --threshold 0.9` uses the Claude Code CLI login of whoever runs it.
- `evals/README.md`, its template and `docs/OPERATIONS.md` say both.

## Affected users and systems
`.github/workflows/agent-evals.yml`, `templates/github/workflows/agent-evals.yml`,
`evals/README.md`, `templates/evals/README.md`, `docs/OPERATIONS.md`,
`tests/surface/command-lines.test.ts`, `CHANGELOG.md`.

## Constraints
- No repository secret is added.
- The eval threshold stays 0.9; no CLI option is added.
- The `claude-api` provider and its key detection are unchanged.

## Open questions
- (none)
