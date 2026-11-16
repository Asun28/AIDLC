---
id: T1-INIT-PROFILE
title: aidlc init --profile claude-github --reviewer-model <id> lays templates/profiles/claude-github.json over the template configuration (claude-code provider, github ship path, gateRequired true, a Claude formal reviewer running the named model), refuses an unknown profile or a missing or malformed reviewer model before any write, and docs/QUICKSTART.md lists the commands from install to a first pull request
status: todo
branch: T1-INIT-PROFILE
worktree: D:\wt\AIDLC\T1-INIT-PROFILE
plan_ref: plans/install-portability.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - src/scaffold/init.ts
  - src/cli/main.ts
  - templates/profiles/claude-github.json
  - docs/QUICKSTART.md
  - docs/OPERATIONS.md
  - tests/surface/readme.test.ts
  - changelog.d/T1-INIT-PROFILE.md
  - specs/tasks/T1-INIT-PROFILE.md
dod_command: npm run typecheck && node --test tests/surface/readme.test.ts tests/infra/init.test.ts tests/surface/init-no-package.test.ts tests/surface/init-base-ci.test.ts tests/surface/cli-cwd-paths.test.ts tests/surface/templates.test.ts tests/surface/prose.test.ts tests/core/config.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `InitOptions.profile` (new, optional) is present, `initProject` (src/scaffold/init.ts:107) shall, before its first write, throw `unknown profile <the name as a JSON string>; profiles: <names>` for a name that does not match `^[a-z0-9]+(-[a-z0-9]+)*$` or for which `templates/profiles/<name>.json` is not a file, where `<names>` is the base names of the `.json` files of `templates/profiles`, sorted and joined with a comma and a space.
  - R2. After the check of R1 and before its first write, `initProject` shall throw the message of the row of acceptance detail 3 that `InitOptions.profile` and `InitOptions.reviewerModel` (new, optional) match, each read by presence (`!== undefined`), so no profile is written without a reviewer model the caller named and no reviewer model is taken without a profile.
  - R3. WHEN the checks of R1 and R2 pass with a profile, the configuration init writes (:154-162) shall be the parsed `templates/aidlc.config.json` with the profile laid over it by the rules of acceptance detail 1, and then `cardsDir`, `base` and `shipPath` applied as today (:157-160), so an explicit `--ship-path` wins over the profile.
  - R4. `templates/profiles/claude-github.json` (new) shall hold exactly the object of acceptance detail 2, which names no model.
  - R5. WHEN `InitOptions.profile` is absent, init shall write every file as on main, and with it present every file other than `aidlc.config.json` as without it.
  - R6. The `init` command (src/cli/main.ts:286-300) shall gain the options `--profile <name>` and `--reviewer-model <id>`, neither with a default value, and pass their values to `initProject` as `profile` and `reviewerModel`, so a refusal of R1 or R2 ends the command with exit code 1 and its message on stderr.
  - R7. `docs/QUICKSTART.md` (new) shall hold the commands and the facts of acceptance detail 4, in that order.
  - R8. The usage line of docs/OPERATIONS.md (:9) shall gain ` [--profile claude-github --reviewer-model <id>]` after the `--ship-path` group, the paragraph of acceptance detail 5 stands directly after the paragraph that begins `--no-hooks` writes, and `SETUP_USAGE` of tests/surface/readme.test.ts (:56) pins the new usage line.
  - R9. The new changelog.d/T1-INIT-PROFILE.md shall hold the entry of acceptance detail 6 followed by one line feed.
acceptance:
  - 1. `tests/surface/readme.test.ts`, new test "T1-INIT-PROFILE acceptance 1: init with the profile writes provider claude-code, shipPath github, gateRequired true and the named reviewer model, and every other key as without it". `initProject` without the profile, and with `profile: 'claude-github'` and each of the reviewer models `test-model-a` and `vendor.test-model:1@2026/b`, into empty directories; each profile run's configuration deep-equals the one without, with `shipPath`, `provider` and `gateRequired` set to the values of acceptance detail 2 and `formalReview.command` and `formalReview.reviewer` set to those of detail 2 with that run's model in place of `<reviewer-model>`; its text holds no `<reviewer-model>`, and `loadProjectConfig` of that target parses it with `gateRequired` true. Fails on main by assertion. [R3] [R4] [dod arm 2]
  - 2. Same file, new test "T1-INIT-PROFILE acceptance 2: every file but aidlc.config.json is byte for byte the file init writes without the profile". Two targets of one base name under two parent directories, one with the profile and `test-model-a`; the file sets and the three report lists are equal and each file other than `aidlc.config.json` has equal bytes. Passes on main and with this card: it pins the second half of R5. [R5] [dod arm 2]
  - 3. Same file, new test "T1-INIT-PROFILE acceptance 3: an unknown profile, a missing or malformed reviewer model, or a reviewer model without a profile throws before any write". Name rows `nope`, the empty string, `../claude-github`, `claude-github.json`, `Claude-GitHub`, `a/b`, a name with a backslash and a name with a leading space, each with `reviewerModel: 'test-model-a'`, throw the message of R1, which holds the JSON string of the name and `profiles: claude-github`; `nope` with no reviewer model throws the message of R1 too, since R1 is checked first. With `claude-github`: no reviewer model, and the reviewer models `''`, `' '`, `-x`, `a b`, `a;b`, `a"b`, a model with a backslash and a model with a non-ASCII letter, each throw the row of acceptance detail 3 they match; with no profile, `reviewerModel: 'test-model-a'` throws the third row. After each the target directory does not exist, and with `dryRun: true` each throws the same. Fails on main by assertion (no throw). [R1] [R2] [dod arm 2]
  - 4. Same file, new test "T1-INIT-PROFILE acceptance 4: the CLI exits 1 with the message for an unknown profile and for a profile without --reviewer-model, writes nothing, and exits 0 with both options". `node bin/aidlc.js init <dir> --json` with `--profile nope --reviewer-model test-model-a` (the message of R1 on stderr), with `--profile claude-github` alone (the first row of acceptance detail 3 on stderr; `<dir>` does not exist afterwards), and with `--profile claude-github --reviewer-model test-model-a` (exit 0). Fails on main by assertion (commander refuses the unknown option with another message). [R2] [R6] [dod arm 2]
  - 5. Same file, new test "T1-INIT-PROFILE acceptance 5: --ship-path wins over the profile, an existing aidlc.config.json is skipped, and --dry-run writes nothing". With the profile and `test-model-a`: `shipPath: 'dry-run'` gives `shipPath` `dry-run` and `provider` `claude-code`; a target that holds `aidlc.config.json` keeps its bytes and reports it in `skipped`; `dryRun` creates no file. Fails on main by assertion for the first row. [R3] [dod arm 2]
  - 6. Same file, new test "T1-INIT-PROFILE acceptance 6: without the profile the configuration is the template with cardsDir alone set". The written text equals `JSON.stringify` of the parsed template with `cardsDir` set, two spaces of indent, and one line feed (:156-161; the target is no git repository, so `base` is not set). Passes on main and with this card: it pins the first half of R5. [R5] [dod arm 2]
  - 7. Same file, new test "T1-INIT-PROFILE acceptance 7: every aidlc command of docs/QUICKSTART.md is a registered command with the options the line names". The rule of acceptance detail 4; at least five commands are found, and the init line names `--profile` and `--reviewer-model`. Fails on main (no file). [R7] [dod arm 2]
  - 8. Same file, the literal `SETUP_USAGE` (:56) is the new usage line; no other line of a test that exists on main changes. The test "T1-INIT-SURFACE acceptance 6" (:80) fails on main for the new line. [R8] [dod arm 2]
  - 9. tests/infra/init.test.ts, tests/surface/init-no-package.test.ts, tests/surface/init-base-ci.test.ts, tests/surface/cli-cwd-paths.test.ts, tests/surface/templates.test.ts, tests/surface/prose.test.ts and tests/core/config.test.ts pass with no line changed. They pass on main and with this card. [R5] [dod arm 2]
  - 10. docs/QUICKSTART.md states the facts of acceptance detail 4, the OPERATIONS paragraph is the text of acceptance detail 5 and changelog.d/T1-INIT-PROFILE.md holds the entry of acceptance detail 6 followed by one line feed; no model id stands in templates/profiles/claude-github.json, in src/scaffold/init.ts, in src/cli/main.ts (the option help included) or in docs/QUICKSTART.md (reviewer-verified against the diff); tests/surface/changelog-fragments.test.ts passes with the new file. [R4] [R6] [R7] [R8] [R9] [dod arm 2]
depends_on: [T1-INIT-HOOK-LOCAL, T1-INIT-HOOK-LOCAL-DOCS, T1-GIT-MIN-VERSION, T1-CHANGELOG-FRAGMENTS]
budget: 200
tdd: true
sweep: "On main at 2ef2bbf4. `git grep -nE 'ship-path|no-hooks|cards-dir' -- tests docs README.md templates .claude CLAUDE.md src`, `git grep -nE 'gateRequired' -- src docs templates aidlc.config.json` and `grep -n -iE \"option\\('--[a-z-]*model\" src/cli/main.ts`. The option list of `init` at src/cli/main.ts:289-293, with `--ship-path <name>` passed to `initProject` unchecked (:298); no option of the CLI names a model (the one match is `--skip-model` of `evals run`, :1402). The usage line docs/OPERATIONS.md:9, pinned whole by tests/surface/readme.test.ts:56 and :83 (changed by acceptance 8); README.md names no `init` option list beyond `--cards-dir`, `--force` and `--no-hooks` in the paragraphs readme.test.ts:51-52 pin, which this card does not change. Config: src/config.ts:128 (`shipPath` is `scaffold`, `github` or `dry-run`), :132 (`gateRequired` defaults to false), :135 (`provider` is `claude-api`, `claude-code` or `mock`), :73-74 (`formalReview.command` is a list of non-blank strings and `reviewer` a non-blank string, default `codex`), :159-160 (`gateRequired` true beside `github.requireVerdict` false is refused); src/core/review-policy.ts:105 (with `gateRequired` every block verdict is merge-blocking; without it only a block on the `spec` axis of a tier S card or a card with no tier); templates/aidlc.config.json:11, :17, :20 and :55-63 set `dry-run`, `mock`, `requireVerdict` true and an empty formal command with reviewer `codex`, and the file has no `gateRequired` key; this repository's aidlc.config.json:96 sets `gateRequired` true and :117-131 hold the Claude fallback command and reviewer name whose shape the profile copies, with its model replaced by `<reviewer-model>`. The github ship path takes `repository` from the configuration (src/loop/card-runner.ts:231 passes an empty string when it is unset), and no init option sets it, so the quickstart tells the user to. `resolveHookCommand` (src/scaffold/init.ts:219-228) returns `node node_modules/aidlc/bin/aidlc-hook.js` when the package is installed in the target, which is the quickstart's own install; the local settings file of T1-INIT-HOOK-LOCAL is written only when the target has no aidlc package. package.json:22-28 ships `templates`, so `templates/profiles` is in a tarball and a git install; `copyTree` (:126-152) copies named subtrees only, so the profile file is not laid into a target. Tests that read what init writes and run with no profile: tests/infra/init.test.ts, tests/surface/init-no-package.test.ts, tests/surface/init-base-ci.test.ts (the `base` key), tests/surface/cli-cwd-paths.test.ts:376, :495, :558; tests/core/config.test.ts:38-43 parses templates/aidlc.config.json, which this card does not change. An unknown command followed by `--help` exits 0 and prints its parent's usage (checked on 2026-11-16: `aidlc bogus --help` prints `Usage: aidlc [options] [command]`), so acceptance 7 compares the usage line, not the exit code."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test other than the literal of acceptance 8
  - a change to templates/aidlc.config.json, to this repository's aidlc.config.json or to src/config.ts
  - a profile name used in a path before it passed the pattern of R1
  - a write before the checks of R1 and R2, or a profile applied to an existing `aidlc.config.json` without `--force`
  - a default value for `--profile` or `--reviewer-model`, or a model id in templates/profiles/claude-github.json, src/scaffold/init.ts, src/cli/main.ts (the option help included) or docs/QUICKSTART.md
  - reading `profile` or `reviewerModel` by truthiness; an empty string is present and is refused by the pattern of acceptance detail 3 (lesson 2026-09-25 T0-APPROVER-IDENTITY)
  - a new provider, ship path or reviewer kind, a `preReview` command, or a Codex reviewer in the profile
  - copying `templates/profiles` into a target
  - an `aidlc` command in docs/QUICKSTART.md that the CLI does not register, or the bare `npx aidlc`
  - a change to README.md
  - a new dependency
  - the sequence of two hash signs and a space in the entry
non_goals:
  - a second profile; the directory is read so one more file would be one more name, and none is added here
  - setting `repository` or `github.requiredChecks`; the quickstart tells the user to edit `aidlc.config.json`
  - review timeouts, `maxDiffBytes`, an effort policy and a fallback reviewer in the profile; the written file keeps the template's values and the schema defaults for them
  - checking that the reviewer model names a model the `claude` CLI or the account accepts; init checks the form of the id only, and a wrong id shows at the first R3 run
  - keeping the profile's command in step with `formalReview.fallback` of this repository's aidlc.config.json; no test compares the two
  - a profile file that does not parse or is not an object; init throws the parser's error, or lays nothing over, before any write, and no test covers it because the one shipped file is valid
  - a profile combined with an existing `aidlc.config.json`; the file is skipped as without the option (:116) and the profile changes nothing unless `--force` is given
  - an end-to-end run of the quickstart against GitHub; that is the arc proof of plans/install-portability.md, done by hand after the cards merge
  - a link to the quickstart from README.md
hygiene: "Line numbers are from main at 2ef2bbf4; read them again at PREPARE, after T1-GIT-MIN-VERSION, T1-INIT-HOOK-LOCAL and T1-INIT-HOOK-LOCAL-DOCS have merged, since they edit files this card edits (src/cli/main.ts, docs/OPERATIONS.md). Owner decision of 2026-11-17 (intent/install-portability.md, Constraints): the profile names no reviewer model of its own, the caller names it at setup with no CLI default, and the profile sets `gateRequired`. The plan's outline says each teammate runs `aidlc init` once for the local hook file; against src/scaffold/init.ts:220 that holds only for a repository where aidlc is not installed as a package, so the quickstart states both cases (acceptance detail 4, fact 4). The budget is at the limit: write the rows of acceptance 3 and 4 as tables and keep docs/QUICKSTART.md to the commands and the eight facts; if the count passes 200 at PREPARE, stop and report before the first test. Tests first, in two commits: the first adds the tests and the new `SETUP_USAGE` literal and records acceptance 1, 3, 4, 5 (first row), 7 and 8 failing on main; the second adds the code, the profile file and the documents. Before writing docs/QUICKSTART.md run each of its commands with `--help` and read the usage line. Revert table, each row a scratch change restored afterwards: the overlay dropped (1 red); the `<reviewer-model>` replacement dropped (1 red); one fixed model written in place of the option's value (1 red, on the second model); a list of the profile merged element by element instead of replaced (reviewer row: the template's formal command is empty, so no test tells the two apart); the name pattern dropped (3 red on `../claude-github`); the model pattern dropped (3 red); the check of a reviewer model without a profile dropped (3 red); the profile checks moved after the first write (3 red); `--ship-path` applied before the overlay (5 red); a command of the quickstart misspelt (7 red). Run `npm test` once before the first review."
---

# T1-INIT-PROFILE

## Deliverable
`aidlc init --profile claude-github --reviewer-model <id>` writes an `aidlc.config.json` that can ship a pull request: the Claude Code provider, the `github` ship path, `gateRequired: true` and a Claude formal reviewer that runs the model the caller named. The profile names no model, and init refuses to write without one. `docs/QUICKSTART.md` lists the commands from install to the first pull request.

## Why
Outside review of 2026-11-16, confirmed on main at 35de54fe and again at 2ef2bbf4: `templates/aidlc.config.json` sets `provider: mock`, `shipPath: dry-run` and an empty `formalReview.command`, and no document leads from `aidlc init` to a real pull request. Spec specs/install-portability.md R11 and R12. The constraint of the intent holds: no new provider, ship path or stage; `--profile` is an option of the existing `init` command.

Owner decision of 2026-11-17: the reviewer model is the reader's choice, named at setup with no silent default, so the profile file carries the marker `<reviewer-model>` where the model goes and init replaces it with `--reviewer-model`. `gateRequired` is set explicitly, so every block verdict of the formal review keeps a card from shipping (src/core/review-policy.ts:105), as it does in this repository (aidlc.config.json:96).

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/readme.test.ts tests/infra/init.test.ts tests/surface/init-no-package.test.ts tests/surface/init-base-ci.test.ts tests/surface/cli-cwd-paths.test.ts tests/surface/templates.test.ts tests/surface/prose.test.ts tests/core/config.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes. Arm 1 is the typecheck, arm 2 the test files.

## Acceptance detail

### 1. The overlay rules
First every string of the profile, at any depth, that equals `<reviewer-model>` is replaced by `InitOptions.reviewerModel`; a string that only contains it is not changed. Then, for each key of the profile: when the template's value and the profile's value are both objects that are not arrays, they are merged key by key by this rule; otherwise the profile's value replaces the template's, and a key the template does not have is added after its keys. A key the profile does not name keeps the template's value.

### 2. The profile file
```json
{
  "shipPath": "github",
  "provider": "claude-code",
  "gateRequired": true,
  "formalReview": {
    "command": ["claude", "-p", "--model", "<reviewer-model>", "--effort", "{effort}", "--tools", "Read,Grep,Glob", "--setting-sources=", "--strict-mcp-config", "--no-session-persistence"],
    "reviewer": "<reviewer-model>"
  }
}
```
The command is that of `formalReview.fallback` in this repository's `aidlc.config.json` (:117-131) with `<reviewer-model>` in place of its model, and the reviewer name is the model id, as there. After the overlay `formalReview` keeps the template's `secondPass`, `timeoutMs` and `effort`, and `github.requireVerdict` stays true (templates/aidlc.config.json:20), which the schema requires beside `gateRequired: true` (src/config.ts:159-160).

### 3. The reviewer model rows
| `profile` | `reviewerModel` | thrown message |
|---|---|---|
| present | absent | `--profile <name> needs --reviewer-model <id>: the profile names no reviewer model` |
| present | not matching `^[A-Za-z0-9][A-Za-z0-9._:@/-]*$` | `--reviewer-model <id> must start with a letter or digit and hold only letters, digits and the characters . _ : @ / - (got <the value as a JSON string>)` |
| absent | present | `--reviewer-model needs --profile` |

`<name>` is the profile name as given. A value that matches is written as given.

### 4. docs/QUICKSTART.md
One fenced `bash` block per step or one block for all; the commands, in this order:

```bash
npm i -D github:Asun28/AIDLC
npx --no-install aidlc init --profile claude-github --reviewer-model <model id>
npx --no-install aidlc doctor
npx --no-install aidlc goal new "<request>"
npx --no-install aidlc run --goal <goal id>
npx --no-install aidlc card next <card id> --goal <goal id>
```

The facts, each stated at its step:

1. What must be on the machine: Node 22.18 or newer, git 2.45 or newer, `gh` signed in to the repository's host, and the `claude` CLI.
2. The install is a git dependency; it builds `dist/` while installing.
3. The reviewer model is the reader's choice: `--reviewer-model` takes a model id that the `claude` CLI accepts for `--model`, init writes it into `formalReview.command` and `formalReview.reviewer`, and aidlc names no model; without the option init exits 1 and writes nothing. The profile also sets `gateRequired` to `true`, so every block verdict of the formal review keeps the card from shipping.
4. With the package installed this way the hook command is `node node_modules/aidlc/bin/aidlc-hook.js` in the committed `.claude/settings.json`, so a teammate needs `npm install` and nothing else. In a repository where aidlc is not installed as a package and `aidlc init` is run from a CLI elsewhere, the hook entries go to `.claude/settings.local.json`, which is not committed, and each teammate runs `aidlc init` once.
5. After init, edit `aidlc.config.json`: set `repository` to `<owner>/<name>` and list in `github.requiredChecks` the check names the repository's CI reports; then commit the files init wrote and push them to the base branch, because card branches start from `origin/<base>`.
6. `aidlc doctor` shows the toolchain, with the installed git version on its `git` line, the configuration and the `hookCommand` line.
7. `aidlc goal new` prints the goal id; `aidlc run` drives the goal with Claude Code until a directive needs a person or the shipping boundary is reached, and prints the pending directive.
8. `aidlc card next` at the shipping boundary runs the `github` ship path: it pushes the card branch, opens the pull request, waits for the checks and merges.

The test of acceptance 7 reads every line of a fenced block that begins `npx --no-install aidlc `. The command words are the tokens after `aidlc` up to the first token that begins with a hyphen, an angle bracket or a quotation mark. It runs `node bin/aidlc.js <words> --help` and requires that the first line of stdout begins `Usage: aidlc <words> ` and that stdout holds each token of the line that begins with two hyphens, apart from `--no-install`.

### 5. The OPERATIONS paragraph
`` `--profile claude-github` (card T1-INIT-PROFILE) lays `templates/profiles/claude-github.json` over the template configuration, so the `aidlc.config.json` init writes has the `claude-code` provider, the `github` ship path, `gateRequired: true` and a Claude formal reviewer that runs the model `--reviewer-model <id>` names. The profile names no model: init exits 1 before anything is written when `--reviewer-model` is missing, when it does not start with a letter or digit or holds a character other than a letter, a digit, `.`, `_`, `:`, `@`, `/` or `-`, when it is given without `--profile`, and when the name is not a profile. `--ship-path` still wins for its key, and an existing `aidlc.config.json` is skipped unless `--force` is set. `docs/QUICKSTART.md` lists the commands from install to a first pull request. ``

The new usage line: `node bin/aidlc.js init [dir] [--cards-dir specs/tasks] [--ship-path scaffold|github|dry-run] [--profile claude-github --reviewer-model <id>] [--force] [--dry-run] [--no-hooks]`

### 6. The entry
changelog.d/T1-INIT-PROFILE.md (new), this one line and one line feed:

"- T1-INIT-PROFILE: `aidlc init --profile claude-github --reviewer-model <id>` writes an `aidlc.config.json` with the `claude-code` provider, the `github` ship path, `gateRequired: true` and a Claude formal reviewer that runs the model `<id>`, by laying `templates/profiles/claude-github.json` over the template configuration. The profile names no model, so init exits 1 before anything is written when `--reviewer-model` is missing or is not a model id, when it is given without a profile, and when the name is not a profile. Every other file is the one init writes without the option, and `--ship-path` wins for its key. `docs/QUICKSTART.md` lists the commands from `npm i -D github:Asun28/AIDLC` to a first pull request, with what to set in `aidlc.config.json` and what a teammate runs."
