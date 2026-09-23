---
id: T0-R3-FALLBACK-2
title: An optional formalReview.fallback reviewer runs R3 while the primary formal reviewer is on an unexpired quota hold for the card, instead of parking the card in WAIT; this repository's primary is Codex gpt-6-sol and its fallback Claude Opus 5.5
status: merged
branch: T0-R3-FALLBACK-2
worktree: D:\wt\AIDLC\T0-R3-FALLBACK-2
allow_paths:
  - src/config.ts
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - tests/surface/config.test.ts
  - tests/scenarios/r3-fallback.test.ts
  - aidlc.config.json
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - .claude/skills/aidlc-loop/card-loop.md
  - templates/claude/skills/aidlc-loop/card-loop.md
  - specs/tasks/T0-R3-FALLBACK-2.md
dod_command: npm run typecheck && node --test tests/surface/config.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/t0-flow.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R1. The `formalReview` config shall accept an optional `fallback` object with `command` (non-empty argv), `reviewer`, `timeoutMs`, `shell` and `maxDiffBytes`, defaulted like `formalReview`; an absent `fallback` leaves every behaviour unchanged.
  - R2. WHEN the latest formal invocation of the card by the primary reviewer, on any candidate, is a quota hold whose `holdUntil` is after now AND a fallback is configured, the SHIP gate shall issue the review directive naming the fallback reviewer instead of WAIT, and `aidlc review r3` shall dispatch the fallback command under the fallback reviewer name.
  - R3. WHEN both the primary and the fallback hold unexpired quota holds on the card, the gate shall WAIT on `review-quota` until the earlier of the two holds clears.
  - R4. WHEN the primary's hold has expired, the primary reviewer shall be dispatched again; the fallback never replaces a primary that is not on hold.
  - R5. A fallback decision shall count against the same two-decision allowance, the same single no-verdict retry and the same same-candidate rule as a primary decision; the canonical verdict document and `REVIEW_DECIDED` shall name the reviewer that decided, and a ship-path re-read of a fallback decision shall not be a second decision.
  - R6. WHILE a fallback is configured, each formal reviewer shall queue in its own review pool `<reviewPool>/<reviewer>`, because a quota hold resets the whole pool it lands in and the two reviewers hold separate quotas; the ship's own admission stays in the goal's pool; a request already stored under the same key keeps its pool; without a fallback the pool is unchanged.
  - R7. WHEN a formal reviewer is dispatched for a candidate, the queued or retry-after request of the other configured formal reviewer for that candidate whose only requester is this card shall be cancelled, the pool's reset time kept, so no request of a reviewer the card will not run again is left for another card to admit.
acceptance:
  - 1. `ProjectConfig.parse` accepts `formalReview.fallback` with only `command` and `reviewer` and fills `timeoutMs`, `maxDiffBytes`; a fallback with an empty `command` is rejected; a config without `fallback` parses to `fallback: undefined` (tests/surface/config.test.ts). [R1] [dod arm 2]
  - 2. Scenario: the primary returns a quota hold; `card next` returns `kind: review` with `reviewer` equal to the fallback name (not `wait`); `formalReview` runs the fallback command, whose pass records an invocation with the fallback reviewer, a canonical `.review/<card>.json` with `reviewer` equal to the fallback name, and the ship proceeds; this passes only because the fallback queues outside the pool the primary hold reset; a fallback no-verdict retries on the fallback and a second one is STOP/review (tests/scenarios/r3-fallback.test.ts). [R2] [R5] [R6] [dod arm 2]
  - 3. Scenario: primary and fallback both return quota holds, in either order of expiry; `card next` returns `wait` on `review-quota` with `pollSeconds` bounded by the earlier hold; after that hold clears the reviewer whose hold cleared is dispatched (tests/scenarios/r3-fallback.test.ts). [R3] [dod arm 2]
  - 4. Scenario: after the primary's hold expires, `card next` names the primary reviewer again and `formalReview` runs the primary command; with no fallback configured a primary hold is still `wait` on `review-quota` (the existing t0-flow R3 scenario, unchanged, passes). [R4] [dod arm 2]
  - 5. Scenario: a fallback block followed by a primary decision on the repaired candidate consumes both decisions (`substantiveDecisions` 2) and a further required review is STOP/review, so switching reviewers never adds a decision (tests/scenarios/r3-fallback.test.ts). [R5] [dod arm 2]
  - 6. `aidlc.config.json` sets `formalReview.command` to `codex exec -m gpt-6-sol --sandbox read-only --output-schema {schema}` with reviewer `codex`, and `formalReview.fallback` to the headless `claude -p --model claude-opus-5-5 --effort max` argv with read-only tools (`Read,Grep,Glob`), no setting sources (`--setting-sources=`) and no MCP servers (`--strict-mcp-config`), reviewer `claude-opus-5-5`; a fallback with an empty argument (the Windows shell drops it) or reviewer, or under the primary's name, is rejected with an issue naming the field, never a crash (tests/surface/config.test.ts, which parses the repository file). [R1] [dod arm 2]
  - 7. docs/OPERATIONS.md (config key list and the Formal review as a command section) and docs/ARCHITECTURE.md state the fallback rule; both card-loop.md copies state that the configured fallback is the only reviewer switch on quota and stay identical, ASCII and under the byte cap (tests/surface/templates.test.ts); CHANGELOG.md Unreleased carries the entry under this card id. [R2] [R3] [dod arm 2]
  - 8. Scenario with two cards sharing the pools: card A falls back after a 60 s primary hold and passes; its primary request is cancelled; card B's primary review at +61 s is admitted and runs (tests/scenarios/r3-fallback.test.ts). [R7] [dod arm 2]
  - 9. The ship-path re-read scenarios (a fallback pass and a fallback advisory block) use a ship path whose readVerdict also returns the raw text of the published `.review/<card>.json`, so the raw document's reviewer clause is exercised: no `ship:` invocation and no further `REVIEW_DECIDED` (tests/scenarios/r3-fallback.test.ts). [R5] [dod arm 2]
depends_on: []
budget: 60
tdd: true
sweep: "grep -rn 'this.config.formalReview' src/: every reader in the R3 path (gate, admission, dispatch, commit, retained recovery, canonical publication, ship-path re-read) resolves the reviewer config of the invocation it handles"
forbid: [a fallback for the pre-review (R2), running both reviewers on one decision, a third decision or a reset counter when the reviewer changes, a fallback triggered by no-verdict or block outcomes, changing the verdict schema or the prompt]
non_goals: [a fallback list longer than one, a fallback chosen by anything but a primary quota hold, the templates/aidlc.config.json default (it keeps an empty command and no fallback), the independence check in src/core/roles.ts, reading another card's hold from a pool reset time (a card falls back only on its own ledger), fixing the empty-argument drop in src/probes/exec.ts]
hygiene: "Supersedes T0-R3-FALLBACK (branch T0-R3-FALLBACK, candidate 95dff99, STOP/review after R3 decision 2 blocked on two findings: the raw-document ship-path clause had no test, and a fallback dispatch left the primary's held request in its pool for another card to admit). This card re-applies that branch's change on main and adds R7 and acceptance 8-9; the old branch and worktree are removed at CLOSE. --strict-mcp-config was checked by asking the fallback argv to list its tools: Read, Grep and Glob only, where the argv without it also lists the claude.ai connectors."
doc_sync: docs/OPERATIONS.md (config keys, Formal review as a command), docs/ARCHITECTURE.md (R3 paragraph), CHANGELOG.md, card-loop.md (both copies)
---

# T0-R3-FALLBACK-2

## Deliverable
R3 runs through one configured command, and a quota hold on it parks the card in WAIT until the hold clears; with Codex on a multi-day usage hold a card could not ship before its deadline (T0-WORKTREE-ROOT-EDGE merged under a human ruling for that reason). `formalReview.fallback` names a second reviewer command. The card runner resolves the reviewer per dispatch: the primary unless its latest invocation on the card holds an unexpired quota hold, then the fallback; both held is WAIT until the earlier hold clears. Everything else in the R3 ledger is unchanged and reviewer-independent: the two-decision allowance, the no-verdict retry, the same-candidate rule and pool admission (the pool key already carries the reviewer name). This repository sets Codex `gpt-6-sol` as primary and a headless read-only Claude Opus 5.5 as fallback. Dispatching one reviewer for a candidate cancels this card's leftover request of the other (R7), so a held request is never admitted later by another card and left occupying the slot.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/config.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/t0-flow.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: the config accepts and defaults the fallback; the fallback runs on a primary hold, WAIT only when both are held, the primary returns once its hold clears, the allowance is shared across reviewers; the existing R3 flow is unchanged; the skill files keep their caps.
