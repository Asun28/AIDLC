---
id: T1-REVIEW-FOLLOWUP-CORE
title: "The gh probe reads every page of the issues of a label through the REST list, and the follow-up findings of a card run and the body of their issue are pure functions"
status: merged
branch: T1-REVIEW-FOLLOWUP-CORE
worktree: D:\wt\AIDLC\T1-REVIEW-FOLLOWUP-CORE
plan_ref: plans/review-recall.md#order-of-work
allow_paths:
  - src/probes/gh.ts
  - src/core/review-policy.ts
  - tests/infra/gh.test.ts
  - tests/core/followup-findings.test.ts
  - docs/ARCHITECTURE.md
  - changelog.d/T1-REVIEW-FOLLOWUP-CORE.md
  - specs/tasks/T1-REVIEW-FOLLOWUP-CORE.md
dod_command: npm run typecheck && node --test tests/infra/gh.test.ts tests/core/followup-findings.test.ts tests/core/review-policy.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `GhProbe.issuesWithLabel(repo, label, cwd)` shall read `gh api repos/<repo>/issues?labels=<label, percent-encoded>&state=all&per_page=100&page=<n>` from page 1 until a page with fewer than 100 entries, pull requests counted, and return the number and the body of every entry that is not a pull request, in the order read, with the empty string for a null body.
  - R2. When a page call fails or times out, its output is not JSON, or its output is not a list of entries that each have a positive safe integer as number and a string or null as body, `issuesWithLabel` shall throw a `GhProbeError` that names the call, and return no partial list.
  - R3. When 1,000 pages in a row hold 100 entries, `issuesWithLabel` shall throw an error that names the repository and the label, and return no partial list.
  - R4. `GhProbe.ensureLabel(repo, label, cwd)` shall perform only the label-create operation of main's `createIssue`, preserving its argv, timeout and errors.
  - R5. `followupFindings(run)` (src/core/review-policy.ts) shall return the follow-up findings of a card run in this order: each `advisory` reason of its formal invocations with outcome `pass` or `block`, each formal finding with `advisory` true, and each finding whose ruling is `deferred` and names no issue.
  - R6. When two entries of R5 have the same trimmed text, `followupFindings` shall keep the first position only and give that entry the first finding id that any of them has; an entry whose trimmed text is empty is left out.
  - R7. `followupIssueBody(cardId, prNumber, sha, findings, marker)` shall return a text that names the card, the PR (`none` without a number) and the candidate, holds one list item per finding on one line of its own with its id where it has one, and ends with the marker on the last line that is not empty.
  - R8. Each finding item of R7 shall contain its text with every run of white space replaced by one space and a zero-width space inserted after every `@` directly before an ASCII letter or digit.
  - R9. `GhProbe.submitIssue(repo, title, body, label, cwd)` shall perform only the issue-create operation of main's `createIssue`, preserving its argv, stdin body, timeout, returned issue number and errors.
  - R10. `GhProbe.createIssue(repo, title, body, label, cwd)` shall call `ensureLabel` followed, only on success, by `submitIssue`, returning its issue number.
acceptance:
  - 1. `tests/infra/gh.test.ts`, "T1-GH-ISSUES acceptance 1" and the two list cases of "T1-GH-ISSUES acceptance 3" (lines 207 to 246), changed to the call and the output of R1; a null body is the empty string. RED on main, whose argv is `issue list ... --limit 100`. [R1] [R2] [dod arm 2]
  - 2. Same file, new test. A first page of 100 entries and a second of one give 101 entries from exactly two calls; a first page of exactly 100 and an empty second page give 100 from two calls; a first page of 100 entries of which 40 are pull requests is followed by a second call and gives the issues only; a label with a space and `&` is percent-encoded; a second page that exits 1, that times out, with empty output, that is not JSON, that is an object, with an entry without a body, with a number as body, and with the issue number 0, -1 or 1.5 each throw `GhProbeError` with nothing returned; a runner that gives 100 entries for every page throws after call 1,000 naming the repository and the label. RED on main. [R1] [R2] [R3] [dod arm 2]
  - 3. Same file. `ensureLabel` makes exactly the label call and `submitIssue` exactly the issue call with the body on stdin; a label call that fails, an issue call that fails, and an issue call whose last line is not an issue URL of the repository throw as on main. "T1-GH-ISSUES acceptance 2" and the other cases of "T1-GH-ISSUES acceptance 3" pass with no line changed. RED on main (no such methods). [R4] [R9] [R10] [dod arm 2]
  - 4. `tests/core/followup-findings.test.ts` (new). A run with two decided R3 invocations, a ship-path one, a pending, a no-verdict and a quota-hold one that carry advisory reasons, advisory and merge-blocking formal findings, a pre-review finding with `advisory` true, and deferred (with and without an issue) and rejected rulings gives exactly the entries of R5 in its order. The same text as an invocation reason without an id and later as finding F2 gives one entry at the first position with the id F2; with F2 and then F3 it keeps F2; a reason that differs only in outer white space is the same text; a blank reason gives nothing; a run with none gives an empty list. RED on main (no export). [R5] [R6] [dod arm 3]
  - 5. Same file. The body of R7 with and without a PR number, for a finding with and without an id; a reason with a newline followed by `## heading` and by the marker of another card, with a tab, with `@name`, with `a@b.c` and with `@` before a space gives exactly one line per finding, and the last line that is not empty is the marker. Assert the exact rendered finding text: repeated whitespace becomes one space, `@name` becomes `@\u200Bname`, `a@b.c` becomes `a@\u200Bb.c`, and `@` before a space remains unchanged; `\u200B` here denotes the actual zero-width character. RED on main. [R7] [R8] [dod arm 3]
  - 6. Doc text (reviewer-verified against the diff). The `src/probes/` sentence of `docs/ARCHITECTURE.md` and the fragment state R1 and that `gh issue list --label` is a search query of GitHub, which is why the list is read through REST; the comment of `issuesWithLabel` no longer says that `gh issue list` lists by label. The fragment has the form of `changelog.d/README.md`. [R1] [dod arms 5, 6]
depends_on: []
budget: 250
tdd: true
sweep: "Main at 9278ab1d. `GH_DEBUG=api gh issue list --repo Asun28/AIDLC --label review-followup --state all --limit 1 --json number,body` (gh 2.87.0, 2026-11-24) posts `query IssueSearch` with `label:review-followup repo:Asun28/AIDLC type:issue`, so the method of main reads GitHub search, one page of 100; `gh api 'repos/Asun28/AIDLC/issues?labels=review-followup&state=all&per_page=100&page=1'` prints `[]`. `git grep -n 'issuesWithLabel\\|createIssue' -- src tests docs` finds src/probes/gh.ts and tests/infra/gh.test.ts only. `git grep -n 'findingMarker' -- src tests docs` finds review-policy.ts:229, tests/core/review-policy.test.ts, docs/REQUIREMENTS-TRACEABILITY.md:20 and removed-surface.test.ts:103; none changes here. The code of commit 2a87bf7c (branch T1-REVIEW-FOLLOWUP-ISSUE, never merged) has these functions and may be reused where it meets the requirements; its R3 findings F1 (the id lost in a duplicate), F2 (one page of 100) and F5 (the edit of gh.test.ts that its card did not permit) are R6, R1 and acceptance 1 here."
forbid: ["a call of the new functions from src/loop or src/cli", "a write to GitHub from a test", "a search query of GitHub"]
non_goals:
  - "an issue that is deleted or loses the label while the pages are read: the list then may miss an entry that moved to an earlier page"
  - "a repository on a host other than the one gh uses by default"
  - "the closure step, its record and its command (card T1-REVIEW-FOLLOWUP-ISSUE-2)"
  - "removing `createIssue`, which only tests call until the next card"
hygiene: "Starts from main, not from the stopped branch. RED first. Run `npm run check` in the worktree before the attempt is recorded and put its totals in the Attempt evidence. The tests of acceptance 1 change because R1 replaces the call they pin; each changed line is named in the Attempt evidence. Checked against the newest lessons on 2026-11-24: absent and empty are cases of their own (T0-PR-SUMMARY), every sentence of a changed comment is swept (T0-RED-PATH-TEXT), each document gets the whole rule (T0-PR-SUMMARY-REUSED)."
doc_sync: docs/ARCHITECTURE.md, changelog.d/T1-REVIEW-FOLLOWUP-CORE.md
---

# T1-REVIEW-FOLLOWUP-CORE

First of the two cards that replace T1-REVIEW-FOLLOWUP-ISSUE (stopped at R3 decision 4).

## Why
A closure step that files one issue per card needs to know whether the issue exists. The probe on main reads at most 100 results of GitHub search, which lags behind a new issue, so a retry could file a second one.

## Deliverable
The complete list of the issues of a label, the two calls that file an issue as two methods, and the pure functions that say what the issue holds. Nothing in the loop calls them yet.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/gh.test.ts tests/core/followup-findings.test.ts tests/core/review-policy.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the probe reads every page or throws, the findings and the body are as R5 to R8, and the review-policy tests pass unchanged.

## PR summary
### What
`GhProbe.issuesWithLabel` reads every page of the issues of a label through the REST list. `ensureLabel` and `submitIssue` are the two calls of `createIssue` as methods of their own. `followupFindings` and `followupIssueBody` say which findings of a card run a follow-up issue holds and how it reads.

### Why / Intent
A closure step that files one issue per card has to know whether the issue exists. Main read at most 100 results of GitHub search, which lags behind a new issue, so a retry could file a second one. This is the first of the two cards that replace T1-REVIEW-FOLLOWUP-ISSUE.

### How / Behaviour
The list reads pages of 100 until a page has fewer than 100 entries, pull requests counted and left out of the result. A failed, timed-out or malformed page and 1,000 full pages in a row throw, so no partial list is returned. Findings with the same trimmed text become one entry at the first position with the first finding id.

### System impact
Nothing in `src/loop` or `src/cli` calls the new functions. `createIssue` makes the same two calls as before.

### Security
Reviewer text is untrusted: the body keeps each finding on one line and puts a zero-width space after an `@` that would mention a name. No new credential and no GitHub write in a test.

### Tests and review
`tests/infra/gh.test.ts` and `tests/core/followup-findings.test.ts`, with scripted runners and fixed fixtures. R3 reviews the candidate.

### Risk
Low. An issue that is deleted or loses the label while the pages are read can move another entry to an earlier page, which the list then misses; the card names this as a non-goal.

### Ownership
The aidlc loop maintainers.

### Docs
`docs/ARCHITECTURE.md` and `changelog.d/T1-REVIEW-FOLLOWUP-CORE.md` state the change.

## Attempt evidence
| Item | Proof | Result |
|---|---|---|
| 1 | `tests/infra/gh.test.ts`, the four lines of "T1-GH-ISSUES acceptance 1" and "T1-GH-ISSUES acceptance 3" listed below. RED at 16e23c59: acceptance 1 failed. The two list cases of acceptance 3 passed at 16e23c59 too, because the scripted runner refuses the call of main and the refusal is a `GhProbeError` | pass after the change |
| 2 | Same file, the three "T1-REVIEW-FOLLOWUP-CORE acceptance 2" tests, RED at 16e23c59 | pass after the change |
| 3 | Same file, "T1-REVIEW-FOLLOWUP-CORE acceptance 3", RED at 16e23c59 (TypeError, no such method); "T1-GH-ISSUES acceptance 2" and the other cases of "T1-GH-ISSUES acceptance 3" have no line changed | pass after the change |
| 4 | `tests/core/followup-findings.test.ts`, the two `acceptance 4` tests, RED at 16e23c59 (no export `followupFindings`) | pass after the change |
| 5 | Same file, the two `acceptance 5` tests, RED at 16e23c59 (no export) | pass after the change |
| 6 | `docs/ARCHITECTURE.md`, the comment of `issuesWithLabel`, the fragment; `changelog-fragments`, `prose` | reviewer-verified; pass |

Changed lines of `tests/infra/gh.test.ts` (line numbers of main), each because R1 replaces the call it pins: 208, the script key `gh issue list` is now `gh api repos/Asun28/repo/issues?` and the second body is `null` in place of `''`; 213, the expected argv; 242 and 245, the script key of the two list cases. Every other changed line is an addition.

Guards: 40 loosened forms of the new conditions were run one at a time against the two test files. 39 were caught. The other, a page of 99 entries read as full, led to the 99-entry row of the first acceptance 2 test, which catches it.

`npm run check`: exit 0; 4193 tests, 4161 pass, 0 fail, 32 skipped.
