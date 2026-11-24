---
id: T0-INIT-CLI-PATH
title: "aidlc init prints the node command to run when aidlc is not on PATH, and the aidlc-loop skill and the CLAUDE.md section say what to run in place of aidlc"
status: merged
branch: T0-INIT-CLI-PATH
worktree: D:\wt\AIDLC\T0-INIT-CLI-PATH
allow_paths:
  - src/scaffold/init.ts
  - src/cli/main.ts
  - tests/infra/init-cli-path.test.ts
  - .claude/skills/aidlc-loop/SKILL.md
  - templates/claude/skills/aidlc-loop/SKILL.md
  - CLAUDE.md
  - templates/CLAUDE.aidlc.md
  - docs/OPERATIONS.md
  - README.md
  - changelog.d/T0-INIT-CLI-PATH.md
  - specs/tasks/T0-INIT-CLI-PATH.md
dod_command: npm run typecheck && node --test tests/infra/init-cli-path.test.ts tests/infra/init.test.ts tests/surface/init-no-package.test.ts tests/surface/cli-cwd-paths.test.ts tests/surface/templates.test.ts tests/surface/coordinator-effort.test.ts tests/surface/mirror.test.ts tests/surface/claude-md-size.test.ts tests/surface/command-lines.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts tests/surface/test-temp.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `src/scaffold/init.ts` shall export `aidlcOnPath(env = process.env, platform = process.platform, isFile = <a stat that returns true only for a regular file>)`, which returns true when a directory listed in the PATH value holds a file named `aidlc` (on `win32`: `aidlc` followed by one of the PATHEXT extensions, compared without case, default `.COM;.EXE;.BAT;.CMD`), and false otherwise.
  - R2. `aidlcOnPath` shall read the PATH value from the key `PATH`, on `win32` from the first key equal to `PATH` without case (`Path`), and PATHEXT the same way; split it by `;` on `win32` and `:` elsewhere; skip empty entries, so an empty entry is never read as the current directory; and on `win32` strip one pair of double quotes around an entry. An absent or empty PATH value gives false.
  - R3. `src/scaffold/init.ts` shall export `initCli(entry, onPath)`, which returns `{ onPath: true, command: 'aidlc' }` when `onPath` is true; otherwise, when `<entry>` holds none of `$`, a backtick, `%` and `"` (the characters `resolveHookCommand` refuses), `{ onPath: false, command: 'node "<entry>"', note: 'aidlc is not on PATH: run each aidlc command as node "<entry>" <command>, or run npm link in "<checkout>" to put aidlc on PATH' }`, where `<entry>` is `entry` with backslashes turned into forward slashes and `<checkout>` is the directory two levels above it, written the same way; otherwise (owner ruling on R3 decision 1 F2) `{ onPath: false, note: 'aidlc is not on PATH, and the path of this CLI holds $, a backtick, % or a double quote, which a shell can expand or end a quote at, so no command is printed: run node with bin/aidlc.js under the aidlc checkout at <checkout>, quoted for your shell, or run npm link in that checkout to put aidlc on PATH' }`, with no `command` field.
  - R4. The `init` action of `src/cli/main.ts` shall pass the absolute path of the running CLI's `bin/aidlc.js` and `aidlcOnPath()` to `initCli`, print the result as the field `cli` of the JSON report, and in text print the `note` line, when there is one, before the `next` line that `initNextLine(cli)`, exported by `src/scaffold/init.ts`, returns: ``next: review aidlc.config.json, then `<command> doctor` `` when `cli` has a `command`, and otherwise (owner ruling on R3 decision 1 F3) `next: review aidlc.config.json, then run doctor through node as the line above says`, with no backtick.
  - R5. Entry check 1 of both identical `aidlc-loop/SKILL.md` copies shall say: No `aidlc` on PATH => `node <aidlc checkout>/bin/aidlc.js` instead. To stay within the 4500-byte cap, the copies drop `Carry approval forward;` (the next sentence says the same), the duplicate `Explicit target only.` of the Modules list (the Route list states it) and `Concise` before `progress`.
  - R6. The Commands list of the CLAUDE.md section, in both `CLAUDE.md` and `templates/CLAUDE.aidlc.md`, shall end with the line: - No `aidlc` on PATH: run `node <aidlc checkout>/bin/aidlc.js` in its place, or `npm link` in that checkout; `aidlc init` prints the path. `docs/OPERATIONS.md` (Setup), `README.md` (Quick start) and `changelog.d/T0-INIT-CLI-PATH.md` shall state the init output of R3 and R4.
acceptance:
  - 1. `tests/infra/init-cli-path.test.ts`, unit. With an injected env and `isFile`: `win32` finds `aidlc.cmd` and `AIDLC.CMD` in the second entry of `Path` (mixed-case key), finds `aidlc.ps1` only when PATHEXT lists `.PS1`, does not find a bare `aidlc` there, and reads a quoted entry; `linux` finds `aidlc` in the second entry and does not find `aidlc.cmd`; an absent PATH, an empty PATH and a PATH of empty entries (`::`, `;;`) give false and call `isFile` with no path relative to the current directory. RED: the export does not exist on main. [R1] [R2] [dod arm 2]
  - 2. Same file, unit. `initCli` returns the first two shapes of R3 exactly (deepEqual) for a Windows entry `C:\x\aidlc\bin\aidlc.js`, a POSIX entry and an entry under `C:\Program Files (x86)\a b` (a space and parentheses keep the command). [R3] [dod arm 2]
  - 3. Same file, real process. `node src/cli/main.ts init <temp dir> --json` with PATH (any case of the key removed first) set to an empty temp directory prints `cli` equal to `initCli(<repository>/bin/aidlc.js, false)`; with PATH set to a temp directory holding `aidlc.cmd` on Windows, `aidlc` elsewhere, `cli` is `{ onPath: true, command: 'aidlc' }`. RED on main: no `cli` field. [R4] [dod arm 2]
  - 4. Same file, text. Both SKILL.md copies are identical, ASCII and at most 4500 bytes, and entry check 1, whitespace collapsed, holds the sentence of R5; both CLAUDE.md copies hold the line of R6 as the last item of the Commands list. Neither text is on main. [R5] [R6] [dod arm 2]
  - 5. The existing init, template, mirror, size, command-line, changelog and prose tests pass with no change; the use of `initNextLine` in the text output of R4, the cuts of R5 and the doc text of R6 are reviewer-verified against the diff. [R4] [R5] [R6] [dod arms 1, 3-12]
  - 6. Same file, unit. For an entry holding `$`, a backtick, `%` or `"`, each alone, with either separator, `initCli(entry, false)` deepEquals the third shape of R3, with no `command` key; `initCli(entry, true)` is still `{ onPath: true, command: 'aidlc' }`. `initNextLine` returns the backticked line for each command shape and the plain line, holding no backtick, for the third. RED on 47b3abf3: the special paths get the `node "<entry>"` command and `initNextLine` does not exist. [R3] [R4] [dod arm 2]
depends_on: []
budget: 200
tdd: true
sweep: "On main at faa0a4fd. `git grep -n 'next: review'`: only src/cli/main.ts:316, the init text output; no test pins it. `git grep -n -E \"'init'|init --json\" -- tests`: tests/infra/init.test.ts:209 and tests/surface/cli-cwd-paths.test.ts read named fields of the init report, so a new `cli` field leaves them as they are. `git grep -n 'npx --no-install aidlc\\|npm link'`: the workflows, the hook command of init (src/scaffold/init.ts:194, resolved per target since T1-INIT-HOOK-PATH) and the release-specialist tools; none is a command a session types. SKILL.md is 4479 of 4500 bytes; entry check 1 is pinned by templates.test.ts:253-283 from `\\n1. `aidlc doctor`` to `\\n2. `, and the Effort section by coordinator-effort.test.ts; the three cuts of R5 are outside every pinned text."
forbid: [network, a change to an existing test file]
non_goals:
  - "a doctor line for PATH: a session that can run doctor already has a working command, and the issue asks for the entry check instead"
  - "the execute bit on POSIX: a file named `aidlc` on PATH counts, as a shell would try it"
  - "rewriting the `aidlc ...` commands of the skills and CLAUDE.md to the node form: they stay the canonical spelling, with the one fallback line"
  - "`npx --no-install aidlc` in the workflows and the release-specialist tools, which run where the package is installed"
diagnosis:
  root_cause: "Nothing in setup puts `aidlc` on PATH: `aidlc init` runs from a checkout through `node bin/aidlc.js` and prints `next: ... aidlc doctor`, and the skill and the CLAUDE.md section use the bare `aidlc`, so on a machine with no `npm link` or global install every command fails as written and no text says what to run instead (issue 451)."
  same_class: "The hook command had the same gap and was fixed per target by T1-INIT-HOOK-PATH (an absolute node path); the doctor guard allowance in src/hooks/index.ts:266 already lists the node forms."
hygiene: "Issue 451. The real-process test sets PATH to a temp directory and spawns node by `process.execPath`, so it does not depend on the machine's PATH or on an installed aidlc."
doc_sync: docs/OPERATIONS.md, README.md, changelog.d/T0-INIT-CLI-PATH.md
---

# T0-INIT-CLI-PATH

From issue 451.

## Diagnosis
`aidlc` is not on PATH after setup, so `aidlc ...` in the skill and the CLAUDE.md section fails, and `npx --no-install aidlc` fails where no package is installed. Nothing says to run `node <checkout>/bin/aidlc.js`.

## Deliverable
`aidlc init` checks PATH for `aidlc`; when it is absent, it prints the `node "<path>/bin/aidlc.js"` command and the `npm link` alternative, and its `next` line uses that command. Entry check 1 of the skill and the CLAUDE.md section say what to run in place of `aidlc`.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/init-cli-path.test.ts tests/infra/init.test.ts tests/surface/init-no-package.test.ts tests/surface/cli-cwd-paths.test.ts tests/surface/templates.test.ts tests/surface/coordinator-effort.test.ts tests/surface/mirror.test.ts tests/surface/claude-md-size.test.ts tests/surface/command-lines.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts tests/surface/test-temp.test.ts
```
- Expected exit code: 0
- Assertion: the new tests pass and the existing init, template, mirror, size, command-line, changelog and prose tests pass unchanged.

## PR summary
### What
`aidlc init` checks whether `aidlc` is on PATH. When it is not, init prints the `node "<path>/bin/aidlc.js"` command and the `npm link` alternative.

### Why / Intent
Setup does not put `aidlc` on PATH. The commands in the skill and in CLAUDE.md failed as written (issue 451).

### How / Behaviour
The init report gains a `cli` field, and the `next` line names the command that works. A path with `$`, a backtick, `%` or `"` gets a plain-text note and no command.

### System impact
Only `aidlc init` output changes. Entry check 1 of the skill and the CLAUDE.md section get one fallback line each. Three redundant phrases leave SKILL.md to stay under its 4500-byte cap.

### Security
The check reads PATH and PATHEXT and looks for files. It starts no process, and it skips empty PATH entries.

### Tests and review
The new test file covers the PATH rules, the output shapes and a real `init` run. R3 blocked decisions 1 to 4. The owner amended R3, R4 and the DoD, and admitted decision 5.

### Risk
Low. A wrong PATH result changes only the printed hint. Other special characters, such as `&`, keep the quoted command, as the owner ruled.

### Ownership
The aidlc maintainers own `src/scaffold/init.ts`.

### Docs
The change updates `docs/OPERATIONS.md`, `README.md` and the changelog fragment.

## Attempt evidence
| Item | Proof | Result |
|---|---|---|
| 1 | `tests/infra/init-cli-path.test.ts`, the three `aidlcOnPath` tests. RED at af753892: the file did not load, because the export does not exist. Repair of R3 decision 3: a fourth test covers a Path and a PATHEXT in non-enumerable keys, and two spellings of PATH (the first key in order counts); RED at 2f1abbae, where the lookup read enumerable keys only | pass |
| 2 | Same file, `acceptance 2: the command is aidlc ...` | pass |
| 3 | Same file, `acceptance 3: with no aidlc on PATH ...`, a real `node src/cli/main.ts init` run. With the `cli` field taken out of the report on the merged tree (48f54d7b), this test fails. Repair of R3 decision 3: `acceptance 3: the child environment replaces every spelling of PATH and PATHEXT ...` covers each input form of the copy: several spellings of PATH and PATHEXT, a non-enumerable one of each, another non-enumerable variable and one named `__proto__`. The copy opens no file and starts no process. Repair of R3 decision 4: the real run also starts from a machine environment with two spellings of `PATHEXT=.EXE;.PS1` and an `aidlc` on PATH; RED on Windows at 1df1e7b9, where that PATHEXT reached the child. The file passes with PATHEXT `.EXE;.PS1` and empty, an `aidlc` on PATH, HOME unset, spaces in TEMP, AIDLC_* set, and a working directory that holds an `aidlc`. A temporary directory whose path holds the PATH delimiter is not covered | pass |
| 4 | Same file, the two text tests. Both failed on the text of main once the exports existed | pass |
| 5 | The DoD: init, init-no-package, cli-cwd-paths, templates, coordinator-effort, mirror, claude-md-size, command-lines, changelog-fragments, prose, test-temp | pass; text reviewer-verified |
| 6 | Same file, `acceptance 6: ...`. RED at 9ae37009: the file did not load, because `initNextLine` did not exist. With the special-path rule disabled on the merged tree (48f54d7b), this test fails | pass |

Correction to the receipt of attempt 1: the full `npm test` run it names started before b3602601 was committed, and files changed while it ran. It is not evidence for that commit; the DoD run on b3602601 is.
