# Replacement study: why 15 replaced cards were replaced, and whether a reader of the card would have prevented it

The study of `intent/card-preflight.md`, run on 2026-11-21 on main at 62bfa646: 15 replaced cards drawn with a recorded seed, 5 first-pass controls, the cause and the termination labelled apart, one reader prompt run on all 20 cards.

Status of the labels: Claude and Codex labelled independently and gave the same label in 39 of 45 cases (15 cards, three labels each). The owner ruled the 6 differences in the session on 2026-11-21 ("The owner's rulings"). The 39 labels both models give, and the adjudication of the 20 reader findings, remain model labels. The owner delegated the sample check of those rows to the coordinator in the session; it compared 9 of the 39 labels and 2 of the 20 adjudications with the run records, git and the CI logs ("Sample check"). That check changed no label, corrected two per-card accounts and left one point to the owner. It is a model's check, not an owner's.

## Result

1. Cause: 5 cards were replaced for a cause outside the card, 7 because the card's contract was wrong, 3 for a code defect inside the contract. Both labellers gave 12 of these labels; the owner ruled 3 as contract where Codex had said code.
2. Termination: a review stop ended 7 runs, a CI stop 3, an owner decision 2, a card stop 1 and a risk stop 2. All 7 review stops are labelled `allowance`: 6 name a count limit and 1 a re-raised finding with one decision left (T0-HOOK-LAZY). The owner ruled the two risk stops as `other`, where Codex had said `ci`.
3. The reader fails the screen. It gave no finding that would have prevented a replacement: 0 of 15 cards against a threshold of 5. 18 of its 20 findings are correct (90%, threshold 80%). It returned `change-first` on 3 of the 5 controls; by the protocol's rule 1 of them is a false flag (threshold: at most 1).
4. Amendment: an amendment that kept the card's work would plausibly have avoided the replacement on 6 of 15 cards (5 by both labellers, 1 by the owner's ruling). On 4 of the 6 the stopped run would also have had to continue.
5. From git, not from a label: the successor's candidate descends from the replaced card's last candidate in 10 of 15 cases (3 do not, 2 cannot be checked), and 12 of the 15 successors merged.

## What the numbers support

- Reader: no prospective trial of this reader prompt. Its findings are true and they are not why cards were replaced. 14 of the 20 are of one kind: a requirement that no acceptance item checks, or an acceptance item the `dod_command` does not run.
- Amendment: on this sample an amendment rule reaches 6 of 15 replacements, and 4 of the 6 only if the stopped run may continue. The two that needed nothing but the card change are the two the owner replaced while the run could still continue (T1-TEST-CLI-INPROC, T0-TAKEOVER-DONE-GOAL).
- A third group that neither a reader nor an amendment reaches: runs that stopped with a contract nobody changed. 5 had a cause outside the card (a failing test of another card twice, the Gitleaks check twice, a pull request opened without a base sync once), and in each, by both labellers' reading, the successor shipped the same change under a new id. For these the replacement was the way to continue a stopped run. Why the run was replaced and not resumed was not examined; the state records hold 5 review invocations with `stopLifted`, so a ruling can lift a review stop.
- 15 cards give wide intervals: 0 of 15 puts the reader's true prevention rate below about 20% (95%), and 6 of 15 is between 20% and 64%.

## Still open

- No person has checked an agreed row. The coordinator's check covers the sample this section named before the check was run, in draw order: the labels of T0-DOD-SCAFFOLD-SHELL-3, T1-RUN-CONTEXT-PACK and T0-HOOK-LAZY, and the adjudication of the first two reader findings (T1-RUN-CONTEXT-PACK `dod_command`, T0-CLI-CWD-FILE-ARGS R1). The other 30 agreed labels and 18 agreed adjudications were not compared again. Each card's records are in `_local/replacement-study/packets/<card>.md`.
- One ruling: T0-HOOK-LAZY stopped at decision 3 of 4 on a re-raised finding, and both models label the stop `allowance`. The label brief defines `allowance` as "the review allowance was used up". Ruled `other`, the termination tally is allowance 6, ci 3, owner 2, other 4.
- The decision of `intent/card-preflight.md`, outcome 5: a prospective trial of the reader, a ruling on amendments, both, or neither.

## Inputs and frame

- Registry: `specs/tasks/` at 62bfa646, 423 cards.
- State: a copy of `.aidlc/cards` (412 run files) and `.aidlc/journal`, taken 2026-11-21T01:55:45Z. The sha256 over the list of its file hashes is `abe01e760402e6cf4d2cdb30d0ed45a0063ca480384869990a889f02c73ad351`.
- Replaced cards: 121. 118 carry `superseded_by` (recorded links). 3 carry none and are named as replaced by a successor's title (inferred links): T0-FOREIGN-DISPATCH-NO-WRITE, T0-FOREIGN-DISPATCH-NO-WRITE-2, T0-TAKEOVER-DONE-GOAL.

| Definition | Of the 118 recorded | Of all 121 |
|---|---|---|
| A run file | 115 | 118 |
| A non-empty invocation history | 95 | 97 |
| A formal pass or block | 94 | 96 |
| A recorded finding | 78 | 80 |

- Frame, by the owner's ruling in the session: the 96 replaced cards whose review ledger holds at least one formal pass or block.
- Left out, 25 cards: 3 with no run file; 21 with a run file and an empty ledger, replaced before any review ran (end states BUILD 14, SHIP 3, tool stop 4); 1 with an invocation and no decision. The study says nothing about these.
- Control frame, 104 cards: merged, one run file, every formal decision a pass, no formal finding, no `superseded_by`, at neither end of a recorded or an inferred link.

## Draw

Seed 615574712: the first 8 hex digits of sha256("replacement-study|<commit>|<state hash>|pass-or-block"). The frame's ids in ascending order were shuffled by Fisher-Yates with mulberry32(seed) and the first 15 taken; the controls with seed + 1. No drawn card was substituted.

The base of each card is the last first-parent commit of main at or before the run's `startedAt`, and the reader read `specs/tasks/<id>.md` at that commit. "Card commits" counts commits that changed the card file after the base and before the commit that added the successor file (for a control: before its merge).

| Card | Run started | End state | Formal decisions (blocks) | Findings on the run record | Card commits in the run | Successor | Base |
|---|---|---|---|---|---|---|---|
| T0-DOD-SCAFFOLD-SHELL-3 | 2026-11-17 | STOP card | 1 (0) | 0 | 0 | T0-DOD-SCAFFOLD-SHELL-4 | 6ac40d87 |
| T1-RUN-CONTEXT-PACK | 2026-10-04 | STOP ci | 2 (1) | 1 | 2 | T1-RUN-CONTEXT-PACK-2 | db566b9b |
| T0-CLI-CWD-FILE-ARGS | 2026-11-11 | STOP review | 4 (3) | 8 | 8 | T0-CLI-CWD-FILE-ARGS-2 | 6c1a6cfd |
| T1-FINDING-REPRO | 2026-11-08 | STOP risk | 2 (1) | 2 | 3 | T1-FINDING-REPRO-2 | 6698e988 |
| T0-HOOK-LAZY | 2026-10-23 | STOP review | 3 (3) | 5 | 0 | T0-HOOK-LAZY-2 | 8e33f5a2 |
| T0-BIN-STALE-DIST | 2026-09-14 | STOP review | 2 (2) | 0 | 1 | T0-BIN-STALE-DIST-2 | fdfd3aa1 |
| T1-TEST-CLI-INPROC | 2026-11-19 | REVIEW_FIX, no stop | 1 (1) | 4 | 0 | T1-TEST-CLI-INPROC-2 | 1a757adb |
| T1-INIT-HOOK-PATH | 2026-11-04 | STOP review | 5 (3) | 12 | 8 | T1-INIT-HOOK-PATH-2 | 5726c34b |
| T0-DEAD-PID-TESTS | 2026-11-17 | STOP review | 2 (1) | 1 | 0 | T0-DEAD-PID-TESTS-2 | e864b908 |
| T1-STORE-CAS | 2026-09-26 | STOP review | 4 (2) | 5 | 3 | T1-STORE-CAS-2 | 41f4319a |
| T0-OP-TIMESTAMP-NOW | 2026-11-11 | STOP risk | 1 (0) | 0 | 2 | T0-OP-TIMESTAMP-NOW-2 | 93ca9a7d |
| T1-REVIEW-BENCH-EXPORT-2 | 2026-11-06 | STOP ci | 2 (1) | 3 | 1 | T1-REVIEW-BENCH-EXPORT-3 | 4a2514ee |
| T1-TEST-AUDIT-LIST | 2026-11-19 | STOP review | 4 (4) | 5 | 0 | T1-TEST-AUDIT-LIST-2 | 1a757adb |
| T0-TAKEOVER-DONE-GOAL | 2026-11-19 | REVIEW_FIX, no stop | 2 (2) | 6 | 0 | T0-TAKEOVER-DONE-GOAL-2 (inferred) | 26cfff66 |
| T0-BIN-STALE-DIST-3 | 2026-09-15 | STOP ci | 2 (1) | 0 | 0 | T0-BIN-STALE-DIST-4 | 55298806 |

| Control | Run started | Formal decisions | Card commits in the run | Pull request | Base |
|---|---|---|---|---|---|
| T0-JOURNAL-READ-ENOENT | 2026-11-18 | 3 pass | 0 | 373 | 62dc0a50 |
| T0-R3-SECOND-PASS-ROOM | 2026-11-11 | 2 pass | 1 | 260 | 103b03f8 |
| T0-MERGED-VIEW-CHECK | 2026-11-07 | 2 pass | 1 | 216 | e1634ff1 |
| T0-CARD-GOAL-RESOLVE | 2026-09-26 | 1 pass | 1 | 74 | d44dc8f3 |
| T1-REVIEW-RESPONSES | 2026-10-23 | 1 pass | 0 | 179 | 94a4f6f6 |

The card file changed during the run in 8 of the 15 replaced cards and in 3 of the 5 controls. Amending a running card was already common, and 8 amended cards were replaced all the same.

## Labels

Cause: `contract` (the card's contract was wrong), `code` (a code defect inside the contract), `outside` (a finding outside the card). A second cause is in brackets. Termination: `allowance`, `ci`, `owner`, `other`. Amendment: would an amendment that kept the card's work plausibly have avoided the replacement. A cell in bold is the owner's ruling on a difference; the other cells are labels both models gave.

| Card | Cause | Termination | Amendment |
|---|---|---|---|
| T0-DOD-SCAFFOLD-SHELL-3 | outside | other: card stop | no |
| T1-RUN-CONTEXT-PACK | code (Claude adds contract) | ci | yes |
| T0-CLI-CWD-FILE-ARGS | code (contract) | allowance | **yes** |
| T1-FINDING-REPRO | outside | **other: risk** | no |
| T0-HOOK-LAZY | contract (Codex adds code) | allowance | no |
| T0-BIN-STALE-DIST | **contract (code)** | allowance | no |
| T1-TEST-CLI-INPROC | contract (code) | owner | yes |
| T1-INIT-HOOK-PATH | **contract (code)** | allowance | no |
| T0-DEAD-PID-TESTS | outside (code) | allowance | no |
| T1-STORE-CAS | code (contract) | allowance | no |
| T0-OP-TIMESTAMP-NOW | outside | **other: risk** | no |
| T1-REVIEW-BENCH-EXPORT-2 | contract (code) | ci | yes |
| T1-TEST-AUDIT-LIST | **contract (code)** | allowance | yes |
| T0-TAKEOVER-DONE-GOAL | contract (code) | owner | yes |
| T0-BIN-STALE-DIST-3 | outside | ci | no |

| Label | Value | Claude | Codex | Both | After the rulings |
|---|---|---|---|---|---|
| Cause | outside | 5 | 5 | 5 | 5 |
| Cause | contract | 7 | 4 | 4 | 7 |
| Cause | code | 3 | 6 | 3 | 3 |
| Termination | allowance | 7 | 7 | 7 | 7 |
| Termination | ci | 3 | 5 | 3 | 3 |
| Termination | owner | 2 | 2 | 2 | 2 |
| Termination | other | 3 | 1 | 1 | 3 |
| Amendment | yes | 6 | 5 | 5 | 6 |
| Amendment | no | 9 | 10 | 9 | 9 |

Agreement between the two models: cause 12 of 15, termination 13 of 15, amendment 14 of 15. Every termination label matches the stop the machine recorded: `allowance` is a review stop, `ci` a ci stop, `owner` a run with no stop, `other` the card stop and the two risk stops. The 7 review stops by their recorded detail: "second substantive block" 3, "fourth decision blocked: the 4-decision allowance for repairs is used" 2, "exceeds the two-decision allowance" 1, and "third substantive block re-raised unresolved finding(s) F3" 1. The last is T0-HOOK-LAZY, stopped at decision 3 where the limit was 4.

### What the records show, per card

The accounts are the labellers' reading of the records, condensed. The label files name the findings, stops and commits each rests on.

| Card | Why it was replaced | Amendment |
|---|---|---|
| T0-DOD-SCAFFOLD-SHELL-3 | CI failed two tests in files outside the card: a pid-reuse race in `tests/scenarios/review-release.test.ts` (issue 312) and a process-listing timeout in `tests/infra/stray-processes.test.ts`. The run's note names only the first; the second is from the CI log. The effort ladder stopped the card on the same cause twice. The successor merged the same candidate with the contract unchanged. | No: nothing in the card to change. The run needed a way to continue after main held the fix. |
| T1-RUN-CONTEXT-PACK | On the Windows runner 8 tests failed, each with the error the candidate throws in `src/loop/context-pack.ts`, the file the card delivers. The successor's card names short-name canonicalization and the helper's start-up, and its fix changes the path resolution and raises the helper timeout from 15 s to 60 s. | Yes: the successor inherited the candidate and only added items. Pull request 145 was closed and the work merged as 146. The repaired file needs a new review. |
| T0-CLI-CWD-FILE-ARGS | Three blocks on candidate defects used the four decisions. The card was changed in 8 commits during the run. | Yes, by the owner's ruling, with one more review decision admitted: the successor carried the change with the requirements word for word and changed one acceptance item. Codex said no: a card change neither repairs the test guard nor reopens the allowance. |
| T1-FINDING-REPRO | The Gitleaks job failed at its install step before any scan, and the loop read the red check as a security finding. R3 had passed twice. | No: no card item was wrong. The run needed the false stop cleared. |
| T0-HOOK-LAZY | R2, R3 and acceptance 3 prescribed a config stamp that cannot be tied to the schema the process loaded (F3 re-raised at decision 3). The successor dropped the stamp and started from main. | No: the fix removes the card's main deliverable. |
| T0-BIN-STALE-DIST | Decision 1 blocked on points acceptance 1 and 2 did not state; the card was rewritten a minute later. Decision 2 blocked on defects in the repair. | No: the card was already amended. The run needed more review decisions. |
| T1-TEST-CLI-INPROC | The card forbade any change under `src/`, and the repair of F2 needs a reset in `src/state/paths.ts`. The owner replaced it in REVIEW_FIX. | Yes: the successor's diff is additions to the contract, and it carried the candidate with the four acceptance tests unchanged. |
| T1-INIT-HOOK-PATH | R5 had `aidlc doctor` run the wired command; two decisions found ways that reached repository code, and 5 commits rewrote the requirements. The stopping finding F12 was a wrong root passed in `src/cli/main.ts`. | No: amended 8 times already. The stop was the allowance. |
| T0-DEAD-PID-TESTS | CI failed on `tests/infra/stray-processes.test.ts` (issue 359), outside the card. The repair candidate needed a review the two-decision allowance no longer had. | No: the successor's contract is the same text. |
| T1-STORE-CAS | Both blocks are defects in the takeover code the candidate wrote (F2 to F4). | No: amended 3 times already. The repairs needed more review decisions, not another contract. |
| T0-OP-TIMESTAMP-NOW | Gitleaks flagged a lesson line that another card's close had committed to main. The candidate's diff does not hold it, and R3 had passed. | No: the finding was on main. The successor shipped the same change. |
| T1-REVIEW-BENCH-EXPORT-2 | R6 prescribed the `wx` flag in `src/review/bench.ts`, which a repository guard allows only in `src/state/store.ts`, and the `dod_command` ran neither failing guard. CI found both after R3 had passed. | Yes: reword R6, name the shared parser in R12, add the two guards to the DoD. The successor carried the candidate and merged after one decision. |
| T1-TEST-AUDIT-LIST | The markdown-row-bypass finding F5 came back at decisions 2, 3 and 4. The owner moved the rows to a JSON file. Ruled contract: R1 and R4 made a hand-written table the only source. Codex read the parser's defects as the cause. | Yes: the successor is the same work under changed R1 and R4. It needs new review decisions too. |
| T0-TAKEOVER-DONE-GOAL | R1 and R2 did not name the read that decides DONE, so the reviewer held them to cover a DONE saved after the read. The owner scoped them to one read and moved the race to issue 387. | Yes: the successor carried the candidate, added one commit and passed at its first decision. |
| T0-BIN-STALE-DIST-3 | The pull request conflicted on CHANGELOG.md with a card merged during the run, and the ship path had opened it without a base sync, so CI ran no workflow. | No: the run needed main merged and a new review and ship. |

### Amendment, in numbers

- `yes`, 6 cards: 5 by both labellers and T0-CLI-CWD-FILE-ARGS by the owner's ruling. 2 needed only the card change: both were replaced by an owner decision while the run could continue. 4 also needed the stopped run to continue: a CI stop lifted (T1-RUN-CONTEXT-PACK, T1-REVIEW-BENCH-EXPORT-2) or further review decisions (T1-TEST-AUDIT-LIST, T0-CLI-CWD-FILE-ARGS).
- `no`, 9 cards, all by both labellers. 5 had a cause outside the card. 3 had already been amended during the run and stopped on the allowance. 1 lost its design.
- The ruled difference turned on whether an amendment comes with a further review decision. Both labellers name that condition on other rows as well, so the count of `yes` depends on it: 2 without any continuation of a stopped run, 6 with it.
- The study measures no counterfactual. Each `yes` is a judgement with its reason.

### What happened to the successor (from git and the run records)

| Fact | Cards |
|---|---|
| The successor's candidate descends from the replaced card's last candidate | 10 of 15 |
| It does not | 3: T0-CLI-CWD-FILE-ARGS, T0-HOOK-LAZY, T0-OP-TIMESTAMP-NOW |
| Not checkable, the September candidate objects are gone | 2: T0-BIN-STALE-DIST, T0-BIN-STALE-DIST-3 |
| The successor's run record shows a verified merge | 12 of 15 |
| The successor was itself replaced | 2: T0-BIN-STALE-DIST-2, T1-TEST-AUDIT-LIST-2 |
| The successor merged with no block | 9 of 15 |

Descent shows that the commits were kept, not that the source and test changes stayed the same.

### The owner's rulings

The owner ruled the 6 differences on 2026-11-21 in the session, in five questions that gave each side's label and reason. Each ruling is the label Claude gave. The coordinator, which is the Claude side, wrote the questions and marked a recommendation on the termination question only, because the label brief lists `risk` as an example of `other`.

| Card | Label | Claude | Codex | Ruling |
|---|---|---|---|---|
| T1-FINDING-REPRO, T0-OP-TIMESTAMP-NOW | Termination | `other: risk`. The stop record's reason is `risk`, a separate stop reason from `ci`, with the next action "the gate is never rerun or bypassed". | `ci`. The stop was raised by a red CI check (`OPERATION_RESULT` failed, `ci-red`). | `other: risk` |
| T0-BIN-STALE-DIST | Cause | `contract (code)`. Decision 1 blocked on three points that acceptance 1 and 2 did not state, and commit feec4bf2 rewrote both items. | `code`. The stop came at decision 2 on defects in the repair, under requirements that covered them by then. | `contract (code)` |
| T1-INIT-HOOK-PATH | Cause | `contract (code)`. Most findings came from the launch that R5 and the notes prescribed; 5 commits rewrote the requirements; the budget went from 220 to 500. | `code (contract)`. The finding at the stop, F12, is a wrong root in `src/cli/main.ts`, and the successor fixed that call. | `contract (code)` |
| T1-TEST-AUDIT-LIST | Cause | `contract (code)`. R1 and R4 made a hand-written Markdown table the source, and each repair closed one Markdown form of the same class. | `code`. The candidate broke the existing coverage and validation requirements; the records do not show the contract was contradictory or unachievable. | `contract (code)` |
| T0-CLI-CWD-FILE-ARGS | Amendment | `yes`, with one more review decision admitted. | `no`. A card change neither repairs the guard nor reopens the allowance. | `yes`, with one more decision |

## Reader

One prompt, the same text for all 20 cards, run by Codex gpt-6-astra at reasoning effort medium with `--sandbox read-only` in a detached worktree at each card's base. It asked whether the card could start as written, and for each defect the path and line that show it. The prompt does not say which cards were replaced. All 20 outputs parse; no run was repeated.

| Card | Kind | Verdict | Findings | Correct | Prevents |
|---|---|---|---|---|---|
| T0-DOD-SCAFFOLD-SHELL-3 | replaced | start | 0 | | |
| T1-RUN-CONTEXT-PACK | replaced | change-first | 1 | 1 | 0 |
| T0-CLI-CWD-FILE-ARGS | replaced | change-first | 1 | 1 | 0 |
| T1-FINDING-REPRO | replaced | change-first | 2 | 2 | 0 |
| T0-HOOK-LAZY | replaced | change-first | 2 | 2 | 0 |
| T0-BIN-STALE-DIST | replaced | start | 0 | | |
| T1-TEST-CLI-INPROC | replaced | change-first | 1 | 1 | 0 |
| T1-INIT-HOOK-PATH | replaced | change-first | 2 | 2 | 0 |
| T0-DEAD-PID-TESTS | replaced | change-first | 1 | 1 | 0 |
| T1-STORE-CAS | replaced | change-first | 1 | 1 | 0 |
| T0-OP-TIMESTAMP-NOW | replaced | start | 0 | | |
| T1-REVIEW-BENCH-EXPORT-2 | replaced | change-first | 3 | 2 | 0 |
| T1-TEST-AUDIT-LIST | replaced | start | 0 | | |
| T0-TAKEOVER-DONE-GOAL | replaced | change-first | 1 | 1 | 0 |
| T0-BIN-STALE-DIST-3 | replaced | start | 0 | | |
| T0-JOURNAL-READ-ENOENT | control | change-first | 1 | 0 | n/a |
| T0-R3-SECOND-PASS-ROOM | control | start | 0 | | |
| T0-MERGED-VIEW-CHECK | control | start | 1 | 1 | n/a |
| T0-CARD-GOAL-RESOLVE | control | change-first | 2 | 2 | n/a |
| T1-REVIEW-RESPONSES | control | change-first | 1 | 1 | n/a |

### The 20 findings

Claude and Codex adjudicated each finding independently against the base checkout and the records. Their marks for `correct`, `actionable` and `prevents` are the same on all 20 findings. Every finding is actionable. "Later change" says whether a later commit to the card file, or the successor, changed what the finding names.

| Card | Item | Kind of finding | Blocking | Correct | Prevents | Later change, Claude / Codex |
|---|---|---|---|---|---|---|
| T1-RUN-CONTEXT-PACK | dod_command | the DoD does not run an acceptance item | yes | yes | no | no / no |
| T0-CLI-CWD-FILE-ARGS | R1 | a requirement with no acceptance check | yes | yes | no | no / no |
| T1-FINDING-REPRO | acceptance 8 | a requirement with no acceptance check | yes | yes | no | no / no |
| T1-FINDING-REPRO | R3 | a requirement with no acceptance check | yes | yes | no | no / no |
| T0-HOOK-LAZY | budget | the budget does not fit | yes | yes | no | yes / yes |
| T0-HOOK-LAZY | R3 | a requirement with no acceptance check | yes | yes | no | yes / yes |
| T1-TEST-CLI-INPROC | acceptance 1 | a requirement with no acceptance check | yes | yes | no | no / yes |
| T1-INIT-HOOK-PATH | R2 | a requirement with no acceptance check | yes | yes | no | no / no |
| T1-INIT-HOOK-PATH | R4 | a requirement with no acceptance check | yes | yes | no | yes / yes |
| T0-DEAD-PID-TESTS | dod_command | the DoD does not run an acceptance item | yes | yes | no | no / no |
| T1-STORE-CAS | acceptance 9 | the DoD does not run an acceptance item | yes | yes | no | yes / yes |
| T1-REVIEW-BENCH-EXPORT-2 | body | a statement the checkout does not support | yes | no | no | no / no |
| T1-REVIEW-BENCH-EXPORT-2 | R11 | a requirement that contradicts kept behaviour | yes | yes | no | no / no |
| T1-REVIEW-BENCH-EXPORT-2 | R1 | a requirement with no acceptance check | yes | yes | no | no / no |
| T0-TAKEOVER-DONE-GOAL | acceptance 3 | a requirement with no acceptance check | yes | yes | no | yes / yes |
| T0-JOURNAL-READ-ENOENT | acceptance 7 | the DoD does not run an acceptance item | yes | no | n/a | no / no |
| T0-MERGED-VIEW-CHECK | body | a statement the checkout does not support | no | yes | n/a | no / no |
| T0-CARD-GOAL-RESOLVE | R4 | a requirement with no acceptance check | yes | yes | n/a | no / no |
| T0-CARD-GOAL-RESOLVE | R2 | a statement the checkout does not support | yes | yes | n/a | no / no |
| T1-REVIEW-RESPONSES | allow_paths | the work needs a file outside `allow_paths` | yes | yes | n/a | no / no |

- By kind: a requirement with no acceptance check 10; the DoD does not run an acceptance item 4; a statement the checkout does not support 3; the budget, a contradiction, a file outside `allow_paths` 1 each.
- The two findings marked not correct: the card already covers the point (T1-REVIEW-BENCH-EXPORT-2 names its carried branch; T0-JOURNAL-READ-ENOENT says why two suites run outside the DoD).
- Two findings name a point the formal review raised later (T1-STORE-CAS F1, T0-TAKEOVER-DONE-GOAL F2). In both the same decision carried other findings, so the block stands without them.
- Of the 7 cards with a contract cause, 5 got findings and none names what was wrong: the stamp of T0-HOOK-LAZY, the `src/` ban of T1-TEST-CLI-INPROC, the launch that R5 of T1-INIT-HOOK-PATH prescribed, R6 of T1-REVIEW-BENCH-EXPORT-2 (the guard it breaks, `tests/infra/update-json.test.ts:193-198`, was in the base checkout), the deciding read of T0-TAKEOVER-DONE-GOAL. The other 2 got no finding (T0-BIN-STALE-DIST, T1-TEST-AUDIT-LIST).
- 5 replaced cards got no finding: those 2, and 3 with an outside cause, where the card had nothing to find.

## Screening numbers

Thresholds of `intent/card-preflight.md:65-69`. The three ways of counting (Claude's marks, Codex's marks, the marks both agree on) give the same numbers.

| Number | Value | Threshold | Met |
|---|---|---|---|
| N1: replaced cards with a finding that is correct, actionable and would have prevented the replacement | 0 of 15 | at least 5 | no |
| N2: correct findings over all findings | 18 of 20, 90% | at least 80% | yes |
| N3: controls flagged falsely (`change-first`, and no blocking finding on the card is correct) | 1 of 5 | at most 1 | yes, by this rule |

- N3 depends on the rule. 3 of 5 controls came back `change-first`. The rule fixed before the run counts a flag as false only when no blocking finding on the card is correct, which gives 1 (T0-JOURNAL-READ-ENOENT). All three controls merged on a first pass, so if every `change-first` on a control counts as false, N3 is 3 and that threshold fails too.
- N1 could not exceed 10: 5 of the 15 cards have a cause outside the card.
- The stop rule did not cut the work short: every finding was adjudicated before N1 was known.

## Sample check

The consensus plan left the agreed rows provisional until the owner had checked a sample. On 2026-11-21 the owner delegated that check to the coordinator in the session ("can you help to finish the test I will not be at the computer"). The sample is the one "Still open" named before the check. The coordinator compared each row with the frozen run records, with git and with two CI logs read from GitHub on 2026-11-21. The CI logs were not in the packets the labellers had.

| Row | Compared with | Result |
|---|---|---|
| T0-DOD-SCAFFOLD-SHELL-3, cause `outside` | CI run 44010710725; the card's `allow_paths` at the base; the files candidate a5b8a63d changes | Holds. Two tests failed, in `tests/scenarios/review-release.test.ts` and `tests/infra/stray-processes.test.ts`. The card allows neither file and the candidate changes neither. |
| T0-DOD-SCAFFOLD-SHELL-3, termination `other: card stop` | the stop record | Holds: reason `card`, the same cause twice. |
| T0-DOD-SCAFFOLD-SHELL-3, amendment `no` | the changed lines of a5b8a63d against its merge-base, and of the merged successor 959d3153 (pull request 364) | Holds. Under `src` the 27 changed lines are the same. Under `tests` 6 of 200 differ and under `docs` 2 of 4, each in the card id or in the list of replaced cards. |
| T1-RUN-CONTEXT-PACK, cause `code` | CI run 37192764034 on pull request 145; candidate 2ff6099e; the merged successor 71341f85 | Holds. On the Windows runner 8 of 1,281 tests failed, each with the error the candidate throws at `src/loop/context-pack.ts:47`; the Ubuntu job passed. The fix changes that file by 24 added and 15 removed lines. |
| T1-RUN-CONTEXT-PACK, termination `ci` | the stop record | Holds: reason `ci`. |
| T1-RUN-CONTEXT-PACK, amendment `yes` | the successor card at 8ae4966d; pull requests 145 and 146 | Holds as far as records show. The successor names 2ff6099e as inherited, and against the replaced card as amended its contract has additions only: R4, acceptance 5 and 6, two `allow_paths` entries, budget 650 to 900. |
| T0-HOOK-LAZY, cause `contract` | findings F3 to F5; the card at the base; commit 42de982f; the successor card | Holds. Four requirement lines of the base card name the stamp, F3 shows it cannot be tied to the schema the process loaded, and the successor forbids a stamp. |
| T0-HOOK-LAZY, termination `allowance` | the stop record; `src/core/review-policy.ts:182-187` and `MAX_R3_DECISIONS` at the base | Depends on the definition. The stop is the rule for a re-raised finding, at decision 3 where the limit was 4. Left to the owner. |
| T0-HOOK-LAZY, amendment `no` | the successor card; git ancestry | Holds: the successor starts from main and does not carry the candidate. |
| Reader finding on T1-RUN-CONTEXT-PACK, `dod_command`: correct, does not prevent | the card at db566b9b, lines 18 and 28; `package.json`; the DoD receipt; the CI log | Both marks hold. The receipt records `npm run check` run locally with 1,276 passes. The failures came on the Windows runner only, and the successor keeps the same `dod_command`. |
| Reader finding on T0-CLI-CWD-FILE-ARGS, R1: correct, does not prevent | the card at 6c1a6cfd; `src/cli/main.ts:1380`; the last candidate 04fccad1; the run record | Both marks hold. Of the 8 acceptance items only item 4 names a hook, and it gives an invalid `-C`. The last candidate already held the test the reader asks for (`tests/surface/cli-cwd-paths.test.ts:528-542`), and the run still stopped at decision 4 on F8. |

- 8 of the 9 labels and all 4 adjudication marks hold against the records. The ninth label depends on a definition. No label was changed.
- Two accounts in "What the records show, per card" were corrected: the second failing test of T0-DOD-SCAFFOLD-SHELL-3, from the CI log, and pull request 145 of T1-RUN-CONTEXT-PACK, which was closed while the work merged as 146.
- What the check is not. The coordinator is the Claude side, built the packets and had read every label. An amendment label is a judgement that records can support and cannot prove. The check gives no error rate for model labels of the kind an owner's check would give.

## Deviations from the intent and the protocol

1. Base. The protocol first took the merge-base of the first recorded candidate and main. That commit is later than the run's start for 8 of the 20 cards, because the card was amended or main was merged into the branch before the first review. The rule was changed after the draw and before any label or reader run to the last first-parent commit of main at or before `startedAt`. The draw did not change.
2. Who labelled. The intent says the coordinator labels. Claude's 15 labels and 20 adjudications were written by 10 subagents of the coordinator session, each given the same brief and packet as Codex and no reader output before its labels were written. The coordinator read every label and changed none.
3. Stop rule. The 20 reader runs were issued together, because a check between runs needs both adjudicators.
4. An added mark. The adjudication brief asked for "later change" as well. It is not in the protocol and enters no threshold.
5. Evidence packets. The coordinator's script built one packet per card from the registry, the state copy and git. It cut long diffs (9,000 characters per commit, 30,000 for the successor); one labeller read the cut parts from git.
6. Leak check. A pattern scan over the commands in each Codex log: 147 reader commands, none read outside its worktree or a git object not reachable from the base (two hits were search strings holding the word "origin"); 47 label and 103 adjudication commands, none read the other party's output. Claude's subagents were instructed the same way and their transcripts were not scanned.
7. Sample check. The consensus plan has the owner check a sample of the agreed rows. The owner delegated the check to the coordinator ("Sample check"). The check read two CI logs from GitHub, which are outside the frozen inputs.

## Limits

- Model labels. The owner ruled the 6 differences from the two reasons as the coordinator put them. No person has checked the 39 agreed labels or the 20 agreed adjudications; the sample check was the coordinator's.
- The labellers had the run's own notes on a CI failure, not the CI log. In one of the two sampled cards with a CI failure the note left out a failing test (T0-DOD-SCAFFOLD-SHELL-3). The CI logs of the other cards were not read.
- The adjudicators knew which cards were replaced and how each run ended.
- A numeric suffix or a title "(replaces ...)" tells the reader that a card is a successor, and the control frame holds no successor.
- The frame leaves out 25 of 121 replaced cards, 21 of them replaced before any review.
- "First-pass" for the controls means every formal decision passed. 3 of the 5 control cards were still changed during the run.
- One reader prompt at one effort level. A different prompt was not tried, and the result says nothing about one.

## Cost

| Item | Value |
|---|---|
| Coordinator session | 01:52Z to 04:00Z, about 50 minutes of it work and the rest waiting for the owner's answers; the sample check from 06:38Z to 08:10Z, about 40 minutes of it work; cap 4 hours |
| Codex runs | 49 runs, 2,934 s summed: reader 20 runs 1,648 s, labels 15 runs 641 s, adjudication 14 runs 645 s |
| Claude subagents | 10 runs, 5,423 s summed, 2.04 million tokens: labels 5 runs 3,638 s, adjudication 5 runs 1,785 s |
| Owner | the frame ruling and five rulings on the 6 differences, by question in the session; the sample check delegated to the coordinator |

## Files

Not committed, under `_local/replacement-study/` in the main checkout: the protocol and its corrections (sha256 `25f446d3c816ae50`, `6f0ca09e33c69399`), `frame.json`, `draw.json`, the evidence packets, the reader prompt (`2b37d6535406cd1c`), the label and adjudication briefs (`2ebfc6009ef74e25`, `7f0a5aa71ceecb0f`), the 20 reader outputs with their logs, both sets of labels and adjudications, `summary.json`, the scripts `01-frame.mjs` to `09-facts.mjs` that produced every table above "Sample check", and for the sample check `sample-check.md` (the commands and the records compared) with the two CI logs under `ci-logs/`.
