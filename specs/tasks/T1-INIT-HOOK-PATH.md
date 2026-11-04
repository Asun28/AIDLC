---
id: T1-INIT-HOOK-PATH
title: aidlc init writes a hook command that runs on a repository with no Node package, and aidlc doctor reports a hook command that does not run
status: todo
branch: T1-INIT-HOOK-PATH
worktree: D:\wt\AIDLC\T1-INIT-HOOK-PATH
plan_ref: plans/init-no-node.md#order-of-work
allow_paths:
  - src/scaffold/init.ts
  - src/cli/main.ts
  - src/probes/hook-wiring.ts
  - tests/surface/init-no-package.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-INIT-HOOK-PATH.md
dod_command: npm run typecheck && node --test tests/surface/init-no-package.test.ts tests/infra/init.test.ts tests/surface/ps-guard-wire.test.ts tests/surface/mirror.test.ts tests/surface/hook-lazy.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `initProject` receives `hookEntry` and the target has no `node_modules/aidlc/bin/aidlc-hook.js`, is not the aidlc package, and has no `package.json` whose `dependencies` or `devDependencies` holds the key `aidlc`, whatever its value, the hook command written to every event shall be `node "<hookEntry>"`, with forward slashes.
  - R2. The `aidlc init` command shall pass as `hookEntry` the absolute path of the `bin/aidlc-hook.js` of the running CLI, when that file exists. A call of `initProject` with no `hookEntry` shall write what it writes at 417df0a.
  - R3. WHEN `mergeSettings` writes the dispatcher for an event, that event shall hold it exactly once: any other dispatcher spelling and any repeat, on any entry of the event, comes off, an entry left with no hook is dropped, and a foreign hook stays. A second `aidlc init` changes nothing.
  - R4. `isDispatcherCommand` (`src/scaffold/init.ts`, exported) shall accept the three spellings of `DISPATCHER_COMMANDS` and a command matching `node "<path>/bin/aidlc-hook.js"` whose path is absolute and local (it starts with one `/` or a drive letter and `:/`, not `//`) and holds no backslash and none of `"`, `$`, backtick, `%`, `&`, `|`, `<`, `>`, `^`, NUL or a line break; `moveOffOldMatcher` and R3 use it. WHEN the command R1 would write is one `isDispatcherCommand` refuses, `resolveHookCommand` shall return the npx form.
  - R5. `aidlc doctor` shall carry a `hookCommand` field read from the first `PreToolUse` dispatcher of `.claude/settings.json`: `ok: <command>` when the file that command starts exists and is a file, `FAILED: every guard is off until this command runs: <command>` when it does not, and `not wired` when the settings file is absent or holds no dispatcher. For the npx text the file is `node_modules/aidlc/bin/aidlc-hook.js` under the root. `aidlc doctor` starts no process for this line and keeps its exit code.
  - R6. `docs/OPERATIONS.md` shall carry the OPERATIONS paragraph of the Doc text section after the paragraph starting `A PowerShell tool call is under the same rule`.
  - R7. The CHANGELOG Unreleased section shall carry the entry of the Doc text section.
acceptance:
  - 1. `tests/surface/init-no-package.test.ts` - `initProject` with `hookEntry` over a directory with no `package.json` writes `node "<hookEntry>"` on every hook entry; over a directory whose `package.json` holds the key `aidlc` in `dependencies` or `devDependencies`, also with an empty version, it writes `npx --no-install aidlc hook auto`; a `dependencies` value that is not an object lists nothing and does not throw; over one with `node_modules/aidlc/bin/aidlc-hook.js` it writes the direct `node` form. [R1] [dod arm 2]
  - 2. Same file - a real hook process started with the written command, on a temp target with no `package.json`, exits 2 on a `Bash` event matching a `DEFAULT_HOOK_CONFIG.productionPatterns` entry with no approval set, and exits 0 on `echo hello`. [R1] [R2] [dod arm 2]
  - 3. Same file - `initProject` with no `hookEntry` writes `npx --no-install aidlc hook auto`, and `tests/infra/init.test.ts` and `tests/surface/ps-guard-wire.test.ts` stay green and unedited. [R2] [dod arm 2]
  - 4. Same file - over a settings file whose new-matcher entry holds `npx --no-install aidlc hook auto` and a foreign hook, `initProject` with `hookEntry` leaves the absolute dispatcher once and the foreign hook, and a second call changes no byte of the file. The same holds for `Stop` and `UserPromptSubmit`, and for an absolute dispatcher that names another path. An entry holding the dispatcher twice and another spelling once leaves the dispatcher once, and a dispatcher under another matcher of the event comes off. [R3] [R4] [dod arm 2]
  - 5. Same file - `isDispatcherCommand` refuses `node "x.js"`, `node "a/bin/aidlc-hook.js" ; rm -rf x`, an empty string, a relative path, a UNC path, a path starting `--eval=`, and a path holding `&`, `|`, `<`, `>`, `^` or NUL. A `hookEntry` holding `&` makes `resolveHookCommand` return the npx form. [R4] [dod arm 2]
  - 6. Same file - `aidlc doctor --json` reports `ok: <command>` for each of the absolute, the two relative and the npx spellings with its file present, and a marker file written by that file proves it did not run. It reports the `FAILED` text for each with its file missing or a directory in its place, and `not wired` with no settings file, with one that does not parse, and with one whose only hook is a foreign command. `src/probes/hook-wiring.ts` imports no `node:child_process`. [R5] [dod arm 2]
  - 7. Same file - `docs/OPERATIONS.md` holds the OPERATIONS paragraph and `CHANGELOG.md` the Unreleased entry of the Doc text section; a test reads each exact text and fails with it removed. [R6] [R7] [dod arm 2]
depends_on: []
budget: 500
tdd: true
sweep: "git grep on main 417df0a: `resolveHookCommand` is defined at src/scaffold/init.ts:130, called at :162 and by tests/surface/mirror.test.ts:66 with the aidlc root, which keeps its result. `initProject` over a temp target asserts the npx form at tests/surface/ps-guard-wire.test.ts:100, 109 and 122 and tests/infra/init.test.ts:71, so `hookEntry` is optional and only the CLI passes it. The doctor fields are built at src/cli/main.ts:208 to 228 and no test deep-equals them: `git grep -n 'baseSync\\|workingTree' tests` finds tests/infra/base-sync.test.ts only, on `baseSyncReport`. tests/infra/init.test.ts:166 pins the Setup sentences of OPERATIONS and tests/surface/hooks.test.ts:864, 1100 and 1454 pin Hooks paragraphs, so the new text is its own paragraph and no existing line changes. R2 block F1 on 5d87b0a said `&` splits a command inside double quotes under cmd.exe. A probe disproved it: `node "x&mkdir m&/bin/aidlc-hook.js"` under `shell: true` exits 1 and creates no marker, while the control with `&` outside the quotes creates it, and the path class already refused `"`. The change stays as hardening: a `node` spelling runs with no shell, so the timeout reaches the hook itself, and the path class excludes the cmd separators. R3 decision 2 on 67294ca raised a repository `node.exe` found through the working directory and a `C:/` path that is relative on POSIX. Each round on this card found another way a launched command could reach repository code, so doctor now launches nothing: the file check names the two failures this goal exists for, a missing package and a moved checkout, and a hook file that exists and fails to start is a non-goal. The event-wide merge came from the repair of decision 1: Budget raised from 400 to 500 for them. Budget raised from 340 to 400 after R3 decision 1 on f758114, which raised a Node option in the path, a NUL in the path, a repeated dispatcher and an empty version string. Budget raised from 220 to 340 before review: the seven acceptance items need 236 test lines, and the source and docs are +70/-14."
forbid: [weakening or skipping a test to go green, editing tests/infra/init.test.ts or tests/surface/ps-guard-wire.test.ts or tests/surface/hooks.test.ts, starting any process from the `hookCommand` line, changing the exit code of `aidlc doctor`, an edit of any file under `.aidlc/`]
non_goals: [a shim or wrapper installed into the target, publishing a package, the rename, the base branch and workflows (T1-INIT-BASE-CI), the `npx --no-install aidlc` spellings in `src/hooks/index.ts` and the agent files, a hook that fails closed when node is missing, detecting a hook file that exists and fails to start]
hygiene: "Prove each arm with a mutant: dropping the `package.json` check fails acceptance 1; dropping the R3 removal fails acceptance 4; widening `isDispatcherCommand` to any command ending in `aidlc-hook.js\"` fails acceptance 5; a file check that accepts a directory fails acceptance 6. The doc test reads the exact line (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS)."
doc_sync: CHANGELOG.md, docs/OPERATIONS.md
---

# T1-INIT-HOOK-PATH

## Deliverable
`aidlc init` on a repository with no Node package writes a hook command that runs, so the guards work there. `aidlc doctor` reports a hook command that does not run, because a hook that exits 1 does not stop a tool call and says nothing.

## Implementation notes
- `resolveHookCommand(target, hookEntry?)` keeps its first two branches. Read `package.json` with a try, as the second branch does; a file that does not parse counts as listing nothing.
- The CLI can use `fileURLToPath(new URL('../../bin/aidlc-hook.js', import.meta.url))`, which holds from both `src/cli/main.ts` and `dist/cli/main.js`.
- The command loop in `mergeSettings` compares with `TEMPLATE_HOOK_COMMAND`, so it replaces every event's command in one place.
- In the merge, filter `same.hooks` with `isDispatcherCommand(x.command) && x.command !== h.command` removed, then push. Keep the order of a foreign hook.
- `src/probes/hook-wiring.ts` exports `hookWiringReport(root)`. Parse the settings with a try and report `not wired` on a parse failure. Use `statSync(file).isFile()` in a try. It starts no process.

## Doc text
OPERATIONS paragraph:

On a repository with no Node package (card T1-INIT-HOOK-PATH), `aidlc init` writes the hook command as `node "<path>/bin/aidlc-hook.js"`, the absolute path of the CLI that ran it, because `npx --no-install aidlc hook auto` exits 1 there and a hook that exits 1 does not stop a tool call. The path is per machine: on another machine, or after the checkout moves, every guard is off until `aidlc init` runs again, and `aidlc doctor` shows it on the `hookCommand` line as `FAILED`.

CHANGELOG entry:

- T1-INIT-HOOK-PATH (bugfix): `aidlc init` on a repository with no Node package writes the hook command as `node "<path>/bin/aidlc-hook.js"` with the absolute path of the running CLI, because `npx --no-install aidlc hook auto` exits 1 there and leaves every guard off. A matcher entry holds the dispatcher once, and `aidlc doctor` gains a `hookCommand` line that checks the file of the wired dispatcher, starts no process, and reports `ok`, `FAILED` or `not wired`.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/init-no-package.test.ts tests/infra/init.test.ts tests/surface/ps-guard-wire.test.ts tests/surface/mirror.test.ts tests/surface/hook-lazy.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: every listed file passes; the acceptance tests name their acceptance number.
