---
slug: v5-1-hardening
title: v5.1 hardening, correctness first, then close the ergonomics gap
spec: docs/plans/PLAN-v5.1-hardening.md#1-goal-and-boundaries
size: T1
status: draft
created: 2026-09-25T23:55:00Z
---

# Plan: v5.1 hardening (from the v5.1 goal text, section 1)

## Approval asked for
Approving this plan authorizes: the nine cards below (registered on main by
this plan's PR), four T1 goals created one wave at a time, one PR per card on
the github ship path through R2, R3 and the CI checks, and the five decisions
D1-D5 as recommended unless the approval says otherwise. It does not
authorize a release, a deploy, a force push or any spend on W0 runs beyond
the cap set in D3. No src/ file changes before approval.

## 1. Goal and boundaries
Harden the loop's correctness (W1-W4), measure it against plain Claude Code
(W0), then close three ergonomics gaps (W5) and document the init surface
(W6, W7). Source: the v5.1 goal text of 2026-09-26.

Hard constraints (from the goal text, restated so each card can cite them):
- No new subsystem: no new top-level src/ directory, state store, web UI, MCP
  server, agent or skill beyond what templates/ ships.
- W1 and W3 are net-negative in src/ lines excluding tests. A candidate that
  is not stops as STOP/scope; it is never shipped.
- W2, W4 and W5 share a budget of +400 src/ lines excluding tests; every card
  reports the running total.
- A fix that deletes no text from docs/OPERATIONS.md has to say why it is a fix.
- ESM, strict TS with erasableSyntaxOnly, a zod schema per persisted record,
  argv arrays, fixed ISO timestamps in tests.

Non-goals (rejected if they appear in any card): cloud or remote execution,
mobile steering, a model-driven coordinator that decides decomposition,
multi-repo goals, a web dashboard, a new persistence layer, anything that
makes the README Multi-session section longer.

## 2. Minimal acceptable loop
Nine cards, one PR each, merged through the loop on the github ship path.
They run one at a time: every card edits CHANGELOG.md, and most edit
docs/OPERATIONS.md. Four goals, one per wave, so a STOP in one wave does not
spend another wave's 12 h arc and the W0 runs stay outside any card deadline.

| Wave | Goal | Cards, in order | Starts when |
|---|---|---|---|
| 1 | v5.1 wave 1 | T1-BASELINE-HARNESS, T1-PARSE-GUARD, T1-STORE-CAS | plan approved |
| - | W0 runs (operator step, not a card) | 12 tasks x 2 arms x 3 runs | T1-BASELINE-HARNESS merged; D1-D3 settled |
| 2 | v5.1 wave 2 | T1-AUDIT-FACTS, T1-BOUND-TELEMETRY | wave 1 DONE |
| 3 | v5.1 wave 3 | T1-INIT-SURFACE, T1-README-SCOPE | wave 2 DONE |
| 4 | v5.1 wave 4 | T1-BASELINE-REPORT, T1-RUN-DRIVER | W0 runs finished |

W0 is two cards, not one: 72 agent runs cannot finish inside the 3 h card
deadline, so the harness and the report are cards and the runs between them
are an operator step bounded by the D3 spend cap. The harness merges first so
the runs measure the pre-hardening loop at a pinned SHA while waves 1-3 work.

## 3. Tech stack
none this version (no new dependency; the W0 harness is TypeScript run by
Node type stripping, like the CLI)

## 4. Directory structure
One new directory, `evals/baseline/` (W0: task list, harness, analysis,
results, REPORT.md). No new top-level src/ directory. `tsconfig.test.json`
adds `evals/**/*.ts` so the typecheck covers the harness.

## 4.5 Module design
Each design below comes from a read-only survey of main at 5983a1e; the file
and line references are that survey's.

**W0, T1-BASELINE-HARNESS and T1-BASELINE-REPORT.** `src/evals/runner.ts` runs
one provider call per case in place and drops `usage` (runner.ts:76-79); it
has no checkout isolation, arms or repetitions. The harness lives outside
src/ and reuses what src/ exports: `ClaudeCodeProvider` for the model call
(it already parses tokens and cost, claude-code.ts:56-63) and the runner's
command check for the oracle. `evals/baseline/harness.ts` prepares a fresh
checkout per trial at the task's base SHA with history cut at that commit;
arm A is plain Claude Code with the target repository's own agent hooks and
aidlc sections removed and one Stop hook that runs the repository's check
command; arm B is `aidlc init` at the pinned aidlc SHA on the github ship
path against the D2 sandbox repository. Both arms get the same model, effort,
turn cap, wall-clock cap and task text. The oracle applies the task's hidden
test files to the final candidate tree (arm A: the working tree; arm B: the
merged base, else the card branch head) and runs the oracle command;
resolved means exit 0. `evals/baseline/analyze.ts` computes per-task paired
differences (arm B mean minus arm A mean over three runs) per axis.

Minimum detectable difference, stated before any run: with 12 paired tasks,
a two-sided paired test at alpha 0.05 and power 0.8 detects a mean paired
difference of about 0.89 times the SD of the paired differences
((2.201 + 0.876) / sqrt(12)). If the per-task resolve-rate differences have
an SD of 0.35, the design detects about 31 percentage points and nothing
smaller. The report states the MDE from the observed SD per axis.

**W1, T1-PARSE-GUARD.** New `src/core/parse-guard.ts`, at most 28 lines:
`nulList(stdout)`, `quotaOutput(receipt)` and
`detectQuotaHold(text, status?, retryAfter?)` returning
`{ hold, via: 'structured' | 'text', evidence?, retryAfterMs? }`. A numeric
status decides alone (429 and 529 hold); otherwise one merged word rule with
`\p{L}\p{N}` classes decides and the result says `via: 'text'`. It replaces
`review-policy.ts:37-68` (32 lines), the quota substring in
`claude-code.ts:178`, the collapsed timeout branch in `classifyVerdict` and
the NUL-or-newline split in `pre-review.ts:721-723` (#39). The claude-code
provider reads `is_error` and `api_error_status` from the
`--output-format json` payload before any text rule; `claude-api.ts` merges
its `RateLimitError` branch into the `APIError` status branch. R2 (DeepSeek
wrapper) and R3 (plain-text `claude -p`) declare no structured error field,
so the text rule stays for them and every hold records its path as
`via text: <word>` or `structured: status 429` in the existing `reasons`
field. #41 is a prose lint in `tests/surface/prose.test.ts:74-112`, not src/,
and is fixed there. #52: a zod refinement rejects whitespace-only values in
every config field that gates behaviour (`answerMarker` and `worktreeRoot`
keep `''` as off/default; `base`, `reviewPool`, `reviewPolicyVersion`,
`reviewer`, `repository`, the six directory keys and the three reviewer names
refuse empty too; every element of the command, perspectives, requiredChecks,
hooks and tierPaths arrays; the `aidlc.ops.json` patterns in `delivery/ops.ts`),
and `aidlc doctor` catches the parse error and exits 1 with `config: ERROR`
naming the path instead of crashing with a stack trace. Estimated src net:
-3 to -7 lines. Spare lines if it runs over: `classifyVerdict` takes the
receipt (-1); `git.ts` and `github-ship.ts` keep their already-correct NUL
splits (-2).

**W2, T1-AUDIT-FACTS.** Today no journal event carries a commit SHA, tree
hash, check-run id or exec receipt; the verifier is offline. The card runner,
when it verifies a merge, journals the merge `OPERATION_RESULT` with a
`ShippedFacts` payload (zod schema in `core/types.ts`): `headSha`,
`mergeSha`, `tree` (of `mergeSha`) and `pr`, read from the git and gh probes,
never from ship output text. `verifyAudit` takes injectable git and gh probes
and re-derives each fact: `git cat-file -t`, `git rev-parse <mergeSha>^{tree}`,
`git merge-base --is-ancestor <mergeSha> <base>`,
`gh pr view <pr> --json state,mergeCommit,headRefOid`. A mismatch is a block
finding naming the card, the fact, the recorded and the re-derived value; a
fact that cannot be re-derived (no gh, SHA absent) is a warning and never
counts as verified. `--claim-full` additionally requires every shipped card
to have at least one re-derived fact and names each card that has none; a
journal written before this card names its cards that way. Narration fields
feed no check. Reading of "every journal entry for a shipped card": the merge
result of each shipped card carries the facts; other events of that card are
commentary on them. Target +140 src lines.

**W3, T1-STORE-CAS.** One primitive in `src/state/store.ts`:
`updateJson(file, schema, change, opts?)`. It takes `<file>.lock` by
exclusive create (O_EXCL, the run lock that already exists, generalised),
hands `change` the stored record, writes the result atomically, and writes
nothing when `change` returns the record unchanged or throws; errors stay
`StoreError` `LOCKED` or `LOCK_LOST`. `saveCardRun` remains the
expected-revision compare-and-set on top of it. The lease store, the card-run
store and the takeover's ledger check all go through it; `goal-store.ts`
loses its own lock code (about 110 lines), the takeover loses its double read
and late-operation check, and `mergeFindings` (dead under the revision check)
is deleted. Windows closed: the lease write (all lease writes under the lease
lock); the run write for fenced writers (the takeover updates the run under
the run lock, so no stop is lost); the journal for two completions (dedupe
and `LEASE_ACQUIRED` under the lease lock); the ledger for card operations
(ship fence, duplicate check and intent under the lease lock). Left as they
are and stated in the first candidate: `recordAttempt` and a raw
`card report` patch stay unfenced; goal, release and review-pool records stay
last-writer-wins; a crash between the lease write and the run update is
completed by running the takeover again. Lock order: run, then lease; no run
lock inside a lease section. Estimated src net: -45.

`git update-ref --stdin` was the preferred primitive and is rejected: each
write needs `hash-object -w` plus `update-ref` (two spawns, about 100-200 ms
on Windows), `.aidlc/` would become a blob cache, `AIDLC_STATE_DIR`, non-git
checkouts and every test fixture would need a file fallback (two
implementations, net-positive by construction), and a crash leaves
`refs/aidlc/*.lock` that git never removes. SQLite is rejected too:
`node:sqlite` is experimental and porting every store deletes less than it
adds.

**W4, T1-BOUND-TELEMETRY.** `JournalEventType` gains `BOUND_FIRED` with a
zod payload `{ bound }`, written at each firing point: card deadline
(`card-machine.ts:97-103` and the two `stopWith` paths in `card-runner.ts`
that journal nothing today), arc deadline, reconciliation grace, review
decisions, no-verdict retry, CI rerun (allowed or denied), attempts (the STOP
at `card-runner.ts:803-806` journals nothing today), planning invocations,
integration repair. The board renders one line over every goal journal:
`Bounds: <bound> <fired> (DONE n, STOP/<reason> n, open n); ...`, the outcome
being the goal's terminal event after the firing. The worker cap is a cap,
not a firing, and is not counted. `MAX_LIFECYCLE_REPAIR_CYCLES` is defined
and never enforced; the Limits table says so (finding F2). No new config, no
new file. Target +50 src lines.

**W5, T1-RUN-DRIVER** (projected in wave 4, after REPORT.md exists).
(a) `aidlc run --goal <id> [--max-steps n]`: loops `next`, hands the directive
and its context pack to the configured provider, and loops again after the
provider's `aidlc report`; it stops and prints the directive on `checkpoint`,
`stop`, `ask`, `release`, `done`, a review block and a `wait` on review quota.
It writes no file of its own. (b) `aidlc board --watch [--interval s]`: one
screen with goal state, card states, live leases with owner and generation,
the W4 bound line and the next directive, re-rendered from `state/board.ts`.
(c) `contextPack(card)`: a deterministic projection of the card's plan
section, acceptance list, allow_paths, non_goals and the LESSONS lines that
name its paths or modules, capped at a declared token budget, carried on the
`run-card` directive and handed to the worker. Tokens per card are measured
on the W0 task set against the W0 arm B baseline. Budget: +400 minus the
actual W2 and W4 totals (target +210). If the three parts do not fit, the
card stops and asks which part to drop.

**W6, T1-INIT-SURFACE.** `aidlc init --no-hooks` writes everything except the
hook entries of `.claude/settings.json` (the deny list is still merged). A
README section lists every path init writes (a test compares it with the
paths `src/scaffold/init.ts` writes) and one line per guard: event, what it
reads, when it blocks. A test hands each guard instruction-shaped repository
content (a path, a goal id, a plan file line) and asserts it reaches
`additionalContext` or stderr only JSON-quoted. The survey found the hooks
already quote; the exposure is in directive narration (finding F3), which is
out of W6 scope. Target +15 src lines (outside the +400 budget).

**W7, T1-README-SCOPE.** The README first paragraph says aidlc is not an
implementation of the AWS AI-DLC methodology and is a bounded-autonomy
control plane for coding agents, driver-agnostic. Docs only; a test reads the
exact sentence.

## 5. Data model and state machine
- `JournalEventType` gains `BOUND_FIRED` (W4); its payload and the W2
  `ShippedFacts` payload get zod schemas in `src/core/types.ts`. Additive:
  existing journals still parse.
- W3 adds `<record>.json.lock` files beside lease records under
  `.aidlc/leases/` (the run lock already exists). No new store.
- No goal, card or release state machine changes.

## 6. Contracts and core interfaces
- `updateJson<T>(file, schema, change: (current: T | undefined) => T | undefined, opts?)` (W3).
- `detectQuotaHold(text, status?, retryAfter?): QuotaSignal` and `nulList(stdout)` (W1).
- `verifyAudit(input, probes?: { git, gh })` (W2); `aidlc audit verify` passes real probes.
- CLI: `aidlc run` (W5), `aidlc board --watch` (W5), `aidlc init --no-hooks` (W6).

## Line budgets
Measured as `git diff --numstat origin/main...HEAD -- src` (added minus
deleted), tests excluded, stated in every card's close-out.

| Card | Work item | src net | Gate |
|---|---|---|---|
| T1-BASELINE-HARNESS | W0 | 0 | no src/ change |
| T1-PARSE-GUARD | W1 | below 0 (estimate -3 to -7) | STOP/scope at 0 or above |
| T1-STORE-CAS | W3 | below 0 (estimate -45) | STOP/scope at 0 or above |
| T1-AUDIT-FACTS | W2 | at most +140 | shared +400 |
| T1-BOUND-TELEMETRY | W4 | at most +50 | shared +400 |
| T1-INIT-SURFACE | W6 | at most +15 | own |
| T1-README-SCOPE | W7 | 0 | no src/ change |
| T1-BASELINE-REPORT | W0 | 0 | no src/ change |
| T1-RUN-DRIVER | W5 | +400 minus W2 and W4 actual | shared +400 |

The card `budget:` field is the churn cap (added plus deleted, all files),
a different measure; each card sets both.

## Files that change
- evals/baseline/README.md (new)
- evals/baseline/tasks.json (new)
- evals/baseline/harness.ts (new)
- evals/baseline/analyze.ts (new)
- evals/baseline/REPORT.md (new)
- tsconfig.test.json
- src/core/parse-guard.ts (new)
- src/core/review-policy.ts
- src/review/pre-review.ts
- src/providers/claude-api.ts
- src/providers/claude-code.ts
- src/probes/git.ts
- src/delivery/github-ship.ts
- src/delivery/ops.ts
- src/loop/card-runner.ts
- src/config.ts
- src/cli/main.ts
- src/index.ts
- src/state/store.ts
- src/state/goal-store.ts
- src/coordination/lease.ts
- src/coordination/reconcile.ts
- src/state/journal.ts
- src/core/types.ts
- src/audit/verifier.ts
- src/probes/gh.ts
- src/state/board.ts
- src/loop/controller.ts
- src/core/card-machine.ts
- src/scaffold/init.ts
- tests/surface/baseline.test.ts (new)
- tests/core/parse-guard.test.ts (new)
- tests/surface/readme.test.ts (new)
- tests/core/review-policy.test.ts
- tests/surface/config.test.ts
- tests/surface/pre-review.test.ts
- tests/surface/providers.test.ts
- tests/surface/prose.test.ts
- tests/infra/store.test.ts
- tests/infra/goal-store.test.ts
- tests/infra/lease.test.ts
- tests/infra/journal.test.ts
- tests/infra/board.test.ts
- tests/infra/init.test.ts
- tests/surface/verifier.test.ts
- tests/surface/hooks.test.ts
- tests/scenarios/t0-flow.test.ts
- tests/scenarios/r3-fallback.test.ts
- tests/scenarios/two-windows.test.ts
- tests/scenarios/audit.test.ts
- docs/OPERATIONS.md
- docs/ARCHITECTURE.md
- README.md
- CHANGELOG.md

## Order of work
1. Merge this plan's PR (cards registered on main, not started).
2. Wave 1 goal: T1-BASELINE-HARNESS, including a one-task pilot per arm.
3. Start the W0 runs at the harness merge SHA, inside the D3 cap, in the D2 sandbox.
4. Wave 1 goal: T1-PARSE-GUARD (W1, net-negative gate).
5. Wave 1 goal: T1-STORE-CAS (W3, net-negative gate); VERIFY_ARC closes wave 1.
6. Wave 2 goal: T1-AUDIT-FACTS (W2); report the running +400 total.
7. Wave 2 goal: T1-BOUND-TELEMETRY (W4); VERIFY_ARC closes wave 2.
8. Wave 3 goal: T1-INIT-SURFACE (W6), then T1-README-SCOPE (W7).
9. Wave 4 goal, once the runs are done: T1-BASELINE-REPORT (REPORT.md).
10. Wave 4 goal: T1-RUN-DRIVER (W5), measured against REPORT.md; VERIFY_ARC closes wave 4.

## 7. Task split (dependencies and parallel windows)

| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-BASELINE-HARNESS | MUST | W0 harness, task list, analysis, one-task pilot per arm | - | W1 | - |
| T1-PARSE-GUARD | MUST | one parse guard, non-blank config, doctor config error, #39 #41 #45 #52 | T1-BASELINE-HARNESS | W2 | - |
| T1-STORE-CAS | MUST | one locked update primitive for lease and run records, Sessions text shorter | T1-PARSE-GUARD | W3 | - |
| T1-AUDIT-FACTS | MUST | merge facts journaled and re-derived by audit verify | T1-STORE-CAS | W4 | - |
| T1-BOUND-TELEMETRY | SHOULD | BOUND_FIRED per bound and one board line | T1-AUDIT-FACTS | W5 | - |
| T1-INIT-SURFACE | SHOULD | init --no-hooks, README init section, hook data test | T1-BOUND-TELEMETRY | W6 | - |
| T1-README-SCOPE | SHOULD | README first paragraph names what aidlc is and is not | T1-INIT-SURFACE | W7 | - |
| T1-BASELINE-REPORT | MUST | REPORT.md with paired differences and the MDE | T1-BASELINE-HARNESS | W8 | - |
| T1-RUN-DRIVER | SHOULD | aidlc run, board --watch, per-card context pack | T1-BASELINE-REPORT, T1-BOUND-TELEMETRY | W9 | - |

The depends_on chain orders the shared files (CHANGELOG.md,
docs/OPERATIONS.md, README.md); only T1-BASELINE-REPORT and T1-RUN-DRIVER
carry a real prerequisite (the report, and the bound line W5 shows).

## Card close-out record
Every card ends with, in its CLOSE evidence (`aidlc evidence retain`) and in
the session report: the DoD command and its exit code with the pass count;
the src net line delta; for W2, W4 and W5 the running total against +400;
and the facts a reader can re-derive: merge commit SHA, its tree hash, PR
number and the check-run ids of the head, each with the git or gh command
that re-derives it. From T1-AUDIT-FACTS on, `aidlc audit verify` does that
re-derivation itself.

## Findings (the loop on its own repository)
Found by the surveys before any card ran; each is either fixed by a card or
filed as an issue by the card named.
- F1: `aidlc doctor` has no config check; an invalid config crashes it with a
  ZodError stack trace (`main.ts:170`). Fixed by T1-PARSE-GUARD.
- F2: `MAX_LIFECYCLE_REPAIR_CYCLES` is never read and its counter never
  incremented, while the README Limits table lists the bound. Stated by
  T1-BOUND-TELEMETRY.
- F3: directive narration carries intent open questions and ship output
  verbatim (`controller.ts:633,637`, `card-runner.ts:2248,2330`), so
  repository text reaches the agent unquoted outside the hooks. Issue filed by
  T1-INIT-SURFACE.
- F4: seven journal event types are declared and never written
  (`CARD_AMENDED`, `LEASE_RELEASED`, `LEASE_FENCED`, `AUDIT_VERIFIED`,
  `INCIDENT_DETECTED`, `MODEL_INVOCATION`, `HOOK_DECISION`); the verifier
  checks `MODEL_INVOCATION` events that never exist. Issue filed by
  T1-AUDIT-FACTS.
- F5: text-derived control decisions outside W1's class that fail open: a
  bad `aidlc.config.json` makes the hooks fall back to an empty
  `frozenPaths` (`hooks/index.ts:85-94`); CI log classes grant a rerun
  (`ci-policy.ts`); exit 0 without `[SAGA-FAIL]` reads as merged
  (`ship.ts:96`). Issue filed by T1-PARSE-GUARD.
- F6: the ship path enforces the card `budget:` only on the scaffold path
  (`[CARD-BUDGET-OVER]`); the github path has no churn gate, so the src net
  gates above are checked by each card's acceptance, not by the ship.

New findings from running the waves are appended here by the card that meets
them, never worked around.

## Decisions for the approver
- D1 (W0 task repository). Recommended: `Asun28/MyInspection`, whose merged
  cards carry real tests to hold out, so the loop is measured on a repository
  other than itself. Alternative: this repository's merged cards #21-#59,
  with its own `.claude/` stripped from arm A.
- D2 (arm B PRs). Recommended: a new private sandbox repository
  (`Asun28/aidlc-baseline`), seeded with each task's base commit as a branch,
  so 36 arm B runs open no PR on a real repository. Creating it is an
  outward action and waits for this approval.
- D3 (W0 spend). The baseline is 72 agent runs, arm B adding R2 and R3 per
  run, and W5 measures its context pack with 12 more arm B runs (one per
  task). Recommended: a per-run token cap and a total cap you set; the
  harness stops a run at its cap and records the cap as the bound that fired.
  The runs do not start until the caps are recorded in
  `evals/baseline/README.md`.
- D4 (W3 primitive). Recommended as designed: the O_EXCL locked update, not
  `git update-ref`, for the reasons in 4.5. Approving the plan accepts it.
- D5 (W5 overlap). `T0-UNATTENDED-RUNS` (registered on main, not started,
  another session's card) documents `/goal` as the outer driver of `aidlc next`. Recommended:
  that card runs first; `aidlc run` stops on the same directive kinds and
  covers drivers other than Claude Code.

## Risks
- W1 margin is a few lines; the 53 `git diff --name-only` stubs in
  t0-flow.test.ts must move to NUL output, and a config with a blank value
  that parsed before is now refused by every command.
- W3 adds failure modes: claim and renewal can throw LOCKED; a crashed lock
  holder blocks one card's lease for up to 30 s; Windows can report EPERM for
  a lock being deleted (treated as busy). Lessons 2026-09-14 T1-LOOP-LESSONS
  and 2026-09-15 T0-CARD-TAKEOVER-2 apply: no new lock over a lease-owned
  file, and every remaining window is stated in the first candidate.
- W2 re-derivation needs gh and network at verify time; offline it reports
  warnings, and `--claim-full` then refuses.
- W0 runs share the DeepSeek and Opus quotas with waves 1-3; a quota hold is
  a WAIT and spends no allowance, but it slows both.
- W0 can show aidlc losing on tokens or wall clock; the report says so.
- Every card edits CHANGELOG.md; they run strictly one at a time.

## Proof
- T1-BASELINE-HARNESS: tests/surface/baseline.test.ts on fixture results; the pilot result JSON.
- T1-PARSE-GUARD: tests/core/parse-guard.test.ts, config, pre-review, providers and t0-flow tests; doctor exit 1 on a blank marker.
- T1-STORE-CAS: store, goal-store, lease and two-windows tests; Sessions bytes before and after.
- T1-AUDIT-FACTS: tests/surface/verifier.test.ts and tests/scenarios/audit.test.ts with scripted git and gh.
- T1-BOUND-TELEMETRY: tests/infra/board.test.ts and a deadline scenario.
- T1-INIT-SURFACE, T1-README-SCOPE: tests/infra/init.test.ts, tests/surface/readme.test.ts, tests/surface/hooks.test.ts.
- T1-BASELINE-REPORT: analyze.ts regenerates REPORT.md from the committed results unchanged.
- T1-RUN-DRIVER: scenario tests for the driver's stop kinds; tokens per card against REPORT.md.
- Every card: `npm run check` exit 0 with the pass count, and the close-out record.

## 10. After merge
none this version (development-only target)
