---
id: T0-OPS-CWD
title: An operation command and its status lookup run in the same directory, the binding's cwd resolved against the main checkout, by one rule stated in the docs, and a binding directory that does not exist stops the release before any operation is recorded
status: todo
branch: T0-OPS-CWD
worktree: D:\wt\AIDLC\T0-OPS-CWD
size_exception: "approved by the coordinator as planner and approver of the 18 audit changes under the owner's (asun28) instruction of 2026-11-11: about 40 source lines in src/delivery/ops.ts, src/loop/release-runner.ts and src/cli/main.ts; the rest is the path-form table for both platforms, the schema refusal rows, the same-directory rows, the runner and CLI scenarios (missing directory, linked worktree), the call-shape updates of two test files, docs and about 25 lines of attempt evidence"
allow_paths:
  - src/delivery/ops.ts
  - src/loop/release-runner.ts
  - src/cli/main.ts
  - tests/infra/ops.test.ts
  - tests/infra/exec-sync-tree.test.ts
  - tests/scenarios/ops-cwd.test.ts
  - docs/OPERATIONS.md
  - docs/DELIVERY-OPS.md
  - CHANGELOG.md
  - specs/tasks/T0-OPS-CWD.md
dod_command: npm run typecheck && node --test tests/infra/ops.test.ts tests/infra/exec-sync-tree.test.ts tests/scenarios/ops-cwd.test.ts tests/scenarios/release.test.ts tests/scenarios/release-reissue.test.ts tests/infra/reconcile.test.ts
dod_exit: 0
requirements:
  - R1. `operationCwd(binding, root)` (new, src/delivery/ops.ts) shall return the directory an operation command and its status lookup run in, resolved with the host platform's `path.resolve`, by one rule with these input classes. No `cwd` gives `root`, the main checkout. Otherwise the result is `path.resolve(root, cwd)` with the value as written (no trimming, no `~` expansion), which gives: a relative value (`ops`, `ops/sub`, `.`, `..`, a name with spaces, a name with a tab or a line break inside it) a directory under or beside `root`; `ops\sub` the directory `ops/sub` on Windows and a single name containing a backslash on POSIX; a fully qualified value (POSIX `/srv/ops`; Windows `C:\ops`, `c:\ops`, `C:/ops`, `\\server\share\ops`, `\\?\C:\ops`) that path as `path.resolve` returns it; on POSIX a Windows form (`C:\ops`, `\\server\share\ops`) a relative name under `root`; on Windows a root-relative value (`\ops`, `/ops`) that path on the drive of `root`, the result T0-CLI-CWD-FILE-ARGS gives a CLI path; whitespace around a non-blank value is part of the name.
  - R2. The `OperationBinding` schema shall refuse, with an issue at `operations.<i>.cwd` when `aidlc.ops.json` loads, a `cwd` that is not a string (null, a number, an object), a blank string (empty, or only characters of the JavaScript `\s` class), and a drive-relative string (a drive letter in either case and a colon not followed by a slash or a backslash: `C:ops`, `c:ops`, `C:`), on every platform. T0-CLI-CWD-FILE-ARGS reads `C:x` on POSIX as a relative name because a CLI argument is typed on the host that reads it; `aidlc.ops.json` is committed and read on every platform, so a value whose meaning differs by platform is refused, and on Windows `path.resolve` would read the drive-relative form against the process's current directory on that drive.
  - R3. `executeOperation` and `lookupOperation` (both exported through src/index.ts:39) shall each take the main checkout root as a required argument (`executeOperation(binding, target, { root, runner?, idempotencyKey? })` in place of the optional `cwd`, `lookupOperation(binding, providerOperationId, root, runner?)`) and pass `operationCwd(binding, root)` as the `cwd` of their runner call, so the `cwd` of a binding is no longer ignored by the command (main passes the main checkout over it, ops.ts:137) or read against the process directory by the lookup (main passes it raw, ops.ts:151).
  - R4. Every caller shall pass the main checkout root: `ReleaseRunner.issue` (src/loop/release-runner.ts:315 at 6c1a6cfd, reached by `aidlc release next` and every release command that runs a deploy or recover step), the reconcile loop of `ReleaseRunner.next` (:129-136) and `aidlc goal reconcile <id>` (src/cli/main.ts:368-387, `c.repo.mainRoot`), whatever the process directory, a linked worktree included.
  - R5. WHEN `ReleaseRunner.issue` finds that `operationCwd(binding, root)` is not an existing directory (absent, or a file), it shall save and return a STOP with reason `release-config` (detail naming the role and the resolved directory, next action `create the directory or correct cwd in aidlc.ops.json`, disposition `failed`, as the NOT CONFIGURED stop at :305 does), after that stop and the publication check and before the step's records are read or its intent recorded, so no operation is recorded for a command that cannot start. A status lookup whose directory does not exist fails its spawn and reads as UNKNOWN (ops.ts:152), as any failed lookup does.
  - R6. `docs/OPERATIONS.md` (Provider operation bindings, the Rules paragraph) and `docs/DELIVERY-OPS.md` (Per-operation record, :25-34) shall state the rule of R1, the refusals of R2, the stop of R5 and that the command and its status lookup run in the same directory, and `CHANGELOG.md` Unreleased states the same and the two signature changes of R3.
acceptance:
  - 1. `tests/infra/ops.test.ts` "operationCwd: one directory for every form of cwd": with a root built by `path.resolve`, every value R1 lists gives `path.resolve(root, value)`, with these spelled out: no `cwd` gives `root`; on Windows `\ops` and `/ops` give `<drive of root>\ops`, `\\?\C:\ops` gives itself and `ops\sub` gives `<root>\ops\sub`; on POSIX `C:\ops` gives `<root>/C:\ops` and `/srv/ops` gives itself; ` ops ` keeps its spaces; `~/ops` gives `<root>/~/ops`. The rows of the other platform are skipped by `process.platform`, and CI runs the file on both (ubuntu and windows). [R1] [dod arm 1]
  - 2. Same file, "a cwd that is not a usable string is refused when the ops file loads": `loadDeliveryOps` on files whose binding has `cwd` null, 3, `{}`, `""`, `"  "`, a tab, `"C:ops"`, `"c:ops"` and `"C:"` returns `unreadable` with an error naming `cwd`; `"C:\\ops"`, `"c:/ops"`, `"ops"`, `"ops dir"` and `"/srv/ops"` load. Fails on main for the string rows. [R2] [dod arm 1]
  - 3. Same file, "the command and the status lookup of one binding run in one directory": a runner that records `cwd`; for a binding without `cwd` and one with `cwd` `ops`, `executeOperation` and `lookupOperation` with the same root record the same directory, `root` and `path.resolve(root, 'ops')`. Fails on main (the lookup records undefined, then `ops`). [R3] [dod arm 1]
  - 4. `tests/scenarios/ops-cwd.test.ts` "the release runner and goal reconcile use the binding directory": a release attempt whose async deploy binding has `cwd` `ops` (an existing directory) issues the deploy and, on the next `ReleaseRunner.next`, looks its status up; both runner calls record `<main checkout>/ops`. `aidlc goal reconcile <goal>` run from a subdirectory of the main checkout and from a linked worktree of it, with a bound status lookup that writes its working directory to a file, writes it in `<main checkout>/ops` both times. Fails on main. [R3] [R4] [dod arm 1]
  - 5. Same file, "a binding directory that does not exist stops the release before any operation": with `cwd` `missing` (absent) and with `cwd` naming a file, `aidlc release next` reaching the deploy step saves STOP `release-config` naming the role and the resolved directory, the operation ledger holds no record for the attempt, the journal has no `OPERATION_INTENT`, and the runner ran no command. Fails on main (the command runs in the main checkout and an operation is recorded). [R5] [dod arm 1]
  - 6. Regression controls: `tests/infra/exec-sync-tree.test.ts` acceptance 4 (killTree and timeoutMs of both functions) passes with the root added to its calls and its assertions unchanged; the other tests of `tests/infra/ops.test.ts` pass with only the root added to their calls; `tests/scenarios/release.test.ts`, `tests/scenarios/release-reissue.test.ts` and `tests/infra/reconcile.test.ts` pass unchanged. [R3] [R4] [dod arm 1]
  - 7. The two documents and the CHANGELOG state R6 (reviewer-verified against the diff). [R6]
depends_on: [T0-RELEASE-OP-REISSUE]
budget: 320
tdd: true
diagnosis:
  root_cause: "`executeOperation` runs its command in `options.cwd ?? binding.cwd` (src/delivery/ops.ts:137 at 6c1a6cfd, unchanged since 92796d4f) and its one production caller passes the main checkout (release-runner.ts:315), so the command always runs in the main checkout and a binding's `cwd` is never used; `lookupOperation` runs the status lookup in `binding.cwd` as written (ops.ts:151), so a relative `cwd` is read against the process directory and an absent one means the process directory. The two directories differ whenever a binding sets `cwd` or a command is run from a subdirectory or a worktree."
  repro: "Both reviews of 2026-11-11 reproduced C11 on 92796d4f; acceptance 3 and 4 fail there with a runner that records cwd."
  same_class: "Every other runner call of src/delivery/ops.ts is one of these two. `ScaffoldShipPath.phase` runs in the main checkout and has no configured cwd; the eval runner already resolves its `cwd` against its work directory (src/evals/runner.ts:232). T0-CLI-CWD-FILE-ARGS resolves CLI path arguments; its POSIX reading of `C:x` differs from R2 for the reason R2 states."
sweep: "git grep -n 'executeOperation\|lookupOperation\|binding.cwd\|\.cwd' -- src/delivery/ops.ts src/loop/release-runner.ts src/cli/main.ts, and git grep -n 'executeOperation\|lookupOperation\|statusLookup\|\"cwd\"' -- tests docs templates aidlc.ops.example.json at 6c1a6cfd. Callers: release-runner.ts:133 (reconcile, changed), :315 (issue, changed and gains the check of R5), main.ts:379 (goal reconcile, changed). src/index.ts:39 exports both functions (signature change in the CHANGELOG). The documented example bindings (docs/OPERATIONS.md:218-239, aidlc.ops.example.json) set no `cwd` and use commands relative to the repository root (`./scripts/deploy.sh`), so the main checkout is the directory each documented binding is meant to run in; docs/DELIVERY-OPS.md:25-34 lists what a binding states without `cwd`; no template sets `cwd`. Tests that pin the current call shape: tests/infra/exec-sync-tree.test.ts:38-50 (both functions, without a root), tests/infra/ops.test.ts (14 calls without a cwd), tests/scenarios/_harness.ts:190-197 (`opsConfigured`, no cwd, unchanged). No test asserts the cwd of either call."
forbid:
  - weakening or skipping a test to go green
  - a change to which process runs the command, its timeout, its environment or its arguments
  - a change to the documented example bindings beyond the rule sentences
  - a new `mkdtempSync` call in a test; create a temporary directory with `tmpDir` of tests/infra/helpers.ts and remove it with `cleanup` in an `after` hook, or use `makeFixture`
  - editing .aidlc state by hand
non_goals:
  - a limit on `cwd` leaving the main checkout (`..`, an absolute path); the binding file is the operator's configuration
  - a directory check before a status lookup; a failed lookup is UNKNOWN as on main
  - the provider operation timeouts and status interpretation
hygiene: "Line numbers are from main at 6c1a6cfd; read them again at PREPARE, after T0-RELEASE-OP-REISSUE has merged (it moves the intent of `issue` into a lease section; R5 goes before that section). This card edits the `executeOperation` call of `ReleaseRunner.issue`, which T0-RELEASE-OP-REISSUE and T0-OP-TIMESTAMP-NOW also edit: the coordinator runs this card after T0-RELEASE-OP-REISSUE and before T0-OP-TIMESTAMP-NOW starts. T0-AUDIT-FIXES changed the pattern fields of this schema; keep its tests as they are. Insert the CHANGELOG entry directly above the entry that begins `- T1-R3-SECOND-PASS:`, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict."
doc_sync: docs/OPERATIONS.md (Provider operation bindings), docs/DELIVERY-OPS.md (Per-operation record), CHANGELOG.md
---

# T0-OPS-CWD

## Deliverable
A provider operation and the status lookup that reconciles it run in the same directory: the main checkout, or the binding's `cwd` resolved against it. A binding directory that does not exist stops the release before any operation is recorded. docs/OPERATIONS.md and docs/DELIVERY-OPS.md state the rule.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/ops.test.ts tests/infra/exec-sync-tree.test.ts tests/scenarios/ops-cwd.test.ts tests/scenarios/release.test.ts tests/scenarios/release-reissue.test.ts tests/infra/reconcile.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.
