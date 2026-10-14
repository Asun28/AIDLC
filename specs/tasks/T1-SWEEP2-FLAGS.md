---
id: T1-SWEEP2-FLAGS
title: Drop the CLAUDE_SESSION_ID fallback and the three unread goal counters, make the security check stub name no config binding, and name both release approval variables in the gate text and the docs
status: merged
branch: T1-SWEEP2-FLAGS
worktree: D:\wt\AIDLC\T1-SWEEP2-FLAGS
plan_ref: plans/dead-code-sweep-2.md#order-of-work
allow_paths:
  - src/state/journal.ts
  - src/cli/main.ts
  - src/core/types.ts
  - src/hooks/index.ts
  - tests/infra/journal.test.ts
  - tests/core/types.test.ts
  - tests/surface/hooks.test.ts
  - tests/surface/command-lines.test.ts
  - tests/surface/security-check.test.ts
  - tests/scenarios/run-driver.test.ts
  - CLAUDE.md
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-SWEEP2-FLAGS.md
dod_command: npm run typecheck && node --test tests/surface/security-check.test.ts tests/core/types.test.ts tests/infra/journal.test.ts tests/surface/hooks.test.ts tests/surface/command-lines.test.ts tests/scenarios/run-driver.test.ts
dod_exit: 0
requirements:
  - R1. The session resolution (`resolveSessionId` in `src/state/journal.ts` and the `doctor` session line in `src/cli/main.ts`) shall read only `AIDLC_SESSION` and `CLAUDE_CODE_SESSION_ID` from the environment, and the comments and docs that said the older `CLAUDE_SESSION_ID` is read (`src/state/journal.ts`, CLAUDE.md, `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`) no longer say so.
  - R2. The `GoalCounters` schema (`src/core/types.ts`) shall carry no `lifecycleRepairCycles`, `providerWaitMs` or `planningMs`, and `Goal.parse` of a record that carries them succeeds with a `counters` value that has none of them.
  - R3. The `aidlc security check` command shall exit 2 and print status `NOT CONFIGURED` with a detail that says aidlc binds no security scanner, names running the project's own scanner or a CI security job, keeps `a missing scanner is never a pass`, and does not name `aidlc.config.json`.
  - R4. The production gate's deny text for an unset approval (`src/hooks/index.ts`) shall name `RELEASE_APPROVAL` and `AIDLC_RELEASE_APPROVAL`, the environment paragraph of CLAUDE.md names both, and the `production-gate` row of `docs/OPERATIONS.md` states that `RELEASE_APPROVAL` wins when both are set and that a repository with no goal records admits any non-empty value; every allow or block decision of the gate is unchanged.
  - R5. The CHANGELOG Unreleased section shall carry an entry naming this card, the dropped `CLAUDE_SESSION_ID` fallback with `AIDLC_SESSION` as the override to set instead, the three dropped counters, the new security check detail and the deny text.
acceptance:
  - 1. `tests/infra/journal.test.ts`: with only `CLAUDE_SESSION_ID` set, `resolveSessionId` returns the default-token source, not `claude`; `CLAUDE_CODE_SESSION_ID` and `AIDLC_SESSION` resolve as before. `tests/surface/hooks.test.ts`: the Stop guard with only `CLAUDE_SESSION_ID: 'sess-hook'` returns no card. [R1] [dod arms 4, 5]
  - 2. `tests/core/types.test.ts`: `Goal.parse` of a valid goal record whose `counters` hold `lifecycleRepairCycles: 1`, `providerWaitMs: 5` and `planningMs: 7` succeeds, and the parsed `counters` keys are exactly `planningInvocations` and `integrationRepairCycles`. [R2] [dod arm 3]
  - 3. `tests/surface/security-check.test.ts` spawns `node bin/aidlc.js security check --json`: exit 2, `status` is `NOT CONFIGURED`, the detail contains `never a pass` and does not contain `aidlc.config.json`. [R3] [dod arm 2]
  - 4. `tests/surface/hooks.test.ts`: the pinned deny text (`GATE_TEXT`) names both variables, and every other gate assertion in the file passes (dod arm 5); that no other gate assertion changed is reviewer-verified against the diff. [R4] [dod arm 5]
  - 5. `tests/surface/command-lines.test.ts`: the CLAUDE.md sentences it pins name `AIDLC_SESSION`, `CLAUDE_CODE_SESSION_ID`, `RELEASE_APPROVAL` and `AIDLC_RELEASE_APPROVAL` and no `CLAUDE_SESSION_ID`; OPERATIONS states the precedence and the no-goal-records admission; no file of CLAUDE.md, ARCHITECTURE or OPERATIONS says `CLAUDE_SESSION_ID` is read; the CHANGELOG Unreleased section has a T1-SWEEP2-FLAGS entry. [R1] [R4] [R5] [dod arm 6]
  - 6. `tests/scenarios/run-driver.test.ts` passes, with its now-pointless `delete env.CLAUDE_SESSION_ID` removed. [R1] [dod arm 7]
depends_on: [T1-SWEEP2-FIX-TASK]
budget: 220
tdd: true
sweep: "grep -rn CLAUDE_SESSION_ID src tests docs CLAUDE.md templates (main at 7bdaee2): src/state/journal.ts:27,35, src/cli/main.ts:222, tests/infra/journal.test.ts:130, tests/surface/hooks.test.ts:276, tests/scenarios/run-driver.test.ts:569, CLAUDE.md:110, docs/OPERATIONS.md:149; templates/ has none. grep -rn 'lifecycleRepairCycles|providerWaitMs|planningMs' src tests: only src/core/types.ts:821-823. grep -rn RELEASE_APPROVAL: src/hooks/index.ts:417,441, tests/surface/hooks.test.ts, CLAUDE.md:112, docs/OPERATIONS.md:199. No schema in src/core/types.ts uses strict or loose objects."
forbid: [changing which commands the production gate blocks or admits, removing RELEASE_APPROVAL or the no-goal-records admission, removing the security check command, changing the goal schemaVersion]
non_goals: ["a security scanner binding in aidlc.config.json", "renaming or reordering the approval variables"]
hygiene: "Two existing assertions pin the CLAUDE_SESSION_ID fallback this card removes (tests/infra/journal.test.ts:130, tests/surface/hooks.test.ts:276); each is inverted to assert the variable is no longer read, as the spec requires. The 2026-10-12 constraint that kept lifecycleRepairCycles rested on old records failing to parse, which zod's key stripping does not do; acceptance 2 proves they parse."
doc_sync: CLAUDE.md, docs/ARCHITECTURE.md, docs/OPERATIONS.md, CHANGELOG.md
---

# T1-SWEEP2-FLAGS

## Deliverable
The session, counter, security and release-approval surfaces carry nothing the code does not read and say what the code does: `CLAUDE_SESSION_ID` is no longer read, three counters nothing reads go, the security check stops naming a config binding that does not exist, and the gate text and docs name both approval variables with their precedence.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/security-check.test.ts tests/core/types.test.ts tests/infra/journal.test.ts tests/surface/hooks.test.ts tests/surface/command-lines.test.ts tests/scenarios/run-driver.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
