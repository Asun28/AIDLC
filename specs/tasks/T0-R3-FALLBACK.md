---
id: T0-R3-FALLBACK
title: An optional formalReview.fallback reviewer runs R3 while the primary formal reviewer is on an unexpired quota hold for the card, instead of parking the card in WAIT; this repository's primary is Codex gpt-6-sol and its fallback Claude Opus 5.5
status: todo
branch: T0-R3-FALLBACK
worktree: D:\wt\AIDLC\T0-R3-FALLBACK
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
  - specs/tasks/T0-R3-FALLBACK.md
dod_command: npm run typecheck && node --test tests/surface/config.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/t0-flow.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R1. The `formalReview` config shall accept an optional `fallback` object with `command` (non-empty argv), `reviewer`, `timeoutMs`, `shell` and `maxDiffBytes`, defaulted like `formalReview`; an absent `fallback` leaves every behaviour unchanged.
  - R2. WHEN the latest formal invocation of the card by the primary reviewer is a quota hold whose `holdUntil` is after now AND a fallback is configured, the SHIP gate shall issue the review directive naming the fallback reviewer instead of WAIT, and `aidlc review r3` shall dispatch the fallback command under the fallback reviewer name.
  - R3. WHEN both the primary and the fallback hold unexpired quota holds on the card, the gate shall WAIT on `review-quota` until the earlier of the two holds clears.
  - R4. WHEN the primary's hold has expired, the primary reviewer shall be dispatched again; the fallback never replaces a primary that is not on hold.
  - R5. A fallback decision shall count against the same two-decision allowance, the same single no-verdict retry and the same same-candidate rule as a primary decision; the canonical verdict document and `REVIEW_DECIDED` shall name the reviewer that decided, and a ship-path re-read of a fallback decision shall not be a second decision.
acceptance:
  - 1. `ProjectConfig.parse` accepts `formalReview.fallback` with only `command` and `reviewer` and fills `timeoutMs`, `maxDiffBytes`; a fallback with an empty `command` is rejected; a config without `fallback` parses to `fallback: undefined` (tests/surface/config.test.ts). [R1] [dod arm 2]
  - 2. Scenario: the primary returns a quota hold; `card next` returns `kind: review` with `reviewer` equal to the fallback name (not `wait`); `formalReview` runs the fallback command, whose pass records an invocation with the fallback reviewer, a canonical `.review/<card>.json` with `reviewer` equal to the fallback name, and the ship proceeds (tests/scenarios/r3-fallback.test.ts). [R2] [R5] [dod arm 2]
  - 3. Scenario: primary and fallback both return quota holds; `card next` returns `wait` on `review-quota` with `pollSeconds` bounded by the earlier hold; after that hold clears the reviewer whose hold cleared is dispatched (tests/scenarios/r3-fallback.test.ts). [R3] [dod arm 2]
  - 4. Scenario: after the primary's hold expires, `card next` names the primary reviewer again and `formalReview` runs the primary command; with no fallback configured a primary hold is still `wait` on `review-quota` (the existing t0-flow R3 scenario, unchanged, passes). [R4] [dod arm 2]
  - 5. Scenario: a fallback block followed by a primary decision on the repaired candidate consumes both decisions (`substantiveDecisions` 2) and a further required review is STOP/review, so switching reviewers never adds a decision (tests/scenarios/r3-fallback.test.ts). [R5] [dod arm 2]
  - 6. `aidlc.config.json` sets `formalReview.command` to `codex exec -m gpt-6-sol --sandbox read-only --output-schema {schema}` with reviewer `codex`, and `formalReview.fallback` to the headless `claude -p --model claude-opus-5-5` argv with read-only tools and no setting sources, reviewer `claude-opus-5-5`; `aidlc doctor` parses it. [R1]
  - 7. docs/OPERATIONS.md (config key list and the Formal review as a command section) and docs/ARCHITECTURE.md state the fallback rule; both card-loop.md copies state that the configured fallback is the only reviewer switch on quota and stay identical, ASCII and under the byte cap (tests/surface/templates.test.ts); CHANGELOG.md Unreleased carries the entry under this card id. [R2] [R3] [dod arm 2]
depends_on: []
budget: 60
tdd: true
sweep: "grep -rn 'this.config.formalReview' src/: every reader in the R3 path (gate, admission, dispatch, commit, retained recovery, canonical publication, ship-path re-read) resolves the reviewer config of the invocation it handles"
forbid: [a fallback for the pre-review (R2), running both reviewers on one decision, a third decision or a reset counter when the reviewer changes, a fallback triggered by no-verdict or block outcomes, changing the verdict schema or the prompt]
non_goals: [a fallback list longer than one, a fallback chosen by anything but a primary quota hold, the templates/aidlc.config.json default (it keeps an empty command and no fallback), the independence check in src/core/roles.ts]
doc_sync: docs/OPERATIONS.md (config keys, Formal review as a command), docs/ARCHITECTURE.md (R3 paragraph), CHANGELOG.md, card-loop.md (both copies)
---

# T0-R3-FALLBACK

## Deliverable
R3 runs through one configured command, and a quota hold on it parks the card in WAIT until the hold clears; with Codex on a multi-day usage hold a card could not ship before its deadline (T0-WORKTREE-ROOT-EDGE merged under a human ruling for that reason). `formalReview.fallback` names a second reviewer command. The card runner resolves the reviewer per dispatch: the primary unless its latest invocation on the card holds an unexpired quota hold, then the fallback; both held is WAIT until the earlier hold clears. Everything else in the R3 ledger is unchanged and reviewer-independent: the two-decision allowance, the no-verdict retry, the same-candidate rule and pool admission (the pool key already carries the reviewer name). This repository sets Codex `gpt-6-sol` as primary and a headless read-only Claude Opus 5.5 as fallback.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/config.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/t0-flow.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: the config accepts and defaults the fallback; the fallback runs on a primary hold, WAIT only when both are held, the primary returns once its hold clears, the allowance is shared across reviewers; the existing R3 flow is unchanged; the skill files keep their caps.
