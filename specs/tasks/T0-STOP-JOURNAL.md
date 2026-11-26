---
id: T0-STOP-JOURNAL
title: "The Stop guard journals how each session ends against its open card runs, and reminds about a stale DoD receipt"
status: merged
branch: T0-STOP-JOURNAL
allow_paths:
  - src/core/types.ts
  - src/hooks/index.ts
  - tests/surface/stop-journal.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T0-STOP-JOURNAL.md
  - specs/tasks/T0-STOP-JOURNAL.md
dod_command: npm run typecheck && node --test tests/surface/stop-journal.test.ts tests/surface/hooks.test.ts tests/surface/hook-lazy.test.ts tests/surface/lease-heartbeat.test.ts tests/core/journal-event-types.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `JournalEventType` (`src/core/types.ts`) shall gain `SESSION_STOPPED` as its last member.
  - R2. On a Stop event that `verifyBeforeDone` (`src/hooks/index.ts`) does not leave at once (`stop_hook_active` is not true), for each goal that is not terminal and has at least one listed run (a card run in BUILD, SHIP or REVIEW_FIX whose card the goal has not dropped and whose card lease is absent, released or owned by the acting session, as the DoD check reads it today), the guard shall append one `SESSION_STOPPED` event to that goal's journal with `goalId` and the data `{ session, waiting, reminded, runs }`: `session` the acting session (`hookSession`, else the process order of `resolveSessionId`), `waiting` true when the event reports background tasks, `reminded` true when the Stop output holds the DoD reminder, and `runs` one `{ cardId, state, receipt }` per listed run of that goal, in the order the store lists them. A Stop with no listed run appends nothing and reads no git state.
  - R3. `receipt` shall be `none` for a run without a DoD receipt; for a run with one, `fresh` when the run records a candidate and a worktree directory that exists, and the digest `GitProbe.candidate` gives for that worktree, or that digest passed through `amendedDigest` (`src/core/contract.ts`) once per amendment of the run that invalidated `review`, equals the run's candidate digest; `stale` when that probe answers and neither equals; `unknown` when the run records no candidate or no worktree, the directory is missing, or the probe throws.
  - R4. The DoD reminder shall list each listed run whose receipt is `none` as `<card> (<state>)`, as today, and each whose receipt is `stale` as `<card> (<state>, DoD receipt of an earlier candidate)`; a `fresh` or `unknown` run is not listed. The reminder keeps its other text, is still not given while background tasks run, and the guard still never blocks (exit 0).
  - R5. A failure to append the event (the journal lock, a write or read error) shall leave the guard's result as it would be with the append done; a `LazyLoadError` is still rethrown.
  - R6. `docs/OPERATIONS.md` (the `verify-before-done` row and one paragraph) and `changelog.d/T0-STOP-JOURNAL.md` shall state R2 to R5 and how to count, from the goal journals, the session ends that left a run with no fresh receipt.
acceptance:
  - 1. `tests/surface/stop-journal.test.ts`, new file. A goal with a BUILD run of card `T1-FOO` and no receipt, the run unleased: a Stop with `session_id` `win-A` returns the reminder naming `T1-FOO (BUILD)` and the goal journal gains one `SESSION_STOPPED` event with `goalId`, data `{ session: 'win-A', waiting: false, reminded: true, runs: [{ cardId: 'T1-FOO', state: 'BUILD', receipt: 'none' }] }`. A second goal with a run of another session's unreleased lease gets no event. RED on main, where no event is written. [R1] [R2] [R4] [dod arm 2]
  - 2. Same file, a git repository in a temporary directory as the run's worktree, the run's candidate taken from `GitProbe.candidate` of it, a receipt set: the Stop gives no reminder and the event's run has `receipt: 'fresh'`; after an untracked file is added the reminder names `T1-FOO (BUILD, DoD receipt of an earlier candidate)` and `receipt: 'stale'`; the run's candidate digest replaced by `amendedDigest` of the probe digest once, with one amendment that invalidated `review`, reads `fresh` again; with the worktree directory removed, `unknown` and no reminder; with no candidate recorded, `unknown`. RED on main for the stale reminder. [R3] [R4] [dod arm 2]
  - 3. Same file: a Stop with `stop_hook_active: true` appends nothing; a Stop with a running background task appends an event with `waiting: true`, `reminded: false` and gives no reminder; a state with no listed run appends nothing; with the goal journal path made a directory, so the append fails, the Stop result equals the result with the append done. [R2] [R4] [R5] [dod arm 2]
  - 4. `tests/surface/hooks.test.ts`, `tests/surface/hook-lazy.test.ts` (a Stop on empty state loads exactly zod), `tests/surface/lease-heartbeat.test.ts` and `tests/core/journal-event-types.test.ts` pass unchanged. [R1] [R2] [R4] [dod arm 2]
  - 5. `docs/OPERATIONS.md` and `changelog.d/T0-STOP-JOURNAL.md` state R2 to R6 (reviewer-verified against the diff; `tests/surface/changelog-fragments.test.ts` passes). [R6] [dod arm 2]
  - 6. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 120
tdd: true
sweep: "On main at 359fbd14 `verifyBeforeDone` (`src/hooks/index.ts`) returns Stop context for owned BUILD, SHIP and REVIEW_FIX runs with no `dodReceipt` and writes nothing, so no goal journal shows how a session ended (issue 499, plan agreed with Codex on 2026-11-26: journal first, then measure; check freshness; no unconditional block). A receipt is cleared on a review block, an amendment that invalidates `dod`, a withdrawal and a continuation (`src/loop/card-runner.ts`), but not when the worktree changes after the attempt. The card runner binds the run's candidate at a successful attempt from `GitProbe.candidate(run.worktree)` (`src/loop/card-runner.ts:1609-1613`), a sha256 over HEAD and the `git status` entries, passed through `amendedDigest` per review-invalidating amendment (`:1626`). `GitProbe` is already a static import of `src/hooks/index.ts`; `core/contract.ts` imports only node:crypto and core types. The journal append takes the journal lock, refused after 2 s with `LOCKED`. `tests/surface/hook-lazy.test.ts` pins that a Stop on empty state loads exactly zod, so the journal and git are touched only when a listed run exists; `bench/` Stop journeys have no runs. `tests/core/journal-event-types.test.ts` keeps declared types in order and allows a new one at the end. `tests/surface/hooks.test.ts:197-198` pins that a run with a receipt and no candidate gives no reminder, which R3 keeps as `unknown`."
forbid: [network]
non_goals:
  - "blocking a Stop (exit 2 or `decision: block`); the issue keeps that for after the measurement"
  - "a command that reads or counts the events; the count is a journal query in docs/OPERATIONS.md"
  - "an edit to an already modified file after the attempt, which leaves the `git status` entries and so the digest as they were"
  - "the planning-artifacts reminder, which is unchanged"
  - "the CLAUDE.md sentence `the Stop hook only reminds`, which stays true"
hygiene: "From issue 499 (card 4 of the plan agreed with Codex on 2026-11-26). RED first: acceptance 1 and the stale row of acceptance 2 on main. Use fixed ISO timestamps where the test sets them; the git repository is a temporary directory, never the checkout."
---

# T0-STOP-JOURNAL

From issue 499 (card 4 of the plan agreed with Codex on 2026-11-26), after Lydia Hallie's talk "Rethinking Claude Code Best Practices" (AI Engineer CODE, 2026-11-11): required checks belong in hooks, and a hook that must send Claude back has to block. Before the Stop guard blocks, measure how often a session ends with an unverified run.

## Why
The Stop guard reminds and writes nothing, so no journal shows how often a session ends with an open run and no fresh DoD receipt. A receipt also counts as present after the worktree changed.

## Deliverable
A `SESSION_STOPPED` journal event per goal with listed runs at each Stop, a freshness check of the receipt against the worktree's candidate digest, and the reminder for a stale receipt.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/stop-journal.test.ts tests/surface/hooks.test.ts tests/surface/hook-lazy.test.ts tests/surface/lease-heartbeat.test.ts tests/core/journal-event-types.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: each Stop with listed runs journals one event per goal, receipts read none, fresh, stale or unknown, and the guard never blocks.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|
| 1 | tests/surface/stop-journal.test.ts, acceptance 1, with the event actor's session (added at R3 decision 1) | RED at ad0dedc5 (no `SESSION_STOPPED` event), passes on the candidate |
| 2 | tests/surface/stop-journal.test.ts, both acceptance 2 tests: a git repository in a temporary directory as the worktree; after R3 decision 1 the stale reminder is its own test | the stale-reminder test fails with the base `src/hooks/index.ts` and `src/core/types.ts` put back (empty context, no reminder); the receipt-value test RED at ad0dedc5 (no event); both pass on the candidate |
| 3 | tests/surface/stop-journal.test.ts, acceptance 3 | RED at ad0dedc5 (no event for the waiting Stop), passes on the candidate |
| 4 | tests/surface/hooks.test.ts, hook-lazy.test.ts, lease-heartbeat.test.ts, tests/core/journal-event-types.test.ts | pass, unchanged |
| 5 | `git diff origin/main -- docs changelog.d`; tests/surface/changelog-fragments.test.ts | the `verify-before-done` row, one paragraph with the count, one fragment line; pass |
| 6 | `npm run typecheck`; `npm run check` before the first SHIP | exit 0 |

## PR summary

### What
The Stop guard now writes a `SESSION_STOPPED` journal event for each goal with open card runs of the session. It also reminds about a DoD receipt of an earlier candidate.

### Why / Intent
Issue 499 asks if the Stop guard should block. No journal showed how often a session ended with an unverified run, so this card measures first.

### How / Behaviour
Each event records the session, background work, the reminder, and each run with its receipt as none, fresh, stale or unknown. Fresh means the worktree candidate digest still equals the digest the receipt was bound to.

### System impact
A Stop with open runs appends one journal line per goal and runs git once per run with a receipt. A Stop with no open run does as before.

### Security
No new input is trusted. The event holds card ids, states and the session id only.

### Tests and review
tests/surface/stop-journal.test.ts covers the event, each receipt value, waiting work, a repeated Stop and a failed append.

### Risk
A failed append is dropped, so the answer of the guard does not change. The guard still never blocks.

### Ownership
Hooks, `src/hooks/index.ts`.

### Docs
docs/OPERATIONS.md says how to count the session ends with no fresh receipt. A changelog fragment states the change.
