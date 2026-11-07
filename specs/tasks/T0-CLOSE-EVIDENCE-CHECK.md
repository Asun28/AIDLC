---
id: T0-CLOSE-EVIDENCE-CHECK
title: `aidlc card close --evidence` records true only when the goal manifest holds an intact file retained for the card
status: merged
branch: T0-CLOSE-EVIDENCE-CHECK
worktree: D:\wt\AIDLC\T0-CLOSE-EVIDENCE-CHECK
allow_paths:
  - src/audit/manifest.ts
  - src/cli/main.ts
  - src/loop/card-runner.ts
  - tests/scenarios/card-close-cleanup.test.ts
  - tests/scenarios/lesson-dup.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - .claude/skills/aidlc-loop/card-loop.md
  - templates/claude/skills/aidlc-loop/card-loop.md
  - CHANGELOG.md
  - specs/tasks/T0-CLOSE-EVIDENCE-CHECK.md
dod_command: npm run typecheck && node --test tests/scenarios/card-close-cleanup.test.ts tests/scenarios/lesson-dup.test.ts tests/scenarios/card-goal.test.ts tests/scenarios/fault-points.test.ts tests/surface/manifest.test.ts tests/surface/verifier.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/command-lines.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc evidence retain` shall accept `--card <id>` and store it on the manifest entry as `cardId`, and an entry retained without it shall carry no card.
  - R2. `aidlc card close <id>` with `--evidence` or `--all`, on a CLOSE run with its merge verified, shall record `closure.evidence` true only when the goal manifest parses and holds an entry whose `cardId` is the card and whose file under the evidence directory exists with the digest the entry records. An entry of any kind counts.
  - R3. When the check fails, `closure.evidence` shall be false, also when an earlier call recorded it true, the other requested flags shall be recorded, and the command shall exit nonzero with a message that names the cause and an `aidlc evidence retain` command holding the goal, `--card` and, when the run's last passing review decision names a verdict file that exists in the worktree or in the evidence tree, that file; the same command run again after a file is retained shall complete the step.
  - R4. In one call the evidence check shall run before the cleanup step, and a failed check shall leave the worktree in place, not run the cleanup step and leave `closure.cleanup` as recorded, because the removal takes the files a retain command reads.
  - R5. The check shall decide from the manifest and the evidence tree alone and shall write no file; the worktree shall have no part in the result, and is read only for the path the R3 message names.
  - R6. With `shipPath: dry-run` the check shall not run and the flag shall be recorded, as that path treats the cleanup and metadata steps.
  - R7. The `--evidence` option description, the close directive, `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and both copies of `card-loop.md` shall state the check, `docs/OPERATIONS.md` shall state the sealed manifest limit of the Doc text section, and the CHANGELOG Unreleased section shall have an entry naming this card.
acceptance:
  - 1. `tests/scenarios/card-close-cleanup.test.ts`, by the CLI with `AIDLC_STATE_DIR` set as `tests/scenarios/card-goal.test.ts` sets it: `evidence retain --card C` stores `cardId` C on the entry; the same command without `--card` stores no `cardId`. [R1] [dod arm 2]
  - 2. Same file, on the github path: a manifest entry with the `cardId` of the card and an intact file: `markClosure` with `evidence` records true. An entry of kind `other` counts. [R2] [dod arm 2]
  - 3. Same file: no manifest; a manifest whose only entry names another card, which includes a card whose id has this one as a prefix; a manifest whose only entry has no `cardId`: each throws a message beginning `evidence: ` that holds `aidlc evidence retain`, `--goal` and `--card`, and `closure.evidence` is false. [R2] [R3] [dod arm 2]
  - 4. Same file: an entry whose file is removed, and an entry whose file is altered: the call throws, naming the file state, and `closure.evidence` is false. A manifest that does not parse throws under `evidence: ` with the flag false, and the message holds the parse cause, that the manifest must be restored first, because a retain reads it too, and the retain command with the goal and the card. An entry whose path cannot be read as a file is not intact, and an intact entry beside it passes the check. [R2] [R3] [dod arm 2]
  - 5. Same file: `evidence` recorded true by a first call, then the file removed: a second call throws and `closure.evidence` is false. [R3] [dod arm 2]
  - 6. Same file: a run whose last passing decision names a verdict file in the worktree: the message holds that path. After the cleanup step moved the copy to the evidence tree, the message holds the path of the copy. With no such file the message holds `<file>`. [R3] [dod arm 2]
  - 7. Same file: `evidence` and `docSync` with nothing retained: `closure.docSync` is true, and a second call after `evidence retain` completes the step. [R3] [dod arm 2]
  - 8. Same file: `evidence` and `cleanup` with nothing retained: the worktree stays, a wrapped runner records no `worktree remove`, and `closure.cleanup` stays false; an earlier true `closure.cleanup` stays true. [R4] [dod arm 2]
  - 9. Same file: the manifest and evidence tree are byte for byte the same after a passing and after a failing check, and the check passes with the worktree removed. [R5] [dod arm 2]
  - 10. Same file: `shipPath: dry-run` with no manifest records `closure.evidence` true. [R6] [dod arm 2]
  - 11. Same file: `docs/OPERATIONS.md` and `docs/ARCHITECTURE.md` hold the check sentence of the Doc text section, `docs/OPERATIONS.md` holds its limit sentence and no longer says `--evidence` records a hand step, both copies of `card-loop.md` hold `aidlc evidence retain --card` before `card close --all` and stay within the cap of `tests/surface/templates.test.ts`, the close directive holds the check with the card id, and the CHANGELOG entry is read. [R7] [dod arm 2]
depends_on: []
budget: 300
tdd: true
sweep: "Checked on main at 48f1017. `markClosure` has one caller, `card close` in src/cli/main.ts. On a github run only acceptance 13 of card-close-cleanup.test.ts passes `evidence: true`; every other caller in tests runs on dry-run, which R6 exempts. `verifyAudit` already checks entry files (ARTIFACT_MISSING, ARTIFACT_ALTERED) and is not changed. Entry ids follow three styles in the manifests of the last eight goals (`<card>.r3.<n>.<hash>`, `<card>-r3.<n>.<hash>.json`, `<card>-r3-record`), so a name does not bind an entry to a card, and a prefix joins T0-X and T0-X-2. `--candidate` does not bind it either: `audit verify` blocks a `review-verdict` entry whose candidate is not the final one, which every card but the last of a multi-card goal would hit. Of 93 DONE runs 71 name a verdict file, 18 passed without one and 4 hold no decision, so a check on verdict bytes would leave a card with nothing to compare and no way to close. `card-loop.md` is 6499 bytes under a cap of 6500. docs/LESSONS.md, T0-CANDIDATE-WITHDRAW: `card close --all` marks evidence with nothing retained."
forbid:
  - writing the manifest or any file from `card close` for this step
  - deciding this step from the worktree
  - changing `verifyAudit` or the meaning of `--candidate`
  - changing `--doc-sync` or `--findings`
  - weakening or skipping a test to go green
non_goals:
  - judging whether a retained file is the right one, or requiring a kind
  - retaining a file from `card close`, which would write a manifest whose `evidence retain` and `audit seal` writers still race
  - checks for `--doc-sync` and `--findings`
  - a manifest or a `cardId` for cards already DONE
  - worktrees of superseded cards and cancelled goals, which T0-WORKTREE-RECLAIM takes
hygiene: "R3 decision 1 raised F1 evidence-error-missing-remedy: a manifest that did not parse gave only the parse error. `evidence retain` loads the same file, so the message says to restore it first and then gives the command. Requested by the user on 2026-11-07 after T0-CLOSE-CLEANUP-2: 11 of the last 40 DONE cards have no evidence manifest while their runs record `evidence: true`. Who the check holds against: a session that forgets the step, and a retained file that is later lost or changed. It does not hold against an author who retains an unrelated file with `--card`; that record stays in the journal and the manifest for an audit to read. Limit stated here rather than reached in review: `audit seal` has no guard on the goal state, so a manifest sealed before the card closes refuses a new entry, and a card with nothing retained then keeps `closure.evidence` false. The recovery is `aidlc goal cancel`; the merge stands."
---

# T0-CLOSE-EVIDENCE-CHECK

## Why

`aidlc card close --all` records `evidence: true` with nothing checked, so the flag says nothing: 11 of the last 40 DONE cards have no manifest at all. T0-CLOSE-CLEANUP-2 made `--cleanup` and `--metadata` do their step. `--evidence` needs no step of its own, because `aidlc evidence retain` is one; it needs the flag to report what the manifest holds.

## Design

1. `ManifestEntry` gains an optional `cardId`, and `evidence retain` gains `--card`. An explicit field is the one binding that holds for every card: see the sweep for why a name, a candidate and verdict bytes do not.
2. `EvidenceStore` gains a read-only check that an entry's file exists with its recorded digest, the same test `verifyAudit` applies.
3. `markClosure` runs the evidence check first, through the `perform` helper the cleanup and metadata steps use, so a failure lowers the flag before the journal write. A failed check skips the cleanup step in that call and leaves its flag alone: the step did not run, so its last result stands.
4. The failure message is a command the session can run. It holds the verdict file of the last passing decision when one exists, in the worktree or, after a cleanup, in `<evidence>/<goal>/review/<card>/`.

## Doc text

The check, for `docs/OPERATIONS.md` and `docs/ARCHITECTURE.md`: `card close --evidence` checks that the goal manifest holds an intact file retained with `aidlc evidence retain --card <id>`, and any kind counts.

The limit, for `docs/OPERATIONS.md`: a manifest sealed before the card closes refuses a new entry, so a card with nothing retained keeps `closure.evidence` false; `aidlc goal cancel` ends the goal and the merge stands.
