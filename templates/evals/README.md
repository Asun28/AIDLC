# evals/ (Stage 4: continuous evals)

Agent configuration (CLAUDE.md, skills, hooks, agents, model) is regression-
tested like code. Each eval is one JSON file: a prompt plus deterministic
checks that exit 0/1. No model-graded opinions.

- Fields: `id`, `dimension` (functional | security | frontend-behavior |
  backend-mcp | policy | regression), `prompt`, `allowedTools`, `role`,
  `effort`, `checks[]`, `origin`.
- Checks: `command` (argv + expected exit), `contains` / `not-contains`
  (file text), `output-matches` (regex on the model output), `json-field`.
- Tool-call checks read the tool calls the model made, not its text:
  `read-file` (`path`: a `Read` tool call whose `file_path` resolves to
  that repository-relative path), `ran-command` (`pattern`: a `Bash` or
  `PowerShell` tool call whose `command` matches the regex),
  `not-ran-command` (`pattern`: none matches) and `not-wrote-path`
  (`pattern`: no `Edit`, `Write` or `NotebookEdit` tool call whose path
  matches). Paths compare without letter case on Windows. A case with one
  of them makes the `claude-code` provider run with `--output-format
  stream-json --verbose` to record the tool calls. Under `--skip-model`
  each fails with `no model run`; it never passes without a model run.
- A model-backed case runs in a detached temporary checkout of HEAD under
  the OS temp directory, with the main checkout's `node_modules` linked
  in and `AIDLC_STATE_DIR` set to a new empty temporary directory; the
  model and every check run there, and the link, the checkout and the
  state directory are removed afterwards, also when the model or a check
  fails. A removal failure is named in the result's `detail`.
  `aidlc evals run` evaluates the worktree it is run from: its cases,
  its HEAD for the temporary checkout, and its working tree under
  `--skip-model`; the `node_modules` link and the `.aidlc` protection use
  the main checkout. Under `--skip-model` the checks run in that worktree,
  and command checks still get a new empty temporary `AIDLC_STATE_DIR`,
  removed afterwards.
- A prompt must not name the measurement: `aidlc evals run` refuses a case
  whose prompt contains `eval`, `evals`, `judge`, `rubric`, `grader`,
  `benchmark`, `experiment` or `score` as a whole word in any letter case,
  naming the case id and the word. The id, file name and `origin` are not
  checked.
- Case paths: a `command` check's `cwd` or a `contains` / `not-contains`
  check's `file` that is absolute, has a `..` segment or starts with
  `.aidlc` is refused when the cases load, naming the case id and the
  field. When a check runs, a target whose real path (or that of its
  nearest existing parent) is outside the working directory or under its
  `.aidlc` fails the check, and nothing is read or run.
- `aidlc evals run` refuses a `--dir` whose real path is inside the
  configured state directory or the repository's `.aidlc/`, and a case
  file whose real path is inside either of them is refused before it is
  read; each refusal names the path.
- Limits: the runner does not sandbox a case's own `command` argv, which
  can name any absolute path, since a case file is code in the repository
  and is reviewed like code. It does not block a model tool call that
  reads outside its checkout by an absolute path; Claude Code limits writes
  to its working directory, and `not-wrote-path` checks the writes.
- Agent cases live in `evals/agent/`, each with a tool-call check and an
  `origin` naming the CLAUDE.md rule it tests. They call a model, so CI
  never runs them; run them with
  `aidlc evals run --dir evals/agent --provider claude-code`.
- CI runs `aidlc evals run --skip-model --threshold 0.9` on changes to
  CLAUDE.md, `.claude/**`, `evals/**` and REVIEW.md, and nightly: the
  deterministic checks only, with no model and no credentials. The pass
  rate gates the change. Under `--skip-model` the `output-matches`,
  `json-field` and tool-call checks see no model output and fail.
- Run the model-backed suite locally:
  `aidlc evals run --provider claude-code --threshold 0.9` calls the
  `claude` CLI, which uses your Claude Code CLI login; no API key is needed.
- `aidlc evals run` reads only `evals/*.json`, so the reviewer bench
  cases under `evals/review/` (`aidlc review bench run`) never reach it.
- Every production incident becomes a permanent eval (`dimension:
  regression`, `origin: <incident or intent>`).

Start with 20-50 real tasks with known outcomes; grow from defects.
