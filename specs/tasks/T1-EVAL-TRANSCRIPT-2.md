---
id: T1-EVAL-TRANSCRIPT-2
title: Evals check the files the agent read and the commands it ran from the provider's recorded tool calls, run model-backed cases in a temporary checkout with an empty state directory, and refuse a prompt that names the measurement
status: todo
branch: T1-EVAL-TRANSCRIPT-2
worktree: D:\wt\AIDLC\T1-EVAL-TRANSCRIPT-2
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
  - specs/tasks/T1-EVAL-TRANSCRIPT-2.md
dod_command: npm run typecheck && node --test tests/surface/evals.test.ts tests/surface/providers.test.ts tests/surface/command-lines.test.ts
dod_exit: 0
requirements:
  - R1. `CompletionRequest` shall gain an optional `recordToolCalls`. When it is true, the claude-code provider shall run with `--output-format stream-json --verbose`, collect each `tool_use` block of the assistant events in order as `{ name, input }`, and take the text, `is_error`, `api_error_status`, usage, cost and session id from the `result` event; when it is false or absent, the argv and the result shall be what they are before this card.
  - R2. `CompletionResult` shall gain an optional `toolCalls`. A stream with no `result` event shall be an `error` outcome, and the quota, `is_error` and timeout rules shall classify a stream as they classify the JSON payload today.
  - R3. `EvalCheck` shall gain `read-file` (`path`: a `Read` tool call whose `file_path` resolves to that repository-relative path), `ran-command` (`pattern`: a `Bash` or `PowerShell` tool call whose `command` matches the regex), `not-ran-command` (`pattern`: none matches), and `not-wrote-path` (`pattern`: no `Edit`, `Write` or `NotebookEdit` tool call whose path matches). Path comparison follows the platform's case rule. Under `--skip-model` each of them fails with the detail `no model run`, as `output-matches` does.
  - R4. `runEval` shall ask for tool calls when the case has a tool-call check (R3), and shall send a system prompt that does not name the measurement.
  - R5. WHEN `runEval` calls the model, it shall create a detached checkout of HEAD under the OS temp directory, link the main checkout's `node_modules` into it when that exists, run the model and every check of the case with that checkout as the working directory and with `AIDLC_STATE_DIR` set to a new empty temporary directory, and remove the link, the checkout (pruning on failure) and the state directory afterwards, also when the model or a check fails. Under `--skip-model` the checks shall run in the given working directory with `AIDLC_STATE_DIR` set to a new empty temporary directory, removed afterwards, also when a check or the runner throws. A removal failure is reported in the result's detail.
  - R6. `loadEvals` shall refuse a case whose prompt contains `eval`, `evals`, `judge`, `rubric`, `grader`, `benchmark`, `experiment` or `score` as a whole word in any letter case, naming the case id and the word.
  - R7. `evals/agent/` shall hold at least three cases, each with a tool-call check (R3) and an `origin` naming the CLAUDE.md rule it tests: a request to add a test reads `.claude/skills/tdd/SKILL.md`; a request to continue a goal runs `aidlc next` (any of `aidlc`, `node bin/aidlc.js` or `npm run dev --`); a request about a stuck card writes no path under `.aidlc/`. `aidlc evals run` without `--dir` shall still read only `evals/*.json`.
  - R8. `evals/README.md` (and its copy `templates/evals/README.md`, which T1-EVALS-NO-KEY acceptance 2 keeps identical) and `docs/OPERATIONS.md` shall state the check types, the temporary checkout and state directory, the word rule, the path rules of R9 and R10 and the limits named in this card's non-goals, and the command that runs the agent cases, `aidlc evals run --dir evals/agent --provider claude-code`.
  - R9. `loadEvals` shall refuse a case whose `command` check `cwd` or `contains` or `not-contains` check `file` is absolute, has a `..` segment, or has `.aidlc` as its first segment, naming the case id and the field. When a check runs, a target whose real path (else the real path of its nearest existing parent) is outside the real path of the working directory, or has `.aidlc` as its first segment below it, shall be refused, and the check shall fail with nothing read or run.
  - R10. `aidlc evals run` shall refuse a `--dir` whose real path is inside the configured state directory or inside the repository's `.aidlc/`, and `loadEvals` shall refuse, before reading it, a case file whose real path is inside either of them; each refusal names the path.
acceptance:
  - 1. `tests/surface/providers.test.ts`: with a scripted runner, `recordToolCalls` sends `--output-format stream-json --verbose` and returns three tool calls in order and the result text; without it the argv is unchanged; a stream with an `is_error` result and a 429 status is a quota outcome; a stream with no result event is an error. [R1] [R2] [dod arm 2]
  - 2. `tests/surface/evals.test.ts`: each tool-call check (R3) passes on a scripted provider whose tool calls satisfy it and fails on one whose calls do not; under `skipModel` each fails with `no model run`. [R3] [R4] [dod arm 1]
  - 3. Same file: a model-backed case sees a working directory that is not the repository root, sees `AIDLC_STATE_DIR` naming an empty directory, and after the run neither the checkout nor the state directory exists and `git worktree list` does not name the checkout; the same holds when the provider throws. [R5] [dod arm 1]
  - 4. Same file: a prompt containing `Rubric` is refused naming the case and the word; `scored` is not refused (whole words only); the system prompt sent contains none of the R6 words. [R4] [R6] [dod arm 1]
  - 5. Same file: every case under `evals/agent/` parses, has a tool-call check (R3), and is not read by `loadEvals` of `evals/`. [R7] [dod arm 1]
  - 6. The docs state R1 to R10 (reviewer-verified against the diff). [R8]
  - 7. Same file: under `skipModel` a command check sees `AIDLC_STATE_DIR` naming a new empty directory that no longer exists after the run, also when the runner throws. [R5] [dod arm 1]
  - 8. Same file: `loadEvals` refuses an absolute `cwd`, a `../` file and an `.aidlc/x` file, naming the case and the field; a file or `cwd` through a link that leaves the working directory or leads into its `.aidlc` fails without reading or running; the pure path rule decides each listed path for `linux` and `win32`. [R9] [dod arm 1]
  - 9. `tests/surface/command-lines.test.ts` or `tests/surface/evals.test.ts`: `evals run --dir` inside the state directory, and `--dir .aidlc` while `AIDLC_STATE_DIR` names another directory, are refused; a case file that is a link into `.aidlc` is refused before it is read. [R10] [dod arm 1 or 3]
depends_on: []
budget: 840
sweep: "Sites on main at 01dd308: `ClaudeCodeProvider.complete` src/providers/claude-code.ts:34 (argv :36, payload parse :46 to :67); `CompletionRequest` and `CompletionResult` src/providers/types.ts:10 and :25; `EvalCheck` src/evals/runner.ts:14 and `EvalCase` :23; `loadEvals` :55; `runEval` :67 with the system prompt `You are running a deterministic eval.` :75; the `evals run` command src/cli/main.ts:1085. Not sites: `runProviderFor` src/cli/main.ts:151 (`aidlc run`), which never sets `recordToolCalls`; the reviewer bench, which runs no provider. The candidate this card continues is branch T1-EVAL-TRANSCRIPT at aafe85d."
forbid: [weakening or skipping a test to go green, a model call in a test, an agent case in `evals/*.json` (it would reach the CI threshold), running a model-backed case in the main checkout, an eval run reaching the repository's `.aidlc/` through a path that R5, R9 or R10 governs, editing .aidlc state by hand]
non_goals: [a judge model, grading the model's text against a rubric, the A/B variant run (T1-EVAL-VARIANT), a provider other than claude-code recording tool calls, running the agent cases in CI, sandboxing the argv of a case's own `command` check (a case file is code in the repository and is reviewed like code; its command can name any absolute path), blocking a model tool call that reads outside its checkout by an absolute path (Claude Code limits writes to its working directory, and `not-wrote-path` checks the writes)]
hygiene: "This card replaces T1-EVAL-TRANSCRIPT by the user's ruling of 2026-11-08 on its R3 decision 4. R3 blocked all four decisions on the forbid rule 'an eval reading or writing the repository's .aidlc/': case paths that escaped the checkout (decision 1), a link into `.aidlc` and a skipped link test (decision 2), the state directory under --skip-model (decision 3), and on decision 4 a case's own command argv, `--dir .aidlc` with another state directory, and a case file linked into `.aidlc`. The reviewer read the rule as a sandbox against hostile case files. This card states what the runner enforces (R5, R9, R10), bounds the forbid rule to those paths, and names the two limits no path rule can close as non-goals; a finding that asks for a check outside them is outside this card. The branch continues T1-EVAL-TRANSCRIPT at aafe85d (DoD 40/40, `aidlc evals run --skip-model --threshold 0.9` gate pass); it adds R10's two refusals, moves the Attempt evidence table here, and renames the card in test titles, the CHANGELOG and the docs. Line numbers are from main at 01dd308. The stream-json shape: read one JSON object per line, ignore lines that do not parse, and treat a missing `result` event as an error; a scripted runner in the test is the contract, not a live CLI. The repository's state lives under the main checkout (`docs/ARCHITECTURE.md`), so a detached worktree of this repository would reach it without `AIDLC_STATE_DIR`; R5 sets it before the model starts."
doc_sync: evals/README.md, docs/OPERATIONS.md (Continuous evals), docs/ARCHITECTURE.md, CHANGELOG.md
---

# T1-EVAL-TRANSCRIPT-2

## Deliverable
`aidlc evals run --dir evals/agent --provider claude-code` runs agent-behaviour cases in a throwaway checkout and checks what the agent did (files read, commands run, paths written), not what it said.

## Why
pstack's eval playbook: grade from the transcript, never from self-report; keep the measurement out of the prompt; give each candidate its own environment. Here `evals/` holds one case, the claude-code provider keeps only the final text (`--output-format json`), the runner's system prompt tells the agent it is "running a deterministic eval", and a model-backed case runs in the main checkout with the repository's loop state in reach.

## Rules that decide edge cases
- A tool-call check on a case that never called the model fails; it never passes vacuously.
- `read-file` matches the `Read` tool only; a `Grep` or `Bash cat` of the file is not a read of the skill.
- The word rule applies to the prompt, not to the case id, file name or `origin`, which the agent never sees.
- The runner keeps an eval away from the repository's `.aidlc/` by the empty state directory and the temporary checkout (R5) and by the path rules of R9 and R10, and by nothing else. It is not a sandbox against a case file written to reach `.aidlc/`; review of the case file, which is code in the repository, catches that.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/evals.test.ts tests/surface/providers.test.ts tests/surface/command-lines.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Attempt evidence
RED receipt: `6ca91b3:1` (acceptance 9: `--dir .aidlc` with another `AIDLC_STATE_DIR` ran the case with no refusal on stderr; a case file linked into `.aidlc` was read, not refused).

History, carried from T1-EVAL-TRANSCRIPT (same branch line, aafe85d): RED `313dfb5:1` (acceptance 1 to 5), `724ff94:1` (R3 decision 1, path rules), `0e2d986:1` (R3 decision 2, link into `.aidlc`, no skipped test), `0e9e1b4:1` (R3 decision 3, skip-model state directory).

| # | Proving test or command | Result |
|---|---|---|
| 1 | `tests/surface/providers.test.ts`: the three `T1-EVAL-TRANSCRIPT-2 acceptance 1` tests | pass |
| 2 | `tests/surface/evals.test.ts`: both `T1-EVAL-TRANSCRIPT-2 acceptance 2` tests | pass |
| 3 | `tests/surface/evals.test.ts`: `T1-EVAL-TRANSCRIPT-2 acceptance 3` (provider answers, provider throws) | pass |
| 4 | `tests/surface/evals.test.ts`: `T1-EVAL-TRANSCRIPT-2 acceptance 4` | pass |
| 5 | `tests/surface/evals.test.ts`: `T1-EVAL-TRANSCRIPT-2 acceptance 5` | pass |
| 6 | evals/README.md and its byte-identical copy templates/evals/README.md, docs/OPERATIONS.md (Evals), docs/ARCHITECTURE.md (module map), CHANGELOG.md state R1 to R10 and the two non-goal limits; the copies kept identical by `tests/surface/command-lines.test.ts` (T1-EVALS-NO-KEY acceptance 2) | pass (reviewer-verified against the diff) |
| 7 | `tests/surface/evals.test.ts`: both `T1-EVAL-TRANSCRIPT-2 acceptance 7` tests (runner answers, runner throws) | pass |
| 8 | `tests/surface/evals.test.ts`: the four `T1-EVAL-TRANSCRIPT-2 acceptance 8` tests (load-time refusals; link out of the working directory, no skip; link into `.aidlc`; `realPathRule` on `linux` and `win32`) | pass |
| 9 | `tests/surface/command-lines.test.ts`: the three `T1-EVAL-TRANSCRIPT-2 acceptance 9` tests (`--dir` inside the state directory; `--dir .aidlc` with another `AIDLC_STATE_DIR`; run from a linked worktree, `--skip-model` and mock provider, sees the worktree's cases, working tree and HEAD); `tests/surface/evals.test.ts`: `T1-EVAL-TRANSCRIPT-2 acceptance 9` (case file linked into `.aidlc`, refused with explicit `protectedDirs` and with no options) | pass |
| R3-1 | R3 decision 1: optional-state-path-guard (`loadEvals` with no options derives the state directory and the main checkout's `.aidlc`) and wrong-worktree-head (`evals run` evaluates the invoking worktree); RED `90271c0:1` | pass |

DoD: `npm run typecheck && node --test tests/surface/evals.test.ts tests/surface/providers.test.ts tests/surface/command-lines.test.ts`, exit 0, 43 tests, 0 skipped. `node bin/aidlc.js evals run --skip-model --threshold 0.9` from the worktree: gate pass, 1/1.
