---
id: T1-GH-ISSUES
title: GhProbe lists the issues that carry a label and creates a labelled issue with its body on stdin, both through argv gh calls that fail with GhProbeError on a non-zero exit
status: merged
branch: T1-GH-ISSUES
worktree: D:\wt\AIDLC\T1-GH-ISSUES
plan_ref: plans/review-recall.md#order-of-work
allow_paths:
  - src/probes/gh.ts
  - tests/infra/gh.test.ts
  - specs/tasks/T1-GH-ISSUES.md
dod_command: npm run typecheck && node --test tests/infra/gh.test.ts
dod_exit: 0
requirements:
  - R1. `GhProbe.issuesWithLabel(repo, label, cwd?)` (new, src/probes/gh.ts) shall run `gh issue list --repo <repo> --label <label> --state all --limit 100 --json number,body` and return `{ number, body }[]` parsed and checked with zod; a non-zero exit or output that does not parse throws `GhProbeError` (:196).
  - R2. `GhProbe.createIssue(repo, title, body, label, cwd?)` (new) shall run `gh label create <label> --repo <repo> --force --description "aidlc review follow-ups"`, then `gh issue create --repo <repo> --title <title> --label <label> --body-file -` with `body` on stdin, and return the issue number parsed from the last line of stdout when it is an issue URL of `repo` (`https://github.com/<repo>/issues/<n>`); a non-zero exit of either call, or stdout with no such URL, throws `GhProbeError` naming the call, and no issue call runs after a failed label call.
  - R3. Every call is an argv array through the probe's injected runner; no shell string.
acceptance:
  - 1. `tests/infra/gh.test.ts`, new test "T1-GH-ISSUES acceptance 1: issuesWithLabel passes the argv of R1 and parses number and body". Scripted runner. Fails on main (no method). [R1] [R3] [dod arm 1]
  - 2. Same file, new test "T1-GH-ISSUES acceptance 2: createIssue creates the label, then the issue with the body on stdin, and returns the number from the URL". Fails on main. [R2] [R3] [dod arm 1]
  - 3. Same file, new test "T1-GH-ISSUES acceptance 3: a failed label call, a failed issue call, unparsable list output and a missing or foreign URL each throw GhProbeError and stop further calls". Fails on main. [R1] [R2] [dod arm 1]
  - 4. The existing tests of tests/infra/gh.test.ts pass with no line changed. [dod arm 1]
depends_on: []
budget: 100
tdd: true
sweep: "Main at 0f28b51e. `GhProbe` src/probes/gh.ts:65-194: constructor takes a `SyncRunner` (:68); methods such as `prsForBranch` (:87) and `rerunFailed` (:182) show the argv and error pattern; `GhProbeError` :196-200 takes the args and the receipt. Check at PREPARE whether the runner accepts stdin input (src/probes/exec.ts `runSync` options); if it does not, add the option there only if the card's allow_paths are amended first."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test
  - a GitHub search query, or a call that is not argv
  - calling the new methods from the loop (T1-REVIEW-FOLLOWUP-ISSUE does)
non_goals: [the closure step, a change to CHANGELOG.md]
hygiene: "Line numbers are from main at 0f28b51e; read them again at PREPARE."
---

# T1-GH-ISSUES

## Deliverable
Two `GhProbe` methods that the follow-up closure step uses: list the issues that carry a label, and create a labelled issue.

## Why
Owner's decision of 2026-11-16 (intent/review-recall.md): a shipped card's advisory and deferred findings go to one GitHub issue labelled `review-followup`. `GhProbe` has no issue method. Listing by label, not by search, finds an issue created a moment ago, which the search index can miss.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/gh.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; no existing test line changes.

## Attempt evidence
Attempt 1, effort medium. PREPARE check: `ExecOptions.input` exists in src/probes/exec.ts and `runSync` passes it to the child's stdin, so `--body-file -` goes through the injected runner unchanged; no deviation from R2.

RED: commit 8d8a6ca2 (tests only). `node --test tests/infra/gh.test.ts`: 12 pass, 3 fail, each for the missing method:
- acceptance 1: `TypeError: probe.issuesWithLabel is not a function`
- acceptance 2: `TypeError: probe.createIssue is not a function`
- acceptance 3: `TypeError: labelFails.probe.createIssue is not a function`

| Item | Proof | Result |
|---|---|---|
| 1 | tests/infra/gh.test.ts "T1-GH-ISSUES acceptance 1: issuesWithLabel passes the argv of R1 and parses number and body" | pass |
| 2 | tests/infra/gh.test.ts "T1-GH-ISSUES acceptance 2: createIssue creates the label, then the issue with the body on stdin, and returns the number from the URL" | pass |
| 3 | tests/infra/gh.test.ts "T1-GH-ISSUES acceptance 3: a failed label call, a failed issue call, unparsable list output and a missing or foreign URL each throw GhProbeError and stop further calls" | pass |
| 4 | `git diff 3c740123 --numstat -- tests/infra/gh.test.ts`: `57 0` (additions only); the 12 existing tests pass | pass |

DoD: `npm run typecheck && node --test tests/infra/gh.test.ts`: exit 0, tests 15, pass 15, fail 0.
