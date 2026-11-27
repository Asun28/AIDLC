---
id: T0-REVIEW-DIFF-DELETED
title: "A review diff above the cap is collected again without deleted file bodies (git diff -D), and is sent when that fits"
status: todo
superseded_by: T0-REVIEW-DIFF-DELETE
branch: T0-REVIEW-DIFF-DELETED
allow_paths:
  - src/review/pre-review.ts
  - src/core/review-effort.ts
  - src/loop/card-runner.ts
  - src/review/bench.ts
  - tests/surface/review-diff-deleted.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T0-REVIEW-DIFF-DELETED.md
  - specs/tasks/T0-REVIEW-DIFF-DELETED.md
dod_command: npm run typecheck && node --test tests/surface/review-diff-deleted.test.ts tests/surface/pre-review.test.ts tests/infra/git.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/pre-existing.test.ts tests/scenarios/r2-fallback.test.ts tests/scenarios/r3-fallback.test.ts tests/surface/review-bench.test.ts tests/surface/review-bench-order-pre.test.ts tests/surface/review-bench-formal-command.test.ts tests/surface/bench.test.ts tests/surface/templates.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `collectCandidateDiff` (`src/review/pre-review.ts:1000`) shall collect the full diff as it does on main. When its size is at or below `maxBytes` the result is byte-identical to main and git is called with the same arguments as on main. When it is above `maxBytes`, the function shall run the same `git diff` once more with `-D` (`--irreversible-delete`) added, on the same pinned range; if that diff is at or below `maxBytes` it is returned as `diff`, with `bytes` its size and a new field `deletedBodiesOmitted: { fullBytes: number }` holding the size of the full diff. Otherwise the refusal is thrown as on main: the message keeps main's text unchanged (full size, cap name, cap value) and appends `; without deleted file bodies (git diff -D) it is <n> bytes`. A failed `-D` call throws as the first call does. `changedPaths` is the `--name-only` listing in both cases.
  - R2. The effort level (`selectReviewEffortFromDiff`, `src/core/review-effort.ts:51`) shall count the added and deleted lines of the full diff, also when the `-D` diff is sent: `CandidateDiff` carries the full diff's `countDiffLines` value, and the R3, R2-fallback and in-round fallback effort selections (`src/loop/card-runner.ts:2471`, :3119, :3128) use it. The fail-closed rule for a diff with no `diff --git ` section keeps reading the sent diff.
  - R3. When the diff or the delta a prompt carries was collected with `-D`, `buildReviewPrompt` shall add one line under `## Diff` (or under the delta section for the delta): `Deleted files are listed without their content (git diff -D): the full diff is <fullBytes> bytes, above <cap name> (<cap>).` A prompt whose diff and delta were not collected with `-D` is byte-identical to main (the prompt hashes pinned by `tests/surface/pre-review.test.ts:863` hold). The card runner (R2 round, R3 decision) and the reviewer bench (`src/review/bench.ts:409`) pass it.
  - R4. `shipChangedLines` (`src/loop/card-runner.ts:3271`) and `collectDelta` (:587) shall take the R1 behaviour through `collectCandidateDiff` with no other change; a deleted file has no new-side lines, so `changedLineRanges` is unchanged for it.
  - R5. `docs/OPERATIONS.md`, the Review inputs paragraph (card T1-REVIEW-INPUTS, "The committed diff is sent whole"), shall state R1 to R3 in at most three sentences, and one changelog fragment shall record the change.
acceptance:
  - 1. `tests/surface/review-diff-deleted.test.ts`, new file, on a real git repository in a temp directory (as `tests/infra/git.test.ts:181`): the base has a 40 KB tracked text file and a small source file; the candidate deletes the large file and changes one line of the small one. With `maxBytes` 10_000 `collectCandidateDiff` returns a diff that holds `deleted file mode` for the large file, none of its lines, and the small file's hunk; `deletedBodiesOmitted.fullBytes` is above 40_000; `changedPaths` lists both files. RED on main (main throws). [R1] [dod arm 2]
  - 2. Same file: with `maxBytes` above the full size, the result has no `deletedBodiesOmitted` and its `diff` equals the output of main's `git diff --text <range> --no-color --no-ext-diff --no-textconv`; a scripted runner records exactly main's two git calls. With `maxBytes` below the `-D` size, the throw matches `/<full> bytes.*maxDiffBytes \(<cap>\).*git diff -D\) it is <n> bytes/s`. [R1] [dod arm 2]
  - 3. Same file: for acceptance 1's candidate, the effort level selected for a policy whose `high` rule is `minChangedLines: 100` is `high` (the full diff's deleted lines count), and the same policy over a candidate that only changes the small file selects the default. RED on main. [R2] [dod arm 2]
  - 4. Same file: a formal prompt built from acceptance 1's collection holds the R3 line once under `## Diff`; a delta collected with `-D` holds it once under the delta section; a prompt from acceptance 2's under-cap collection holds no such line. [R3] [dod arm 2]
  - 5. Existing tests: `tests/surface/pre-review.test.ts:169` and the cap refusals in `tests/scenarios/t0-flow.test.ts` (:3333, :3346, :3487, :3597), `pre-existing.test.ts:189`, `r2-fallback.test.ts:177` and `review-bench.test.ts:240` pass unchanged; `git diff origin/main --stat -- tests/` lists only the new file. [R1] [R3] [R4] [dod arm 2]
  - 6. R5 holds (reviewer-verified against the diff); `changelog.d/T0-REVIEW-DIFF-DELETED.md` holds one line in the form of `changelog.d/README.md`. [R5] [dod arm 2]
  - 7. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 200
tdd: true
sweep: "On main at 874a74a9. `collectCandidateDiff` (`src/review/pre-review.ts:1000`) runs `git diff --name-only -z <range> --no-renames` then `git diff --text <range> --no-color --no-ext-diff --no-textconv` and throws above the cap (:1013). Callers: `CardRunner.collectDelta` (`src/loop/card-runner.ts:589`), the R3 decision (:2462, effort at :2471, delta at :2475 and :2480), the R2 round (:3113, effort :3119, fallback cap check :3127 and effort :3128), `shipChangedLines` (:3276, swallows any throw), the reviewer bench (`src/review/bench.ts:409`). The effort count is `countDiffLines` (`src/core/review-effort.ts:34`). The repository-reading prompt names `git diff <base>...<head>` (`pre-review.ts:510`) and `git diff <since>...<head>` (:503) and is not changed by this card. Tests that pin the refusal text: `pre-review.test.ts:169`, `t0-flow.test.ts:3333/3346/3487/3597`, `pre-existing.test.ts:189`, `r2-fallback.test.ts:177`, `review-bench.test.ts:240`, `review-bench-order-pre.test.ts:193`; each matches the size, the cap name and the cap value in main's order, so an appended clause keeps them green; a scripted runner in those tests answers the `-D` call from the same `git diff` key. Before BUILD, grep tests/ for any count of `git diff` calls on an over-cap path (lesson T0-HOOK-FAIL-CLOSED)."
forbid: [network]
non_goals:
  - "using -D below the cap, or for files by path (the owner chose in session, 2026-11-27, -D only above the cap)"
  - "changing the `--name-only` listing, the scope gate or `maxDiffBytes` defaults"
  - "changing the `git diff` command a repository-reading reviewer is told to run"
  - "the mutant report diff (`src/review/mutants.ts`)"
hygiene: "From issue 517. The owner chose in session (2026-11-27): collect with -D only when the full diff is above the cap, and keep the effort count on the full diff. RED first: acceptance 1 and 3 on main."
---

# T0-REVIEW-DIFF-DELETED

From issue 517.

## Why
`collectCandidateDiff` sends the whole diff and refuses it above `maxDiffBytes`. A card that deletes tracked data files sends every deleted line: CHORD's T1-CORPUS-OUT-OF-REPO deleted 133 files, a 12.6 MB diff, and R3 refused it under any usable cap. With `git diff -D` the same diff is 39 KB. Using `-D` only above the cap leaves every review that fits today unchanged.

## Deliverable
`collectCandidateDiff` retries an over-cap diff with `-D` and sends it when it fits; the effort level still counts the full diff; the prompt says when deleted bodies were left out. A new test file, an OPERATIONS.md sentence set and a changelog line.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/review-diff-deleted.test.ts tests/surface/pre-review.test.ts tests/infra/git.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/pre-existing.test.ts tests/scenarios/r2-fallback.test.ts tests/scenarios/r3-fallback.test.ts tests/surface/review-bench.test.ts tests/surface/review-bench-order-pre.test.ts tests/surface/review-bench-formal-command.test.ts tests/surface/bench.test.ts tests/surface/templates.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: an over-cap diff whose `-D` form fits is reviewed with deleted bodies omitted and says so; an under-cap diff, its git calls and its prompt are unchanged; the effort level counts the full diff.
