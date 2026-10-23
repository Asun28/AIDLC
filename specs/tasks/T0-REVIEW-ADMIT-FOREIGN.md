---
id: T0-REVIEW-ADMIT-FOREIGN
title: A card asking the review pool for admission is admitted only for its own request and waits its turn behind another card's request instead of making that request running with nobody to run it, so two cards sharing a pool no longer stall each other for good
status: todo
branch: T0-REVIEW-ADMIT-FOREIGN
worktree: D:\wt\AIDLC\T0-REVIEW-ADMIT-FOREIGN
allow_paths:
  - src/coordination/review-queue.ts
  - src/loop/card-runner.ts
  - tests/infra/review-queue.test.ts
  - tests/scenarios/review-admit-foreign.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-REVIEW-ADMIT-FOREIGN.md
dod_command: npm run typecheck && node --test tests/infra/review-queue.test.ts tests/scenarios/review-admit-foreign.test.ts tests/scenarios/review-admit-strand.test.ts tests/scenarios/op-intent-dup.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/two-windows.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/base-sync-review.test.ts tests/scenarios/base-sync-committed.test.ts tests/scenarios/dispute-running-attempt.test.ts tests/scenarios/review-block.test.ts tests/scenarios/ci-rerun.test.ts tests/scenarios/run-driver.test.ts tests/surface/pre-review.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `ReviewQueue.admit` is called with a request key (a new optional fourth parameter), it shall admit that request only while fewer eligible requests stand ahead of it in persisted order than the pool has free slots, and otherwise return `{ status: 'behind', ahead }`, naming the first request ahead by its key and requesters, with no write beyond the deadline cancellations and the active-slot cleanup that `admit` makes at 794624a.
  - R2. WHEN `ReviewQueue.admit` is called without a request key, it shall behave as at 794624a, admitting the first eligible request whoever asked for it.
  - R3. `CardRunner.admitReview` shall pass the key it asks admission for to `ReviewQueue.admit`, and while the request ahead has this card as its only requester (an earlier candidate of the same card), complete that request as superseded and ask again, at most 10 times, as at 794624a.
  - R4. WHEN `admitReview` returns `behind`, the ship of `card next` and `review r3` shall admit nothing and name the requesters of the request ahead, the ship in the narration of its `wait` on `review-pool:<pool>:behind` and `review r3` in its refusal.
  - R5. `docs/OPERATIONS.md`, in the `aidlc review r3` paragraph right after the sentence that ends with `even if the candidate already holds its pass.`, shall carry the OPERATIONS sentence of the Doc text section.
  - R6. `docs/ARCHITECTURE.md`, in the `src/coordination/` paragraph right after the sentence T0-REVIEW-ADMIT-STRAND adds after the `review-queue.ts` sentence, shall carry the ARCHITECTURE sentence of the Doc text section.
  - R7. The CHANGELOG Unreleased section shall carry the entry of the Doc text section.
acceptance:
  - 1. `tests/infra/review-queue.test.ts`: in a one-slot pool with Y then Z queued, `admit(pool, actor, now, keyZ)` returns `{ status: 'behind', ahead: { key: keyY, requesters: [Y's requester] } }` and leaves both requests and the pool deep-equal to their state before the call; `admit(pool, actor, now, keyY)` then admits Y. In a two-slot pool with one slot taken and Y then Z queued, `admit` for Z returns `behind`; with both slots free it admits Z and leaves Y queued. A queued head past its deadline is cancelled and the caller's request behind it admitted; a `retry-after` head not yet due is passed over and the caller's request admitted. [R1] [dod arm 2]
  - 2. Same file: every existing test passes unchanged, and `admit` without a key still admits Y for Z's caller in the reproduction of the diagnosis (the behaviour R2 keeps, asserted as such). [R2] [dod arm 2]
  - 3. `tests/scenarios/review-admit-foreign.test.ts`, the R3 path: cards T1-Y and T1-Z of one goal at `review` after their R2 passes, another requester's request running in pool `default`; Y's and Z's `review r3` refuse as busy; once that request completes, Z's `review r3` rejects naming Y's requester, Y's request stays `queued` and the pool has no active slot; Y's `review r3` then runs the reviewer once and passes, and Z's after it runs once and passes; both cards' next `card next` returns `close`. At 794624a Z's call leaves Y's request `running` with the slot, Y's `review r3` rejects with `a matching formal review is already running in pool`, and no reviewer runs. [R3] [R4] [dod arm 2]
  - 4. Same file, the ship path: T1-Y and T1-Z at SHIP after their R3 passes and the same running request ahead; once it completes, Z's `card next` returns `wait` on `review-pool:default:behind` with a narration naming Y's requester, Y's ship request stays `queued` and Z's merge intent is handled as for any admission wait; Y's `card next` and then Z's return `close`. At 794624a Z's wait is on `review-pool:default:admitted` and Y's ship request stays `running` with nobody to run it. [R3] [R4] [dod arm 2]
  - 5. Same file: a queued request of T1-Y for an earlier candidate (Y its only requester) ahead of Y's current request is completed with `superseded by a newer candidate of the same card` and Y's current request admitted, as at 794624a; a queued request ahead with Y and another requester is not superseded and Y's call returns `behind`. [R3] [dod arm 2]
  - 6. `tests/scenarios/review-admit-foreign.test.ts` reads each sentence of the Doc text section in docs/OPERATIONS.md, docs/ARCHITECTURE.md and the CHANGELOG Unreleased section, one assertion per sentence, so removing any one fails the test. [R5] [R6] [R7] [dod arm 2]
  - 7. `npm run typecheck` is clean [dod arm 1]; the other files of the dod_command pass with no existing assertion changed and no `KNOWN_VIOLATIONS` entry of tests/scenarios/fault-points.test.ts added, removed or changed, since the fault-point test drives one card in its pool and never reaches this path (reviewer-verified against the diff). [R2] [R3] [dod arm 2]
depends_on: [T0-REVIEW-ADMIT-STRAND, T0-OP-INTENT-DUP]
budget: 290
tdd: true
diagnosis:
  root_cause: "`ReviewQueue.admit(pool, actor, now)` (src/coordination/review-queue.ts:121-148) admits the first eligible request of the pool in persisted order whoever asked for it: it makes the request `running` with the caller as `slotOwner` and adds it to the active slots (:141-143). `CardRunner.admitReview` (src/loop/card-runner.ts:2256-2264) calls it for one key and passes over only a head whose requesters are all this card; a head of another card comes back admitted, and the callers then refuse (`review r3`, :1553, `review pool ... is occupied by another request`) or wait (`card next`, :980-985, `wait` on `review-pool:<pool>:admitted`) without running it and without undoing the admission. The other card's request is now `running` with the slot and nobody to run it: its owner's `review r3` refuses at :1551 (`a matching formal review is already running in pool ...; join it, do not dispatch another`) and its ship waits on `review:<key>` (:974-978), for good, and with `maxConcurrent` 1 every request of the pool waits behind that slot. No failure is needed: it happens whenever a card asks for admission while another card's request is ahead of its own. Reproduced at 794624a on the queue alone (scratch script, `ReviewQueue` on a temporary directory, one pool `default`, three keys differing only in candidate digest): `enqueue` X (requester g:X) then `admit` gave `admitted` X; `enqueue` Y (g:Y) then `admit` gave `busy`; `enqueue` Z (g:Z); `complete(X)`; `admit` (Z's call) gave `admitted` with request Y; `enqueue` Y again gave `joined` with Y `running` and the pool's active slots [Y]. And through `CardRunner` (makeFixture, the fault-point test's config, cards T1-Y and T1-Z of one goal driven to `review`, a request of another requester enqueued and admitted in pool `default`): Y's and Z's `formalReview` refused `busy`; after that request completed, Z's `formalReview` refused `occupied by another request` and left Y `running`, Z `queued`, active [Y]; Y's `formalReview` then refused `a matching formal review is already running`, Z's refused `busy`, the reviewer never ran, and Y's `card next` kept directing `review`. With R1 to R3 applied by hand the same script ran both reviews once each and both cards closed."
  same_class: "Every caller of `ReviewQueue.admit` (sweep): (1) card-runner.ts:2258 and :2261 in `admitReview`, reached from the ship (:979) and `review r3` (:1552): fixed here (R3, R4). (2) No other src caller: the CLI's `aidlc review status` lists requests and admits nothing. (3) Tests that call `admit` without a key to build a fixture or to test order (tests/infra/review-queue.test.ts, tests/scenarios/two-windows.test.ts:104-113, t0-flow.test.ts:529, :2755 and :3187): unchanged by R2. Why the fix is in `admit` with a key and not in the callers: the eligibility (deadline cancellation, `retry-after`, `resetAt`, the free slots) and the order are decided in `admit` on one read of the pool and its requests; a caller that peeked at the queue first would repeat that logic outside it and act on an older read, and a caller that undid a foreign admission has no queue operation to do it with (`requeue` gives the request a new seq at the back, `cancel` drops it). A request stranded by T0-REVIEW-ADMIT-STRAND's failure case or by a process that dies after its own admission is not this class (that card's non_goals)."
sweep: "git grep -n -E 'queue[.]admit[(]|admitReview[(]|AdmitResult' -- src (main at 794624a): review-queue.ts:31 (the type) and :121 (the method), card-runner.ts:979, :1552, :2256, :2258, :2261. git grep -n -E 'occupied by another request|review-pool:|superseded by a newer candidate' -- src tests docs: card-runner.ts:984, :1553 and :2260 only; tests/scenarios/ci-rerun.test.ts:57 and review-block.test.ts:154 name `review-pool:default:empty` in comments, a status this card keeps. git grep -n '[.]admit[(]' -- tests: tests/infra/review-queue.test.ts (lines 58-180), two-windows.test.ts:104, :108, :113, t0-flow.test.ts:529, :2755, :3187, all without a key. docs/OPERATIONS.md:299 holds the sentence ending `even if the candidate already holds its pass.`; docs/ARCHITECTURE.md:16 the `review-queue.ts` sentence, which T0-REVIEW-ADMIT-STRAND and T0-OP-INTENT-DUP also extend."
forbid: ["admitting, through the key filter, any request but the one whose key is passed", "a change to the order `admit` judges by (persisted `seq`), to its deadline cancellation, `retry-after` or `resetAt` rules, or to its behaviour without a key", "a write by `admit` with a key when it returns `behind`, beyond what the same call without a key would write before reaching its candidates", "superseding a request ahead that has any requester but this card", "a peek at the queue in the card runner that decides admission outside `ReviewQueue.admit`", "a new command, CLI flag or journal event type", "changing an assertion of an existing test, or a `KNOWN_VIOLATIONS` entry of tests/scenarios/fault-points.test.ts"]
non_goals: ["a request ahead whose owner never asks again: it holds the requests behind it in a one-slot pool until its deadline passes and `admit` cancels it (review-queue.ts:136-138), the card deadline at most", "requests already left `running` this way in existing state (no migration, no state edited by hand)", "a request left `running` by a failed `REVIEW_ADMITTED` append or a process that dies after its own admission (T0-REVIEW-ADMIT-STRAND)", "fairness across pools, or a pool limit above one beyond the free-slot count of R1", "two processes of one card asking for admission at once: `admit` stays a read and two writes without a lock, as at 794624a"]
hygiene: "Line numbers are from main at 794624a, read again at PREPARE once T0-REVIEW-ADMIT-STRAND and T0-OP-INTENT-DUP have merged (they change the lines next to :980-985 and :1553 and both extend docs/ARCHITECTURE.md:16). Commit a seam first that adds the optional key parameter and the `behind` variant to `admit` without using them (`admit` ignores the key), so the RED fails on its assertions, not on a type error (docs/LESSONS.md 2026-09-26 T1-PARSE-GUARD); the RED commit then adds the tests of acceptance 1 to 6, the src change follows. The scenario file builds its fixture on `makeFixture`, `writeCard` and `goalForCards` (tests/scenarios/_harness.ts) with the config of the fault-point test and two cards of one goal. Acceptance 1 compares the requests and the pool before and after with deepEqual (2026-09-26 T0-SHIP-FAILURE-UNSETTLED). Each condition of the filter and of the supersede rule has a case that only it turns red (2026-09-19 T1-REVIEW-COVERAGE-STATS); run the mutation sweep before the first review (2026-09-24 T1-OPUS55-R3-3): ignore the key, compare against the free slots off by one, supersede a head with another requester, drop the supersede, write the pool on `behind`, admit the head instead of the caller. Every receipt an acceptance item asks for goes into `## Attempt evidence` of this file (2026-10-23 T1-VERIFY-FAULT-POINTS)."
doc_sync: docs/OPERATIONS.md (Pre-review (R2), the `aidlc review r3` paragraph), docs/ARCHITECTURE.md (`src/coordination/` paragraph), CHANGELOG.md
---

# T0-REVIEW-ADMIT-FOREIGN

## Deliverable
`ReviewQueue.admit` (src/coordination/review-queue.ts) takes an optional request key. With one, it admits only that request, and only while fewer eligible requests stand ahead of it in persisted order than the pool has free slots; otherwise it returns `behind`, naming the request ahead, and admits nothing. `CardRunner.admitReview` (src/loop/card-runner.ts) passes its key, still supersedes an earlier candidate of the same card that stands ahead, and the ship of `card next` and `review r3` wait or refuse naming the card ahead. Without a key `admit` is unchanged. Today a card that asks while another card's request is ahead makes that request `running` with nobody to run it, and both cards wait for good. docs/OPERATIONS.md, docs/ARCHITECTURE.md and CHANGELOG.md state the rule.

## Design

### Where the fix goes
In `admit`, with a key, because that is where the order and the eligibility are judged on one read; `admitReview`, the one src caller, passes its key (see same_class). The callers keep their key check, which can no longer see a foreign admission.

### Write order of `admit` with a key
The reset check (`reset-pending`, no write) and the capacity check (`busy`, with today's active-slot cleanup) come first, as at 794624a. Then the requests of the pool in `seq` order: one past its deadline is cancelled (as today), and a `retry-after` request not yet due is passed over (as today). Each other request that is not the caller's counts as one ahead; once the requests ahead fill the free slots, `admit` returns `behind` with the first of them, after the same active-slot cleanup it makes before returning `empty`. The caller's request, reached while a free slot remains for it, is admitted with the two writes of today: the request `running`, then the pool's active slots.

### What each failure leaves, and its recovery
- A write of `admit` throws, or the process dies between its two writes: the same states as at 794624a (the change adds no write).
- `behind`: nothing is admitted; the caller waits or refuses as for `busy` and asks again later; the request ahead is admitted when its own owner asks.
- `admitReview` completes a superseded request of its card and the next `admit` throws: the superseded request stays `completed`, as at 794624a.

### Limits
- A request ahead whose owner never asks again holds the requests behind it in a one-slot pool until its deadline passes and `admit` cancels it, at most the card deadline. At 794624a such a card was admitted on its owner's behalf and held the slot for good.
- Two processes asking at once: `admit` stays a read followed by two writes, with no lock, as at 794624a.

## Composition with T0-REVIEW-ADMIT-STRAND and T0-OP-INTENT-DUP
The rules are independent. T0-REVIEW-ADMIT-STRAND cancels the caller's own admitted request when its `REVIEW_ADMITTED` append fails. This card stops a caller from admitting another card's request. T0-OP-INTENT-DUP decides what an admission wait does with the merge intent, and this card's `behind` wait goes through that same branch. The edits overlap, though. R4 changes the wait at :983-984, next to T0-OP-INTENT-DUP's change at :981 and T0-REVIEW-ADMIT-STRAND's handler at :986. It also changes the refusal at :1553, next to the append T0-REVIEW-ADMIT-STRAND moves at :1555. And R6 extends docs/ARCHITECTURE.md:16, which both cards extend. Hence `depends_on` on both.

## Doc text (pinned by acceptance 6)
`docs/OPERATIONS.md`, after `even if the candidate already holds its pass.`:
- A card is admitted to the shared review pool only for its own request, in queue order (card T0-REVIEW-ADMIT-FOREIGN): when another card's request is ahead of it and no free slot is left for it, `review r3` refuses and the ship waits on `review-pool:<pool>:behind`, both naming the card ahead, and an earlier candidate of the same card ahead of it is completed as superseded, as before.

`docs/ARCHITECTURE.md`, after T0-REVIEW-ADMIT-STRAND's sentence in the `src/coordination/` paragraph:
- `ReviewQueue.admit` with a request key admits only that request, and only once fewer requests are ahead of it than the pool has free slots, which is how the card runner asks (card T0-REVIEW-ADMIT-FOREIGN).

`CHANGELOG.md`, Unreleased:
- T0-REVIEW-ADMIT-FOREIGN (bugfix): a card asking the review pool for admission is admitted only for its own request and waits its turn behind another card's request (`review r3` refuses, the ship waits on `review-pool:<pool>:behind`, both naming the card ahead). Before, it admitted the other card's request on its behalf, that request stayed `running` with the slot and nobody to run it, the other card's `review r3` refused with "a matching formal review is already running" and both cards waited for good.

## Pre-check (drafting, scratch clone of 794624a outside the repository)
- The two reproductions of the diagnosis ran as stated at 794624a.
- R1 to R3 applied by hand (the key filter in `admit`, `admitReview` passing its key and superseding a same-card request ahead without admitting it; the callers untouched, so their texts read `is behind`): the CardRunner script then reported Z's `formalReview` refused `review pool "default" is behind`, Y and Z `queued` with no active slot, Y's and Z's `formalReview` each ran once, the reviewer ran twice, and Y's `card next` returned `close`. `npm run typecheck` was clean, and `npm test` passed, 1441 tests, 0 failures, with tests/scenarios/fault-points.test.ts and its `KNOWN_VIOLATIONS` unchanged.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/review-queue.test.ts tests/scenarios/review-admit-foreign.test.ts tests/scenarios/review-admit-strand.test.ts tests/scenarios/op-intent-dup.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/two-windows.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/base-sync-review.test.ts tests/scenarios/base-sync-committed.test.ts tests/scenarios/dispute-running-attempt.test.ts tests/scenarios/review-block.test.ts tests/scenarios/ci-rerun.test.ts tests/scenarios/run-driver.test.ts tests/surface/pre-review.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck is clean; the new queue tests pass (admission for the caller's key only, `behind` with no write, the free-slot count, deadline and `retry-after` heads) and the existing ones pass unchanged; the two-card scenarios pass on both paths (no request left `running` without a runner, both cards close, the card ahead named), the same-card supersede holds, the doc and CHANGELOG sentences are present; the fault-point test passes with its `KNOWN_VIOLATIONS` unchanged; the other listed files pass.

## Attempt evidence
BUILD attempt 1 (effort medium), base origin/main e8cd3c2. Lines re-read at e8cd3c2 (the two merged cards moved them): `ReviewQueue.admit` review-queue.ts:121-148; `admitReview` card-runner.ts:2298-2306; its callers the ship (:1001, the wait at :1002-1007) and `review r3` (:1587-1588). After the fix the keyed calls are card-runner.ts:2301 and :2304.

Commits:
- db314b7 seam: `admit(pool, actor, now, _key?)` and the `behind` variant of `AdmitResult`, unused (docs/LESSONS.md 2026-09-26 T1-PARSE-GUARD).
- f2adce5, 89a856a RED: the tests of acceptance 1 to 6. 89a856a fixes a type error f2adce5 left in the new scenario file (`c.ship.requests` narrowed to never after a deepEqual with `[]`); no assertion changed.
- 67d2cf7 fix: the key filter in `admit`, `admitReview` passing its key, the `behind` refusal and wait texts.
- 531d1e4 docs: the three Doc text sentences.
- cd8aa09 test: cases the mutation sweep needed (two requests ahead of two free slots, two stale candidates, the own key after a supersede).

Reproduction at 89a856a (the RED commit; src as at e8cd3c2), a scratch copy of the new scenario fixture (makeFixture, the fault-point config, T1-Y and T1-Z of one goal, a request of `g-20260911000000-000000:T1-X` admitted in pool `default`), deleted after the run:
```
REPRO T1-Y r3 (busy): review pool "default" is busy; the formal review waits for admission (aidlc review status --pool "default")
REPRO T1-Z r3 (busy): review pool "default" is busy; the formal review waits for admission (aidlc review status --pool "default")
REPRO Z r3: review pool "default" is occupied by another request; the formal review waits for admission (aidlc review status --pool "default")
REPRO after Z: Y running, Z queued, active [["<goal>:T1-Y"]]
REPRO Y r3: a matching formal review is already running in pool "default"; join it, do not dispatch another
REPRO Z r3 again: review pool "default" is busy; the formal review waits for admission (aidlc review status --pool "default")
REPRO reviewer runs: 0; Y card next: review
REPRO Z ship wait: review-pool:default:admitted; Y ship request running, active [["<goal>:T1-Y"]]
REPRO Y card next: review:<key of Y's ship request>
```

RED (89a856a, Windows, CLAUDE_CODE_SESSION_ID and AIDLC_SESSION unset): the dod_command exited 1; typecheck clean; 444 tests, 435 pass, 9 fail; duration_ms 41217 (wall 46.9 s). First failing line:
`not ok 9 - T0-REVIEW-ADMIT-FOREIGN acceptance 1: in a one-slot pool Z behind Y gets behind naming Y and changes nothing; Y is then admitted [R1]`
The 9 failures: acceptance 1 (the one-slot and the two-slot cases), acceptance 3 (actual `review pool "default" is occupied by another request; ...`), acceptance 4 (actual `on: 'review-pool:default:admitted'`, narration `Review pool default is admitted; ...`), acceptance 5 (the shared request ahead: actual `occupied by another request`), acceptance 6 (four sentences). Passing at RED, as the card expects: acceptance 1's deadline and retry-after cases and acceptance 2 (the keyless path already behaves so), and acceptance 5's supersede of a same-card request.

GREEN (cd8aa09, Windows, same environment): the dod_command exited 0; typecheck clean; 444 tests, 444 pass, 0 fail; duration_ms 41445 (wall 47.2 s). `npm test` with CLAUDE_CODE_SESSION_ID unset: exit 0, 1562 tests, 1556 pass, 0 fail, 6 skipped, duration_ms 65782. tests/scenarios/fault-points.test.ts and its `KNOWN_VIOLATIONS` are unchanged (`git diff origin/main -- tests/scenarios/fault-points.test.ts` is empty) and pass in the DoD.

Admission order with a key (review-queue.ts `admit`):
1. A pool `resetAt` still ahead returns `reset-pending`, no write.
2. The active slots are filtered to `running` and `lost` requests; with no free slot `admit` returns `busy`, writing the pool only when the filter dropped an entry.
3. The pool's `queued` and `retry-after` requests are read in persisted `seq` order. One past its deadline is skipped: before the first eligible request it is written `cancelled` (`deadline passed before admission`) at once, as the keyless call writes it; after the first eligible request (keyed calls only) its cancellation is held for step 4 (R3 decision 1 F1). A `retry-after` request not yet due is skipped; each other request that is not the caller's counts as ahead. Once the count reaches the free slots, `admit` returns `behind` naming the first request ahead (key and requesters), drops the held cancellations, and does not write the pool file: slots step 2 dropped count as free in memory only, and the next admitting call writes the cleaned list (coordinator ruling after repair attempt 2).
4. The caller's request, reached with a free slot left for it: the held cancellations are written, then the request is written `running` (slotOwner the caller, attempts + 1), then added to the pool's active slots.
5. No caller request reached (the caller's request past its deadline, a `retry-after` not yet due, or a key no queued or `retry-after` request carries, which is treated as the last request of the queue): the held cancellations are written, then `empty` after the same cleanup (R3 decision 2 N1).
Without a key step 3 counts nothing ahead, so the first eligible request is admitted, as at e8cd3c2.

Queue states a keyed call can produce:
- `admitted`: the caller's request, `queued` or a due `retry-after`, becomes `running` and holds a slot; every other request keeps its state and `seq`.
- `behind`: the caller's request stays `queued` (or `retry-after`) behind the named request; the request ahead and every other request keep state and `seq`. The only other writes are the `cancelled` of requests past their deadline that stand before the first eligible request, which the keyless call at the same moment writes too; the pool file is not written, a stale slot included. Acceptance 1 pins the requests and the pool deep-equal before and after; the F1 tests pin every request file byte-identical to the keyless call's (see Repair attempt 2).
- `busy`, `reset-pending`, `empty`: as at e8cd3c2.
- `admitReview`: a request ahead whose only requester is this card becomes `completed` (verdictRef `superseded by a newer candidate of the same card`) and the card asks again with its key, at most 10 times; a request ahead with any other requester is never completed, and the card returns `behind`, leaving it `queued`.
- A keyed call never writes `running` onto another card's request (acceptance 3 and 4: Y's request stays `queued` and the pool has no active slot after Z's call).

Sweep (git grep at cd8aa09; lines at 68ab7fa): `queue.admit(` in src only at card-runner.ts:2302 and :2305, both in `admitReview`, both keyed; `admitReview(` is called only from the ship (:1001) and `review r3` (:1588). Keyless calls remain only in tests (tests/infra/review-queue.test.ts, two-windows.test.ts, t0-flow.test.ts, op-intent-dup.test.ts and the fixture of the new scenario file), unchanged.

Mutation sweep (each applied alone to the GREEN tree, run against tests/infra/review-queue.test.ts, tests/scenarios/review-admit-foreign.test.ts and tests/scenarios/two-windows.test.ts, then restored; none committed):

| Mutant | Killed by |
| --- | --- |
| M1 ignore the key in `admit` | acceptance 1 (two cases), 3, 4, 5 |
| M2a free slots + 1 | acceptance 1 (two cases), 3, 4, 5 |
| M2b free slots - 1 | acceptance 1 (two-slot) |
| M3 supersede a request ahead with another requester (`some` for `every`) | acceptance 5 |
| M4 drop the supersede | acceptance 5 |
| M5 write the pool on `behind` | acceptance 1 (two cases), F1 (six orders) |
| M5b write the slot cleanup on `behind` (the 61f8787 code) | F1 (stale slot) |
| M6 admit the first request ahead instead of the caller's | acceptance 1 (two-slot) |
| M7 name the last request ahead | acceptance 1 (two-slot, two ahead) |
| M8 count a deadline-passed head as ahead | acceptance 1 (deadline) |
| M9 count a `retry-after` head not yet due as ahead | acceptance 1 (retry-after) |
| M10 `admitReview` passes no key | acceptance 3, 4, 5 |
| M11 the ship narration drops the card ahead | acceptance 4 |
| M12 the `review r3` refusal drops the card ahead | acceptance 3, 5 |
| M13 the ask after a supersede passes no key | acceptance 5 (own key after a supersede) |
| M14 the key filter applies without a key | acceptance 2, 3, 4 and five existing queue tests |
| M15 supersede at most once | acceptance 5 (two stale candidates) |
| M16 cancel an expired request behind an eligible one at once (the f42b02d code) | F1 (between; several; stale slot) |
| M17 drop the held cancellations on admission | F1 (admitted) |
| M18 hold every cancellation, also before the first eligible request | F1 (before; several) |
| M19 write the held cancellations on `behind` | F1 (between; several; stale slot) |
| M21 count stale slots against the free slots (`p.active` for the cleaned list) | stale active slot test |
| M22 drop the held cancellations on `empty` (the 3f037cc code) | N1 table (four `empty` rows) |
| M23 on `empty` write only the first held cancellation | N1 table (two `empty` rows) |

Survivors: none.

verify-card-run-writes: src/loop/card-runner.ts changed since the sync commit 71826c8, with no card-run record write or journal append added, removed or reordered (the supersede and the admission write only review-queue files, outside the check's coverage); tests/scenarios/fault-points.test.ts passes unchanged. Outcome: in sync; the sync commit moves only on main.

### Repair attempt 2 (REVIEW_FIX, R3 decision 1)
F1 (behind-extra-deadline-write): with two free slots and queued order Y, expired X, W, Z, `admit(..., keyZ)` at f42b02d cancelled X and then answered `behind`, while the keyless call stops at Y and never touches X. Fix (68ab7fa): a cancellation met after the first eligible request is held and written only when the call admits its own request; on `behind` (and `empty`) it is dropped.

RED, the new tests on f42b02d with the test change uncommitted (`node --test --test-name-pattern "R3 decision 1 F1" tests/infra/review-queue.test.ts`): exit 1, 7 tests, 4 pass, 3 fail, duration_ms 752. First failing line:
`not ok 2 - T0-REVIEW-ADMIT-FOREIGN R3 decision 1 F1: behind leaves the queue as the keyless call leaves it apart from its admission, an expired request between the first eligible one and the caller (the F1 order) [R1]`
The diff shows X's file with `"lastError": "deadline passed before admission"` in the keyed run only. The other two failures are the several-expired and stale-slot orders; the before, after and one-slot orders and the admitted case pass on f42b02d.

Class sweep, every write a keyed `admit` makes on `behind`, against the forbid ("a write by `admit` with a key when it returns `behind`, beyond what the same call without a key would write before reaching its candidates") and R1 ("no write beyond the deadline cancellations and the active-slot cleanup"):
- Deadline cancellations: only those before the first eligible request, the ones the keyless call writes before the request it admits. The tests build three identical queues (before, keyless, keyed) for six orders (expired before the first eligible request; between it and the caller; after the caller; several before, between and after; a one-slot pool; a stale active slot) and assert every request file of the keyed run byte-identical to the keyless run's, with the request the keyless call admitted restored to its file before the call.
- Slot cleanup: superseded by the ruling below; on `behind` the pool file is not written at all.
- Superseding is not a write of `admit`: `admitReview` completes, through `complete`, only a request ahead whose requesters are all this card, then asks again with its key (acceptance 5).
- Admission: none on `behind`.

R2 note taken: `admitReview` always asks with its key, so the `admit.request.key !== key` half of the ship wait guard (card-runner.ts:1003) and the `occupied by another request` branch of the `review r3` refusal (:1589) could not be reached and are removed; no test pinned either text.

GREEN (68ab7fa, Windows, CLAUDE_CODE_SESSION_ID and AIDLC_SESSION unset): the dod_command exited 0; typecheck clean; 451 tests, 451 pass, 0 fail; duration_ms 41548. Linux (WSL clone of the branch at 68ab7fa): typecheck exit 0, 451 tests, 451 pass, 0 fail, duration_ms 31161. `npm test` (Windows, CLAUDE_CODE_SESSION_ID unset): exit 0, 1569 tests, 1563 pass, 0 fail, 6 skipped, duration_ms 66112. Mutation sweep rerun on 68ab7fa: M1 to M20, none survive (table above).

### Ruling after repair attempt 2: `behind` leaves the pool file unwritten
Coordinator ruling: on `behind`, write nothing to the pool file, the stale-slot cleanup included. R1 ("no write beyond the deadline cancellations and the active-slot cleanup") is met by writing less, and the forbid ("beyond what the same call without a key would write before reaching its candidates") is met without a card amendment. Fix (61603a1): the `savePool` before the `behind` return is removed. The cleaned slot list is still used in memory for the free-slot count, so a stale slot does not hold a seat. The next admitting call (keyed or keyless) writes the cleaned list with its admission, as do `busy` and `empty`.

RED on 61f8787 with the test change uncommitted (`node --test --test-name-pattern "R3 decision 1 F1" tests/infra/review-queue.test.ts`): exit 1, 7 tests, 6 pass, 1 fail, duration_ms 769. First failing line:
`not ok 6 - T0-REVIEW-ADMIT-FOREIGN R3 decision 1 F1: behind leaves the queue as the keyless call leaves it apart from its admission, a stale active slot and an expired request between [R1]`
(message `the pool file is byte-identical to the file before the call`; the keyed run wrote `"active": []` and a new `updatedAt`). The test now pins the pool file byte-identical to the file before the call in all six orders, and in the stale-slot order that the next admitting call admits Y and leaves the active slots `[Y]`, the stale slot gone. A new test pins that a stale slot does not count against the free slots of a keyed call (two slots, one stale, Y then Z: Z admitted, Y queued, active `[Z]`).

GREEN (61603a1): Windows, the dod_command exited 0, typecheck clean, 452 tests, 452 pass, 0 fail, duration_ms 42666. Linux (WSL clone of the branch at 61603a1): typecheck exit 0, 452 tests, 452 pass, 0 fail, duration_ms 30775. `npm test` (Windows, CLAUDE_CODE_SESSION_ID unset): exit 0, 1570 tests, 1564 pass, 0 fail, 6 skipped, duration_ms 65566. Mutation sweep rerun on 61603a1: M1 to M19, M5b and M21 all killed; M20 (no cleanup on `behind`) is now the code and leaves the table.

### Repair attempt 3 (REVIEW_FIX, R3 decision 2)
N1 (dropped-expiry-on-empty): at 3f037cc a keyed call dropped the held cancellations on `empty`, so with two free slots, eligible Y then expired caller Z, `admit(..., keyZ)` returned `empty` and left Z `queued`. Fix (e9540bd): the held cancellations are written before `empty` as before `admitted`, and dropped only on `behind`. The keyless path holds nothing (only a keyed call counts requests ahead), so it is unchanged.

Deadline rule, one statement: a keyed call cancels each request past its deadline that its scan passes, as keyless calls draining the queue to the same point do (the caller's admission, or the end of the queue for `empty`); on `behind` it writes only those before the first eligible request, which is what one keyless call writes, and the pool file is not written.

Outcome table (tests/infra/review-queue.test.ts, `R3 decision 2 N1`). X* are past their deadline; the caller is Z (eligible), Zx (past its deadline), Zr (`retry-after` not yet due) or absent (a key no request carries). Each row asserts the literal outcome, the literal cancelled set, that keyless calls draining to the same point (one keyless call for `behind`) cancel the same set, every cancelled file byte-identical to the keyless one, every other request file byte-identical to before the call (the admitted caller `running`), and the pool file unwritten on `empty` and `behind`:

| Outcome | Slots | Queue order | Caller | Cancelled |
| --- | --- | --- | --- | --- |
| admitted | 2 | X1 Y Z | Z | X1 |
| admitted | 2 | Y X1 Z | Z | X1 |
| admitted | 2 | Y Z X1 | Z | none |
| admitted | 2 | X1 Z Y | Z | X1 |
| admitted | 2 | X1 Y X2 Z X3 | Z | X1 X2 |
| empty | 2 | Zx | Zx | Zx |
| empty | 2 | Y Zx | Zx | Zx (the N1 case) |
| empty | 2 | X1 Y X2 Zx X3 | Zx | X1 X2 Zx X3 |
| empty | 2 | Y X1 Zr X2 | Zr | X1 X2 |
| empty | 2 | Y X1 | absent | X1 |
| behind Y | 1 | X1 Y Z | Z | X1 |
| behind Y | 1 | Y X1 Z | Z | none |
| behind Y | 2 | Y X1 W Zx | Zx | none |
| behind Y | 1 | Y Z X1 | Z | none |
| behind Y | 2 | X1 Y X2 W X3 Z X4 | Z | X1 |
| behind Y | 1 | Y X1 Zr | Zr | none |
| behind Y | 2 | Y X1 W X2 | absent | none |

R2 question pinned: a key that matches no queued or `retry-after` request behaves as if the caller were last in the queue: `behind` when the eligible requests ahead fill the free slots (last row), else `empty` (row 10), writing what that outcome writes under the rule.

RED on 3f037cc with the test change uncommitted (`node --test --test-name-pattern "R3 decision 2 N1" tests/infra/review-queue.test.ts`): exit 1, 17 tests, 13 pass, 4 fail, duration_ms 1459. First failing line:
`not ok 7 - T0-REVIEW-ADMIT-FOREIGN R3 decision 2 N1: empty, the caller itself expired behind an eligible request (the N1 case): the keyed call writes the cancellations of keyless calls to the same point [R1] [R2]`
(`the cancellations the rule names`: actual `[]`, expected `['Zx']`). The other three failures are the other `empty` rows with a held cancellation (several; `retry-after` caller; absent key).

GREEN (e9540bd): Windows, the dod_command exited 0, 469 tests, 469 pass, 0 fail, duration_ms 42573. Linux (WSL clone of the branch at e9540bd): typecheck exit 0, 469 tests, 469 pass, 0 fail, duration_ms 31317. `npm test` (Windows, CLAUDE_CODE_SESSION_ID unset): exit 0, 1587 tests, 1581 pass, 0 fail, 6 skipped, duration_ms 66894. Mutation sweep rerun on e9540bd: M1 to M19, M5b and M21 to M23 all killed, no survivors.
