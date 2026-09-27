---
id: T0-HOOK-CLASSIFIER
title: The Bash guards read a command as read-only only when it is a bare read-only name without a writing or executing form, and split a command at a lone ampersand and a line break (issue 120)
status: todo
branch: T0-HOOK-CLASSIFIER
worktree: D:\wt\AIDLC\T0-HOOK-CLASSIFIER
allow_paths:
  - src/hooks/index.ts
  - tests/surface/hooks.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-HOOK-CLASSIFIER.md
dod_command: npm run typecheck && node --test tests/surface/hooks.test.ts
dod_exit: 0
requirements:
  - R1. `mutatingSegments` shall split a command at `||`, `&&`, `;`, `|`, a lone `&` and a line break (`\n`, `\r\n`, `\r`), where a lone `&` is one neither preceded by `<`, `>`, `&` or `|` nor followed by `>` or `&`, so `2>&1`, `>&2`, `&>`, `&>>` and `&&` split as before.
  - R2. A segment shall be read-only only when its first word, after a `sudo`, `time` or `env` prefix, is a bare name without a path separator on the read-only lists and the segment carries no executing form of that command. The executing forms (production-gate) are the awk forms `system(`, `print |`, `printf |` and `| getline`, found anywhere in a command line that holds an awk segment; the find actions `-exec`, `-execdir`, `-ok` and `-okdir`; the sed `e` command and the `e` flag of an `s` command; the rg option `--pre`; the git grep options `-O` and `--open-files-in-pager`; git branch with `-d`, `-D`, `--delete`, `-m`, `-M`, `--move`, `-c`, `-C`, `--copy`, `-f`, `--force`, `-u`, `--set-upstream-to`, `--unset-upstream`, `--edit-description`, `-t`, `--track` or `--no-track`, or with a branch name outside `--list` or `-l` (a name after `--contains`, `--no-contains`, `--merged`, `--no-merged`, `--points-at`, `--format` or `--sort` is that option's value); git remote with anything but nothing, `-v`, `--verbose`, `show` or `get-url`; git worktree with anything but `list`.
  - R3. `protect-paths` shall read as a write, beside `WRITE_VERBS`, the file-writing forms of a segment, and deny a command that references a frozen path and carries one; they are the sed options `-i` (also combined, as `-ni` or `-i.bak`) and `--in-place` and the sed `w` and `W` commands and the `w` flag of an `s` command; the awk option `-i inplace` anywhere in the segment (`print >` and `printf >` are writes through `>` already); the find actions `-delete`, `-fprint`, `-fprint0`, `-fprintf` and `-fls`; sort `-o` and `--output`; uniq with an output file operand (a second operand after the options, `-f`, `-s` and `-w` taking a value); tree `-o`; yq `-i` and `--inplace`; git log, diff and show with `--output`; git worktree `add`, `remove`, `move` and `prune`. A file-writing form never makes a segment mutating for `production-gate`, so an in-place edit of a file whose text names a release never asks for a release authorization.
  - R4. Each form shall add a denial and none shall remove one; a command without any listed form and without a lone ampersand or a line break shall be classified as before.
  - R5. `docs/OPERATIONS.md` (Hooks) and the CHANGELOG Unreleased section, as a change to behaviour under a valid config, shall state R1 to R3.
acceptance:
  - 1. `tests/surface/hooks.test.ts` pins the split of R1 with `mutatingSegments` directly, one segment each for `make deploy 2>&1 production`, `make deploy >&2 production`, `make deploy &> log production` and `make deploy &>> log production`, two for `make a && make b`, and the tail after a lone ampersand, a line break and a carriage return with a line break as its own segment. [R1] [dod arm 1]
  - 2. The same file, a table with one row per form of R2 and per separator and per path-qualified first word (a POSIX path and a Windows path with `.exe`), each giving exit 2 from `production-gate` with the default patterns when the segment names a release and passing without one, and a row per read-only use the forms leave read-only (plain awk, sed, find, rg, git grep, git branch listing, git remote show, git worktree list) passing although its text names a release. [R2] [R4] [dod arm 1]
  - 3. The same file, a table with one row per form of R3, each denied by `protect-paths` with the `FROZEN` text when the command references a frozen path, deferred when the same command lacks the form, and passing without a frozen path; `sed -i 's/production/prod/' deploy.yaml` passes `production-gate`. [R3] [R4] [dod arm 1]
  - 4. The same file, every existing test of the valid path holds unchanged; the oracle of T0-HOOK-CONFIG-CLOSED-3 acceptance 2 and the valid-config test of T0-HOOK-CONFIG-NONSTRING acceptance 3 follow the new classifier on both sides, since both rebuild main's decision from the current guard functions. [R4] [dod arm 1]
  - 5. The same file reads the paragraph this card adds to the Hooks section of `docs/OPERATIONS.md` and its CHANGELOG Unreleased entry. [R5] [dod arm 1]
depends_on: []
budget: 520
tdd: true
diagnosis:
  root_cause: "mutatingSegments (src/hooks/index.ts) read a segment as read-only from its first word alone, after stripping any path from it, and split only at ||, &&, ; and |, and protectPaths read a write only from WRITE_VERBS, so commands that run other commands or change files and repository state passed both guards under every config (issue 120 lists them); a lone & or a line break hid a second command behind a read-only first word."
  same_class: "Every decision the Bash guards take from command text goes through mutatingSegments (production-gate) or WRITE_VERBS and the new write forms (protect-paths); secretsGuard reads content and file paths, not the classifier. Under a broken config the doctor list and the legacy decision of T0-HOOK-CONFIG-CLOSED-3 decide, the legacy decision through these same guard functions, so a broken config still denies at least what a valid one does. The PowerShell tool and its segment forms are issue 117, held for the user. Quote-aware splitting (a separator inside quotes) stays out; every split this card adds only adds segments, so it can add a denial and never remove one."
sweep: "grep -n 'mutatingSegments\\|WRITE_VERBS\\|READ_ONLY_TOOLS\\|READ_ONLY_GIT' src/hooks/index.ts lists every reader of the classifier; the test tables hold one row per form listed in R1 to R3, and the mutation sweep removes each form in turn."
forbid: [removing any denial the guards make today, quote-aware splitting, reading PowerShell forms (issue 117), changing config.ts, changing the broken-config rules of T0-HOOK-CONFIG-CLOSED-3 and T0-HOOK-CONFIG-NONSTRING]
non_goals: ["the PowerShell tool outside the guards: issue 117, held for the user", "config discovery above cwd: issue 118", "a separator inside quotes, which still splits"]
hygiene: "Issue 120, ruling of aidlc-37 on the user's delegation of 2026-09-27T09:20Z: the executing forms and the git branch, remote and worktree forms go to production-gate, the file-writing forms to protect-paths only. The separator pins of R1 are a condition of that ruling. Before R3, the hand-run Codex check answers two questions for this card, which changes valid-config behaviour on purpose; does any change remove a denial main makes (valid or broken config), no; is every added denial one of the forms listed here, yes. A mutation sweep per form before the first review, --goal on every command. The oracle of T0-HOOK-CONFIG-CLOSED-3 and the valid-config test of T0-HOOK-CONFIG-NONSTRING rebuild main's decision from the current guard functions, so they follow the new classifier on both sides. First ruling (aidlc-37 under the user's delegation of 2026-09-27T09:20Z): the hand-run Codex pre-check on the bound candidate 267486f failed its bar: F1 changes the decision main makes under a broken config with an invalid pattern (the -3 config deny instead of main's exit 2), and F2 adds a denial not in the card's list (a redirect `>&` read as a command start). R2 round 3 cannot reopen the episode (onExhausted ship), so no R3 decision is spent on a known defect: first successor T0-HOOK-CLASSIFIER-2 carries 267486f plus both fixes; goal g-20260927163512-90c843 cancelled with this text. Second ruling (the same session): R2 round 3 on 267486f found four more parser edges in the awk program and sed script reading, the fourth round of such edges, so T0-HOOK-CLASSIFIER-2 is narrowed to the option and subcommand forms read from a segment's own words, and the awk and sed program forms with every edge input go to issue 135."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
superseded_by: T0-HOOK-CLASSIFIER-2
---

# T0-HOOK-CLASSIFIER

## Deliverable
A command that runs another command, changes repository state or writes a file is no longer read as read-only because of its first word, and a second command after a lone ampersand or a line break is read as a command.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/hooks.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
