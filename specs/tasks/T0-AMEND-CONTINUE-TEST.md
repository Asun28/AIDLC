---
id: T0-AMEND-CONTINUE-TEST
title: "A scenario test runs aidlc card amend and aidlc card continue on one run stopped for review, for the same blocked commit and for a new one"
status: merged
branch: T0-AMEND-CONTINUE-TEST
worktree: D:\wt\AIDLC\T0-AMEND-CONTINUE-TEST
allow_paths:
  - tests/scenarios/card-amend-continue.test.ts
  - specs/tasks/T0-AMEND-CONTINUE-TEST.md
dod_command: npm run typecheck && node --test tests/scenarios/card-amend-continue.test.ts tests/scenarios/card-amend-command.test.ts tests/scenarios/card-continue-command.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. A new file `tests/scenarios/card-amend-continue.test.ts` shall run, on one card run of a one-card goal under a command reviewer, the sequence `docs/OPERATIONS.md` (Amendments) names for a run stopped for review whose card the owner changes. The card is stopped for review by four R3 blocks, each with a new finding; its `requirements` change; `aidlc card amend` and then `aidlc card continue` run through the CLI as a child process; the amended candidate is reviewed, passes and ships; `aidlc audit verify --json` runs on the goal through the CLI.
  - R2. The file shall hold two tests, one for each case of issue 417: the amended candidate is the blocked commit (`sha-4`), and the amended card needs a code change (`sha-5`), where a new attempt is refused while the success stands, `withdrawCandidate` admits the amended candidate and the loop returns `build` before the new attempt.
  - R3. The file shall import the harness and the sources by relative path with `.ts` extensions, as `tests/scenarios/card-amend-command.test.ts` does, typecheck under `tsconfig.test.json`, and use fixed timestamps only. No file under `src/`, `docs/` or any other test file changes.
acceptance:
  - 1. After `aidlc card amend`: exit 0; the printed state is `STOP`, the amendment has revision 1, `changed` `requirements` and `invalidated` `review`; its `next` names `aidlc card continue T1-ARC` (the fixture card); the run's stop, state and 4 substantive decisions and the goal's `STOP` are as before the amendment. [R1] [dod arm 2]
  - 2. After `aidlc card continue`: exit 0; the run has no stop, one continuation that admits decision 5, one amendment, and the goal is no longer `STOP`. [R1] [dod arm 2]
  - 3. The next directive is `review` with `decision 5/5` in its narration, for candidate `sha-4` under `amendedDigest('sha-4', 1)`. In the `sha-5` test, an attempt is refused with the message that names `aidlc card withdraw T1-ARC`; after `withdrawCandidate` the directive is `build` with 4 substantive decisions, and the new attempt's digest is `amendedDigest('sha-5', 1)`. [R1] [R2] [dod arm 2]
  - 4. The fifth decision passes on the amended digest; the four earlier invocations are unchanged; the next directive is `close` with the merge verified and one ship request for the reviewed commit. [R1] [R2] [dod arm 2]
  - 5. The goal journal holds one amendment NOTE, one CARD_STATE and one GOAL_STATE event with a continuation; `aidlc audit verify --json` exits 0 with the journal ok and no `WORK_AFTER_TERMINAL` finding. [R1] [dod arm 2]
  - 6. The typecheck reports no error, `tests/scenarios/card-amend-command.test.ts` and `tests/scenarios/card-continue-command.test.ts` pass unchanged, and `git diff --stat origin/main` lists only the two allowed paths. [R3] [dod arm 1] [dod arm 2]
depends_on: []
budget: 160
tdd: false
sweep: "On main at 6f767c0d. `git grep -l 'card amend\\|amendCard' -- tests` and `git grep -l 'card continue\\|continueCard' -- tests`: the amend tests (tests/scenarios/card-amend.test.ts, card-amend-command.test.ts, amendment.test.ts) never lift a stop with continue, and the continue tests (card-continue.test.ts, card-continue-command.test.ts, card-continue-ci.test.ts, card-continue-goal.test.ts) never amend a card. The check of issue 417, run from outside the repository against 6f767c0d with the NUL byte its text shows as `^@` restored as `\\0`, passes 2 of 2."
forbid: [a change to src/, a change to docs/, a change to an existing test file, weakening or skipping a test to go green]
non_goals: [whether `aidlc card amend` or `aidlc card continue` should name `aidlc card withdraw` in its `next` text (left open on issue 417), running the withdrawal through the CLI (fenced in the fixture because its lease is taken on the fixed clock and the CLI reads the real one)]
hygiene: "Issue 417, found by the arc check of goal g-20261122004857-e1df8b. tdd false: the test pins behaviour main already has (the check passes on main), so no RED exists; acceptance 1 to 5 are the assertions of the issue's check. No behaviour of aidlc changes, so no changelog fragment and no document change. The withdrawal runs in process, as in the issue's check."
doc_sync: none
---

# T0-AMEND-CONTINUE-TEST

From issue 417.

## Deliverable
`tests/scenarios/card-amend-continue.test.ts`: the issue's arc check as a repository test, in TypeScript with relative imports. It covers the amend-then-continue sequence on one run, which no test runs today.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/card-amend-continue.test.ts tests/scenarios/card-amend-command.test.ts tests/scenarios/card-continue-command.test.ts
```
- Expected exit code: 0
- Assertion: the two new tests pass, the two neighbouring command tests pass unchanged, and the typecheck is clean.

## Attempt evidence
tdd false: the test pins behaviour main already has, so it passes at its first run; the guards below show it fails when that behaviour breaks.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/scenarios/card-amend-continue.test.ts`, both tests, step 1: the `card amend` exit, state, revision, `changed`, `invalidated`, `next` text, and the run and goal unchanged | pass |
| 2 | Same, step 2: the `card continue` exit, no stop, one continuation admitting 5, one amendment, goal not `STOP` | pass |
| 3 | Same, step 3: `review` with `decision 5/5` for `sha-4` under `amendedDigest('sha-4', 1)`; in the `sha-5` test the refused attempt naming `aidlc card withdraw T1-ARC`, `build` with 4 decisions after `withdrawCandidate`, and the new digest | pass |
| 4 | Same, steps 1 to 4: the four invocations equal the pre-amend records in full after `card amend`, equal them with `stopLifted` by the owner added to the fourth alone after `card continue`, and are unchanged by decision 5, which passes on the amended digest; `close` with `mergeVerified` and one ship request for the reviewed commit | pass |
| 5 | Same, step 5: one amendment NOTE, one CARD_STATE and one GOAL_STATE continuation event; `aidlc audit verify --json` exit 0, journal ok, no `WORK_AFTER_TERMINAL` | pass |
| 6 | DoD: `npm run typecheck` exit 0; `node --test` over the three files, 12 tests, 12 pass, 0 fail; `git diff --stat origin/main` lists the test file and this card file only | pass |

Guards, each a temporary change to the source in this worktree, run against the new test file, then restored with `git checkout`:

| Change | Tests that fail |
|---|---|
| `src/cli/main.ts:782`, the `next` text of `card amend` names `aidlc card next` instead of `aidlc card continue` | 2 of 2 |
| `src/loop/card-runner.ts:1517`, the digest of a new attempt takes no amendment count | 1 of 2 (the `sha-5` test) |
| `src/loop/card-runner.ts`, `amendCard`, the amendment also drops `verdictRef` from every invocation | 2 of 2 |
| `src/core/continuation.ts:36`, the continuation also drops `verdictRef` from the stopping decision | 2 of 2 |
| `src/core/continuation.ts:36`, the continuation adds `stopLifted` to every invocation | 2 of 2 |

R3 decision 1 blocked on acceptance 4: the earlier invocations were compared in full only against a record taken after amend and continue. The repair compares them against the pre-amend record after each command; the last three guards were added for it.
