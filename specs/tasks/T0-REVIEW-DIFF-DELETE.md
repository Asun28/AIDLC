---
id: T0-REVIEW-DIFF-DELETE
title: "The R2 and R3 review diff shows a deleted file by its header only (git diff --irreversible-delete)"
status: merged
branch: T0-REVIEW-DIFF-DELETE
allow_paths:
  - src/review/pre-review.ts
  - tests/surface/review-diff-delete.test.ts
  - tests/scenarios/pre-existing.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T0-REVIEW-DIFF-DELETE.md
  - specs/tasks/T0-REVIEW-DIFF-DELETE.md
dod_command: npm run typecheck && node --test tests/surface/review-diff-delete.test.ts tests/scenarios/pre-existing.test.ts tests/surface/pre-review.test.ts tests/core/review-effort.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `collectCandidateDiff` (`src/review/pre-review.ts`) shall collect the diff it returns with `git diff --text <range> --no-color --no-ext-diff --no-textconv --irreversible-delete`, the option appended last, so a file the candidate deletes appears as its `diff --git`, `deleted file mode` and `index` lines with no hunk; a file the candidate adds, changes or renames keeps its hunks as on main. The `--name-only -z --no-renames` call is unchanged, so `changedPaths` still lists every deleted path.
  - R2. The size check (`maxDiffBytes`), the effort line count (`countDiffLines`) and every caller of `collectCandidateDiff` (R2 rounds, R3 decisions, the delta since the last reviewed candidate, the ship bindings and the review bench) shall read that diff as collected; no caller adds a deleted file's content back.
  - R3. `docs/OPERATIONS.md`, Review inputs paragraph, after "a diff is never cut.", shall state R1 and its two effects in one or two sentences: deleted content counts toward neither the cap nor the effort line count, and the reviewer sees which files were removed but not what they held. One changelog fragment shall record it.
acceptance:
  - 1. `tests/surface/review-diff-delete.test.ts`, new file, on a temporary git repository (its own `core.autocrlf false`, `diff.renames false` and identity): the base commit holds `data/big.txt` (2000 lines) and `src/a.ts`; the candidate deletes `data/big.txt` and changes one line of `src/a.ts`. `collectCandidateDiff(runSync, repo, <base sha>, 4096, <candidate sha>)` returns without a throw; its diff holds `diff --git a/data/big.txt b/data/big.txt` and `deleted file mode`, no line of `big.txt`'s content and no `--- a/data/big.txt` line, and the `src/a.ts` hunk with its `-` and `+` lines; `changedPaths` equals `['data/big.txt', 'src/a.ts']`. The test also shows the case: the same `git diff --text` without the option exceeds 4096 bytes. RED on main (the call throws above the cap). [R1] [R2] [dod arm 2]
  - 2. Same file: `countDiffLines` of that diff counts the two changed lines of `src/a.ts` only; a candidate that adds a file and one that changes a file whose base holds a NUL byte show their hunks as on main (`+` lines present, no `Binary files` line). [R1] [R2] [dod arm 2]
  - 3. `tests/scenarios/pre-existing.test.ts`: only the expected text-diff argv string at its `git diff` call list changes, to end with `--irreversible-delete`; `tests/surface/pre-review.test.ts` and `tests/core/review-effort.test.ts` pass unchanged; `git diff origin/main --stat -- tests/` lists the new file and pre-existing.test.ts only. [R1] [dod arm 2]
  - 4. `docs/OPERATIONS.md` states R3 at the place it names (reviewer-verified against the diff); `changelog.d/T0-REVIEW-DIFF-DELETE.md` holds one line in the form of `changelog.d/README.md`. [R3] [dod arm 2]
  - 5. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 120
tdd: true
sweep: "On main at a581663d `collectCandidateDiff` (`src/review/pre-review.ts:1000-1015`) runs `git diff --text <range> --no-color --no-ext-diff --no-textconv` and refuses the whole diff above `maxDiffBytes`. Its callers: `CardRunner.collectDelta` (`src/loop/card-runner.ts:587`), the R3 dispatch (`:2462`), the R2 round (`:3113`), the ship bindings (`:3276`) and the review bench (`src/review/bench.ts:409`); the effort count reads the same diff (`src/core/review-effort.ts:34`, `:51`). The mutant sweep collects its own diff (`src/review/mutants.ts:36`) and is out of scope. Issue 517: CHORD card T1-CORPUS-OUT-OF-REPO deleted 133 corpus files, a 12.6 MB diff (127,256 deleted lines) that R3 refused under any usable cap; with `-D` it is 39 KB. The owner accepted both effects on 2026-11-27 in session (the cap and the effort count stop counting deleted content; the reviewer no longer reads a deleted file's content). Argv pins (lessons T1-GOAL-OWED, T0-HOOK-FAIL-CLOSED): `tests/scenarios/pre-existing.test.ts:184` deep-equals the text-diff argv; `tests/surface/pre-review.test.ts:335-339` checks `includes` of single options and passes; scripted runners match keys by prefix (`src/probes/exec.ts`), so appending the option last keeps every scripted `git diff --text ...` key matching. Doc pins: no test reads the Review inputs sentence that R3 extends."
forbid: [network]
non_goals:
  - "the scope gate, the card budget gate and the mutant sweep, which read their own git output"
  - "a prompt line telling the reviewer that deleted bodies are left out (the diff header already says `deleted file mode`)"
  - "renames: with git's rename detection a moved file is a rename and keeps its similarity header as on main"
hygiene: "From issue 517, owner decision of 2026-11-27 in session. RED first: acceptance 1 on main. The test repository lives in a temporary directory and sets its own git config, so the user's git settings never change the diff."
---

# T0-REVIEW-DIFF-DELETE

From issue 517.

## Why
R2 and R3 send the whole candidate diff and refuse it above the cap. A card that deletes tracked data files sends every deleted line, so CHORD's T1-CORPUS-OUT-OF-REPO (133 deleted files, 12.6 MB) could not be reviewed under any usable cap and was reviewed by hand.

## Deliverable
`collectCandidateDiff` adds `--irreversible-delete` to its diff call. A test on a temporary repository, one changed argv pin, a docs sentence and a changelog line.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/review-diff-delete.test.ts tests/scenarios/pre-existing.test.ts tests/surface/pre-review.test.ts tests/core/review-effort.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: a deleted file reaches the reviewer as its header only and costs no bytes of its content; every other file keeps its hunks.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|

## PR summary

### What
The R2 and R3 review diff shows a deleted file by its header only.

### Why / Intent
A card that deleted 133 data files made a 12.6 MB diff, which R3 refused under any usable cap (issue 517).

### How / Behaviour
`collectCandidateDiff` runs `git diff` with `--irreversible-delete`. A deleted file keeps its `diff --git` and `deleted file mode` lines and loses its body.

### System impact
The size cap and the effort line count no longer count deleted lines. Added, changed and renamed files keep their hunks.

### Security
The reviewer sees which files were removed but not what they held. The owner accepted this on 2026-11-27.

### Tests and review
A new test builds a temporary repository with a large deleted file and checks the diff, the cap and the line count. One argv pin in pre-existing.test.ts changes.

### Risk
A review can no longer find a defect inside deleted content, such as a removed check. The file list still shows each deletion.

### Ownership
The aidlc maintainers own `src/review/`.

### Docs
docs/OPERATIONS.md, Review inputs, states the rule. A changelog fragment records it.
