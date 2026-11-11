---
id: T0-ASK-RECLASSIFY
title: "A revision re-classifies the revised request text with the router and stores its ambiguity, so the ask a revision answered is not asked again"
status: todo
branch: T0-ASK-RECLASSIFY
worktree: D:\wt\AIDLC\T0-ASK-RECLASSIFY
depends_on: [T0-CARDS-PROJECTED-REENTRY]
allow_paths:
  - src/loop/controller.ts
  - tests/scenarios/ask-reclassify.test.ts
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-ASK-RECLASSIFY.md
dod_command: npm run typecheck && node --test tests/scenarios/ask-reclassify.test.ts tests/scenarios/arc-reentry.test.ts tests/scenarios/amendment.test.ts tests/core/router.test.ts tests/scenarios/run-driver.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `computeRevision` builds a revised goal (reached by the `revision` report result through `aidlc goal amend` and `aidlc report --result revision`, and by the carried revision of `aidlc goal resume` with `--text`, with `--cards` only or with `--replace` only, where the text is the last revision's), THEN it shall set `routing.ambiguity` to the `ambiguity` that `classifyRequest` returns for the revised request (the revised text with the other fields of the last revision's request), the ids of the card registry it already loads as `knownCardIds`, and, when that request's `ref` is `#` followed by digits only, that number as the one `knownIssueNumbers` entry (the form `aidlc goal new --issue <n>` records, cli/main.ts:294-295); an undefined result removes the question. A revision that `computeRevision` refuses changes neither routing nor journal.
  - R2. The revision shall keep every other `routing` field as recorded: all routing fields except `ambiguity` describe the retained intake route. A revision does not reroute scope or authority; size, kind, skills and deadline are not re-derived (`--size` at intake sets them), and goal target, stages, deadlines and cards change only as main does at 92796d4f.
  - R3. WHILE a revised goal is in PLAN, `nextInPlan` (controller.ts:257, the one reader of `routing.ambiguity`) shall return `ask` with the re-classified question exactly when R1 stored one. The classes come from the router (router.ts:48, :103-117) and apply only to a revised text that matches `/^\s*#?(\d{1,6})\s*$/`, its digits compared as a number (so `07` is 7): (a) the number is the stage prefix of a registry card (`T<n>-`) and the request's issue number: the "matches both" question; (b) a stage prefix only: the "stage prefix, not a unique card id" question; (c) the issue number only: no ask; (d) neither: the "does not uniquely identify" question. Every other text is class (e), no ask: seven or more digits, a sign, a decimal point, prose, a full card id. The class decides whatever the routing held before; a goal reaches PLAN after a revision in PLAN, RUN or WAIT, and in VERIFY_ARC when the revision adds a card that is not merged (T0-CARDS-PROJECTED-REENTRY R6). In CARDS, in VERIFY_ARC without such a card, in DELIVER and in CLOSE the question is stored and not asked.
  - R4. `aidlc run` (`runGoal`, which returns `controller.next` for `ask` without a provider call) shall return the R3 `ask` of a still ambiguous revised goal, and after a revision that removed the question the directive main gives for the same goal without an ambiguity.
  - R5. Each document shall state its part of this change: `docs/ARCHITECTURE.md` in the `ask` row of the directive table that the answering revision re-classifies the text, stores only the new question, and that the other routing fields are the retained intake route; `docs/OPERATIONS.md` (Running a goal) the same in one sentence with `aidlc goal amend <id> --text "<answer>"`; the CHANGELOG entry this card id with R1, R2 and R3.
acceptance:
  - 1. `tests/scenarios/ask-reclassify.test.ts` "the revision an ask asked for answers it: the revised text is re-classified and the goal plans": a goal from the text `7` with the registry card `T7-A` gets `ask`; the revision `run card T7-A` with cards `T7-A` leaves `routing.ambiguity` undefined, every other routing field equal to intake, and `next` is `project-cards`. Fails on main: `ask` again. [R1] [R2] [R3] [dod arm 1]
  - 2. Same file "a revised text is classed by the router's bare-number rule, and each class asks the router's question for it": (a) a goal created with ref `#7`, `knownIssueNumbers` [7] and an unambiguous text, revised to `#7` and to ` 7 `; (b) an unambiguous intake revised to `7` and to `07`; (d) an unambiguous intake revised to `99`; each asks the router's question for that input. (c) a goal created with ref `#9` from the text `99` (class d) revised to `9`: no ask. A goal asking the (d) question revised to `7` asks the (b) question, asserted unequal to the prior one. Class (e), no ask after an intake of `7`: `123456` with no `T123456-` card is (d) and `1234567` is (e); `-7`, `+7`, `7.0`, `fix 7` and `T7-A`. Every case fails on main. [R1] [R3] [dod arm 1]
  - 3. Same file "the question gates only PLAN": a table over a revision to `7` (registry card `T7-A`) in each non-terminal state of a two-card goal, after its first card merged (after both for VERIFY_ARC, DELIVER and CLOSE): PLAN, RUN and WAIT reach PLAN and ask; VERIFY_ARC with an added card that is not merged reaches PLAN and asks; CARDS (an unapproved T2 revision gives `checkpoint`), VERIFY_ARC without an added card, DELIVER and CLOSE store the question and give their own directive. A refused revision (an unknown card) leaves routing and journal length unchanged. [R1] [R3] [dod arm 1]
  - 4. Same file "a resume stores the re-classified question and re-enters through CARDS": a cancelled goal resumed with `--text 7`, with `--cards` only and with `--replace` only stores the question of its revised text; `report()` then calls `next()`, so for an admissible T0 or T1 projection the result is `run-card` with the goal in RUN, and for a T2 revision not yet approved `checkpoint` with the goal in CARDS; neither asks. Fails on main for the stored question. [R1] [R3] [dod arm 1]
  - 5. Same file: `runGoal` with a `MockProvider` returns the `ask` of a still ambiguous revised goal with no provider call, and after a revision that removed the question its first directive is not `ask`. [R4] [dod arm 1]
  - 6. `tests/scenarios/arc-reentry.test.ts`, `tests/scenarios/amendment.test.ts`, `tests/core/router.test.ts` and `tests/scenarios/run-driver.test.ts` ("ask, checkpoint, release, done and stop return without provider dispatch") pass unchanged. [R2] [dod arm 1]
  - 7. The docs and the CHANGELOG state R5 (reviewer-verified against the diff). [R5]
budget: 220
diagnosis:
  root_cause: "`computeRevision` (src/loop/controller.ts:769-799) copies `goal.routing` unchanged, and `routing.ambiguity`, which `nextInPlan` reads first (:257-259), is written only by `createGoal`; so the revision that answers the ask, as the ask's `responseRoute` (`aidlc goal amend --text`) directs, leaves the question in place and the goal asks again until it is cancelled. Reproduced by audit probe `probe2.test.ts` P13 on main."
  same_class: "Every writer of `goal.routing` (`createGoal`, now `computeRevision`), every reader of `routing.ambiguity` (`nextInPlan`; `formatRouting`, printed by `aidlc goal new` only), and every caller of `classifyRequest` (`createGoal`; the UserPromptSubmit hook at src/hooks/index.ts:780, which routes a prompt and writes no goal: not affected)."
sweep: "git grep -n \"ambiguity\\|classifyRequest(\\|computeRevision(\" -- src tests on main at 92796d4f. src/core/router.ts:87,108,113,115,250,261: the router rule, unchanged. src/core/types.ts:80: the schema field, unchanged. controller.ts:120 (`createGoal`): unchanged. :257-258 (`nextInPlan`): reads the stored value, unchanged. :634 (`revision`) and :659 (carried revision of `resume`): reach `computeRevision`, covered by R1. src/hooks/index.ts:780: not affected (no goal). Test pins: tests/core/router.test.ts:6-22 assert the router's three questions (unchanged rule); tests/scenarios/run-driver.test.ts:646 saves a goal with a hand-set ambiguity and expects `ask` from `runGoal` with no revision, unchanged. No test asserts that an ask survives a revision."
forbid: ["weakening or skipping a test to go green", "a change to src/core/router.ts or to the questions it returns", "a change of size, kind, target, stages, deadlines or cards by the re-classification", "editing .aidlc state by hand"]
non_goals: ["resolving the card the revised text names into the goal's cards: the revision keeps the cards main gives it (pass --cards)", "re-deriving size, kind, skills, target or modules from the revised text", "a `GOAL_REVISED` journal field for the new ambiguity", "`aidlc goal new --card X --issue 7` records ref `X` (cli/main.ts:294-295), so its revision has no issue number and a bare `7` reads as class (b) or (d)", "issue numbers a library caller passed to `createGoal` without a `#<n>` ref, for the same reason"]
hygiene: "Line numbers are from main at 92796d4f; read them again at PREPARE. Depends on T0-CARDS-PROJECTED-REENTRY, which changes src/loop/controller.ts, docs/ARCHITECTURE.md, docs/OPERATIONS.md and CHANGELOG.md and merges first: acceptance 3 uses its VERIFY_ARC -> PLAN revision, and the DoD runs its test file. `computeRevision` stays pure: the router is a pure function and the registry is the one it already loads. This card changes no file the verify-card-run-writes coverage record names. Before the first R3, revert each source hunk in a scratch copy and run its acceptance test (lesson 2026-11-11 T0-AUDIT-FIXES). Insert the CHANGELOG entry directly above the entry that begins `- T0-PREPARE-WORKTREE (bugfix)`, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict. T0-CARDS-PROJECTED-REENTRY and T0-CHECKPOINT-PACKET-SHARED use the same anchor; the three cards build one after another, so this entry goes directly above that line, below the entry of T0-CARDS-PROJECTED-REENTRY."
doc_sync: docs/ARCHITECTURE.md (directive table, `ask` row), docs/OPERATIONS.md (Running a goal), CHANGELOG.md
---

# T0-ASK-RECLASSIFY

## Deliverable
The answer to an `ask` directive, given as the revision the ask names (`aidlc goal amend <id> --text "<answer>"`), ends the ask when the new text identifies the work; a text that is still ambiguous gets the router's question for that text.

## Why
On main the ask repeats after the revision it asked for, so the goal can only be cancelled (audit F10, probe P13). Planner decision of 2026-11-11, confirmed by the second review: the revision re-classifies the request with the router and stores only the new ambiguity; it does not clear it blindly. The other routing fields stay the intake route, because size, target and deadlines decide stages and admission that a revision must not move.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/ask-reclassify.test.ts tests/scenarios/arc-reentry.test.ts tests/scenarios/amendment.test.ts tests/core/router.test.ts tests/scenarios/run-driver.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; acceptance 1, 2 and the stored question of 4 fail on main.

## Attempt evidence

Attempt 1, effort high. RED commit 92bbd5e6 (the test file alone; all five tests failed on main at their first assertion, tests 1 to 4 on the stored or removed question, test 5 on the first `runGoal`: `plan !== ask`). `dod_command` exit code 0: typecheck clean, 85 tests, 85 pass, 0 fail.

| Item | Test or command | Result |
| --- | --- | --- |
| 1 | ask-reclassify.test.ts "the revision an ask asked for answers it: ..." | pass; fails on main: question kept |
| 2 | ask-reclassify.test.ts "a revised text is classed by the router's bare-number rule, ..." (classes a, b, c, d, e; ref forms `#7a` and `owner/repo#7`; whitespace `\t7\n`) | pass; fails on main: `(a) #7` stores no question |
| 3 | ask-reclassify.test.ts "the question gates only PLAN" (PLAN, RUN, WAIT, VERIFY_ARC with an added unmerged card, CARDS T2, VERIFY_ARC, DELIVER, CLOSE; refused revision) | pass |
| 4 | ask-reclassify.test.ts "a resume stores the re-classified question and re-enters through CARDS" (`--text`, `--cards` only, `--replace` only, T2 checkpoint) | pass; fails on main: question not stored |
| 5 | ask-reclassify.test.ts "aidlc run returns the ask of a still ambiguous revised goal ..." | pass |
| 6 | arc-reentry, amendment, router, run-driver test files unchanged | pass (in the DoD run) |
| 7 | docs/ARCHITECTURE.md `ask` row, docs/OPERATIONS.md Running a goal, CHANGELOG.md entry above T0-PREPARE-WORKTREE | written; reviewer verifies against the diff |

Revert check (each source hunk reverted alone, `ask-reclassify.test.ts` run): routing line removed fails tests 1 to 5; no issue number fails 2; no card ids fails 2 to 5; ref regex without `^` fails 2; ref regex without `$` fails 2; text of the previous revision classified fails 1 to 5; whole routing re-derived by the router fails 1; a question never removed (`ambiguity ?? previous`) fails 1, 2, 5.
