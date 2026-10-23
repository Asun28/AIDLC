---
id: T0-INIT-REVIEW-IGNORE
title: aidlc init adds .review/ to the target's .gitignore, so the verdicts and logs the loop writes into a card worktree no longer make the next review refuse the checkout as dirty
status: todo
branch: T0-INIT-REVIEW-IGNORE
worktree: D:\wt\AIDLC\T0-INIT-REVIEW-IGNORE
allow_paths:
  - src/scaffold/init.ts
  - tests/infra/init.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-INIT-REVIEW-IGNORE.md
dod_command: npm run typecheck && node --test tests/infra/init.test.ts
dod_exit: 0
requirements:
  - R1. `initProject` (src/scaffold/init.ts) shall leave the target's `.gitignore` carrying `.aidlc/`, `_local/` and `.review/`, appending only the entries the file lacks (an entry already present with or without its trailing slash counts as present), so a run on a file that has all three leaves it byte-identical and does not report `.gitignore` as merged.
  - R2. When files are written under `.review/` in a linked worktree of a git repository whose `.gitignore` `initProject` wrote and that was committed, `GitProbe.status` of that worktree shall report it clean (`dirty: false`, no entries, no untracked paths), so `aidlc review pre` and `aidlc review r3` no longer refuse the checkout for those files.
  - R3. `docs/OPERATIONS.md` shall name `.review/` among the `.gitignore` entries `init` writes (Setup, with one sentence on what the directory holds) and, under "Upgrading a downstream repository", state how an existing repository takes the entry: run `aidlc init` again, which appends only the missing `.review/`, then commit and push `.gitignore` on the base branch; a card worktree created before that commit keeps its old `.gitignore` until it merges the base, and a `.review/` line in the main checkout's `.git/info/exclude`, which every linked worktree reads, covers it meanwhile.
  - R4. The CHANGELOG Unreleased section shall carry an entry for T0-INIT-REVIEW-IGNORE (bugfix) naming the refusal it removes (`the review checkout ... has uncommitted or untracked changes (?? .review/...)`) and the upgrade step.
acceptance:
  - 1. `tests/infra/init.test.ts`: on an empty directory `initProject` writes a `.gitignore` whose lines include `.aidlc/`, `_local/` and `.review/` exactly once each; a second run leaves the file byte-identical and its report's `merged` does not include `.gitignore` (the existing assertion stays). [R1] [dod arm 2]
  - 2. The same file: a `.gitignore` holding a user line and exactly what an earlier init wrote (`# aidlc runtime state (never committed)`, `.aidlc/`, `_local/`) gains one `.review/` line, keeps the user line, `.aidlc/` and `_local/` once each, and the run reports `.gitignore` as merged; a further run leaves it byte-identical; a `.gitignore` that already lists `.aidlc/`, `_local/` and `.review` without the slash is left byte-identical and not reported as merged. [R1] [dod arm 2]
  - 3. The same file, in a real git repository (skipped by name when git is missing): after `initProject`, `git add -A` and a commit, a linked worktree made with `git worktree add` holding `.review/T1-X.json`, `.review/T1-X.pre.0.1.1.r1.json`, `.review/T1-X.pre.0.1.1.r1.log` and `.review/verdict.schema.json` has `new GitProbe().status(worktree)` deep-equal `{ dirty: false, entries: [], untracked: [] }` while the four files exist. [R2] [dod arm 2]
  - 4. The same file reads the exact sentences this card adds to `docs/OPERATIONS.md` (the Setup list and its sentence, the upgrade paragraph) and fails with any one removed. [R3] [dod arm 2]
  - 5. The same file reads the T0-INIT-REVIEW-IGNORE entry of the CHANGELOG Unreleased section and fails with it removed. [R4] [dod arm 2]
depends_on: []
budget: 160
tdd: true
diagnosis:
  root_cause: "`initProject` appends a fixed list to the target's `.gitignore` (src/scaffold/init.ts:102, `['.aidlc/', '_local/']`) that predates review artifacts and was never derived from the paths the loop writes into a checkout. T0-PRE-REVIEW (be15c66) started writing R2 verdicts and logs under `<review checkout>/.review/` and added `.review/` to this repository's own `.gitignore` (line 11) only, so every downstream repository runs with `.review/` untracked. `GitProbe.status` (src/probes/git.ts:93) runs `git status --porcelain=v1 --untracked-files=all` and counts an untracked file as dirty, and `refuseDirtyCandidate` (src/loop/card-runner.ts:277) refuses a review on a dirty checkout (R2 at :2063, R3 at :1465 and again right before dispatch at :1382). Reproduced in a scratch repository laid out by `initProject`, with a real linked card worktree and CardRunner driving scripted reviewers: R2 passed and wrote `.review/T1-RV.pre.0.1.1.26185515.json` and `.log`; the next `review r3` and `review pre` both refused with `the review checkout <worktree> has uncommitted or untracked changes (?? .review/T1-RV.pre.0.1.1.26185515.json, ?? .review/T1-RV.pre.0.1.1.26185515.log); commit them, record the attempt, then review`. With `.review/` appended to the same `.gitignore`, R3 ran and passed. Read from the code, not run: on a ship path other than dry-run, `recordAttempt` binds the candidate from `git status` of the worktree (card-runner.ts:880), so a `.review/` file present at the attempt records a dirty candidate (refusal `the candidate has uncommitted or untracked inputs (.review/...)`), and the GitHub ship path's `git add -A` (src/delivery/github-ship.ts:263) would commit the files into the card branch after the review, so HEAD no longer matches the verdict's sha."
  same_class: "Every path the loop, its ship paths or its hooks write inside a repository or worktree (git grep of writeFileSync, appendFileSync, mkdirSync, atomicWriteJson and atomicWriteText over src/): (1) `<main>/.aidlc/`, the state directory with the fix-task marker: init writes `.aidlc/`, handled. (2) `<main>/_local/aidlc-board.md`, the board mirror (src/cli/main.ts:70): init writes `_local/`, handled. (3) `<review checkout>/.review/` (the card worktree, or the main checkout for a run without one): R2 verdicts and logs (src/review/pre-review.ts:780-791, 1027), `verdict.schema.json` (:183), the R2 and R3 `.failed.json` (card-runner.ts:2140, 1586), the R3 `.reservation.json` (:1553), `.result.json` (:1696) and canonical `<card>.json` with its atomic temp file (:1633), and the `.red` receipt and `.rounds` file the scaffold's task.ps1 writes and ScaffoldShipPath reads (src/delivery/ship.ts:269-288): not handled, this card adds `.review/`. (4) `<main>/.git/scaffold-merged/<card>` (github-ship.ts:561-568): inside `.git`, never in a status. (5) `docs/LESSONS.md` (CLOSE), `intent/<slug>.md` (`aidlc intent new`, incident intents) and card files (`aidlc cards project --write`): tracked artifacts by design, never ignored. (6) The hooks (src/hooks) write nothing outside the state directory. The planning scratch files `task_plan.md`, `findings.md` and `progress.md` are written by the planning-with-files skill, which init does not install and which nothing in src/, templates/, .claude/, README.md, docs/OPERATIONS.md or docs/ARCHITECTURE.md names; this repository ignores them by hand (.gitignore:13-16) and init does not add them. No template mirrors the list: templates/ has no .gitignore, and init.ts:102 is its only copy."
sweep: "git grep -n gitignore (main at ea67f79, tracked files): src/scaffold/init.ts:4,100-107 (the only writer); tests/infra/init.test.ts:19,27,32 (the idempotence assertion stays); docs/OPERATIONS.md:13 (the Setup list this card extends); docs/OPERATIONS.md:145, CLAUDE.md, templates/CLAUDE.aidlc.md:5 and docs/ARCHITECTURE.md:159 say `.aidlc/` is gitignored, still true: untouched. git grep -n review/ over src: card-runner.ts:847,1106,1155,1186,1444,1647,2084, pre-review.ts:9, ship.ts:269,288, github-ship.ts:5,572: every one is a path under the review checkout, covered by the one entry. git log -S.review/ -- .gitignore: be15c66 (T0-PRE-REVIEW) added it to this repository only."
forbid: ["changing `GitProbe.status` (src/probes/git.ts) or `refuseDirtyCandidate` (src/loop/card-runner.ts): the refusal is right, a review reads the committed candidate", "filtering `.review/` paths out of a status or candidate read", "moving the review artifacts out of the worktree", "adding the planning scratch files to the init list", "init writing `.git/info/exclude` or any file it does not write today", "changing this repository's own .gitignore"]
non_goals: ["an `aidlc doctor` line that reports a missing `.review/` entry", "re-binding a candidate an earlier attempt already recorded with `.review/` files untracked", "the header comment init writes before appended entries: written with each append, as before"]
hygiene: "The scratch reproduction (outside the repository) drove CardRunner on a real linked worktree of an `initProject` repository with scripted reviewers; the regression test sits at the probe the refusal reads (`GitProbe.status`) and needs no reviewer. The real-git test sets user.name and user.email on its own repository and never reads the developer's git config. Run the mutation sweep before the first review (docs/LESSONS.md 2026-09-24 T1-OPUS55-R3-3): drop `.review/` from the list, accept only the slashed form, append an entry that is present. Doc and CHANGELOG tests read the exact sentences (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS). The header comment is written with each append, as before, so an upgraded file carries it twice; acceptance 2 pins the entries, not the comment count."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-INIT-REVIEW-IGNORE

## Deliverable
A repository laid out by `aidlc init` ignores `.review/`, so the verdicts, logs and reservations R2 and R3 write into a card worktree leave it clean and the next review runs on it. An existing downstream repository takes the entry by running `aidlc init` again and committing `.gitignore`.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/init.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.

## Attempt evidence

Attempt 1 (BUILD, effort medium).

Reproduction (base 4c11ddb, before the fix; a scratch script outside the repository with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`): `initProject` on a fresh `git init` repository, `git add -A`, commit, `git worktree add -b T1-X`, then the four files of acceptance 3 under `<worktree>/.review/`.
- Committed `.gitignore`: `"# aidlc runtime state (never committed)\n.aidlc/\n_local/\n"`.
- `new GitProbe().status(worktree)`: `{"dirty":true,"entries":["?? .review/T1-X.json","?? .review/T1-X.pre.0.1.1.r1.json","?? .review/T1-X.pre.0.1.1.r1.log","?? .review/verdict.schema.json"],"untracked":[...the same four paths]}`.
- After appending `.review/` to the main checkout's `.git/info/exclude` (the R3 upgrade paragraph): `{"dirty":false,"entries":[],"untracked":[]}`, so a linked worktree reads that file.

RED (commit a72fae1, test only, src unchanged): `node --test tests/infra/init.test.ts`, exit 1, about 1.3 s (1277 ms wall, duration_ms 1262.6); 8 tests, 3 pass, 5 fail.
- First failing line: `not ok 1 - lays the playbook layout over an empty directory and is idempotent`, assertion `T0-INIT-REVIEW-IGNORE acceptance 1: the three entries once each, in this order`, actual `'# aidlc runtime state (never committed)\n.aidlc/\n_local/\n'`, expected `'# aidlc runtime state (never committed)\n.aidlc/\n_local/\n.review/\n'`.
- Also failing: acceptance 2 upgrade cases (no `.review/` appended), acceptance 3 (`dirty: true` with the four `?? .review/...` entries), acceptance 4 and 5 (text absent).
- Passing on RED as expected: the `.review`-without-slash case of acceptance 2 (main already counts the slashless spelling as present), and the two unrelated init tests.

GREEN (commits 1959401 fix, 4c8fef6 docs): `npm run typecheck && node --test tests/infra/init.test.ts`, exit 0; 8 tests, 8 pass, 0 fail, duration_ms 1361.4.

Pinned end states (acceptance 1 and 2):
- Empty directory: `.gitignore` is exactly `# aidlc runtime state (never committed)\n.aidlc/\n_local/\n.review/\n`; a second run leaves it byte-identical and does not report it merged.
- Upgrade from `node_modules/` plus the earlier init block, LF with a trailing newline and without one: `node_modules/\n# aidlc runtime state (never committed)\n.aidlc/\n_local/\n# aidlc runtime state (never committed)\n.review/\n`, reported merged; a further run leaves it byte-identical, not merged.
- The same file with CRLF line ends: `node_modules/\r\n# aidlc runtime state (never committed)\r\n.aidlc/\r\n_local/\n# aidlc runtime state (never committed)\n.review/\n` (the appended block uses LF, as init did before this card), then byte-identical.
- `.aidlc/\n_local/\n.review\n`, its CRLF form and `.aidlc\n_local\n.review` (no trailing newline): byte-identical, not merged.

Mutation sweep (each applied alone to the committed tree, DoD test file run, file restored):

| Mutant | Result |
|---|---|
| drop `.review/` from the list | killed (acceptance 1, 2, 3) |
| accept only the slashed form | killed (acceptance 2, slashless case) |
| accept only the slashless form | killed (acceptance 1, 2) |
| append entries already present | killed (acceptance 2) |
| drop `trimEnd` before the append | killed (acceptance 2) |
| never report `.gitignore` merged | killed (acceptance 2) |
| rewrite when nothing is missing | killed (acceptance 1, 2) |
| `.review/` ordered before `_local/` | killed (acceptance 1) |
| `.review/` listed twice | killed (acceptance 1, 2) |
| split lines on LF only | survives: equivalent, `l.trim()` strips the `\r` (pre-existing line, unchanged) |
| each Setup sentence, each upgrade sentence, the CHANGELOG entry removed | killed (acceptance 4, 5) |
