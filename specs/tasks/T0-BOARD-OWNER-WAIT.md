---
id: T0-BOARD-OWNER-WAIT
title: "The board shows a card stopped for ownership under a live card lease as the goal's wait on its owner, from the same lease decision `aidlc next` uses, so its Arc line agrees with the directive"
status: todo
branch: T0-BOARD-OWNER-WAIT
worktree: D:\wt\AIDLC\T0-BOARD-OWNER-WAIT
allow_paths:
  - src/loop/controller.ts
  - src/state/board.ts
  - tests/infra/board.test.ts
  - tests/scenarios/ownership-wait.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-BOARD-OWNER-WAIT.md
dod_command: npm run typecheck && node --test tests/infra/board.test.ts tests/scenarios/ownership-wait.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the board of a goal that is not terminal and not in `STOP` or `DONE` is written (`GoalController.writeBoard`, from every caller: `aidlc board`, `aidlc next` and the card commands) and a projected card run is in `STOP` with stop reason `ownership`, its card is not merged, and its card lease is unreleased and not expired at the board's clock, the board shall count that card as running: the Arc line shows the verdict `aidlc next` returns for the same records (`wait`, not `stop`), and the card's row shows the box `[-]`, the State `STOP (lease live)` and a Blocker that keeps the stop text (`ownership: <detail>`) and adds `; the goal waits on owner <session> until <expiresAt>` from that lease. A goal that is terminal or in `STOP` or `DONE` (the predicate at the top of `GoalController.next`, where `aidlc next` returns the goal's stop or done) has no live owners: its board renders such a run as before this card, whatever its lease.
  - R2. The goal dispatch's wait (`nextInRun`, card T0-CARD-LEASE-HEARTBEAT-2 R4) and the board of R1 shall take that decision from one controller function over the goal's cards, card runs and the clock. When the dispatch writes the board, the board uses the leases the dispatch already decided on and reads no lease again. A lease that cannot be read keeps the card stopped on both, as before.
  - R3. A run stopped for ownership whose card lease is expired, released, absent or unreadable renders as before this card (`[S]`, `STOP`, the stop text as Blocker, the Arc verdict `stop`), and `renderBoard` called without the owners of R2 renders every row and line as before.
  - R4. `docs/OPERATIONS.md` (the `ownership` row of STOP reasons) and the CHANGELOG Unreleased section shall state R1 and R3 under this card id.
acceptance:
  - 1. `tests/scenarios/ownership-wait.test.ts`, the live-lease case of `stoppedForOwnership(MINUTE_MS)`: after `controller.next` returns `wait`, the board file `<state>/board/<goal>.md` has `verdict=wait` on its Arc line and the T1-HELLO row starts `| [-] | T1-HELLO | STOP (lease live) |` and its Blocker names `ownership:` and `the goal waits on owner win-B until <expiresAt of the lease>`; the text `controller.writeBoard(goal)` returns and the text `controller.writeBoard(goal, cards)` returns (the `aidlc board` path) show the same row and Arc line. Fails before the fix. [R1] [R2] [dod arm 1]
  - 2. Same file: with the lease expired (`stoppedForOwnership(DEFAULT_LEASE_TTL_MS + MINUTE_MS)`) and with the lease file malformed, `controller.writeBoard(goal)` shows the row `| [S] | T1-HELLO | STOP |` and `verdict=stop`, as before this card. [R2] [R3] [dod arm 1]
  - 3. Same file, the live-lease case, with `fx.leases.read` wrapped to count calls: one `controller.next` reads the card lease exactly once. [R2] [dod arm 1]
  - 4. `tests/infra/board.test.ts`: `renderBoard` given an owner lease for a card run stopped for ownership renders the row and Arc line of R1; given none, a run stopped for ownership renders `[S]`, `STOP` and `verdict=stop`; the existing tests pass unchanged. [R1] [R3] [dod arm 1]
  - 5. The docs and CHANGELOG state R1 and R3 (reviewer-verified against the diff). [R4]
  - 6. `tests/scenarios/ownership-wait.test.ts`: the live-lease case of acceptance 1, then the goal stopped with `cancel` while the card lease stays live: `controller.writeBoard(goal)` shows the row `| [S] | T1-HELLO | STOP |` and no `lease live` or `waits on owner` text. Fails on 49b5885. [R1] [dod arm 1]
depends_on: []
budget: 200
tdd: true
diagnosis:
  root_cause: "At main 1968249, `renderBoard` (src/state/board.ts:49-51) writes every projected card's outcome from `outcomeOf(run, card)`, which maps a run in STOP to `stopped`, over the outcomes its caller passes. `nextInRun` (src/loop/controller.ts:320-336) counts a run stopped for ownership under a live card lease as `running` (card T0-CARD-LEASE-HEARTBEAT-2) and passes that outcome to `writeBoard`, but the board replaces it, and every other `writeBoard` caller (`aidlc board`, card commands) never checks the lease. So the board renders `[S] STOP` and `verdict=stop` while `aidlc next` returns `wait` on `<card>:owner:<session>`."
  repro: "Acceptance 1: the live-lease fixture of tests/scenarios/ownership-wait.test.ts; `controller.next` returns `wait` and the board file it wrote shows `| [S] | T1-HELLO | STOP |` and `verdict=stop`."
  same_class: "Readers that turn a card run in STOP into a stopped outcome: `outcomeOf` (board), `cardOutcomes` and `nextInRun` (controller). `renderWatch` prints the run state and the live lease rows separately and computes no verdict; list it in the attempt evidence as not affected."
sweep: "grep -n \"outcomeOf\\|ownedElsewhere\\|writeBoard(\\|renderBoard(\" src/loop/controller.ts src/state/board.ts src/cli/main.ts at 1968249; read them again at PREPARE."
forbid: [weakening or skipping a test to go green, editing .aidlc state by hand, changing the dispatch's wait or stop decision of T0-CARD-LEASE-HEARTBEAT-2 R4, changing `outcomeOf` for any caller other than the board, writing a lease or a journal event from the board]
non_goals: [the `aidlc board --watch` screen (it already prints the live lease beside the run state and computes no verdict), `aidlc goal status`, a lease that expires between the dispatch's decision and the board write (the board shows the dispatch's decision for that call; the next write reads the lease again), the goal lease]
hygiene: "Run the mutation sweep before the first review. Pass --goal on every card and review command."
doc_sync: docs/OPERATIONS.md (STOP reasons), CHANGELOG.md
---

# T0-BOARD-OWNER-WAIT

Follows T0-CARD-LEASE-HEARTBEAT-2 (PR 246), whose dispatch waits on a card stopped for ownership under a live lease while the board still rendered that card as a stop.

## Deliverable
While another session's live card lease covers a card stopped for ownership, `aidlc board` and the board file show that card as the goal's wait on its owner, with the owner and lease expiry, and the Arc line shows `wait`, the verdict `aidlc next` returns. With the lease expired, released, absent or unreadable the board shows the stop as before.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/board.test.ts tests/scenarios/ownership-wait.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.
