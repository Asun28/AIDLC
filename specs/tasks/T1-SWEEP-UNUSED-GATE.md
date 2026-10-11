---
id: T1-SWEEP-UNUSED-GATE
title: The typecheck and the build refuse unused locals, imports and parameters (noUnusedLocals, noUnusedParameters); markLost drops its unread now; the unused test locals go
status: todo
branch: T1-SWEEP-UNUSED-GATE
worktree: D:\wt\AIDLC\T1-SWEEP-UNUSED-GATE
plan_ref: plans/dead-code-sweep.md#order-of-work
allow_paths:
  - tsconfig.json
  - src/coordination/review-queue.ts
  - src/loop/card-runner.ts
  - tests/surface/tsconfig-gate.test.ts
  - tests/infra/review-queue.test.ts
  - tests/infra/github-ship-merge-refused.test.ts
  - tests/infra/github-ship.test.ts
  - tests/infra/goal-store.test.ts
  - tests/infra/lease.test.ts
  - tests/scenarios/r2-fallback.test.ts
  - tests/surface/pre-review.test.ts
  - CLAUDE.md
  - CHANGELOG.md
  - specs/tasks/T1-SWEEP-UNUSED-GATE.md
dod_command: npm run typecheck && npm run build && node --test tests/surface/tsconfig-gate.test.ts tests/infra/review-queue.test.ts tests/surface/pre-review.test.ts
dod_exit: 0
requirements:
  - R1. `tsconfig.json` shall set `noUnusedLocals: true` and `noUnusedParameters: true`, and `tsconfig.test.json` (which extends it) shall not turn either off, so `npm run typecheck` (src and tests) and `npm run build` refuse an unused local, import or parameter.
  - R2. `ReviewQueue.markLost` (`src/coordination/review-queue.ts`) shall take `(key, detail)`, dropping the `now` parameter it never read; its callers pass two arguments.
  - R3. The unused locals and imports the R1 options report in `tests/` shall be removed, with no test or assertion added, removed or changed apart from R4's.
  - R4. `tests/surface/tsconfig-gate.test.ts` shall assert R1 by reading both config files.
  - R5. The `Commands` section of `CLAUDE.md` shall say that strict `tsc` with the unused-code options is the only static gate, and the CHANGELOG Unreleased section shall carry an entry naming this card.
acceptance:
  - 1. `tests/surface/tsconfig-gate.test.ts`: `tsconfig.json` has both options `true`; `tsconfig.test.json` sets neither to `false`. [R1] [R4] [dod arm 4]
  - 2. `npm run typecheck` and `npm run build` exit 0 with both options on. [R1] [R2] [R3] [dod arms 1, 2]
  - 3. `tests/infra/review-queue.test.ts` passes with two-argument `markLost` calls, and `tests/surface/pre-review.test.ts` passes with the same test names as on its base. [R2] [R3] [dod arms 5, 6]
  - 4. `tests/surface/tsconfig-gate.test.ts` reads the unused-code options in the `CLAUDE.md` static gate sentence and a T1-SWEEP-UNUSED-GATE entry in the CHANGELOG Unreleased section. [R5] [dod arm 4]
depends_on: [T1-SWEEP-DEAD-CODE, T1-SWEEP-REVIEW-WRAPPERS]
budget: 120
tdd: true
sweep: "npx tsc -p tsconfig.test.json --noEmit --noUnusedLocals --noUnusedParameters on main at df9acd7: src/coordination/review-queue.ts:159 (now) plus 14 in tests: github-ship-merge-refused.test.ts:1 (after), github-ship.test.ts:296 (JOB_API), goal-store.test.ts:248 (base), lease.test.ts:3 (statSync, utimesSync), r2-fallback.test.ts:443 (IN_FLIGHT_15), pre-review.test.ts:209,914,934,949,992,995,1020,1023 (each one line lower after T1-SWEEP-REVIEW-WRAPPERS; four are the unused first parameter `c` of a reviewer runner whose second parameter is read). Callers of markLost: src/loop/card-runner.ts:2301 and tests/infra/review-queue.test.ts:136,150. The list is re-run on this card's base after its two dependencies merge."
forbid: [a void expression, a ts-ignore or an underscore rename of a local, an import or a last parameter to silence an unused name (an underscore prefix is used only for a positional parameter that precedes a used one, the form noUnusedParameters exempts), changing an existing assertion, a persisted schema change]
non_goals: ["a linter"]
doc_sync: CLAUDE.md, CHANGELOG.md
---

# T1-SWEEP-UNUSED-GATE

## Deliverable
Unused locals, imports and parameters fail the typecheck and the build from now on, and the 15 that exist today are gone.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && npm run build && node --test tests/surface/tsconfig-gate.test.ts tests/infra/review-queue.test.ts tests/surface/pre-review.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck and the build are clean and every listed test passes.
