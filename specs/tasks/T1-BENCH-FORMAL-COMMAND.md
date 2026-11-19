---
id: T1-BENCH-FORMAL-COMMAND
title: aidlc review bench run --formal-command <file> scores another formal reviewer, such as Claude Fable 5.2, for one run without editing aidlc.config.json
status: todo
branch: T1-BENCH-FORMAL-COMMAND
worktree: D:\wt\AIDLC\T1-BENCH-FORMAL-COMMAND
plan_ref: plans/review-panel.md#order-of-work
allow_paths:
  - src/review/bench.ts
  - src/cli/main.ts
  - bench/outcome/fable-r3.json
  - tests/surface/review-bench-formal-command.test.ts
  - docs/OPERATIONS.md
  - specs/tasks/T1-BENCH-FORMAL-COMMAND.md
dod_command: npm run typecheck && node --test tests/surface/review-bench-formal-command.test.ts tests/surface/review-bench.test.ts tests/surface/review-bench-rounds.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc review bench run` shall take `--formal-command <file>`, accepted only with `--stage formal`; with `--stage pre` it is refused before any review with the option named. `--pre-command` with `--stage formal` stays refused as on main (src/review/bench.ts:172).
  - R2. The file shall be a JSON object with `command` (non-empty argv, no blank argument), `reviewer` (not blank) and optional `timeoutMs`, `maxDiffBytes` and `effort` (the `formalReview.effort` shape of src/config.ts); unknown keys are refused. A missing file, a file that is not JSON and a schema violation each refuse the run before any review with one message that names the file.
  - R3. For that run the file's keys shall replace those of `formalReview`, and `formalReview.fallback` and `formalReview.baseSync` shall be dropped, so a quota hold scores as `no-verdict` and no case is reviewed by another reviewer. No configuration file is written.
  - R4. Every report shall carry `options.formalCommand`: the file path as given and the sha256 of its bytes, absent without the option; `reviewer` is the file's reviewer.
  - R5. `bench/outcome/fable-r3.json` (new) shall name Claude Fable 5.2 with the argv of the Opus fallback in aidlc.config.json with `--model claude-fable-5-2`, reviewer `claude-fable-5-2`, and effort `{ "default": "high" }`.
  - R6. docs/OPERATIONS.md (Reviewer bench) shall state R1 to R4.
acceptance:
  - 1. `tests/surface/review-bench-formal-command.test.ts` (new), "T1-BENCH-FORMAL-COMMAND acceptance 1: the file's command and reviewer review a formal case and the report names them". Scripted runner records the argv. Fails on main (option unknown). [R1] [R3] [R4] [dod arm 1]
  - 2. Same file, "T1-BENCH-FORMAL-COMMAND acceptance 2: a quota hold under --formal-command is no-verdict and no fallback argv runs". Fails on main. [R3] [dod arm 1]
  - 3. Same file, "T1-BENCH-FORMAL-COMMAND acceptance 3: each refusal of R1 and R2 happens before any review and names the option or the file". Fails on main. [R1] [R2] [dod arm 1]
  - 4. review-bench.test.ts, review-bench-rounds.test.ts and prose.test.ts pass with no line changed. [R3] [dod arm 1]
  - 5. fable-r3.json and the OPERATIONS.md text are as R5 and R6 state (reviewer-verified against the diff). [R5] [R6]
depends_on: []
parallelizable_with: [T1-BENCH-CLEAN-40]
budget: 160
tdd: true
sweep: "Main at ff925160. bench.ts: PreCommandFile :219-227, readPreCommand :229-240, the formal refusal of --pre-command :172, config merge :173-176, reviewer choice :176-177. CLI: `review bench run` src/cli/main.ts:1213-1236 (--pre-command option :1225). Opus fallback argv: aidlc.config.json formalReview.fallback.command."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test
  - writing aidlc.config.json or any configuration file from the bench
  - a change to the card runner's R2 or R3 dispatch
non_goals: [running the panel arms (coordinator, plans/review-panel.md Order of work 2), a panel inside the bench, union scoring (T1-PANEL-ARMS-REPORT)]
---

# T1-BENCH-FORMAL-COMMAND

## Deliverable
The coordinator can score Claude Fable 5.2 as a formal reviewer on the replay and clean sets with one flag, so the panel arms of plans/review-panel.md can compare it with Codex.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/review-bench-formal-command.test.ts tests/surface/review-bench.test.ts tests/surface/review-bench-rounds.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the three new tests pass and the existing bench tests pass unchanged.

## Attempt evidence

| Acceptance | Proof | Result |
|---|---|---|
| 1 | `tests/surface/review-bench-formal-command.test.ts` "acceptance 1" (library run and CLI `--formal-command`; argv, effort `high`, timeout, `reviewer`, `options.formalCommand` {path, sha256}, config bytes unchanged, no `formalCommand` without the option) | pass; failed on main (configured `cfg-codex` ran) |
| 2 | same file, "acceptance 2" (quota hold, 2 trials: one call, by `fable`; every case `no-verdict`) | pass; failed on main |
| 3 | same file, "acceptance 3" (`--stage pre`, `--pre-command` with formal, absent file, 11 malformed files; library and CLI; zero reviewer calls) | pass; failed on main (no rejection) |
| 4 | DoD: review-bench.test.ts, review-bench-rounds.test.ts, prose.test.ts, no line changed | pass (DoD exit 0, 56 tests, 0 fail) |
| 5 | `bench/outcome/fable-r3.json`; docs/OPERATIONS.md `### Reviewer bench: another formal reviewer` | reviewer-verified against the diff |

`npm run check` (once): exit 0; 3869 tests, 3837 pass, 0 fail, 32 skipped.

The R6 text is a new subsection placed directly before `### Reviewer bench`: tests/surface/review-bench.test.ts (acceptance 9) pins every paragraph between `### Reviewer bench` and `## Evals`, so text inside that section fails acceptance 4 unless that test changes, and this card forbids changing it.

Guard sweep (each loosened in turn, test file run, restored):

| Guard | Loosened form | Failing test |
|---|---|---|
| `--formal-command` needs `--stage formal` | check removed | acceptance 3 |
| `.strict()` on the file schema | `.passthrough()` | acceptance 3 |
| `command` `.min(1)` | `.min(0)` | acceptance 3 |
| argument `/\S/` | no regex | acceptance 3 |
| `reviewer` `/\S/` | no regex | acceptance 3 |
| `timeoutMs` positive | not positive | acceptance 3 |
| `maxDiffBytes` int | not int | acceptance 3 |
| `effort` schema | `z.unknown()` | acceptance 3 |
| missing-file refusal | check removed | acceptance 3 |
| not-JSON message names the option | message without it | acceptance 3 |
| `formalCommand` only with the option | always present (`undefined`) | acceptance 1 |
| `fallback`/`baseSync` dropped | kept | equivalent: src/review/bench.ts never reads `formalReview.fallback` or `baseSync` (no dispatch path), so no input can tell them apart; the drop keeps the run's config as R3 states it |
