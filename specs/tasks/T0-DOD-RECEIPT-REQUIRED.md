---
id: T0-DOD-RECEIPT-REQUIRED
title: A successful attempt without a DoD receipt, or with a blank one, is refused after every existing refusal and before anything of the attempt is recorded, from the CLI and every library caller; the build directives, the skill file and the help name --dod-receipt
status: merged
branch: T0-DOD-RECEIPT-REQUIRED
worktree: D:\wt\AIDLC\T0-DOD-RECEIPT-REQUIRED
size_exception: "approved by the coordinator as planner and approver of the audit changes under the owner's (asun28) instructions of 2026-11-11 and 2026-11-12: about 14 changed source lines (src/loop/card-runner.ts 12: the refusal and its comment, the default removed, the two narrations, the two-line heartbeat comment; src/cli/main.ts 2: the option description), 54 lines of the two card-loop.md copies (13 lines removed and 14 added in each, most of them the byte cut that makes room under the 6,500-byte cap), 4 document lines (docs/OPERATIONS.md 2, CHANGELOG.md 2), 4 lines of the verify skill at CLOSE (its two sync-commit references), about 430 lines of tests/scenarios/dod-receipt-required.test.ts (the input classes, nine neighbour rows and the probe rows on a scripted git fixture for two ship paths, the owed-delivery retry, the narrations, the CLI children with and without a run, the preservation rows and the document checks) and about 100 lines of attempt evidence; budget counts added plus deleted lines (tests/surface/budget-doc.test.ts:13)"
allow_paths:
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - tests/scenarios/dod-receipt-required.test.ts
  - .claude/skills/aidlc-loop/card-loop.md
  - templates/claude/skills/aidlc-loop/card-loop.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - .claude/skills/verify-card-run-writes/SKILL.md
  - specs/tasks/T0-DOD-RECEIPT-REQUIRED.md
dod_command: npm run typecheck && node --test tests/scenarios/dod-receipt-required.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/dirty-success.test.ts tests/scenarios/journal-owed.test.ts tests/scenarios/mutants-review.test.ts tests/scenarios/candidate-withdraw.test.ts tests/scenarios/review-block.test.ts tests/scenarios/accept-table.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/card-terminal-goal.test.ts tests/scenarios/card-close-cleanup.test.ts tests/surface/templates.test.ts tests/surface/command-lines.test.ts tests/surface/unattended.test.ts tests/surface/pre-review.test.ts tests/surface/mirror.test.ts
dod_exit: 0
requirements:
  - R1. WHEN execution of `CardRunner.recordAttempt` (src/loop/card-runner.ts:1043-1114 on main at 6b89407f) reaches the guard of R2 with `input.outcome` exactly `success` and `input.dodReceipt` absent, not a string (`null`, a number: reachable only from a caller outside TypeScript) or blank (`input.dodReceipt.trim() === ''`: the empty string, or only characters `String.prototype.trim` removes, among them space, tab, line feed, carriage return, U+00A0, U+FEFF and U+2028), it shall throw an Error with the message of Exact text and record no attempt or attempt evidence: no card-run write of the call (the card-run file keeps its bytes, `journalOwed` included), no `ATTEMPT_STARTED` or `ATTEMPT_FINISHED`, no effort, candidate, receipt or pending-repair change. A receipt the stored run already holds does not count. A non-blank string is accepted and stored exactly as given, surrounding white space included, as on main; `dod:<timestamp>` written by a caller is a string like any other. The exact DoD error applies only when execution reaches this guard. Earlier read, marker, lock and owed-delivery errors propagate unchanged; previously delivered owed events remain delivered. The guard introduces no additional lock and performs no attempt write or append. The check is in `recordAttempt`, so `aidlc card attempt` (src/cli/main.ts:595, the only caller in src) and every library caller get it, on every ship path and for tdd and non-tdd cards. CLI initialization of a previously absent card run is unchanged and may create the run and its `CARD_DISPATCHED` event before this check (`cardCtx` reaches `ensureCardRun` at src/cli/main.ts:565 before `recordAttempt`; src/loop/controller.ts:711-735).
  - R2. The guard shall be the last statement of the `if (input.outcome === 'success') {` block of `recordAttempt` (the block that begins with the worktree probe `if (this.config.shipPath !== 'dry-run' && run.worktree && existsSync(run.worktree)) {`), directly after `if (candidate && (clearsMerge || repairsBaseSync)) candidate = { ...candidate, baseSync: true };`, so that it runs after every existing refusal of `recordAttempt` and `finishAttempt` and before `const checksHold = ...` and the save `const saved = this.save({ ...run, effort: episode, dodReceipt: ...` (:1111), the first write of the attempt (the run save that carries the attempt record and its owed `ATTEMPT_STARTED` and `ATTEMPT_FINISHED`, which `deliverOwed` appends after it). The order after the card: the stored-run read (:1047); the mutant-marker check (:1050-1059); the delivery of owed events of earlier commands (:1061); the lost checks of a success (:1063); the missing RED receipt on a tdd card (:1066); when no attempt runs, the admission (:1070-1076: `no attempt may start: ...` for a stopped episode, `episode already succeeded; ...` naming `aidlc card withdraw`); `finishAttempt` (:1077; src/core/effort.ts:201-205, for a success the terminal-episode refusal naming the stop); the worktree probe (:1081-1089, a read; a probe that throws keeps the prior candidate) and its dirty refusal (:1092); the withdrawn-candidate refusal (:1097); this guard; the save. Every existing diagnostic keeps its place, so docs/OPERATIONS.md:84 (pinned by tests/scenarios/t0-flow.test.ts:4629), T0-RUNNING-REPAIR-STOP R1 and T0-CANDIDATE-WITHDRAW R8 stay true as worded. The checks inside the save (the card-run lock, the revision compare-and-set `CARD_RUN_STALE` of `GoalStore.saveCardRun`, src/state/goal-store.ts:61-68, and the `CardRun` schema of `updateCardRun`) sit in the function that writes, so the guard cannot follow them; for a success without a receipt it now answers first, and for every other input they are unchanged.
  - R3. The default of :1111, which stores `dod:<now>` when a success carries no `dodReceipt`, shall be removed: a success stores `input.dodReceipt`, and a fail or not-counted attempt sets the receipt as on main (cleared, or kept under `checksHold`). Every outcome other than exactly `success` bypasses this guard and retains existing processing and validation. `Success` is rejected at save; `running` is accepted by the existing Attempt schema (src/core/types.ts:620, src/core/effort.ts:207-220). This card adds no outcome validation.
  - R4. These shall stay as on main: stored runs holding `dod:<timestamp>`, an empty or a white-space receipt parse and are read unchanged (an empty one reads as absent, a white-space one as present); the SHIP readiness (`buildIncomplete` and `candidateReady`, :699-700, and the re-reads at :1368 and :1402); a not-counted attempt keeps a stored receipt without lost checks and clears it with lost checks (:1109-1111); the reuse of a kept receipt (:420-441, :648); the Stop hook (src/hooks/index.ts:685); every write that clears the receipt. The receipt stays the session's own statement: no format, no file check, no rerun, and no document says it is verified.
  - R5. The two build narrations shall name the flag as Exact text gives: the tdd narration before RED (:1036) and the other one (:1037); the phrases the existing tests match stay (`establish behavioural RED first`, `implement/repair within allow_paths`, the acceptance-table text once at the end). The REVIEW_FIX narration (:788) already names `--dod-receipt ...` and is not changed.
  - R6. The `--dod-receipt <text>` option of `aidlc card attempt` (src/cli/main.ts:589) shall gain the description of Exact text; it stays an optional option of the parser, since a fail or not-counted attempt needs no receipt.
  - R7. Both copies of card-loop.md (.claude/skills/aidlc-loop/ and templates/claude/skills/aidlc-loop/) shall get the replacements of Exact text, which add the flag to the success command and cut 67 bytes elsewhere in the file with no instruction lost, so each copy goes from 6,498 to 6,496 bytes (cap 6,500, tests/surface/templates.test.ts:19), stays ASCII and stays identical to the other; the lines other tests pin stay (Exact text lists them).
  - R8. docs/OPERATIONS.md shall carry sentences D1 and D2 of Exact text on the line of :82, directly after the sentence that begins `A success attempt on a \`tdd: true\` card is refused` (tests/surface/pre-review.test.ts:1229 pins that sentence; it stays word for word). CHANGELOG.md, Unreleased, shall carry the entry of Exact text directly above the entry that begins `- T0-AUDIT-FIXES`, followed by a blank line. These stay, each for the reason body section Unchanged text gives: docs/OPERATIONS.md:69, :84 and :96, README.md:38, docs/ARCHITECTURE.md, CLAUDE.md:150 and templates/CLAUDE.aidlc.md:33, the T0-DIRTY-SUCCESS-2 entry of CHANGELOG.md and the diagnose and tdd skills.
  - R9. The comment of the card-lease heartbeat in `CardRunner.next` (:623-624, `// Heartbeat: the owner's own \`card next\` renews the card lease, as the controller renews the goal` and the first words of the next line, `// lease.`) shall be replaced by the two lines of Exact text, which say what the code below it does: the owner's `card next` renews the card lease it holds (owner session and host this process's, `run.ownerGeneration` equal to the lease generation, :628), and nothing renews the goal lease. No code changes with it.
acceptance:
  - 1. `tests/scenarios/dod-receipt-required.test.ts` "a success without a DoD receipt, or with a blank one, is refused and records nothing": absent, empty, each white-space row, `null` and `42`, on a tdd and a non-tdd card, give the exact message, a byte-identical run and attempt 1 still running; a non-blank receipt then records. Fails on main. [R1] [R3] [dod arm 1] Detail: body section Acceptance detail, item 1.
  - 2. Same file, "a receipt the stored run holds does not stand in for the attempt's". Fails on main. [R1] [dod arm 1] Detail: body section Acceptance detail, item 2.
  - 3. Same file, "a non-blank receipt is stored as given, and other outcome strings bypass the guard": spaces kept, the generated form accepted, fail, not-counted, `Success` and `running`. Passes on main and with this card. [R1] [R3] [dod arm 1] Detail: body section Acceptance detail, item 3.
  - 4. Same file, "every existing refusal still comes first": nine neighbours, each met by a success with no receipt, give their message of main; the owed row also checks a failed and a retried delivery. The owed row fails on main; the other eight pass on main. [R1] [R2] [dod arm 1] Detail: body section Acceptance detail, item 4.
  - 5. Same file, "the DoD refusal comes after the probe, on the github and scaffold paths, and before the save". Fails on main. [R2] [dod arm 1] Detail: body section Acceptance detail, item 5.
  - 6. Same file, "the build directives name --dod-receipt". Fails on main. [R5] [dod arm 1] Detail: body section Acceptance detail, item 6.
  - 7. Same file, "aidlc card attempt refuses a success without a receipt, and its help says the option is required on success": CLI children on an existing run, on a card with no run, and the help. Fails on main. [R1] [R6] [dod arm 1] Detail: body section Acceptance detail, item 7.
  - 8. Same file, "stored receipts and not-counted attempts are read as before": the generated form ships, legacy empty and white-space receipts, a stored receipt kept or cleared by not-counted attempts. Passes on main and with this card. [R4] [dod arm 1] Detail: body section Acceptance detail, item 8.
  - 9. Same file, "the documents and both card-loop copies name the DoD receipt": D1 and D2 after the pinned RED sentence, the :84 sentence unchanged, the CHANGELOG entry above T0-AUDIT-FIXES, the two copies identical, ASCII, under the cap, with the new line and every pinned line. Fails on main. [R7] [R8] [dod arm 1] Detail: body section Acceptance detail, item 9.
  - 10. The other files of the DoD pass unchanged, and the fault-point check adds no pin. Passes on main and with this card. [R2] [R4] [R5] [R7] [R8] [dod arm 1] Detail: body section Acceptance detail, item 10.
  - 11. The default removal, the heartbeat comment, the CHANGELOG entry and the card-loop cuts are as Exact text states (reviewer-verified against the diff). [R3] [R7] [R8] [R9] Detail: body section Acceptance detail, item 11.
depends_on: [T0-OP-TIMESTAMP-NOW-2]
budget: 610
tdd: true
diagnosis:
  root_cause: "`CardRunner.recordAttempt` stores `input.dodReceipt` on a success, or `dod:<now>` when the input has none (src/loop/card-runner.ts:1111 at 6b89407f), and `--dod-receipt` is an optional flag with no description (src/cli/main.ts:589), while the tdd build narration names `--outcome success|fail --cause ...` and no receipt flag (:1036), the other build narration says `with the DoD receipt` without the flag (:1037) and the skill line (card-loop.md:56-57) shows none. A session that follows them records a success with a receipt nobody stated, and the SHIP readiness reads only whether a receipt is present (`candidateReady`, :700). An empty `--dod-receipt` is stored as given and read as absent, so the card stays in BUILD with a succeeded episode and the next success is refused with `episode already succeeded`; a receipt of spaces is read as present."
  repro: "C:\\Users\\Admin\\AppData\\Local\\Temp\\claude\\ba6303180ca8049b\\eb02f3fb-6d6a-4a44-870b-34d780644c33\\scratchpad\\probe-drafts-5\\probe-main.mts, probe-empty.mts, probe-success.mts and probe-outcomes.mts on main at 8dcb9392 (src/loop and src/cli are unchanged at 6b89407f): a success without `dodReceipt` stored `dod:2026-09-11T00:00:00.000Z`; with `''` it stored `''`, `card next` returned `build` naming Attempt 2 and the next success threw `episode already succeeded`; with three spaces it stored them and `card next` shipped to `close`; `aidlc card attempt T0-DR --outcome success --dod-receipt ''` exited 0 and stored `''`; `aidlc card attempt --help` lists `--dod-receipt <text>` with no description; an outcome `running` was recorded with `finishedAt` set and `ATTEMPT_FINISHED` of outcome `running`; a not-counted attempt kept a stored receipt and cleared it with lost checks."
  same_class: "Other receipt inputs of `recordAttempt`: `redReceipt` has no default and a tdd success without one is refused (T1-REVIEW-LOOP-GUARDS, :1066); `candidateSha` has no default (the probed or the prior candidate is kept); `cause` is required on a fail by `finishAttempt` (src/core/effort.ts:205). Other writers of `dodReceipt`: the reuse of a receipt a block kept (:648, which an earlier success stated) and the clears the sweep lists; none generates one. Another comment that says more than the code: card-runner.ts:623-624 says the controller renews the goal lease (R9)."
sweep: "On main at 6b89407f, git grep -n \"dodReceipt\\|dod-receipt\\|card attempt\" -- src docs README.md CLAUDE.md templates .claude: card-runner.ts:1111 (the default, R3), :1036-1037 (build narrations, R5), :788 (REVIEW_FIX narration, already names `--dod-receipt ...`, unchanged), :420-441 and :648 (receipt kept and reused, unchanged), :699-700, :1368, :1402 (readiness, unchanged), :1137, :1484, :1556, :2299, :2591, :2849, :2851, :2883, :2913, :2960, :2996 (receipt cleared, unchanged); cli/main.ts:589 (option, R6), :595 (the only caller of `recordAttempt` in src); hooks/index.ts:685, :690 (Stop hook reminder, unchanged); core/types.ts:557, :874 (schemas, unchanged); docs/OPERATIONS.md:69 and README.md:38 (success examples that already carry `--dod-receipt` with an exit code and a pass count), :82 (R8), :84 (the stop-naming refusal, unchanged), :96 (what a receipt names), card-loop.md:56-57 in both copies (R7), the diagnose and tdd skills (a RED receipt line without `--outcome`), CLAUDE.md:150 and templates/CLAUDE.aidlc.md:33 (refuses SHIP without a DoD receipt: still true). git grep -n \"renews the goal\" -- src: card-runner.ts:623 (R9). Callers of a success without a receipt: a scan of every `recordAttempt` call under tests with the TypeScript parser (probe-drafts-5/calls.mts) found 201 calls; every literal success carries a receipt, and so do the non-literal inputs (dirty-success.test.ts:109-110, mutants-review.test.ts:244-246, journal-owed.test.ts:75, candidate-withdraw.test.ts:81); the CLI successes of tests/surface/lessons.test.ts:183 and candidate-withdraw.test.ts:414 pass `--dod-receipt`. tests/scenarios/card-terminal-goal.test.ts runs `card attempt --outcome success` without one at :27, :66 and :133 on a terminal goal, refused before the run is read, and at :190 (T0-CARD-TERMINAL-GOAL-2 acceptance 6) on a goal in RUN, where it asserts only the goal-store calls before the first card-run access (`ensureCardRun`, src/cli/main.ts:565, which comes before `recordAttempt`); all four pass unchanged and no test relies on the default. Behaviour pins of the neighbouring refusals: tests/scenarios/t0-flow.test.ts (missing RED :3848-3889, the stop-naming sentence :4629), tests/scenarios/dirty-success.test.ts (T0-DIRTY-SUCCESS-2 R3 order), tests/scenarios/review-block.test.ts:499-500 (lost checks), tests/scenarios/mutants-review.test.ts (marker), tests/scenarios/candidate-withdraw.test.ts (withdrawn and succeeded-episode refusals), tests/scenarios/journal-owed.test.ts (owed delivery): all pass a receipt and keep their messages. bench/ and evals/ record no attempt."
forbid:
  - weakening or skipping a test to go green, or changing any existing test file
  - placing the guard before any existing refusal of `recordAttempt` or `finishAttempt`, or after the save; reordering any existing refusal
  - a default or generated receipt of any form, or reading the stored run's receipt in place of the attempt's
  - a receipt format, a file check, a rerun of the DoD or any other reading of the receipt's text, and any document sentence that says the receipt is verified
  - trimming or otherwise changing a non-blank receipt before it is stored
  - checking a receipt for any outcome other than exactly `success`, adding outcome validation, or making `--dod-receipt` a required option of the parser
  - a change to the SHIP readiness, the receipt reuse, the Stop hook, a clear of the receipt, `ensureCardRun` or a stored run
  - a `--dod-receipt` example with a quoted value in docs/OPERATIONS.md or README.md whose value does not name an exit code and a pass count (tests/surface/unattended.test.ts:66-79)
  - a card-loop.md change other than the replacements of Exact text, or the two copies differing
  - editing .claude/skills/verify-card-run-writes/SKILL.md before CLOSE, or adding a line to it
  - a new `mkdtempSync` call, a removal in `finally`, `fx.cleanup()` or a direct `rmSync` of a temporary directory in the new test; directories come from `makeFixture` and are removed with `cleanup` of tests/infra/helpers.ts in a `t.after` hook
  - editing .aidlc state by hand
non_goals:
  - checking what a receipt says (a format, a file, a rerun of the DoD)
  - rewriting stored runs that hold `dod:<timestamp>` or a blank receipt
  - the card run that `aidlc card attempt` creates for a card with no run before `recordAttempt` runs
  - the REVIEW_FIX narration (card-runner.ts:788), which already names `--dod-receipt`
  - the RED receipt lines of the diagnose and tdd skills, which show no success command
  - the attempt numbers of the build narrations and the evidence binding (planned cards T0-ATTEMPT-NUMBER and T0-AUDIT-BINDING)
  - docs/ARCHITECTURE.md
hygiene: "Line numbers are from main at 6b89407f (src/loop/card-runner.ts, src/cli/main.ts and src/core are as at 8dcb9392); read them again at PREPARE. This card merges after T0-OP-TIMESTAMP-NOW-2 (specs/tasks/T0-OP-TIMESTAMP-NOW-2.md), which changes src/loop/card-runner.ts first (its ledger writes, not `recordAttempt` or the build narrations). T0-ATTEMPT-NUMBER and T0-AUDIT-BINDING are planned cards that are not in specs/tasks/ yet; as planned they change src/loop/card-runner.ts and both card-loop.md copies after this card (the build narrations, the CLOSE lines of the skill file), and this card leaves card-loop.md at 6,496 of its 6,500 bytes. Insert the CHANGELOG entry directly above the entry that begins `- T0-AUDIT-FIXES`, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict. This card changes src/loop/card-runner.ts, which the verify-card-run-writes coverage record names (`CardRunner.recordAttempt`, `CardRunner.next`), so run that skill before SHIP and at CLOSE; at CLOSE the coordinator moves both references to the sync commit in .claude/skills/verify-card-run-writes/SKILL.md (the `Sync commit:` line and the commit of the `git diff --name-only <sha> --` command of Keeping in sync) to the merge commit on main and adds no line: the file is 7,963 of its 8,000 bytes (tests/surface/templates.test.ts:385), and it stays true without a Bounds line, since the covered `card attempt` success (tests/scenarios/fault-points.test.ts:80) carries `dodReceipt: 'dod:1'`, so its writes, their number and their order are unchanged, and a refusal before the attempt write adds no fault point. Expected outcome of the skill: in sync; the check passes with no pin added or changed. Default removal is reviewer-verified in the success assignment. Retaining the fallback behind the guard is behaviorally equivalent and is excluded from the behavioral mutation-kill requirement. Before the first R3, revert each other source hunk in a scratch copy and run the acceptance tests (lesson 2026-11-11 T0-AUDIT-FIXES): the check removed, `trim()` dropped (the white-space rows), `typeof` dropped (the `null` and `42` rows), the outcome compared without letter case, the stored receipt read in place of the input, the guard moved before each neighbour of acceptance 4 and before the probe, each narration reverted, the option description removed. Run the new test file on Linux as well as Windows (lesson T0-DIRTY-SUCCESS-2). Before the first review the coordinator runs every test file that reads a document this card changes (among them tests/surface/prose.test.ts, tests/scenarios/dispute-running-attempt.test.ts and tests/core/effort.test.ts) and records the counts in the Attempt evidence; the full suite runs in CI. The CLI children of acceptance 7 run `process.execPath` on src/cli/main.ts with the environment the detail gives; no other test starts a process."
doc_sync: docs/OPERATIONS.md (Running a goal, T0 bugfix, the `aidlc card attempt` paragraph), both card-loop.md copies, CHANGELOG.md, .claude/skills/verify-card-run-writes/SKILL.md (both sync-commit references moved by the coordinator at CLOSE, no line added)
---

# T0-DOD-RECEIPT-REQUIRED

## Deliverable
`aidlc card attempt --outcome success` without `--dod-receipt`, or with an empty or blank one, is refused and records no attempt or attempt evidence; so is every library call of `CardRunner.recordAttempt` with the outcome `success` and no receipt. The refusal comes after every existing refusal of the attempt, so each keeps its message, and before anything of the attempt is written. The loop no longer writes a `dod:<timestamp>` receipt of its own. The build directives, both card-loop.md copies and the help of the command name the flag. A receipt stays the session's statement of the DoD result, stored as given.

## Why
Audit item F15, analysed by two consultants and ruled by the coordinator on 2026-11-12; the draft was reviewed by Codex and amended to the coordinator's rulings, which place the refusal after every existing one. The SHIP readiness reads only whether a DoD receipt is present, and the loop filled one in (`dod:<timestamp>`) when the session gave none, which the tdd build narration and the skill line led to; an empty receipt was stored and then read as missing, which left the card in BUILD with a succeeded episode.

## Exact text

Refusal message of R1 (`${card.id}` is the card id, unquoted):

```text
a successful attempt on card ${card.id} needs a DoD receipt: the attempt carries none or a blank one, and nothing was recorded; record it again with --dod-receipt "<command: exit code and counts>"
```

Build narration before RED on a tdd card (:1036), the sentence `Record the result with \`aidlc card attempt ${card.id} --outcome success|fail --cause ...\`.` becomes:

```text
Record the result with `aidlc card attempt ${card.id} --outcome success --dod-receipt "<command: exit code and counts>"` or `aidlc card attempt ${card.id} --outcome fail --cause ...`.
```

The other build narration (:1037), the clause `then record the attempt outcome (\`aidlc card attempt\`) with the DoD receipt.` becomes:

```text
then record the attempt outcome (`aidlc card attempt`) with the DoD receipt (`--dod-receipt "<command: exit code and counts>"`).
```

Option of src/cli/main.ts:589:

```text
    .option('--dod-receipt <text>', 'the DoD command, its exit code and counts (required on success)')
```

Heartbeat comment of `CardRunner.next` (R9), lines 623-624 after the change (lines 625-626 of the comment are unchanged):

```text
    // Heartbeat: the owner's own `card next` renews the card lease it holds at the run's generation; nothing renews
    // the goal lease. Expiry alone never proves the owner stopped; only a takeover changes the generation, and
```

card-loop.md, both copies, in file order. Each `old` line is replaced by its `new` line or lines; nothing else changes. After `old: ` and `new: ` (the label and one space) the line follows character for character, its leading spaces included. Bytes: 6,498 before, 6,496 after (the flag adds 65; the cuts remove 67: K6 4, K4 17, K8 25, K2 10, K1 11).

```text
K6+K4, line 10
old:    after the 5 min grace => STOP/time listing the unresolved ids.
new: after the 5 min grace => STOP/time listing unresolved ids.
K4, lines 24, 26, 27, 29, 32, 33, 36: the two leading spaces of each continuation line are removed
old:   a view.
new: a view.
old:   path + common dir + lease. A directory name or start exception is not
new: path + common dir + lease. A directory name or start exception is not
old:   ownership; a mismatch => STOP/ownership.
new: ownership; a mismatch => STOP/ownership.
old:   Dirty/untracked inputs need more than a SHA; the digest binds them.
new: Dirty/untracked inputs need more than a SHA; the digest binds them.
old:   base/merge fields; keep the retained number. Retargeted, closed-unmerged
new: base/merge fields; keep the retained number. Retargeted, closed-unmerged
old:   or multiple PRs never mean a new start.
new: or multiple PRs never mean a new start.
old:   output.
new: output.
K8, lines 50-51
old: the explicit exemption (`tdd: false`). Tests are proportionate; new units get
old: new files. Never weaken or delete a test to hide a failure; a wrong test is
new: `tdd: false`. Tests are proportionate; new units get new files. Never weaken
new: or delete a test to hide a failure; a wrong test is
Flag, line 57 (becomes lines 57-58)
old: --cause "<normalized>" [--progress]`. Record cause, evidence, checks gained
new: --cause "<normalized>" [--progress]`; success needs `--dod-receipt
new: "<command: exit code and counts>"`. Record cause, evidence, checks gained
K2, line 76
old: change ReviewGate defaults. Persist rerun and merge intent before issuing.
new: change ReviewGate defaults. Persist merge intent before issuing.
K1, line 82
old: R3 command when `formalReview.command` is set: `aidlc review r3 <id>`.
new: When `formalReview.command` is set: `aidlc review r3 <id>`.
```

Why each cut loses no instruction: K6 drops an article; K4 removes the indentation of list continuation lines, which Markdown reads as the same list item (lazy continuation) and which the tests read with white space collapsed; K8 names the exemption by its value, `tdd: false`, which is the explicit exemption; K2 drops the rerun from the SHIP sentence because the CI section already says the rerun is `persisted before the request`; K1 drops `R3 command` under the heading `## Review (R3)`. The lines other tests pin stay as they are, with white space collapsed: lines 3-4 (tests/surface/command-lines.test.ts:93), the verify-skill rule of lines 63-66 and the `## SHIP` heading before it (tests/surface/templates.test.ts:460-470), `- Card: \`aidlc cards validate --card <id>\`. Registry is authority; board is a view.` (:472, collapsed), the 3h, `never pass` and `one retry` patterns (:42-44), `aidlc review dispute` (:184-186), and `aidlc evidence retain --card` before `card close --all` (tests/scenarios/card-close-cleanup.test.ts:705-740).

Sentences D1 and D2, docs/OPERATIONS.md, on the line of :82, each after one space, directly after the sentence that ends `so record the success again with \`--red-receipt\`.`:

```text
A success attempt is also refused when it carries no DoD receipt, or one that is empty or only white space, whatever receipt the stored run holds (card T0-DOD-RECEIPT-REQUIRED): `aidlc card attempt` names the missing DoD receipt and records no attempt or attempt evidence, so record the success again with `--dod-receipt`, the DoD command with its exit code and counts; this refusal comes after every other check the attempt makes before it is recorded (the missing RED receipt, a stopped or succeeded episode, a dirty worktree and a withdrawn candidate among them, each with its own message), and on a card with no run yet the command still creates the run first. The receipt is the session's statement of the DoD result. A successful attempt requires a string that is non-blank under `String.prototype.trim`; the original string is stored without verifying its reported result. SHIP readiness continues to use the stored receipt's truthiness.
```

(D1 is the first sentence of the block; D2 is the last three, the replacement sentence of the review.)

CHANGELOG.md entry (one line):

```text
- T0-DOD-RECEIPT-REQUIRED (bugfix, audit item F15): a successful attempt is refused when it carries no DoD receipt, or one that is empty or only white space, whatever receipt the stored run holds: `aidlc card attempt --outcome success` without `--dod-receipt`, and every call of `CardRunner.recordAttempt` with the outcome `success`. The refusal records no attempt or attempt evidence (no attempt, neither the running one nor an implicit one, no effort change, candidate, DoD or RED receipt, `ATTEMPT_STARTED` or `ATTEMPT_FINISHED`); an event an earlier command owes is still delivered first, and on a card with no run yet `aidlc card attempt` still creates the run and its `CARD_DISPATCHED` event before the check. It comes after every existing refusal of the attempt, which keep their messages, and before the attempt is written. Before this card, when the other checks of the attempt passed, such a success was recorded with the generated receipt `dod:<timestamp>`, or with the empty or white-space text as given: a generated receipt or one of white space counted as present for the SHIP readiness although no DoD result was stated, and an empty one counted as absent, so the card stayed in BUILD with a succeeded episode and the next success was refused. A non-blank receipt is stored as given, and failed and not-counted attempts need none, as before; stored runs keep their receipts and are read as before. The build directives name `--dod-receipt "<command: exit code and counts>"`, both `card-loop.md` copies show it on the success command, and the help of `aidlc card attempt` says the option is required on success. The heartbeat comment of `CardRunner.next` no longer says that the controller renews the goal lease.
```

## Unchanged text
- docs/OPERATIONS.md:69 and README.md:38 show the success command with `--dod-receipt "pytest exit 0: 12 passed"` and `--dod-receipt "npm test exit 0: 42 pass, 0 fail"`; tests/surface/unattended.test.ts:66-79 requires every quoted `--dod-receipt` example of those two files to name an exit code and a pass count, so the placeholder of the narrations is not used there.
- docs/OPERATIONS.md:84 (`aidlc card attempt` refuses to finish a running repair of a stopped episode `with any outcome, naming the stop`, pinned by tests/scenarios/t0-flow.test.ts:4629) stays true: the terminal-episode refusal still comes before the new one. So do T0-RUNNING-REPAIR-STOP R1 and T0-CANDIDATE-WITHDRAW R8 (the refusal on a succeeded episode names `aidlc card withdraw`).
- docs/OPERATIONS.md:96 says what a receipt names; still true. The sentence of :82 on the dirty refusal says it `comes after the mutant-marker, lost-checks, missing-RED and admission refusals and before the withdrawn-candidate refusal`, still true, and that failed and not-counted attempts, the `dry-run` path and a run with no worktree `are not probed`, still true.
- The T0-DIRTY-SUCCESS-2 entry of CHANGELOG.md records that card's change; its order sentence stays true, and its `recorded as before` refers to the dirty check, which those cases still skip.
- docs/ARCHITECTURE.md states none of the attempt refusals; its precedence item 10 (`no RED/DoD receipt` is BUILD, :143) stays true for a stored run.
- CLAUDE.md:150 and templates/CLAUDE.aidlc.md:33 (`The card machine refuses SHIP without a DoD receipt`) stay true.
- .claude/skills/diagnose/SKILL.md:31 and .claude/skills/tdd/SKILL.md:54 (and their template copies) show `aidlc card attempt <id> --red-receipt ...` with no `--outcome`, not a success command.

## Acceptance detail
Each subsection is the full text of the acceptance item of the same number.

Fixture D (dry-run), one per test or row: `makeFixture()` of tests/scenarios/_harness.ts, removed by `t.after(() => cleanup(fx.tmp))` with `cleanup` of tests/infra/helpers.ts; the card written with `writeCard(fx, { id, title: 'dod receipt', allowPaths: ['src/t0-dr.ts'] })` (tdd) or with `tdd: false` added; `goalForCards(fx, [id])`; `const runner = fx.runner()`; `runner.next` from `fx.controller.ensureCardRun` returns `prepare`, then `build`, so attempt 1 is running. Ids `T0-DR` (tdd) and `T0-DRN` (`tdd: false`). "No write" means: `fx.store.cardFile(goalId, id)` holds the same bytes (`journalOwed` included), `fx.events(goalId)` the same events, and the last attempt of the stored run is still `running` where it was.

Fixture G (scripted git): a function `atBuild(t, ship)` copied from `atBuild` of tests/scenarios/dirty-success.test.ts:55-97 with its `ship` parameter (`github` or `scaffold`; card `T0-DRG`, worktree directory made, `git.status`, `git.exit` and `git.probes` scripted), registering `t.after(() => cleanup(fx.tmp))` right after `makeFixture()`; the helpers `refused` (:117-128), `dirtyRefusal` (:131-144) and `failingAppend` (:147-168) of that file copied with it. The existing file is not changed. Calls below carry `redReceipt: 'red:1'` and no `dodReceipt` unless a row says otherwise.

### 1
`tests/scenarios/dod-receipt-required.test.ts` "a success without a DoD receipt, or with a blank one, is refused and records nothing" passes and fails on main. Fixture D with `T0-DR`. Rows of `dodReceipt`, each in `{ outcome: 'success', redReceipt: 'red:1', candidateSha: 'sha-dr' }`: absent, `''`, `' '`, `'\t'`, `'\n'`, `'\r\n'`, `'\u00a0'`, `'\ufeff'`, `'\u2028'`, `' \t\n '`, and, cast with `as never`, `null` and `42`. Each `runner.recordAttempt(fx.goal(goalId), card, fx.store.getCardRun(goalId, 'T0-DR')!, input)` throws an Error whose message equals the refusal of Exact text with `T0-DR`, with no write. The same rows on Fixture D with `T0-DRN` (no `redReceipt`) give the message with `T0-DRN`, with no write. Then, on each fixture, `dodReceipt: 'node --test exit 0: 3 pass'` records the success: `effort.terminal` is `succeeded` and the stored `dodReceipt` is that string. On main the absent row stores `dod:2026-09-11T00:00:00.000Z` and the `''` row stores `''`. [R1] [R3] [dod arm 1]

### 2
Same file, "a receipt the stored run holds does not stand in for the attempt's" passes and fails on main. Fixture D with `T0-DR`; `fx.store.updateCardRun(goalId, 'T0-DR', (run) => ({ ...run!, dodReceipt: 'dod:earlier' }))` leaves attempt 1 running; `recordAttempt` with `{ outcome: 'success', redReceipt: 'red:1', candidateSha: 'sha-dr' }` throws the message of item 1, with no write (the stored `dodReceipt` is still `dod:earlier`). On main the success is recorded with a generated receipt. [R1] [dod arm 1]

### 3
Same file, "a non-blank receipt is stored as given, and other outcome strings bypass the guard" passes on main and with this card, and fails when the receipt is trimmed before it is stored, when another outcome is checked or when the outcome is compared without letter case. Fixture D with `T0-DR`, a fresh one per row: `dodReceipt: ' exit 0: 3 pass '` is stored with its spaces; `dodReceipt: 'dod:2026-09-11T00:00:00.000Z'` is stored as given; `{ outcome: 'fail', cause: 'red' }` and `{ outcome: 'fail', cause: 'red', dodReceipt: '  ' }` are recorded (the last attempt `fail`, `dodReceipt` undefined); `{ outcome: 'not-counted', notCountedReason: 'expected-red', redReceipt: 'red:1' }` is recorded (the last attempt `not-counted`); `{ outcome: 'Success' as never, redReceipt: 'red:1', candidateSha: 'sha-dr' }` throws an error whose message does not include `needs a DoD receipt` (the `CardRun` schema refuses the outcome at the save), with no write; `{ outcome: 'running' as never }` with no receipt does not throw: the last attempt has outcome `running` and `finishedAt` `2026-09-11T00:00:00.000Z`, and the journal gains `ATTEMPT_FINISHED` with outcome `running`, as on main. [R1] [R3] [dod arm 1]

### 4
Same file, "every existing refusal still comes first" passes, each row on its own Fixture G (`github`), a success with no `dodReceipt` that meets the neighbour named, giving that neighbour's message of main with no write (row b apart from its delivery). (a) Marker: a file at `mutantsMarkerPath(worktree, 'T0-DRG')` (src/review/mutants.ts): message matches `/a mutant run is in progress or was interrupted/`, `git.probes` 0. (b) Owed delivery: a `fail` whose `ATTEMPT_FINISHED` append `failingAppend` failed leaves the event owed; the success, run inside `failingAppend('ATTEMPT_FINISHED', ...)` again, throws the injected `EIO` error (not the DoD error), with the card-run file byte-identical (`journalOwed` included) and no `ATTEMPT_FINISHED` in the journal; the success run again without the injection journals that `ATTEMPT_FINISHED` once, with `completed: true` and the owed key, then throws the message of item 1, with the card-run file still byte-identical (the delivery writes nothing to the run, src/loop/card-runner.ts:592) and no `ATTEMPT_STARTED` of the call. (c) Lost checks: `checksLost: ['t1']`: message matches `/a successful attempt cannot report lost checks \(t1\)/`, `git.probes` 0. (d) Missing RED: no `redReceipt` on the run or the call: message matches `/a successful attempt on tdd card T0-DRG needs a RED receipt/`, `git.probes` 0. (e) Stopped episode, no attempt running: a `fail` recorded, then `updateCardRun` sets `effort.terminal` to `exhausted`: message `no attempt may start: exhausted: episode already terminal`. (f) Succeeded episode: a success recorded with `dodReceipt: 'dod:1'` on a clean status: message includes `episode already succeeded` and `aidlc card withdraw T0-DRG`. (g) Stopped episode with attempt 1 running: `updateCardRun` sets `effort.terminal` to `exhausted`, as tests/scenarios/dispute-running-attempt.test.ts:143-144 does: message `the effort episode is terminal (exhausted); no attempt may be recorded`. (h) Dirty worktree: `git.status` ` M src/a.ts\n`: the refusal `dirtyRefusal(c, ['src/a.ts'], false)` accepts, `git.probes` 1. (i) Withdrawn candidate: a success with `dodReceipt: 'dod:1'`, `runner.withdrawCandidate(..., 'the empty input is not covered')`, `next`, clean status: message matches `/is the withdrawn one/`. Row (b) fails on main (main records the success at the retry); rows (a) and (c) to (i) pass on main, and each fails when the guard is moved before the check it names. [R1] [R2] [dod arm 1]

### 5
Same file, "the DoD refusal comes after the probe, on the github and scaffold paths, and before the save" passes and fails on main. Fixture G with `github`, and again with `scaffold`, clean status: the success throws the message of item 1 with `T0-DRG`, `git.probes` is 1 (the probe ran first) and there is no write. Fixture G with `github` and `git.exit` 128 (a probe that fails, which keeps the prior candidate): the same message, `git.probes` 1, no write. On main each is recorded. [R2] [dod arm 1]

### 6
Same file, "the build directives name --dod-receipt" passes and fails on main. Fixture D with `T0-DR`: the first `build` directive (no RED receipt yet) has a narration that includes `` Record the result with `aidlc card attempt T0-DR --outcome success --dod-receipt "<command: exit code and counts>"` or `aidlc card attempt T0-DR --outcome fail --cause ...`. ``, matches `/establish behavioural RED first/` and ends with the acceptance-table text of tests/scenarios/accept-table.test.ts:9, which it holds once. After `recordAttempt` with `{ outcome: 'not-counted', notCountedReason: 'expected-red', redReceipt: 'red:1' }`, the next `build` narration includes `` then record the attempt outcome (`aidlc card attempt`) with the DoD receipt (`--dod-receipt "<command: exit code and counts>"`). ``, matches `/implement\/repair within allow_paths/` and holds the table text once. The first `build` of Fixture D with `T0-DRN` includes the same clause. [R5] [dod arm 1]

### 7
Same file, "aidlc card attempt refuses a success without a receipt, and its help says the option is required on success" passes and fails on main. The child is `spawnSync(process.execPath, [MAIN, ...args, '--json'], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 60_000 })` with `MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url))`; `env` is `process.env` without every variable whose upper-cased name starts with `GIT_` or `AIDLC_` or equals `NODE_OPTIONS`, plus `GIT_CEILING_DIRECTORIES` set to the deduplicated parent directories of `fx.tmp` and of `realpathSync.native(fx.tmp)` joined with `path.delimiter`, `AIDLC_STATE_DIR` set to `fx.paths.root` and `AIDLC_SESSION` set to `win-A` (the CLI reads no `aidlc.config.json` there and takes the defaults, as tests/scenarios/card-terminal-goal.test.ts:19 does). Existing run: Fixture D with `T0-DR` at BUILD; `args` `card attempt T0-DR --goal <goalId> --outcome success --red-receipt red:1 --candidate-sha sha-cli`, then the same with `--dod-receipt ''` and with `--dod-receipt '   '` added: each exits 1, its stderr includes the message of item 1, and the card-run file holds the same bytes. No run: a fresh `makeFixture()` with `T0-DR` written by `writeCard` and `goalForCards(fx, ['T0-DR'])`, with no `ensureCardRun`; the first `args` exit 1 with the message, and then, as chosen by R1, the card run exists with state `PREPARE` and no `effort`, the journal holds one `CARD_DISPATCHED` for `T0-DR` and no `ATTEMPT_STARTED` or `ATTEMPT_FINISHED`. Help: `card attempt --help` (no `--json`) exits 0, and its stdout with every run of white space collapsed to one space includes `--dod-receipt <text> the DoD command, its exit code and counts (required on success)`. On main the refusal rows exit 0 and record the success. [R1] [R6] [dod arm 1]

### 8
Same file, "stored receipts and not-counted attempts are read as before" passes on main and with this card, and fails when the readiness, the receipt kept by a not-counted attempt or the parsing of a stored receipt changes. Fixture D with `T0-DR`, a fresh one per row: (a) a success recorded with `dodReceipt: 'dod:2026-09-11T00:00:00.000Z'`, `redReceipt: 'red:1'`, `candidateSha: 'sha-dr'`: the next `runner.next` returns `close` (the dry-run ship merged); (b) after a success recorded with `dodReceipt: 'dod:1'`, `updateCardRun` sets the stored `dodReceipt` to `''`: `fx.store.getCardRun` parses it as `''` and `runner.next` returns `build`; (c) the same with `'   '`: parsed as `'   '`, `runner.next` returns `close`; (d) at BUILD with attempt 1 running, `updateCardRun` sets `dodReceipt: 'dod:kept'`; `{ outcome: 'not-counted', notCountedReason: 'tool-outage' }` keeps `dod:kept`, and in a fresh fixture the same with `checksLost: ['t1']` clears it (undefined). [R4] [dod arm 1]

### 9
Same file, "the documents and both card-loop copies name the DoD receipt" passes and fails on main. docs/OPERATIONS.md read with LF line ends: one line holds the sentence of tests/surface/pre-review.test.ts:1229, one space, then the block of D1 and D2 of Exact text, in that order, and the sentence of tests/scenarios/t0-flow.test.ts:4629 is still in the file. CHANGELOG.md with LF line ends: the text includes the entry of Exact text, `\n\n` and the line that begins `- T0-AUDIT-FIXES`, and the entry occurs once. .claude/skills/aidlc-loop/card-loop.md and templates/claude/skills/aidlc-loop/card-loop.md are equal, ASCII, at most 6,500 bytes, and their text with every run of white space collapsed to one space includes ``Attempts (MA2): `aidlc card attempt <id> --outcome success|fail|not-counted --cause "<normalized>" [--progress]`; success needs `--dod-receipt "<command: exit code and counts>"`. Record cause`` and each pinned line Exact text lists. [R7] [R8] [dod arm 1]

### 10
tests/scenarios/fault-points.test.ts passes with no pin added or changed (verify-card-run-writes: in sync); tests/scenarios/dirty-success.test.ts (the order of T0-DIRTY-SUCCESS-2 R3, every call with a receipt), tests/scenarios/journal-owed.test.ts, tests/scenarios/mutants-review.test.ts, tests/scenarios/candidate-withdraw.test.ts, tests/scenarios/review-block.test.ts (the lost-checks refusal at :499-500), tests/scenarios/accept-table.test.ts and tests/scenarios/t0-flow.test.ts (the narration patterns of R5, the missing-RED refusal at :3848-3889, the stop-naming sentence at :4629), tests/scenarios/card-terminal-goal.test.ts (the four `card attempt --outcome success` calls without a receipt the sweep names), tests/scenarios/card-close-cleanup.test.ts (the card-loop copies at :705-740), tests/surface/templates.test.ts, tests/surface/command-lines.test.ts, tests/surface/unattended.test.ts, tests/surface/pre-review.test.ts and tests/surface/mirror.test.ts pass unchanged. Passes on main and with this card. [R2] [R4] [R5] [R7] [R8] [dod arm 1]

### 11
Reviewer-verified against the diff: the success assignment of the save stores `input.dodReceipt` with no fallback (R3; a fallback kept behind the guard is behaviourally equivalent, so no test can tell); the heartbeat comment equals Exact text (R9); the CHANGELOG entry states R1 to R6 and R9, each fact with the condition under which it holds; the cuts of R7 lose no instruction, for the reasons Exact text gives. [R3] [R7] [R8] [R9]

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/dod-receipt-required.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/dirty-success.test.ts tests/scenarios/journal-owed.test.ts tests/scenarios/mutants-review.test.ts tests/scenarios/candidate-withdraw.test.ts tests/scenarios/review-block.test.ts tests/scenarios/accept-table.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/card-terminal-goal.test.ts tests/scenarios/card-close-cleanup.test.ts tests/surface/templates.test.ts tests/surface/command-lines.test.ts tests/surface/unattended.test.ts tests/surface/pre-review.test.ts tests/surface/mirror.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; every existing file listed passes unchanged and the fault-point check adds no pin.

## Attempt evidence

### RED, measured on 456a0556 (tests only; src is main at 2f38fc4f), `node --test tests/scenarios/dod-receipt-required.test.ts`: 25 tests, 16 pass, 9 fail
| Item | Red on main | Failure on main |
|---|---|---|
| 1 | yes | `Missing expected exception: T0-DR absent: no error` (the success was recorded) |
| 2 | yes | `Missing expected exception` (recorded with a generated receipt) |
| 3 | no | 7 of 7 pass on main (stored as given, fail, not-counted, `Success` refused at the save, `running`) |
| 4 | row (b) yes, rows (a) and (c) to (i) no | (b): `Missing expected exception` at the retry; the other eight pass |
| 5 | yes | github, scaffold and probe-fails rows: `Missing expected exception` |
| 6 | yes | the narration still holds `--outcome success\|fail --cause ...` |
| 7 | yes | CLI child exit 0 and the success printed; the refusal rows fail |
| 8 | no | passes on main |
| 9 | yes | `D1 and D2 follow the RED sentence on its line` |
| 10 | no | the fifteen other DoD files pass on main and now |

### Revert table, measured on c5e9ccff: 25 of 25 red
Each row is an actual revert or mutation run: the one piece changed in the worktree, `node --test tests/scenarios/dod-receipt-required.test.ts` run, the files restored; `git status` and `git diff --stat` empty afterwards. A guard moved is the guard deleted at its place and written at the named one.
| # | Piece changed | Result (pass/fail) | First failing test |
|---|---|---|---|
| 1 | guard deleted | 18/7 | item 1 |
| 2 | `trim()` dropped | 23/2 | item 1 (whitespace rows), item 7 |
| 3 | `typeof` dropped | 18/7 | item 1 (`null`, `42`) |
| 4 | outcome compared with `toLowerCase()` | 24/1 | item 3 `Success` row |
| 5 | stored receipt read in place of the input | 24/1 | item 2 |
| 6 | receipt trimmed before it is stored | 24/1 | item 3 spaces row |
| 7 | guard applied to every outcome | 16/9 | item 3 fail row, not-counted row |
| 8 | guard before the marker check | 13/12 | row (a) |
| 9 | before the owed delivery | 14/11 | row (b) |
| 10 | before the lost-checks refusal | 15/10 | row (c) |
| 11 | before the missing-RED refusal | 16/9 | row (d) |
| 12 | before the admission | 17/8 | rows (e), (f) |
| 13 | before `finishAttempt` | 19/6 | row (g) |
| 14 | before the worktree probe | 20/5 | row (h), item 5 |
| 15 | before the dirty refusal | 20/5 | row (h) (also items 1, 2, 7: the dry-run path never reaches that place) |
| 16 | before the withdrawn refusal | 24/1 | row (i) |
| 17 | guard after the save | 18/7 | items 1, 2, 5 |
| 18 | tdd narration reverted | 24/1 | item 6 |
| 19 | other narration reverted | 24/1 | item 6 |
| 20 | option description removed | 24/1 | item 7 (help) |
| 21 | D1 and D2 removed from docs/OPERATIONS.md | 24/1 | item 9 |
| 22 | CHANGELOG entry removed | 24/1 | item 9 |
| 23 | flag text removed from the `.claude` card-loop.md | 24/1 | item 9 |
| 24 | flag text removed from the `templates` card-loop.md | 24/1 | item 9 |
| 25 | cut K2 reverted in both copies (6,506 bytes) | 24/1 | item 9 (cap) |

Not run: the default removal (R3) and the heartbeat comment (R9) have no test (acceptance 11, reviewer-verified).

### DoD, measured on c5e9ccff, from the worktree root: exit 0
`npm run typecheck` clean; `node --test` over the 16 files: tests 493, suites 30, pass 490, fail 0, skipped 3, cancelled 0, todo 0. The new file alone: 25 tests, 25 pass. Not run here: the new file on Linux, `npm run check`, the full suite.

### Documents against code and test
| Text | True because | Test |
|---|---|---|
| D1, D2 (docs/OPERATIONS.md) | the guard of `recordAttempt` (card-runner.ts, last statement of the success block); no verification of the receipt text | items 1, 2, 4, 5, 7, 9 |
| CHANGELOG entry | same guard; owed events delivered before it (row b); CLI creates the run first (item 7); build narrations, copies and help name the flag | items 4(b), 6, 7, 9 |
| card-loop.md (both copies), 6,498 to 6,496 bytes, ASCII, identical | the success command shows the flag; cuts K1, K2, K4, K6, K8 | item 9 and the pinned surface tests |
| Option description (src/cli/main.ts) | `--dod-receipt <text>` stays optional in the parser | item 7 |

### Changed lines
`git diff --shortstat origin/main...HEAD` on c5e9ccff plus the RED commit (before this section): 7 files, 502 insertions, 33 deletions = 535 against the budget 610. The total with this section is in the final report.

Coordinator verification:
- At fd42e9b1, before the review, run by the coordinator. Linux (WSL Ubuntu, Node v22.23.4), the test files this branch adds or changes (tests/scenarios/dod-receipt-required.test.ts): tests 25, pass 25, fail 0, skipped 0.
- Windows, docpins: 81 test files reading 4 changed documents: # tests 1910 # pass 1898 # fail 0
- The `dod_command` is rerun by the coordinator on the commit that adds these lines; its receipt is recorded on the attempt.
