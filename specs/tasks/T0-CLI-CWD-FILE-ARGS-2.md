---
id: T0-CLI-CWD-FILE-ARGS-2
title: (replaces T0-CLI-CWD-FILE-ARGS) With -C, every file argument the CLI opens resolves against the -C directory when relative and is used as given when fully qualified, and an empty, drive-relative or incomplete UNC value, or a -C that names no directory, is refused before the command reads or writes anything
status: todo
branch: T0-CLI-CWD-FILE-ARGS-2
worktree: D:\wt\AIDLC\T0-CLI-CWD-FILE-ARGS-2
size_exception: "approved by the coordinator as planner and approver of the 18 audit changes under the owner's (asun28) instruction of 2026-11-11: about 70 source lines, all in src/cli/main.ts (the path function about 35, the -C validation about 15, twelve call sites about 20); the rest is about 240 lines of tests in one new file, about 6 lines of docs and about 25 lines of attempt evidence; raised from 340 to 400 by the coordinator on the candidate 2bbd708c, which is 375 changed lines: 63 source lines in src/cli/main.ts, 293 lines of the acceptance tests for the path table of R3 and the twelve resolved values, the rest docs and attempt evidence; raised from 400 to 570 by the coordinator on the repair candidate 6a3e5d15 of R3 decision 1, which adds 154 lines: 17 source lines, 90 lines of tests for a -C under a regular file and under an unreadable parent, and the revert tables the review asked for in the attempt evidence; raised from 570 to 800 by the coordinator for attempt 4: the candidate of attempt 3 is 724 changed lines (88 in src/cli/main.ts, 468 of tests, 164 of attempt evidence), and attempt 4 removes the canonical base and the process-directory change and adds three tests; raised from 800 to 940 by the coordinator on the attempt 4 candidate 49fac7ce, which is 884 changed lines: 87 in src/cli/main.ts, 551 of tests, 242 of attempt evidence (a revert table of 32 rows), 4 of docs; raised from 940 to 1100 by the coordinator on the candidate 6a36b57e, which is 994 changed lines (87 in src/cli/main.ts, 627 of tests, 276 of attempt evidence), plus the two tests the second consult asked for; raised from 1100 to 1280 by the coordinator on the candidate 516d8739, which is 1206 changed lines: 89 in src/cli/main.ts, unchanged since attempt 6, 721 of tests and 392 of attempt evidence after three consult rounds, 4 of docs; raised from 1280 to 1400 by the coordinator on 2026-11-12 for the replacement card: the carried candidate 04fccad1 is 1216 changed lines (402 of them attempt evidence, which moves into this card with a History line), and the restated guard of acceptance 13 with its table, the notes of where each moved figure was measured and the coordinator's verification block add about 150; raised from 1400 to 1480 by the coordinator on 2026-11-12: the candidate 0255142b is 1391 changed lines, and the planner's rulings on the disclosed points and the coordinator's verification blocks add about 40; raised from 1480 to 1540 by the coordinator on 2026-11-12: the rulings after the pre-review of f9b50cf1 add rows to the table of acceptance 13, a row for childEnv and their evidence, about 50; raised from 1540 to 1620 by the coordinator on 2026-11-12: the rulings after the second pre-review add rows for process.once and for the child environment with their evidence, about 60, and the coordinator's verification block"
allow_paths:
  - src/cli/main.ts
  - tests/surface/cli-cwd-paths.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-CLI-CWD-FILE-ARGS-2.md
dod_command: npm run typecheck && node --test tests/surface/cli-cwd-paths.test.ts tests/surface/incident.test.ts tests/core/ci-policy.test.ts tests/surface/command-lines.test.ts tests/surface/approver.test.ts tests/surface/review-bench.test.ts tests/infra/init.test.ts tests/surface/init-base-ci.test.ts tests/surface/init-no-package.test.ts
dod_exit: 0
requirements:
  - R1. The CLI shall keep two values apart. The explicit `-C` value, when given, is validated by R2 and resolved by R3 with the process directory as base. The effective base of a command is that resolved directory when `-C` is given and the process directory otherwise; `hook <name>` without `-C` keeps `event.cwd`, else the process directory, as on main at 92796d4f (src/cli/main.ts:1380). The resolved `-C` directory is stored once, as R3 returns it (`path.resolve`: lexical, never a realpath), and every reader of the CLI's working directory in src/cli/main.ts (the command context, the base of R4, `init`, `review bench run`, `hook <name>`) takes that stored value; the `-C` text as typed is read only to check it and to print it. `-C` changes neither the process directory (no `process.chdir`) nor the environment (no write to `process.env`): what reads the process directory itself does so as on main. (Attempt 3 made the stored directory canonical and changed the process directory to it; both consults of 2026-11-11 showed that this changes the base of all twelve values against this requirement, the options of R8 on Windows, and relative paths read from the configuration, so the planner ruled both out.)
  - R2. An explicit `-C` value shall be validated for every action before the command reads or writes anything (loading the CLI's modules is not a read in this sense), and refused when R3 refuses it or when the resolved path names no existing directory (nothing there, or a file). A refusal exits 1, except under `hook <name>`, where it exits 2, because a hook process that exits 1 lets the tool call through with every guard off (docs/OPERATIONS.md:267) and a hook refusal exits 2 (an unknown hook name exits 2, :246). `bin/aidlc-hook.js` takes no `-C` and is not changed.
  - R3. One exported function of src/cli/main.ts shall classify a path value by its leading characters (never by `isAbsolute` alone, which is true for `\x` and `\\x` under win32), given the value, the option name, the base and the path flavour (`path.win32` or `path.posix`, by default the platform's). Under `path.win32`: a value that is empty or only characters of the JavaScript `\s` class is refused; a drive letter, in either case, followed by `:` and no separator (`C:`, `c:`, `C:x`, `c:x`, `C:x\y`, `C:x/y`) is refused, because it names the current directory of that drive; a value starting with two separators that is not a device path and has no server and share (`\\x`, `//x`, `\\server`, `\\server\`, `//server/`) is refused, because Node resolves it against the base drive while Windows reads it as a network server; a drive with a separator (`C:\x`, `c:/x`), a complete UNC path (`\\server\share`, `\\server\share\x`, `//server/share/x`) and a device or verbatim path (`\\?\C:\x`, `\\?\UNC\server\share\x`, `\\.\C:\x`) are used as given (`path.win32.resolve` of the value alone, which normalizes separators and never reads the base); a value with one leading separator (`\x`, `/x`) is resolved against the root of the base's drive (`path.win32.resolve('D:\\base', '\\x')` is `D:\x`); every other value (`x`, `.\x`, `./x`, `..\x`, `~\x`, with no tilde expansion) is resolved against the base. Under `path.posix`: empty or whitespace-only is refused; a value starting with `/` is used as given (normalized, so `//x` is `/x`); every other value is resolved against the base, including `C:\x`, `C:/x`, `C:x`, `\x`, `\\server\share\x` and `\\?\C:\x`, which are file names there.
  - R4. The CLI shall resolve these twelve path values (lines of main at 92796d4f) through the function of R3 against the effective base: `init [dir]` (:227), `cards project --plan` (:788, and the `plan_ref` it drafts at :792), `intent validate <file>` (:830), `spec validate <file>` (:840), `plan check <file>` (:851), `review bench compare <before.json> <after.json>` (:1031, both), `ci classify --log` (:1062), `migrate assess --diff` (:1198), `evidence retain --file` (:1320), `monitor check --bands` (:1345) and `monitor check --data` (:1346). Every supplied value of a command shall be validated before `ctx()` is built and before any of its inputs is opened, including the commands that build no `ctx()` (`review bench compare`, :1028-1035; `review bench run` resolves its root from the effective base, :1020) and the commands with two inputs (`monitor check`, `bench compare`), so an invalid second value is refused before the first is read.
  - R5. An absent optional value shall keep main's behaviour: an absent `init [dir]` selects the effective base; an absent `--diff` scans no diff; an absent `--file` retains `--content`. An explicitly empty value is refused by R3.
  - R6. A refusal of R2 or R3 shall print `aidlc:` and a message that names the option (`--plan`, `<file>`, `<after.json>`, `--cwd`, and so on), quotes the value, says why and what to pass, and shall write nothing: no card file drafted, no artifact retained, no manifest or journal write, no intent filed, no init file written. A value R3 accepts that names no file is passed on resolved, and the command fails with its error of main naming the resolved path (for example `evidence source missing: <path>`), exit 1. The last sentence is the case with `-C`; without `-C` the value is passed on as given (R9) and the command fails with the error main gives for it.
  - R7. `cards project` shall draft `plan_ref` as the path of the resolved plan, made canonical with `canonical()` of src/state/paths.ts:161 (realpath, as `c.root` is, :60-63), relative to the main checkout, so a plan given relative to `-C` yields the same `plan_ref` as the same plan given from inside the checkout, also when the `-C` value differs from the canonical path in letter case or by an 8.3 short name. This is the only canonical path of the card: the plan file is opened at its resolved path, and the base of every value stays the stored directory of R1. So a plan given through a directory link (`--plan <link>/plans/p.md`, the link naming the repository) drafts the same `plan_ref` as `plans/p.md` from inside the checkout. Ruling of 2026-11-11 after the second consult, which showed that the candidate changed `plan_ref` without `-C` (a process directory that is no git repository and is reached by a short name or a link, where `c.root` is lexical, src/state/paths.ts:57-59, and the plan canonical): without `-C`, `plan_ref` is drafted by the expression of main on the value as typed, unchanged (R9), so a plan typed in another letter case or through a link keeps the `plan_ref` main drafts; with `-C`, it is the path of `canonical(<resolved plan>)` relative to `canonical(c.root)`, both sides canonical, so, for a plan whose own path passes through no link, `-C` by a link, a short name or another letter case drafts the same `plan_ref` as the command run inside the directory, also where the directory is no git repository. The two rules differ for a plan reached through a link: under `-C` a plan file that is itself a link (`plans/link.md` naming `plans/real.md`) drafts `plans/real.md#7`, its target, and without `-C` it drafts `plans/link.md#7`, as main does.
  - R8. These path options shall keep the base they have on main, and the refusals of R3 shall not apply to them: `init --cards-dir` (a path relative to the target that places the card template and is written into the new aidlc.config.json, src/scaffold/init.ts:149, :157); `goal new --intent` and `report --plan-ref` (references stored for the controller, relative to the main checkout); `goal new --surface` and `migrate assess --paths` (labels, never opened); `review repro --files` (repository-relative paths taken from the candidate); `review bench run --dir`, `review bench export --dir` and `evals run --dir` (resolved against the checkout or worktree root of the effective base, as their help says); `hook <name>` (R1). `AIDLC_STATE_DIR` keeps its meaning of main. The CLI neither reads nor rewrites `AIDLC_STATE_DIR` for `-C`: a relative value is resolved against the process directory, with or without `-C`, as on main.
  - R9. Without `-C`, every value R3 does not refuse shall resolve as on main, so the tests that pass relative values from the process directory pass unchanged. Without `-C` the function of R3 is used only to refuse: a value it does not refuse is handed to the command as given, unresolved, so the file system reads it against the process directory exactly as on main (on POSIX `missing/../spec.md` fails where `missing` does not exist, as on main; the error is the one main gives, which names the value as typed where the command prints it, as `review bench compare` does, and what the system error names where the command prints that, as Node's ENOENT does: the full path on Windows, the typed value on POSIX). With `-C` a value is resolved by R3, which is lexical: `a/../b` names `b` under the base whether or not `a` exists.
  - R10. `docs/OPERATIONS.md` (Setup) and the CHANGELOG Unreleased section shall state R1 to R5 and R8.
acceptance:
  - 1. `tests/surface/cli-cwd-paths.test.ts` "the path function by input class": under `path.win32` and `path.posix` every value of R3 gives its result or its refusal, on any host. [R3] [dod arm 1] Detail: body section Acceptance detail, item 1.
  - 2. Same file, "each file argument resolves against -C": with `-C` naming a target, a relative value reads the target's file for each of the twelve values of R4, and a fully qualified value is read as given. Fails on main. [R1] [R4] [dod arm 1] Detail: body section Acceptance detail, item 2.
  - 3. Same file, "supplied values are refused before any read or write": an empty or blank value for each of the twelve is refused naming its option and nothing is written; the drive-relative and incomplete UNC rows on a Windows host. Fails on main. [R3] [R4] [R6] [dod arm 1] Detail: body section Acceptance detail, item 3.
  - 4. Same file, "an invalid -C is refused for every command": exit 1 naming `--cwd`, exit 2 under `hook auto`, nothing written. Fails on main. [R2] [R6] [dod arm 1] Detail: body section Acceptance detail, item 4.
  - 5. Same file, "absent optional values": with `-C` they behave as on main. [R5] [dod arm 1] Detail: body section Acceptance detail, item 5.
  - 6. Same file, "plan_ref is the same with and without -C". [R7] [dod arm 1] Detail: body section Acceptance detail, item 6.
  - 7. The eight existing test files the detail names pass unchanged. [R8] [R9] [dod arm 1] Detail: body section Acceptance detail, item 7.
  - 8. `docs/OPERATIONS.md` and the CHANGELOG state R1 to R5 and R8 (reviewer-verified against the diff). [R10]
  - 9. Same file, "plan_ref is canonical when the plan is given through a link". [R7] [dod arm 1] Detail: body section Acceptance detail, item 9.
  - 10. Same file, "without -C a value is passed as given": main's error without `-C`, an error naming the resolved path with it. [R6] [R9] [dod arm 1] Detail: body section Acceptance detail, item 10.
  - 11. Same file, "-C leaves the process directory and the environment as they are". [R1] [R8] [dod arm 1] Detail: body section Acceptance detail, item 11.
  - 12. Same file, "plan_ref without -C is the one main drafts, and with -C both sides are canonical", with the row of a plan file that is itself a link. [R7] [R9] [dod arm 1] Detail: body section Acceptance detail, item 12.
  - 13. Same file, "the CLI changes neither the process directory nor the environment": on the parsed source of src/cli/main.ts no `chdir`, `process` only as the object of a property access to one of the ten names of the detail, `process.env` only in its three shapes, and none of the names and expressions of rule (d); a table of passing and failing source texts; a behaviour row on the default session token. [R1] [R8] [dod arm 1] Detail: body sections Acceptance detail, item 13, and Acceptance 13: the table.
depends_on: []
budget: 1620
tdd: true
diagnosis:
  root_cause: "`-C` only feeds `ctx()` and a few direct reads of `g().cwd` (src/cli/main.ts:73, :227, :1020, :1380 at 92796d4f); every file argument is passed to `readFileSync` or to a library call as given, and Node resolves a relative path against the process directory. `-C` itself is never validated, so an empty `-C` runs in the process directory. Under win32, `path.resolve` of a base and a drive-relative value `C:foo` gives the current directory of drive C joined with `foo`, and an incomplete UNC root (two separators and a name, no share) resolves against the base drive, so neither depends on the base as the caller means."
  repro: "2026-11-11, scratch directories only: from a caller directory, `node src/cli/main.ts -C` with the target directory, then `spec validate spec.md --json`, exited 1 with ENOENT naming spec.md in the caller directory while the file existed in the target; the same command run inside the target read it. The state directory was a scratch directory (AIDLC_STATE_DIR) and stayed empty. The win32 classes of R3 were checked with `path.win32.resolve` and `path.win32.parse` the same day."
  same_class: "Every option and positional of src/cli/main.ts whose value is a path, from the `git grep` in `sweep`: the twelve values of R4 change; the options of R8 keep their base; no other option or argument names a file or directory. Library functions that receive a path from the CLI (`compareBenchReports`, `EvidenceStore.retain` sourcePath, `initProject` target, the plan text given to `parsePlanCards`) receive the resolved path and need no change."
sweep: "git grep -n \"readFileSync(o\\.\\|readFileSync(file\\|sourcePath: o\\.\\|compareBenchReports(\\|target: dir\\|<file>\\|<path>\\|<dir>\\|<paths>\\|g().cwd\" -- src/cli/main.ts on main at 92796d4f. Path options and positionals and their disposition: -C/--cwd :212 (R1, R2); init [dir] :217/:227 (R4, R5); init --cards-dir :220 (R8); goal new --surface :290 and --intent :291 (R8); report --plan-ref :441 (R8); cards project --plan :783/:788/:792 (R4, R7); intent validate :827/:830 (R4); spec validate :837/:840 (R4); plan check :846/:851 (R4; the plan's own paths at :851 stay resolved against the main checkout); review repro --files :959 (R8); review bench run --dir :1009 (R8; its root at :1020 comes from the effective base) and export --dir :1043 (R8); review bench compare :1026/:1031 (R4); ci classify --log :1059/:1062 (R4); migrate assess --paths :1194 (R8) and --diff :1195/:1198 (R4, R5); evals run --dir :1226 (R8); evidence retain --file :1308/:1320 (R4, R5); monitor check --bands :1340/:1345 and --data :1341/:1346 (R4); hook <name> :1376/:1380 (R1, R2). The audit named :788, :830, :840, :851, :1062 and :1341; the sweep adds init [dir], bench compare, migrate assess --diff, evidence retain --file and monitor check --bands. Tests that pin current resolution, all to pass unchanged: tests/surface/incident.test.ts:101 (relative --bands and --data from the process directory, no -C); tests/core/ci-policy.test.ts:245, :262, :282, :613 (ci classify --log, no -C); tests/surface/review-bench.test.ts:789, :832, :858, :915 (bench compare with fully qualified paths); tests/infra/init.test.ts:211, tests/surface/init-base-ci.test.ts:309 and tests/surface/init-no-package.test.ts:114 (init with a fully qualified target); tests/surface/approver.test.ts:98 (-C with a fully qualified existing directory); tests/surface/command-lines.test.ts (usage lines, which this card does not change). No docs file mentions -C."
forbid: [weakening or skipping a test to go green, a `process.chdir` or a write to `process.env` in the CLI, a realpath of the `-C` directory or of the base of a file argument (only the `plan_ref` of R7 is canonical), resolving or rewriting a value when `-C` is absent, changing an option name, its help text or a usage line, changing the base of an option R8 lists, expanding a tilde or an environment variable in a path, changing bin/aidlc-hook.js, editing .aidlc state by hand]
non_goals: [the default session token (`session-default`), which src/state/journal.ts reads from the state directory of the process directory, with or without `-C`, on main as here (set `AIDLC_SESSION`; honouring `-C` there changes which session owns a lease and is a card of its own), a child process a library starts without a `cwd` (it runs in the process directory, as on main), a process directory that no longer exists when the CLI starts (POSIX), the options of R8, which keep their documented base, a path inside a file the command reads (plan references, card paths, ops bindings), a directory given where a file is expected (the read fails with the system error, as on main), a path through a symbolic link or junction (resolved by the file system, as on main), the meaning of AIDLC_STATE_DIR, code that hides the name of the process object from the source text of src/cli/main.ts (a name built at run time, the constructor of a function reached through a property, code in another module that main.ts calls): the guard of acceptance 13 reads main.ts as written, and such code can only be written to get around it]
hygiene: "This card replaces T0-CLI-CWD-FILE-ARGS by the owner's ruling of 2026-11-12 (asun28, "C17: 1": a replacement card with the same diff plus the fix of the last finding). The predecessor stopped with STOP review after its fourth formal decision (2026-11-11T12:33Z): decision 1 blocked (findings F3 to F6), decision 2 passed, decision 3 blocked (F7), decision 4 blocked on one finding, F8, class environment-write-guard-gap: the regular expression of acceptance 13 missed white space before the parenthesis of `Object.assign (process.env` and `Object.defineProperty (process.env`. The loop keeps that stop for human adjudication with no counter reset; the owner adjudicated. The branch T0-CLI-CWD-FILE-ARGS-2 starts from main, and the diff of the predecessor's candidate 04fccad1 against main (`git diff origin/main...04fccad1`, merge base 90dd71bb; a trial merge with main at 01854de2 has no conflict) is applied to it as the candidate, with these changes only. (1) Every place of the diff that names T0-CLI-CWD-FILE-ARGS as the card of the change names T0-CLI-CWD-FILE-ARGS-2 (the CHANGELOG entry begins `- T0-CLI-CWD-FILE-ARGS-2 (bugfix, replaces T0-CLI-CWD-FILE-ARGS, audit item C17)`; a comment or test title that names the card; list the places in the evidence). (2) Acceptance 13 is restated, and the test of that name is rewritten to it: the four regular expressions go, and an allowlist of three shapes of `process.env` on the parsed source takes their place, with the table of body section Acceptance 13. F8 is a case of it and so is every other way of writing to the environment. No file under src/ changes for this. (3) The hunk of specs/tasks/T0-CLI-CWD-FILE-ARGS.md, its Attempt evidence, is not applied to that file: the evidence moves into a section `## Attempt evidence` of this file under a History line that names the predecessor and its four formal decisions, with a note at each figure of where it was measured (the commit of the branch T0-CLI-CWD-FILE-ARGS and the run), followed by the RED and DoD of this card on its own branch. The old card file stays as it is on main. Since the predecessor's candidate was cut, eight commits of main changed src/cli/main.ts (T0-OPS-CWD, T0-DOCTOR-INTERRUPTED-WRITES, T0-CLAUDE-EFFORT-OPT-IN, T0-REGISTRY-PER-CALL, T0-DOD-RECEIPT-REQUIRED, T0-AUDIT-BINDING among them); the planner compared the options and file reads they added (`--dod-receipt <text>`, `--final-digest <digest>`, no path option, no new file read) with R4 and R8: the twelve path values of R4 are still all of them. At PREPARE run the sweep of the `sweep` field again on the branch and stop and report if it finds a path value that R4 and R8 do not name. RED: commit tests/surface/cli-cwd-paths.test.ts alone first, on the sources of main, run it and record that commit as the RED receipt (it fails on main as the predecessor's RED commits did); then commit the rest. The coordinator runs a Codex pre-review of the candidate until one finds nothing to block, and its own Linux and document-reader runs, before the first formal decision. What follows is the predecessor's hygiene, which still holds. Line numbers are from main at 92796d4f; read them again at PREPARE. Card T0-MANIFEST-LOCK also changes src/cli/main.ts (the `audit seal` action); if it merges first, base-sync before SHIP. RED: acceptance 2, 3, 4 and 6 fail on main. Before the first R3, revert each source hunk in a scratch copy and run acceptance 1 to 6, and keep every input class of R3 enumerated in acceptance 1 (lesson 2026-11-11 T0-AUDIT-FIXES). Canonicalize the fixture's temporary directories with realpathSync.native before they become a cwd or a -C value, except in the letter-case case of acceptance 6 (lessons 2026-11-08 T0-WORKTREE-RECLAIM-2 and 2026-11-09 T1-BOARD-WATCH-2), set AIDLC_STATE_DIR to a fixture directory for every CLI call (except the calls whose subject is the state directory itself: the tests of acceptance 11 that read which state directory `-C` selects or pass a relative AIDLC_STATE_DIR, and the session-token row of acceptance 13, which must leave it unset; their fixtures are temporary directories of their own), and create the directories through a helper an after hook removes (lesson 2026-11-10 T0-EVAL-TEST-TEMP). Insert the CHANGELOG entry directly above the entry that begins `- T0-CARD-LEASE-HEARTBEAT-2 (bugfix`, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict."
doc_sync: docs/OPERATIONS.md (Setup), CHANGELOG.md
---

# T0-CLI-CWD-FILE-ARGS-2

## Deliverable
`aidlc -C <dir> <command> <relative file>` opens the file under `<dir>`, as the command would when started in `<dir>`. A fully qualified path is opened as given, and on Windows `\x` means the root of the `-C` directory's drive. An empty value, a drive-relative value (`C:x`), an incomplete network root (`\\x`), and a `-C` that names no directory are refused before the command reads or writes anything.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/cli-cwd-paths.test.ts tests/surface/incident.test.ts tests/core/ci-policy.test.ts tests/surface/command-lines.test.ts tests/surface/approver.test.ts tests/surface/review-bench.test.ts tests/infra/init.test.ts tests/surface/init-base-ci.test.ts tests/surface/init-no-package.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes and the tests that pin resolution without -C pass unchanged.

## Acceptance detail

The full text of each acceptance item; the front-matter list holds its short form, so that the list fits the run-card context pack. Items 1 to 12 are the predecessor's, word for word; item 13 is restated (hygiene).

### 1
`tests/surface/cli-cwd-paths.test.ts` "the path function by input class": with `path.win32` and with `path.posix` and a fixed base, every value listed in R3 gives the stated result or refusal, on any host; `isAbsolute` is true for at least `\x` and `\\x` under win32, which the function still treats as R3 says. [R3] [dod arm 1]

### 2
Same file "each file argument resolves against -C": the CLI from the sources, run from a caller directory with `-C` naming a target directory, with a relative value naming a file that exists under the target only, reads the target's file for each of the twelve values of R4 (`init sub --dry-run` reports the target's `sub`; `cards project --plan` drafts the plan's rows; `intent`, `spec` and `plan` validation report the target file's own problems; `bench compare` names the target file in its rule refusal; `ci classify`, `migrate assess --diff` and `monitor check` report from the target's contents; `evidence retain --file` retains the target's bytes into a goal of the fixture state directory). A fully qualified value naming a file in a third directory is read as given. Fails on main for each (ENOENT naming the caller directory, reproduced with `spec validate` on 2026-11-11). [R1] [R4] [dod arm 1]

### 3
Same file "supplied values are refused before any read or write": an empty and a whitespace-only value for each of the twelve; `monitor check` with a valid `--bands` naming a missing file and `--data ""`, and `bench compare` with a valid first and an empty second value, each refused naming the second option (not ENOENT of the first); `evidence retain --file ""` leaves the state directory byte-identical, `cards project --plan "" --write` drafts no card, `init "" ` writes no file. On a Windows host `--plan C:plan.md` and `--plan \\x` are refused and `--plan \plan.md` reads the plan at the root of the target's drive (skipped elsewhere; acceptance 1 covers the rule on every host). Fails on main (main names no option, and `-C`-relative reads fail). [R3] [R4] [R6] [dod arm 1]

### 4
Same file "an invalid -C is refused for every command": `-C ""`, `-C "  "`, `-C` naming nothing, `-C` naming a file, and on a Windows host `-C C:wt` and `-C \\x`, each exit 1 with `--cwd` named for `spec validate`, `review bench compare` and `review bench run` (two commands that build no `ctx()`), and exit 2 for `hook auto` with an event on stdin, writing nothing in each case. Fails on main (main runs `-C ""` in the process directory and `hook auto` exits 0). [R2] [R6] [dod arm 1]

### 5
Same file "absent optional values": with `-C` naming the target, `init --dry-run` without a directory targets the target; `migrate assess --paths x` without `--diff` and `evidence retain --content kept` without `--file` behave as on main. [R5] [dod arm 1]

### 6
Same file "plan_ref is the same with and without -C": `cards project --plan plans/p.md` with `-C` naming the repository, from inside it, and on a Windows host with `-C` in another drive-letter case, draft the same `plan_ref`. [R7] [dod arm 1]

### 7
`tests/surface/incident.test.ts` (relative `--bands` and `--data` from the process directory), `tests/core/ci-policy.test.ts` (`ci classify --log`), `tests/surface/command-lines.test.ts` (usage lines), `tests/surface/approver.test.ts` (`-C` with `authorize`), `tests/surface/review-bench.test.ts` (`bench compare` with fully qualified paths, `bench run --dir`), `tests/infra/init.test.ts`, `tests/surface/init-base-ci.test.ts` and `tests/surface/init-no-package.test.ts` (init with a fully qualified target) pass unchanged. [R8] [R9] [dod arm 1]

### 8
`docs/OPERATIONS.md` and the CHANGELOG state R1 to R5 and R8 (reviewer-verified against the diff). [R10]

### 9
Same file, "plan_ref is canonical when the plan is given through a link": with `-C <repository>` and `--plan <link>/plans/p.md`, where `<link>` is a directory link (a junction on Windows, a symbolic link on POSIX) to the repository, `cards project` drafts `plan_ref: plans/p.md#7`. Fails when `canonical(planFile)` is replaced by `planFile`. [R7] [dod arm 1]

### 10
Same file, "without -C a value is passed as given": from a process directory holding `spec.md` and no `missing`, on a POSIX host `spec validate missing/../spec.md` fails with the error of main naming `missing/../spec.md`, and `-C <that directory> spec validate missing/../spec.md` from another directory reads the file; on every host a relative value that names no file fails without `-C` with the error main gives (`review bench compare nofile.json other.json` prints the value as typed; `spec validate nofile.md` prints Node's ENOENT, which names the full path on Windows and the typed value on POSIX) and with `-C` with an error naming the resolved path. (The first text said main's error names the value as typed on every host; the implementer ran main and the planner corrected the row on 2026-11-11.) Record in the card evidence the output main gives for the two no-`-C` rows. [R6] [R9] [dod arm 1]

### 11
Same file, "-C leaves the process directory and the environment as they are": with `-C <target>` from a caller directory, a relative `AIDLC_STATE_DIR` selects `<caller>/<value>` (the test of attempt 3, now with no rewrite behind it); a relative `-C` (`missing/../src` on POSIX from the checkout, `src` on every host) selects the checkout's repository and state directory for `doctor`, `goal new` and `hook auto` (the regression of R3 decision 3, kept); and a `-C` directory can be removed by the test's `after` hook on Windows while nothing holds it. Every CLI call of the tests that select a state directory sets `AIDLC_SESSION`, since the default session token is read from the process directory on main (a non-goal). [R1] [R8] [dod arm 1]

### 12
Same file, "plan_ref without -C is the one main drafts, and with -C both sides are canonical": without `-C`, from inside a repository, `--plan <link>/plans/p.md` (a directory link to the repository) drafts the `plan_ref` main drafts for it (run main once and record its output in the evidence; red when the no-`-C` branch is made canonical); with `-C <link>` naming a directory that is no git repository through a directory link, `--plan plans/p.md` drafts `plan_ref: plans/p.md#7` (red when the left side is `c.root` and not `canonical(c.root)`). [R7] [R9] [dod arm 1] Also: a plan file that is itself a symbolic link (`plans/link.md` to `plans/real.md`; on a host where the test cannot create a file link, the row is skipped with that reason, and the coordinator's Linux run executes it) drafts `plan_ref: plans/real.md#7` with `-C` and `plan_ref: plans/link.md#7` without; red with `-C` when only the directory of the plan is made canonical.

### 13
Same file, "the CLI changes neither the process directory nor the environment": src/cli/main.ts, parsed with the TypeScript compiler API (public API only, no type checker, a walk that keeps its own stack), holds (a) no identifier `chdir` and no string literal that is exactly `chdir`; (b) no identifier `process` that is not the object of a property access whose name is one of the ten main.ts uses (`argv`, `cwd`, `env`, `exit`, `exitCode`, `once`, `platform`, `stderr`, `stdout`, `version`) and no string literal that is exactly `process` or `node:process`, so the object is not reached through an index, an alias, a destructuring, an import or a method that returns it (`process.valueOf()`); and `process.once`, which returns the process object, only as the callee of a call that is a whole expression statement, its result discarded; (d) no `this` expression and no identifier `eval`, `Function`, `globalThis`, `global` or `Reflect`, none of which main.ts uses (a `function` listener of `process.once` is called with the process object as `this`); and (c) for every `process.env` one of three shapes and nothing else: the operand of a spread in an object literal (`...process.env`); the object of a property access, or of an element access whose key is a string literal, that names a variable (the name is one upper-case letter followed by upper-case letters, digits and underscores, as `AIDLC_SESSION`) and is itself a direct operand of a binary expression whose operator is `||`, `&&`, `??`, `===` or `!==`; an argument of a call whose callee is the identifier `renewSessionCardLeases`. Every other use of `process.env` fails, a read in another position included: the three shapes are those main.ts has, and the list grows only with a reviewed change of this test. The rule names no way of writing; an assignment of any kind, a `delete`, an update, a call such as `Object.assign`, `Object.defineProperty` or `Reflect.set` fails because it is none of the three shapes. A table of source texts beside it (body section Acceptance 13: the table) holds each shape passing and each forbidden text failing. A behaviour row beside it detects a changed process directory whatever the environment: with `-C <repository>` from a caller directory, `AIDLC_STATE_DIR` and `AIDLC_SESSION` unset, the default session token is created under the state directory of the caller directory (the non-goal as main has it, and the sentence of the docs) and not under the repository's; red when the process directory follows `-C`, also when the `AIDLC_STATE_DIR` rewrite of attempt 3 comes back with it. [R1] [R8] [dod arm 1]

## Replacement note of 2026-11-12

T0-CLI-CWD-FILE-ARGS-2 carries the candidate of T0-CLI-CWD-FILE-ARGS (04fccad1), whose card stopped after its fourth formal decision on one remaining finding. The owner ruled for a replacement card with the same diff and that finding fixed. The front-matter field `hygiene` states exactly what differs from the predecessor's diff: the renamed places, the restated guard of acceptance 13 and the moved evidence.

## Acceptance 13: the table

Why the guard is restated. The predecessor checked the text of src/cli/main.ts with four regular expressions, one per way of writing to the environment it knew, and its fourth formal block was a way they missed. A list of forbidden forms is never complete. main.ts uses `process.env` in five lines and three shapes (a spread into a child environment, a read by a literal name compared or defaulted, one pass to `renewSessionCardLeases`), so the test allows those shapes on the parsed source and fails on everything else. The same reasoning closed the scan of T0-TEST-TEMP-SWEEP.

The check is a function of a source text (so the table can call it) applied to src/cli/main.ts. Passing texts, one per shape and the combinations main.ts has: `const e = { ...process.env, A: 1 }`; `const s = a || process.env['A'] || process.env['B']`; `const n = process.env['A'] !== '1'`; `if (p === 'x' && process.env.A === '1') {}`; `const d = process.env.A ?? 'd'`; `renewSessionCardLeases(event, cwd, process.env)`; and uses of `process` that are not `env` or `chdir` (`process.exitCode = 1`, `process.argv.slice(2)`, `process.cwd()`).

Failing texts, each with the rule it breaks: `process.chdir(at)` and `process['chdir'](at)` (a, and the second also b); `process.env.X = v`, the same with a line break before `=`, `process.env['X'] ??= v`, `process.env['X'] ||= v`, `process.env.X += v`, `delete process.env.X`, `process.env.X++`, `[process.env.X] = a`, `({ a: process.env.X } = o)`, `for (process.env.X of a) {}` (c: the access is not an operand of one of the five operators); `Object.assign(process.env, x)`, the same with a line break and with spaces before the parenthesis (the finding F8), `Object.defineProperty(process.env, 'X', d)`, `Reflect.set(process.env, 'X', v)`, `fn(process.env)`, `const e = process.env`, `return process.env`, `process.env` as an expression statement (c: none of the three shapes); `process['env'].X = v`, `const { env } = process`, `const p = process`, `globalThis.process.env.X = v`, `fn(process)`, `import p from 'node:process'`, `require('process')` (b). A comment and a longer string that hold these words pass (`// process.env.X = v`, `'run process.chdir here'`).

Reverts that must each fail a row: rule (a) removed; the string form of (a) removed; rule (b) removed; the string form of (b) removed; each of the three shapes of (c) removed in turn (main.ts then fails); the operator list widened by an assignment operator; the callee of the third shape not compared; a comment read as code.

## Planner rulings of 2026-11-12 after the pre-review of f9b50cf1

A Codex pre-review of f9b50cf1 found the carry exact (later changes of main preserved, all twelve values resolved before the context is built and before any read), the path function right for every class of R3, the 42 texts of the guard's table as stated, no false refusal in the three shapes and the documents true. One block and one risk, both accepted:

| Point | Ruling |
|---|---|
| The helper `childEnv` of the test file passes the caller's `NODE_OPTIONS` to the children; with a `--require` of a relative path there, a child started in another directory fails with `MODULE_NOT_FOUND` | The ruling of the section on the disclosed deviations that kept `childEnv` as carried is withdrawn for this variable: `childEnv` drops every variable whose upper-cased name is `NODE_OPTIONS`, as it drops `GIT_*` and `AIDLC_*`. It takes the source environment as a second parameter (default `process.env`) so that a row can check it: `childEnv({}, { NODE_OPTIONS: 'a', node_options: 'b', GIT_DIR: 'c', AIDLC_SESSION: 'd', CLAUDE_CODE_SESSION_ID: 'e', PATH: 'p' })` deep-equals `{ PATH: 'p', GIT_CEILING_DIRECTORIES: <the ceiling> }`. It still sets no state directory: the tests that need `AIDLC_STATE_DIR` unset depend on that |
| `const p = process.valueOf() as NodeJS.Process; p.env['X'] = 'v'` passes the guard: rule (b) allowed any property of `process`, and some return the object | Rule (b) names the ten properties main.ts uses; any other property of `process` fails. Rule (d) is new: no `this` expression (a `function` listener of `process.once` receives the object as `this`) and no identifier `eval`, `Function`, `globalThis`, `global` or `Reflect`. What remains is code written to hide the name, a non-goal added today |

Rows added to the table of acceptance 13. Failing: `const p = process.valueOf()` and `process.valueOf().env.X = v` (b); `process.mainModule`, `process.binding('fs')`, `process.emit('x')` (b: a property outside the ten); `process.once('exit', function () { this.env.X = v; })` (d: `this`); `eval('process.env.X = 1')`, `new Function('return process')()`, `globalThis.process`, `global.process`, `Reflect.get(o, k)` (d). Passing: each of the ten properties in the form main.ts uses it (`process.once('SIGINT', () => stop.abort())`, `process.version`, `process.platform`, `process.stderr.write(s)`, `process.stdout.write(s)`, `process.exit(1)`, `process.exitCode = 1`, `process.cwd()`, `process.argv.slice(2)`).

Reverts that must each fail a row: the list of ten widened to any property; `valueOf` added to the list; the `this` rule removed; each of the five identifiers of (d) removed from its list (one run or five); `NODE_OPTIONS` kept by `childEnv`; the comparison of the variable name case-sensitive.

## Planner rulings of 2026-11-12 after the second pre-review

The second Codex pre-review found all 17 passing and 42 failing rows of the table right, the environment filter working in any letter case, every child started through the helper, the walk iterative on public API, and the evidence telling repair runs from carried results. Two blocks and one risk, all accepted:

| Point | Ruling |
|---|---|
| `process.once('beforeExit', () => {}).env.X = 'v'` passes the guard: `once` is one of the ten names and returns the process object | Of the ten names, `once` is the only one whose value is the object (`cwd()`, `argv`, `platform`, `version` and `exitCode` are plain values, `exit` does not return, `stdout` and `stderr` are streams). Rule (b): `process.once` only as the callee of a call that is a whole expression statement, as main.ts has it twice. Failing rows: the chained access above; `const p = process.once('exit', f)`; `fn(process.once('exit', f))`; `process.once` stored without a call. Passing rows: the two statements of main.ts, the second inside an `if` without braces |
| `NODE_DEBUG=module` in the caller's environment reaches the children and adds module diagnostics to their stderr, which breaks the exact stderr assertions | The helper drops every variable whose upper-cased name starts with `NODE_`, not `NODE_OPTIONS` alone: the prefix is the class (`NODE_DEBUG`, `NODE_PATH`, `NODE_OPTIONS`, `NODE_NO_WARNINGS`, `NODE_V8_COVERAGE` and the rest). The row of the last rulings gains `NODE_DEBUG`, `node_path` and `NODE_V8_COVERAGE`, and one behaviour row runs a refusal of the file with `NODE_DEBUG: 'module'` in the source environment and asserts the same exact stderr as without it |
| The children's git reads the caller's system and global configuration (`init.defaultBranch` with an invalid value makes `git init` of a fixture fail) | The helper sets `GIT_CONFIG_NOSYSTEM` to `1` and `GIT_CONFIG_GLOBAL` to an empty file the suite creates in a directory from `tmpDir`, beside `GIT_CEILING_DIRECTORIES`. The unit row of the helper expects both. No behaviour row: a caller configuration cannot be planted without writing outside the fixture |

Reverts that must each fail a row: `once` allowed in any position; `once` allowed as any call (not only a statement); the `NODE_` prefix narrowed to `NODE_OPTIONS`; the prefix compared case-sensitively; `GIT_CONFIG_NOSYSTEM` or `GIT_CONFIG_GLOBAL` not set (the unit row).

What the helper does not do, stated so that it is not read as an oversight: it passes every other variable of the caller on (`PATH`, the temporary directory, the home directory and the locale among them), since the children need them and no test of the file asserts on text that node or git localize or colour.

## Planner ruling of 2026-11-12 after the third pre-review

The third Codex pre-review found all 64 rows of the table and the guard on main.ts right, the `once` rule and the child environment as ruled, and the evidence telling measured from carried results. One block, accepted:

| Point | Ruling |
|---|---|
| `const inherited = (process.env.__proto__ \|\| {}) as Record<string, string>; inherited.AIDLC_RUN_NO_SHIP = '1'` passes: the read of `__proto__` has the second shape, and what it returns is an object through which later reads of the environment can be changed | The second shape reads a variable, so its name must be one: a property name, or a string-literal key, of one upper-case letter followed by upper-case letters, digits and underscores. `__proto__`, `constructor`, `valueOf`, `hasOwnProperty`, `toString` and every other member of the object fail by their names, and a key that is not a string literal (`process.env[k]`) fails because its name cannot be read from the source. main.ts reads three variables, all by such names |

Rows. Failing: `process.env.__proto__ || {}`; `process.env['__proto__'] || {}`; `process.env.constructor === Object`; `process.env.valueOf === f`; `process.env[k] === '1'`; `process.env[`${'A'}`] === '1'` (a template with a substitution); `process.env.lower === '1'`. Passing: `process.env.A1_B === '1'`; `process.env['AIDLC_SESSION'] || x`; a substitution-free template key `process.env[`AIDLC_SESSION`] || x`.

Reverts that must each fail a row: the name pattern removed; the pattern widened to lower-case letters; a key that is not a string literal accepted.

## Attempt evidence

History: this card replaces T0-CLI-CWD-FILE-ARGS, whose candidate 04fccad1 (branch T0-CLI-CWD-FILE-ARGS, merge base 90dd71bb) had four formal decisions: 1 blocked (findings F3 to F6), 2 passed, 3 blocked (F7), 4 blocked on F8 (class environment-write-guard-gap: the regular expression of acceptance 13 missed white space before the parenthesis of `Object.assign (process.env` and `Object.defineProperty (process.env`); STOP review at 2026-11-11T12:33Z, replaced by the owner's ruling of 2026-11-12. Its evidence follows as it stands at 04fccad1 in specs/tasks/T0-CLI-CWD-FILE-ARGS.md (lines 67 to 402), headings one level down; under each attempt a line "Measured:" names the commit of the branch T0-CLI-CWD-FILE-ARGS that recorded it and whose run it was, and the two verification blocks of the coordinator are renamed so that this card holds no line "Coordinator verification:" of its own yet. The finding numbers inside are the predecessor's own (its attempt 2 numbers the findings of decision 1 F1 to F3; the hygiene numbers them F3 to F6). The evidence of this card on its own branch follows the moved text.

### Predecessor T0-CLI-CWD-FILE-ARGS (moved from 04fccad1)

#### Attempt 1
Measured: the commit of attempt 1, 2bbd708c, the implementer's runs on a Windows host; RED commit 0b285beb: acceptance 1 failed on the missing export, 2, 3, 4 (Windows case) and 6 failed on main for the reasons the card states; 5 passes on main by design.

| Item | Test or command | Result |
|---|---|---|
| 1 | `tests/surface/cli-cwd-paths.test.ts` "the path function by input class" | pass |
| 2 | same file, "each file argument resolves against -C" | pass |
| 3 | same file, "supplied values are refused before any read or write", and on Windows "supplied values: a drive-relative or incomplete UNC value is refused and a leading separator means the root of the -C drive" | pass, pass |
| 4 | same file, "an invalid -C is refused for every command" | pass |
| 5 | same file, "absent optional values" | pass |
| 6 | same file, "plan_ref is the same with and without -C" | pass |
| 7 | `incident`, `ci-policy`, `command-lines`, `approver`, `review-bench`, `init`, `init-base-ci`, `init-no-package` test files, unchanged | pass (in the DoD run, no test file edited) |
| 8 | `docs/OPERATIONS.md` (Setup, `-C <dir>` paragraph) and the CHANGELOG entry above `T0-CARD-LEASE-HEARTBEAT-2` | written; reviewer-verified |
| DoD | `dod_command` as given | exit 0: typecheck clean; 206 tests, 206 pass, 0 fail, 0 skipped (Windows host) |

Revert check of attempt 1 (Windows host): each behavioural source hunk reverted on its own in src/cli/main.ts, the named tests of `tests/surface/cli-cwd-paths.test.ts` run, the file restored. Tests: T1 "the path function by input class", T2 "each file argument resolves against -C", T3 "supplied values are refused before any read or write", T4 the Windows drive-relative case, T5 "an invalid -C is refused for every command", T7 "plan_ref is the same with and without -C".

| Hunk reverted | Failing test and assertion | Result |
|---|---|---|
| R3 empty or whitespace refusal | T1 `win32 "" is refused`; T3 status 1 | both fail |
| R3 drive-relative refusal | T1 `win32 "C:" is refused`; T4 `--plan "C:plan.md"` status 1 | both fail |
| R3 incomplete UNC refusal | T1 `win32 "\\\\x" is refused` | fails |
| R3 complete UNC and device exception | T1 `win32 "\\\\server\\share"` resolves as given | fails |
| R2 -C refused by R3 | T5 `-C ""` exit 1 naming `--cwd` | fails |
| R2 -C must be a directory | T5 `-C <missing>` and `-C <file>` | fails |
| R2 exit 2 under `hook` | T5 `hook auto` status 2 | fails |
| R4 `fileArg` helper | T2 `init [dir]` reads the target's `sub`; T3 status 1 | both fail |
| R4 `init [dir]` | T2 skipped lists `aidlc.config.json`; T3 `init ""` refused | both fail |
| R4 `cards project --plan` | T2 drafts `T0-CWD-ROW`; T3; T7 status 0 | all fail |
| R7 `canonical(planFile)` | T7 `-C a link to the repository` gives `plan_ref: plans/p.md#7` | fails |
| R4 `intent validate <file>` | T2 problems `missing front matter`; T3 | both fail |
| R4 `spec validate <file>` | T2; T3 | both fail |
| R4 `plan check <file>` | T2 overall `needs-clarification`; T3 | both fail |
| R4 `bench compare <before.json>` | T2 refusal names the target's `after.json`; T3 | both fail |
| R4 `bench compare <after.json>` | T2; T3 | both fail |
| R4 `ci classify --log` | T2 class `code-defect`; T3 | both fail |
| R4 `migrate assess --diff` | T2 strong impact; T3 | both fail |
| R5 empty `--diff` refused (`=== undefined`, not a truthy test) | T3 `--diff ""` status 1 | fails |
| R4 `evidence retain --file` | T2 retained bytes are the target's; T3 | both fail |
| R5 empty `--file` refused | T3 `--file ""` status 1 | fails |
| R4 `monitor check --bands` | T2 one breach; T3 | both fail |
| R4 `monitor check --data` | T2; T3 | both fail |

#### Attempt 2
Measured: 6a3e5d15, the commit of attempt 2, the implementer's runs on a Windows host.
R3 decision 1 blocked on three findings.
- F1 (class cwd-stat-hook-fail-open): `statSync(r.path, { throwIfNoEntry: false })` threw for a regular file on the way (ENOTDIR on POSIX) or a parent that cannot be read (EACCES), so `hook auto` exited 1 without the `--cwd` refusal. Fix: the -C check (`process.cwd()`, `resolvePathArg` and `statSync`) runs in one `try`; any throw gives the quoted `--cwd` refusal with its error code, exit 2 under `hook <name>` and 1 otherwise.
- F2 (class missing-linux-pre-review-run): the coordinator records its Linux run under `Coordinator verification:` at the end of this file.
- F3 (class missing-hunk-revert-verification): the revert table of attempt 1 is above; the hunks attempt 2 adds or changes are below.

Class sweep, every `statSync`, `lstatSync` or `existsSync`-then-read on a path value the change added or relies on:

| Site | Value | Under a regular file (ENOTDIR on POSIX, no entry on Windows) or an unreadable parent (EACCES) |
|---|---|---|
| src/cli/main.ts preAction, `statSync` | `-C` | the `--cwd` refusal, exit 2 under `hook`, 1 otherwise (fixed in attempt 2) |
| src/cli/main.ts preAction, `process.cwd()` | `-C` base | inside the same `try`: a removed process directory gives the refusal, not a throw (not tested: a test cannot start the CLI in a removed directory) |
| `readFileSync` in the actions | `--plan`, the `<file>` of intent, spec and plan, `--log`, `--diff`, `--bands`, `--data` | the error of main naming the resolved path, exit 1; no stat added; not reachable under `hook` |
| src/review/bench.ts `savedReport`, `existsSync` then `readFileSync` | `<before.json>`, `<after.json>` | `existsSync` is false: `<path>: no such file`, exit 1, as on main |
| src/audit/manifest.ts `retain`, `existsSync` then `readFileSync` | `--file` | `existsSync` is false: `evidence source missing: <path>`, exit 1, as on main |
| src/scaffold/init.ts `holdsContent`, `readdirSync` | `init [dir]` | ENOENT counts as an empty target (as on main); ENOTDIR or EACCES ends with main's error, exit 1; unchanged |

New and changed tests (all in `tests/surface/cli-cwd-paths.test.ts`):
- "an invalid -C is refused for every command": adds `-C <regular file>/child` on every platform and `hook protect-paths` next to `hook auto`, and asserts the reason after `--cwd "<value>": ` (empty, no directory, a file, drive letter, server and share).
- "an invalid -C is refused for every command: a parent that cannot be read": `-C <dir of mode 0o000>/inner`; skipped on Windows and for uid 0; the mode is restored in a `finally`.
- "supplied values: a value under a regular file fails with the error of main naming the resolved path": nine commands, the eleven file values other than `init [dir]`; exit 1, stderr names the resolved path, nothing written.

Revert check of attempt 2 (Windows host), T5 as above, T8 the regular-file test:

| Hunk reverted | Result |
|---|---|
| R2 -C refused by R3 (`if (!r.ok) refusal = r.message`) | T5 fails (the reason `the value is empty` is missing) |
| R2 -C must be a directory (`(a file)`) | T5 fails |
| R2 exit 2 under `hook` | T5 fails |
| R2 the `catch` removed (any throw escapes) | T5 fails |
| R2 the `catch` back to the attempt-1 form (only ENOENT refused, other codes thrown) | T5 and T8 green on Windows, which reports no entry for `<file>/child` and does not deny a read for mode 0o000; on Linux the `<file>/child` case (ENOTDIR) and the unreadable-parent case (EACCES) of T5 fail. The coordinator runs this revert under Linux. |

| Item | Test or command | Result |
|---|---|---|
| 4 | T5 and the unreadable-parent test | pass on Windows; the unreadable-parent test skipped there |
| 3 | T3, T4 and the regular-file test | pass |
| DoD | `dod_command` as given | exit 0: typecheck clean; 208 tests, 207 pass, 0 fail, 1 skipped (the unreadable-parent test, Windows host) |

#### Attempt 3
Measured: the attempt 3 DoD (212 tests) at a5d522e2, the implementer's run on a Windows host; this text written at 49fac7ce.
R3 decision 3 blocked on one finding: [spec, scope fidelity, class resolved-cwd-discarded] src/cli/main.ts:242. The -C check discarded `r.path` and every reader got the raw value; on POSIX `-C missing/../src` passed the check (the lexical path exists) while git, spawned with the raw relative cwd, failed ENOENT, so `src` became a non-repository root and `goal new` could write state under `src/.aidlc`. This is reading 3 of attempt 1 ("-C is checked but not stored resolved").

Attempt 3 stored `canonical(<R3 result>)` as the -C directory, changed the process directory to it and rewrote a relative `AIDLC_STATE_DIR`; its DoD passed (212 tests, 211 pass, 1 skipped). Two consults of 2026-11-11 showed that the canonical base and the change of directory move the base of the twelve values and of the options of R8, and the planner ruled all three out (card R1, R8, `forbid`, d612f13a). Its reader sweep, requirement table, readings and revert table no longer describe the code and are replaced by those of attempt 4.

#### Attempt 4
Measured: 49fac7ce, the implementer's runs on a Windows host, except the runs of main named with their own commit and host; the labels of the Linux rows edited at 6a36b57e and 28342543.
Rulings of 2026-11-11 after the consults on a5d522e2, applied on the card of d612f13a:
- The -C directory is stored once, as R3 returns it (`workDir = at`, lexical); `canonical()` remains only in the `plan_ref` of `cards project`.
- No `process.chdir` and no write to `process.env` anywhere in the CLI; the catch names three causes: nothing there, a regular file on the way, a parent that cannot be read.
- Without -C, `fileArg` uses R3 only to refuse and returns the value as typed; `init [dir]` follows the same rule.
- The default session token is a non-goal: every CLI call of the tests that select a repository or state directory sets `AIDLC_SESSION`, and no assertion reads `session-default`.
- Every child the tests start runs with no `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` or `GIT_COMMON_DIR` (`childEnv`).

Reader list, `git grep -n "g().cwd\|process.cwd()\|opts.cwd" -- src/cli/main.ts` at this commit:

| Line | Reader | Takes |
|---|---|---|
| :73 | `ctx()`: repository identity, config, state directory, controller, and through `c.root`/`c.repo` every git and gh probe | `opts.cwd`, which every caller passes as `g().cwd` = the stored directory; the process directory without -C |
| :236 | `g()` | `cwd: workDir`, the stored directory; the typed text is not in it |
| :239, :245 | the -C check | the typed text (`program.opts().cwd`), resolved against the process directory and printed; nothing else reads it |
| :263, :265 | `fileArg`, the base of the twelve values | the stored directory; without -C the value as typed (R9) |
| :279 | `init` without `[dir]` | the stored directory, else the process directory |
| :1078 | `review bench run` root | the stored directory, else the process directory |
| :1446 | `hook <name>` | the stored directory, else `event.cwd`, else the process directory |

Main's output for the two no-`-C` rows of acceptance 10, run on 2026-11-11 with `node D:\Projects\AIDLC\src\cli\main.ts` (main at d612f13a) from a scratch directory holding `spec.md` and no `missing`, `AIDLC_STATE_DIR` set to a scratch directory (which stayed empty):

```
$ node D:\Projects\AIDLC\src\cli\main.ts spec validate nofile.md
aidlc: ENOENT: no such file or directory, open 'C:\Users\Admin\AppData\Local\Temp\claude\ba6303180ca8049b\eb02f3fb-6d6a-4a44-870b-34d780644c33\scratchpad\t4main\dir\nofile.md'
exit 1
$ node D:\Projects\AIDLC\src\cli\main.ts spec validate missing/../spec.md --json
{ "ok": false, "problems": [ "missing front matter" ], "requirements": [] }   (JSON printed on six lines; joined here)
exit 1
$ node D:\Projects\AIDLC\src\cli\main.ts review bench compare nofile.json other.json
aidlc: nofile.json: no such file
exit 1
```

Two of these differed from the first wording of acceptance 10 (the card of 1c77a086 states them as main gives them), and the test pins main's behaviour as observed:
- On Windows, Node's ENOENT names the file in the process directory, not the value as typed. The every-host row therefore asserts that path on Windows and the value as typed on POSIX. The bench row (an error the command writes itself) names the value as typed on every host, so a resolved value without -C fails the test on Windows too.
- The POSIX row (`missing/../spec.md` fails where `missing` does not exist) cannot run on this Windows host: Windows reads `missing\..\spec.md` lexically, and main reads the file (second output above). WSL here has no Node; the coordinator ran main on Linux (below) and its Linux run executes the POSIX test.

Main's Linux output, run by the coordinator on main at 1c77a086 (WSL Ubuntu, Node v22.23.4) from a scratch directory holding `spec.md`, verbatim:

```
spec validate missing/../spec.md -> aidlc: ENOENT: no such file or directory, open 'missing/../spec.md', exit 1
spec validate nofile.md -> aidlc: ENOENT: no such file or directory, open 'nofile.md', exit 1
review bench compare nofile.json other.json -> aidlc: nofile.json: no such file, exit 1
```

The POSIX rows of acceptance 10 assert exactly these lines (attempt 5): `assert.equal(stderr, "aidlc: ENOENT: no such file or directory, open 'missing/../spec.md'\n")`, the same for `'nofile.md'`, and `'aidlc: nofile.json: no such file\n'` on every host.

Clause table, R1 to R10 (lines of src/cli/main.ts at this commit; tests by name in `tests/surface/cli-cwd-paths.test.ts`):

| Clause | Code | Test that fails without it |
|---|---|---|
| R1 -C validated by R2, resolved by R3 against the process directory | :245 | "an invalid -C"; "-C leaves the process directory ...": relative `src` and `missing/../src` |
| R1 effective base: the stored directory with -C, else the process directory | :236, :250, :263 | "each file argument resolves against -C"; "every form" |
| R1 stored once, lexical, never a realpath | :250 `workDir = at` | "plan_ref is canonical when the plan is given through a link", run `-C <link> --plan ../link/plans/p.md` (revert row "forbid: canonical -C directory") |
| R1 every reader takes the stored value | :73, :263, :279, :1078, :1446 | "every form" (doctor, bench root), "a hook runs its guards", "-C leaves the process directory ..." (doctor, goal new, hook auto) |
| R1 the typed text read only to check and print | :239 | "an invalid -C" (revert row "R2 check reads the typed -C") |
| R1 no `process.chdir`, no write to `process.env` | none in the diff | "-C leaves the process directory ...": the relative `AIDLC_STATE_DIR` assertion (`<caller>/<value>` with and without -C) is the behavioural check (revert row "forbid: process.chdir"); the removal of the `-C` directory in the same test is a cleanup check only and pins no clause |
| R1 `hook` without -C keeps `event.cwd`, else the process directory | :1446 | "a hook runs its guards in the -C directory" |
| R2 every action, before any read or write; refusals; exit 1, exit 2 under `hook` | :238-:256 | "an invalid -C" (five commands, nothing written); unreadable parent (POSIX) |
| R2 `bin/aidlc-hook.js` unchanged | none | `git diff origin/main --stat` lists no bin/ file |
| R3 every input class, both flavours | :119-:128 | "the path function by input class"; Windows "drive-relative or incomplete UNC" |
| R4 the twelve values against the effective base, checked before `ctx()` and before any input | :279, :841, :884, :895, :907, :1088, :1089, :1121, :1258, :1379, :1408, :1409 | "each file argument resolves against -C"; "supplied values are refused" |
| R4 `review bench run` root from the effective base | :1078 | "every form": `no REVIEW.md in <checkout>` |
| R5 absent values as on main; explicit empty refused | :279, :1258, :1379 | "absent optional values"; "supplied values are refused" |
| R6 message names option, quotes value, says why and what to pass; writes nothing | :120, refusals before `ctx()` | "the path function" (`; pass `); "supplied values are refused" (snapshot with `--write`, `--file-intent`, `init`); "an invalid -C" |
| R6 a value naming no file: main's error, resolved with -C, as given without | unchanged readers, :265 | "a value under a regular file"; "without -C a value is passed as given" |
| R7 `plan_ref` canonical, also with letter case, 8.3 name, and a plan given through a link; base stays the stored directory | :847 | "plan_ref is the same ..." (link, letter case); "... an 8.3 short name" (Windows); "plan_ref is canonical when the plan is given through a link" (revert row "R7 plan_ref canonical") |
| R8 the nine options keep their base | unchanged code | acceptance 7 test files, unchanged in the DoD |
| R8 `AIDLC_STATE_DIR` neither read nor rewritten for -C | none in the diff | "-C leaves the process directory ...": `<caller>/rel-state` with and without -C |
| R9 without -C, R3 only refuses; the value is handed on as typed | :264-:265 | "without -C a value is passed as given" (bench row on every host; ENOENT row on POSIX); POSIX `missing/../spec.md` test; revert row "R9" |
| R9 with -C, lexical | :263 | POSIX `missing/../spec.md` test (with -C it reads spec.md); "-C leaves the process directory ...": `-C missing/../src` |
| R10 docs state R1 to R5 and R8, and the attempt 4 sentences | docs/OPERATIONS.md Setup, CHANGELOG | sentence by sentence below |

Docs, each sentence of the `-C` paragraph of docs/OPERATIONS.md (the CHANGELOG entry says the same in fewer sentences) against its cover:

| Sentence | Cover |
|---|---|
| `-C` names the directory a command works in | R1; "every form" |
| resolved against the process directory, lexically, must name an existing directory; the refusals, exit 1, exit 2 under `hook` | R1, R2, R9; "an invalid -C"; POSIX `missing/../spec.md` test |
| every part of the command takes the resolved directory (repository, state directory when `AIDLC_STATE_DIR` is unset, file arguments, `init`, bench root, hook guards) | R1; "every form", "a hook runs its guards", "-C leaves the process directory ..." |
| `-C` changes neither the process directory nor the environment; a relative `AIDLC_STATE_DIR` is read against the process directory with or without `-C` | R1, R8; "-C leaves the process directory ..." |
| with `-C` the twelve values resolve against the `-C` directory, lexically, fully qualified as given, `\x` at the root of the drive | R3, R4, R9; "each file argument resolves against -C"; "the path function"; Windows test |
| without `-C` a value is passed as given | R9; "without -C a value is passed as given" |
| refusals with or without `-C`, checked before any input or write | R3, R4, R6, R9; "supplied values are refused"; the empty value without -C in "without -C a value is passed as given" |
| a value naming no file fails with the command's error, naming the resolved path with `-C` | R6; "a value under a regular file"; "without -C a value is passed as given" |
| `plan_ref`: with `-C` the plan's canonical path relative to the canonical main checkout, without `-C` the typed value relative to the main checkout (wording of attempt 7) | R7; the `plan_ref` tests |
| absent optional values | R5; "absent optional values" |
| `hook` without `-C` keeps `event.cwd`, else the process directory | R1; "a hook runs its guards" |
| the options that keep their base, and `AIDLC_STATE_DIR` | R8; acceptance 7 test files; "-C leaves the process directory ..." |

`forbid` and `non_goals`:

| Entry | How it holds |
|---|---|
| forbid: weakening or skipping a test | no test of main changed; this file's skips are platform gates with reasons |
| forbid (new): `process.chdir` or a write to `process.env` in the CLI | acceptance 13 (attempt 6), "the CLI changes neither the process directory nor the environment", reads src/cli/main.ts and finds no `process.chdir(` and no line with `process.env.<name>` or `process.env[...]` left of an assignment operator, no `delete process.env` and no `Object.assign(process.env`; the reads of `process.env[...]` in the file (:323, :600, :809) write nothing. The chdir revert also fails "-C leaves the process directory ..." |
| forbid (new): a realpath of the -C directory or of the base of a file argument | `workDir = at`; the canonical revert fails "plan_ref is canonical when the plan is given through a link" |
| forbid (new): resolving or rewriting a value when -C is absent | `fileArg` returns the value as typed without -C; the R9 revert fails "without -C a value is passed as given" |
| forbid: option names, help text, usage lines | no `.option`/`.command` line changed; command-lines.test.ts passes unchanged |
| forbid: the base of an option of R8 | no R8 option's code changed |
| forbid: tilde or environment variable expansion | none; `~\x` stays a file name ("the path function") |
| forbid: bin/aidlc-hook.js, .aidlc state by hand | neither touched |
| non_goal: the default session token | not changed; tests set `AIDLC_SESSION` |
| non_goal: a child a library starts without a `cwd`; a removed process directory (POSIX) | not changed; the process directory is never changed |
| non_goal: the options of R8; paths inside files the command reads; a directory where a file is expected | not changed |
| non_goal: a path through a symbolic link or junction | resolved by the file system, as on main. One case found while testing: `-C <link to a subdirectory of a repository>` selects the link's parent as the repository, because `identityFrom` in src/state/paths.ts resolves git's relative `--git-common-dir` (`../.git`) lexically against the link; main gives the same result for that -C, the file is outside `allow_paths`, and "every form" therefore uses no link to a subdirectory. A link to the repository root works and is tested. |
| non_goal: the meaning of `AIDLC_STATE_DIR` | unchanged ("-C leaves the process directory ...") |

New and changed tests (attempt 4):
- "-C leaves the process directory and the environment as they are" (all platforms; acceptance 11): relative `AIDLC_STATE_DIR` with and without -C; `-C src` and `-C missing/../src` from the checkout for doctor, goal new and hook auto; nothing under `src`; and, as a cleanup check only, the `-C` directory removed after the CLI exits.
- "plan_ref is canonical when the plan is given through a link" (all platforms; acceptance 9): `-C <repo> --plan <link>/plans/p.md`, and `-C <links/link> --plan ../link/plans/p.md`, which only a lexical base reaches.
- "without -C a value is passed as given" (all platforms; acceptance 10): the ENOENT row (platform-specific expectation, above), the bench row, and an empty value refused without -C.
- "without -C a value is passed as given: missing/../spec.md on POSIX" (skipped on Windows by `process.platform`; acceptance 10).
- "every form": the link to `src` is gone (non-goal above); the bench root uses `-C src`; no `session-default` assertion. The repository fixture sets `AIDLC_SESSION`.
- `childEnv` for every child; `gitInit` for every `git init`.

Revert check of attempt 4 (Windows host), one row per source hunk of the final diff against origin/main, each alone, the file restored; and the three forbidden changes added back:

| Hunk reverted | Result |
|---|---|
| R3 empty/whitespace refusal | "the path function" fail |
| R3 drive-relative refusal | "the path function", "Windows drive-relative or incomplete UNC" fail |
| R3 incomplete UNC refusal | "the path function" fail |
| R3 complete UNC/device exception | "the path function" fail |
| R1 g() returns the stored directory | green on Windows, where git starts in a relative cwd such as `missing\..\src`, which Windows normalizes; on POSIX the `-C missing/../src` cases of "every form" and "-C leaves the process directory ..." fail by the finding of R3 decision 3; the Linux result is the coordinator's, not run here. |
| R2 check reads the typed -C | "an invalid -C" fail |
| R2 -C refused by R3 | "an invalid -C" fail |
| R2 -C must be a directory | "an invalid -C" fail |
| R2 exit 2 under hook | "an invalid -C" fail |
| R2 catch removed | "an invalid -C" fail |
| R2 catch narrowed to ENOENT (attempt 1 form) | green on Windows, which reports no entry for <file>/child and denies no read for mode 0o000; on POSIX "an invalid -C" (<file>/child, ENOTDIR) and the unreadable-parent test exercise it; the Linux result is the coordinator's, not run here. |
| R1 store the -C directory (workDir = at) | "each file argument resolves against -C", "every form" fail |
| forbid: canonical -C directory | "plan_ref is canonical when the plan is given through a link" fail |
| forbid: process.chdir to the -C directory | "-C leaves the process directory ..." fail |
| R4 fileArg base is the stored directory | "each file argument resolves against -C" fail |
| R6 fileArg refuses | "supplied values are refused" fail |
| R9 without -C the value as given | "without -C a value is passed as given" fail |
| R4 init [dir] | "each file argument resolves against -C" fail |
| R4 cards project --plan | "each file argument resolves against -C" fail |
| R7 plan_ref canonical | "plan_ref is canonical when the plan is given through a link" fail |
| R4 intent validate | "each file argument resolves against -C" fail |
| R4 spec validate | "each file argument resolves against -C" fail |
| R4 plan check | "each file argument resolves against -C" fail |
| R4 bench <before.json> | "each file argument resolves against -C" fail |
| R4 bench <after.json> | "each file argument resolves against -C" fail |
| R4 ci classify --log | "each file argument resolves against -C" fail |
| R4 migrate --diff | "each file argument resolves against -C" fail |
| R5 empty --diff refused | "supplied values are refused" fail |
| R4 evidence --file | "each file argument resolves against -C" fail |
| R5 empty --file refused | "supplied values are refused" fail |
| R4 monitor --bands | "each file argument resolves against -C" fail |
| R4 monitor --data | "each file argument resolves against -C" fail |

Other checks: the 78 test files that name docs/OPERATIONS.md or CHANGELOG.md (`git grep -l` over tests/), run together on Windows: 1867 tests, 1853 pass, 2 fail, 12 skipped; the two failures (tests/infra/exec.test.ts "T0-EXEC-TREE-KILL run on real processes", a timing bound, and tests/surface/hook-git-prefetch.test.ts "F3") are in files that do not start the CLI, and both files pass alone right after (70 tests, 70 pass), so they read as load-dependent under 78 files run at once; `npm run bench -- --check` exits 0: "every count within its ceiling (6 journeys)"; diff at 49fac7ce against origin/main (merge base d612f13a), against the budget of 800 then (940 since 1c77a086): 884 changed lines, 873 added and 11 removed: src/cli/main.ts 87, tests/surface/cli-cwd-paths.test.ts 551, this card 242, docs/OPERATIONS.md 2, CHANGELOG.md 2; over that budget by 84, in tests and attempt evidence.

| Item | Test or command | Result |
|---|---|---|
| DoD | `dod_command` as given | exit 0: typecheck clean; 215 tests, 213 pass, 0 fail, 2 skipped (the unreadable-parent test and the POSIX `missing/../spec.md` test, Windows host) |

#### Attempt 5
Measured: 6a36b57e, the implementer's runs on a Windows host.
The Codex consult on 49fac7ce passed the production code and blocked on three test points, with three risks; the card was amended in 1c77a086 (acceptance 10 and R9 state the error as main gives it, budget 940). This attempt changes tests and evidence only; src/cli/main.ts, docs/OPERATIONS.md and CHANGELOG.md are as at 49fac7ce.

1. Block, the unreadable-parent test: the case `-C <mode-000 directory>` expected a `--cwd` refusal and named a change of directory that no longer exists. A stat of that directory needs search permission on its parent only, so R2 accepts it; the test now asserts that `-C <locked> spec validate spec.md` exits 1 with an error that starts `aidlc: `, names the directory and does not name `--cwd`. Expected text, derived and not run on this Windows host: `aidlc: EACCES: permission denied, open '<locked>/spec.md'` (git cannot start in the directory, so it is no repository; `aidlc.config.json` is not found there, so the defaults apply; then the open of spec.md fails). The `<locked>/inner` case keeps the refusal, exit 1 and exit 2 under a hook. POSIX only, skipped for uid 0, the mode restored in a `finally`.
2. Block, the child environment: every child the file starts (`git init`, the CLI, the environment dump) gets `childEnv()`, which drops every inherited variable whose upper-cased name starts with `GIT_` or `AIDLC_`, and `CLAUDE_CODE_SESSION_ID`, and sets `GIT_CEILING_DIRECTORIES` to the canonical OS temporary directory, the parent of every fixture. New test "every child starts without the GIT_ variables of the test process, and repository discovery stops at the ceiling": with `GIT_DIR`, a lowercase `git_work_tree`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0` and `GIT_CONFIG_VALUE_0` set in the test process, a child's environment holds only `GIT_CEILING_DIRECTORIES`, and the CLI in a caller outside any repository reports `<caller> (not a git repository)` although `GIT_DIR` names a repository. How the ceiling was checked: a fixture inside a git checkout (`<outer>/fx/caller`, `<outer>` a repository under the temporary directory) runs `doctor`; with the default ceiling, which lies above `<outer>`, it reports `<outer>` as the repository, and with `GIT_CEILING_DIRECTORIES=<outer>` it reports `<caller> (not a git repository)`. It passed on this Windows host, so Git for Windows reads the Windows path; the Linux run checks POSIX.
3. Block, R4 "before `ctx()`": new test "supplied values are refused before the command context is built". The target holds an `aidlc.config.json` that is not JSON; the test first shows that `-C <target> spec validate spec.md` fails on that configuration, then that each empty value is refused naming its option. Commands among the twelve values that build a context: `cards project` (`--plan`), `intent validate`, `spec validate`, `plan check` (`<file>`), `ci classify` (`--log`), `migrate assess` (`--diff`), `evidence retain` (`--file`), `monitor check` (`--bands`, `--data`): eight commands, nine values. Commands that build none: `init [dir]` and `review bench compare` (`<before.json>`, `<after.json>`). The two-input commands are tested with the empty value second: `monitor check --bands bands.yaml --data ""` and `review bench compare before.json ""`.
4. Risk, acceptance 11: the removal of the `-C` directory is described as a cleanup check only; the relative `AIDLC_STATE_DIR` assertion is the behavioural check of "no change of directory, no rewrite" (clause table, R1 row).
5. Risk, evidence: the attempt 4 text now says the two results differed from the first wording of acceptance 10, and labels the 884-line figure as measured at 49fac7ce against the budget of 800 then.
6. Main's Linux output (the coordinator's run at 1c77a086) is recorded verbatim under attempt 4, and the POSIX rows assert those lines exactly (`assert.equal` on the whole stderr), as the bench row does on every host.

Revert rows of attempt 5 (Windows host, each alone, the file restored):

| Change reverted | Result |
|---|---|
| src/cli/main.ts: in `spec validate`, the `fileArg` line moved after `ctx()` | "supplied values are refused before the command context is built" fails: `spec validate <file>: aidlc: aidlc.config.json: Expected property name or '}' in JSON at position 2 (line 1 column 3)` |
| test: `childEnv` back to the attempt 4 filter (only `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`) | "every child starts without the GIT_ variables ..." fails (`GIT_CONFIG_COUNT` and friends reach the child) |
| the direct mode-000 case | POSIX only; the coordinator's Linux run executes it |

Other checks: the 78 test files that name docs/OPERATIONS.md or CHANGELOG.md, run together on Windows: 1867 tests, 1855 pass, 0 fail, 12 skipped; diff against the merge base of that commit, 1c77a086: 994 changed lines (983 added, 11 removed; working tree before this commit) against the budget of 940: tests/surface/cli-cwd-paths.test.ts 627, this card 276, src/cli/main.ts 87, docs/OPERATIONS.md 2, CHANGELOG.md 2; over by 54, in tests and attempt evidence.

| Item | Test or command | Result |
|---|---|---|
| DoD | `dod_command` as given | exit 0: typecheck clean; 217 tests, 215 pass, 0 fail, 2 skipped (the unreadable-parent test and the POSIX `missing/../spec.md` test, Windows host) |

#### Attempt 6
Measured: 28342543, the implementer's runs on a Windows host; the Linux run at 6a36b57e is the coordinator's.
The second consult (Fable) on 6a36b57e confirmed the attempt 5 repair (the coordinator's Linux run at 6a36b57e: 18 tests, 16 pass, 0 fail, 2 Windows-only skips, uid 1000) and found one defect and four evidence and docs points; the card was amended in f4977081 (R7, acceptance 9, 12 and 13, budget 1100).

1. Defect, `plan_ref` without -C: `c.root` is lexical where the directory is no git repository, and `canonical(planFile)` is canonical, so from a process directory reached by a short name or a link, with no -C, the candidate drafted another `plan_ref` than main. The code now follows R7 as amended (src/cli/main.ts:845):
   `const planRef = workDir === undefined ? path.relative(c.root, o.plan) : path.relative(canonical(c.root), canonical(planFile));` and `planRef: \`${planRef.replace(/\\/g, '/')}#7\``. Without -C this is main's expression on the value as typed, byte for byte; with -C both sides are canonical.
   Main's output for acceptance 12 (a), run on 2026-11-12 with main at f4977081, from inside a scratch git repository `<root>\repo`, with `<root>\link` a junction to it, `AIDLC_STATE_DIR` and `AIDLC_SESSION` set:
   ```
   $ node D:\Projects\AIDLC\src\cli\main.ts cards project --plan <root>\link\plans\p.md
   plan_ref: ../link/plans/p.md#7
   exit 0
   ```
   New test "plan_ref without -C is the one main drafts, and with -C both sides are canonical" (all platforms): (a) pins `plan_ref: ../link/plans/p.md#7`; (b) `-C <plain-link>`, a link to a directory that is no repository, `--plan plans/p.md` drafts `plan_ref: plans/p.md#7`. Acceptance 6 and 9 stay green.
2. Source pin, acceptance 13: new test "the CLI changes neither the process directory nor the environment" reads src/cli/main.ts and asserts no `process.chdir(` and no line that assigns to `process.env` (a property or an index left of `=`, `+=`, `-=`, `??=`, `||=` or `&&=`, a `delete process.env`, an `Object.assign(process.env`). Reads stay allowed (:323, :600, :809).
3. Docs: docs/OPERATIONS.md now names what takes the `-C` directory (the command's context, the base of its file arguments, `init`, the `review bench run` root, the hook's guards) and says that the default session token is read from the state directory of the process directory; the `plan_ref` sentence of docs/OPERATIONS.md and of the CHANGELOG follows R7 as amended.
4. Evidence: the attempt 4 forbid row now cites the source pin; the attempt 5 diff names its merge base, 1c77a086; no placeholder is left; the two Windows-green revert rows of attempt 4 state that their Linux result is the coordinator's.

New sentences against their cover:

| Sentence | Cover |
|---|---|
| OPERATIONS: the command's context (repository, configuration, state directory when `AIDLC_STATE_DIR` is unset), the base of its file arguments, `init` without a directory, the `review bench run` root and the hook's guards take the resolved directory | R1; "every form", "a hook runs its guards", "-C leaves the process directory ...", "each file argument resolves against -C", "absent optional values" |
| OPERATIONS: `-C` changes neither the process directory nor the environment; a relative `AIDLC_STATE_DIR` is read against the process directory | R1, R8; "-C leaves the process directory ..."; acceptance 13 |
| OPERATIONS: the default session token is read from the state directory of the process directory, so set `AIDLC_SESSION` when `-C` names another repository | `non_goals` (the default session token); R1 ("what reads the process directory itself does so as on main") |
| OPERATIONS and CHANGELOG (wording of attempt 7): with `-C`, `plan_ref` is the plan's canonical path relative to the canonical main checkout; without `-C`, the typed value relative to the main checkout, as before. The two differ for a plan file that is a link (`real.md#7` with `-C`, `link.md#7` without) | R7; "plan_ref is the same ..." (link, letter case), "... an 8.3 short name", "plan_ref is canonical when the plan is given through a link", "plan_ref without -C is the one main drafts ...", "... a plan file that is a link" (POSIX; skipped on this host, EPERM) |

Revert rows of attempt 6 (Windows host, each alone, the file restored):

| Change | Result |
|---|---|
| R7 without -C made canonical (`path.relative(canonical(c.root), canonical(planFile))` on both branches) | "plan_ref without -C is the one main drafts ..." fails: the run without -C drafts `plan_ref: plans/p.md#7`, not `../link/plans/p.md#7` |
| R7 with -C, left side `c.root` | the same test fails: `-C <plain-link>` drafts `plan_ref: ../plain/plans/p.md#7` |
| R7 with -C, right side `planFile` | "plan_ref is canonical when the plan is given through a link" fails (`--plan <link>/plans/p.md`) |
| forbid: `process.chdir(at)` added back | acceptance 13 fails: "src/cli/main.ts calls process.chdir" |
| forbid: the absolute `AIDLC_STATE_DIR` rewrite added back | acceptance 13 fails: "src/cli/main.ts writes process.env" |

The Linux results of the two revert rows of attempt 4 that are green on Windows (`g()` returning the typed -C, the catch narrowed to ENOENT) are the coordinator's.

Other checks: the 79 test files that name docs/OPERATIONS.md or CHANGELOG.md, run together on Windows: 1870 tests, 1858 pass, 0 fail, 12 skipped; diff against the merge base f4977081: 1069 changed lines (1058 added, 11 removed; working tree before this commit) against the budget of 1100: tests/surface/cli-cwd-paths.test.ts 657, this card 319, src/cli/main.ts 89, docs/OPERATIONS.md 2, CHANGELOG.md 2.

| Item | Test or command | Result |
|---|---|---|
| DoD | `dod_command` as given | exit 0: typecheck clean; 219 tests, 217 pass, 0 fail, 2 skipped (the unreadable-parent test and the POSIX `missing/../spec.md` test, Windows host) |

#### Attempt 7
Measured: 516d8739, the implementer's runs on a Windows host; the Linux run at 28342543 is the coordinator's.
The Codex pre-review of 28342543 passed the source and blocked on three coverage and wording points, with one risk; the card was amended in 2184dc23 (R7 states the two `plan_ref` rules for a plan reached through a link; acceptance 12 and 13 gain a row each). The coordinator's Linux run at 28342543, quoted as the coordinator's: "20 tests, 18 pass, 0 fail, 2 Windows-only skips; both POSIX-only revert rows red (typed `-C` to the readers: tests 13, 14, 15 fail; catch narrowed to ENOENT: tests 8, 9 fail)". src/cli/main.ts is unchanged in this attempt.

1. Before `ctx()`, both orders: "supplied values are refused before the command context is built" now has, for each command with two inputs, a row with the empty value first and one with it second: `monitor check --bands "" --data data.json`, `monitor check --bands bands.yaml --data ""`, `review bench compare "" after.json`, `review bench compare before.json ""`.
2. A plan file that is a link: new test "plan_ref without -C is the one main drafts, and with -C both sides are canonical: a plan file that is a link". `plans/link.md` is a symbolic link to `plans/real.md`; with `-C <repo>`, `--plan plans/link.md` drafts `plan_ref: plans/real.md#7`; without -C, from inside the repository, `plan_ref: plans/link.md#7`. This host cannot create a file link (`symlinkSync(..., 'file')` throws EPERM), so the test skips with "this host cannot create a file link: EPERM", and main's output for the no-`-C` row was not recorded here; the coordinator's Linux run executes it.
3. Wording: docs/OPERATIONS.md and the CHANGELOG state the two `plan_ref` rules directly, and the sentence on a value that names no file excepts `init [dir]` (pinned: `-C <target> init missing --dry-run` exits 0 in "a value under a regular file"). The card's docs tables follow the same wording.
4. Acceptance 13: (a) the source pin reads the whole text with four rules, checked against a table inside the test:

   ```ts
   const rules: Array<[string, RegExp]> = [
     ['chdir', /\bchdir\b/],
     ['assignment to process.env', /\bprocess\.env(?:\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]*\]))*\s*(?:=(?![=>])|\+=|-=|\?\?=|\|\|=|&&=)/],
     ['delete process.env', /\bdelete\s+process\.env\b/],
     ['Object.assign or Object.defineProperty on process.env', /\bObject\.(?:assign|defineProperty)\(\s*process\.env\b/],
   ];
   ```

   | Text | Forbidden |
   |---|---|
   | `process.chdir(at)` | yes |
   | `process['chdir'](at)` | yes |
   | `process.env.X = v` | yes |
   | `process.env.X` then a line break and `= v` | yes |
   | `process.env['X'] ??= v` | yes |
   | `delete process.env.X` | yes |
   | `Object.assign(process.env, x)` | yes |
   | `Object.defineProperty(process.env, 'X', { value: v })` | yes |
   | `process.env['X']` | no |
   | `{ ...process.env }` | no |
   | `process.env.X === 'a'` | no |
   | `(e = process.env) => e` | no |

   (b) the behaviour row, its own test "the CLI changes neither the process directory nor the environment: the default session token stays with the process directory": with `-C <repository>` from a caller directory that is no repository, the child environment without `AIDLC_STATE_DIR`, `AIDLC_SESSION` or `CLAUDE_CODE_SESSION_ID`, `goal new` creates the goal in the repository's state directory, `session-default` under `<caller>/.aidlc` and none under `<repository>/.aidlc`. Checked by hand first on 2026-11-12, with the candidate and with main at 2184dc23 (`node D:\Projects\AIDLC\src\cli\main.ts`), the same way:

   ```
   == candidate: aidlc -C <repo> goal new "a small change" (cwd caller, no AIDLC_STATE_DIR, AIDLC_SESSION, CLAUDE_CODE_SESSION_ID)
   exit 0; caller: [".aidlc\\session-default"]; repo/.aidlc: no session-default; goals in repo/.aidlc: 1
   == main: the same
   exit 0; caller: [".aidlc\\session-default"]; repo/.aidlc: no session-default; goals in repo/.aidlc: 1
   ```

5. Temporary directories (the coordinator's point after the formal reviews of two sibling cards): every directory the file creates comes from `tmpDir` of tests/infra/helpers.ts through the file's `tempDir`, which canonicalizes it (realpathSync.native), and is removed by `cleanup` in the file's `after` hook. The one direct removal is `gone` in acceptance 11: that the `-C` directory can be removed once the CLI has exited is what that assertion checks, so it stays a direct `rmSync`.

   Grep at this commit (`git grep -n "tempDir('\|tmpDir(\|cleanup(\|rmSync(\|mkdtempSync" -- tests/surface/cli-cwd-paths.test.ts`):

   | Directory | Created by | Removed by |
   |---|---|---|
   | `fx` (`fixture()`: caller, target, third, state) | `tempDir('fx')` (`tmpDir`) | `cleanup` in `after` |
   | `repo` (`repoFixture()`: repository, src, caller) | `tempDir('repo')` | `cleanup` in `after` |
   | `leak` (the environment test's repository) | `tempDir('leak')` | `cleanup` in `after` |
   | `outer` (the ceiling check) | `tempDir('outer')` | `cleanup` in `after` |
   | `locked` (the unreadable-parent test; mode restored in a `finally`) | `tempDir('locked')` | `cleanup` in `after` |
   | `session` (the session token row) | `tempDir('session')` | `cleanup` in `after` |
   | subdirectories, links and files inside these | `mkdirSync`, `write`, `symlinkSync`, the CLI | with their parent |
   | `gone` (acceptance 11, inside `fx`) | `mkdirSync` | direct `rmSync`, the assertion under test |

   `mkdtempSync` occurs 0 times in the file; `tmpDir(` once (inside `tempDir`), `cleanup(` once (the `after` hook), `rmSync(` once (`gone`).

Revert rows of attempt 7 (Windows host, each alone, the file restored):

| Change | Result |
|---|---|
| src/cli/main.ts: the `--bands` validation moved below `ctx()` | "supplied values are refused before the command context is built" fails: `monitor check --bands: aidlc: aidlc.config.json: Expected property name or '}' in JSON at position 2 (line 1 column 3)` |
| R7 with -C only the plan's directory canonical (`path.join(canonical(path.dirname(planFile)), path.basename(planFile))`) | POSIX only on this host: the file-link test is skipped here (EPERM); the coordinator's Linux run executes it |
| forbid: `process.chdir(at)` alone | the session token row fails (no `<caller>/.aidlc/session-default`: the token went to the repository); the source pin fails ("src/cli/main.ts": `chdir`) |
| forbid: chdir with the absolute `AIDLC_STATE_DIR` rewrite of attempt 3 | the session token row fails the same way; the source pin fails (`chdir`, assignment to `process.env`) |

Other checks: the 79 test files that name docs/OPERATIONS.md or CHANGELOG.md, run together on Windows: 1870 tests, 1857 pass, 1 fail, 12 skipped; the failure is the timing bound of tests/infra/exec.test.ts "T0-EXEC-TREE-KILL run on real processes" (acceptance 4, exit mode), a file that does not start the CLI, and the file passes alone right after (61 tests, 61 pass), as in attempt 4; diff against the merge base 2184dc23: 1206 changed lines (1195 added, 11 removed; working tree before this commit) against the budget of 1100: tests/surface/cli-cwd-paths.test.ts 721, this card 392, src/cli/main.ts 89, docs/OPERATIONS.md 2, CHANGELOG.md 2; over by 106, in tests and attempt evidence.

| Item | Test or command | Result |
|---|---|---|
| DoD | `dod_command` as given | exit 0: typecheck clean; 221 tests, 218 pass, 0 fail, 3 skipped (the unreadable-parent test, the file-link test (EPERM) and the POSIX `missing/../spec.md` test, Windows host) |

#### After the last pre-review of 516d8739 (coordinator edits)
Written: 8428d904, by the coordinator; no run.

A Codex pre-review of 516d8739 found no blocking point and two risks; the coordinator closed both. (1) docs/OPERATIONS.md: "A value that names no file fails ... naming the resolved path" now reads "fails, when the command reaches the read of that input, with the command's own error": with a malformed `aidlc.config.json` in the `-C` directory the command fails on the configuration first (the row of "supplied values are refused before the command context is built" that shows `ctx()` failing on that file). No other document or test changes. (2) The card's hygiene, on main, names the tests that leave `AIDLC_STATE_DIR` unset (acceptance 11 and the session-token row of acceptance 13).

The predecessor's coordinator verification (written at 0d400f85, the coordinator's runs at 6d3c34c8):
- At 6d3c34c8, before the review, run by the coordinator. Linux (WSL Ubuntu, Node v22.23.4), the test files this branch adds or changes (tests/surface/cli-cwd-paths.test.ts): tests 9, pass 8, fail 0, skipped 1.
- Windows, docpins: 78 test files reading 2 changed documents: # tests 1863 # pass 1851 # fail 0
- Linux revert of the repair of F1, run by the coordinator under WSL as a non-root user: with the candidate tests/surface/cli-cwd-paths.test.ts gives 9 tests, 8 pass, 0 fail, 1 skipped (the Windows drive-letter case); with src/cli/main.ts restored to its attempt 1 form of the -C check (508ec31d), 'an invalid -C is refused for every command' and 'an invalid -C is refused for every command: a parent that cannot be read' fail, 6 of 9 pass; the file was restored afterwards.
- The `dod_command` is rerun by the coordinator on the commit that adds these lines; its receipt is recorded on the attempt.

The predecessor's coordinator verification (written at 04fccad1, the coordinator's runs at 486a0c21 and 516d8739):
- At 486a0c21, before the review, run by the coordinator. Linux (WSL Ubuntu, Node v22.23.4), the test files this branch adds or changes (tests/surface/cli-cwd-paths.test.ts): tests 22, pass 20, fail 0, skipped 2.
- Windows, docpins: 79 test files reading 2 changed documents: # tests 1870 # pass 1857 # fail 1 docpins: tests/infra/exec.test.ts failed in the parallel run and passes alone (# pass 61): load
- Linux revert rows that are green or skipped on Windows, run by the coordinator under WSL (uid 1000) on the sources of 516d8739, unchanged since: the file gives 22 tests, 20 pass, 0 fail, 2 skipped (the two Windows-only tests); with g() handing the typed -C to the readers, tests 13, 14 and 15 fail; with the catch of the -C check rethrowing all but ENOENT, tests 8 and 9 fail; with only the directory of the plan made canonical under -C, test 20 (a plan file that is a link) fails. main at 1b9255f1 on Linux, no -C, cards project --plan plans/link.md (a link to plans/real.md) drafts plan_ref: plans/link.md#7, exit 0, the value the test pins.
- The `dod_command` is rerun by the coordinator on the commit that adds these lines; its receipt is recorded on the attempt.

### T0-CLI-CWD-FILE-ARGS-2 on its own branch
Measured: the implementer's runs on a Windows host (Node v22.23.1), on the commits named at each item.

Sweep, on the branch at 767fbe04 (main): the `git grep` of `sweep` gives the same 32 lines on main as at 90dd71bb (the two outputs without line numbers compared with `diff`, no difference). The commits of main since 90dd71bb add the help of `--dod-receipt <text>` and make `--final-digest <digest>` required; no path option and no file read. No path value outside R4 and R8.

RED: c803fa35 commits tests/surface/cli-cwd-paths.test.ts alone, on the sources of main at 767fbe04. Run of the file there: tests 23, pass 8, fail 12, skipped 3. Red, each on an assertion: "the path function by input class" (`src/cli/main.ts exports resolvePathArg`); "each file argument resolves against -C" (`init sub` reports the caller's files, not the target's `sub`); "refused before the command context is built" (`--plan` fails on the target's configuration first); "refused before any read or write" (`init "" ` not refused); "a value under a regular file" and the Windows drive-relative test, the two `plan_ref is the same` tests, "an invalid -C" (`-C ""` runs in the caller directory), "plan_ref without -C ..." and "without -C a value is passed as given" (ENOENT naming the caller directory); "plan_ref is canonical when the plan is given through a link" (no `plan_ref: plans/p.md#7`). Green on main: the child-environment test, "absent optional values" (by design), "every form", "a hook runs its guards", "-C leaves the process directory ...", and the three tests of acceptance 13: the source pin passes on main's src/cli/main.ts, which uses `process.env` only in the three shapes, and the session-token row passes on main as the predecessor recorded. Skipped on this host: the unreadable parent, the file link (EPERM) and the POSIX `missing/../spec.md` test.

Applied, cd5cb038: `git apply --3way` of `git diff origin/main...04fccad1 -- src/cli/main.ts docs/OPERATIONS.md CHANGELOG.md` (byte for byte `git diff 90dd71bb 04fccad1` of the same files), every hunk clean, with offsets only (src/cli/main.ts hunks 5 to 10 at -1 and 12 to 13 at +3 lines; CHANGELOG at +34, still directly above `- T0-CARD-LEASE-HEARTBEAT-2 (bugfix`). Each hunk of src/cli/main.ts read in its new surroundings: no call site changed shape. Check of step D: 04fccad1:src/cli/main.ts with `git diff 90dd71bb origin/main -- src/cli/main.ts` applied (clean) and the two renames below is byte-identical (`cmp`) to src/cli/main.ts at cd5cb038; the added and removed lines of `git diff 04fccad1 cd5cb038 -- src/cli/main.ts` and of `git diff 90dd71bb origin/main -- src/cli/main.ts` differ only in the two renamed comment lines.

Renamed from T0-CLI-CWD-FILE-ARGS to T0-CLI-CWD-FILE-ARGS-2: the CHANGELOG entry (now `- T0-CLI-CWD-FILE-ARGS-2 (bugfix, replaces T0-CLI-CWD-FILE-ARGS, audit item C17):`); docs/OPERATIONS.md `(card T0-CLI-CWD-FILE-ARGS-2)`; src/cli/main.ts, the comments of `resolvePathArg` (`card T0-CLI-CWD-FILE-ARGS-2 R3`) and of `workDir` (`card T0-CLI-CWD-FILE-ARGS-2 R1`); the test file's header comment and suite title. Not renamed: "R3 decision 3" in a test comment, a decision of the predecessor.

Acceptance 13, the guard (tests/surface/cli-cwd-paths.test.ts, `envViolations`): `ts.createSourceFile` with parent nodes, a walk with its own stack through `ts.forEachChild`, no type checker. (a) an identifier `chdir`, a string or substitution-free template literal `chdir`; (b) an identifier `process` that is not the `expression` of a `PropertyAccessExpression`, a literal `process` or `node:process`; (c) a `process.env` that is none of: a `SpreadAssignment` whose object literal is not the target of a destructuring assignment; the `expression` of a property or element access that is the `left` or `right` of a `BinaryExpression` with `||`, `&&`, `??`, `===` or `!==`; an argument of a call whose callee is the identifier `renewSessionCardLeases`. Every `ts.` name used is in node_modules/typescript/lib/typescript.d.ts (5.9.3): `createSourceFile`, `forEachChild`, `ScriptTarget.Latest`, `ScriptKind.TS`, the six `SyntaxKind` tokens, `isIdentifier`, `isStringLiteral`, `isNoSubstitutionTemplateLiteral`, `isPropertyAccessExpression`, `isElementAccessExpression`, `isCallExpression`, `isBinaryExpression`, `isSpreadAssignment`, `isSpreadElement`, `isObjectLiteralExpression`, `isArrayLiteralExpression`, `isParenthesizedExpression`, `isPropertyAssignment`, `isForOfStatement`, `isForInStatement`, and the node methods `getStart`, `getText` and `SourceFile.getLineAndCharacterOfPosition`. The table: 11 passing texts and 31 failing ones, each with the rules it breaks; beyond the card's list, `Object.assign` has two line-break forms (inside and before the parenthesis) and `({ ...process.env } = o)` fails (c): a spread on the left of a destructuring assignment writes the rest of `o` into the environment, so the first shape excludes it.

Revert rows of acceptance 13, actual runs at cd5cb038: each mutation of `envViolations` on a scratch copy of the test file (tests/surface/cli-cwd-paths.mut13.test.ts, removed after each run), its three tests of acceptance 13 run; 11 rows, 11 red.

| Mutation | Red (first message) |
|---|---|
| rule (a) removed | the table (`process.chdir(at)`) |
| the string form of (a) removed | the table (`process['chdir'](at)`) |
| rule (b) removed | the table (`process['chdir'](at)` lacks b) |
| the string form of (b) removed | the table (`import p from 'node:process'`) |
| shape 1 of (c) removed | src/cli/main.ts and the table |
| shape 2 of (c) removed | src/cli/main.ts and the table |
| shape 3 of (c) removed | src/cli/main.ts and the table |
| the operator list widened by `=` | the table (`process.env.X = v`) |
| the callee of shape 3 not compared | the table (`Object.assign(process.env, x)`) |
| a comment read as code (`//` stripped before parsing) | src/cli/main.ts and the table |
| beyond the card: a spread in a destructuring target taken as a read | the table (`({ ...process.env } = o)`) |

Revert rows of the carried behaviour, actual runs at cd5cb038: each mutation in src/cli/main.ts in the worktree, the tests named run, the file written back byte for byte (`git status` and `git diff --stat` empty afterwards). The rows are those of the predecessor's attempt 4 table and its source rows of attempts 5 to 7, mutated as their text names them; row 15 is new (the form of F8 in the source).

| # | Mutation | Tests run | Result |
|---|---|---|---|
| 1 | R3 empty/whitespace refusal removed | path function | red |
| 2 | R3 drive-relative refusal removed | path function, Windows drive-relative | both red |
| 3 | R3 incomplete UNC refusal removed | path function | red |
| 4 | R3 complete UNC/device exception removed | path function | red |
| 5 | `g()` hands the typed -C to the readers | every form, -C leaves ... | green on Windows, as the predecessor recorded; the Linux row is the coordinator's (red at 516d8739: tests 13, 14, 15) |
| 6-9 | R2: the R3 refusal of -C ignored; no directory check; exit 1 under hook; the catch rethrows | invalid -C | red in each of the 4 runs |
| 10 | R2: catch narrowed to ENOENT | invalid -C | green on Windows (unreadable parent skipped), as the predecessor recorded; Linux the coordinator's (red at 516d8739: tests 8, 9) |
| 11 | `workDir = at` removed | each file argument, every form | both red |
| 12 | forbid: `workDir = canonical(at)` | plan_ref through a link | red |
| 13 | forbid: `process.chdir(at)` added | -C leaves ..., acceptance 13 | -C leaves ..., the source pin, the session-token row red |
| 14 | forbid: chdir with the `AIDLC_STATE_DIR` rewrite of attempt 3 | -C leaves ..., acceptance 13 | the source pin and the session-token row red; -C leaves ... green (the rewrite keeps the relative state directory) |
| 15 | forbid: `Object.assign (process.env, {...})` with chdir | acceptance 13 | the source pin and the session-token row red |
| 16 | `fileArg` base `process.cwd()` | each file argument | red |
| 17 | `fileArg` returns a refused value | refused before any read or write | red |
| 18 | without -C, `fileArg` returns the resolved path | without -C ... | red |
| 21 | R7 right side `planFile` | plan_ref through a link | red |
| 22 | R7 canonical without -C | plan_ref without -C ... | red |
| 23 | R7 left side `c.root` | plan_ref without -C ... | red |
| 19-20, 24-30, 32, 34-35 | `init [dir]`, `--plan`, intent, spec, plan, `<before.json>`, `<after.json>`, `--log`, `--diff`, `--file`, `--bands`, `--data` not through `fileArg` | each file argument | red in each of the 12 runs |
| 31, 33 | `--diff`, `--file` checked by truthiness | refused before any read or write | red, red |
| 36 | spec validate: `fileArg` after `ctx()` | before the command context | red |
| 37 | monitor check: `--bands` after `ctx()` | before the command context | red |
| 38 | R7 with -C only the plan's directory canonical | plan_ref without -C ..., the file-link test | green: the file-link test is skipped here (EPERM); Linux the coordinator's (red at 516d8739: test 20) |

38 rows run: 35 red, 3 green on this host (5, 10, 38), each with the Linux result recorded by the predecessor's coordinator. Carried as measured on the predecessor and not rerun: the attempt 4 row "R2 check reads the typed -C" (its text does not give the mutation); the test-only rows of attempt 5 (`childEnv` narrowed) and the POSIX-only mode-000 row; the tables of attempts 1 and 2, whose source rows are rows 1 to 35 here.

Documents: docs/OPERATIONS.md and the CHANGELOG carry the predecessor's sentences with the card id renamed; the sentence tables of attempts 4 and 6 above still hold, and no sentence names the source pin. `forbid` and `non_goals`, checked by their letter against `git diff origin/main...HEAD`: no file under src/ but src/cli/main.ts, no `process.chdir`, no `process.env` write, no `.option`, `.command` or help text line changed, bin/aidlc-hook.js untouched; the session-token row reads the non-goal as main has it.

| Item | Test or command | Result |
|---|---|---|
| 1 to 7, 9 to 13 | the named tests of tests/surface/cli-cwd-paths.test.ts and the eight files of acceptance 7, in the DoD | pass; three skips on this host as above |
| 8 | docs/OPERATIONS.md, CHANGELOG | reviewer-verified |
| DoD | `dod_command` as given, at cd5cb038 (the next commit changes only this card file, which no test of the DoD reads) | exit 0: typecheck clean; 257 tests, 251 pass, 0 fail, 6 skipped (this file: the unreadable parent, the file link (EPERM), the POSIX `missing/../spec.md` test; tests/surface/incident.test.ts: three POSIX mode-bit tests), 18 suites |

Changed lines, `git diff --shortstat origin/main...HEAD` with this file: 1391 changed lines (1380 added, 11 removed) against the budget of 1400: tests/surface/cli-cwd-paths.test.ts 814, this card 484, src/cli/main.ts 89, docs/OPERATIONS.md 2, CHANGELOG.md 2.

### Repair round after the pre-review of f9b50cf1
Measured: the implementer's runs on a Windows host (Node v22.23.1), on the commits named. The merge 4515a453 brings main at 83791bf5 (acceptance 13 restated, the rulings section); the only conflict was this file, resolved with main's sections above this Attempt evidence and the coordinator's sections after it.

Check before RED: src/cli/main.ts at 4515a453, parsed by the new rules (the source pin of d47fd254 is green on it): `process` is used only with the ten properties, and there is no `this` and none of `eval`, `Function`, `globalThis`, `global`, `Reflect` in code (the words occur only in strings and comments). Nothing to stop for.

RED, 61f8186f (the test file alone; `childEnv` gains its `source` parameter, its behaviour unchanged): the NODE_OPTIONS row and the three tests of acceptance 13 run, 4 tests, 2 fail. "every child starts without NODE_OPTIONS of the test process, in any letter case" is red: `NODE_OPTIONS` and `node_options` reach the result. The table is red at 14 rows: the 11 new failing rows (`process.valueOf()` twice, `mainModule`, `binding`, `emit`, the `this` listener, `eval`, `new Function`, `Reflect.get` with no violation; `globalThis.process` and `global.process` with b only), and three existing rows whose rules the restated (b) and the new (d) change: `process.chdir(at)` is now a and b (chdir is not one of the ten), `Reflect.set(process.env, 'X', v)` now c and d, `globalThis.process.env.X = v` now b and d. The six new passing rows pass already; the source pin and the session-token row pass.

GREEN, d47fd254: `childEnv` drops a variable whose upper-cased name is `NODE_OPTIONS`; rule (b) takes `PROCESS_PROPERTIES` (the ten names); rule (d) reports an identifier of `HIDDEN_ACCESS` (the five names) and a node of kind `ts.SyntaxKind.ThisKeyword` (in typescript.d.ts). The table holds 17 passing and 42 failing texts. `globalThis.process` and `global.process` expect b and d, not d alone as the rulings list them: `process` there is the name of a property access, not its object, so the restated (b) applies too.

Reverts, actual runs at d47fd254, each on a scratch copy of the test file (tests/surface/cli-cwd-paths.mut13.test.ts, removed after each run), the NODE_OPTIONS row and the three tests of acceptance 13 run:

| Mutation | Red (first message) |
|---|---|
| the list of ten widened to any property | the table (`process.chdir(at)`) |
| `valueOf` added to the list | the table (`const p = process.valueOf()`) |
| the `this` rule removed | the table (the `this` listener) |
| `eval`, `Function`, `globalThis`, `global`, `Reflect` each removed from (d), five runs | the table in each (`eval(...)`, `new Function(...)`, `globalThis.process.env.X = v`, `global.process`, `Reflect.set(...)`) |
| `NODE_OPTIONS` kept by `childEnv` | the NODE_OPTIONS row |
| the comparison of the variable name case-sensitive (`k === 'NODE_OPTIONS'`) | the NODE_OPTIONS row (`node_options` kept) |

10 runs, 10 red. The 11 reverts of acceptance 13 of the previous round, rerun on the moved code: 11 red, with the tests and first messages of the earlier table, except "rule (b) removed", whose first message is now `process.chdir(at)`.

| Item | Test or command | Result |
|---|---|---|
| DoD | `dod_command` as given, at d47fd254 (the next commit changes only this card file) | exit 0: typecheck clean; 258 tests, 252 pass, 0 fail, 6 skipped (the same six as above), 18 suites |

Changed lines, `git diff --shortstat origin/main...HEAD` with this file: 1468 changed lines (1457 added, 11 removed) against the budget of 1540: tests/surface/cli-cwd-paths.test.ts 849, this card 526, src/cli/main.ts 89, docs/OPERATIONS.md 2, CHANGELOG.md 2.

### Second repair round, after the second pre-review
Measured: the implementer's runs on a Windows host (Node v22.23.1), on the commits named. The merge 9a6e69ed brings main at 29ea7758; the only conflict was this file, resolved as in the first round.

RED, 5c86bdcf (the test file alone; it adds the empty file `GIT_CONFIG` in a `tempDir` directory, removed by the `after` hook): the six tests of the child environment and acceptance 13 run, 4 fail. The unit row of `childEnv` (now with `NODE_DEBUG`, `node_path`, `NODE_V8_COVERAGE` in the source, and `GIT_CONFIG_NOSYSTEM` and `GIT_CONFIG_GLOBAL` in the result) is red; the new behaviour row is red: with `NODE_DEBUG: 'module'` the refusal's stderr gains `MODULE <pid>: load built-in module fs` and the following lines; the child-environment test of attempt 5 is red, since its expected dump of `GIT_` variables now holds the two git configuration variables (an existing assertion, changed by this ruling, compared as an object so the order of the dump does not count); the table is red at the 4 new failing rows of `process.once` (no violation). The new passing row (`if (o.all || o.cleanup) process.once('exit', () => sweepAfter(c))`) passes already; the first statement of main.ts was a passing row since the first repair round. The unit row's title now names the `NODE_` class and the git configuration.

GREEN, cf61a3fa: `childEnv` drops a variable whose upper-cased name starts with `NODE_`, and sets `GIT_CONFIG_NOSYSTEM` to `1` and `GIT_CONFIG_GLOBAL` to `GIT_CONFIG`; rule (b) reports `process.once` unless `isDiscardedCall` (the callee of a call that is the `expression` of an `ExpressionStatement`, `ts.isExpressionStatement` in typescript.d.ts). The whole file at cf61a3fa: 25 tests, 22 pass, 0 fail, 3 skipped (the three of this host): every `git init` of the fixtures and every git call of the CLI children works with no system and an empty global configuration; no fixture commits, so none needs a user name.

Reverts, actual runs at cf61a3fa, each on a scratch copy of the test file (removed after each run), the three child-environment tests and the three tests of acceptance 13 run:

| Mutation | Red |
|---|---|
| `process.once` allowed in any position | the table (`process.once('beforeExit', () => {}).env.X = 'v'`) |
| `process.once` allowed as any call | the table (the same row) |
| the `NODE_` prefix narrowed to `NODE_OPTIONS` | the unit row and the `NODE_DEBUG` row |
| the prefix compared case-sensitively (`k.startsWith('NODE_')`) | the unit row |
| `GIT_CONFIG_NOSYSTEM` not set | the unit row and the child-environment test |
| `GIT_CONFIG_GLOBAL` not set | the unit row and the child-environment test |

6 runs, 6 red. Rerun on the moved code, the 19 earlier reverts of the guard (the 11 of the first round and the 8 of rule (b) and (d) of the second; its two `NODE_OPTIONS` rows are replaced by the prefix rows above): 19 red, with the first messages of the earlier tables.

| Item | Test or command | Result |
|---|---|---|
| DoD | `dod_command` as given, at cf61a3fa (the next commit changes only this card file) | exit 0: typecheck clean; 259 tests, 253 pass, 0 fail, 6 skipped (the same six as above), 18 suites |

Changed lines, `git diff --shortstat origin/main...HEAD` with this file: 1531 changed lines (1520 added, 11 removed) against the budget of 1620: tests/surface/cli-cwd-paths.test.ts 876, this card 562, src/cli/main.ts 89, docs/OPERATIONS.md 2, CHANGELOG.md 2.

### Third repair round, after the third pre-review
Measured: the implementer's runs on a Windows host (Node v22.23.1), on the commits named. The merge e152f6cd brings main at 9a1b8fea; the only conflict was this file, resolved as before.

RED, b81afdda (the test file alone): the table is red at the 7 new failing rows (`process.env.__proto__ || {}`, `process.env['__proto__'] || {}`, `process.env.constructor === Object`, `process.env.valueOf === f`, `process.env[k] === '1'`, the template key with a substitution, `process.env.lower === '1'`), each with no violation; the 3 new passing rows pass already; the source pin and the session-token row pass.

GREEN, 07cd849a: the second shape of rule (c) takes the name of the access (`variableName`: the property name, or a string or substitution-free template key, else none) and requires it to match `ENV_NAME`, `/^[A-Z][A-Z0-9_]*$/`. The source pin stays green: main.ts reads `AIDLC_SESSION`, `CLAUDE_CODE_SESSION_ID` and `AIDLC_RUN_NO_SHIP` by string keys. The table holds 21 passing and 53 failing texts.

Reverts, actual runs at 07cd849a, each on a scratch copy of the test file (removed after each run), the three child-environment tests and the three tests of acceptance 13 run: the name pattern removed, red (the table, `process.env.__proto__ || {}`); the pattern widened to lower-case letters, red (`process.env.constructor === Object`); a key that is not a string literal accepted, red (`process.env[k] === '1'`). Rerun on the moved code, the 25 earlier reverts of the guard and the child environment: 25 red, with the first messages of the earlier tables.

| Item | Test or command | Result |
|---|---|---|
| DoD | `dod_command` as given, at 07cd849a (the next commit changes only this card file) | exit 0: typecheck clean; 259 tests, 253 pass, 0 fail, 6 skipped (the same six as above), 18 suites |

Changed lines, `git diff --shortstat origin/main...HEAD` with this file: 1579 changed lines (1568 added, 11 removed) against the budget of 1620: tests/surface/cli-cwd-paths.test.ts 899, this card 587, src/cli/main.ts 89, docs/OPERATIONS.md 2, CHANGELOG.md 2.

## Planner rulings on the disclosed deviations (coordinator, before R3)

The implementer disclosed five points where the card gave no rule or where it chose a form. The planner rules on each before the formal review; none is an edit the card forbids.

| Disclosed point | Ruling |
|---|---|
| The guard of acceptance 13 does not count a spread inside a destructuring target (`({ ...process.env } = o)`) as the first shape, since that writes into the environment; it is a failing row of the table. Rules (a) and (b) also read a template literal without substitutions as a string | Accepted. Both make the guard stricter than the card's words and follow their sense: the first shape is a spread in an object literal that is a value |
| The two lines "Coordinator verification:" of the predecessor's evidence are renamed "The predecessor's coordinator verification (...)" | Accepted. The coordinator's verification of this card is the block it appends below |
| The predecessor's evidence numbers the findings of its first formal decision F1 to F3 in one place, and the hygiene of this card names them F3 to F6; the evidence records both | Accepted as recorded. The numbers F3 to F8 are those of the loop's stored card run of the predecessor; the earlier numbers are the predecessor's own |
| Rows of the revert table were merged to keep the diff within the budget | Accepted. The budget is raised to 1480 by an amendment on main for the coordinator's blocks; the table keeps every row |
| The carried helper `childEnv` of the test file keeps `NODE_OPTIONS` and sets no state directory per child, where the implementer brief's standing check asks for both | Kept as carried. The tests of this file select the state directory per case, and several of them need `AIDLC_STATE_DIR` unset (acceptance 11 and the behaviour row of acceptance 13); the predecessor's four formal decisions raised nothing on it. The pre-review is asked to check that no test of the file depends on the caller's environment |

Three revert rows (5, 10 and 38) are green on Windows because their cases exist on POSIX only; they were red in the predecessor's Linux run at 516d8739, and the coordinator's Linux run of this card's test file is recorded below.

## Planner rulings on the points disclosed in the repair round (coordinator, before R3)

The implementer disclosed three points in the repair round; the planner rules on each before the formal review.

| Disclosed point | Ruling |
|---|---|
| `globalThis.process` and `global.process` are expected to break rules (b) and (d), where the rulings section lists them under (d) alone: in both, `process` is the name accessed and not the object of an access | Accepted. A row reports every rule the text breaks; the rulings section named the rule each row was added for |
| Three rows of the first table report one more rule under the restated rules: `process.chdir(at)` breaks (a) and (b), since `chdir` is not one of the ten names; `Reflect.set(process.env, 'X', v)` breaks (c) and (d); `globalThis.process.env.X = v` breaks (b) and (d) | Accepted. The table section of this card was written before rules (b) and (d) changed; where it and the test differ in the rules a row names, the test follows the rules as they now read |
| A `this` expression is found by its node kind (`ts.SyntaxKind.ThisKeyword`), there being no public helper function for it | Accepted. The node kind is public API |

## Planner rulings on the points disclosed in the second repair round (coordinator, before R3)

The implementer disclosed three changes to existing test lines in the second repair round; the planner rules on each before the formal review.

| Disclosed point | Ruling |
|---|---|
| The carried test of the child environment (the dump of the `GIT_` variables a child sees) now expects `GIT_CONFIG_NOSYSTEM` and `GIT_CONFIG_GLOBAL` beside `GIT_CEILING_DIRECTORIES`, compared as an object | Accepted. The ruling sets both variables for every child, so the carried expectation of one variable could not hold; the test still proves that no `GIT_` variable of the caller reaches a child |
| The unit row of the helper is renamed to say what it now checks (no `NODE_` variable of the test process in any letter case, no system or global git configuration) | Accepted |
| One passing row was added for `process.once` (the `if` without braces); the other statement of main.ts has been a passing row since the first repair round | Accepted. Both statements of main.ts are rows |
