---
id: T0-PARSE-GUARD-FOLLOWUPS
title: The T1-PARSE-GUARD review follow-ups (issue #79), retry-after units read as whole words, a typed ConfigError that doctor alone catches, formalReview.baseSync.reviewer in the blank-refusal sweep and a -z scan that finds every quote spelling
status: merged
branch: T0-PARSE-GUARD-FOLLOWUPS
worktree: D:\wt\AIDLC\T0-PARSE-GUARD-FOLLOWUPS
allow_paths:
  - src/core/parse-guard.ts
  - src/config.ts
  - src/cli/main.ts
  - tests/core/parse-guard.test.ts
  - tests/surface/config.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-PARSE-GUARD-FOLLOWUPS.md
dod_command: npm run typecheck && node --test tests/core/parse-guard.test.ts tests/surface/config.test.ts
dod_exit: 0
requirements:
  - R1. `detectQuotaHold` shall read the unit of a `retry after <n>` in the text only as a whole word, in any letter case, with or without a space after the number: `ms`, `msec`, `msecs`, `millis`, `millisecond` and `milliseconds` are milliseconds; `m`, `min`, `mins`, `minute` and `minutes` are minutes; `s`, `sec`, `secs`, `second`, `seconds`, no unit, and any other word are seconds. A unit word with a letter or digit directly after it is not that unit.
  - R2. `loadProjectConfig` shall throw a `ConfigError` (exported from `src/config.ts`, an `Error` named `ConfigError`) when `aidlc.config.json` is not JSON or fails the schema, with the message `aidlc.config.json: <reason>`: for the schema each issue path and message as today, for JSON the parser's message. A file that cannot be read (a directory at that path, no permission) throws Node's own error, never a `ConfigError`.
  - R3. `aidlc doctor` shall print `config: ERROR <message>` with exit 1 and no stack trace only for a `ConfigError`; any other failure while it loads its context ends it with that failure's own message, as it ends every other command, and never as `config: ERROR`. The `src/cli/main.ts` change is the doctor catch and the `ConfigError` import it needs.
  - R4. The blank-refusal sweep in `tests/surface/config.test.ts` shall list `formalReview.baseSync.reviewer` with the other reviewer names.
  - R5. The `-z` scan in `tests/core/parse-guard.test.ts` shall find a `-z` argument written as a single-quoted, double-quoted or template literal in code, and never one in a comment.
  - R6. `docs/OPERATIONS.md` and the CHANGELOG Unreleased section shall state R1 to R3.
acceptance:
  - 1. `tests/core/parse-guard.test.ts`: `retry after 30 milliseconds`, `30 millisecond`, `30 millis`, `30 msecs`, `30 msec` and `30ms` are 30 ms; `30 m`, `30 min`, `30 mins`, `30 minute` and `30 minutes` are 30 min; `30 s`, `30 sec`, `30 secs`, `30 second`, `30 seconds`, `30` and `30 hours` are 30 s; `30 msx`, `30 minx`, `30 millisecondsx` and `30 m5` are 30 s; `30 MILLISECONDS` and `30 Minutes` read their unit in any case. [R1] [dod arm 1]
  - 2. `tests/surface/config.test.ts`: `loadProjectConfig` throws a `ConfigError` whose message is `aidlc.config.json: preReview.answerMarker: must be empty or not blank` on a blank marker and starts `aidlc.config.json: ` on text that is not JSON; a directory named `aidlc.config.json` throws an error that is not a `ConfigError`, with code `EISDIR`. [R2] [dod arm 1]
  - 3. The same file: `aidlc doctor` on a blank marker and on text that is not JSON prints `config: ERROR aidlc.config.json: ...`, exits 1 and prints no stack trace; on a directory named `aidlc.config.json` it exits 1 with `EISDIR` in its output and no `config: ERROR`. [R3] [dod arm 1]
  - 4. The same file: the blank-refusal sweep lists `formalReview.baseSync.reviewer` and refuses `''`, `'   '` and a tab and a newline there with an issue at that path. [R4] [dod arm 1]
  - 5. `tests/core/parse-guard.test.ts`: the scan's literal finder finds `'-z'`, `"-z"` and `` `-z` `` in code and nothing in a line or block comment or in `'-zz'`; the src scan still resolves at least three `-z` listings, each read through `nulList`. [R5] [dod arm 1]
  - 6. The two test files read the exact sentences this card adds to `docs/OPERATIONS.md` and the CHANGELOG Unreleased section and fail with any one removed. [R6] [dod arm 1]
depends_on: []
budget: 220
tdd: true
sweep: "grep -n 'RETRY\\|retryAfterMs' src/core/parse-guard.ts; grep -n 'throw new Error\\|JSON.parse' src/config.ts; grep -n 'config: ERROR' src/cli/main.ts; grep -n \"includes(\\\"'-z'\\\")\\|SCALARS\" tests/core/parse-guard.test.ts tests/surface/config.test.ts: parse-guard.ts:17 RETRY takes `(ms|m)?`, so `retry after 30 milliseconds` is 30 minutes (issue #79 item 1); config.ts:143-144 JSON.parse throws a SyntaxError and the schema failure a plain Error, and main.ts:179 doctor catches every error of ctx(g()) as `config: ERROR` (items 2 and 3); config.test.ts SCALARS has no formalReview.baseSync.reviewer (item 4); parse-guard.test.ts:26 finds a -z listing by the single-quoted literal alone (item 5). The other callers of loadProjectConfig (main.ts ctx, hooks/index.ts:324) keep the message; a ConfigError is an Error. ctx(g()) can fail today only in the config read, so a directory at aidlc.config.json is the failure that is not a ConfigError."
forbid: [editing src/loop/card-runner.ts, src/core/review-policy.ts, the store, lease or journal modules (the T1-STORE-CAS line), editing src/delivery/github-ship.ts (T0-CI-RED-LOGS-BOUNDS), a main.ts hunk outside the doctor action and its import line, a read failure of aidlc.config.json reported as config: ERROR, a looser quota word rule]
non_goals: ["hours or any other unit in a retry-after text: read as seconds, as before this card", "a stack-free message for a failure that is not a ConfigError: doctor ends like every other command, which prints Node's error", "the R2 note that QUOTAs and RATE LIMITed hold: they do not (issue #79, Not taken)"]
hygiene: "Filed from issue #79 (advisory notes of the T1-PARSE-GUARD reviews, none blocking). Items 4 and 5 are test-only and green at RED; the mutation sweep before the first review proves them (a blank baseSync reviewer accepted, a -z listing spelled with double quotes that skips nulList). The RED run has a seam export of ConfigError that nothing throws (docs/LESSONS.md 2026-09-26 T1-PARSE-GUARD)."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-PARSE-GUARD-FOLLOWUPS

## Deliverable
The five advisory notes the T1-PARSE-GUARD reviews left in issue #79: a `retry after 30 milliseconds` waits 30 ms instead of 30 minutes, `aidlc doctor` reports `config: ERROR` only for a configuration that does not parse, the blank-refusal sweep covers the base-sync reviewer name, and the `-z` scan cannot be escaped by a quote spelling.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/parse-guard.test.ts tests/surface/config.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
