---
id: T1-IMPLEMENTER-MODEL
title: Both implementer agent files name the model opus in place of inherit, so the coordinator session's model no longer sets the implementer's model; arc.md, OPERATIONS.md and the two pinned test values say the same
status: merged
branch: T1-IMPLEMENTER-MODEL
worktree: D:\wt\AIDLC\T1-IMPLEMENTER-MODEL
plan_ref: plans/loop-throughput.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - templates/claude/agents/implementer.md
  - .claude/agents/implementer.md
  - templates/claude/skills/aidlc-loop/arc.md
  - .claude/skills/aidlc-loop/arc.md
  - tests/surface/templates.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T1-IMPLEMENTER-MODEL.md
  - specs/tasks/T1-IMPLEMENTER-MODEL.md
dod_command: npm run typecheck && node --test tests/surface/templates.test.ts tests/infra/stray-processes.test.ts tests/surface/loop-evidence-docs.test.ts tests/surface/prose.test.ts tests/surface/init-base-ci.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
requirements:
  - R1. templates/claude/agents/implementer.md and its byte-identical live copy .claude/agents/implementer.md shall carry the front matter line `model: opus` in place of `model: inherit`, with `effort: medium` and every other byte unchanged.
  - R2. templates/claude/skills/aidlc-loop/arc.md and its byte-identical live copy shall say that the implementer's agent file names its model, in place of the clause that it inherits the session's model, and stay ASCII and within the 4500-byte cap.
  - R3. docs/OPERATIONS.md (the paragraph that starts `Agent files name a model and an effort`) and the new changelog.d/T1-IMPLEMENTER-MODEL.md shall carry the texts of Acceptance detail.
acceptance:
  - 1. tests/surface/templates.test.ts, in the describe of T1-EFF-AGENTS-DOD, the test whose title starts with `acceptance 1` (:314) - the entry `implementer` of its `want` map (:315) changes from `['inherit', 'medium']` to `['opus', 'medium']`, and nothing else in the test changes. The replaced value pinned the rule of card T1-EFF-AGENTS-DOD that this card reverses. With the new value the test fails on main (`model: inherit`). [R1] [dod arm 2]
  - 2. Same describe, the test whose title starts with `acceptance 5` (:348) - the phrase of its list (:350) that says the implementer is on the session's model becomes "the implementer on `opus` at `medium`", and nothing else in the test changes. With the new phrase the test fails on main. [R3] [dod arm 2]
  - 3. Same describe, the test whose title starts with `acceptance 2` (:323) passes with no line changed - the two arc.md copies are equal and at most 4500 bytes, and the pinned sentence about the directive's effort is still there. The changed clause itself is reviewer-verified against the diff. [R2] [dod arm 2]
  - 4. tests/infra/stray-processes.test.ts (the assertion `the two implementer.md copies are equal`, :646), tests/surface/loop-evidence-docs.test.ts (both implementer files, :68), tests/surface/prose.test.ts (the implementer sentence, :296, and its size checks on docs/OPERATIONS.md) and tests/surface/init-base-ci.test.ts (the place of the `Agent files name a model and an effort` line, :396) pass with no line changed. [R1] [R2] [R3] [dod arm 2]
  - 5. docs/OPERATIONS.md carries the text of Acceptance detail (reviewer-verified against the diff), and changelog.d/T1-IMPLEMENTER-MODEL.md holds the entry of Acceptance detail followed by one line feed, so tests/surface/changelog-fragments.test.ts (card T1-CHANGELOG-FRAGMENTS) passes with the new file. [R3] [dod arm 2]
  - 6. `npm run typecheck` exits 0. [R1] [dod arm 1]
depends_on: [T1-CHANGELOG-FRAGMENTS]
budget: 40
tdd: true
sweep: "Main at 2ef2bbf4. `.claude/agents/implementer.md:5` and `templates/claude/agents/implementer.md:5` are `model: inherit`, and `diff` of the two files prints nothing. The value was set by card T1-EFF-AGENTS-DOD (its R1; its non_goals name 'a model field in the run-card directive (the implementer inherits the session model)'). Pins, from `git grep -n -E \"session's model|'inherit'\" -- tests` and `git grep -n -i -E \"inherit(s)? (the|its) (session|model)|session's model|model: inherit\" -- docs README.md CLAUDE.md .claude templates src` - tests/surface/templates.test.ts:315 (the `want` map) and :350 (the OPERATIONS phrase list); docs/OPERATIONS.md:19; `.claude/skills/aidlc-loop/arc.md:28` and its template copy ('as its effort; it inherits the session's model.'); nothing in src, README.md, CLAUDE.md or docs/ARCHITECTURE.md. arc.md is 4439 bytes against a cap of 4500 (templates.test.ts:20), and the new clause is one byte shorter. Other tests that read these files - tests/infra/stray-processes.test.ts:644-647 (the copies are equal and ASCII), tests/surface/loop-evidence-docs.test.ts:68, tests/surface/prose.test.ts:296 and its reads of arc.md, tests/surface/init-base-ci.test.ts:396 (finds the OPERATIONS paragraph by its first words); all are in the DoD. The sibling agent files carry `model: opus` (planner.md:5, reviewer.md:5, release-specialist.md:5) or `model: sonnet` (investigator.md:5, verifier.md:5). `bench/outcome/summary.json`, view `summary_cache_share` - 16,665 Claude Code requests on claude-opus-5-5, 4,096 on claude-fable-5-2, 1,235 on claude-sonnet-5-5. A worker that `aidlc run` starts takes its model from the provider request (`src/providers/claude-code.ts:42-43`), not from the agent file."
forbid:
  - a change to any other agent file, to `effort`, to src/core/roles.ts, to a provider or to the `run-card` directive
  - a change to arc.md other than the one clause, or to any byte cap in tests/surface/templates.test.ts
  - a change to a line of tests/surface/templates.test.ts other than the two values acceptance 1 and 2 name
  - a change to CHANGELOG.md; the entry is this card's own fragment, and the entry of T1-EFF-AGENTS-DOD stays as it is
  - weakening, skipping or deleting a test to go green
non_goals:
  - choosing the implementer model by card, or `sonnet` for small cards (intent/run-attribution.md, part B, after T1-DOD-GATE)
  - the model of a worker that `aidlc run` starts; the provider request sets it
  - a full model id in the agent file; the card uses the alias the sibling agent files use
hygiene: "Line numbers are from main at 2ef2bbf4; read them again at PREPARE. Starts after T1-CHANGELOG-FRAGMENTS has merged, since the entry is a fragment and that card's test checks its form. Keep the OPERATIONS paragraph one line that starts with `Agent files name a model and an effort`. tests/surface/prose.test.ts holds size checks on docs/OPERATIONS.md - if the added sentence exceeds one, shorten the sentence, never the check. Not verified before the card runs - which model id the alias `opus` resolves to in the installed Claude Code (read it from the usage record of the first implementer run after the merge); whether the agent file accepts a full model id."
---

# T1-IMPLEMENTER-MODEL

## Deliverable
The implementer agent names its model. Both copies of `implementer.md` carry `model: opus` in place of `model: inherit`, and the three places that state the old value (`arc.md`, `docs/OPERATIONS.md`, two values in `tests/surface/templates.test.ts`) state the new one.

## Why
Plan `plans/loop-throughput.md`, from the review of 2026-11-17. With `inherit`, an implementer subagent runs on the model of the coordinator session that starts it. The usage record holds 4,096 requests on `claude-fable-5-2` beside 16,665 on `claude-opus-5-5`, so the coordinator's model, which the owner picks for coordination, has also been the implementer's model. `src/core/roles.ts:27` gives the implementer `claude-opus-5-5` as its default; the agent file now says the same through the alias the planner, reviewer and release-specialist files already use. Choosing a cheaper model for small cards is a later trial (`intent/run-attribution.md`, part B).

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/templates.test.ts tests/infra/stray-processes.test.ts tests/surface/loop-evidence-docs.test.ts tests/surface/prose.test.ts tests/surface/init-base-ci.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: dod arm 1 is `npm run typecheck`, dod arm 2 is the `node --test` command; every acceptance test above passes.

## Acceptance detail
Both `arc.md` copies, the item that starts `- Start an implementer subagent`: its second line `  as its effort; it inherits the session's model.` becomes `  as its effort; its agent file names its model.`

docs/OPERATIONS.md, the paragraph that starts `Agent files name a model and an effort` (one line, :19). Its clause "and the implementer on the session's model (`inherit`) at `medium`." becomes "and the implementer on `opus` at `medium`. The implementer's model is named since card T1-IMPLEMENTER-MODEL: before it the implementer took the model of the session that started it, so the coordinator's model was also the implementer's." Every other sentence of the paragraph stays.

changelog.d/T1-IMPLEMENTER-MODEL.md (new), this one line and one line feed:

"- T1-IMPLEMENTER-MODEL: the implementer agent file names its model. Both copies of `implementer.md` carry `model: opus` in place of `model: inherit`, so an implementer subagent no longer runs on the model of the coordinator session that starts it (the usage record of `bench/outcome/summary.json` holds 4,096 requests on `claude-fable-5-2` beside 16,665 on `claude-opus-5-5`). `effort` stays `medium` and the `run-card` directive still sets the effort of a run. This replaces the statement of the T1-EFF-AGENTS-DOD entry that the implementer is on the session's model."

## Attempt evidence
RED commit 36cf8232 (acceptance 1 and 2 values only): `node --test --test-name-pattern "T1-EFF-AGENTS-DOD" tests/surface/templates.test.ts` on the unchanged files, pass 3 fail 2; acceptance 1 fails on `model: inherit` against `model: opus`, acceptance 5 on the phrase "the implementer on `opus` at `medium`" absent from docs/OPERATIONS.md.

| Item | Proving test or command | Result |
| --- | --- | --- |
| 1 | tests/surface/templates.test.ts, T1-EFF-AGENTS-DOD `acceptance 1` (want map `implementer: ['opus', 'medium']`) | red on RED commit, green after GREEN |
| 2 | tests/surface/templates.test.ts, T1-EFF-AGENTS-DOD `acceptance 5` (phrase "the implementer on `opus` at `medium`") | red on RED commit, green after GREEN |
| 3 | tests/surface/templates.test.ts, T1-EFF-AGENTS-DOD `acceptance 2`, unchanged; arc.md 4438 bytes, copies equal; clause reviewer-verified against the diff | green |
| 4 | tests/infra/stray-processes.test.ts, tests/surface/loop-evidence-docs.test.ts, tests/surface/prose.test.ts, tests/surface/init-base-ci.test.ts, unchanged | green (one POSIX-only row of stray-processes skips on Windows, as on main) |
| 5 | tests/surface/changelog-fragments.test.ts with changelog.d/T1-IMPLEMENTER-MODEL.md; OPERATIONS text reviewer-verified against the diff | green |
| 6 | `npm run typecheck` (dod arm 1) | exit 0 |

DoD (`dod_command`, Windows): exit 0, tests 149, pass 148, fail 0, skipped 1.
