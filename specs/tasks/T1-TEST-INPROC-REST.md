---
id: T1-TEST-INPROC-REST
title: The CLI cases kept as child processes only because a protected line could not take an await (the sync helpers assertCwdRefused and assertRefused, and results indexed on a protected line in review-no-run and approver) run in-process
status: todo
branch: T1-TEST-INPROC-REST
worktree: D:\wt\AIDLC\T1-TEST-INPROC-REST
plan_ref: plans/test-time.md#order-of-work
allow_paths:
  - tests/surface/cli-cwd-paths.test.ts
  - tests/scenarios/review-resolve.test.ts
  - tests/scenarios/review-no-run.test.ts
  - tests/surface/approver.test.ts
  - changelog.d/T1-TEST-INPROC-REST.md
  - specs/tasks/T1-TEST-INPROC-REST.md
dod_command: npm run typecheck && node --test tests/surface/cli-cwd-paths.test.ts tests/scenarios/review-resolve.test.ts tests/scenarios/review-no-run.test.ts tests/surface/approver.test.ts tests/surface/test-audit.test.ts
dod_exit: 0
requirements:
  - R1. These child-process sites shall call `runCliInProcess` (`tests/infra/cli-inprocess.ts`) instead of `bin/aidlc.js`, except a call that R2 keeps or that passes `preload`:
    (a) `assertCwdRefused` in `tests/surface/cli-cwd-paths.test.ts`;
    (b) `assertRefused` in `tests/scenarios/review-resolve.test.ts`;
    (c) `rawSync` and `cliSync` (the `card next` calls) in `tests/scenarios/review-no-run.test.ts`;
    (d) `lastAuthorizations` and the empty-approver refusal check `f.cli(args).status` in `tests/surface/approver.test.ts`.
    Each site carries a comment naming the owner's exception of T1-TEST-INPROC-A-2 and T1-TEST-INPROC-B-2.
  - R2. Each CLI command each of the four files runs shall keep at least one case through `bin/aidlc.js` in a child process. Where converting a site would remove a command's last such case, one call of that site stays a child process and its comment names R2.
  - R3. A line containing `assert`, `it(`, `test(` or `describe(` may change only by four edits:
    - adding `async ` or `await `;
    - wrapping one awaited call in one pair of parentheses, as `(await x)`;
    - in a helper declaration, changing the return type `void` to `Promise<void>`;
    - in a helper declaration, changing a return type `T` to `Promise<T>`.
    Every test name stays, and the count of `it(` and `test(` per file stays.
  - R4. A call that `preload` (module preloaded with `--import`), `cliAsync` (concurrent children) or any other existing `Child process (R1: ...)` comment keeps as a child process stays one.
acceptance:
  - 1. The DoD passes. [R1] [R3] [dod arm 1]
  - 2. A script outside the worktree pairs every removed and added line of `git diff -U0 main -- <file>` that contains `assert`, `it(`, `test(` or `describe(` in order, and normalizes each pair before comparing: it removes `async ` and `await `, replaces `Promise<` with nothing and the matching `>` with nothing, and drops parentheses. Every pair is then equal, no line is unpaired, and the reviewer confirms that each added parenthesis pair wraps exactly one awaited call. [R3]
  - 3. A command-to-child-case list, in the attempt evidence, shows a `bin/aidlc.js` child case for every command each file runs. [R2] [R4]
  - 4. Junit times on this machine (`node --test --test-reporter=junit`, each file alone, same session, main versus the branch) for:
    - "every option, path and file row, then again under a configuration ctx() refuses" (50.2 s on main at b6b274d7);
    - the cli-cwd-paths test "an invalid -C is refused for every command" (26.7 s);
    - the approver test "an approval without --by records the git identity..." (23.2 s);
    - the four review-no-run acceptance 2 and 3 tests (30.1 s together).
    Each shall be lower on the branch, and the evidence lists both numbers. [R1]
depends_on: []
budget: 120
tdd: false
sweep: "The four test files are the sites of R1; the changelog fragment and this card are the closure files. No other file changes: every converted call uses runCliInProcess as it is on main."
forbid:
  - a change under src/ or bin/
  - weakening, skipping or deleting a test, or changing a test file other than the four named
  - a change to a protected line beyond R3
non_goals: [review-r3-wait.test.ts (its child cases check what bin/aidlc.js prints), init-no-package and init-base-ci (no site of R1), changing tests/infra/cli-inprocess.ts]
hygiene: "Follow-up the owner asked for in session on 2026-11-21, of the exception ruled on T1-TEST-INPROC-B-2 and T1-TEST-INPROC-A-2 (calls whose result is indexed on a protected line, and rows run through the protected sync helpers, may stay child processes; follow-up later). The owner allowed `(await x)` and `Promise<void>` on protected lines for this follow-up. tdd is false: no product behaviour changes, the oracle is the unchanged assertions (acceptance 2) and the timing (acceptance 4). Changelog entry in changelog.d/T1-TEST-INPROC-REST.md (form: changelog.d/README.md)."
---

# T1-TEST-INPROC-REST

## Deliverable
The slowest leftover child-process cases of the in-process conversion run in-process, with each assertion unchanged apart from `await` and its parentheses.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/cli-cwd-paths.test.ts tests/scenarios/review-resolve.test.ts tests/scenarios/review-no-run.test.ts tests/surface/approver.test.ts tests/surface/test-audit.test.ts
```
- Expected exit code: 0
- Assertion: the files pass; each test named in acceptance 4 is faster than on main.

## Attempt evidence
