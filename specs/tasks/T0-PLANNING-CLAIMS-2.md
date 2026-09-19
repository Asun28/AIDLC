---
id: T0-PLANNING-CLAIMS-2
title: aidlc doctor names the goal and session that claims each uncommitted planning file, and the Stop hook asks a session to commit its own goal's planning artifacts before it ends (replacement of T0-PLANNING-CLAIMS after its R2 no-verdict allowance was spent on provider read timeouts)
status: merged
branch: T0-PLANNING-CLAIMS-2
worktree: D:\wt\AIDLC\T0-PLANNING-CLAIMS-2
allow_paths:
  - src/state/claims.ts
  - src/cli/main.ts
  - src/hooks/index.ts
  - src/hooks/entry.ts
  - tests/infra/claims.test.ts
  - tests/surface/hooks.test.ts
  - tests/surface/templates.test.ts
  - .claude/skills/aidlc-loop/SKILL.md
  - templates/claude/skills/aidlc-loop/SKILL.md
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-PLANNING-CLAIMS.md
  - specs/tasks/T0-PLANNING-CLAIMS-2.md
dod_command: npm run typecheck && node --test tests/infra/claims.test.ts tests/surface/hooks.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R1. The loop shall derive the planning files a non-terminal goal claims from the goal record alone: its intent, the spec and plan of the intent's slug, its plan reference, and the card file of every card the goal lists or its plan's task split names.
  - R2. WHEN `aidlc doctor` runs in a git repository, it shall list every uncommitted file under the intent, specs, plans and cards directories of the main checkout with the goal that claims it and that goal's lease owner and expiry, or `unclaimed`.
  - R3. WHEN a session stops while a goal whose lease it holds has an uncommitted claimed planning file, the Stop hook shall add the context naming the goal and the files to commit.
  - R4. The Stop hook shall add no context for a goal whose lease another session holds, a released lease, a terminal goal, or a repository without a state directory.
acceptance:
  - 1. `planningClaims(goals, dirs, readPlan)` maps each claimed path (forward slashes, relative to the main checkout) to its goal: the `intentRef` and the `planRef` (each when it lies under one of the four planning directories; absolute, escaping or outside references are neither read nor claimed), `<specsDir>/<slug>.md` and `<plansDir>/<slug>.md` for the slug of the intent's basename, and `<cardsDir>/<id>.md` for every id in `goal.cards` and every row `parsePlanCards` reads from the plan `readPlan` returns whose canonical path stays under the cards directory; a terminal goal claims nothing; a goal without an intent claims only its plan and cards; a path two goals claim keeps the older goal by its `createdAt` instant, then id (claims.test.ts). [R1] [dod arm 1]
  - 2. `uncommittedPlanningFiles(status, dirs)` selects from a `GitProbe.status` result every uncommitted path under the four directories (untracked, modified, added, renamed with both endpoints, copied or deleted: every porcelain entry, the first entry's leading space that `GitProbe.status` trims read back, each pathname read on its own and a C-quoted one decoded, the arrow taken only from an R or C status column) and no other path; every path, reference and configured directory is checkout-relative (forward slashes, no dot segments, absolute and drive checks after normalisation too, a backslash a separator only on Windows and never in a git path; an absolute or escaping reference is neither read nor claimed) (claims.test.ts). [R2] [dod arm 1]
  - 3. `aidlc doctor` prints `workingTree` as `clean` or as one entry per uncommitted planning file (the path JSON-quoted, and a goal or session id JSON-quoted when it is not a plain identifier, so every name is data on its line) with `claimed by <goal> (session <id>, lease <live until T|expired at T|released>)`, `unclaimed`, or `claim unknown` when the goal records or a plan that may name the file could not be read, through an exported formatter tested on fixtures; a repository that is not git prints `n/a`; a git, goal-record, plan or lease read that fails is reported by a store error code or the probe's exit code, never by the error text or the record (claims.test.ts). [R2] [dod arm 1]
  - 4. On Stop, with a temp state directory holding a goal whose lease this session and host hold and whose intent is untracked, the hook returns the context `[aidlc] Planning artifacts of goal <id> are uncommitted on main: <files>. Commit them before the session ends; another session sees only files it does not own.` (each file JSON-quoted and the goal id JSON-quoted when it is not a plain identifier, so a name never forms a second instruction; another goal's unreadable plan, or a card-run record that cannot be read, takes nothing from this goal's reminder; when the planning check itself cannot run the hook says so by code); with the lease held by another session, released, the goal terminal, the files committed, or no state directory, it returns no such context; the existing DoD context and this one arrive as one Stop message (hooks.test.ts). [R3] [R4] [dod arm 1]
  - 5. `SKILL.md` entry check 1 says that doctor names the goal claiming each uncommitted planning file, that another goal's file is left alone and that a session commits its own goal's planning artifacts on main as soon as they validate and before it stops; both copies are identical and under the 4500-byte cap (templates.test.ts). [R2] [R3] [dod arm 1]
  - 6. `docs/OPERATIONS.md` documents the claim rule and the two surfaces, `docs/ARCHITECTURE.md` names `src/state/claims.ts`, CHANGELOG.md Unreleased carries the entry (templates.test.ts). [dod arm 1]
depends_on: []
budget: 420
tdd: true
sweep: "grep -rn 'verify-before-done\|hookNamesFor\|GitProbe.*status\|intentRef\|planRef\|parsePlanCards' src/: the one Stop hook and its dispatcher, the status probe, the two goal references and the plan row parser the claim derives from; SKILL.md is mirrored under templates/"
forbid: [a claims file or lock under .aidlc (the goal lease is the owner), deleting or moving another goal's file, a hook that denies Stop]
non_goals: [claiming files outside the four planning directories, committing on the session's behalf, a claim for a file with no goal yet (it stays unclaimed until aidlc goal new records the intent), worktree files (the card lease and the ship scope gate cover them)]
doc_sync: docs/OPERATIONS.md (Multiple sessions), docs/ARCHITECTURE.md (state module), CHANGELOG.md
---

# T0-PLANNING-CLAIMS-2

## Deliverable
Replacement of T0-PLANNING-CLAIMS: its candidate (`710eebe` on branch `T0-PLANNING-CLAIMS`, DoD-green, R2 rounds 1 and 2 blocked and repaired) spent the R2 no-verdict allowance of its cycle on two DeepSeek CLI read timeouts (`ERROR: The read operation timed out`, retained under `.review/T0-PLANNING-CLAIMS.pre.0.3.*.log`), so the loop stopped it for tool; the ledger does not reset, and this card carries the same candidate through a fresh review ledger. Text below unchanged.

Planning artifacts (intent, spec, plan, card files) are drafted on main before the goal reaches RUN, and a second session in the same checkout sees them only as untracked files: on 2026-09-18 one session left `intent/review-coverage.md` alone with "it is not mine", correct by convention but a guess, since nothing named the owner. The goal record already knows its intent, plan and cards and the goal lease already knows the session; this card derives the claim from those two (no claims file, no second lock: the T1-LOOP-LESSONS lesson) and shows it in the two places every session already passes: `aidlc doctor` at entry lists each uncommitted planning file with its claiming goal, session and lease state, and the Stop hook reminds a session that holds a goal lease to commit that goal's planning artifacts before it ends. The skill text carries the rule: another goal's file is left alone; your own goal's files are committed on main as soon as they validate and before you stop.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/claims.test.ts tests/surface/hooks.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: the claims, hooks and templates tests pass, including the derived claim set, the doctor formatter, the Stop context for an owned goal and its absence for the four other cases, and the mirrored skill text under its cap.

## Notes for PREPARE
`SKILL.md` is 4394 of 4500 bytes; the entry-check sentence needs an equal cut in the same file. `.claude/settings.json` needs no change: the Stop event already runs `bin/aidlc-hook.js`, and `hookNamesFor` decides which guards run for it.

## Ruling
Replacement of T0-PLANNING-CLAIMS: that card's candidate (`710eebe`, DoD-green after two repaired R2 blocks) spent the R2 no-verdict allowance of its cycle on two DeepSeek CLI read timeouts (`ERROR: The read operation timed out`), which stopped it for tool; a replacement carries the same candidate through a fresh ledger. On this card R2 passed twice (three perspectives, cycle 0 on `1d0f0c7` and cycle 1 on `50f20f0`; six rounds in all, two more ending in a provider no-verdict). R3 (codex) blocked twice: decision 1 on 13 findings (containment of references and card ids, JSON-quoted paths in doctor lines and the Stop context, read failures by store error code, per-goal isolation of an unreadable plan, the rename arrow read only from R/C status columns, C-quoted names decoded by code point, goal age compared as parsed instants, the audit-level condition restored in SKILL.md, a behavioural RED receipt), every one repaired RED-first with acceptance 2-4 amended on main; decision 2 on 11 findings (absolute and drive checks after normalisation, an intent or plan reference in any planning directory claimed, a backslash a separator only on Windows and never in a git path, goal and session ids quoted, each rename pathname read on its own with both endpoints listed, an unclaimed card file a claim unknown when a plan could not be read, the DoD check and the planning check of the Stop hook failing independently with a note by code). The second substantive block stopped the card; under the human ruling of 2026-09-18 all 11 were applied with acceptance 1-4 amended on main, and the candidate `5204e4a` merged without another review cycle as PR #25 (squash `118c687`), all five CI checks green and the full suite at 695. The retained verdicts are `T0-PLANNING-CLAIMS-2.r3.1.5396a61f` and `T0-PLANNING-CLAIMS-2.r3.2.396f03c2` in the goal evidence tree, with the merge record `T0-PLANNING-CLAIMS-2.pr-25-merge`.
