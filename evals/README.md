# evals/ (Stage 4: continuous evals)

Agent configuration (CLAUDE.md, skills, hooks, agents, model) is regression-
tested like code. Each eval is one JSON file: a prompt plus deterministic
checks that exit 0/1. No model-graded opinions.

- Fields: `id`, `dimension` (functional | security | frontend-behavior |
  backend-mcp | policy | regression), `prompt`, `allowedTools`, `role`,
  `effort`, `checks[]`, `origin`.
- Checks: `command` (argv + expected exit), `contains` / `not-contains`
  (file text), `output-matches` (regex on the model output), `json-field`.
- Run: `aidlc evals run --threshold 0.9` (CI runs it on changes to CLAUDE.md,
  `.claude/**`, `evals/**` and nightly). The pass rate gates the change.
- Every production incident becomes a permanent eval (`dimension:
  regression`, `origin: <incident or intent>`).

Start with 20-50 real tasks with known outcomes; grow from defects.
