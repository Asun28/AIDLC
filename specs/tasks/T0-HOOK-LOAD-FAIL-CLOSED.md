---
id: T0-HOOK-LOAD-FAIL-CLOSED
title: "A hook process whose modules fail to load blocks a PreToolUse call, through both bin entries"
status: todo
branch: T0-HOOK-LOAD-FAIL-CLOSED
allow_paths:
  - bin/aidlc.js
  - bin/aidlc-hook.js
  - bin/hook-load-failure.js
  - tests/surface/hook-load-fail-closed.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T0-HOOK-LOAD-FAIL-CLOSED.md
  - specs/tasks/T0-HOOK-LOAD-FAIL-CLOSED.md
dod_command: npm run typecheck && node --test tests/surface/hook-load-fail-closed.test.ts tests/surface/hook-lazy.test.ts tests/surface/hook-fail-closed.test.ts tests/surface/hook-name.test.ts tests/infra/bin-entry.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. When `bin/aidlc.js` runs the `hook` subcommand (`aidlc hook <name>`, `aidlc hook auto`, with or without a leading `-C <dir>`) and the import of the CLI module throws, and when `bin/aidlc-hook.js` fails to import its entry module, the entry shall read the event from stdin and, when its `hook_event_name` is `PreToolUse`, exit 2 with no stdout and one stderr line `[aidlc hook] cannot load the hook modules; the tool call is blocked: <message>`, where `<message>` is the error's message with its line breaks joined by ` | `.
  - R2. On any other event (`Stop`, `UserPromptSubmit`, no name, stdin that is not JSON or is empty) the load failure shall end the process as before: exit 1 with the error on stderr. A `bin/aidlc.js` call that is not the `hook` subcommand shall behave as before and never read stdin.
  - R3. When the modules load, both entries shall behave as before: no extra module is loaded on that path (the failure handler is imported only inside the catch), so `npm run bench` counts do not change.
  - R4. `docs/OPERATIONS.md`, Hooks section, shall replace the last sentence of the T0-HOOK-FAIL-CLOSED paragraph ("A module the CLI imports statically ... does not cover that.") with R1 and R2.
acceptance:
  - 1. `tests/surface/hook-load-fail-closed.test.ts`, new file, on a temporary copy of `src/`, `bin/` and `package.json` (the `lazyPackage` approach of `tests/surface/hook-lazy.test.ts`, its own copy in the new file) with `src/cli/main.ts` replaced by a module that throws `boom` at import: `node bin/aidlc.js hook auto` and `node bin/aidlc.js -C <repo> hook production-gate` on a `PreToolUse` Bash event (`git status`) exit 2, empty stdout, stderr exactly the R1 line with `<message>` `boom`; a thrown message `a\nb` gives `a | b`. RED on main (exit 1). [R1] [dod arm 2]
  - 2. Same file, `src/hooks/entry.ts` replaced by a module that throws at import: `node bin/aidlc-hook.js` on the same `PreToolUse` event exits 2 with the R1 line. RED on main (exit 1). [R1] [dod arm 2]
  - 3. Same file, both broken packages: a `Stop` event, a `UserPromptSubmit` event, `{}` and stdin `not json` exit 1 through each entry, empty stdout, stderr non-empty and without `blocked`. `node bin/aidlc.js goal list` with the broken `main.ts` and stdin left open (a pipe never written or closed, killed after 10 s) exits 1 before the timeout, proving it never reads stdin. [R2] [dod arm 2]
  - 4. `tests/surface/hook-lazy.test.ts`, `tests/surface/hook-fail-closed.test.ts`, `tests/surface/hook-name.test.ts` and `tests/infra/bin-entry.test.ts` pass unchanged; `git diff origin/main --stat -- tests/` lists only the new file. `npm run bench -- --check` passes on the candidate (output pasted in the attempt evidence). [R3] [dod arm 2]
  - 5. `docs/OPERATIONS.md`: the sentence named in R4 is replaced by text stating R1 and R2 (reviewer-verified against the diff). `changelog.d/T0-HOOK-LOAD-FAIL-CLOSED.md` holds one line in the form of `changelog.d/README.md`. [R4] [dod arm 2]
  - 6. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 120
tdd: true
sweep: "On main at be12b5ff `bin/aidlc.js` awaits `import(main)` outside its try, so a module the CLI imports statically (`src/cli/main.ts:13`, the goal store, among others) that fails to load ends the process through an unhandled rejection with exit 1 and a stack trace, before `runHook`; the issue's `aidlc: <message>` form applies only to a throw of `main()`. `bin/aidlc-hook.js` awaits `import(entry)` with no catch, so a broken `src/hooks/entry.ts` or `src/hooks/index.ts` (both static imports of the entry) exits 1 the same way. Claude Code runs the tool on exit 1. The template hook command is `npx --no-install aidlc hook auto` (`tests/surface/templates.test.ts:72`), and `aidlc init` writes `node .../bin/aidlc-hook.js` when it can see the package (docs/OPERATIONS.md, Hooks), so downstream repositories take both paths; changing the template alone would not fix the second, nor installs already initialized. The `-C` preAction hook already exits 2 for `hook` (`src/cli/main.ts:275`). `readStdinJson` (`src/hooks/index.ts:794`) cannot be used, since `src/` is what failed to load: the handler lives in `bin/`, which `package.json` `files` publishes. The bench journeys run `bin/aidlc-hook.js` and `aidlc goal list` with modules that load, so a handler imported only inside the catch adds nothing there. Callers grep (lesson T0-HOOK-FAIL-CLOSED): tests that run or read the bin entries are tests/infra/bin-entry.test.ts, tests/surface/hook-lazy.test.ts, hook-name.test.ts, hook-git-prefetch.test.ts, bench.test.ts and the CLI spawn tests; none breaks a CLI or hook module at import, so none sees the changed path."
forbid: [network]
non_goals:
  - "a throw of `main()` or of a guard after the modules load (card T0-HOOK-FAIL-CLOSED covers guards; `main()` throws exit 1 as before)"
  - "a failure of `bin/resolve-entry.js` or of Node itself, before the entry can run any code"
  - "changing the template hook command or `aidlc init` wiring"
  - "Stop and UserPromptSubmit, which stay fail-open (R2)"
  - "an exemption for `aidlc doctor` or any repair command"
hygiene: "From issue 508, a follow-up of T0-HOOK-FAIL-CLOSED (PR 507, issue 501). RED first: acceptance 1 and 2 on main. The broken package lives in a temporary directory, so the checkout is never broken. The handler reads stdin with `readFileSync(0)` only after the import failed and only for a hook entry, so a CLI command on a TTY never waits for input."
---

# T0-HOOK-LOAD-FAIL-CLOSED

From issue 508, listed in the non-goals of T0-HOOK-FAIL-CLOSED (PR 507).

## Why
A hook process whose CLI or hook modules fail to load exits 1 today, and Claude Code runs the tool call on exit 1. So a broken install turns every PreToolUse guard off, with only a stack trace on stderr.

## Deliverable
A small `bin/hook-load-failure.js` that both bin entries import only when their module import throws: it reads the event and exits 2 on PreToolUse, else exits 1 as before. The test on a broken temporary package, a docs sentence and a changelog line.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/hook-load-fail-closed.test.ts tests/surface/hook-lazy.test.ts tests/surface/hook-fail-closed.test.ts tests/surface/hook-name.test.ts tests/infra/bin-entry.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: a load failure on PreToolUse exits 2 through both entries; other events exit 1; a loading install behaves as before.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
