---
id: T0-OPS-CWD
title: An operation command and its status lookup run in the same directory, the binding's cwd resolved against the main checkout, by one rule stated in the docs, and a binding directory that does not exist stops the release before any operation is recorded
status: todo
branch: T0-OPS-CWD
worktree: D:\wt\AIDLC\T0-OPS-CWD
size_exception: "approved by the coordinator as planner and approver of the 18 audit changes under the owner's (asun28) instruction of 2026-11-11: about 40 source lines in src/delivery/ops.ts, src/loop/release-runner.ts and src/cli/main.ts; the rest is the path-form table for both platforms, the schema refusal rows, the same-directory rows, the runner and CLI scenarios (missing directory, linked worktree), the call-shape updates of two test files, docs and about 25 lines of attempt evidence; raised from 320 to 460 by the coordinator on the candidate 042d8cb7, which is 394 changed lines (56 of source, the rest tests, docs and attempt evidence), plus the template copy of the DELIVERY-OPS.md paragraph and its test"
allow_paths:
  - src/delivery/ops.ts
  - src/loop/release-runner.ts
  - src/cli/main.ts
  - tests/infra/ops.test.ts
  - tests/infra/exec-sync-tree.test.ts
  - tests/scenarios/ops-cwd.test.ts
  - docs/OPERATIONS.md
  - docs/DELIVERY-OPS.md
  - templates/docs/DELIVERY-OPS.md
  - CHANGELOG.md
  - specs/tasks/T0-OPS-CWD.md
dod_command: npm run typecheck && node --test tests/infra/ops.test.ts tests/infra/exec-sync-tree.test.ts tests/scenarios/ops-cwd.test.ts tests/scenarios/release.test.ts tests/scenarios/release-reissue.test.ts tests/infra/reconcile.test.ts
dod_exit: 0
requirements:
  - R1. `operationCwd(binding, root)` (new, src/delivery/ops.ts) shall return the directory an operation command and its status lookup run in, resolved with the host platform's `path.resolve`, by one rule with these input classes. No `cwd` gives `root`, the main checkout. Otherwise the result is `path.resolve(root, cwd)` with the value as written (no trimming, no `~` expansion), which gives: a relative value (`ops`, `ops/sub`, `.`, `..`, a name with spaces, a name with a tab or a line break inside it) a directory under or beside `root`; `ops\sub` the directory `ops/sub` on Windows and a single name containing a backslash on POSIX; a fully qualified value (POSIX `/srv/ops`; Windows `C:\ops`, `c:\ops`, `C:/ops`, `\\server\share\ops`, `\\?\C:\ops`) that path as `path.resolve` returns it; on POSIX a Windows form (`C:\ops`, `\\server\share\ops`) a relative name under `root`; on Windows a root-relative value (`\ops`, `/ops`) that path on the drive of `root`, the result T0-CLI-CWD-FILE-ARGS gives a CLI path; whitespace around a non-blank value is part of the name.
  - R2. The `OperationBinding` schema shall refuse, with an issue at `operations.<i>.cwd` when `aidlc.ops.json` loads, a `cwd` that is not a string (null, a number, an object), a blank string (empty, or only characters of the JavaScript `\s` class), and a drive-relative string (a drive letter in either case and a colon not followed by a slash or a backslash: `C:ops`, `c:ops`, `C:`), on every platform. T0-CLI-CWD-FILE-ARGS reads `C:x` on POSIX as a relative name because a CLI argument is typed on the host that reads it; `aidlc.ops.json` is committed and read on every platform, so a value whose meaning differs by platform is refused, and on Windows `path.resolve` would read the drive-relative form against the process's current directory on that drive. A string that holds a NUL character (U+0000) is refused too, on every platform: no file system accepts it and the spawn of a command or a status lookup with such a directory throws where a missing directory reads as a failed spawn. (Added by the planner on 2026-11-11 after a pre-review of 6a95726b.)
  - R3. `executeOperation` and `lookupOperation` (both exported through src/index.ts:39) shall each take the main checkout root as a required argument (`executeOperation(binding, target, { root, runner?, idempotencyKey? })` in place of the optional `cwd`, `lookupOperation(binding, providerOperationId, root, runner?)`) and pass `operationCwd(binding, root)` as the `cwd` of their runner call, so the `cwd` of a binding is no longer ignored by the command (main passes the main checkout over it, ops.ts:137) or read against the process directory by the lookup (main passes it raw, ops.ts:151).
  - R4. Every caller shall pass the main checkout root: `ReleaseRunner.issue` (src/loop/release-runner.ts:315 at 6c1a6cfd, reached by `aidlc release next` and every release command that runs a deploy or recover step), the reconcile loop of `ReleaseRunner.next` (:129-136) and `aidlc goal reconcile <id>` (src/cli/main.ts:368-387, `c.repo.mainRoot`), whatever the process directory, a linked worktree included.
  - R5. WHEN `ReleaseRunner.issue` would record an intent (the step has no ledger record, the role is bound and the publication check passes) and `operationCwd(binding, root)` is not an existing directory (absent, a file, or a path under a file, which POSIX reports as ENOTDIR; the check answers no for each and never throws), it shall record no intent and shall save and return a STOP with reason `release-config` (detail naming the role and the resolved directory, next action `create the directory or correct cwd in aidlc.ops.json`, disposition `failed`, as the NOT CONFIGURED stop does), so no operation is recorded for a command that cannot start. The order of `issue` on main since T0-RELEASE-OP-REISSUE is kept: the directory is checked before the lease section; inside the section the intent is recorded only when the directory exists (one more condition beside the three of main); after the section the returns of main keep their order (a step with ledger records goes to `settleStep` whatever the directory, then the NOT CONFIGURED stop, then the publication stop), and the new stop follows the publication stop, before the `OPERATION_INTENT` append. A status lookup whose directory does not exist fails its spawn and reads as UNKNOWN (ops.ts:152), as any failed lookup does. (The first text placed the stop "before the step's records are read"; `issue` after T0-RELEASE-OP-REISSUE reads the records and records the intent in one section ahead of its stops, so that order needs its returns moved. The implementer reported it and the planner restated the requirement on 2026-11-11.)
  - R6. `docs/OPERATIONS.md` (Provider operation bindings, the Rules paragraph) and `docs/DELIVERY-OPS.md` (Per-operation record, :25-34) shall state the rule of R1, the refusals of R2, the stop of R5 and that the command and its status lookup run in the same directory, and `CHANGELOG.md` Unreleased states the same and the two signature changes of R3. `templates/docs/DELIVERY-OPS.md`, the copy `aidlc init` installs, is identical to `docs/DELIVERY-OPS.md` on main and shall stay identical to it (the same text, line endings aside), so a repository initialised after this card reads the same rule. (Added by the planner on 2026-11-11: the implementer reported that the first allow_paths left the template copy behind.)
acceptance:
  - 1. `tests/infra/ops.test.ts` "operationCwd: one directory for every form of cwd": with a root built by `path.resolve`, every value R1 lists gives `path.resolve(root, value)`, with these spelled out: no `cwd` gives `root`; on Windows `\ops` and `/ops` give `<drive of root>\ops`, `\\?\C:\ops` gives itself and `ops\sub` gives `<root>\ops\sub`; on POSIX `C:\ops` gives `<root>/C:\ops` and `/srv/ops` gives itself; ` ops ` keeps its spaces; `~/ops` gives `<root>/~/ops`. The rows of the other platform are skipped by `process.platform`, and CI runs the file on both (ubuntu and windows). [R1] [dod arm 1]
  - 2. Same file, "a cwd that is not a usable string is refused when the ops file loads": `loadDeliveryOps` on files whose binding has `cwd` null, 3, `{}`, `""`, `"  "`, a tab, `"C:ops"`, `"c:ops"` and `"C:"` returns `unreadable` with an error naming `cwd`, and so does a `cwd` holding a NUL character (`"ops\u0000x"`); `"C:\\ops"`, `"c:/ops"`, `"ops"`, `"ops dir"` and `"/srv/ops"` load. Fails on main for the string rows. [R2] [dod arm 1]
  - 3. Same file, "the command and the status lookup of one binding run in one directory": a runner that records `cwd`; for a binding without `cwd` and one with `cwd` `ops`, `executeOperation` and `lookupOperation` with the same root record the same directory, `root` and `path.resolve(root, 'ops')`. Fails on main (the lookup records undefined, then `ops`). [R3] [dod arm 1]
  - 4. `tests/scenarios/ops-cwd.test.ts` "the release runner and goal reconcile use the binding directory": a release attempt whose async deploy binding has `cwd` `ops` (an existing directory) issues the deploy and, on the next `ReleaseRunner.next`, looks its status up; both runner calls record `<main checkout>/ops`. `aidlc goal reconcile <goal>` run from a subdirectory of the main checkout and from a linked worktree of it, with a bound status lookup that writes its working directory to a file, writes it in `<main checkout>/ops` both times. Fails on main. [R3] [R4] [dod arm 1]
  - 5. Same file, "a binding directory that does not exist stops the release before any operation": with `cwd` `missing` (absent) and with `cwd` naming a file, `aidlc release next` reaching the deploy step saves STOP `release-config` naming the role and the resolved directory, the operation ledger holds no record for the attempt, the journal has no `OPERATION_INTENT`, and the runner ran no command. Fails on main (the command runs in the main checkout and an operation is recorded). Order rows, each with the directory missing: a step that already has a `succeeded` ledger record of the attempt is settled as on main with no stop; an unbound role gives the NOT CONFIGURED stop; a binding that triggers publication without production authority gives the `release-auth` stop. [R5] [dod arm 1]
  - 6. Regression controls: `tests/infra/exec-sync-tree.test.ts` acceptance 4 (killTree and timeoutMs of both functions) passes with the root added to its calls and its assertions unchanged; the other tests of `tests/infra/ops.test.ts` pass with only the root added to their calls; `tests/scenarios/release.test.ts`, `tests/scenarios/release-reissue.test.ts` and `tests/infra/reconcile.test.ts` pass unchanged. [R3] [R4] [dod arm 1]
  - 7. The two documents and the CHANGELOG state R6 (reviewer-verified against the diff). [R6] `tests/infra/ops.test.ts` "the template copy of DELIVERY-OPS.md is the repository's": the two files are equal with line endings normalised and both hold the `cwd` rule. [R6] [dod arm 1]
depends_on: [T0-RELEASE-OP-REISSUE]
budget: 460
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
  - a binding directory removed between the check of R5 and the command; the command then meets what any command with a missing directory meets on main
  - the provider operation timeouts and status interpretation
hygiene: "Line numbers are from main at 6c1a6cfd; read them again at PREPARE, after T0-RELEASE-OP-REISSUE has merged (it moves the intent of `issue` into a lease section; the directory check of R5 is computed before that section, the section records no intent when the directory is missing, and the stop of R5 follows the publication stop; no return of `issue` is moved). This card edits the `executeOperation` call of `ReleaseRunner.issue`, which T0-RELEASE-OP-REISSUE and T0-OP-TIMESTAMP-NOW also edit: the coordinator runs this card after T0-RELEASE-OP-REISSUE and before T0-OP-TIMESTAMP-NOW starts. T0-AUDIT-FIXES changed the pattern fields of this schema; keep its tests as they are. Insert the CHANGELOG entry directly above the entry that begins `- T1-R3-SECOND-PASS:`, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict."
doc_sync: docs/OPERATIONS.md (Provider operation bindings), docs/DELIVERY-OPS.md (Per-operation record) and its template copy templates/docs/DELIVERY-OPS.md, CHANGELOG.md
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

## Attempt evidence

Host: Windows (win32). The POSIX rows of acceptance 1 are skipped here by `process.platform` and have not run; their expected values were checked against `path.posix.resolve` by hand. A coordinator Linux run and CI cover them.

RED receipt: commit 370582aa (tests only), run on c738c646 sources, the failing line of each test: `operationCwd: one directory for every form of cwd` TypeError `operationCwd is not a function`; `a cwd that is not a usable string is refused when the ops file loads` `expected 'unreadable', actual 'configured'` (row empty); `the command and the status lookup of one binding run in one directory` `command, cwd undefined` (actual `[undefined]`, expected `[<root>]`); `the release runner and goal reconcile use the binding directory` deploy call `cwd` is the main checkout, expected `<main checkout>\ops`; `aidlc goal reconcile looks the status up ...` `ENOENT ... cwd.txt` (the lookup ran in `ops` read against the process directory and wrote nothing); `a binding directory that does not exist stops the release before any operation` `expected 'stop', actual 'stage'`. The order rows (`... changes no earlier return of the deploy step`) pass on main by design: they pin the existing order.

### Revert table (each hunk reverted alone on the candidate; failing tests of ops.test.ts, exec-sync-tree.test.ts, ops-cwd.test.ts, release.test.ts, release-reissue.test.ts)
Rerun on commit 2efcbb72 (the later commit 0209b56d changes only how `ops-cwd.test.ts` removes its fixtures); every row of the earlier runs fails the same tests, and the rows added since are the NUL row and the four document rows. `reconcile.test.ts` is not in the run (it calls neither function). `a status lookup whose directory does not exist fails to start and reads as UNKNOWN` pins a docs sentence and passes on main too, so no source revert fails it and it has no row.

| Hunk reverted | Tests that fail |
|---|---|
| R2 schema: no `cwd` refinement | `a cwd that is not a usable string ...` |
| R2 schema: blank allowed | same test |
| R2 schema: drive-relative allowed | same test |
| R1 `operationCwd`: no `cwd` gives `.` not `root` | `operationCwd: one directory ...`, `the command and the status lookup ...` |
| R1 `operationCwd`: `cwd` as written, no resolve | the same two, `the release runner and goal reconcile ...`, `aidlc goal reconcile ...`, `a binding directory that does not exist stops ...` |
| R1 `operationCwd`: trims the value | `operationCwd: one directory ...` (the ` ops ` row) |
| R3 `executeOperation` uses `binding.cwd` | `the command and the status lookup ...`, `the release runner and goal reconcile ...` |
| R3 `executeOperation` uses `root` only | same two |
| R3 `lookupOperation` uses `binding.cwd` | `the command and the status lookup ...`, `the release runner ...`, `aidlc goal reconcile ...` |
| R4 reconcile loop passes `process.cwd()` | `the release runner and goal reconcile use the binding directory` |
| R4 `issue` passes `process.cwd()` | same test |
| R4 `goal reconcile` passes `process.cwd()` | `aidlc goal reconcile looks the status up ...` |
| R5 directory check after the lease section's intent (the section records the intent without the directory condition) | `a binding directory that does not exist stops the release before any operation` (the "no ledger record" assertion) |
| R5 stop moved above the publication stop | `a binding directory that does not exist changes no earlier return of the deploy step` (the `release-auth` row) |
| R5 stop moved above the NOT CONFIGURED stop and the settle return | the same test (the settled row) and `only the step's exact key matches, and every status has one outcome` |
| R5 stop moved above the lease section (before the records are read) | the same test (the settled row) |
| R5 new stop removed | `a binding directory that does not exist stops the release before any operation` |
| R5 `isDirectory` answers by `existsSync` | same test (the file rows) |
| R5 `isDirectory` without the `try`/`catch` | same test and the order test (absent directory throws) |
| R2 schema: a NUL character allowed (the `refine` removed) | `a cwd that is not a usable string ...` (the `a NUL character` row) |
| R6 `docs/OPERATIONS.md` reverted to its text at 6a95726b (without the NUL clause and the stop conditions) | `the template copy of DELIVERY-OPS.md is the repository's` (`docs/OPERATIONS.md holds: and one that holds a NUL character (U+0000)`) |
| R6 `docs/DELIVERY-OPS.md` reverted to 6a95726b | same test (the equality with the template) |
| R6 `templates/docs/DELIVERY-OPS.md` reverted to 6a95726b | same test (the equality with the repository copy) |
| R6 `CHANGELOG.md` reverted to 6a95726b | same test (`CHANGELOG.md holds: and one that holds a NUL character (U+0000)`) |
| R6 `templates/docs/DELIVERY-OPS.md` left as on c738c646 | `the template copy of DELIVERY-OPS.md is the repository's` (equality assertion; run alone: ops.test.ts pass 12, fail 1) |

### Clause table
| Clause | Test (file) |
|---|---|
| R1 no `cwd` gives `root`; relative `ops`, `ops/sub`, `.`, `..`, name with spaces, tab, line break; ` ops ` kept; `~/ops` | `operationCwd: one directory for every form of cwd` (ops.test.ts), one row each |
| R1 `ops\sub`, `\ops`, `/ops`, `C:\ops`, `c:\ops`, `C:/ops`, `\\server\share\ops`, `\\?\C:\ops` on Windows | same test, win32 rows |
| R1 `/srv/ops`, `C:\ops`, `\\server\share\ops` and the other Windows forms on POSIX | same test, posix rows (not run on this host) |
| R2 null, 3, `{}` | `a cwd that is not a usable string is refused when the ops file loads`, rows null, a number, an object |
| R2 empty, spaces, tab, and the other `\s` characters (line break, no-break space, byte order mark) | same test |
| R2 a `cwd` holding a NUL character (`ops\u0000x`) refused, with the issue at `operations.1.cwd` | same test, the `a NUL character` row; RED at 5e12929c before the schema `refine` |
| R2 `C:ops`, `c:ops`, `C:` refused; `C:\ops`, `c:/ops`, `ops`, `ops dir`, `/srv/ops` load; issue at `operations.1.cwd` | same test |
| R3 both signatures; same directory for command and lookup | `the command and the status lookup of one binding run in one directory`; the 14 changed calls of ops.test.ts; `acceptance 4` of exec-sync-tree.test.ts with the root added |
| R4 `issue` and the reconcile loop | `the release runner and goal reconcile use the binding directory` |
| R4 `goal reconcile` from a subdirectory and a linked worktree | `aidlc goal reconcile looks the status up in the binding directory of the main checkout, ...` |
| R5 absent, a file, a path under a file: stop, detail, next action, disposition, no record, no `OPERATION_INTENT`, no command | `a binding directory that does not exist stops the release before any operation` (three rows) |
| R5 a settled step settles; unbound role gives NOT CONFIGURED; publication gives `release-auth`, each with the directory missing | `a binding directory that does not exist changes no earlier return of the deploy step` |
| R5 unbound-role row | an unbound role has no `cwd`, so the row binds the other roles to a missing directory and pins that no directory check runs without a binding (accepted by the coordinator) |
| R5 a lookup whose directory does not exist reads as UNKNOWN | `a status lookup whose directory does not exist fails to start and reads as UNKNOWN` (real process start; true on main too, it pins the sentence) |
| R6 | `docs/OPERATIONS.md` Rules paragraph, `docs/DELIVERY-OPS.md` Per-operation record, `CHANGELOG.md` entry above `T1-R3-SECOND-PASS`; reviewer-verified against the diff |
| R6 the conditions of the `release-config` stop (the role is bound, the step has no ledger record yet, the publication check passes; a recorded step is settled, an unbound role stops NOT CONFIGURED, an unauthorized publication stops `release-auth`) in `docs/OPERATIONS.md`, `docs/DELIVERY-OPS.md`, the template and the CHANGELOG | `the template copy of DELIVERY-OPS.md is the repository's`; RED at 5e12929c with the documents as on 6a95726b; the behaviour itself: the three order rows of `... changes no earlier return of the deploy step` |
| R6 template copy equal to `docs/DELIVERY-OPS.md` (line endings normalised) and both hold the `cwd` rule | `the template copy of DELIVERY-OPS.md is the repository's` (ops.test.ts); RED at 4480631d: `template` differs from `repository` by the `cwd` bullet, green at 1faf739c |

### Forbid and non_goals
| Entry | How the diff respects it |
|---|---|
| no weakened or skipped test | existing tests change only by the added root argument (exec-sync-tree.test.ts 3 lines, ops.test.ts 14 calls); assertions unchanged; no skip |
| process, timeout, environment, arguments unchanged | `executeOperation` and `lookupOperation` change only the `cwd` option of the runner call |
| documented example bindings unchanged | `aidlc.ops.example.json` and the example in OPERATIONS.md untouched; rule sentences only |
| no new `mkdtempSync` | temp directories come from `tmpDir` (removed by `t.after` with `cleanup`, and by the exit handler) or `makeFixture` (`t.after`); no cleanup in `finally` |
| no hand edit of .aidlc state | none touched |
| no limit on `cwd` leaving the main checkout | `..` is a row of acceptance 1 and resolves outside |
| no directory check before a status lookup | none added to `lookupOperation` |
| provider timeouts and status interpretation | unchanged |
| a directory removed between the check and the command | not handled; no code or doc sentence about it |

Child processes of the tests (`ops-cwd.test.ts`): `git init`, `git commit`, `git worktree add` and the CLI. The form chosen for the fixture git setup is the command line (`-c`) plus an environment, not the repository config. In code:

```ts
function childEnv(fixture: string, iso: GitIsolation): Record<string, string> {
  const inherited = Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !/^GIT_/i.test(entry[0]) && entry[0].toUpperCase() !== 'AIDLC_STATE_DIR');
  return { ...Object.fromEntries(inherited), GIT_CEILING_DIRECTORIES: path.dirname(fixture), GIT_CONFIG_GLOBAL: iso.config, GIT_CONFIG_NOSYSTEM: '1' };
}
// iso.config: an empty file, iso.hooks: an empty directory, both in a tmpDir of the test removed by t.after(() => cleanup(dir))
const config = ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', `core.hooksPath=${iso.hooks}`, '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false'];
spawnSync('git', [...config, ...args], { cwd, env: childEnv(fixture, iso), encoding: 'utf8', windowsHide: true });
```

Every inherited `GIT_*` variable is removed in any case (so `git_dir` and `GIT_CONFIG_COUNT` go too), `AIDLC_STATE_DIR` is removed, the global configuration is the empty file, the system configuration is off, and the identity, hooks path and signing come from the arguments. The CLI children get the same environment. `makeFixture` starts no child process in these tests (the runner is scripted).

Hostile-configuration check: with the parent environment `HOME` and `USERPROFILE` set to a directory whose `.gitconfig` sets `commit.gpgsign=true`, `core.hooksPath` to a directory with a `pre-commit` that exits 1 and `gpg.program` to a missing program, and `GIT_CONFIG_GLOBAL` naming the same file, `ops-cwd.test.ts` run on 5e12929c (before the change) failed at `git commit -q --allow-empty -m init: hostile hook ran`; on 7326c2d0 and later the same command gave `# pass 4`, `# fail 0`.

### Temporary directories of the two test files (grep at 0209b56d)
`grep -n "cleanup\|tmpDir(\|makeFixture(\|rmSync\|mkdtempSync\|finally" tests/scenarios/ops-cwd.test.ts tests/infra/ops.test.ts`, with `grep -c "fx.cleanup"` giving 0 for both files:

| Directory | Created by | Removed by |
|---|---|---|
| `dir` of `ops.test.ts` | `tmpDir()` (line 10) | `after(() => cleanup(dir))` (line 11) |
| fixture of `fixtureFor` in `ops-cwd.test.ts` | `makeFixture()` (line 22) | `t.after(() => cleanup(fx.tmp))` (line 23) |
| git isolation directory | `tmpDir('aidlc-ops-cwd-git-')` (line 90) | `t.after(() => cleanup(dir))` (line 91) |
| `repo`, the parent of `linked`, `out` of the CLI test | `tmpDir` (lines 120 to 122) | `t.after(() => [repo, path.dirname(linked), out].forEach(cleanup))` (line 124) |

No `mkdtempSync`, no `rmSync`, no `finally`, no `fx.cleanup` in either file.

### Doc-reading tests (standing check G)
Run on commit 0209b56d: the 75 test files of `tests/` that name `OPERATIONS.md`, `DELIVERY-OPS.md` or `CHANGELOG.md` and read files (`grep -rlE "(OPERATIONS|DELIVERY-OPS)\.md|CHANGELOG\.md|DELIVERY-OPS" tests`, then those with `readFileSync|readDoc|read(|cpSync|readdirSync`; it includes `tests/infra/init.test.ts`, which reads the template tree) in one `node --test` run gave tests 1819, pass 1807, fail 1, skipped 11. The failing test was `T0-EXEC-TREE-KILL run on real processes` (acceptance 4, a 6 s limit) in `tests/infra/exec.test.ts`; rerun alone on 0209b56d: tests 61, pass 61, fail 0. It is a load flake: the test runs real processes and asserts no doc sentence. The same run on 1faf739c had that failure and one in `tests/surface/hook-git-prefetch.test.ts` (9 of 9 alone). All four documents changed since that run; this run follows the change.

### DoD
`npm run typecheck && node --test tests/infra/ops.test.ts tests/infra/exec-sync-tree.test.ts tests/scenarios/ops-cwd.test.ts tests/scenarios/release.test.ts tests/scenarios/release-reissue.test.ts tests/infra/reconcile.test.ts` on 0209b56d ended `# tests 77`, `# suites 7`, `# pass 77`, `# fail 0`, `# cancelled 0`, `# skipped 0`, exit 0.

### Diff size
Against origin/main (ebc55182 plus the merged cards), without this card file, on the final tree: 411 lines added and 31 removed in 10 files, within the budget of 460. Source files: 47 added and 11 removed (`src/delivery/ops.ts` 26/5, `src/loop/release-runner.ts` 20/5, `src/cli/main.ts` 1/1). Tests: 359 added, 19 removed (`tests/infra/ops.test.ts` 136/16, `tests/scenarios/ops-cwd.test.ts` 220/0, `tests/infra/exec-sync-tree.test.ts` 3/3). Docs, CHANGELOG and the template: 5 added, 1 removed.


Coordinator verification:
