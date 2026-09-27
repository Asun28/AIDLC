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
  - R1. `mutatingSegments` shall split a command at `||`, `&&`, `;`, `|`, a lone `&` and a line break (`\n`, `\r\n`, `\r`), where a lone `&` is one neither preceded by `<`, `>`, `&` or `|` nor followed by `>` or `&`, so `2>&1`, `>&2`, `&>`, `&>>` and `&&` split as before. `production-gate` shall test the mutating segments of this split and of the split before this card (at `||`, `&&`, `;` and `|` only), so a release phrase the gate matched in one segment before, such as `make deploy & echo production`, is still matched, and splitting never removes a denial.
  - R2. A segment shall be read-only only when its first word, after a `sudo`, `time` or `env` prefix, is a bare name without a path separator on the read-only lists and the segment carries no executing form of that command. The executing forms (production-gate) are the awk forms `system(`, `print |`, `printf |` and `| getline`, found in the program text of an awk command of the line (its first operand, read with its quotes, never the shell line around it); the find actions `-exec`, `-execdir`, `-ok` and `-okdir`; the sed `e` command and the `e` flag of an `s` command, read in the scripts of the sed commands of the line (each `-e` or `--expression` value, else the first operand, with its quotes; never a file operand), a line number, `$` or a /regex/ address allowed before the command letter; the rg option `--pre`; the git grep options `-O` and `--open-files-in-pager`; git branch with `-d`, `-D`, `--delete`, `-m`, `-M`, `--move`, `-c`, `-C`, `--copy`, `-f`, `--force`, `-u`, `--set-upstream-to`, `--unset-upstream`, `--edit-description`, `-t`, `--track` or `--no-track`, or with a branch name outside `--list` or `-l` (a name after `--contains`, `--no-contains`, `--merged`, `--no-merged`, `--points-at`, `--format` or `--sort` is that option's value); git remote with anything but nothing, `-v`, `--verbose`, `show` or `get-url`; git worktree with anything but `list`.
  - R3. `protect-paths` shall read as a write, beside `WRITE_VERBS`, the file-writing forms of a segment, and deny a command that references a frozen path and carries one; they are the sed options `-i` (also combined, as `-ni` or `-i.bak`) and `--in-place` and the sed `w` and `W` commands and the `w` flag of an `s` command, read in the sed scripts as the `e` forms are; the awk option `-i inplace` anywhere in the segment (`print >` and `printf >` are writes through `>` already); the find actions `-delete`, `-fprint`, `-fprint0`, `-fprintf` and `-fls`; sort `-o` and `--output`; uniq with an output file operand (a second operand after the options, `-f`, `-s`, `-w`, `--skip-fields`, `--skip-chars` and `--check-chars` taking a separate value); tree `-o`; yq `-i` and `--inplace`; git log, diff and show with `--output`; git worktree `add`, `remove`, `move` and `prune`. A file-writing form never makes a segment mutating for `production-gate`, so an in-place edit of a file whose text names a release never asks for a release authorization.
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
  same_class: "Every decision the Bash guards take from command text goes through mutatingSegments (production-gate) or WRITE_VERBS and the new write forms (protect-paths); secretsGuard reads content and file paths, not the classifier. Under a broken config the doctor list and the legacy decision of T0-HOOK-CONFIG-CLOSED-3 decide, the legacy decision through these same guard functions, so a broken config still denies at least what a valid one does. The PowerShell tool and its segment forms are issue 117, held for the user. Quote-aware splitting (a separator inside quotes) stays out. A new split point can separate the two halves of a release phrase that one segment held before (`make deploy & echo production`), so production-gate also tests the segments of the split before this card; for the same text the classification marks at least what it marked before, so the tested set holds every segment main tested (the hand-run Codex pre-check of 9596a37 found the case)."
sweep: "grep -n 'mutatingSegments\\|WRITE_VERBS\\|READ_ONLY_TOOLS\\|READ_ONLY_GIT' src/hooks/index.ts lists every reader of the classifier; the test tables hold one row per form listed in R1 to R3, and the mutation sweep removes each form in turn."
forbid: [removing any denial the guards make today, quote-aware splitting, reading PowerShell forms (issue 117), changing config.ts, changing the broken-config rules of T0-HOOK-CONFIG-CLOSED-3 and T0-HOOK-CONFIG-NONSTRING]
non_goals: ["the PowerShell tool outside the guards: issue 117, held for the user", "config discovery above cwd: issue 118", "a separator inside quotes, which still splits"]
hygiene: "Issue 120, ruling of aidlc-37 on the user's delegation of 2026-09-27T09:20Z: the executing forms and the git branch, remote and worktree forms go to production-gate, the file-writing forms to protect-paths only. The separator pins of R1 are a condition of that ruling. Before R3, the hand-run Codex check answers two questions for this card, which changes valid-config behaviour on purpose; does any change remove a denial main makes (valid or broken config), no; is every added denial one of the forms listed here, yes. A mutation sweep per form before the first review, --goal on every command. The oracle of T0-HOOK-CONFIG-CLOSED-3 and the valid-config test of T0-HOOK-CONFIG-NONSTRING rebuild main's decision from the current guard functions, so they follow the new classifier on both sides. On 9596a37 the Codex pre-check answered Q1 yes (the new split removed the denial of `make deploy & echo production` and of the same with a carriage return), and R2 round 1 blocked on a read-only row holding `&&` inside its quotes; the repair tests both splits in production-gate, pins the release phrases, replaces the row, and reads the separate value of the uniq long options. R2 round 2 then blocked 0e69b5b on the awk pipe form matched in the shell line after an awk program and the sed `e`, `w` and `W` matched in file operands; the repair reads the awk program and the sed scripts from the words of each command, allows a sed address before the command letter (the round's advisory), and adds the union sentence to the OPERATIONS paragraph and the CHANGELOG entry (the round 2 advisory of the no-verdict run)."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
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
