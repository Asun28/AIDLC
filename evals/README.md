# evals/ (Stage 4: continuous evals)

Agent configuration (CLAUDE.md, skills, hooks, agents, model) is regression-
tested like code. Each eval is one JSON file: a prompt plus deterministic
checks that exit 0/1. No model-graded opinions.

- Fields: `id`, `dimension` (functional | security | frontend-behavior |
  backend-mcp | policy | regression), `prompt`, `allowedTools`, `role`,
  `effort`, `checks[]`, `origin`.
- Checks: `command` (argv + expected exit), `contains` / `not-contains`
  (file text), `output-matches` (regex on the model output), `json-field`.
- CI runs `aidlc evals run --skip-model --threshold 0.9` on changes to
  CLAUDE.md, `.claude/**`, `evals/**` and REVIEW.md, and nightly: the
  deterministic checks only, with no model and no credentials. The pass
  rate gates the change. Under `--skip-model` the `output-matches` and
  `json-field` checks see no model output and fail.
- Run the model-backed suite locally:
  `aidlc evals run --provider claude-code --threshold 0.9` calls the
  `claude` CLI, which uses your Claude Code CLI login; no API key is needed.
- Every production incident becomes a permanent eval (`dimension:
  regression`, `origin: <incident or intent>`).

Start with 20-50 real tasks with known outcomes; grow from defects.
