---
id: T0-PR-SUMMARY-REUSED
title: "The GitHub ship path rewrites the text of an open pull request it uses again when the ship wrote the current text, and a failed read or edit does not stop the ship"
status: todo
branch: T0-PR-SUMMARY-REUSED
worktree: D:\wt\AIDLC\T0-PR-SUMMARY-REUSED
allow_paths:
  - src/delivery/github-ship.ts
  - tests/infra/pr-summary.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-PR-SUMMARY-REUSED.md
  - specs/tasks/T0-PR-SUMMARY-REUSED.md
dod_command: npm run typecheck && node --test tests/infra/pr-summary.test.ts tests/infra/github-ship.test.ts tests/infra/github-ship-merge-refused.test.ts tests/surface/templates.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `shipWroteBody(body, cardId, cardsDir?)`, exported from `src/delivery/github-ship.ts`, shall return true exactly when `body` with each CRLF made LF and trailing white space removed either equals the fixed line `Closed loop: worktree + TDD + independent review. DoD in <p>.` or has as its last line `Card: <p>. Formal review: pass.` or `Card: <p>. Formal review: no pass recorded for this commit.`, where `<p>` is `<cardsDir>/<cardId>.md` (`cardsDir` undefined being `specs/tasks`) or `specs/tasks/<cardId>.md`.
  - R2. WHEN a remote ship uses again an open pull request `<n>` and its push succeeds, the ship shall compute the text with `prBody` from the same card file and review state as a new pull request, run `gh pr view <n> --repo <repo> --json body`, and write `gh pr edit <n> --repo <repo> --body <text>` only when the current text is a string, differs from the new text after both are normalised as in R1, and `shipWroteBody` is true for it.
  - R3. The ship output of the ship in R2 shall hold exactly one `PR body:` line, directly before the line that names the pull request number, that is `PR body: updated, the PR summary of the card` or `PR body: updated, the fixed line (<reason>)` after an edit that exits 0, `PR body: unchanged` when the texts are the same, `PR body: kept (the current text was not written by the ship)` when `shipWroteBody` is false, `PR body: not updated (could not read the current text: <detail>)` when the view does not exit 0, times out, ends without an exit code or prints no JSON object with a string `body`, and `PR body: not updated (gh pr edit <detail>)` when the edit does not exit 0, times out or ends without an exit code, each `<detail>` flattened to one line and encoded as every other failure detail of the path.
  - R4. A failed or skipped read or edit in R2 shall leave the outcome, the PR number and every later call of the ship (the CI gate and the merge) as they are when the edit exits 0.
  - R5. A ship that creates the pull request, a ship whose pull request is merged, and a ship that ends before its push shall run neither `gh pr view <n> --repo <repo> --json body` nor `gh pr edit`, and every other output, call, argument and outcome of a ship shall be what it is on main at 2b789c3f.
  - R6. `docs/OPERATIONS.md` (Ship gates, Pull request text) and the `GitHubShipPath` item of `docs/ARCHITECTURE.md` shall state R1 to R4 and the two new 120-second bounds, the sentence that a pull request that exists keeps its text shall be gone, and `changelog.d/T0-PR-SUMMARY-REUSED.md` shall hold one entry.
acceptance:
  - 1. `tests/infra/pr-summary.test.ts`, new describe `T0-PR-SUMMARY-REUSED`. `shipWroteBody` is true for the fixed line of `specs/tasks/T1-A.md`; with `cardsDir` `docs/cards`, for the fixed line of `docs/cards/T1-A.md` and of `specs/tasks/T1-A.md`; for a summary followed by the rule and each of the two `Card:` lines; for each of these with CRLF line ends and with a trailing newline and spaces. It is false for the empty string, a text a person wrote, a `Card:` line that is not the last line, a `Card:` line or fixed line of `T1-B`, a `Card:` line with another review word, and, with `cardsDir` `docs/cards`, a fixed line of `other/T1-A.md`. [R1] [dod arm 2]
  - "2. Same describe. A ship that uses open pull request 8 (`gh pr list` lists it) and whose view prints the fixed line runs `gh pr view 8 --repo o/r --json body` once and `gh pr edit` once with exactly `['pr', 'edit', '8', '--repo', 'o/r', '--body', <summary, rule, PASS line>]`, runs no `gh pr create`, ends `merged` with PR number 8, and its `PR body:` line is `PR body: updated, the PR summary of the card` followed by `PR #8`. The same ship with no card file and a view that prints the earlier summary text sends the fixed line and writes `PR body: updated, the fixed line (no card file)`. [R2] [R3] [dod arm 2]"
  - 3. Same describe. A view that prints the new text with CRLF line ends and a trailing newline runs no edit and writes `PR body: unchanged`; a view that prints a text a person wrote runs no edit and writes `PR body: kept (the current text was not written by the ship)`; each ends `merged`. [R2] [R3] [dod arm 2]
  - "4. Same describe. Each of a view that exits 1, a view that times out, a view that prints `{not json`, a view whose `body` is a number, an edit that exits 1 with stderr `[SAGA-FAIL] boom`, and an edit that times out ends `merged` with PR number 8 and runs `gh pr merge` once; the read failures run no edit and write a line that starts `PR body: not updated (could not read the current text: `, the edit failures a line that starts `PR body: not updated (gh pr edit `; no output line other than the sentinels of a merged ship starts with `[`, and each `PR body:` line is directly before `PR #8`. [R3] [R4] [dod arm 2]"
  - 5. T0-PR-SUMMARY acceptance 6 keeps its four cases that create no pull request and moves the reused case to item 2; in each of the four, and in a ship whose pull request 8 is MERGED and a ship whose push exits 1 with pull request 8 open, no `gh pr view ... --json body` or `gh pr edit` runs and no `PR body:` line is written; the earlier T0-PR-SUMMARY and T0-PR-SUMMARY-CARDS-DIR tests, `github-ship.test.ts`, `github-ship-merge-refused.test.ts` and `templates.test.ts` pass with no other change, and the typecheck reports no error. [R5] [dod arm 1] [dod arm 2]
  - 6. `changelog.d/T0-PR-SUMMARY-REUSED.md` holds one entry (`tests/surface/changelog-fragments.test.ts`), and the two documents hold what R6 assigns to them (reviewer-verified against the diff). [R6] [dod arm 2]
depends_on: []
budget: 220
tdd: true
diagnosis:
  root_cause: "`GitHubShipPath.ship` computes and sends the pull request text only inside `if (!prNumber)` (src/delivery/github-ship.ts, the `gh pr create` branch); a pull request resolved by `resolvePr` as OPEN skips that branch, and no other call writes its text."
  same_class: "`git grep -n \"'--body'\" -- src/delivery` on 2b789c3f finds the one `gh pr create` call. The scaffold ship path writes no pull request text of its own, and the dry-run path creates none."
sweep: "On main at 2b789c3f. `git grep -n \"pr edit\\|'edit'\\|--json', 'body'\" -- src tests` finds nothing. `git grep -n \"'gh pr view'\" -- tests` finds four scripts; in tests/infra/pr-summary.test.ts the default `gh pr view` entry prints the MERGED record the ship reads after its merge, so the new tests answer the `--json body` view by its arguments. `PR body` appears in src only in the create branch, in tests only in pr-summary.test.ts, and in docs only in the OPERATIONS Pull request text paragraph (bench.test.ts and OPERATIONS line 643 say `PR body` of a person's text, which this card does not touch). tests/surface/templates.test.ts:107 pins one sentence of the ARCHITECTURE GitHubShipPath item, which this card keeps."
forbid:
  - a new source module or a new dependency
  - weakening or skipping a test to go green
non_goals:
  - the text of a merged or closed pull request; a person can change it by hand
  - the title of a pull request that exists, which keeps its text
  - a text a person changed on GitHub that still ends with the ship's `Card:` line; R1 counts it as the ship's and the ship replaces it
  - a `Card:` line or fixed line that names a cards directory other than the configured one and `specs/tasks`; R1 counts it as a person's text and the ship keeps it
  - a retry of a failed view or edit inside one ship; the next ship reads and writes again
---

# T0-PR-SUMMARY-REUSED

From issue 446. The owner decision the issue names is taken with the safe rule
the issue gives: the ship replaces only a text it wrote.

## Deliverable
When the GitHub ship path uses again an open pull request, it writes the text it
would give a new pull request, unless a person wrote the current text. A failed
read or edit is a line on the ship output and does not stop the ship.

## PR summary
### What
The GitHub ship path now writes the pull request text again when it uses an open pull request. Before, only a new pull request got the text.

### Why / Intent
After a failed ship, the author corrects the code and the summary. The next ship used the same pull request with the first text and the first `Formal review:` line. Old pull requests showed the one-line text.

### How / Behaviour
- The ship calculates the text as for a new pull request.
- It reads the current text with `gh pr view --json body`.
- It writes the new text with `gh pr edit --body` only when the texts are different and the ship wrote the current text. That is the fixed line, or a text whose last line is the `Card: ... Formal review: ...` line.
- The ship output has one `PR body:` line: updated, unchanged, kept or not updated.

### System impact
Only `src/delivery/github-ship.ts` changes. A new pull request gets the same text as before.

### Security
The text goes to `gh` as one argument, as before. A text that a person wrote is not replaced. The rules for the at sign and the NUL character do not change.

### Tests and review
- New tests in `tests/infra/pr-summary.test.ts` cover the rule, the edit, the unchanged and kept texts, and each failed read or edit.
- One existing test moves its case of an open pull request to the new tests.

### Risk
Low. A failed read or edit does not change the result of the ship. The CI gate and the merge run as before.

### Ownership
Card `T0-PR-SUMMARY-REUSED`, goal `g-20261123104327-35cdb9`, from issue 446.

### Docs
`docs/OPERATIONS.md` (Ship gates, Pull request text) and `docs/ARCHITECTURE.md` describe the new step. `changelog.d/T0-PR-SUMMARY-REUSED.md` holds the entry.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/pr-summary.test.ts tests/infra/github-ship.test.ts tests/infra/github-ship-merge-refused.test.ts tests/surface/templates.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: the new tests pass, the existing ship and template tests pass, the typecheck is clean and the changelog fragment is well formed.

## Attempt evidence
RED commit 964118c7 holds the new tests and a seam: `shipWroteBody` is exported and returns false, and the ship does not read or write the text of a reused pull request. Acceptance 1 to 4 fail on assertions there; acceptance 5 passes, as it states behaviour that stays.

| Item | Proof | Result |
|---|---|---|
| 1 | `pr-summary.test.ts`, T0-PR-SUMMARY-REUSED acceptance 1 | pass |
| 2 | `pr-summary.test.ts`, T0-PR-SUMMARY-REUSED acceptance 2 | pass |
| 3 | `pr-summary.test.ts`, T0-PR-SUMMARY-REUSED acceptance 3 | pass |
| 4 | `pr-summary.test.ts`, T0-PR-SUMMARY-REUSED acceptance 4 | pass |
| 5 | `pr-summary.test.ts`, T0-PR-SUMMARY-REUSED acceptance 5 and T0-PR-SUMMARY acceptance 6; DoD: typecheck, `github-ship.test.ts`, `github-ship-merge-refused.test.ts`, `templates.test.ts` | pass |
| 6 | `changelog-fragments.test.ts`; the two documents in the diff | pass |
