---
id: T0-SESSION-IDENTITY-2
title: The loop's session identity is the Claude Code session (the hooks' `session_id`, `CLAUDE_CODE_SESSION_ID` in CLI processes), the Stop guard lists only the acting session's cards and names an unreadable lease by code alone, and the docs promise no card recovery that does not exist (replacement of T0-SESSION-IDENTITY after its two R3 decisions)
status: todo
branch: T0-SESSION-IDENTITY-2
worktree: C:\wt\T0-SESSION-IDENTITY-2
allow_paths:
  - src/state/journal.ts
  - src/hooks/index.ts
  - src/hooks/entry.ts
  - src/cli/main.ts
  - tests/infra/journal.test.ts
  - tests/surface/hooks.test.ts
  - tests/scenarios/two-windows.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - README.md
  - CHANGELOG.md
  - specs/tasks/T0-SESSION-IDENTITY.md
  - specs/tasks/T0-SESSION-IDENTITY-2.md
dod_command: npm run typecheck && node --test tests/infra/journal.test.ts tests/surface/hooks.test.ts tests/infra/lease.test.ts tests/scenarios/two-windows.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. The loop shall resolve the session identity of a process as `AIDLC_SESSION`, else `CLAUDE_CODE_SESSION_ID`, else `CLAUDE_SESSION_ID`, else the repository default token.
  - R2. WHEN a hook event carries `session_id` and `AIDLC_SESSION` is unset, the hook process shall act as that session.
  - R3. The `verify-before-done` guard shall omit a card run whose unreleased card lease names another session as owner.
  - R4. `aidlc doctor` shall print the resolved session with its source and warn only when the source is the default token.
  - R5. WHEN a card lease record cannot be read, the `verify-before-done` guard shall report it by card id and error code only.
  - R6. The changed documents shall describe card-lease recovery as running with `AIDLC_SESSION` set to the owner session id and shall promise no card takeover command.
  - R7. `aidlc card status` shall print the current card lease with its owner session, live or expired, next to the run.
acceptance:
  - 1. `resolveSessionId` returns `CLAUDE_CODE_SESSION_ID` with source `claude` when `AIDLC_SESSION` is unset; `AIDLC_SESSION` wins over both Claude variables; `CLAUDE_SESSION_ID` alone is still honoured; with none set the persisted default token is returned unchanged; `currentActor` carries the resolved value (journal.test.ts "session precedence"). [R1] [dod arm 1]
  - 2. `runHook` and `dispatchHook` act as the event's `session_id` when `AIDLC_SESSION` is unset (the event value wins over `CLAUDE_CODE_SESSION_ID` in the hook's own environment); with `AIDLC_SESSION` set the environment value wins; an event without `session_id` keeps the order of acceptance 1 (hooks.test.ts "hook session"). [R2] [dod arm 1]
  - 3. Two windows: a BUILD run without a DoD receipt whose card lease (`resourceKeys.card`, unreleased, expired or not) is owned by another session is not listed by `verify-before-done`; the acting session's own run still injects the Stop context; a run with no lease record, or with a released one, is listed as before, so the existing Stop test is unchanged; the expired lease of the fixture expired in 2020 and the live ones expire in 2126, so the case holds under any wall clock (hooks.test.ts "two windows"). [R3] [dod arm 1]
  - 4. `aidlc doctor` prints the session with the source token `claude` under Claude Code, `env` for the override, and `default` with the `DEFAULT: every window shares this identity` warning only for the default token; `docs/OPERATIONS.md` (Sessions; the `verify-before-done` row of the Hooks table), `docs/ARCHITECTURE.md` (state layer paragraph; the `session-default` row), `README.md` (Multi-session) and `CHANGELOG.md` (Unreleased) name `CLAUDE_CODE_SESSION_ID`, the hook rule and the transition (a lease claimed under the default token before this change, or by a session that has ended, stays as recorded and expires); the doctor lines are pasted in the ship evidence (mirror.test.ts, prose.test.ts). [R4] [dod arm 1]
  - 5. `verify-before-done` names an unreadable card lease by card id and `StoreError` code only (`READ_FAILED`, `MALFORMED_JSON`, `SCHEMA_VIOLATION`; any other failure as `UNREADABLE`), never the raw error message or the file's contents; a lease file holding a synthetic secret-looking value and an instruction sentence yields a Stop context that lists the run, names the code and contains neither string, and the other runs are listed or omitted as in acceptance 3 (hooks.test.ts "unreadable lease"). [R5] [dod arm 1]
  - 6. The changed documents promise no recovery that does not exist: `docs/OPERATIONS.md` (Sessions), `README.md` (Multi-session), `docs/ARCHITECTURE.md` (state layer) and the CHANGELOG entry state that `aidlc goal takeover` moves the goal lease only, that a card lease held by an ended session is continued by running with `AIDLC_SESSION` set to the owner session id that `aidlc card status <card>` prints as `lease.owner.session` (the PREPARE stop names the owner only for a run that reaches PREPARE; a run in progress stops before it with the generic stale-generation detail, and that stop outlives the lease's expiry), and that the `aidlc card takeover` command named by the PREPARE stop is a follow-up card, not a command (mirror.test.ts, prose.test.ts; the corrected sentences quoted in the ship evidence). [R6] [dod arm 1]
  - 7. `aidlc card status <card>` prints `lease` next to the run: `owner.session`, `owner.host`, `generation`, `expiresAt`, `released` and `ownedByThisSession`, read from the lease store (`null` without a record; an unreadable record as its store error code, never its contents); the two-window scenario shows a BUILD run whose live lease belongs to window A stopping for ownership in window B with the generic stale-generation detail, the stop persisting after the lease expired, the owner session readable from the lease record in both states, and the run continuing once the acting identity is the owner's on the same host, which is what `AIDLC_SESSION=<owner session id>` does (two-windows.test.ts "live to expired"; the status output pasted in the ship evidence). [R7] [dod arm 1]
budget: 360
tdd: true
sweep: "grep -rn 'AIDLC_SESSION\|CLAUDE_SESSION_ID\|session_id\|session-default' src bin templates docs tests README.md: journal.ts (resolver), main.ts:161 (doctor), hooks/index.ts:29 (event field), providers/claude-code.ts:58 (invocation id of a headless call, not the actor; unchanged), docs/OPERATIONS.md:97, docs/ARCHITECTURE.md:12 and :170, README.md:66, CHANGELOG.md 0.1.0 entry (history; unchanged); grep -rn 'card takeover' src tests docs README.md CHANGELOG.md: card-runner.ts:324 only, the PREPARE ownership stop, named as the follow-up and left unchanged"
non_goals: [exporting the session into CLAUDE_ENV_FILE from a SessionStart hook (documented but Bash-only; not needed while Claude Code exports CLAUDE_CODE_SESSION_ID to Bash and PowerShell subprocesses), identity from the Claude Code process (CLAUDE_PID), rewriting or migrating lease records claimed under the default token, changing the lease TTL or the takeover rules, session filtering in the other five guards (they read no lease), a fenced card takeover command (aidlc card takeover as named by the PREPARE ownership stop at card-runner.ts:324; a follow-up card), changing that stop's text (card-runner.ts is outside this card)]
forbid: [editing .aidlc state by hand, changing LeaseStore fencing or takeover semantics, copying any part of a lease file into hook output]
diagnosis:
  root_cause: "resolveSessionId (src/state/journal.ts:32) read CLAUDE_SESSION_ID, which Claude Code never exports. Claude Code 2.1.270 exports CLAUDE_CODE_SESSION_ID to Bash and PowerShell subprocesses and passes session_id in every hook event; neither was read, so every CLI process in every window fell through to .aidlc/session-default (observed in this repository: all 33 lease records owned by default-10034605 under 33 different pids), lease ownership could not tell windows apart, and verify-before-done, which read neither the event's session_id nor the lease owner, flagged cards that other sessions own. T0-SESSION-IDENTITY repaired this and took two R3 blocks: decision 1 (four findings, repaired at aa5e1a1 and 492bac7) and decision 2 (two findings that this card carries as acceptance 5 and 6: the unreadable-lease diagnostic copied the raw parse error, whose text quotes the file contents, into every session's Stop context; and the docs promised card recovery through aidlc goal takeover, which moves only the goal lease, while the PREPARE ownership stop names aidlc card takeover, a command that does not exist). This card's R3 decision 1 added acceptance 7: a run in progress whose live lease belongs to an ended session stops before PREPARE with the generic stale-generation detail, the stop outlives the expiry, and card status printed no lease, so the documented recovery could not supply the owner session id; card status now prints the lease."
  same_class: "doctor (main.ts:161) tested the same absent variable and is corrected with it. providers/claude-code.ts:58 uses the session_id of a headless claude -p result as the invocation id, not as the actor, and stays. The other five guards read no lease and need no session. card-runner.ts:164 already compares the lease owner's session and host with the acting process; the guard applies the same comparison. No other hook output quotes a file: the frozen-path, secrets and fix-task guards print the path or a pattern name only."
hygiene: "CLAUDE_CODE_SESSION_ID is absent from the documented Claude Code variable list (code.claude.com/docs/en/env-vars); AIDLC_SESSION stays the explicit override and doctor prints the source, so a Claude Code that stops exporting it shows as source default again instead of failing silently. Test fixtures date expiry self-evidently (2020 expired, 2126 live) because reviewers cannot see the wall clock."
doc_sync: docs/OPERATIONS.md (Sessions; Hooks table row verify-before-done), docs/ARCHITECTURE.md (state layer; persisted-state row session-default), README.md (Multi-session), CHANGELOG.md
---

# T0-SESSION-IDENTITY-2

## Deliverable
One session identity per Claude Code session, agreed by the CLI and the hooks: `resolveSessionId` reads `CLAUDE_CODE_SESSION_ID` after `AIDLC_SESSION` (keeping `CLAUDE_SESSION_ID` as a fallback), `runHook` resolves the acting session from the hook event's `session_id` before any guard reads state, and `verify-before-done` compares each card lease owner with the acting session, so a Stop in one window no longer demands the DoD receipt of a card another window owns. A lease record the guard cannot read is reported by card id and error code, never by content. `doctor` reports the source. The docs describe recovery as it exists.

## Transition
A goal or card lease claimed before this change is owned by the default token; after the upgrade the same window is a different session to the lease store, and a `/clear` or a new window is a new Claude Code session with the same effect. Nothing rewrites lease records. The goal lease expires after its 10-minute TTL and `aidlc goal takeover <id>` takes it after the old owner's operations are reconciled. A card lease is not taken over by that command: the PREPARE ownership stop names the owner session, and running with `AIDLC_SESSION=<that session id>` continues the card as its owner (session and host). The `aidlc card takeover` command that stop names is a follow-up card; until it ships no document promises it.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/journal.test.ts tests/surface/hooks.test.ts tests/infra/lease.test.ts tests/scenarios/two-windows.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the precedence, hook-session, two-window and unreadable-lease tests pass, the last one with neither planted string in the context; lease, two-window, mirror and prose suites unchanged and green.
