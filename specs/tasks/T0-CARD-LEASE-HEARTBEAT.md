---
id: T0-CARD-LEASE-HEARTBEAT
title: "The working session's tool calls keep its card lease live, and the goal dispatch waits on a card stopped for ownership while that card's lease is live instead of stopping the goal"
status: todo
size_exception: "written before the T0-CARD-SIZE rule (2026-11-10) at budget 280; raised to 420 by the coordinator on 2026-11-10 for its tests and the R3 decision 1 repair (source about 115 lines), not split because the lease heartbeat and the live-lease goal wait prevent the 2026-11-09 ownership stop only together; awaiting the user ruling"
branch: T0-CARD-LEASE-HEARTBEAT
worktree: D:\wt\AIDLC\T0-CARD-LEASE-HEARTBEAT
allow_paths:
  - src/hooks/entry.ts
  - src/hooks/index.ts
  - src/hooks/lazy.ts
  - src/loop/controller.ts
  - src/coordination/lease.ts
  - tests/infra/lease.test.ts
  - tests/surface/lease-heartbeat.test.ts
  - tests/scenarios/ownership-wait.test.ts
  - bench/baseline.json
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-CARD-LEASE-HEARTBEAT.md
dod_command: npm run typecheck && node --test tests/surface/lease-heartbeat.test.ts tests/scenarios/ownership-wait.test.ts tests/surface/hooks.test.ts tests/surface/hook-lazy.test.ts tests/infra/lease.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the hook process receives a `PreToolUse` or `UserPromptSubmit` event, whichever guards apply to it, it shall renew every card lease that is unreleased, names the event's session and this host as owner, and has less than half of `DEFAULT_LEASE_TTL_MS` left (expired included), through `LeaseStore.heartbeat` at the lease's own generation; a lease of another session, a released lease and a lease with half or more of its TTL left are not written. `LeaseStore.heartbeat` refuses a released lease under its lock.
  - R2. The renewal of R1 shall never change the hook's decision or exit code and shall print nothing: a lease that cannot be read, a fenced heartbeat (another session took the lease over) or a lock held by another process skips that lease. It journals nothing.
  - R3. A `PreToolUse` or `UserPromptSubmit` event whose state has no leases directory shall do one stat for R1 and create nothing. Otherwise the event reads one per-session marker file, `<state>/heartbeat/<first 16 hex of sha256(session)>`, holding the UTC minute window (floor(now / 60 000 ms)) of the session's last scan: when the marker holds the current window or a later one, the event does nothing more for R1; otherwise it writes the current window to the marker and lists the leases directory once, reading the lease files. No other directory is listed. The lease store and zod load only when a lease is due, and `npm run bench -- --check` passes.
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
  - 8. `tests/surface/lease-heartbeat.test.ts`, fixed clock: an event with no marker scans (renews a due lease) and leaves the marker holding the current window; a second event in the same window renews nothing, even a lease made due again; an event in the next window scans again; an event whose window is older than the marker's does not scan; with no leases directory nothing is created; the heartbeat directory holds one file per session after scans in three windows. [R3] [dod arm 1]
  - 9. `tests/surface/lease-heartbeat.test.ts`: a lease released between the hook's scan and its heartbeat stays released with its old `expiresAt`; `tests/infra/lease.test.ts`: `heartbeat` on a released lease throws `FencedError` (`lease released`) and leaves the record byte-identical. [R1] [R2] [dod arm 1]
  - 10. `tests/surface/lease-heartbeat.test.ts`: a `PreToolUse` `Read` event, which no guard handles, renews the session's due lease through `dispatchHook`. [R1] [dod arm 1]
  - 11. Same file, with `fs.readdirSync` counted (wrap it on the node:fs default export and call `syncBuiltinESMExports()` from node:module so the named import sees it): a scanning event lists exactly one directory, the leases directory, and a skipped event lists none, with lease files of other sessions present. [R3] [dod arm 1]
depends_on: [T0-CARD-TERMINAL-GOAL-2]
budget: 420
tdd: true
diagnosis:
  root_cause: "Two gaps (main at 338ae27). (1) A card lease lives 10 minutes (`DEFAULT_LEASE_TTL_MS`, src/coordination/lease.ts:20) and only the owner's card commands renew it (`CardRunner.assess`, card-runner.ts:615), so a BUILD whose implementer works longer than that leaves the lease expired while its session is alive. (2) A non-owner's `card next` then saves an ownership stop on the run (PREPARE's claim returns `expired` or `held`, card-runner.ts:891 and :896), and `nextInRun` (controller.ts:340) stops the goal on any stopped projected card, so the goal stops although the owner's next `card next` clears that stop (card-runner.ts:620). Fixing (1) alone still stops the goal through the `held` branch; fixing (2) alone still lets the lease expire."
  repro: "Goal g-20261107095106-c08940: session 439a408b renewed T1-EVAL-VARIANT's lease at 2026-11-08T23:45:03Z and started attempt 1; its implementer worked until 00:35Z. The lease expired at 23:55Z. Session da5c9654 ran `card next T1-EVAL-VARIANT` at 00:15:01Z (CARD_STATE BUILD to PREPARE, then the expired-lease ownership stop naming 439a408b) and `aidlc next` at 00:18:00Z (GOAL_STOPPED ownership, 'no admissible work'). 439a408b's `card next` at 00:35:10Z renewed the lease (wasExpired, revalidated) and continued on the stopped goal."
  same_class: "The goal lease has the same 10-minute TTL and is renewed only by `aidlc next`; this card leaves it alone (non_goals). Other readers of card-run STOP for ownership: `src/state/board.ts` outcomeOf (the board view) and the Stop hook's ownership check; list each in the attempt evidence as changed by R4 or not affected."
sweep: "grep -n \"DEFAULT_LEASE_TTL_MS\\|heartbeat(\\|outcomeOf\\|arc.verdict === 'stop'\" src/coordination/lease.ts src/loop/controller.ts src/state/board.ts src/hooks/*.ts. Lines are from main at 338ae27; read them again at PREPARE."
forbid: [weakening or skipping a test to go green, editing .aidlc state by hand, a hook that blocks or fails a tool call because of a lease, renewing a lease of another session or a released one, lengthening DEFAULT_LEASE_TTL_MS, changing card takeover or its refusals, journaling from the hook]
non_goals: ["tool calls the `.claude/settings.json` PreToolUse matcher does not send to the hook (in this repository Read, Grep, Glob and MCP tools): they renew nothing, so a session that only reads files for 5 minutes can still let its lease run low", the goal lease heartbeat, a heartbeat inside a long blocking card command (a ship's CI wait is covered by the running-operation precedence of the card machine), changing what a non-owner's `card next` saves on the run, the record of goal g-20261107095106-c08940, "an exact one-scan-per-window guarantee across hook processes of one session that run at the same moment: two events that read the marker before either writes it may each scan once; a duplicate scan renews the same leases under the lease lock, so it costs time, not correctness"]
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
