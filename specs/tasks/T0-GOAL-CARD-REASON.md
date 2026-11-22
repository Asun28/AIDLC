---
id: T0-GOAL-CARD-REASON
title: "The routing reasons of a request that gives a card name that card, not a card id of the text"
status: todo
branch: T0-GOAL-CARD-REASON
worktree: D:\wt\AIDLC\T0-GOAL-CARD-REASON
allow_paths:
  - src/core/router.ts
  - tests/core/router.test.ts
  - tests/scenarios/goal-card-reason.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-GOAL-CARD-REASON.md
  - specs/tasks/T0-GOAL-CARD-REASON.md
dod_command: npm run typecheck && node --test tests/core/router.test.ts tests/scenarios/goal-card-reason.test.ts tests/scenarios/goal-card-count.test.ts tests/scenarios/goal-merged-card.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. A request gives a card when its `ref` matches `CARD_ID_REGEX`. WHEN a request gives a card and its text names a card id, `classifyRequest` (`src/core/router.ts`) shall write `ref=<given card>` and one card reason for the given card, `resolved card <given card>` when the known card list holds it and `card id <given card> referenced (registry not consulted or id absent; verify before dispatch)` otherwise. It shall write no `ref=` and no card reason for a card id of the text.
  - R2. The first card id of the text is the first one the known card list holds, or, where the list holds none of them or no list is passed, the first card id token. WHEN a request gives a card and the first card id of its text is another id, the reasons shall hold `the text names card id <that id>; --card names the card of this request` directly after the card reason. WHEN it is the given card, the reasons shall hold no such line.
  - R3. For a request under R1, `kind`, `size`, `target`, `cardCount`, `modules`, `skills` and every reason other than `ref=`, the card reason and the line of R2 shall be what they are on main at dbdeb721. A request whose `ref` is absent or is not a card id, and a request that gives a card with a text that names no card id, shall get the routing result they get on main at dbdeb721.
  - R4. `aidlc goal new "<text>" --card <id>` shall record the reasons of R1 and R2 as the goal's `routing.reasons`, with the request's `ref` and the goal's `cards` naming `<id>` as on main. `GoalController.createGoal` called with a request that gives a card and with no `cards` option shall take the given card as the goal's card where the router counts one card.
  - R5. `docs/OPERATIONS.md`, Running a goal, shall state R1 and R2 in a paragraph of its own after the paragraph of card T0-GOAL-MERGED-CARD, as what holds with `--card`, and shall say that the rule under Sessions, `ref=` is the first known card id of the text, is the rule for a request that gives no card; the Sessions section stays as it is. `docs/ARCHITECTURE.md`, Goal state machine, shall state after the goal deadline sentence that a card the request gives is the card of the reasons and, where `createGoal` reads the reasons, of the goal; `changelog.d/T0-GOAL-CARD-REASON.md` shall say in one entry what the reasons now name.
acceptance:
  - 1. `tests/core/router.test.ts`, a new describe named after this card, the request of issue 423. With the known cards `T0-GATE`, `T0-GATE-2` and `T3-API`, `ref` `T0-GATE-2` and the text `Build the gate, successor of T0-GATE`, the reasons are exactly `ref=T0-GATE-2`, `resolved card T0-GATE-2`, `the text names card id T0-GATE; --card names the card of this request`, `kind=card-execute`, `size=T0 (inferred)`, `target=development (default; hosting/deploy not authorised by this request)`, in that order; `kind` is `card-execute` and `cardCount` is 1. The test fails on main at dbdeb721, where the reasons open with `ref=T0-GATE`. [R1] [R2] [R3] [dod arm 2]
  - 2. Same describe, a text that names two known cards. With `ref` `T0-GATE-2` and the text `T0-GATE then T0-GATE-2`, the reasons hold `ref=T0-GATE-2`, `resolved card T0-GATE-2`, the line of R2 for `T0-GATE` and `named cards: T0-GATE, T0-GATE-2 (count left to the projection)`, hold neither `ref=T0-GATE` nor `resolved card T0-GATE`, and `cardCount` is `unknown`. With the text `T0-GATE-2 then T0-GATE`, and with the text `implement T0-GATE-2`, the reasons hold `ref=T0-GATE-2` and `resolved card T0-GATE-2` and no reason that starts with `the text names card id`. [R1] [R2] [R3] [dod arm 2]
  - 3. Same describe, ids the known card list does not hold. With `ref` `T9-NEW` and the text `implement T3-API`, the reasons hold `ref=T9-NEW`, `card id T9-NEW referenced (registry not consulted or id absent; verify before dispatch)` and the line of R2 for `T3-API`, and hold neither `resolved card T9-NEW` nor `resolved card T3-API`. With no known card list, `ref` `T0-GATE-2` and the text `implement T1-A`, the reasons hold `ref=T0-GATE-2`, `card id T0-GATE-2 referenced (registry not consulted or id absent; verify before dispatch)` and the line of R2 for `T1-A`. With the known cards, `ref` `T3-API` and the text `implement T9-UNKNOWN`, the reasons hold `ref=T3-API`, `resolved card T3-API` and the line of R2 for `T9-UNKNOWN`, and hold no `ref=T9-UNKNOWN`. [R1] [R2] [dod arm 2]
  - 4. Same describe, the requests R3 leaves as they are. With the known cards, `ref` `#12` and the text `implement T3-API`, the reasons are exactly `ref=T3-API`, `resolved card T3-API`, `kind=card-execute`, `size=T0 (inferred)`, `target=development (default; hosting/deploy not authorised by this request)`. With `ref` `T3-API` and the text `Fix a typo in the README`, the reasons are exactly `ref=T3-API`, `kind=change`, `size=T0 (inferred)`, `target=development (default; hosting/deploy not authorised by this request)`. [R3] [dod arm 2]
  - 5. `tests/scenarios/goal-card-reason.test.ts`, a new file. In a temporary git repository whose registry holds `T0-GATE` and `T0-GATE-2`, with `AIDLC_STATE_DIR` set, `aidlc goal new "Build the gate, successor of T0-GATE" --card T0-GATE-2 --json` run in this process exits 0 and prints `routing.reasons` equal to the list of item 1; `aidlc goal status <goal> --json` prints the same `routing.reasons`, `cards` equal to `T0-GATE-2` alone and the request `ref` `T0-GATE-2`. The test fails on main at dbdeb721. [R4] [dod arm 2]
  - 6. Same file. In a fixture whose registry holds the two cards, `createGoal` with the request text `implement T0-GATE`, `ref` `T0-GATE-2` and no `cards` option returns a goal whose `cards` are `T0-GATE-2` alone; with no `ref` and the same text the goal's `cards` are `T0-GATE` alone. The first assertion fails on main at dbdeb721. [R4] [dod arm 2]
  - 7. `tests/core/router.test.ts` keeps every line it has on main, `tests/scenarios/goal-card-count.test.ts` and `tests/scenarios/goal-merged-card.test.ts` pass with no line changed, and the typecheck reports no error. [R3] [dod arm 1] [dod arm 2]
  - 8. `changelog.d/T0-GOAL-CARD-REASON.md` holds one entry under this card id followed by one line feed, and the two documents hold what R5 assigns to them (reviewer-verified against the diff). [R5] [dod arm 2]
depends_on: []
budget: 200
tdd: true
diagnosis:
  root_cause: "`classifyRequest` (`src/core/router.ts:89-126`) starts `ref` from the request's `ref` and then overwrites it with `knownCard`, the first card id of the text that the known card list holds, or with the first card id token; it writes `resolved card` or `card id ... referenced` for that id. `aidlc goal new --card <id>` (`src/cli/main.ts:383-384`) passes `<id>` as the request's `ref` and as `cards`, so the goal runs `<id>` while its reasons name the card the text names first."
  same_class: "With `--issue <n>` and a text that names a known card, `ref=#<n>` is overwritten the same way and the goal's card is taken from the text; that is the routing of a request that names a card and is not changed here."
sweep: "On main at dbdeb721. `classifyRequest` has four callers: `createGoalInScope` (src/loop/controller.ts:154), which passes the request with its `ref`; the revision check (src/loop/controller.ts:911), which reads only `ambiguity`; the prompt hook (src/hooks/index.ts:783), which passes the text alone; and the tests. `routing.reasons` has two readers, both in `createGoalInScope`: line 164 takes the goal's card from `ref=` only when no `cards` option is passed, the kind is card-execute or card-amendment and the count is 1, and line 172 reads `named cards: `. The CLI passes `cards` whenever it passes a card `ref`, so line 164 reads `ref=` for a given card only from a library caller. `tests/scenarios/goal-card-count.test.ts:101` pins the T0-GOAL-CARD-COUNT-3 sentence of docs/OPERATIONS.md, Sessions, and `tests/surface/prose.test.ts:360` holds that section under 13701 bytes, where it has 13693; so the new text goes under Running a goal and no word of Sessions changes. 80 test files read docs/OPERATIONS.md and 36 read docs/ARCHITECTURE.md."
forbid: [a change to an existing line of tests/core/router.test.ts, a change to tests/scenarios/goal-card-count.test.ts or to tests/scenarios/goal-merged-card.test.ts, a change to the Sessions section of docs/OPERATIONS.md, a change to the T0-GOAL-CARD-COUNT, T0-GOAL-MERGED-CARD or T0-INTAKE-TARGET-2 sentences of docs/OPERATIONS.md and docs/ARCHITECTURE.md, a change to CHANGELOG.md, a change to src/loop/controller.ts or src/cli/main.ts, weakening or skipping a test to go green]
non_goals: [the kind of a request that gives a card with a text that names no card id, the routing of `--issue` with a text that names a known card, the card count or the deadline of any request, a note for a second or later card id of the text, a change to what `--card` admits]
hygiene: "Issue 423. The line of R2 names `--card` as the reason on the target does with `--target` (`only --target sets the target of this request`). The given card is read from `ref` by its form, not from `source`, because `--bug-evidence --card <id>` has the source `bug-evidence`. RED fails on assertions, not on a missing import (tdd skill). The full suite runs once before the first review, because the DoD names none of the test files that read the two documents (docs/LESSONS.md, T0-RELEASE-OP-REISSUE). Before the first review, each guard of the change (the `CARD_ID_REGEX` test of `ref`, the known-list test of the card reason, the comparison of R2) is loosened in turn and a test of items 1 to 4 fails."
doc_sync: docs/OPERATIONS.md (Running a goal), docs/ARCHITECTURE.md (Goal state machine), changelog.d/T0-GOAL-CARD-REASON.md
---

# T0-GOAL-CARD-REASON

From issue 423.

## Diagnosis
Goal `g-20261122203400-dd91e3` was created with `--card T0-CONTRACT-GATE-2` and a
text that ends "successor of T0-CONTRACT-GATE". Its request `ref` and its `cards`
are `T0-CONTRACT-GATE-2`; its `routing.reasons` say `ref=T0-CONTRACT-GATE` and
`resolved card T0-CONTRACT-GATE`. The router writes the reasons from the first
known card id of the text and does not read which card the request gives. Nothing
but `createGoal` reads the reasons, and with `--card` it takes the cards from the
option, so the run was not affected; the routing record names a card the goal
does not run.

## Deliverable
`classifyRequest` treats a `ref` that is a card id as the request's card. Where
the text names a card id, `ref=` and the card reason name the given card, and a
first card id of the text that is another id is recorded in one further reason.
Nothing else of the routing result changes.

## Rules that decide edge cases
- A `ref` that is not a card id (`#<n>`) gives no card: the text decides as on main.
- A given card with a text that names no card id keeps its reasons: `ref=<given card>` and no card reason.
- The card reason says `resolved card` only for an id the known card list holds, for the given card as for a card of the text.
- The line of R2 names one id, the one the reasons named on main. `named cards:` still lists every known id of the text.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/router.test.ts tests/scenarios/goal-card-reason.test.ts tests/scenarios/goal-card-count.test.ts tests/scenarios/goal-merged-card.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: the new router and scenario tests pass, the existing goal card tests pass unchanged, and the changelog fragment is well formed.

## Attempt evidence
RED commit 6a261537 holds the tests alone; the five tests marked RED fail there on assertions.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/core/router.test.ts`, describe `T0-GOAL-CARD-REASON`, test `the request of issue 423: ...`. RED at 6a261537: the reasons were `ref=T0-GATE`, `resolved card T0-GATE`, `kind=card-execute`, ... | pass after the fix |
| 2 | Same describe, test `a text that names two known cards keeps its named cards and its unknown count, ...`. RED at 6a261537 on `ref=T0-GATE-2` | pass after the fix |
| 3 | Same describe, test `the card reason says resolved only for an id the known card list holds, ...`. RED at 6a261537 | pass after the fix |
| 4 | Same describe, test `a ref that is not a card id, and a given card with a text that names no card id, keep their reasons`. Passes at 6a261537 and after the fix: these are the requests R3 leaves as they are | pass |
| 5 | `tests/scenarios/goal-card-reason.test.ts`, test `T0-GOAL-CARD-REASON acceptance 5: ...`, the CLI in this process. RED at 6a261537 on the printed reasons | pass after the fix |
| 6 | Same file, test `T0-GOAL-CARD-REASON acceptance 6: ...`. RED at 6a261537: the goal's `cards` were `T0-GATE` | pass after the fix |
| 7 | `git diff --numstat 0726654a -- tests/` lists `43 0 tests/core/router.test.ts` and `75 0 tests/scenarios/goal-card-reason.test.ts` and no other file; DoD arm 1 and arm 2 | pass |
| 8 | `tests/surface/changelog-fragments.test.ts`; docs/OPERATIONS.md, Running a goal, the paragraph after the T0-GOAL-MERGED-CARD paragraph; docs/ARCHITECTURE.md, Goal state machine, the sentence after the goal deadline sentence | pass; the two documents are for the reviewer |

Guards, each loosened in `src/core/router.ts` and run against the two test files of the card, then restored:

| Guard | Loosened to | Test that fails |
|---|---|---|
| `CARD_ID_REGEX.test(input.ref)` | any `ref` gives a card | item 4, the `#12` request |
| `known?.includes(ref)` | any known list holds the id | item 3, `T9-NEW` |
| `known?.includes(ref)` | always resolved | item 3, the request with no list; `T0-GOAL-CARD-COUNT-3` [R2] |
| `ref !== textCard` | noted for every given card | item 2, the texts whose first card id is the given card |
| `ref !== textCard` | never noted | items 1, 2, 3 and 5 |
| `givenCard ?? textCard` | the card of the text | items 1, 2, 3, 5 and 6 |

Full suite, run once because the DoD names none of the test files that read the two documents: `npm test` in the worktree with the source, tests, documents and changelog fragment of this candidate, before this section was written, exit 0 with 4060 tests, 4028 pass, 0 fail, 32 skipped.

equivalent: `kind ? undefined : cardMatch?.[0]` loosened to `cardMatch?.[0]`. A kind is set before that line only for a text that is a bare number, and such a text holds no card id token, so `cardMatch` is null there. The guard is the `!kind` of main's `else if (cardMatch && !kind)`, kept as it was.
