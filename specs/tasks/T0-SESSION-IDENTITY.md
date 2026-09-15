---
id: T0-SESSION-IDENTITY
title: The loop's session identity is the Claude Code session (the hooks' `session_id`, `CLAUDE_CODE_SESSION_ID` in CLI processes), so concurrent windows no longer share `.aidlc/session-default` and the Stop guard lists only the acting session's cards
status: todo
branch: T0-SESSION-IDENTITY
worktree: C:\wt\T0-SESSION-IDENTITY
allow_paths:
  - src/state/journal.ts
  - src/hooks/index.ts
  - src/hooks/entry.ts
  - src/cli/main.ts
  - tests/infra/journal.test.ts
  - tests/surface/hooks.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - README.md
  - CHANGELOG.md
  - specs/tasks/T0-SESSION-IDENTITY.md
dod_command: npm run typecheck && node --test tests/infra/journal.test.ts tests/surface/hooks.test.ts tests/infra/lease.test.ts tests/scenarios/two-windows.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. The loop shall resolve the session identity of a process as `AIDLC_SESSION`, else `CLAUDE_CODE_SESSION_ID`, else `CLAUDE_SESSION_ID`, else the repository default token.
  - R2. WHEN a hook event carries `session_id` and `AIDLC_SESSION` is unset, the hook process shall act as that session.
  - R3. The `verify-before-done` guard shall omit a card run whose unreleased card lease names another session as owner.
  - R4. `aidlc doctor` shall print the resolved session with its source and warn only when the source is the default token.
acceptance:
  - 1. `resolveSessionId` returns `CLAUDE_CODE_SESSION_ID` with source `claude` when `AIDLC_SESSION` is unset; `AIDLC_SESSION` wins over both Claude variables; `CLAUDE_SESSION_ID` alone is still honoured; with none set the persisted default token is returned unchanged; `currentActor` carries the resolved value (journal.test.ts "session precedence"). [R1] [dod arm 1]
  - 2. `runHook` and `dispatchHook` act as the event's `session_id` when `AIDLC_SESSION` is unset (the event value wins over `CLAUDE_CODE_SESSION_ID` in the hook's own environment); with `AIDLC_SESSION` set the environment value wins; an event without `session_id` keeps the order of acceptance 1 (hooks.test.ts "hook session"). [R2] [dod arm 1]
  - 3. Two windows: a BUILD run without a DoD receipt whose card lease (`resourceKeys.card`, unreleased, expired or not) is owned by another session is not listed by `verify-before-done`; the acting session's own run still injects the Stop context; a run with no lease record, or with a released one, is listed as before, so the existing Stop test is unchanged (hooks.test.ts "two windows"). [R3] [dod arm 1]
  - 4. `aidlc doctor` prints the session with source `claude` under Claude Code and the `DEFAULT: every window shares this identity` warning only for the default token; `docs/OPERATIONS.md` (Sessions; the `verify-before-done` row of the Hooks table), `docs/ARCHITECTURE.md` (state layer paragraph; the `session-default` row), `README.md` (Multi-session) and `CHANGELOG.md` (Unreleased) name `CLAUDE_CODE_SESSION_ID`, the hook rule and the transition (a lease claimed under the default token before this change expires and is taken over with `aidlc goal takeover`); the doctor line is pasted in the ship evidence (mirror.test.ts, prose.test.ts). [R4] [dod arm 1]
budget: 260
tdd: true
sweep: "grep -rn 'AIDLC_SESSION\|CLAUDE_SESSION_ID\|session_id\|session-default' src bin templates docs tests README.md: journal.ts (resolver), main.ts:161 (doctor), hooks/index.ts:29 (event field, unused), providers/claude-code.ts:58 (invocation id of a headless call, not the actor; unchanged), docs/OPERATIONS.md:97, docs/ARCHITECTURE.md:12 and :170, README.md:66, CHANGELOG.md 0.1.0 entry (history; unchanged)"
non_goals: [exporting the session into CLAUDE_ENV_FILE from a SessionStart hook (documented but Bash-only; not needed while Claude Code exports CLAUDE_CODE_SESSION_ID to Bash and PowerShell subprocesses), identity from the Claude Code process (CLAUDE_PID), rewriting or migrating lease records claimed under the default token, changing the lease TTL or the takeover rules, session filtering in the other five guards (they read no lease)]
forbid: [editing .aidlc state by hand, changing LeaseStore fencing or takeover semantics]
diagnosis:
  root_cause: "resolveSessionId (src/state/journal.ts:32) reads CLAUDE_SESSION_ID, which Claude Code never exports. Claude Code 2.1.270 exports CLAUDE_CODE_SESSION_ID to Bash and PowerShell subprocesses and passes session_id in every hook event; neither was read, so every CLI process in every window fell through to .aidlc/session-default (observed in this repository: all 33 lease records owned by default-10034605 under 33 different pids), lease ownership could not tell windows apart, and verify-before-done, which reads neither the event's session_id nor the lease owner, flagged cards that other sessions own."
  same_class: "doctor (main.ts:161) tests the same absent variable and is corrected with it. providers/claude-code.ts:58 uses the session_id of a headless claude -p result as the invocation id, not as the actor, and stays. The other five guards read no lease and need no session. card-runner.ts:164 already compares the lease owner's session and host with the acting process; the guard applies the same comparison."
hygiene: "CLAUDE_CODE_SESSION_ID is absent from the documented Claude Code variable list (code.claude.com/docs/en/env-vars); AIDLC_SESSION stays the explicit override and doctor prints the source, so a Claude Code that stops exporting it shows as source default again instead of failing silently."
doc_sync: docs/OPERATIONS.md (Sessions; Hooks table row verify-before-done), docs/ARCHITECTURE.md (state layer; persisted-state row session-default), README.md (Multi-session), CHANGELOG.md
superseded_by: T0-SESSION-IDENTITY-2
---

# T0-SESSION-IDENTITY

## Deliverable
One session identity per Claude Code session, agreed by the CLI and the hooks: `resolveSessionId` reads `CLAUDE_CODE_SESSION_ID` after `AIDLC_SESSION` (keeping `CLAUDE_SESSION_ID` as a fallback), `runHook` resolves the acting session from the hook event's `session_id` before any guard reads state, and `verify-before-done` compares each card lease owner with the acting session, so a Stop in one window no longer demands the DoD receipt of a card another window owns. `doctor` reports the source.

## Transition
A goal or card lease claimed before this change is owned by the default token. After the upgrade the same window is a different session to the lease store: the lease expires (10 minutes without renewal) and `aidlc goal takeover <id>` reconciles and takes it; nothing rewrites lease records. A `/clear` or a new window is a new Claude session and follows the same path; `AIDLC_SESSION` set per window keeps one identity across them.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/journal.test.ts tests/surface/hooks.test.ts tests/infra/lease.test.ts tests/scenarios/two-windows.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the new precedence, hook-session and two-window Stop tests pass; lease, two-window, mirror and prose suites unchanged and green.
