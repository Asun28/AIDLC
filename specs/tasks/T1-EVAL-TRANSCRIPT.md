---
id: T1-EVAL-TRANSCRIPT
title: Evals check the files the agent read and the commands it ran from the provider's recorded tool calls, run model-backed cases in a temporary checkout with an empty state directory, and refuse a prompt that names the measurement
status: todo
branch: T1-EVAL-TRANSCRIPT
worktree: D:\wt\AIDLC\T1-EVAL-TRANSCRIPT
plan_ref: plans/pstack-study.md#order-of-work
allow_paths:
  - src/providers/claude-code.ts
  - src/providers/types.ts
  - src/evals/runner.ts
  - src/cli/main.ts
  - evals/agent/
  - evals/README.md
  - templates/evals/README.md
  - tests/surface/evals.test.ts
  - tests/surface/providers.test.ts
  - tests/surface/command-lines.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-EVAL-TRANSCRIPT.md
dod_command: npm run typecheck && node --test tests/surface/evals.test.ts tests/surface/providers.test.ts tests/surface/command-lines.test.ts
dod_exit: 0
requirements:
  - R1. `CompletionRequest` shall gain an optional `recordToolCalls`. When it is true, the claude-code provider shall run with `--output-format stream-json --verbose`, collect each `tool_use` block of the assistant events in order as `{ name, input }`, and take the text, `is_error`, `api_error_status`, usage, cost and session id from the `result` event; when it is false or absent, the argv and the result shall be what they are before this card.
  - R2. `CompletionResult` shall gain an optional `toolCalls`. A stream with no `result` event shall be an `error` outcome, and the quota, `is_error` and timeout rules shall classify a stream as they classify the JSON payload today.
  - R3. `EvalCheck` shall gain `read-file` (`path`: a `Read` tool call whose `file_path` resolves to that repository-relative path), `ran-command` (`pattern`: a `Bash` or `PowerShell` tool call whose `command` matches the regex), `not-ran-command` (`pattern`: none matches), and `not-wrote-path` (`pattern`: no `Edit`, `Write` or `NotebookEdit` tool call whose path matches). Path comparison follows the platform's case rule. Under `--skip-model` each of them fails with the detail `no model run`, as `output-matches` does.
  - R4. `runEval` shall ask for tool calls when the case has a tool-call check (R3), and shall send a system prompt that does not name the measurement.
  - R5. WHEN `runEval` calls the model, it shall create a detached checkout of HEAD under the OS temp directory, link the main checkout's `node_modules` into it when that exists, run the model and every check of the case with that checkout as the working directory and with `AIDLC_STATE_DIR` set to a new empty temporary directory, and remove the link, the checkout (pruning on failure) and the state directory afterwards, also when the model or a check fails. A removal failure is reported in the result's detail.
  - R6. `loadEvals` shall refuse a case whose prompt contains `eval`, `evals`, `judge`, `rubric`, `grader`, `benchmark`, `experiment` or `score` as a whole word in any letter case, naming the case id and the word.
  - R7. `evals/agent/` shall hold at least three cases, each with a tool-call check (R3) and an `origin` naming the CLAUDE.md rule it tests: a request to add a test reads `.claude/skills/tdd/SKILL.md`; a request to continue a goal runs `aidlc next` (any of `aidlc`, `node bin/aidlc.js` or `npm run dev --`); a request about a stuck card writes no path under `.aidlc/`. `aidlc evals run` without `--dir` shall still read only `evals/*.json`.
  - R8. `evals/README.md` (and its copy `templates/evals/README.md`, which T1-EVALS-NO-KEY acceptance 2 keeps identical) and `docs/OPERATIONS.md` shall state the check types, the temporary checkout and state directory, the word rule, and the command that runs the agent cases: `aidlc evals run --dir evals/agent --provider claude-code`.
acceptance:
  - 1. `tests/surface/providers.test.ts`: with a scripted runner, `recordToolCalls` sends `--output-format stream-json --verbose` and returns three tool calls in order and the result text; without it the argv is unchanged; a stream with an `is_error` result and a 429 status is a quota outcome; a stream with no result event is an error. [R1] [R2] [dod arm 2]
  - 2. `tests/surface/evals.test.ts`: each tool-call check (R3) passes on a scripted provider whose tool calls satisfy it and fails on one whose calls do not; under `skipModel` each fails with `no model run`. [R3] [R4] [dod arm 1]
  - 3. Same file: a model-backed case sees a working directory that is not the repository root, sees `AIDLC_STATE_DIR` naming an empty directory, and after the run neither the checkout nor the state directory exists and `git worktree list` does not name the checkout; the same holds when the provider throws. [R5] [dod arm 1]
  - 4. Same file: a prompt containing `Rubric` is refused naming the case and the word; `scored` is not refused (whole words only); the system prompt sent contains none of the R6 words. [R4] [R6] [dod arm 1]
  - 5. Same file: every case under `evals/agent/` parses, has a tool-call check (R3), and is not read by `loadEvals` of `evals/`. [R7] [dod arm 1]
  - 6. The docs state R1 to R8 (reviewer-verified against the diff). [R8]
depends_on: []
budget: 540
sweep: "Sites on main at 01dd308: `ClaudeCodeProvider.complete` src/providers/claude-code.ts:34 (argv :36, payload parse :46 to :67); `CompletionRequest` and `CompletionResult` src/providers/types.ts:10 and :25; `EvalCheck` src/evals/runner.ts:14 and `EvalCase` :23; `loadEvals` :55; `runEval` :67 with the system prompt `You are running a deterministic eval.` :75; the `evals run` command src/cli/main.ts:1085. Not sites: `runProviderFor` src/cli/main.ts:151 (`aidlc run`), which never sets `recordToolCalls`; the reviewer bench, which runs no provider."
forbid: [weakening or skipping a test to go green, a model call in a test, an agent case in `evals/*.json` (it would reach the CI threshold), running a model-backed case in the main checkout, an eval reading or writing the repository's `.aidlc/`, editing .aidlc state by hand]
non_goals: [a judge model, grading the model's text against a rubric, the A/B variant run (T1-EVAL-VARIANT), a provider other than claude-code recording tool calls, running the agent cases in CI]
hygiene: "Line numbers are from main at 01dd308; read them again at PREPARE. The stream-json shape: read one JSON object per line, ignore lines that do not parse, and treat a missing `result` event as an error; a scripted runner in the test is the contract, not a live CLI. The repository's state lives under the main checkout (`docs/ARCHITECTURE.md`), so a detached worktree of this repository would reach it without `AIDLC_STATE_DIR`; R5 sets it before the model starts."
doc_sync: evals/README.md, docs/OPERATIONS.md (Continuous evals), docs/ARCHITECTURE.md, CHANGELOG.md
---

# T1-EVAL-TRANSCRIPT

## Deliverable
`aidlc evals run --dir evals/agent --provider claude-code` runs agent-behaviour cases in a throwaway checkout and checks what the agent did (files read, commands run, paths written), not what it said.

## Why
pstack's eval playbook: grade from the transcript, never from self-report; keep the measurement out of the prompt; give each candidate its own environment. Here `evals/` holds one case, the claude-code provider keeps only the final text (`--output-format json`), the runner's system prompt tells the agent it is "running a deterministic eval", and a model-backed case runs in the main checkout with the repository's loop state in reach.

## Rules that decide edge cases
- A tool-call check on a case that never called the model fails; it never passes vacuously.
- `read-file` matches the `Read` tool only; a `Grep` or `Bash cat` of the file is not a read of the skill.
- The word rule applies to the prompt, not to the case id, file name or `origin`, which the agent never sees.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/evals.test.ts tests/surface/providers.test.ts tests/surface/command-lines.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.
