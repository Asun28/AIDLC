---
id: T0-BASE-SYNC-REVIEW
title: A candidate made by resolving a base-sync conflict after both R3 decisions are used gets one more R3 decision by a configured base-sync reviewer (Codex at medium effort in this repository) instead of a STOP, so the new solution is reviewed rather than carried or ruled through
status: todo
branch: T0-BASE-SYNC-REVIEW
worktree: D:\wt\AIDLC\T0-BASE-SYNC-REVIEW
allow_paths:
  - src/config.ts
  - src/core/types.ts
  - src/core/review-policy.ts
  - src/review/pre-review.ts
  - src/loop/card-runner.ts
  - templates/aidlc.config.json
  - aidlc.config.json
  - tests/scenarios/base-sync-review.test.ts
  - tests/surface/config.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-BASE-SYNC-REVIEW.md
dod_command: npm run typecheck && node --test tests/scenarios/base-sync-review.test.ts tests/surface/config.test.ts tests/scenarios/r3-fallback.test.ts
dod_exit: 0
requirements:
  - R1. `formalReview.baseSync` (optional; `command`, `reviewer`, `timeoutMs`, `shell`, `maxDiffBytes` and `effort` parsed as for `formalReview.fallback`, with `effort.default` `medium` when omitted; a `reviewer` that differs from the primary's and the fallback's after trimming and case folding) shall name the reviewer of a base-sync decision; `templates/aidlc.config.json` ships without it, and this repository's config sets Codex (`codex exec -m gpt-6-astra -c model_reasoning_effort={effort} --sandbox read-only --output-schema {schema}`, reviewer `codex`, effort default `medium`).
  - R2. WHEN a candidate recorded by a successful attempt that cleared a `merge-conflict` repair (a base-sync candidate) needs R3 and the two-decision allowance is used, and `formalReview.baseSync` is configured, the SHIP gate shall issue one R3 decision on that candidate by the base-sync reviewer with its own effort policy (a `review` directive naming it) instead of STOP/review; the prompt shall carry the delta since the last candidate R3 decided, as decision two does, and state that the base moved.
  - R3. A base-sync decision shall be taken at most once per base-sync candidate: its pass opens the ship; its block stops the card for review with the findings retained (no repair loop past the allowance); a no-verdict takes the single no-verdict retry; a quota hold of the base-sync reviewer waits; the invocation is recorded in the review ledger under the base-sync reviewer's name and marked as a base-sync decision.
  - R4. WHEN `formalReview.baseSync` is not configured, or the candidate is not a base-sync candidate (a review repair, a DoD repair), or the base-sync candidate already had its base-sync decision, the SHIP gate shall stop for review past the allowance exactly as it does today.
acceptance:
  - 1. With both R3 decisions used and a base-sync candidate recorded, `card next` returns a `review` directive naming the base-sync reviewer; `review r3` dispatches its command with `{effort}` expanded to `medium`; a pass lets `card next` ship (tests/scenarios/base-sync-review.test.ts). [R1] [R2] [R3] [dod arm 1]
  - 2. The base-sync decision's prompt carries the delta since the candidate the last R3 decision reviewed and the sentence that the base moved (tests/scenarios/base-sync-review.test.ts). [R2] [dod arm 1]
  - 3. A base-sync block stops the card for review with its findings recorded; a no-verdict takes the retry and a second no-verdict stops; a quota hold of the base-sync reviewer waits, then runs it (tests/scenarios/base-sync-review.test.ts). [R3] [dod arm 1]
  - 4. Each of these still stops for review past the allowance: no `formalReview.baseSync`, a candidate from a repair that is not a base sync (a rejected RED receipt: a block on decision 2 already stops the card, so a review repair never reaches past the allowance), and a second base-sync decision on the same base-sync candidate (refused); a candidate repaired after a formal block is not a base-sync candidate and gets the primary's decision; a later base-sync candidate (another conflict) gets its own decision (tests/scenarios/base-sync-review.test.ts). [R3] [R4] [dod arm 1]
  - 5. The config parser accepts `formalReview.baseSync`, defaults its effort to `medium`, refuses an empty argument, a blank reviewer, and a reviewer equal to the primary's or the fallback's in any spelling; the committed config names Codex `gpt-6-astra` at `{effort}` with effort default `medium`, and the template has no `baseSync` (tests/surface/config.test.ts). [R1] [dod arm 1]
  - 6. `docs/OPERATIONS.md` (the formal review section) states when a base-sync decision runs, who runs it and what its outcomes do; CHANGELOG.md Unreleased carries the entry under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R1] [R2] [R3] [R4] [dod arm 1]
depends_on: []
budget: 400
tdd: true
sweep: "grep -n 'MAX_SUBSTANTIVE_REVIEW_DECISIONS\\|fallback\\|pendingRepair' src/: types.ts:1002 sets two decisions; card-runner.ts:1199-1203 stops a further R3 decision past it and review-policy.ts:199 refuses one after a block; config.ts:51-54 and :114-117 parse formalReview.fallback and require a distinct reviewer name; card-runner.ts:1212-1290 resolve the formal reviewer, its pool and its names (fallback pattern to reuse); card-runner.ts:2360-2374 set pendingRepair merge-conflict on a base-sync conflict; card-runner.ts:2538 clearsPendingRepair decides when a success clears it. Codex CLI 0.153.4 runs gpt-6-astra with model_reasoning_effort=medium; gpt-6-sol is refused on this account (400)."
forbid: [raising MAX_SUBSTANTIVE_REVIEW_DECISIONS, a base-sync decision on a candidate that did not come from a base-sync conflict, a second base-sync decision on one candidate, shipping on a review of an earlier candidate, a repair loop after a base-sync block]
non_goals: [the base-sync conflict resolution itself (T0-BASE-SYNC-CHANGELOG), R2 rounds past their cap, a clean base sync, the scaffold ship path]
diagnosis:
  root_cause: "A base-sync conflict after both R3 decisions leaves a new candidate that the loop can only stop on (card-runner.ts:1199-1203): the two-decision allowance bounds repairs between author and reviewer, but a base that moved is neither, and the choice left is a human ruling that the earlier reviews carry the merge, or a replacement card. PR #55 (T0-AUDIT-READMIT) was merged under such a ruling; the user asked instead for one more R3 decision on the new solution, by Codex at medium effort."
  same_class: "The same stop applies to a manual merge-conflict repair and to the [SHIP-BASE-SYNC-MERGED] candidate of T0-BASE-SYNC-CHANGELOG; both clear a merge-conflict repair, so R2 covers both."
hygiene: "Requested after PR #55. Run the mutation sweep over the base-sync gate before the first review (docs/LESSONS.md 2026-09-24); list every field that marks a base-sync candidate and a base-sync decision (docs/LESSONS.md 2026-09-26)."
doc_sync: docs/OPERATIONS.md (formal review section), CHANGELOG.md
---

# T0-BASE-SYNC-REVIEW

## Deliverable
A conflict with a moved base produces a new solution, and that solution gets its own review: when both R3 decisions are already used, a candidate made by resolving a base-sync conflict gets one more R3 decision by the configured base-sync reviewer (Codex `gpt-6-astra` at medium effort here). Its pass ships, its block stops for a human; nothing reviewed earlier is carried to the merge, and no other candidate gets a third decision.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/base-sync-review.test.ts tests/surface/config.test.ts tests/scenarios/r3-fallback.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
