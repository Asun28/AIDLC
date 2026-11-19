---
id: T1-PANEL-ARMS-REPORT
title: docs/reliability/panel.md reports Codex+Codex against Codex+Fable 5.2 as panels of R3, from the saved 2026-11-16 Codex pair and the Fable runs, with union, intersection and unique hits computed in bench/outcome/panel.ts, against the keep rule of intent/review-panel.md
status: todo
branch: T1-PANEL-ARMS-REPORT
worktree: D:\wt\AIDLC\T1-PANEL-ARMS-REPORT
plan_ref: plans/review-panel.md#order-of-work
allow_paths:
  - bench/outcome/panel.ts
  - bench/outcome/panel.json
  - bench/outcome/README.md
  - docs/reliability/panel.md
  - tests/surface/outcome-panel.test.ts
  - specs/tasks/T1-PANEL-ARMS-REPORT.md
dod_command: npm run typecheck && node --test tests/surface/outcome-panel.test.ts tests/surface/outcome-arms.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `unionOf(members)` (new, exported from bench/outcome/panel.ts, pure) shall take two or more members, each the case results of one bench report trial, and return over the case ids every member holds: per member hits and false blocks; `union` (a bug case hit when any member hit it, a clean case a false block when any member blocked it); `intersection` (hit or false block only when every member did); `uniqueHits` per member; and `excluded`, the ids of cases that are `no-verdict` or `error` in any member, counted in neither union nor intersection.
  - R2. `node bench/outcome/panel.ts assemble --commit <sha>` shall read the inputs of the body section Inputs and refuse, writing nothing, when a file is missing or unparsable, a report's stage is not `formal`, a Fable report lacks `options.formalCommand` or a Codex report has one, the policy hashes of the paired reports differ, or the case ids of a pair differ.
  - R3. `measures` in panel.json shall hold, for stage 1: Codex round 1 alone, Codex+Codex (round 1 with the field-order run), Codex+Fable (round 1 with Fable), each with R1's fields, on the miss subset and the clean cases; and, when stage 2 inputs exist, the same per trial and as median, min and max over 3 trials on all replay and clean cases, with the median per-triple wall time of the slower member over that of single Codex.
  - R4. `keep` in panel.json shall apply the stage gate and keep rule of intent/review-panel.md as the owner accepted it before this card starts: `stage2` is `run` only when Fable's unique hits over Codex round 1 are at least the field-order run's (8); with stage 2 inputs, `panel` is `keep` only when the better composition gains at least 7 hits at the median over single Codex with at most 1 more false block and a wall-time ratio of at most 1.5, and `member2` is `fable` only when Codex+Fable gains at least 5 hits at the median over Codex+Codex with at most 1 more false block, else `codex`.
  - R5. `docs/reliability/panel.md` (new) shall begin `# Review panel`, hold the sections `Method`, `Earlier records`, `Stage 1`, `Stage 2` (stating "not run" and the gate value when absent), `Keep rule` and `What these numbers do not show`, and give every number in a table row `| <measure> | <value> | <source> |` whose source is a code span holding a JSON pointer into panel.json or the path of an earlier record. Earlier records cites the rows of intent/review-panel.md (Existing bench records). What these numbers do not show names: the stage 1 subset was chosen for baseline misses, the field-order run is not an identical rerun, one replay set from this repository, no loop measure yet.
  - R6. bench/outcome/README.md shall name panel.ts and panel.json.
acceptance:
  - 1. `tests/surface/outcome-panel.test.ts` (new), "T1-PANEL-ARMS-REPORT acceptance 1: unionOf gives union, intersection, unique hits and excluded". Fixture members hitting 33 and 35 of 64 with 27 shared give union 41, intersection 27, unique 6 and 8; a shared clean block is one union false block; a no-verdict case in one member is excluded. Fails on main (no module). [R1] [dod arm 1]
  - 2. Same file, "T1-PANEL-ARMS-REPORT acceptance 2: assemble refuses each input fault of R2 and writes nothing". Fails on main. [R2] [dod arm 1]
  - 3. Same file, "T1-PANEL-ARMS-REPORT acceptance 3: measures and keep equal those recomputed from the inputs". Fixture edges: Fable unique hits 8 and 7; gains 7 and 6; false blocks +1 and +2; ratio 1.5 and 1.51; Fable over Codex+Codex 5 and 4; stage-1-only inputs; and the committed panel.json. Fails on main. [R3] [R4] [dod arm 1]
  - 4. Same file, "T1-PANEL-ARMS-REPORT acceptance 4: panel.md has its title, sections and the banned-character rule, and every table value equals its source". Fails on main. [R5] [dod arm 1]
  - 5. outcome-arms.test.ts and prose.test.ts pass with no line changed. [R6] [dod arm 1]
  - 6. The limits of R5 and the README line are as stated (reviewer-verified against the diff). [R5] [R6]
depends_on: [T1-ARMS-REPORT, T1-BENCH-FORMAL-COMMAND, T1-BENCH-CLEAN-40]
budget: 300
tdd: true
sweep: "Saved Codex pair, policy aa7f80bac1a3: _local/arms/rounds-miss.json (`rounds[0]` per case is round 1, 33 hits), order-miss.json (35), rounds-clean.json and order-clean.json (1 of 15 each, the same case). Earlier unions computed by hand: _local/bench-step4/scripts (2026-11-07) and the arms of 2026-11-16. Pattern for assemble and the table-row rule: bench/outcome/arms.ts of T1-ARMS-REPORT."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test
  - a new bench run, or a rerun of an arm, inside this card
  - editing a report under _local/arms/, _local/panel-arms/ or a case under evals/review/
  - a keep verdict that differs from the rule of R4
non_goals: [a `bench union` CLI command, switching the panel on (T1-R3-PANEL-ON), a change under src/]
hygiene: "If the stage 1 Fable reports are missing, the Fable run's policy hash is not aa7f80bac1a3, or the owner has not accepted the keep rule in intent/review-panel.md, STOP/capability."
---

# T1-PANEL-ARMS-REPORT

## Deliverable
The owner reads in one page whether a second R3 reviewer finds enough more defects to run, and whether it should be Fable 5.2 or a second Codex run.

## Inputs
- Stage 1 (coordinator, from a worktree of main after T1-BENCH-FORMAL-COMMAND merges, while REVIEW.md still hashes to aa7f80bac1a3, the policy of the 2026-11-16 arms; it does at ff925160): `_local/panel-arms/fable-miss.json` and `fable-clean.json`, `aidlc review bench run --stage formal --formal-command bench/outcome/fable-r3.json --json` on `_local/arms/miss25` and on the 15 clean cases of main. The Codex side is the saved pair under `_local/arms/`.
- Stage 2 (only when `keep.stage2` of a stage-1 assembly is `run`): `codex-replay.json`, `codex-clean.json`, `fable-replay.json`, `fable-clean.json`, `--trials 3` on `evals/review/replay` and `evals/review/clean` (40 cases after T1-BENCH-CLEAN-40).

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-panel.test.ts tests/surface/outcome-arms.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the four new tests pass and the existing tests pass unchanged.
