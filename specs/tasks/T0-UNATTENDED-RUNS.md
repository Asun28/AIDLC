---
id: T0-UNATTENDED-RUNS
title: OPERATIONS.md documents /goal as the outer driver of aidlc next and /loop for wait directives, and every DoD receipt example names the test count, not only the exit code
status: todo
branch: T0-UNATTENDED-RUNS
worktree: D:\wt\AIDLC\T0-UNATTENDED-RUNS
allow_paths:
  - docs/OPERATIONS.md
  - README.md
  - CHANGELOG.md
  - tests/surface/unattended.test.ts
  - specs/tasks/T0-UNATTENDED-RUNS.md
dod_command: npm run typecheck && node --test tests/surface/unattended.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `docs/OPERATIONS.md` shall carry a `/goal` condition that drives a goal through `aidlc next` and `aidlc report` and is met when the latest `aidlc next` JSON shown in the conversation has kind `done`, `stop`, `ask`, `checkpoint` or `wait`, with a turn cap, and that tells the agent not to act on or report a `done`, `stop`, `ask`, `checkpoint` or `wait` directive, and shall state why the goal ends on `wait`, that `/goal` grants no permission and changes no gate, and that its evaluation is skipped while a background command runs.
  - R2. `docs/OPERATIONS.md` shall carry a self-paced `/loop` prompt that waits on a `wait` directive by its `until` or `pollSeconds` and stops when the directive is anything else, and shall state that a `/schedule` cloud routine cannot drive a goal because `.aidlc/` is local to the main checkout and gitignored.
  - R3. WHERE `docs/OPERATIONS.md` or `README.md` shows a `--dod-receipt` example, the receipt shall name the command, its exit code and the count of tests that passed, and `docs/OPERATIONS.md` shall state that an exit code alone proves nothing about the tests, naming the three `node --test` cases that exit 0 with no test run.
acceptance:
  - 1. `docs/OPERATIONS.md` contains the `/goal` condition verbatim, including the clause that tells the agent not to act on a `done`, `stop`, `ask`, `checkpoint` or `wait` directive and not to run `aidlc report` for it (so no goal turn approves a checkpoint), and the three sentences on `wait`, on permissions and gates, and on background commands; a test reads each one and fails with any one removed (tests/surface/unattended.test.ts). [R1] [dod arm 1]
  - 2. Every directive kind the `/goal` condition names (`done`, `stop`, `ask`, `checkpoint`, `wait`) is a kind of the `Directive` schema in `src/loop/directive.ts`, and the `/loop` prompt names `until` and `pollSeconds`, which are fields of the `wait` directive; a test reads the kinds and fields from the schema, so renaming one fails it (tests/surface/unattended.test.ts). [R1] [R2] [dod arm 1]
  - 3. `docs/OPERATIONS.md` contains the `/loop` prompt verbatim and the `/schedule` sentence; a test reads each one (tests/surface/unattended.test.ts). [R2] [dod arm 1]
  - 4. Every `--dod-receipt "<text>"` example in `docs/OPERATIONS.md` and `README.md` names an exit code and a pass count, and `docs/OPERATIONS.md` contains the exit-code sentence verbatim; a test reads every example and the sentence (tests/surface/unattended.test.ts). [R3] [dod arm 1]
  - 5. `CHANGELOG.md` Unreleased carries the entry under this card id, and the added text carries no em dash or CJK corner bracket (tests/surface/unattended.test.ts, tests/surface/prose.test.ts). [R1] [R2] [R3] [dod arm 1]
depends_on: []
budget: 120
tdd: true
sweep: "grep -n \"dod-receipt\" docs/OPERATIONS.md README.md: the two examples are `pytest exit 0` (OPERATIONS.md:33) and `npm test exit 0` (README.md:37), exit code only. grep -n \"/goal\\|/loop\\|/schedule\" docs/*.md README.md: no match. Measured on Node 22.23.1 in this repository: `node --test` on a file with no tests prints `# tests 1` and `# pass 1` and exits 0; on a file whose only test is skipped exits 0 with `# pass 0`; on a glob that matches no file prints `# tests 0` and exits 0; on a named file that does not exist exits 1."
forbid: [any change under src/, a change to the aidlc-loop skill files (SKILL.md 4494 and card-loop.md 6497 bytes against caps of 4500 and 6500), a /goal or /loop prompt that approves, merges or authorizes, a claim about Claude Code behaviour that code.claude.com/docs/en/goal.md, scheduled-tasks.md or hooks.md does not state]
non_goals: [a code guard that refuses a success attempt whose receipt reports zero tests, a Stop hook change, a cloud routine, a supervisor session over other sessions]
hygiene: "From the article 'Stop babysitting Claude Code: loop engineering for everyday work' (M. S. Babacan, 2026-09-23). Each Claude Code claim in the new text has a source, read 2026-09-26: goal.md 'After each turn, a small fast model checks whether the condition holds'; goal.md 'It doesn't run commands or read files independently'; goal.md 'If a subagent or a background shell command is still running when a turn ends, Claude Code skips the evaluation for that turn ... When the background work finishes, Claude Code delivers the result to Claude as a new turn'; goal.md 'A goal doesn't change your permission mode'; scheduled-tasks.md 'To stop a self-paced /loop while it is waiting for the next iteration, press Esc'; scheduled-tasks.md cloud routine 'Access to local files: No (fresh clone)'; hooks.md Stop 'hookSpecificOutput.additionalContext: Non-error feedback for Claude. The conversation continues', so verify-before-done and /goal both apply (all under code.claude.com/docs/en/)."
doc_sync: docs/OPERATIONS.md (Running a goal, T0 bugfix receipt; new Unattended runs subsection), README.md (receipt example), CHANGELOG.md
---

# T0-UNATTENDED-RUNS

## Deliverable
A session can run a goal to its next human decision without a "continue" prompt per step, using `/goal` with a condition the evaluator can judge from the `aidlc next` JSON on screen, and wait on a `wait` directive with a self-paced `/loop`. Every DoD receipt example names the test count, so an exit code alone is never shown as proof.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/unattended.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
