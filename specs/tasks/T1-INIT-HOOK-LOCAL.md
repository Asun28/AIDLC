---
id: T1-INIT-HOOK-LOCAL
title: aidlc init writes an absolute dispatcher command to .claude/settings.local.json and adds that file to .gitignore, leaves no dispatcher in .claude/settings.json in that case, and moves an absolute command an earlier init wrote there
status: todo
branch: T1-INIT-HOOK-LOCAL
worktree: D:\wt\AIDLC\T1-INIT-HOOK-LOCAL
plan_ref: plans/install-portability.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - src/scaffold/init.ts
  - tests/surface/init-no-package.test.ts
  - tests/infra/init.test.ts
  - CHANGELOG.md
  - specs/tasks/T1-INIT-HOOK-LOCAL.md
dod_command: npm run typecheck && node --test tests/surface/init-no-package.test.ts tests/infra/init.test.ts tests/surface/readme.test.ts tests/surface/init-base-ci.test.ts tests/surface/ps-guard-wire.test.ts tests/surface/cli-cwd-paths.test.ts tests/surface/hook-wiring-local.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `options.hooks` is not `false` and `resolveHookCommand(target, options.hookEntry)` (src/scaffold/init.ts:219) returns a command that matches `ABSOLUTE_DISPATCHER` (:206), `mergeSettings` (:285) shall settle the template's hook entries, carrying that command, in `<target>/.claude/settings.local.json` by the rules `settleDispatcher` applies to `.claude/settings.json` today (:265-283), creating the file as an object with the one key `hooks` when it is absent, keeping every other key of an existing file, and reporting `.claude/settings.local.json` in `created` or `merged`.
  - R2. In the case of R1, `.claude/settings.json` shall hold no command that `isDispatcherCommand` (:209) accepts; the rules are those of acceptance detail 1.
  - R3. WHEN `options.hooks` is not `false` and the resolved command does not match `ABSOLUTE_DISPATCHER`, `.claude/settings.json` shall be written as on main, and an existing `.claude/settings.local.json` that holds a dispatcher loses it by the removal rule of acceptance detail 1 and is reported in `merged`; an absent one is not created, and one with no dispatcher keeps its bytes and is not reported.
  - R4. WHEN a run settles the dispatcher in `.claude/settings.local.json` (R1), the entry `.claude/settings.local.json` shall join the entries of :180 for that run, after `.review/`, so it is appended to the target's `.gitignore` under the same header by the same rule (:181-186, a line that equals the entry once trimmed counts as present); in every other run the `.gitignore` handling is as on main.
  - R5. WHEN `options.hooks` is `false`, init shall neither read nor write `.claude/settings.local.json`, add no ignore entry for it, and treat `.claude/settings.json` as on main.
  - R6. `mergeSettings` shall read and parse both settings files before it writes either, and throw `.claude/settings.local.json is not a JSON object` for a local file whose text parses to anything but an object that is not an array (text that does not parse throws the parser's error, as an unparsable `.claude/settings.json` does at :299), so neither settings file is written by that run.
  - R7. With `options.dryRun`, init shall write neither settings file and no `.gitignore`, and report what a real run would report.
  - R8. A second init with the same options shall change no byte of `.claude/settings.json`, `.claude/settings.local.json` or `.gitignore`.
  - R9. CHANGELOG.md, Unreleased, shall carry the entry of acceptance detail 4 directly above the entry that begins `- T1-HOOK-WIRING-LOCAL`.
acceptance:
  - 1. `tests/surface/init-no-package.test.ts`, new test "T1-INIT-HOOK-LOCAL acceptance 1: with no package the dispatcher is written to settings.local.json for the three events, settings.json holds what --no-hooks writes, and the file is ignored". `initProject({ target, hookEntry })` into an empty directory; the local file deep-equals `{ hooks }` with the template's three entries carrying the absolute command; `.claude/settings.json` is byte-identical to the one `initProject({ target: other, hooks: false })` writes; `.gitignore` is the header of :184 and the four entries; `created` holds both settings files; `hookWiringReport(target)` is `ok` with the absolute command. Fails on main by assertion. [R1] [R2] [R4] [dod arm 2]
  - 2. Same file, new test "T1-INIT-HOOK-LOCAL acceptance 2: an existing settings.local.json keeps its other keys and foreign hooks and gains the dispatcher once per event, and a second init changes no byte". The fixture of acceptance detail 2; after the first init the three files are read, and after the second each is byte-identical. Fails on main by assertion. [R1] [R8] [dod arm 2]
  - 3. Same file, new test "T1-INIT-HOOK-LOCAL acceptance 3: a settings.json written by an earlier init with the absolute command loses it, and the local file gains it". The shared file is the template with each hook command replaced by `OTHER_PATH` (:17), which is what init wrote before this card on another machine; after init its `hooks` holds no event and the local file holds the three entries with `ABSOLUTE` (:14). Fails on main by assertion. [R1] [R2] [dod arm 2]
  - 4. Same file, new test "T1-INIT-HOOK-LOCAL acceptance 4: with a command that is not absolute the shared file is written as before and a local dispatcher is removed". Three rows (a local install, :91-95; a `package.json` holding the key `aidlc`, :82; no `hookEntry`, :106), each with an existing local file holding `ABSOLUTE` beside a foreign hook and a `permissions.allow` list: `commands(target)` is the row's command three times, the local file keeps the foreign hook and the list and holds no dispatcher, and `merged` names it. Two more rows: a local file with no dispatcher keeps its bytes and is not in `merged` or `created`, and with no local file none is created. Fails on main by assertion for the first three rows. [R3] [dod arm 2]
  - 5. Same file, new test "T1-INIT-HOOK-LOCAL acceptance 5: --no-hooks and --dry-run". With `hooks: false` and a `hookEntry`: an empty target gets no local file and no ignore line for it, and a target whose two settings files each hold `ABSOLUTE` keeps the `hooks` of both. With `dryRun: true` and a `hookEntry` into an empty directory: nothing is written and `created` holds both settings files and `merged` holds `.gitignore`. The `hooks: false` rows pass on main; the `dryRun` row fails on main by assertion. [R5] [R7] [dod arm 2]
  - 6. Same file, new test "T1-INIT-HOOK-LOCAL acceptance 6: a settings.local.json that is not a JSON object stops init before either settings file is written". Rows `{ not json`, `[]`, `null`, `5` and `"x"`; each throws (the four that parse with the message of R6), and `.claude/settings.json`, which held a foreign hook, is byte-identical afterwards. Fails on main by assertion (no throw). [R6] [dod arm 2]
  - 7. Same file, new test "T1-INIT-HOOK-LOCAL acceptance 7: the ignore entry is appended once and only when the local file is wired". A `.gitignore` that already holds the line (alone, with spaces around it, with CRLF line ends) gains no second one; one that holds `.claude/` only gains the line; a run whose command is not absolute adds none. Fails on main by assertion for the rows that expect the line. [R4] [dod arm 2]
  - 8. Same file, the assertions listed in acceptance detail 3 change as listed there, by the owner's decision of 2026-11-16; every other line of the tests that exist on main is unchanged, and the two "acceptance 2" tests (:130, :137) pass through the changed helper. The changed assertions fail on main. [R1] [R2] [dod arm 2]
  - 9. `tests/infra/init.test.ts`, test "T1-INIT-SURFACE acceptance 1: --no-hooks writes the file set of init, the deny list and no hooks entry" (:238; its name ends with a requirement tag of its own card, left out here): lines :243, :245, :247 and :249 change as acceptance detail 3 lists; no other line of the file changes. The changed assertions fail on main. [R2] [R5] [dod arm 2]
  - 10. tests/surface/readme.test.ts (its :60-69 compare the README path list with `initProject({ target })`, which passes no `hookEntry`), tests/surface/init-base-ci.test.ts, tests/surface/ps-guard-wire.test.ts, tests/surface/cli-cwd-paths.test.ts (its `init --dry-run` runs) and tests/surface/hook-wiring-local.test.ts pass with no line changed. They pass on main and with this card. [R3] [R7] [dod arm 2]
  - 11. The CHANGELOG entry is the text of acceptance detail 4 (reviewer-verified against the diff). [R9]
depends_on: [T1-HOOK-WIRING-LOCAL]
budget: 200
tdd: true
sweep: "On main at 35de54fe. `grep -rlE 'settings\\.json|settings\\.local' tests bench src` and `grep -rnE 'initProject\\(|.init.,' tests bench`. Code: src/scaffold/init.ts:140 (the one call of `mergeSettings`), :178-186 (the `.gitignore` entries), :206 (`ABSOLUTE_DISPATCHER`), :219-228 (`resolveHookCommand`: `node node_modules/aidlc/bin/aidlc-hook.js` with a local install, `node bin/aidlc-hook.js` or the npx form inside the aidlc package, the absolute form only with a `hookEntry` and no `aidlc` key in the target's package, else the npx form), :285-314 (`mergeSettings`); src/cli/main.ts:297-298 (the CLI always passes `hookEntry` when bin/aidlc-hook.js exists). Tests that pin the absolute command inside `.claude/settings.json`, all in tests/surface/init-no-package.test.ts: :65-70, :72-78, the helper `runWritten` :120-128 (used by :130 and :137), :147-155 (six tests), :163-180 (six rows and their test), :182-186. Tests that run the CLI `init` into a target with no package, so with the absolute command: tests/infra/init.test.ts:238-252 (compares the file set and `created` of a plain init with those of `--no-hooks`, and requires a `hooks` key in the plain `.claude/settings.json`; changed by acceptance 9), :254-267 (`notDeepEqual` of the hooks after a plain init: still holds), :269-273 (`--no-hooks` only); tests/surface/init-base-ci.test.ts:308-316 and tests/surface/cli-cwd-paths.test.ts:376, :495, :558 (`--dry-run`: they read `skipped`, one skip line or the exit code, and that nothing is written). Calls of `initProject` without `hookEntry`, which resolve to the npx form and write what they write on main: tests/infra/init.test.ts:28-101 and :148 (the `.gitignore` bytes of T0-INIT-REVIEW-IGNORE), tests/surface/init-base-ci.test.ts, tests/surface/ps-guard-wire.test.ts:100-120, tests/surface/readme.test.ts:63. tests/surface/init-no-package.test.ts:80-109 (the npx and relative forms) and :189-224 (`isDispatcherCommand`, `resolveHookCommand`) hold unchanged. Doc sentences that describe the old placement, each pinned and left to T1-INIT-HOOK-LOCAL-DOCS: README.md:95 (tests/surface/readme.test.ts:52), docs/OPERATIONS.md:15 (readme.test.ts:57) and :325 (init-no-package.test.ts:320). This repository's own `.claude/settings.json` uses `node bin/aidlc-hook.js` (the package is named aidlc), so tests/surface/mirror.test.ts is not affected."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test other than the changes of acceptance 8 and 9
  - an absolute path, or any dispatcher command, written into `.claude/settings.json` in the case of R1
  - a change to `resolveHookCommand`, `isDispatcherCommand`, `ABSOLUTE_DISPATCHER`, `DISPATCHER_COMMANDS`, `stripLegacyHooks` or the template files
  - starting a process from src/scaffold/init.ts (:95-97 says why init starts none), so no `git check-ignore`
  - writing `permissions` or any key other than `hooks` into `.claude/settings.local.json`
  - a change to README.md, docs/OPERATIONS.md, src/probes/hook-wiring.ts or src/cli/main.ts
  - a new file under src, or a new dependency
  - the sequence of two hash signs and a space in the CHANGELOG entry
non_goals:
  - README.md and docs/OPERATIONS.md, which T1-INIT-HOOK-LOCAL-DOCS rewrites with their pinned sentences; until it merges those sentences describe the old placement
  - an ignore pattern other than the exact line (`.claude/`, a glob, a nested `.gitignore`, `.git/info/exclude`); init does not recognise it and appends the line, which is then redundant
  - a negation line after the entry (`!.claude/settings.local.json`); init does not read it and the file stays tracked
  - a `.claude/settings.local.json` that git already tracks; init rewrites it and does not untrack it
  - a local file whose `hooks` value is not an object of arrays of entries; the merge throws or misreads it as it does for `.claude/settings.json` on main, and nothing validates it
  - a `.claude/settings.json` that parses to something other than an object; as on main
  - per-guard hooks of release 0.1.0 in `.claude/settings.local.json`; `stripLegacyHooks` and `moveOffOldMatcher` are applied to `.claude/settings.json` only, and such a hook stays
  - the files init wrote before `mergeSettings` ran (the skills and agents of :138-139) when the local file is refused; they stay, as they do on main when `.claude/settings.json` does not parse
  - a teammate who never runs `aidlc init`; no dispatcher is wired on that machine and `aidlc doctor` prints `not wired`
  - whether Claude Code runs hook entries of `.claude/settings.local.json`; taken from the owner's reading of the Claude Code documentation on 2026-11-16, and acceptance 8 runs the written command as a process, not through Claude Code
hygiene: "Line numbers are from main at 35de54fe; read them again at PREPARE. This card reverses, by the owner's decision of 2026-11-16 (intent/install-portability.md, Constraints), a placement that plans/init-no-node.md accepted in its Risks (`The absolute path is per machine and .claude/settings.json is committed`) and that card T1-INIT-HOOK-PATH-2 tested; acceptance detail 3 is the complete list of the assertions that change for it, and a change to any other existing assertion needs a card amendment on main first. Tests first, in two commits: the first holds the new tests and the changed assertions and records them failing on main by assertion; the second changes init.ts. The budget is at the limit: write the new rows as tables and reuse `tempDir`, `targetWithSettings`, `targetWithPackage`, `hooksOf` and `commands` (:31-62), giving `hooksOf` and `commands` a file parameter. If the count passes 200 at PREPARE, stop and report before the first test. Revert table, each row a scratch change restored afterwards: the absolute command also written to the shared file (1, 3 and 8 red); the local file created with `permissions` (1 red); other keys of an existing local file dropped (2 red); the removal of R3 dropped (4 red); the ignore entry added on every run (7 red); the ignore entry not added (1 and 7 red); the parse of the local file moved after the write of the shared file (6 red); the local file written under `dryRun` (5 red); an event left as an empty list in the shared file (3 and 8 red). Run the changed test files on Linux as well as Windows before the first review, and `npm test` once. Insert the CHANGELOG entry directly above the entry that begins `- T1-HOOK-WIRING-LOCAL`, followed by a blank line."
---

# T1-INIT-HOOK-LOCAL

## Deliverable
`aidlc init` in a repository with no aidlc package writes its hook entries, whose command names the absolute path of the running CLI, to `.claude/settings.local.json`, adds that file to `.gitignore`, and leaves no dispatcher in the committed `.claude/settings.json`. A repository initialised before this card gets the absolute command moved on its next init.

## Why
Outside review of 2026-11-16, confirmed on main at 35de54fe: `resolveHookCommand` returns `node "<absolute path>/bin/aidlc-hook.js"` for a target with no aidlc package (src/scaffold/init.ts:223-226), and `mergeSettings` writes it into `.claude/settings.json`, which is committed. On another machine that path names nothing, the hook exits 1 and every guard is off. plans/init-no-node.md accepted this for personal use. Owner decision of 2026-11-16: the machine-specific command goes to `.claude/settings.local.json` and the committed file keeps no absolute path. Spec specs/install-portability.md R4 and R5.

The shared file gets no dispatcher at all in that case, not the npx form: `npx --no-install aidlc hook auto` exits 1 in a repository with no aidlc package (the reason card T1-INIT-HOOK-PATH-2 introduced the absolute form), and Claude Code would run it beside the local entry on every event.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/init-no-package.test.ts tests/infra/init.test.ts tests/surface/readme.test.ts tests/surface/init-base-ci.test.ts tests/surface/ps-guard-wire.test.ts tests/surface/cli-cwd-paths.test.ts tests/surface/hook-wiring-local.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes. Arm 1 is the typecheck, arm 2 the test files.

## Acceptance detail

### 1. The shared file when the command is absolute, and the removal rule
A new `.claude/settings.json` is the template without its `hooks` key, the bytes `--no-hooks` writes on main (:288, :291-297).

An existing one gets the deny merge of :300-301 as on main. Its `hooks`, when it has the key, go through `stripLegacyHooks` and `moveOffOldMatcher` as on main; then the removal rule: every hook whose command `isDispatcherCommand` accepts is removed from every entry of every event, an entry left with no hook is dropped, and an event left with no entry is removed from `hooks`. A foreign hook keeps its entry and its place. A `hooks` object left with no event stays as `{}`; a file with no `hooks` key gets none.

R3 applies the same removal rule to the `hooks` of an existing `.claude/settings.local.json`.

### 2. The fixture of acceptance 2
`.claude/settings.local.json` holds `{ "permissions": { "allow": ["Bash(git *)"] }, "custom": 1, "hooks": { "PreToolUse": [{ "matcher": NEW_MATCHER, "hooks": [FOREIGN_A, { "type": "command", "command": OTHER_PATH }] }] } }` (the constants of :17-21). After init it holds the same `permissions` and `custom`, `PreToolUse` equal to one entry of `NEW_MATCHER` with `FOREIGN_A` and then the `ABSOLUTE` hook, and `Stop` and `UserPromptSubmit` each equal to the template's entry with `ABSOLUTE`.

### 3. The existing assertions that change
In tests/surface/init-no-package.test.ts:

- :68 and :76 (the two "acceptance 1" tests of :65 and :72): the three commands are read from `.claude/settings.local.json`, and each test also requires that `.claude/settings.json` has no `hooks` key.
- :124-125 (`runWritten`): the written command is read from `.claude/settings.local.json`.
- :151-154 (the six tests named `acceptance 4: <event> entry holding <spelling> and foreign hooks ends with the absolute dispatcher once, and a second init changes no byte`): the event of `.claude/settings.json` equals one entry with `FOREIGN_A` and `FOREIGN_B`; the same event of the local file equals one entry of the same matcher with the `ABSOLUTE` hook; the second init changes no byte of either file.
- :164-169 (the `after` of the six `REPEATS` rows) and :175-178 (their test): the `PreToolUse` of `.claude/settings.json` is, in row order, one new-matcher entry with `FOREIGN_A` and `FOREIGN_B`; absent; one new-matcher entry with `FOREIGN_A`; one new-matcher entry with `FOREIGN_A`; one `Bash` entry with `FOREIGN_A`; absent. In every row the `PreToolUse` of the local file is one new-matcher entry with the `ABSOLUTE` hook, and the second init changes no byte of either file.
- :185 (`an absolute dispatcher comes off an old-matcher entry and a foreign hook stays`): the `PreToolUse` of `.claude/settings.json` is the old-matcher entry with `FOREIGN_A` alone, and that of the local file is one new-matcher entry with the `ABSOLUTE` hook.

In tests/infra/init.test.ts, test :238:

- :243 and :245: `created` and the file set of the plain init, each without `.claude/settings.local.json`, equal those of the `--no-hooks` init, and the plain init's `created` holds `.claude/settings.local.json`.
- :247: the `hooks` key with the three events is required of the plain target's `.claude/settings.local.json`, and `.claude/settings.json` of the plain target has no `hooks` key.
- :249: `.claude/settings.json` of the `--no-hooks` target deep-equals that of the plain target.

### 4. The CHANGELOG entry
`- T1-INIT-HOOK-LOCAL (owner decision of 2026-11-16): on a repository with no aidlc package, `aidlc init` writes its hook entries, whose command names the absolute path of the CLI that ran it, to `.claude/settings.local.json` and adds that file to `.gitignore` when no line names it. `.claude/settings.json` then holds no aidlc dispatcher entry: a new file is the one `--no-hooks` writes, and an absolute command an earlier init wrote there is removed on the next init. When the command is not absolute (a local install, the aidlc repository itself, or the npx form) `.claude/settings.json` is written as before and a dispatcher left in `.claude/settings.local.json` is removed. A `.claude/settings.local.json` that is not a JSON object stops init before either settings file is written. Each person who works in a repository with no aidlc package runs `aidlc init` once; this replaces the placement of T1-INIT-HOOK-PATH, which put the absolute path into the committed file.`
