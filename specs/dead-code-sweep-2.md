---
slug: dead-code-sweep-2
title: Fix the fix-task clear defect and remove the dead code and obsolete flags the 2026-10-14 unused-code audit found
intent: intent/dead-code-sweep-2.md
status: accepted
created: 2026-10-14T09:00:00Z
skills_applied: []
---

# Spec: Fix the fix-task clear defect and remove the dead code and obsolete flags the 2026-10-14 audit found
From intent: intent/dead-code-sweep-2.md. Status: accepted. Skills applied: (none).

## Requirements (EARS)
- R1. WHEN `aidlc card fix-task --clear` runs, the CLI shall delete the `fix-task` marker file, so that `fixTaskMarker` returns no marker and the protect-tests hook admits a test-file edit, while a marker file that exists, empty or not, still reads as active.
- R2. The card runner shall carry no `setFixTaskMarker` method, and `docs/ARCHITECTURE.md` names the CLI `card fix-task` as the only writer of the `fix-task` marker.
- R3. IF the reason of a deadline extension is empty or only whitespace, THEN the goal controller shall refuse it through the core `extendDeadline` rule (`src/core/deadlines.ts`) before any goal, card-run or journal write, and that rule is the one implementation of the extension checks.
- R4. The library shall export none of `CARD_TRANSITIONS`, `isCardTransitionAllowed`, `applyCardDecision`, `tagActionRequiresAuthority`, `MAX_COUNTED_ATTEMPTS`, `goalDoneEvidence` or `DEFAULT_BANDS_YAML`, and `CardRunner` defines neither `classify` nor `newId`; every requirement row that cited a removed name cites the production code that enforces the rule, and each such rule keeps a test that runs the production path.
- R5. The library shall export none of `fitsBeforeDeadline`, `isGlobalStop`, `gateChecks`, `evalFromIncident`, `countedFailures`, `ensureStatePaths`, `renderSpec` or `renderPlan`, and `ClaudeApiOptions` has no `showThinking` (thinking display stays `omitted`); a removed function that tests use as a fixture moves into the tests under the same name, and a test that reached production code through a removed wrapper keeps its assertions against the production entry point.
- R6. The traceability matrix shall say, in each row that cites a pure check the loop never calls (`reviewerIndependent`, `binaryRollbackCompatible`, `routeAmendment`, `unattendedMutationAllowed`, `findingMarker`), that the check exists and the loop does not call it, and not that this part is implemented.
- R7. The session resolution (`resolveSessionId`, the `doctor` session line) shall read only `AIDLC_SESSION` and `CLAUDE_CODE_SESSION_ID`, and no doc says `CLAUDE_SESSION_ID` is read.
- R8. The `GoalCounters` schema shall carry no `lifecycleRepairCycles`, `providerWaitMs` or `planningMs`, and a goal record that carries them parses into a goal without them.
- R9. The `aidlc security check` command shall exit 2 with status `NOT CONFIGURED` and a detail that names no `aidlc.config.json` binding, under a test that covers both.
- R10. The production gate's deny text, the environment paragraph of CLAUDE.md and `docs/OPERATIONS.md` shall name both `RELEASE_APPROVAL` and `AIDLC_RELEASE_APPROVAL`, OPERATIONS states that `RELEASE_APPROVAL` wins when both are set and that a repository with no goal records admits any non-empty value, and the set of commands the gate blocks or admits does not change.

## Design
R1: `src/cli/main.ts:591` deletes the marker (`rmSync(..., { force: true })`)
on `--clear`; the reader in `src/hooks/index.ts` keeps "file present =
active", so a hand-made marker still locks (fail closed). A stale empty
marker left by an earlier `--clear` is removed by running `--clear` again
(CHANGELOG). R2: delete the method and fix the ARCHITECTURE state row.
R3: `GoalController.extendDeadline` validates the timestamp as now, then
builds the new deadlines with the core `extendDeadline(goal.deadlines, by,
newDeadline, reason, now)`, which throws on a blank reason or an earlier
deadline; the controller's own later-deadline check goes. R4: delete; tests
of the removed table and wrappers go, and the bands tests read
`templates/bands.yaml`. Where a removed function was the only test of a
rule (`goalDoneEvidence` for LC11, `tagActionRequiresAuthority` for Q17),
the card first confirms a test of the production path exists and adds one
when none does. R5: delete the four wrappers and the option; move
`countedFailures`, `ensureStatePaths`, `renderSpec` and `renderPlan` into a
test helper. R6: doc rows only. R7: drop the fallback in
`src/state/journal.ts` and `src/cli/main.ts`. R8: delete the three schema
fields; zod drops unknown keys, so old records parse. R9: new detail text
and a CLI test. R10: deny text and docs; the gate logic is untouched.

## Interfaces and contracts
- Library exports removed: `CARD_TRANSITIONS`, `isCardTransitionAllowed`,
  `applyCardDecision`, `tagActionRequiresAuthority`, `MAX_COUNTED_ATTEMPTS`,
  `goalDoneEvidence`, `DEFAULT_BANDS_YAML`, `fitsBeforeDeadline`,
  `isGlobalStop`, `gateChecks`, `evalFromIncident`, `countedFailures`,
  `ensureStatePaths`, `renderSpec`, `renderPlan`;
  `ClaudeApiOptions.showThinking`; `CardRunner.setFixTaskMarker`,
  `CardRunner.classify`, `CardRunner.newId`.
- `aidlc card fix-task --clear` deletes the marker instead of emptying it.
- `aidlc goal extend` refuses a blank `--reason`.
- `CLAUDE_SESSION_ID` is no longer read; set `AIDLC_SESSION` instead.

## Data model and migration impact
`GoalCounters` loses three fields nothing reads or writes. Goal records
written before still parse (zod drops unknown keys) and lose the keys on
their next save; an older binary reading a new record fills its defaults
(0). No migration step.

## Flagged concerns (route to policy owners)
- R8 overrides the 2026-10-12 constraint "the `lifecycleRepairCycles` field
  stays, so old goal records still parse": the stated reason does not hold
  (unknown keys are dropped, not refused), and the user asked on 2026-10-14
  for every audit finding to be fixed by best practice while unavailable.
- R7 changes the session of a process that sets only `CLAUDE_SESSION_ID`
  by hand (0.1.0 named it); such a process now resolves to
  `CLAUDE_CODE_SESSION_ID` or the default token. The CHANGELOG names
  `AIDLC_SESSION` as the override.

## Non-goals
- Collapsing the hook's two-pass dispatch (card T0-HOOK-CLASSIFIER-3): it
  would change block messages and guard order of a security guard and fixes
  no defect.
- Removing `RELEASE_APPROVAL` or the no-state approval: either changes which
  commands the production gate admits.
- Wiring `reviewerIndependent`, `binaryRollbackCompatible`,
  `routeAmendment`, `unattendedMutationAllowed` or `findingMarker` into the
  loop.
- Removing `stripLegacyHooks`, the old-record fallbacks of the card runner
  or the plain `name=conclusion` CI gate-line format.
- The roles options `crossFamilyReviewer` and `configured` and the `gpt`
  family.
- The test seams `scriptedRunner`, `ok` and `setActorForTests`, the
  `export` keyword of symbols used only in their module, and unused
  `z.infer` type aliases of used schemas.

## Acceptance
- 1. After `aidlc card fix-task <id>` then `aidlc card fix-task --clear`, no marker file exists and `fixTaskMarker` returns undefined; an existing empty marker still reads as active. [R1]
- 2. `setFixTaskMarker` is gone and ARCHITECTURE names the CLI as the marker's writer. [R2]
- 3. `aidlc goal extend` with a blank reason exits nonzero and writes nothing. [R3]
- 4. The seven R4 exports and the two `CardRunner` statics are gone; LC11 and Q17 keep a production-path test. [R4]
- 5. The R5 exports and `showThinking` are gone; the moved fixtures live in the tests. [R5]
- 6. The traceability rows of the uncalled checks no longer say implemented for them. [R6]
- 7. `CLAUDE_SESSION_ID` alone resolves no session. [R7]
- 8. A goal record with the three counters parses without them. [R8]
- 9. `aidlc security check` exits 2, NOT CONFIGURED, no config binding named. [R9]
- 10. The deny text and the docs name both approval variables; the gate's decisions are unchanged. [R10]
