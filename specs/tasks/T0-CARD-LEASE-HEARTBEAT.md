---
id: T0-CARD-LEASE-HEARTBEAT
title: "The working session's tool calls keep its card lease live, and the goal dispatch waits on a card stopped for ownership while that card's lease is live instead of stopping the goal"
status: todo
branch: T0-CARD-LEASE-HEARTBEAT
worktree: D:\wt\AIDLC\T0-CARD-LEASE-HEARTBEAT
allow_paths:
  - src/hooks/entry.ts
  - src/hooks/index.ts
  - src/hooks/lazy.ts
  - src/loop/controller.ts
  - tests/surface/lease-heartbeat.test.ts
  - tests/scenarios/ownership-wait.test.ts
  - bench/baseline.json
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-CARD-LEASE-HEARTBEAT.md
dod_command: npm run typecheck && node --test tests/surface/lease-heartbeat.test.ts tests/scenarios/ownership-wait.test.ts tests/surface/hooks.test.ts tests/surface/hook-lazy.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the hook process handles a `PreToolUse` or `UserPromptSubmit` event, it shall renew every card lease that is unreleased, names the event's session and this host as owner, and has less than half of `DEFAULT_LEASE_TTL_MS` left (expired included), through `LeaseStore.heartbeat` at the lease's own generation; a lease of another session, a released lease and a lease with half or more of its TTL left are not written.
  - R2. The renewal of R1 shall never change the hook's decision or exit code and shall print nothing: a lease that cannot be read, a fenced heartbeat (another session took the lease over) or a lock held by another process skips that lease. It journals nothing.
  - R3. A `PreToolUse` or `UserPromptSubmit` event whose state directory holds no lease naming the event's session shall not load the goal store, the lease store or zod for R1; at most one directory listing and the reads of the lease files are added, and `npm run bench -- --check` passes; and a session scans the lease files at most once per 60 seconds: a per-session marker under the state root, checked with one stat, is rewritten after each scan; an event whose state has no leases directory writes nothing.
  - R4. WHEN the goal dispatch (`aidlc next`, `nextInRun`) finds a projected card run in STOP with stop reason `ownership` whose card lease is unreleased and not expired, it shall count that card as running: the goal waits on it (directive `wait`) and is not stopped. A run stopped for ownership whose card lease is expired, released or absent keeps today's outcome (the goal stops naming `card takeover`), and so does a stop for any other reason.
  - R5. `docs/OPERATIONS.md` (STOP reasons, the `ownership` row, and Hooks), `docs/ARCHITECTURE.md` (the hooks paragraph) and the CHANGELOG Unreleased section shall state R1, R2 and R4 under this card id.
acceptance:
  - 1. `tests/surface/lease-heartbeat.test.ts`, with a temporary state directory and a fixed clock: a `PreToolUse` Bash event of session S renews S's card lease that has 4 minutes left (new `expiresAt` = now + TTL, same generation) and one that expired 20 minutes ago, and leaves untouched a lease of S with 6 minutes left, a released lease of S and a lease of session T (file bytes unchanged). Fails before the fix. [R1] [dod arm 1]
  - 2. Same file: the same event's decision and output are those without R1 when a lease file is malformed, when another session took the lease over between the read and the write (fenced), and when its lock file is held; the hook exits as before and prints nothing new; no journal file is created or changed. [R2] [dod arm 1]
  - 3. Same file: a `UserPromptSubmit` event renews S's expiring lease as in acceptance 1. [R1] [dod arm 1]
  - 4. `tests/scenarios/ownership-wait.test.ts`: a goal in RUN whose one card run is in STOP for ownership with a live card lease of another session gets a `wait` directive from `controller.next`, the goal state is not STOP and no `GOAL_STOPPED` is journaled; with that lease expired the same call stops the goal for ownership naming `card takeover` (as before). Fails before the fix. [R4] [dod arm 1]
  - 5. Same file: the incident sequence: owner session A's lease is renewed by a PreToolUse event at the moment it would have expired, session B's `card next` saves an ownership stop on the run, B's `controller.next` waits, and A's next `card next` clears the stop (LEASE_RENEWED revalidated) and the goal continues; `verifyAudit` on the journal reports no `WORK_AFTER_TERMINAL`. [R1] [R4] [dod arm 1]
  - 6. `tests/surface/hooks.test.ts` and `tests/surface/hook-lazy.test.ts` pass unchanged, and `npm run bench -- --check` passes after `npm run build` (output in the attempt evidence; a ceiling raised by hand is named in the PR body with its reason). [R3] [dod arm 1]
  - 7. The docs and CHANGELOG state R1, R2 and R4 (reviewer-verified against the diff). [R5]
  - 8. `tests/surface/lease-heartbeat.test.ts`: a second PreToolUse within 60 s (fixed clock) renews nothing, even a due lease, and one 61 s later renews it; with no leases directory, no marker or directory is created. [R3] [dod arm 1]
depends_on: [T0-CARD-TERMINAL-GOAL-2]
budget: 420
tdd: true
diagnosis:
  root_cause: "Two gaps (main at 338ae27). (1) A card lease lives 10 minutes (`DEFAULT_LEASE_TTL_MS`, src/coordination/lease.ts:20) and only the owner's card commands renew it (`CardRunner.assess`, card-runner.ts:615), so a BUILD whose implementer works longer than that leaves the lease expired while its session is alive. (2) A non-owner's `card next` then saves an ownership stop on the run (PREPARE's claim returns `expired` or `held`, card-runner.ts:891 and :896), and `nextInRun` (controller.ts:340) stops the goal on any stopped projected card, so the goal stops although the owner's next `card next` clears that stop (card-runner.ts:620). Fixing (1) alone still stops the goal through the `held` branch; fixing (2) alone still lets the lease expire."
  repro: "Goal g-20261107095106-c08940: session 439a408b renewed T1-EVAL-VARIANT's lease at 2026-11-08T23:45:03Z and started attempt 1; its implementer worked until 00:35Z. The lease expired at 23:55Z. Session da5c9654 ran `card next T1-EVAL-VARIANT` at 00:15:01Z (CARD_STATE BUILD to PREPARE, then the expired-lease ownership stop naming 439a408b) and `aidlc next` at 00:18:00Z (GOAL_STOPPED ownership, 'no admissible work'). 439a408b's `card next` at 00:35:10Z renewed the lease (wasExpired, revalidated) and continued on the stopped goal."
  same_class: "The goal lease has the same 10-minute TTL and is renewed only by `aidlc next`; this card leaves it alone (non_goals). Other readers of card-run STOP for ownership: `src/state/board.ts` outcomeOf (the board view) and the Stop hook's ownership check; list each in the attempt evidence as changed by R4 or not affected."
sweep: "grep -n \"DEFAULT_LEASE_TTL_MS\\|heartbeat(\\|outcomeOf\\|arc.verdict === 'stop'\" src/coordination/lease.ts src/loop/controller.ts src/state/board.ts src/hooks/*.ts. Lines are from main at 338ae27; read them again at PREPARE."
forbid: [weakening or skipping a test to go green, editing .aidlc state by hand, a hook that blocks or fails a tool call because of a lease, renewing a lease of another session or a released one, lengthening DEFAULT_LEASE_TTL_MS, changing card takeover or its refusals, journaling from the hook]
non_goals: [the goal lease heartbeat, a heartbeat inside a long blocking card command (a ship's CI wait is covered by the running-operation precedence of the card machine), changing what a non-owner's `card next` saves on the run, the record of goal g-20261107095106-c08940]
hygiene: "PreToolUse fires for subagent tool calls under the parent session (the fix-task marker already relies on it for the implementer); state that in the attempt evidence with the test that shows the event's session_id is used. Run `npm run bench -- --check` after `npm run build` before the first review (docs/OPERATIONS.md, Loop benchmark). The full suite runs locally before SHIP. Pass --goal on every card and review command."
doc_sync: docs/OPERATIONS.md (STOP reasons, Hooks), docs/ARCHITECTURE.md (hooks), CHANGELOG.md
---

# T0-CARD-LEASE-HEARTBEAT

## Deliverable
While a session (or its implementer subagent) is making tool calls, its card lease does not expire, and another session's `aidlc next` waits on a card stopped for ownership under a live lease instead of stopping the goal. A session that has ended still loses its lease after 10 minutes, and takeover works as before.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/lease-heartbeat.test.ts tests/scenarios/ownership-wait.test.ts tests/surface/hooks.test.ts tests/surface/hook-lazy.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Attempt evidence

Attempt 1. RED 10f3434 (both test files), corrected at dea9441: acceptance 4's expired case now saves its stop after the expiry (PREPARE's `expired` claim, as in the incident); saved under the live lease, the stop is the stale-generation one, which never names `card takeover`. Still red without the controller change (`expected 'wait'`, `actual 'stop'`).

| Item | Proof | Result |
|---|---|---|
| 1 [R1] | `tests/surface/lease-heartbeat.test.ts` "acceptance 1": 4 min left and expired 20 min ago renewed to now + `DEFAULT_LEASE_TTL_MS` at the same generation; 6 min left, released, session T byte-identical. The event carries `session_id` and the env has no `AIDLC_SESSION`, so the event's session is the one used (a subagent's PreToolUse carries the parent's `session_id`) | pass; red before (`12:04` vs `12:10`) |
| 2 [R2] | same file, two "acceptance 2" tests: in process, malformed (not JSON, and JSON naming S that the schema refuses), fenced (takeover by T injected between the scan and the heartbeat through `openLeases`) and a held lock give the result of the same event on an empty state dir, the takeover stands, a good lease beside them is renewed, no `journal/`; as a process (`bin/aidlc-hook.js`), malformed plus held lock: exit 0, stdout and stderr empty | pass |
| 3 [R1] | same file, "acceptance 3": UserPromptSubmit renews S's 4-minute lease | pass; red before |
| 4 [R4] | `tests/scenarios/ownership-wait.test.ts` "acceptance 4": live lease of B: `wait` on `T1-HELLO:owner:win-B`, goal not STOP, no `GOAL_STOPPED`; expired: STOP/ownership naming `card takeover`, one `GOAL_STOPPED` | pass; red before |
| 5 [R1][R4] | same file, "acceptance 5": hook renews A's lease 1 s before expiry, B's `card next` saves the ownership stop, B's `controller.next` waits, A's `card next` builds (`LEASE_RENEWED` revalidated), attempt recorded, run at CLOSE, A's `next` not stop, `verifyAudit` has no `WORK_AFTER_TERMINAL` | pass; red before |
| 6 [R3] | `hooks.test.ts`, `hook-lazy.test.ts` unchanged and green in the DoD; `npm run build && npm run bench -- --check`: "every count within its ceiling (6 journeys)"; fsCalls hook.pre-bash 9/7, hook.pre-edit 10/8, hook.prompt 9/7 (the marker stat and the `leases/` listing), modules and depBytes within slack; no ceiling raised | pass |
| 8 [R3] | `tests/surface/lease-heartbeat.test.ts` "acceptance 8": a lease due after the first scan is byte-identical after an event 30 s later and renewed to now + TTL by one 61 s later; a state root without `leases/` stays empty and an absent state root is not created | pass; red at 821d5ab (the 30 s event renewed it) |
| 7 [R5] | OPERATIONS.md `ownership` row and a Hooks paragraph, ARCHITECTURE.md hooks paragraph, CHANGELOG Unreleased bullet | reviewer to verify |

Amendment (coordinator pre-review of 1bf5dc7): R3 gains the 60-second scan throttle and acceptance 8. Reason: this repository's `.aidlc/leases` holds 429 files and the unthrottled scan cost 72 to 88 ms per tool call (coordinator's warm measurement), about the cost of loading zod, which the bench cannot see on its empty state directory. Measured after the fix on a temp state with 429 lease files of another session, 10 runs in process on Windows: scan median 183.7 ms, throttled event (marker 30 s old) median 0.14 ms. The marker is `<state>/heartbeat/<sha256(session) first 16 hex>`, its mtime set to the scan time.

R4, unreadable lease: `nextInRun` catches a card lease read that throws (malformed JSON, schema) and keeps the run `stopped`, so the goal stops as before this card; this is R4's "absent" case extended to a lease that cannot be read. Proof: `tests/scenarios/ownership-wait.test.ts` "a card lease file that cannot be read keeps the goal stop" (red at 821d5ab: `controller.next` threw `MALFORMED_JSON`).

same_class readers:
- `src/state/board.ts` `outcomeOf`: not changed (outside allow_paths). The controller passes its adjusted outcomes to `writeBoard`, but `renderBoard` writes each projected card over them from its own run, so the board row still shows the run as STOP while the goal waits.
- Stop hook ownership check (`verifyBeforeDone`, `ownedHere`): not affected. It lists runs in BUILD, SHIP or REVIEW_FIX only, never a STOP run, and reads no expiry; the heartbeat only keeps the owner's lease live.
- Goal lease: not renewed by the hook (non_goals).

Not changed: the OPERATIONS.md Sessions sentence "the goal-level `aidlc next` run between the card's stop and the takeover stops the goal on that stop" now holds only once the card lease has expired (the brief keeps the Sessions section from growing; the `ownership` row states the wait).

Budget: raised from 280 to 420 by the coordinator at b2cd824. The diff is +416/-8: source about 101 lines, the two new test files about 285, docs and this card about 38. The excess comes from the coordinator's pre-review amendment (the 60-second scan throttle, acceptance 8 and the unreadable-lease case) and from the test files, not from source outside the requirements.
