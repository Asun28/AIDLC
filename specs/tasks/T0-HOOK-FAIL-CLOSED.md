---
id: T0-HOOK-FAIL-CLOSED
title: "A guard that throws on a PreToolUse event blocks the tool call, through both hook entries"
status: merged
branch: T0-HOOK-FAIL-CLOSED
allow_paths:
  - src/hooks/index.ts
  - src/hooks/lazy.ts
  - tests/surface/hook-lazy.test.ts
  - tests/surface/hook-fail-closed.test.ts
  - tests/surface/hooks.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T0-HOOK-FAIL-CLOSED.md
  - specs/tasks/T0-HOOK-FAIL-CLOSED.md
dod_command: npm run typecheck && node --test tests/surface/hook-fail-closed.test.ts tests/surface/hook-lazy.test.ts tests/surface/hooks.test.ts tests/surface/hook-name.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. When a guard that `runHook` (`src/hooks/index.ts`) runs throws on an event whose `hook_event_name` is `PreToolUse`, `runHook` shall return exit code 2, no stdout, and one stderr line `[aidlc hook] <guard name> could not decide; the tool call is blocked: <message>`, where `<message>` is the error's message with its line breaks joined by ` | `. This covers both dispatcher passes of `dispatchHook` and the per-guard and `auto` forms of `aidlc hook`.
  - R2. On any other event (`Stop`, `UserPromptSubmit`, an event with no name) a throw of a guard shall reach the entry as before: `bin/aidlc-hook.js` names it on stderr and exits 0, and `aidlc hook` exits 1 (`bin/aidlc.js`).
  - R3. A guard that decides without throwing shall decide as before, and an event that loads no failing module shall not be blocked by this change.
  - R4. `docs/OPERATIONS.md`, Hooks section, and the comment of `LazyLoadError` (`src/hooks/lazy.ts`) shall state R1 and R2 and how to recover from a guard that throws on every call.
acceptance:
  - 1. `tests/surface/hook-lazy.test.ts`, T0-HOOK-LAZY-2 acceptance 7, renamed for this card: the three rows that break `state/goal-store.ts` and send the production deploy `PreToolUse` event through `bin/aidlc-hook.js` (with `RELEASE_APPROVAL`, under a valid config and under a config the schema rejects) expect status 2, empty stdout and stderr starting `[aidlc hook] production-gate could not decide; the tool call is blocked: cannot load ../state/goal-store: `. The three `Stop` rows keep status 0, empty stdout and stderr starting `[aidlc hook] cannot load `. RED on main, where the deploy rows exit 0. [R1] [R2] [dod arm 2]
  - 2. Same file, one new test on the same fixture with `state/goal-store.ts` broken: a `PreToolUse` Bash event with the command `git status` through `bin/aidlc-hook.js` exits 0 with empty stdout and stderr, since no guard loads the goal store for it. [R3] [dod arm 2]
  - 3. `tests/surface/hook-fail-closed.test.ts`, new file, in process. A `tool_input` whose `command` (Bash) or `file_path` (Edit) getter throws makes the guard throw. `runHook('production-gate', ...)` on a `PreToolUse` Bash event and `runHook('protect-paths', ...)` on a `PreToolUse` Edit event return `{ exitCode: 2, stderr }` with the R1 line naming that guard; an error message `a
b` gives `a | b`; `dispatchHook` on the Bash event returns exit 2 naming `production-gate`, the first guard. The same `runHook('production-gate', ...)` call on a `UserPromptSubmit` event and on an event with no `hook_event_name` throws the getter's error. RED on main for the `PreToolUse` rows, which throw there. `aidlc hook <name>` and `aidlc hook auto` reach the guards only through `runHook` and `dispatchHook` (`src/cli/main.ts:1710-1722`, reviewer-verified). [R1] [R2] [dod arm 2]
  - 4. `tests/surface/hook-name.test.ts` passes unchanged. In `tests/surface/hooks.test.ts`, `mainDecision`, which models the decision before card T0-HOOK-CONFIG-CLOSED-3 by calling `runHook` and turning a throw into a pass, turns a result whose stderr starts `[aidlc hook] <guard> could not decide; the tool call is blocked: ` into a pass as well, since that result is this card's form of the same throw; no other line of the file changes, and the file passes (owner amendment of 2026-11-26). [R3] [dod arm 2]
  - 5. One paragraph added to the Hooks section of `docs/OPERATIONS.md`, not as its second paragraph (which T0-HOOK-LAZY-2 acceptance 5 pins), states R1, R2 and the recovery: Read, Grep and Glob stay outside the PreToolUse matcher, so the session can read the error; the owner fixes the guard or removes the hook entry from `.claude/settings.json` by hand. The `LazyLoadError` comment says a `PreToolUse` guard blocks and other events exit as before (reviewer-verified against the diff). `changelog.d/T0-HOOK-FAIL-CLOSED.md` holds one line in the form of `changelog.d/README.md`. [R4] [dod arm 2]
  - 6. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 120
tdd: true
sweep: "On main at 59bf82c0 `src/hooks/entry.ts:110-112` catches every throw of `dispatchHook` and exits 0, and `aidlc hook <name>` (`src/cli/main.ts:1710`) has no catch, so a throw reaches `bin/aidlc.js`, which exits 1; Claude Code treats both as non-blocking. The template hook command is `npx --no-install aidlc hook auto` (`tests/surface/templates.test.ts:75`), so downstream repositories take the second path and this repository the first. `runHook` is the one function both paths call for each guard. The PreToolUse guards are production-gate, protect-paths, secrets-guard and stdin-script for shell tools and protect-paths, secrets-guard and protect-tests for edit tools (`src/hooks/entry.ts:41-48`). Of the lazy modules only the goal store is loaded on PreToolUse, by production-gate when a production pattern matches and an approval is set, so a broken lazy module blocks only that call. The unusable-config path (`src/hooks/index.ts:305-324`) already denies every shell command but `aidlc doctor`, which is the precedent for a guard that cannot decide. `readStdinJson` (`src/hooks/index.ts:794`) turns malformed stdin into `{}`, which dispatches no guard, and stays as it is. `src/cli/main.ts:13` imports the goal store statically, so a broken goal store fails `aidlc hook` at import with exit 1 before any guard runs; that is a failure of the entry, not of a guard, and so outside this card. CHANGELOG.md keeps the released T0-HOOK-LAZY-2 entry that says a load error exits 0; it is history."
forbid: [network]
non_goals:
  - "malformed or empty stdin, which stays `{}` and dispatches nothing"
  - "a module the CLI imports statically that fails to load, which fails `aidlc hook` at import (exit 1) before `runHook`: a follow-up issue"
  - "a throw outside a guard: `renewSessionCardLeases`, `loadHookConfig`, `settleRepoIdentity` and the stdin read in `src/hooks/entry.ts`"
  - "Stop and UserPromptSubmit, which stay fail-open (R2)"
  - "an exemption for `aidlc doctor` or any repair command under a guard that throws"
  - "the git command guard of issue 498 (card 3)"
hygiene: "From issue 501 and the plan agreed with Codex on 2026-11-26 (card 2). RED first: acceptance 1 and 2 alone, on main. The hook-lazy fixture copies `src/` and `bin/` into a temporary package, so a broken module never touches the checkout. The catch goes in `runHook` only, so both entries and both dispatcher passes share it; do not add one to `dispatchHook` or the entries."
---

# T0-HOOK-FAIL-CLOSED

From issue 501 (card 2 of the plan agreed with Codex on 2026-11-26), after Lydia Hallie's talk "Rethinking Claude Code Best Practices" (AI Engineer CODE, 2026-11-11): a hook that must stop Claude has to exit 2, since other non-zero codes do not block.

## Why
A PreToolUse guard that throws today exits 0 through `bin/aidlc-hook.js` and 1 through `aidlc hook`, and both let the tool call run. So a broken module or a bug in a guard switches the guard off without any sign but one stderr line. The unknown hook name already fails closed (card T1-SWEEP-HOOK-NAME).

## Deliverable
One catch in `runHook` that blocks a PreToolUse call when its guard throws, the hook-lazy test rows that pin it through both entries, and the docs.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/hook-fail-closed.test.ts tests/surface/hook-lazy.test.ts tests/surface/hooks.test.ts tests/surface/hook-name.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: a guard that throws on PreToolUse exits 2 through both entries, Stop exits as before, and `git status` is not blocked.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|
| 1 | tests/surface/hook-lazy.test.ts, T0-HOOK-FAIL-CLOSED acceptance 1: deploy rows with no config file, a valid config file (added at R3 decision 1) and a config the schema rejects | RED at aae3329c (deploy row status 0, expected 2); with the base `src/hooks/index.ts` put back after R3 decision 1 the test still stops at its first deploy row (status 0); all rows pass on the candidate |
| 2 | tests/surface/hook-lazy.test.ts, T0-HOOK-FAIL-CLOSED acceptance 2 | passes on main and on the candidate (a guard row) |
| 3 | tests/surface/hook-fail-closed.test.ts | RED at aae3329c (the PreToolUse rows throw `no command`), passes on the candidate; the R2 rows pass on both |
| 4 | tests/surface/hooks.test.ts, tests/surface/hook-name.test.ts; git diff origin/main -- tests/surface/hooks.test.ts | pass; one comment and one line in `mainDecision` |
| 5 | git diff origin/main -- docs/OPERATIONS.md src/hooks/lazy.ts changelog.d; tests/surface/changelog-fragments.test.ts | one paragraph at the end of the Hooks section, the comment, one fragment line; pass |
| 6 | `npm run typecheck` | exit 0 |

## PR summary

### What
A hook guard that throws on a PreToolUse event now blocks the tool call. It exits 2 and names the guard on stderr.

### Why / Intent
Before, the hook entry exited 0 and `aidlc hook` exited 1 on a throw. Claude Code runs the tool on both, so a broken guard was off (issue 501).

### How / Behaviour
`runHook` catches a throw of the guard it runs. On PreToolUse it returns the block. On other events it rethrows, so Stop and UserPromptSubmit exit as before.

### System impact
Both hook entries and both dispatcher passes call `runHook`, so one catch covers all of them. A guard that decides without a throw decides as before.

### Security
A broken module or a guard bug can no longer turn a guard off without notice. The production gate stays closed when the goal store fails to load.

### Tests and review
The hook-lazy rows now expect exit 2 for the deploy event with a broken goal store. A new test makes guards throw in process. The `mainDecision` model in hooks.test.ts reads the new block as the old pass (owner amendment).

### Risk
A guard that throws on every call blocks every shell and edit call. Read, Grep and Glob still work. The owner then fixes the guard or removes the hook entry.

### Ownership
The aidlc maintainers own `src/hooks/`.

### Docs
docs/OPERATIONS.md, Hooks section, states the rule and the recovery. The `LazyLoadError` comment and a changelog fragment record it.
