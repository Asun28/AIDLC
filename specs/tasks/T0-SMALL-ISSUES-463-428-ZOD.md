---
id: T0-SMALL-ISSUES-463-428-ZOD
title: "Three small fixes in one card: a hook guard refuses an interpreter that reads its program from standard input (issue 463), the tdd and diagnose skill descriptions name the requests a person types (part of issue 428), and zod is 4.6.7 or later (Dependabot alert 1, GHSA-mrhx-c7xc-m3w5)"
status: todo
branch: T0-SMALL-ISSUES-463-428-ZOD
worktree: D:\wt\AIDLC\T0-SMALL-ISSUES-463-428-ZOD
allow_paths:
  - src/hooks/stdin-script.ts
  - src/hooks/index.ts
  - src/hooks/entry.ts
  - tests/surface/stdin-script.test.ts
  - tests/surface/small-issues-463-428-zod.test.ts
  - tests/surface/hooks.test.ts
  - tests/surface/hook-name.test.ts
  - tests/surface/ps-guard-wire.test.ts
  - tests/surface/readme.test.ts
  - .claude/skills/tdd/SKILL.md
  - .claude/skills/diagnose/SKILL.md
  - templates/claude/skills/tdd/SKILL.md
  - templates/claude/skills/diagnose/SKILL.md
  - package.json
  - package-lock.json
  - README.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-SMALL-ISSUES-463-428-ZOD.md
  - specs/tasks/T0-SMALL-ISSUES-463-428-ZOD.md
dod_command: npm run typecheck && npm run check:tree && node --test tests/surface/stdin-script.test.ts tests/surface/small-issues-463-428-zod.test.ts tests/surface/hooks.test.ts tests/surface/hook-lazy.test.ts tests/surface/hook-name.test.ts tests/surface/ps-guard-wire.test.ts tests/surface/ps-guard-read.test.ts tests/surface/readme.test.ts tests/surface/command-lines.test.ts tests/surface/templates.test.ts tests/surface/guard-sweep.test.ts tests/surface/changelog-fragments.test.ts tests/scenarios/prod-gate-generation.test.ts && npm run build && npm run bench -- --check
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The guard `stdin-script` shall refuse, with exit 2 and `RULE` of the Text section on stderr, each Bash and PowerShell command of the refused rows of `tests/surface/stdin-script.test.ts`, which hold a row for each form the Guard text of that section lists.
  - R2. The guard shall pass, with exit 0 and no output, each command of the passing rows of that file, an event whose `command` is absent or not a string, and an edit.
  - R3. `dispatchHook` shall run the guard on a Bash or PowerShell `PreToolUse` event only when no other guard blocked in either pass, and `aidlc hook stdin-script` shall give the guard's own answer.
  - R4. `package.json` shall ask for zod `^4.6.7` and `package-lock.json` shall hold zod 4.6.7 alone.
  - R5. Both copies of the `tdd` and of the `diagnose` skill shall carry the description of the Text section and no other change.
  - R6. `README.md` and `docs/OPERATIONS.md` shall hold one table row for the guard, the known-names line of `docs/OPERATIONS.md` shall name it, that file shall hold the Guard text as one paragraph, `docs/ARCHITECTURE.md` shall name `src/hooks/stdin-script.ts`, and the fragment shall record the three changes.
acceptance:
  - 1. `tests/surface/stdin-script.test.ts`, test 1. Each refused form, Bash and PowerShell apart, gives exactly exit 2 and `RULE`. RED on main, where the name is no guard. [R1] [dod arm 3]
  - 2. Same file, test 2. A script file, an inline program, a module, quoted text, a heredoc or here-string body, each left-out form of `non_goals` that has a row, and a `command` that is absent, a number or an array give exactly exit 0. [R2] [dod arm 3]
  - 3. Same file, test 3. The guard list of both shells ends with `stdin-script`; a command another guard blocks in the first or in the second pass returns that guard's result; a frozen-path note is replaced by the refusal; an Edit event passes; an unusable `aidlc.config.json` does not change the guard's own answer; `bin/aidlc.js hook stdin-script` and `hook auto` exit 2 with `RULE`. [R3] [dod arm 3]
  - 4. `tests/surface/small-issues-463-428-zod.test.ts`, test 1. The manifest range, the lock's root range and the one locked zod are 4.6.7. RED on main. The card's worktree runs its DoD on an `npm ci` of this lock. [R4] [dod arm 3]
  - 5. Same file, test 2. The parsed `description` of the four files equals the text of the Text section. RED on main. Each file stays within its cap of `tests/surface/templates.test.ts`. [R5] [dod arm 3]
  - 6. The pinned guard lists gain `stdin-script` and nothing else changes in their files - `hooks.test.ts` (the known-names literal, the Bash list, the covered set), `hook-name.test.ts` (`KNOWN`), `ps-guard-wire.test.ts` (the PowerShell list) and `readme.test.ts` (one entry of `GUARD_CELLS`). Every other test of the DoD passes with no line changed. [R3] [R6] [dod arm 3]
  - 7. The typecheck and the tree checks pass, and every benchmark count is within its ceiling with no change to `bench/baseline.json`. [dod arm 1] [dod arm 2] [dod arm 5]
  - 8. The documents and the fragment hold R6 (reviewer-verified against the diff; the README row and the known-names line also by `readme.test.ts` and `hook-name.test.ts`). [R6] [dod arm 3]
depends_on: []
budget: 800
size_exception: "The owner raised the budget to 800 in the session of 2026-11-25, when R3 decisions 1 and 2 had turned the guard into a scanner of two shell grammars. Before that: The owner (asun28) selected issue 463, the issue 428 descriptions and the zod update for one card and one pull request in the session of 2026-11-25, told that the guard is about 80 source lines plus tests; the prototype is 251 added and 33 removed lines over 18 files before the attempt evidence, 98 of them in src/"
tdd: true
sweep: "Prototype on main at 646cc2db, in a scratch clone with zod 4.6.7 installed. zod alone: `npm run check` exits 0 (4,252 tests, 4,220 pass, 0 fail, 32 skipped) and `npm run bench -- --check` is within every ceiling (dependency bytes 854k against 853k). The whole prototype: 4,257 tests, 2 failures, both fixed by this card file and the docs/ARCHITECTURE.md line, and the bench check within every ceiling. The guard over the 21,421 Bash and PowerShell commands of this project's own session transcripts refuses 219, every one with the program operand `-` (`python -`, `node -`), and no other. `git grep -n \"'secrets-guard'\\]\\|HOOK_NAMES\\|hookNamesFor\" -- tests src` finds the pinned lists of acceptance 6; `git grep -n 'implements the six' -- docs` finds docs/ARCHITECTURE.md:44. `npm install zod@^4.6.7` also adds the `aidlc-hook` bin entry the lock's root lacked."
forbid: ["a change to a decision or a text of another guard", "a hand edit of package-lock.json", "a change to bench/baseline.json"]
non_goals:
  - "a security boundary: a spelling the Guard text does not list passes"
  - "a Bash or PowerShell spelling that no row of `tests/surface/stdin-script.test.ts` holds, whether the guard refuses or passes it: the rows are the contract of R1 and R2, the Guard text describes them, and another spelling is a follow-up (owner amendment of 2026-11-25)"
  - "another launcher (`docker exec`, `uv run`, `npx`, `xargs`, `ssh`), another interpreter (`bash`, `ruby`, `perl`, `deno`), an option of a wrapper (`sudo -u x`) and an interpreter named by a variable: each passes"
  - "a double-quoted text holding `$(` beyond its next double quote, and a command text inside quotes (`bash -c \"python -\"`): not read, so they pass"
  - "`pwsh` with no `-Command` or `-File`, whatever is fed to it: issue 463 asks for `pwsh -Command -`"
  - "the trigger measurement of issue 428, which stays open, and the descriptions of the other skills"
  - "a configuration key that turns the guard off"
hygiene: "The design constraint of issue 135 (no hand-written tokenizer, an uncertain reading is over-blocked) is for the production and frozen-path guards, where a miss is a gap in a control; here a miss is an unreminded command and a false refusal stops a legitimate one, so quoted text and heredoc bodies are dropped and the unread form passes. `stdin-script` runs in the second pass only, so a dispatch that blocked before returns the same guard's result (docs/LESSONS.md, T0-HOOK-CLASSIFIER-3). The per-guard entry is named beside the dispatcher (T0-CARD-LEASE-HEARTBEAT-2). RED first: the two new test files and the list entries. Before R3, loosen each part of the guard in turn and record any survivor with why it is equivalent. The worktree must not share the main checkout's node_modules: an install through the link changes it for every other session, so run `npm ci` in the worktree in place of the link command. The removal of the worktree takes that directory with it. After the merge, `npm install` in the main checkout."
doc_sync: README.md, docs/OPERATIONS.md, docs/ARCHITECTURE.md, changelog.d/T0-SMALL-ISSUES-463-428-ZOD.md
---

# T0-SMALL-ISSUES-463-428-ZOD

## Deliverable
The three fixes in one pull request, which closes issue 463 and Dependabot alert 1 and refers to issue 428.

## Text
`RULE`, the hard limit of CLAUDE.md as one line:

```
Never feed a script to an interpreter on standard input (`python -`, a heredoc into `node`): write it to a file outside the worktree and run the file.
```

The `tdd` description, then the `diagnose` description, each folded as on main:

```
Test quality reference. Use when asked to add, write or change a test ("add a test for X"), before a card's RED receipt in BUILD, or when judging a test against REVIEW.md dimensions 6 and 11. Not a router: the loop decides when BUILD runs and card-loop.md owns the process rules.
```
```
Diagnosis loop for a failure with no known cause: a red-capable feedback loop first, then ranked hypotheses. Use when asked why a test fails or is flaky, or where an error comes from, and on a routed T0-bugfix card, a card `diagnosis:` field or a DoD/CI failure, after `aidlc goal new` or `aidlc ci classify` has routed it; intake stays with aidlc-loop.
```

The Guard text, directly before the paragraph of `docs/OPERATIONS.md` that begins "On a PowerShell event the guards also join":

```
Which commands `stdin-script` refuses (card T0-SMALL-ISSUES-463-428-ZOD, issue 463): a command whose name, without its path and `.exe`, is `python` with any version digits, `py` or `node`, and whose first argument that is neither an option nor an option's value is `-` (the options with a value are `-X` and `-W` of Python, and `-r`, `--require`, `--import`, `--loader`, `-C`, `--conditions`, `--input-type` and `--env-file` of node); the same command with no such argument when it stands after a pipe with white space on either side or takes a `<`, `<<` or `<<<` redirection; and `pwsh` or `powershell` whose `-Command` or `-File`, or a shorter spelling of one, is followed by `-`. A program option (`-c` and `-m` of Python, alone or ending a short option group; `-e`, `--eval`, `-p`, `--print`, `-pe` and `--test` of node) means the program is not standard input, so the command passes. A command stands at the start, after a separator, a pipe, a bracket, a backtick or `$(`, and after an assignment, a shell keyword, or `sudo`, `time`, `env`, `exec`, `command`, `nohup` or `timeout <n>`. A comment, a heredoc or here-string body and a quoted text of more than one plain word are not read, except that a double-quoted text holding `$(` is read up to its next double quote. Every other spelling passes: a wrapper's own options, another launcher (`docker exec`, `uv run`, `xargs`), another interpreter, `python` with no argument and nothing fed to it. It decides after every other guard and reads no configuration.
```

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && npm run check:tree && node --test tests/surface/stdin-script.test.ts tests/surface/small-issues-463-428-zod.test.ts tests/surface/hooks.test.ts tests/surface/hook-lazy.test.ts tests/surface/hook-name.test.ts tests/surface/ps-guard-wire.test.ts tests/surface/ps-guard-read.test.ts tests/surface/readme.test.ts tests/surface/command-lines.test.ts tests/surface/templates.test.ts tests/surface/guard-sweep.test.ts tests/surface/changelog-fragments.test.ts tests/scenarios/prod-gate-generation.test.ts && npm run build && npm run bench -- --check
```
- Expected exit code: 0
- Assertion: the rows of acceptance 1 to 5, every existing test of those files, the tree checks, the build and every benchmark ceiling pass.

## PR summary

### What
This change adds the hook guard `stdin-script`, rewords two skill descriptions and updates zod to 4.6.7. It closes issue 463 and Dependabot alert 1, and refers to issue 428.

### Why / Intent
Sessions ran `python -` and `node -` against a written rule, and some of these processes hung. The two descriptions used words that a user does not type. Zod before 4.6.6 can use all the memory on a large array.

### How / Behaviour
The guard stops a Bash or PowerShell command that feeds a program to Python, node or pwsh on standard input. It gives exit code 2 and the rule. A script file, an inline program and quoted text pass.

### System impact
Each repository that uses `aidlc init` gets the guard with the next version. The guard runs last and changes no other decision. No stored record changes its form.

### Security
The zod update removes advisory GHSA-mrhx-c7xc-m3w5. The guard is a reminder and not a security boundary. The change adds no permission and no network call.

### Tests and review
The new tests fail on the old code and pass on the new code. A comparison with bash and with the PowerShell parser shows no unlisted difference. The formal review gate reviews the final commit.

### Risk
The guard can stop a correct command in a spelling that no test names. In 21,825 recorded commands it stopped 219, and each one broke the rule. It does not see every spelling.

### Ownership
The repository owner owns this change.

### Docs
The README and the operations and architecture documents describe the guard. The change adds one changelog entry.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|
| 1 | `stdin-script.test.ts`, test 1 | RED at 726366de (unknown hook name), passes |
| 2 | same file, test 2 | RED at 726366de, passes |
| 3 | same file, test 3 | RED at 726366de, passes |
| 4 | `small-issues-463-428-zod.test.ts`, test 1; `npm ci` in the worktree, then `npm install zod@^4.6.7`, installed version 4.6.7 | RED at 726366de, passes |
| 5 | same file, test 2 | RED at 726366de, passes |
| 6 | the diff of the four files; the readme entry is in the GREEN commit, since the RED commit has no such `HookName` | list entries only |
| 7 | the DoD command | exit 0 |
| 8 | the diff; `readme.test.ts`, `hook-name.test.ts`, `module-map.test.ts` | reviewer-verified, passes |

Repairs 1 and 2 (R3 decisions 1 and 2, five and eight findings): the guard scans the command once from left to right, so quotes, comments, heredocs with their delimiter words, redirections, substitutions, arithmetic, assignments, function bodies, `case` patterns and `[[ ]]` are read where they stand. Every command the thirteen findings name is a row of test 1 or test 2, which hold 206 refused and 171 passing Bash commands and 46 and 31 PowerShell commands. The owner's amendment of 2026-11-25 makes those rows the contract of R1 and R2.

| Check of the repairs | Result |
|---|---|
| Generic sweep of `stdin-script.ts` (each `&&`, `||`, `===`, negation, string literal, statement and regex part changed alone) | 520 of 534 fail a test or never end; 14 are equivalent: eight change the placeholder `Q` or `()`, one drops the last `return false` (undefined is as false), one drops a placeholder after an extended glob, two widen a regex on a slice that begins with the match, and two read a `)` that closes no list |
| Random Bash commands, each run by bash with functions that log every interpreter call (about 2,600 valid over the two repairs) | no difference beyond text after a nested double quote of a double-quoted `$(`, an unquoted substitution that expands to nothing, and commands bash did not reach |
| Random PowerShell commands against PowerShell's own parser (about 4,500 valid on repair 2) | 0 differences |
| The 21,825 Bash and PowerShell commands of the project's session transcripts | 219 refused, each with the operand `-` |
| The whole suite on f80942f5 (repair 1) | exit 0: 4,257 tests, 4,225 pass, 0 fail, 32 skipped |
